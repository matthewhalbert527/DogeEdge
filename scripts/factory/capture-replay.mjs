import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { normalizeReplayRawEvent } from "./raw-tick-extract.mjs";
import {
  defaultKalshiReplayChannels,
  defaultKalshiReplayWsUrl,
  kalshiReplaySubscription,
  normalizeKalshiWsReplayMessage,
} from "./kalshi-ws-replay.mjs";
import { loadKalshiWsCredentials, redactedCredentialReport } from "./kalshi-ws-auth.mjs";
import { captureWebSocketMessages, openKalshiWebSocket } from "./kalshi-ws-client.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);
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
    const event = normalizeReplayRawEvent(raw, { provider, captureMode: mode, captureRunId, gitCommit, useYesPrice });
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
  subscriptionAcknowledged: result.subscriptionAcknowledged ?? false,
  initialOrderbookSnapshotReceived: result.initialOrderbookSnapshotReceived ?? false,
  orderbookDeltaCount: result.orderbookDeltaCount ?? 0,
  tradeCount: result.tradeCount ?? 0,
  durationSeconds,
      rawMessagesFile: result.rawMessagesFile ?? null,
      eventPartFile: result.eventPartFile ?? null,
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
  rawMessagesFile = null,
  eventPartFile = null,
  subscriptionAcknowledged = false,
  initialOrderbookSnapshotReceived = false,
  orderbookDeltaCount = 0,
  tradeCount = 0,
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
    rawMessagesFile,
    eventPartFile,
    authenticatedConnection: Boolean(websocketSessionId && !unavailableReason),
    subscriptionAcknowledged: Boolean(subscriptionAcknowledged),
    initialOrderbookSnapshotReceived: Boolean(initialOrderbookSnapshotReceived),
    orderbookDeltaCount: Number(orderbookDeltaCount ?? 0),
    tradeCount: Number(tradeCount ?? 0),
    mockInput,
    unavailableReason,
    blockerArtifact,
  };
  await writeFile(path.join(outRoot, "capture-run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function providerCaptureBlocker({ outRoot, provider, mode, markets, channels = defaultKalshiReplayChannels, useYesPrice = true, reasonCode = null, details = {} }) {
  if (!(mode === "provider" || mode === "websocket" || mode === "live")) return null;
  const auth = await loadKalshiWsCredentials(process.env);
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
    credentials: redactedCredentialReport(auth),
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
  const auth = await loadKalshiWsCredentials(process.env);
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
  const runSegment = safeSegment(captureRunId);
  const rawMessagesFile = `raw-websocket-messages-${runSegment}.jsonl`;
  const eventPartFile = `part-${runSegment}.jsonl`;
  const rawMessagesPath = path.join(outRoot, rawMessagesFile);
  const state = {
    rawMessages: [],
    eventsByMarket: new Map(),
    errors: [],
    localSeq: 0,
    ignoredNonTargetEventCount: 0,
    ignoredNonTargetMarkets: new Set(),
    authenticatedConnection: false,
    subscriptionAcknowledged: false,
    initialOrderbookSnapshotReceived: false,
    orderbookDeltaCount: 0,
    tradeCount: 0,
    lifecycleCount: 0,
    rawTypeCounts: {},
  };
  const targetMarketSet = new Set(markets);
  const streams = [];
  const rawStream = createJsonlStream(rawMessagesPath, streams, state);
  const marketStreams = new Map();
  for (const marketTicker of markets) {
    const marketDir = path.join(outRoot, safeSegment(marketTicker));
    await mkdir(marketDir, { recursive: true });
    marketStreams.set(marketTicker, createJsonlStream(path.join(marketDir, eventPartFile), streams, state));
  }
  let socket = null;
  try {
    socket = await openKalshiWebSocket({ wsUrl, keyId: auth.keyId, privateKeyPem: auth.privateKeyPem, timeoutMs: 10_000 });
    state.authenticatedConnection = true;
    const subscription = kalshiReplaySubscription({ marketTickers: markets, channels, useYesPrice, requestId: 1 });
    await captureWebSocketMessages({
      socket,
      subscription,
      durationMs: durationSeconds * 1000,
      onRawMessage: (raw) => {
        state.localSeq += 1;
        const receiveTs = new Date().toISOString();
        const rawType = rawTypeText(raw);
        state.rawTypeCounts[rawType] = (state.rawTypeCounts[rawType] ?? 0) + 1;
        if (isSubscriptionAck(raw)) state.subscriptionAcknowledged = true;
        const event = normalizeKalshiWsReplayMessage(raw, {
          provider,
          receiveTs,
          receiveMonotonicNs: safeHrtimeNs(),
          wsSessionId,
          captureRunId,
          gitCommit,
          sourceFileOrdinal: state.localSeq,
          useYesPrice,
        });
        if (event && !shouldCaptureReplayEvent(event, targetMarketSet)) {
          state.ignoredNonTargetEventCount += 1;
          state.ignoredNonTargetMarkets.add(event.marketTicker);
          return;
        }
        const rawRow = { receivedAt: receiveTs, raw };
        state.rawMessages.push(rawRow);
        writeJsonl(rawStream, rawRow, state);
        if (!event) return;
        if (event.channel === "orderbook" && event.messageType === "snapshot") state.initialOrderbookSnapshotReceived = true;
        if (event.channel === "orderbook" && event.messageType === "delta") state.orderbookDeltaCount += 1;
        if (event.messageType === "trade") state.tradeCount += 1;
        if (event.channel === "lifecycle" || event.messageType === "status") state.lifecycleCount += 1;
        const marketRows = state.eventsByMarket.get(event.marketTicker) ?? [];
        marketRows.push(event);
        state.eventsByMarket.set(event.marketTicker, marketRows);
        const stream = marketStreams.get(event.marketTicker);
        if (stream) writeJsonl(stream, event, state);
      },
      onError: (error) => state.errors.push(error instanceof Error ? error.message : String(error)),
    });
  } catch (error) {
    await closeJsonlStreams(streams, state);
    return {
      capturedMarkets: [],
      eventCount: 0,
      rawMessageCount: state.rawMessages.length,
      websocketSessionId: wsSessionId,
      rawMessagesFile,
      eventPartFile,
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

  await closeJsonlStreams(streams, state);
  const capturedMarkets = [...state.eventsByMarket.keys()].sort();
  const eventCount = [...state.eventsByMarket.values()].reduce((total, rows) => total + rows.length, 0);
  const observedTypes = [...new Set(state.rawMessages.map((row) => row.raw?.type).filter(Boolean))].sort();
  const captureComplete = state.authenticatedConnection
    && state.subscriptionAcknowledged
    && state.initialOrderbookSnapshotReceived
    && eventCount > 0
    && (state.orderbookDeltaCount > 0 || state.tradeCount > 0);
  await writeSubscriptionHealth({
    outRoot,
    wsUrl,
    wsSessionId,
    markets,
    channels,
    useYesPrice,
    state,
    capturedMarkets,
    eventCount,
    captureComplete,
  });
  if (!captureComplete) {
    return {
      capturedMarkets,
      eventCount,
      rawMessageCount: state.rawMessages.length,
      websocketSessionId: wsSessionId,
      rawMessagesFile,
      eventPartFile,
      blocker: await providerCaptureBlocker({
        outRoot,
        provider,
        mode,
        markets,
        channels,
        useYesPrice,
        reasonCode: captureBlockerReason(state),
        details: {
          wsUrl,
          observedTypes,
          rawTypeCounts: state.rawTypeCounts,
          authenticatedConnection: state.authenticatedConnection,
          subscriptionAcknowledged: state.subscriptionAcknowledged,
          initialOrderbookSnapshotReceived: state.initialOrderbookSnapshotReceived,
          orderbookDeltaCount: state.orderbookDeltaCount,
          tradeCount: state.tradeCount,
          lifecycleCount: state.lifecycleCount,
          errors: state.errors,
          ignoredNonTargetEventCount: state.ignoredNonTargetEventCount,
          ignoredNonTargetMarketCount: state.ignoredNonTargetMarkets.size,
        },
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
    rawMessagesFile,
    eventPartFile,
    channels,
    useYesPrice,
    priceScale: useYesPrice ? "yes_leg" : "provider_default",
    authenticatedConnection: state.authenticatedConnection,
    subscriptionAcknowledged: state.subscriptionAcknowledged,
    initialOrderbookSnapshotReceived: state.initialOrderbookSnapshotReceived,
    captureComplete,
    orderbookDeltaCount: state.orderbookDeltaCount,
    tradeCount: state.tradeCount,
    lifecycleCount: state.lifecycleCount,
    rawTypeCounts: state.rawTypeCounts,
    observedTypes,
    ignoredNonTargetEventCount: state.ignoredNonTargetEventCount,
    ignoredNonTargetMarketCount: state.ignoredNonTargetMarkets.size,
    errors: state.errors,
    canPlaceOrders: false,
  }, null, 2)}\n`, "utf8");
  return {
    capturedMarkets,
    eventCount,
    rawMessageCount: state.rawMessages.length,
    websocketSessionId: wsSessionId,
    rawMessagesFile,
    eventPartFile,
    subscriptionAcknowledged: state.subscriptionAcknowledged,
    initialOrderbookSnapshotReceived: state.initialOrderbookSnapshotReceived,
    orderbookDeltaCount: state.orderbookDeltaCount,
    tradeCount: state.tradeCount,
    blocker: null,
  };
}

async function writeSubscriptionHealth({ outRoot, wsUrl, wsSessionId, markets, channels, useYesPrice, state, capturedMarkets, eventCount, captureComplete }) {
  const report = {
    schemaVersion: "dogeedge.kalshi-subscription-health.v1",
    generatedAt: new Date().toISOString(),
    wsUrl,
    wsSessionId,
    targetMarkets: markets,
    capturedMarkets,
    channels,
    useYesPrice,
    priceScale: useYesPrice ? "yes_leg" : "provider_default",
    authenticatedConnection: state.authenticatedConnection,
    subscriptionAcknowledged: state.subscriptionAcknowledged,
    initialOrderbookSnapshotReceived: state.initialOrderbookSnapshotReceived,
    rawMessagesWritten: state.rawMessages.length,
    rawEventsWritten: eventCount,
    orderbookDeltaCount: state.orderbookDeltaCount,
    tradeCount: state.tradeCount,
    lifecycleCount: state.lifecycleCount,
    ignoredNonTargetEventCount: state.ignoredNonTargetEventCount,
    ignoredNonTargetMarketCount: state.ignoredNonTargetMarkets.size,
    captureComplete,
    replayGradeCandidate: captureComplete,
    canPlaceOrders: false,
    reasonCodes: [
      ...(!state.authenticatedConnection ? ["websocket_authentication_missing"] : []),
      ...(!state.subscriptionAcknowledged ? ["subscription_acknowledgement_missing"] : []),
      ...(!state.initialOrderbookSnapshotReceived ? ["initial_orderbook_snapshot_missing"] : []),
      ...(eventCount <= 0 ? ["raw_events_absent"] : []),
      ...(state.orderbookDeltaCount <= 0 && state.tradeCount <= 0 ? ["market_inactive_no_delta_or_trade"] : []),
    ],
    rawTypeCounts: state.rawTypeCounts,
    errors: state.errors,
  };
  await writeFile(path.join(outRoot, "subscription_health.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function captureBlockerReason(state) {
  if (!state.rawMessages.length) return "provider_websocket_no_messages";
  if (!state.subscriptionAcknowledged) return "provider_subscription_acknowledgement_missing";
  if (!state.initialOrderbookSnapshotReceived) return "provider_initial_orderbook_snapshot_missing";
  if (state.orderbookDeltaCount <= 0 && state.tradeCount <= 0) return "provider_market_inactive_no_delta_or_trade";
  return "provider_websocket_no_target_replay_events";
}

function rawTypeText(raw) {
  const type = raw?.type ?? raw?.message_type ?? raw?.msg?.type ?? raw?.message?.type ?? "unknown";
  return String(type).toLowerCase();
}

function isSubscriptionAck(raw) {
  const text = rawTypeText(raw);
  return text === "subscribed" || text === "subscription_ack" || text === "subscribed_to_channel" || text === "ok";
}

function createJsonlStream(filePath, streams, state) {
  try {
    const stream = { fd: openSync(filePath, "w"), closed: false, bytesSinceSync: 0, lastSyncMs: Date.now() };
    streams.push(stream);
    return stream;
  } catch (error) {
    state.errors.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}

function writeJsonl(stream, row, state) {
  if (!stream || stream.closed) return;
  try {
    const line = `${JSON.stringify(row)}\n`;
    writeSync(stream.fd, line, null, "utf8");
    stream.bytesSinceSync += Buffer.byteLength(line);
    maybeSyncJsonlStream(stream, state);
  } catch (error) {
    state.errors.push(error instanceof Error ? error.message : String(error));
  }
}

function maybeSyncJsonlStream(stream, state, { force = false } = {}) {
  if (!stream || stream.closed) return;
  const nowMs = Date.now();
  if (!force && stream.bytesSinceSync < 256 * 1024 && nowMs - stream.lastSyncMs < 1_000) return;
  try {
    fsyncSync(stream.fd);
    stream.bytesSinceSync = 0;
    stream.lastSyncMs = nowMs;
  } catch (error) {
    state.errors.push(error instanceof Error ? error.message : String(error));
  }
}

async function closeJsonlStreams(streams, state) {
  for (const stream of streams) {
    try {
      if (!stream.closed) {
        maybeSyncJsonlStream(stream, state, { force: true });
        closeSync(stream.fd);
        stream.closed = true;
      }
    } catch (error) {
      state.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

async function readRows(filePath) {
  const text = stripBom(await readFile(filePath, "utf8"));
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed.rows) ? parsed.rows : [parsed];
  }
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

async function readMarketsFile(filePath) {
  const text = stripBom(await readFile(filePath, "utf8"));
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return uniqueStrings(targetMarketValues(parsed, { preferActive: true }));
  }
  return uniqueStrings(text.split(/\r?\n|,/));
}

function targetMarketValues(parsed, { preferActive = false } = {}) {
  if (Array.isArray(parsed)) return parsed.map(tickerFromTarget).filter(Boolean);
  if (!parsed || typeof parsed !== "object") return [];
  const scalarTargets = [parsed.targetMarket, parsed.marketTicker, parsed.ticker].filter((value) => typeof value === "string");
  if (scalarTargets.length) return scalarTargets;
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

export function shouldCaptureReplayEvent(event, targetMarketSet) {
  if (!event) return true;
  if (!(targetMarketSet instanceof Set) || targetMarketSet.size === 0) return true;
  return targetMarketSet.has(event.marketTicker);
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

async function gitCommitMaybe() {
  for (const gitBinary of gitCandidates()) {
    try {
      const { stdout } = await execFileAsync(gitBinary, ["-C", repoRoot, "rev-parse", "HEAD"], { windowsHide: true });
      return stdout.trim();
    } catch {
      // Try the next common Git location.
    }
  }
  return "UNAVAILABLE";
}

function gitCandidates() {
  if (process.platform !== "win32") return ["git"];
  return [
    "git",
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
  ];
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

function stripBom(value) {
  return String(value ?? "").replace(/^\uFEFF/, "");
}
