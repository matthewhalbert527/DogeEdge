import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeReplayRawEvent } from "./raw-tick-extract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultKalshiWsUrl = "wss://external-api-ws.kalshi.com/trade-api/ws/v2";
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("Usage: node scripts/factory/capture-replay.mjs --markets-file file [--provider kalshi] [--mode provider|websocket|polling|live] [--mock-input file] [--data-root dir] [--out dir] [--capture-run-id id]");
  process.exit(0);
}
const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
const provider = String(args.provider ?? "kalshi");
const mode = String(args.mode ?? "websocket");
const captureRunId = String(args["capture-run-id"] ?? `capture-${new Date().toISOString().replaceAll(":", "-")}`);
const markets = args["markets-file"] ? await readMarketsFile(path.resolve(String(args["markets-file"]))) : [];
const outRoot = path.resolve(args.out ?? path.join(dataRoot, "replay", "raw", mode, new Date().toISOString().slice(0, 10)));
const gitCommit = await gitCommitMaybe();

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
  await writeManifest({ outRoot, markets, capturedMarkets: [...byMarket.keys()], provider, mode, captureRunId, gitCommit, mockInput: inputPath });
  console.log(`Replay capture mock ingest complete: ${[...byMarket.keys()].length} markets -> ${outRoot}`);
} else {
  await mkdir(outRoot, { recursive: true });
  const providerBlocker = await providerCaptureBlocker({ outRoot, provider, mode, markets });
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
  });
  console.log(`Replay capture manifest written, but no provider capture ran in this environment.`);
  console.log(`Use --mock-input <jsonl> for offline fixture ingest or configure provider credentials/adapters.`);
}

async function writeManifest({ outRoot, markets, capturedMarkets, provider, mode, captureRunId, gitCommit, mockInput, unavailableReason = null, blockerArtifact = null }) {
  const replayGradeIntended = mode === "websocket" || mode === "provider";
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
    mockInput,
    unavailableReason,
    blockerArtifact,
  };
  await writeFile(path.join(outRoot, "capture-run-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function providerCaptureBlocker({ outRoot, provider, mode, markets }) {
  if (!(mode === "provider" || mode === "websocket")) return null;
  const auth = kalshiAuthFromEnv(process.env);
  const wsUrl = process.env.KALSHI_WS_URL ?? defaultKalshiWsUrl;
  const artifactName = auth.ok ? "replay_provider_capture_blocked.json" : "replay_auth_blocked.json";
  const reasonCode = auth.ok ? "provider_websocket_capture_adapter_not_implemented" : auth.reason;
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
    reasonCode,
    requiredChannels: ["orderbook_delta", "trade", "market_lifecycle_v2"],
    requiredReplayGradeEvents: ["orderbook_snapshot", "orderbook_delta"],
    replayGradeAvailable: false,
    executionSensitivePromotionAllowed: false,
    canPlaceOrders: false,
  };
  await writeFile(path.join(outRoot, artifactName), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return { relativePath: artifactName, reasonCode };
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
