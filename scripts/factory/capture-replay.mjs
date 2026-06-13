import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { normalizeReplayRawEvent } from "./raw-tick-extract.mjs";
import {
  decodeServerWebSocketFrames,
  defaultKalshiReplayChannels,
  defaultKalshiReplayWsUrl,
  encodeClientWebSocketFrame,
  kalshiReplaySubscription,
  kalshiWsAuthHeaders,
  normalizeKalshiWsReplayMessage,
} from "./kalshi-ws-replay.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultKalshiWsUrl = defaultKalshiReplayWsUrl;
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("Usage: node scripts/factory/capture-replay.mjs --markets-file file [--provider kalshi] [--mode provider|websocket|polling|live] [--mock-input file] [--data-root dir] [--out dir] [--capture-run-id id] [--duration-seconds n] [--channels orderbook_delta,trade,market_lifecycle_v2] [--use-yes-price true|false]");
  process.exit(0);
}
const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
const provider = String(args.provider ?? "kalshi");
const mode = String(args.mode ?? "websocket");
const captureRunId = String(args["capture-run-id"] ?? `capture-${new Date().toISOString().replaceAll(":", "-")}`);
const markets = args["markets-file"] ? await readMarketsFile(path.resolve(String(args["markets-file"]))) : [];
const outRoot = path.resolve(args.out ?? path.join(dataRoot, "replay", "raw", mode, new Date().toISOString().slice(0, 10)));
const gitCommit = await gitCommitMaybe();
const durationSeconds = Math.max(1, Math.min(900, Number(args["duration-seconds"] ?? args.duration ?? 30)));
const channels = uniqueStrings(String(args.channels ?? defaultKalshiReplayChannels.join(",")).split(","));
const useYesPrice = args["use-yes-price"] === undefined ? true : String(args["use-yes-price"]).toLowerCase() !== "false";

if (args["mock-input"]) {
  const inputPath = path.resolve(String(args["mock-input"]));
  const rows = await readRows(inputPath);
  const byMarket = new Map();
  for (const raw of rows) {
    const event = normalizeReplayRawEvent(raw, { provider, captureMode: mode, captureRunId, gitCommit });
    if (!event) continue;
    if (markets.length && !markets.includes(event.marketTicker)) continue;
    const marketRows = byMarket.get(event.marketTicker) ?? [];
    marketRows.push(event);
    byMarket.set(event.marketTicker, marketRows);
  }
  await mkdir(outRoot, { recursive: true });
  for (const [marketTicker, marketRows] of byMarket) {
    const marketDir = path.join(outRoot, safeSegment(marketTicker));
    await mkdir(marketDir, { recursive: true });
    await writeFile(path.join(marketDir, "part-0001.jsonl"), `${marketRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  }
  await writeManifest({ outRoot, markets, capturedMarkets: [...byMarket.keys()], provider, mode, captureRunId, gitCommit, mockInput: inputPath, channels, useYesPrice });
  console.log(`Replay capture mock ingest complete: ${[...byMarket.keys()].length} markets -> ${outRoot}`);
} else {
  await mkdir(outRoot, { recursive: true });
  if ((mode === "provider" || mode === "websocket" || mode === "live") && provider === "kalshi") {
    const result = await captureKalshiProviderReplay({
      outRoot,
      provider,
      mode,
      markets,
      channels,
      useYesPrice,
      captureRunId,
      gitCommit,
      durationSeconds,
    });
    await writeManifest({
      outRoot,
      markets,
      capturedMarkets: result.capturedMarkets,
      provider,
      mode,
      captureRunId,
      gitCommit,
      mockInput: null,
      unavailableReason: result.blocker?.reasonCode ?? null,
      blockerArtifact: result.blocker?.relativePath ?? null,
      channels,
      useYesPrice,
      websocketSessionId: result.websocketSessionId ?? null,
      rawMessageCount: result.rawMessageCount ?? 0,
      eventCount: result.eventCount ?? 0,
      durationSeconds,
    });
    if (result.eventCount > 0) console.log(`Replay provider capture complete: ${result.eventCount} events across ${result.capturedMarkets.length} markets -> ${outRoot}`);
    else {
      console.log(`Replay capture manifest written, but no replay-grade provider events were captured.`);
      console.log(`Blocker: ${result.blocker?.reasonCode ?? "provider_websocket_no_replay_events"}`);
    }
  } else {
    const providerBlocker = await providerCaptureBlocker({ outRoot, provider, mode, markets, channels, useYesPrice });
    await writeManifest({
      outRoot,
      markets,
      capturedMarkets: [],
      provider,
      mode,
      captureRunId,
      gitCommit,
      mockInput: null,
      unavailableReason: providerBlocker?.reasonCode ?? (mode === "websocket"
        ? "provider_websocket_capture_not_configured_in_local_environment"
        : "provider_polling_capture_not_configured_in_local_environment"),
      blockerArtifact: providerBlocker?.relativePath ?? null,
      channels,
      useYesPrice,
      durationSeconds,
    });
    console.log(`Replay capture manifest written, but no provider capture ran in this environment.`);
    console.log(`Use --mock-input <jsonl> for offline fixture ingest or configure provider credentials/adapters.`);
  }
}

async function writeManifest({
  outRoot,
  markets,
  capturedMarkets,
  provider,
  mode,
  captureRunId,
  gitCommit,
  mockInput,
  unavailableReason = null,
  blockerArtifact = null,
  channels = defaultKalshiReplayChannels,
  useYesPrice = true,
  websocketSessionId = null,
  rawMessageCount = 0,
  eventCount = 0,
  durationSeconds = null,
}) {
  const replayGradeIntended = mode === "websocket" || mode === "provider" || mode === "live";
  const manifest = {
    schemaVersion: "dogeedge.replay-capture-run.v1",
    generatedAt: new Date().toISOString(),
    provider,
    captureMode: mode,
    captureRunId,
    gitCommit,
    marketCount: markets.length,
    capturedMarketCount: capturedMarkets.length,
    markets,
    capturedMarkets,
    replayGradeIntended,
    fallbackKind: replayGradeIntended ? "absent" : "polling_diagnostic_only",
    executionSensitivePromotionAllowed: false,
    canPlaceOrders: false,
    channels,
    useYesPrice,
    priceScale: useYesPrice ? "yes_leg" : "provider_default",
    websocketSessionId,
    rawMessageCount,
    eventCount,
    durationSeconds,
    mockInput,
    unavailableReason,
    blockerArtifact,
  };
  await writeFile(path.join(outRoot, "capture-run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function providerCaptureBlocker({ outRoot, provider, mode, markets, channels = defaultKalshiReplayChannels, useYesPrice = true, reasonCode = null, details = {} }) {
  if (!(mode === "provider" || mode === "websocket" || mode === "live")) return null;
  const auth = kalshiAuthFromEnv(process.env);
  const wsUrl = process.env.KALSHI_WS_URL ?? defaultKalshiWsUrl;
  const artifactName = auth.ok ? "replay_provider_capture_blocked.json" : "replay_auth_blocked.json";
  const finalReasonCode = reasonCode ?? (auth.ok ? "provider_websocket_no_replay_events" : auth.reason);
  const artifact = {
    schemaVersion: "dogeedge.replay-provider-blocker.v1",
    generatedAt: new Date().toISOString(),
    provider,
    mode,
    wsUrl,
    marketCount: markets.length,
    markets,
    authMaterialPresent: auth.ok,
    keyIdPresent: Boolean(auth.keyId),
    privateKeyPresent: Boolean(auth.privateKeyPem),
    reasonCode: finalReasonCode,
    channels,
    useYesPrice,
    priceScale: useYesPrice ? "yes_leg" : "provider_default",
    requiredChannels: ["orderbook_delta", "trade", "market_lifecycle_v2"],
    requiredReplayGradeEvents: ["orderbook_snapshot", "orderbook_delta"],
    replayGradeAvailable: false,
    executionSensitivePromotionAllowed: false,
    canPlaceOrders: false,
    ...details,
  };
  await writeFile(path.join(outRoot, artifactName), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return { relativePath: artifactName, reasonCode: finalReasonCode };
}

async function captureKalshiProviderReplay({ outRoot, provider, mode, markets, channels, useYesPrice, captureRunId, gitCommit, durationSeconds }) {
  const auth = kalshiAuthFromEnv(process.env);
  if (!auth.ok) {
    return { capturedMarkets: [], eventCount: 0, rawMessageCount: 0, blocker: await providerCaptureBlocker({ outRoot, provider, mode, markets, channels, useYesPrice }) };
  }
  if (!markets.length) {
    return {
      capturedMarkets: [],
      eventCount: 0,
      rawMessageCount: 0,
      blocker: await providerCaptureBlocker({
        outRoot,
        provider,
        mode,
        markets,
        channels,
        useYesPrice,
        reasonCode: "target_market_set_absent",
      }),
    };
  }
  const wsUrl = process.env.KALSHI_WS_URL ?? defaultKalshiWsUrl;
  const wsSessionId = `kalshi-ws-${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomBytes(4).toString("hex")}`;
  const rawMessagesPath = path.join(outRoot, "raw-websocket-messages.jsonl");
  const state = {
    rawMessages: [],
    eventsByMarket: new Map(),
    errors: [],
    localSeq: 0,
  };
  let socket = null;
  try {
    socket = await openKalshiWebSocket({ wsUrl, keyId: auth.keyId, privateKeyPem: auth.privateKeyPem, timeoutMs: 10_000 });
    const subscription = kalshiReplaySubscription({ marketTickers: markets, channels, useYesPrice, requestId: 1 });
    await captureWebSocketMessages({
      socket,
      subscription,
      durationMs: durationSeconds * 1000,
      onRawMessage: (raw) => {
        state.rawMessages.push({ receivedAt: new Date().toISOString(), raw });
        state.localSeq += 1;
        const event = normalizeKalshiWsReplayMessage(raw, {
          provider,
          receiveTs: new Date().toISOString(),
          receiveMonotonicNs: safeHrtimeNs(),
          wsSessionId,
          captureRunId,
          gitCommit,
          sourceFileOrdinal: state.localSeq,
          useYesPrice,
        });
        if (!event) return;
        const marketRows = state.eventsByMarket.get(event.marketTicker) ?? [];
        marketRows.push(event);
        state.eventsByMarket.set(event.marketTicker, marketRows);
      },
      onError: (error) => state.errors.push(error instanceof Error ? error.message : String(error)),
    });
  } catch (error) {
    return {
      capturedMarkets: [],
      eventCount: 0,
      rawMessageCount: state.rawMessages.length,
      websocketSessionId: wsSessionId,
      blocker: await providerCaptureBlocker({
        outRoot,
        provider,
        mode,
        markets,
        channels,
        useYesPrice,
        reasonCode: "provider_websocket_capture_failed",
        details: { wsUrl, errors: [error instanceof Error ? error.message : String(error), ...state.errors] },
      }),
    };
  } finally {
    if (socket) socket.destroy();
  }

  await writeFile(rawMessagesPath, `${state.rawMessages.map((row) => JSON.stringify(row)).join("\n")}${state.rawMessages.length ? "\n" : ""}`, "utf8");
  for (const [marketTicker, marketRows] of state.eventsByMarket) {
    const marketDir = path.join(outRoot, safeSegment(marketTicker));
    await mkdir(marketDir, { recursive: true });
    await writeFile(path.join(marketDir, "part-0001.jsonl"), `${marketRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  }
  const capturedMarkets = [...state.eventsByMarket.keys()].sort();
  const eventCount = [...state.eventsByMarket.values()].reduce((total, rows) => total + rows.length, 0);
  const observedTypes = [...new Set(state.rawMessages.map((row) => row.raw?.type).filter(Boolean))].sort();
  if (eventCount === 0) {
    return {
      capturedMarkets,
      eventCount,
      rawMessageCount: state.rawMessages.length,
      websocketSessionId: wsSessionId,
      blocker: await providerCaptureBlocker({
        outRoot,
        provider,
        mode,
        markets,
        channels,
        useYesPrice,
        reasonCode: state.rawMessages.length ? "provider_websocket_no_target_replay_events" : "provider_websocket_no_messages",
        details: { wsUrl, observedTypes, errors: state.errors },
      }),
    };
  }
  await writeFile(path.join(outRoot, "capture-session-report.json"), `${JSON.stringify({
    schemaVersion: "dogeedge.replay-capture-session.v1",
    generatedAt: new Date().toISOString(),
    wsUrl,
    wsSessionId,
    marketCount: markets.length,
    capturedMarketCount: capturedMarkets.length,
    rawMessageCount: state.rawMessages.length,
    eventCount,
    channels,
    useYesPrice,
    priceScale: useYesPrice ? "yes_leg" : "provider_default",
    observedTypes,
    errors: state.errors,
    canPlaceOrders: false,
  }, null, 2)}\n`, "utf8");
  return { capturedMarkets, eventCount, rawMessageCount: state.rawMessages.length, websocketSessionId: wsSessionId, blocker: null };
}

async function openKalshiWebSocket({ wsUrl, keyId, privateKeyPem, timeoutMs }) {
  const url = new URL(wsUrl);
  const pathWithQuery = `${url.pathname}${url.search}`;
  const timestamp = String(Date.now());
  const authHeaders = kalshiWsAuthHeaders({ keyId, privateKeyPem, timestamp, requestPath: url.pathname });
  if (!authHeaders.ok) throw new Error(authHeaders.reason);
  const websocketKey = crypto.randomBytes(16).toString("base64");
  const headers = [
    `GET ${pathWithQuery} HTTP/1.1`,
    `Host: ${url.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${websocketKey}`,
    "Sec-WebSocket-Version: 13",
    `KALSHI-ACCESS-KEY: ${authHeaders.keyId}`,
    `KALSHI-ACCESS-SIGNATURE: ${authHeaders.signature}`,
    `KALSHI-ACCESS-TIMESTAMP: ${authHeaders.timestamp}`,
    "User-Agent: DogeEdge/0.1",
    "",
    "",
  ].join("\r\n");
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname });
    let data = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("websocket_handshake_timeout"));
    }, timeoutMs);
    socket.on("secureConnect", () => socket.write(headers));
    socket.on("data", function onHandshakeData(chunk) {
      data = Buffer.concat([data, chunk]);
      const marker = data.indexOf("\r\n\r\n");
      if (marker < 0) return;
      clearTimeout(timer);
      socket.off("data", onHandshakeData);
      const head = data.subarray(0, marker + 4).toString("utf8");
      const statusLine = head.split(/\r?\n/, 1)[0] ?? "";
      const status = Number(statusLine.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1] ?? 0);
      if (status !== 101) {
        socket.destroy();
        reject(new Error(`websocket_upgrade_failed_http_${status}`));
        return;
      }
      const remainder = data.subarray(marker + 4);
      if (remainder.length) socket.unshift(remainder);
      resolve(socket);
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function captureWebSocketMessages({ socket, subscription, durationMs, onRawMessage, onError }) {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      try {
        socket.write(encodeClientWebSocketFrame(Buffer.alloc(0), { opcode: 8 }));
      } catch {
        // Ignore close-frame failures; capture artifacts remain fail-closed.
      }
      socket.end();
      resolve();
    };
    const timer = setTimeout(finish, durationMs);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let decoded;
      try {
        decoded = decodeServerWebSocketFrames(buffer);
      } catch (error) {
        onError(error);
        finish();
        return;
      }
      buffer = decoded.remaining;
      for (const frame of decoded.frames) {
        if (frame.opcode === 0x9) {
          socket.write(encodeClientWebSocketFrame(frame.payload, { opcode: 0xA }));
          continue;
        }
        if (frame.opcode === 0x8) {
          finish();
          continue;
        }
        if (frame.opcode !== 0x1) continue;
        const text = frame.payload.toString("utf8");
        try {
          onRawMessage(JSON.parse(text));
        } catch (error) {
          onError(error);
        }
      }
    });
    socket.on("error", (error) => {
      onError(error);
      finish();
    });
    socket.on("close", finish);
    socket.write(encodeClientWebSocketFrame(JSON.stringify(subscription)));
  });
}

async function readRows(filePath) {
  const text = await readFile(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed.rows) ? parsed.rows : [parsed];
  }
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

async function readMarketsFile(filePath) {
  const text = await readFile(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return uniqueStrings(targetMarketValues(parsed, { preferActive: true }));
  }
  return uniqueStrings(text.split(/\r?\n|,/));
}

function targetMarketValues(parsed, { preferActive = false } = {}) {
  if (Array.isArray(parsed)) return parsed.map(tickerFromTarget).filter(Boolean);
  if (!parsed || typeof parsed !== "object") return [];
  const primary = preferActive && Array.isArray(parsed.activeTargets) ? parsed.activeTargets : [];
  if (primary.length) return primary.map(tickerFromTarget).filter(Boolean);
  const fallback = [
    ...(Array.isArray(parsed.targets) ? parsed.targets : []),
    ...(Array.isArray(parsed.markets) ? parsed.markets : []),
    ...(Array.isArray(parsed.tickers) ? parsed.tickers : []),
    ...(!preferActive && Array.isArray(parsed.closedTargets) ? parsed.closedTargets : []),
    ...(preferActive && Array.isArray(parsed.closedTargets) ? parsed.closedTargets : []),
  ];
  return [...primary, ...fallback].map(tickerFromTarget).filter(Boolean);
}

function tickerFromTarget(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  return value.marketTicker ?? value.ticker ?? value.id ?? null;
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "_");
}

function safeHrtimeNs() {
  try {
    return process.hrtime.bigint().toString();
  } catch {
    return null;
  }
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))].sort();
}

function kalshiAuthFromEnv(env) {
  const keyId = stringOrNull(env.KALSHI_API_KEY_ID);
  const privateKeyPem = normalizePrivateKey(env.KALSHI_PRIVATE_KEY_PEM);
  if (!keyId || !privateKeyPem) return { ok: false, keyId, privateKeyPem, reason: "KALSHI_API_KEY_ID_or_KALSHI_PRIVATE_KEY_PEM_missing" };
  try {
    crypto.createPrivateKey(privateKeyPem);
    return { ok: true, keyId, privateKeyPem };
  } catch {
    return { ok: false, keyId, privateKeyPem, reason: "kalshi_private_key_not_parseable" };
  }
}

function normalizePrivateKey(value) {
  if (!value) return null;
  return String(value).replace(/\\n/g, "\n");
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

async function gitCommitMaybe() {
  try {
    const head = await readFile(path.join(repoRoot, ".git", "HEAD"), "utf8");
    if (head.startsWith("ref:")) return (await readFile(path.join(repoRoot, ".git", head.slice(5).trim()), "utf8")).trim();
    return head.trim();
  } catch {
    return "UNAVAILABLE";
  }
}

async function defaultDataRoot() {
  if (process.platform === "win32") {
    try {
      await access("D:\\");
      return "D:\\DogeEdge\\data";
    } catch {
      // Fall back to repo-local data.
    }
  }
  return path.join(repoRoot, "data");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
