import { createHash } from "node:crypto";

export function reconstructOrderBook(events = []) {
  const sorted = [...events].sort(compareEvents);
  const yes = new Map();
  const no = new Map();
  const errors = [];
  const warnings = [];
  let initialized = false;
  let appliedDeltas = 0;
  let snapshotCount = 0;
  let emptySnapshotCount = 0;
  const stateRows = [];
  for (const event of sorted) {
    if (event?.channel !== "orderbook") continue;
    if (event.messageType === "snapshot") {
      const snapshot = event.bookSnapshot && typeof event.bookSnapshot === "object" ? event.bookSnapshot : {};
      const yesLevels = snapshot.yes ?? snapshot.yes_bids ?? snapshot.yesBids ?? snapshot.yes_dollars_fp ?? snapshot.yesDollarsFp;
      const noLevels = snapshot.no ?? snapshot.no_bids ?? snapshot.noBids ?? snapshot.no_dollars_fp ?? snapshot.noDollarsFp;
      const hasBookArrays = Array.isArray(yesLevels) || Array.isArray(noLevels);
      if (!hasBookArrays) {
        emptySnapshotCount += 1;
        if (initialized) {
          warnings.push({ reasonCode: "snapshot_without_book_levels_ignored", seq: event.seq ?? null });
          continue;
        }
        errors.push({ reasonCode: "snapshot_without_book_levels", seq: event.seq ?? null });
        continue;
      }
      yes.clear();
      no.clear();
      loadSnapshotSide(yes, yesLevels, errors, "YES");
      loadSnapshotSide(no, noLevels, errors, "NO");
      initialized = true;
      snapshotCount += 1;
    } else if (event.messageType === "delta") {
      if (!initialized) {
        errors.push({ reasonCode: "delta_before_snapshot", seq: event.seq ?? null });
        continue;
      }
      const side = event.side === "YES" ? yes : event.side === "NO" ? no : null;
      if (!side) {
        errors.push({ reasonCode: "delta_missing_side", seq: event.seq ?? null });
        continue;
      }
      const price = priceKey(event.priceDollars);
      const delta = integerOrNull(event.deltaContracts);
      if (price === null) {
        errors.push({ reasonCode: "delta_invalid_price", seq: event.seq ?? null });
        continue;
      }
      if (delta === null) {
        errors.push({ reasonCode: "delta_invalid_quantity", seq: event.seq ?? null });
        continue;
      }
      const nextQuantity = (side.get(price) ?? 0) + delta;
      if (nextQuantity < 0) {
        errors.push({ reasonCode: "delta_negative_quantity", seq: event.seq ?? null, price });
        continue;
      }
      if (nextQuantity === 0) side.delete(price);
      else side.set(price, nextQuantity);
      appliedDeltas += 1;
    }
    const top = topOfBook(yes, no);
    stateRows.push({
      seq: event.seq ?? null,
      receiveTs: event.receiveTs ?? null,
      messageType: event.messageType,
      ...top,
      payloadSha256: event.payloadSha256 ?? null,
    });
  }
  const top = topOfBook(yes, no);
  const deterministicHash = sha256(JSON.stringify({ top, stateRows }));
  return {
    schemaVersion: "dogeedge.orderbook-reconstruction.v1",
    initialized,
    valid: initialized && errors.length === 0,
    snapshotCount,
    emptySnapshotCount,
    appliedDeltas,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    useYesPrice: sorted.some((event) => event.useYesPrice === true),
    priceScale: sorted.some((event) => event.useYesPrice === true) ? "yes_leg" : "provider_default",
    finalTopOfBook: top,
    stateRowCount: stateRows.length,
    deterministicHash,
  };
}

function loadSnapshotSide(book, levels, errors, side) {
  if (!Array.isArray(levels)) return 0;
  let loaded = 0;
  for (const level of levels) {
    const price = priceKey(Array.isArray(level) ? level[0] : level?.price);
    const quantity = integerOrNull(Array.isArray(level) ? level[1] : level?.quantity ?? level?.size ?? level?.count);
    if (price === null) {
      errors.push({ reasonCode: "snapshot_invalid_price", side });
      continue;
    }
    if (quantity === null || quantity < 0) {
      errors.push({ reasonCode: "snapshot_invalid_quantity", side, price });
      continue;
    }
    if (quantity > 0) {
      book.set(price, quantity);
      loaded += 1;
    }
  }
  return loaded;
}

function topOfBook(yes, no) {
  const yesBid = maxPrice(yes);
  const noBid = maxPrice(no);
  const bestYesBid = centsToDollars(yesBid);
  const bestNoBid = centsToDollars(noBid);
  const bestYesAsk = bestNoBid === null ? null : roundDollars(1 - bestNoBid);
  const bestNoAsk = bestYesBid === null ? null : roundDollars(1 - bestYesBid);
  return {
    bestYesBid,
    bestYesAsk,
    bestNoBid,
    bestNoAsk,
    spread: bestYesBid === null || bestYesAsk === null ? null : roundDollars(bestYesAsk - bestYesBid),
    yesDepth: sumQty(yes),
    noDepth: sumQty(no),
    imbalance: imbalance(sumQty(yes), sumQty(no)),
  };
}

function priceKey(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) return null;
  return Math.round(numeric * 10000);
}

function integerOrNull(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
}

function maxPrice(book) {
  const keys = [...book.keys()];
  return keys.length ? Math.max(...keys) : null;
}

function centsToDollars(value) {
  return value === null ? null : roundDollars(value / 10000);
}

function roundDollars(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function sumQty(book) {
  return [...book.values()].reduce((sum, value) => sum + value, 0);
}

function imbalance(yesDepth, noDepth) {
  const total = yesDepth + noDepth;
  return total > 0 ? Math.round(((yesDepth - noDepth) / total) * 10000) / 10000 : null;
}

function compareEvents(left, right) {
  const leftSeq = typeof left?.seq === "number" ? left.seq : null;
  const rightSeq = typeof right?.seq === "number" ? right.seq : null;
  if (leftSeq !== null && rightSeq !== null && leftSeq !== rightSeq) return leftSeq - rightSeq;
  return Date.parse(left?.receiveTs ?? "") - Date.parse(right?.receiveTs ?? "");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
