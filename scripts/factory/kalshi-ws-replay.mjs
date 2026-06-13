import crypto from "node:crypto";
import { normalizeReplayRawEvent } from "./raw-tick-extract.mjs";
import { isRecord, numberOrNull, stringOrNull } from "./utils.mjs";

export const defaultKalshiReplayWsUrl = "wss://external-api-ws.kalshi.com/trade-api/ws/v2";
export const defaultKalshiReplayChannels = ["orderbook_delta", "trade", "market_lifecycle_v2"];

export function kalshiWsAuthHeaders({ keyId, privateKeyPem, timestamp = String(Date.now()), requestPath = "/trade-api/ws/v2" } = {}) {
  if (!keyId || !privateKeyPem) {
    return { ok: false, reason: "KALSHI_API_KEY_ID_or_KALSHI_PRIVATE_KEY_PEM_missing" };
  }
  return {
    ok: true,
    timestamp,
    keyId,
    signature: signPss(privateKeyPem, `${timestamp}GET${requestPath}`),
  };
}

export function kalshiReplaySubscription({ marketTickers = [], channels = defaultKalshiReplayChannels, useYesPrice = true, requestId = 1 } = {}) {
  return {
    id: requestId,
    cmd: "subscribe",
    params: {
      channels: uniqueStrings(channels),
      market_tickers: uniqueStrings(marketTickers),
      use_yes_price: useYesPrice === true,
    },
  };
}

export function encodeClientWebSocketFrame(payload, { opcode = 1, maskKey = crypto.randomBytes(4) } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const header = [];
  header.push(0x80 | (opcode & 0x0f));
  if (body.length < 126) {
    header.push(0x80 | body.length);
  } else if (body.length <= 0xffff) {
    header.push(0x80 | 126, (body.length >> 8) & 0xff, body.length & 0xff);
  } else {
    const length = BigInt(body.length);
    header.push(0x80 | 127);
    for (let shift = 56n; shift >= 0n; shift -= 8n) header.push(Number((length >> shift) & 0xffn));
  }
  const key = Buffer.from(maskKey);
  const masked = Buffer.alloc(body.length);
  for (let index = 0; index < body.length; index += 1) masked[index] = body[index] ^ key[index % 4];
  return Buffer.concat([Buffer.from(header), key, masked]);
}

export function decodeServerWebSocketFrames(input) {
  const buffer = Buffer.from(input);
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      const bigLength = buffer.readBigUInt64BE(cursor);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("websocket_frame_too_large");
      length = Number(bigLength);
      cursor += 8;
    }
    let mask = null;
    if (masked) {
      if (buffer.length - cursor < 4) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (buffer.length - cursor < length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    }
    frames.push({ fin, opcode, payload });
    offset = cursor + length;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

export function normalizeKalshiWsReplayMessage(raw, context = {}) {
  if (!isRecord(raw)) return null;
  const msg = isRecord(raw.msg) ? raw.msg : isRecord(raw.message) ? raw.message : {};
  const messageTypeRaw = stringOrNull(raw.type ?? raw.message_type ?? msg.type ?? msg.event_type);
  const marketTicker = stringOrNull(raw.market_ticker ?? raw.marketTicker ?? raw.ticker)
    ?? stringOrNull(msg.market_ticker ?? msg.marketTicker ?? msg.ticker);
  if (!marketTicker || !messageTypeRaw) return null;
  const receiveTs = context.receiveTs ?? new Date().toISOString();
  const providerTs = isoFromAny(raw.ts_ms ?? raw.ts ?? raw.timestamp ?? msg.ts_ms ?? msg.ts ?? msg.timestamp ?? msg.time);
  const sourcePayloadSha256 = sha256(JSON.stringify(raw));
  const normalized = normalizeReplayRawEvent({
    provider: context.provider ?? "kalshi",
    captureMode: "websocket",
    marketTicker,
    marketId: msg.market_id ?? msg.marketId ?? null,
    channel: channelFromKalshiType(messageTypeRaw),
    messageType: replayMessageType(messageTypeRaw),
    sid: raw.sid ?? msg.sid ?? null,
    seq: raw.seq ?? msg.seq ?? null,
    providerTs,
    receiveTs,
    receiveMonotonicNs: context.receiveMonotonicNs ?? null,
    side: normalizeSide(msg.side ?? msg.book_side),
    priceDollars: kalshiPriceDollars(msg.price ?? msg.yes_price ?? msg.yesPrice ?? msg.no_price ?? msg.noPrice),
    deltaContracts: numberOrNull(msg.delta ?? msg.count ?? msg.size ?? msg.quantity),
    bestYesBid: bestPriceFromSnapshot(msg, "yes"),
    bestYesAsk: bestAskFromSnapshot(msg, "yes"),
    bestNoBid: bestPriceFromSnapshot(msg, "no"),
    bestNoAsk: bestAskFromSnapshot(msg, "no"),
    bookSnapshot: replayMessageType(messageTypeRaw) === "snapshot" ? msg : null,
    payloadSha256: sourcePayloadSha256,
    wsSessionId: context.wsSessionId ?? null,
    captureRunId: context.captureRunId ?? "manual",
    gitCommit: context.gitCommit ?? "UNAVAILABLE",
    sourceFileOrdinal: context.sourceFileOrdinal ?? 0,
    useYesPrice: context.useYesPrice === true,
    priceScale: context.useYesPrice === true ? "yes_leg" : "provider_default",
  }, context);
  if (!normalized) return null;
  return {
    ...normalized,
    payloadSha256: sourcePayloadSha256,
    useYesPrice: context.useYesPrice === true,
    priceScale: context.useYesPrice === true ? "yes_leg" : "provider_default",
  };
}

export function signPss(privateKeyPem, text) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(text);
  signer.end();
  return signer.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

function replayMessageType(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("delta")) return "delta";
  if (text.includes("trade")) return "trade";
  if (text.includes("lifecycle") || text.includes("determined") || text.includes("settled") || text.includes("status")) return "status";
  if (text.includes("snapshot")) return "snapshot";
  return "status";
}

function channelFromKalshiType(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("trade")) return "trade";
  if (text.includes("lifecycle") || text.includes("determined") || text.includes("settled") || text.includes("status")) return "lifecycle";
  return "orderbook";
}

function bestPriceFromSnapshot(msg, side) {
  const levels = Array.isArray(msg?.[side]) ? msg[side] : Array.isArray(msg?.[`${side}s`]) ? msg[`${side}s`] : [];
  const price = levels.length ? levels[0]?.[0] ?? levels[0]?.price : null;
  return kalshiPriceDollars(price);
}

function bestAskFromSnapshot(msg, side) {
  const levels = Array.isArray(msg?.[`${side}_asks`]) ? msg[`${side}_asks`] : Array.isArray(msg?.[`${side}Asks`]) ? msg[`${side}Asks`] : [];
  const price = levels.length ? levels[0]?.[0] ?? levels[0]?.price : null;
  return kalshiPriceDollars(price);
}

function kalshiPriceDollars(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) return null;
  return numeric > 1 ? Number((numeric / 100).toFixed(4)) : numeric;
}

function isoFromAny(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const text = stringOrNull(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeSide(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (text === "YES" || text === "Y") return "YES";
  if (text === "NO" || text === "N") return "NO";
  return null;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
