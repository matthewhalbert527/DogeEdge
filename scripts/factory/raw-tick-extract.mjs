import { createHash } from "node:crypto";
import { isRecord, numberOrNull, stringOrNull } from "./utils.mjs";

export const rawTickReplaySchemaVersion = "dogeedge.raw-market-ticks.schema.v1";
export const replayRawEventSchemaVersion = "dogeedge.replay-raw-event.v1";

export function compactReplayTickRow(raw, sourceLine, context = {}) {
  const input = isRecord(raw?.paperInput) ? raw.paperInput : {};
  const feed = isRecord(raw?.runtimeSnapshot?.feed) ? raw.runtimeSnapshot.feed : {};
  const action = String(input.action ?? raw?.action ?? "");
  return {
    ts_event: input.observedAt ?? raw?.observedAt ?? raw?.capturedAt ?? null,
    ts_receive: raw?.capturedAt ?? raw?.runtimeSnapshot?.generatedAt ?? null,
    market_ticker: raw?.marketTicker ?? input.ticker ?? raw?.market_ticker ?? null,
    channel: raw?.channel ?? "local_raw_snapshot",
    event_type: raw?.event_type ?? raw?.eventType ?? "orderbook_snapshot",
    side: action.includes("no") ? "NO" : action.includes("yes") ? "YES" : "",
    book_side: raw?.book_side ?? "top",
    price: numberOrNull(input.selectedAsk ?? input.yesAsk ?? input.noAsk ?? raw?.price),
    size: numberOrNull(input.sizeContracts ?? raw?.size),
    level: numberOrNull(raw?.level) ?? 0,
    sequence_number: numberOrNull(raw?.sequence_number ?? raw?.sequenceNumber),
    best_yes_bid: numberOrNull(input.yesBid ?? raw?.best_yes_bid),
    best_yes_ask: numberOrNull(input.yesAsk ?? raw?.best_yes_ask),
    best_no_bid: numberOrNull(input.noBid ?? raw?.best_no_bid),
    best_no_ask: numberOrNull(input.noAsk ?? raw?.best_no_ask),
    market_status: input.marketLive === true ? "open" : stringOrNull(raw?.market_status) ?? "unknown",
    source: raw?.source ?? "local_raw_snapshot",
    source_message_hash: sha256(String(sourceLine ?? "")),
    snapshot_id: context.snapshotId ?? null,
    git_commit: context.gitCommit ?? "UNAVAILABLE",
    spot_price: numberOrNull(input.spotPrice ?? feed.price ?? raw?.spot_price),
    target_price: numberOrNull(input.targetPrice ?? raw?.target_price),
    seconds_to_close: numberOrNull(input.secondsToClose ?? raw?.seconds_to_close),
  };
}

export function rawTickReplayManifest({
  snapshotId,
  generatedAt,
  gitCommit = "UNAVAILABLE",
  requestedFormat = "jsonl",
  targetMarkets = [],
  jsonlFiles = [],
  sourceSnapshotFiles = [],
}) {
  const coveredTargetMarkets = uniqueStrings(jsonlFiles.map((file) => file.marketTicker));
  const coveredSet = new Set(coveredTargetMarkets);
  const uncoveredTargetMarkets = uniqueStrings(targetMarkets).filter((marketTicker) => !coveredSet.has(marketTicker));
  const sequenceGapCheckAvailable = jsonlFiles.some((file) => file.sequenceGapCheckAvailable === true);
  const replayGradeFormat = requestedFormat === "parquet" ? "parquet" : "jsonl_indexed";
  const replayGradeAvailable = jsonlFiles.length > 0
    && uncoveredTargetMarkets.length === 0
    && sequenceGapCheckAvailable
    && requestedFormat === "parquet";
  return {
    schemaVersion: "dogeedge.raw-market-ticks.manifest.v1",
    snapshotId,
    generatedAt,
    available: jsonlFiles.length > 0,
    format: jsonlFiles.length > 0 ? "jsonl" : null,
    requestedFormat,
    exportedFormat: jsonlFiles.length > 0 ? "jsonl" : null,
    replayGradeFormat,
    replayGradeAvailable,
    promotionGradeReplayAvailable: replayGradeAvailable,
    parquetAvailable: requestedFormat === "parquet" && jsonlFiles.length > 0,
    jsonlAvailable: jsonlFiles.length > 0,
    executionSensitivePromotionAllowed: replayGradeAvailable,
    promotionGateRequirement: "replay_grade_target_market_ticks_required_for_execution_sensitive_promotion",
    gitCommit,
    expectedDirectory: "raw_market_ticks/<market_ticker>.parquet",
    jsonlDirectory: "raw_market_ticks/jsonl/<market_ticker>.jsonl",
    targetMarkets: uniqueStrings(targetMarkets),
    targetMarketCount: uniqueStrings(targetMarkets).length,
    coveredTargetMarkets,
    uncoveredTargetMarkets,
    coveredTargetMarketCount: coveredTargetMarkets.length,
    uncoveredTargetMarketCount: uncoveredTargetMarkets.length,
    jsonlFiles,
    sourceSnapshotFiles,
    sourceSnapshotFileCount: sourceSnapshotFiles.length,
    sequenceGapCheckAvailable,
    warningCodes: [
      ...(!replayGradeAvailable ? ["replay_grade_target_market_ticks_absent"] : []),
      ...(requestedFormat !== "parquet" ? ["raw_market_tick_parquet_absent"] : []),
      ...(jsonlFiles.length > 0 ? ["raw_market_tick_jsonl_sample"] : ["raw_market_tick_jsonl_absent"]),
      ...(uncoveredTargetMarkets.length > 0 ? ["raw_market_tick_target_coverage_gap"] : []),
      ...(!sequenceGapCheckAvailable ? ["sequence_gap_check_absent"] : []),
      ...(sourceSnapshotFiles.length === 0 ? ["raw_snapshot_source_absent"] : []),
    ],
  };
}

export function rawTickReplayCoverageRows({ snapshotId, targetMarkets = [], jsonlFiles = [], requestedFormat = "jsonl" }) {
  const byMarket = new Map(jsonlFiles.map((file) => [file.marketTicker, file]));
  return uniqueStrings(targetMarkets).map((marketTicker) => {
    const file = byMarket.get(marketTicker);
    return {
      snapshotId,
      marketTicker,
      available: Boolean(file),
      replayGrade: file?.replayGrade === true,
      format: file ? requestedFormat : "",
      jsonlRows: file?.rows ?? 0,
      relativePath: file?.relativePath ?? "",
      uncoveredReason: file ? "" : "target_market_raw_tick_sample_absent",
    };
  });
}

export function normalizeReplayRawEvent(raw, context = {}) {
  if (!isRecord(raw)) return null;
  const payloadSha256 = stringOrNull(raw.payloadSha256) ?? sha256(JSON.stringify(raw.rawProviderMessage ?? raw));
  const marketTicker = stringOrNull(raw.marketTicker)
    ?? stringOrNull(raw.market_ticker)
    ?? stringOrNull(raw.ticker)
    ?? stringOrNull(raw.paperInput?.ticker);
  if (!marketTicker) return null;
  const receiveTs = stringOrNull(raw.receiveTs)
    ?? stringOrNull(raw.ts_receive)
    ?? stringOrNull(raw.capturedAt)
    ?? stringOrNull(raw.runtimeSnapshot?.generatedAt)
    ?? context.receiveTs
    ?? new Date(0).toISOString();
  const providerTs = stringOrNull(raw.providerTs)
    ?? stringOrNull(raw.ts_event)
    ?? stringOrNull(raw.observedAt)
    ?? stringOrNull(raw.paperInput?.observedAt)
    ?? null;
  const messageType = normalizeMessageType(raw.messageType ?? raw.event_type ?? raw.eventType);
  const captureMode = stringOrNull(raw.captureMode) ?? context.captureMode ?? "websocket";
  const provider = stringOrNull(raw.provider) ?? context.provider ?? "kalshi";
  const seq = numberOrNull(raw.seq ?? raw.sequence_number ?? raw.sequenceNumber);
  return {
    schemaVersion: replayRawEventSchemaVersion,
    provider,
    captureMode,
    marketTicker,
    marketId: stringOrNull(raw.marketId) ?? stringOrNull(raw.market_id),
    channel: stringOrNull(raw.channel) ?? "orderbook",
    messageType,
    sid: raw.sid ?? null,
    seq,
    prevSeq: numberOrNull(raw.prevSeq ?? raw.previous_seq),
    providerTs,
    providerTsMs: providerTs ? Date.parse(providerTs) : null,
    receiveTs,
    receiveMonotonicNs: raw.receiveMonotonicNs ?? null,
    side: normalizeSide(raw.side),
    priceDollars: numberOrNull(raw.priceDollars ?? raw.price ?? raw.paperInput?.selectedAsk),
    deltaContracts: numberOrNull(raw.deltaContracts ?? raw.size ?? raw.delta),
    bestYesBid: numberOrNull(raw.bestYesBid ?? raw.best_yes_bid ?? raw.paperInput?.yesBid),
    bestYesAsk: numberOrNull(raw.bestYesAsk ?? raw.best_yes_ask ?? raw.paperInput?.yesAsk),
    bestNoBid: numberOrNull(raw.bestNoBid ?? raw.best_no_bid ?? raw.paperInput?.noBid),
    bestNoAsk: numberOrNull(raw.bestNoAsk ?? raw.best_no_ask ?? raw.paperInput?.noAsk),
    bookSnapshot: isRecord(raw.bookSnapshot) ? raw.bookSnapshot : isRecord(raw.book_snapshot) ? raw.book_snapshot : null,
    payloadSha256,
    wsSessionId: stringOrNull(raw.wsSessionId) ?? context.wsSessionId ?? null,
    captureRunId: stringOrNull(raw.captureRunId) ?? context.captureRunId ?? "manual",
    gitCommit: stringOrNull(raw.gitCommit) ?? context.gitCommit ?? "UNAVAILABLE",
    sourceFileOrdinal: Number.isInteger(raw.sourceFileOrdinal) ? raw.sourceFileOrdinal : context.sourceFileOrdinal ?? 0,
    useYesPrice: raw.useYesPrice === true || context.useYesPrice === true,
    priceScale: stringOrNull(raw.priceScale) ?? (raw.useYesPrice === true || context.useYesPrice === true ? "yes_leg" : "provider_default"),
  };
}

export function replaySequenceReport(events = []) {
  const sorted = [...events].sort((left, right) => {
    const leftSeq = numberOrNull(left.seq);
    const rightSeq = numberOrNull(right.seq);
    if (leftSeq !== null && rightSeq !== null && leftSeq !== rightSeq) return leftSeq - rightSeq;
    return Date.parse(left.receiveTs ?? "") - Date.parse(right.receiveTs ?? "");
  });
  const orderbookSequenced = sorted.filter((event) => (
    event.channel === "orderbook"
    && (event.messageType === "snapshot" || event.messageType === "delta")
    && numberOrNull(event.seq) !== null
  ));
  const seen = new Set();
  const gaps = [];
  const duplicates = [];
  const outOfOrder = [];
  let previousSeq = null;
  let previousSourceOrdinal = -1;
  for (const event of orderbookSequenced) {
    const seq = numberOrNull(event.seq);
    if (seq !== null) {
      if (seen.has(seq)) duplicates.push({ marketTicker: event.marketTicker, seq });
      seen.add(seq);
      if (previousSeq !== null && seq > previousSeq + 1) {
        gaps.push({ marketTicker: event.marketTicker, expectedSeq: previousSeq + 1, actualSeq: seq, gapSize: seq - previousSeq - 1 });
      }
      previousSeq = seq;
    }
    const ordinal = Number(event.sourceFileOrdinal ?? 0);
    if (ordinal < previousSourceOrdinal) outOfOrder.push({ marketTicker: event.marketTicker, seq, sourceFileOrdinal: ordinal });
    previousSourceOrdinal = Math.max(previousSourceOrdinal, ordinal);
  }
  const snapshotCount = sorted.filter((event) => event.channel === "orderbook" && event.messageType === "snapshot").length;
  const deltaCount = sorted.filter((event) => event.channel === "orderbook" && event.messageType === "delta").length;
  return {
    marketTicker: sorted[0]?.marketTicker ?? null,
    rowCount: sorted.length,
    snapshotCount,
    deltaCount,
    tradeCount: sorted.filter((event) => event.messageType === "trade").length,
    gapCount: gaps.length,
    duplicateCount: duplicates.length,
    outOfOrderCount: outOfOrder.length,
    replayGradeAvailable: snapshotCount > 0 && deltaCount > 0 && gaps.length === 0 && duplicates.length === 0,
    fallbackKind: snapshotCount > 0 && deltaCount > 0 && gaps.length === 0 && duplicates.length === 0
      ? "replay_grade"
      : sorted.some((event) => event.captureMode === "polling")
        ? "polling_diagnostic_only"
        : sorted.some((event) => event.captureMode === "historical_candlestick")
          ? "candlestick_diagnostic_only"
          : "absent",
    gaps,
    duplicates,
    outOfOrder,
  };
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeMessageType(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("delta")) return "delta";
  if (text.includes("trade")) return "trade";
  if (text.includes("status") || text.includes("lifecycle")) return "status";
  return "snapshot";
}

function normalizeSide(value) {
  const text = String(value ?? "").toUpperCase();
  if (text === "YES" || text === "NO") return text;
  return null;
}
