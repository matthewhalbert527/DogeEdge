import crypto from "node:crypto";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { selectEvidenceProbes } from "./evidence-lane.mjs";
import { defaultKalshiHistoricalBaseUrl, kalshiHistoricalMarketsUrl } from "./official-settlement.mjs";
import { selectTargetMarkets, writeTargetMarketSelection } from "./target-markets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultKalshiWsUrl = "wss://api.elections.kalshi.com/trade-api/ws/v2";

export async function runEvidencePreflight(options = {}) {
  const generatedAt = new Date().toISOString();
  const dataRoot = path.resolve(options.dataRoot ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const storageDir = path.resolve(options.storageDir ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
  const outDir = path.resolve(options.out ?? "artifacts/evidence-preflight");
  const online = options.online === true || options.online === "true";
  const mockMode = options.mock === true || options["mock-input"] || options.mockSettlements || options.mockReplayRaw;
  const checks = [];
  const addCheck = (name, status, details = {}) => checks.push({ name, status, ...details });

  const moduleChecks = await expectedModuleChecks();
  for (const row of moduleChecks) addCheck(row.name, row.present ? "ok" : "blocked", { path: row.path, reason: row.present ? null : "missing_expected_evidence_plane_module" });

  const writableDirs = [
    dataRoot,
    path.join(dataRoot, "replay"),
    path.join(dataRoot, "local-worker"),
    path.join(outDir),
    path.resolve("artifacts/evidence"),
  ];
  for (const dir of writableDirs) {
    const ok = await ensureWritableDir(dir);
    addCheck(`writable:${dir}`, ok ? "ok" : "blocked", { path: dir, reason: ok ? null : "directory_not_writable" });
  }

  const auth = kalshiAuthFromEnv(process.env);
  addCheck("kalshi_auth_material", auth.ok ? "ok" : "blocked", {
    keyIdPresent: Boolean(auth.keyId),
    privateKeyPresent: Boolean(auth.privateKeyPem),
    reason: auth.ok ? null : auth.reason,
  });

  const branch = await gitBranchMaybe();
  addCheck("git_branch_contains_evidence_plane", branch.includes("evidence-plane") || moduleChecks.every((row) => row.present) ? "ok" : "blocked", { branch });

  let targetSelection = null;
  try {
    const targetMarketsFile = options.targetMarketsFile ?? options["target-markets-file"];
    targetSelection = targetMarketsFile
      ? await targetSelectionFromFile(path.resolve(String(targetMarketsFile)), {
        dataRoot,
        storageDir,
        mockSettlements: Boolean(options.mockSettlements ?? options["mock-settlements"]),
        mockReplayRaw: Boolean(options.mockReplayRaw ?? options["mock-replay-raw"]),
      })
      : await selectTargetMarkets({
        dataRoot,
        storageDir,
        maxClosedTargets: options.maxClosedTargets ?? options["max-closed"],
        maxActiveTargets: options.maxActiveTargets ?? options["max-active"],
        activeHorizonMinutes: options.activeHorizonMinutes ?? options["active-horizon-minutes"],
      });
    await writeTargetMarketSelection(targetSelection, path.join(outDir, "target-markets"));
    addCheck("target_market_selection", targetSelection.closedTargetCount > 0 || targetSelection.activeTargetCount > 0 ? "ok" : "blocked", {
      closedTargetCount: targetSelection.closedTargetCount,
      activeTargetCount: targetSelection.activeTargetCount,
      reason: targetSelection.closedTargetCount || targetSelection.activeTargetCount ? null : "target_markets_absent",
    });
  } catch (error) {
    addCheck("target_market_selection", "blocked", { reason: errorMessage(error) });
  }

  const seed = await seedCompleteness(dataRoot, options);
  addCheck("seed_metadata", seed.seedCompleteness >= 1 ? "ok" : "blocked", seed);

  const probes = await probeReadiness(dataRoot, options);
  addCheck("exact_linked_probe_candidates", probes.qualifyingProbeCount > 0 ? "ok" : "blocked", probes);

  if (online) {
    const rest = await historicalRestSmoke(options);
    addCheck("kalshi_historical_rest", rest.ok ? "ok" : "blocked", rest);
    const clock = await clockSkewCheck(options);
    addCheck("provider_clock_skew", clock.ok ? "ok" : "blocked", clock);
    const ws = auth.ok ? await kalshiWsHandshakeSmoke({ ...options, ...auth }) : { ok: false, reason: auth.reason };
    addCheck("kalshi_signed_websocket_handshake", ws.ok ? "ok" : "blocked", ws);
  } else {
    addCheck("kalshi_historical_rest", mockMode ? "skipped" : "blocked", { reason: mockMode ? "offline_mock_mode" : "online_check_not_requested" });
    addCheck("provider_clock_skew", "skipped", { reason: "online_check_not_requested" });
    addCheck("kalshi_signed_websocket_handshake", mockMode ? "skipped" : "blocked", { reason: mockMode ? "offline_mock_mode" : "online_check_not_requested" });
  }

  const canProduce = {
    officialSettlementRows: Boolean(targetSelection?.closedTargetCount || options.mockSettlements || options["mock-settlements"]),
    replayRawFiles: Boolean(targetSelection?.activeTargetCount || options.mockReplayRaw || options["mock-replay-raw"]),
    exactLinkedProbes: probes.qualifyingProbeCount > 0,
  };
  addCheck("evidence_outputs_possible", Object.values(canProduce).some(Boolean) ? "ok" : "blocked", canProduce);

  const blocked = checks.filter((check) => check.status === "blocked");
  const report = {
    schemaVersion: "dogeedge.evidence-preflight.v1",
    generatedAt,
    branch,
    dataRoot,
    storageDir,
    online,
    mockMode: Boolean(mockMode),
    failClosed: blocked.length > 0,
    readyForOnlineProviderCapture: online && checks.find((check) => check.name === "kalshi_signed_websocket_handshake")?.status === "ok",
    readyForOfflineBootstrap: Boolean(mockMode) && moduleChecks.every((row) => row.present),
    targetSelectionSummary: targetSelection ? {
      closedTargetCount: targetSelection.closedTargetCount,
      activeTargetCount: targetSelection.activeTargetCount,
      closedTickers: targetSelection.closedTickers.slice(0, 25),
      activeTickers: targetSelection.activeTickers.slice(0, 25),
    } : null,
    checks,
    blockerCount: blocked.length,
    blockers: blocked.map((check) => ({ name: check.name, reason: check.reason ?? "blocked" })),
    canPlaceOrders: false,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "report.md"), evidencePreflightMarkdown(report), "utf8");
  await writeEvidenceStatus({
    generatedAt,
    dataRoot,
    status: "preflight",
    preflight: report,
    targetSelection,
    evidenceOut: options.evidenceOut ?? options["evidence-out"],
  });
  return report;
}

async function expectedModuleChecks() {
  const modules = [
    "scripts/factory/provider-kalshi.mjs",
    "scripts/factory/fetch-official-settlements.mjs",
    "scripts/factory/capture-replay.mjs",
    "scripts/factory/build-replay-dataset.mjs",
    "scripts/factory/replay-coverage.mjs",
    "scripts/factory/backfill-linkage.mjs",
    "scripts/factory/evidence-lane.mjs",
    "scripts/factory/target-markets.mjs",
  ];
  return Promise.all(modules.map(async (relativePath) => {
    const fullPath = path.join(repoRoot, relativePath);
    try {
      await access(fullPath);
      return { name: `module:${relativePath}`, path: relativePath, present: true };
    } catch {
      return { name: `module:${relativePath}`, path: relativePath, present: false };
    }
  }));
}

async function probeReadiness(dataRoot, options) {
  const sourcePath = options.probeSource || options["probe-source"]
    ? path.resolve(String(options.probeSource ?? options["probe-source"]))
    : path.join(dataRoot, "backtests", "latest-sweep.json");
  const source = await readJsonMaybe(sourcePath) ?? {};
  const rows = [...(Array.isArray(source.candidates) ? source.candidates : []), ...(Array.isArray(source.topMetrics) ? source.topMetrics : [])];
  const selected = selectEvidenceProbes(rows, { maxProbes: Number(options.maxProbes ?? 5) });
  return {
    sourcePath,
    candidateRows: rows.length,
    qualifyingProbeCount: selected.selected.length,
    rejectedProbeCount: selected.rejected.length,
    firstRejectReason: selected.rejected[0]?.reasonCodes?.[0] ?? null,
  };
}

async function targetSelectionFromFile(filePath, { dataRoot, storageDir, mockSettlements, mockReplayRaw }) {
  const markets = await readMarketsFile(filePath);
  const targets = markets.map((marketTicker) => ({
    marketTicker,
    day: "",
    closeTime: null,
    family: "",
    researchCandidateId: "",
    candidateConfigHash: "",
    evidenceSources: ["target_markets_file"],
    priority: 100,
  }));
  const closedTargets = mockSettlements ? targets : [];
  const activeTargets = mockReplayRaw ? targets : [];
  return {
    schemaVersion: "dogeedge.target-markets.v1",
    generatedAt: new Date().toISOString(),
    dataRoot,
    storageDir,
    sourceFile: filePath,
    maxClosedTargets: closedTargets.length,
    maxActiveTargets: activeTargets.length,
    activeHorizonMinutes: null,
    closedTargets,
    activeTargets,
    closedTargetCount: closedTargets.length,
    activeTargetCount: activeTargets.length,
    closedTickers: closedTargets.map((row) => row.marketTicker),
    activeTickers: activeTargets.map((row) => row.marketTicker),
    reasonCodes: ["target_markets_file_override"],
  };
}

async function readMarketsFile(filePath) {
  const text = await readFile(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return uniqueStrings([
      ...(Array.isArray(parsed) ? parsed : []),
      ...(Array.isArray(parsed.markets) ? parsed.markets : []),
      ...(Array.isArray(parsed.tickers) ? parsed.tickers : []),
      ...(Array.isArray(parsed.closedTargets) ? parsed.closedTargets.map((row) => row?.marketTicker ?? row?.ticker ?? row) : []),
      ...(Array.isArray(parsed.activeTargets) ? parsed.activeTargets.map((row) => row?.marketTicker ?? row?.ticker ?? row) : []),
    ]);
  }
  return uniqueStrings(text.split(/\r?\n|,/));
}

async function seedCompleteness(dataRoot, options = {}) {
  const sourcePath = options.probeSource || options["probe-source"]
    ? path.resolve(String(options.probeSource ?? options["probe-source"]))
    : null;
  const latest = await readJsonMaybe(sourcePath)
    ?? await readJsonMaybe(path.join(dataRoot, "backtests", "latest-sweep.json"))
    ?? await readJsonMaybe(path.join(dataRoot, "backtests", "latest.json"))
    ?? {};
  const rows = [...(Array.isArray(latest.candidates) ? latest.candidates : []), ...(Array.isArray(latest.topMetrics) ? latest.topMetrics : [])];
  if (!rows.length) return { seedCompleteness: 0, seedRows: 0, totalRows: 0, reason: "research_rows_absent" };
  const runSeed = latest.seed ?? latest.randomSeed ?? latest.registry?.seed ?? latest.config?.seed;
  const complete = rows.filter((row) => row.seed || row.bootstrapSeed || row.reproducibility?.seed || runSeed).length;
  return { seedCompleteness: round(complete / rows.length), seedRows: complete, totalRows: rows.length };
}

async function historicalRestSmoke(options) {
  if (typeof fetch !== "function") return { ok: false, reason: "fetch_unavailable" };
  const baseUrl = options.baseUrl ?? options["base-url"] ?? defaultKalshiHistoricalBaseUrl;
  const url = kalshiHistoricalMarketsUrl({ baseUrl, limit: 1, status: "finalized" });
  try {
    const response = await fetch(url, { cache: "no-store" });
    return { ok: response.ok, status: response.status, url, reason: response.ok ? null : `http_${response.status}` };
  } catch (error) {
    return { ok: false, url, reason: errorMessage(error) };
  }
}

async function clockSkewCheck(options) {
  const baseUrl = options.baseUrl ?? options["base-url"] ?? defaultKalshiHistoricalBaseUrl;
  try {
    const response = await fetch(baseUrl, { method: "HEAD", cache: "no-store" });
    const dateHeader = response.headers.get("date");
    if (!dateHeader) return { ok: true, status: "date_header_absent", skewMs: null };
    const skewMs = Date.now() - Date.parse(dateHeader);
    return { ok: Math.abs(skewMs) <= 30_000, skewMs, thresholdMs: 30_000 };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

async function kalshiWsHandshakeSmoke({ wsUrl = process.env.KALSHI_WS_URL ?? defaultKalshiWsUrl, keyId, privateKeyPem, timeoutMs = 8000 } = {}) {
  try {
    const url = new URL(wsUrl);
    const timestamp = String(Date.now());
    const pathWithQuery = `${url.pathname}${url.search}`;
    const signature = signPss(privateKeyPem, `${timestamp}GET${url.pathname}`);
    const websocketKey = crypto.randomBytes(16).toString("base64");
    const headers = [
      `GET ${pathWithQuery} HTTP/1.1`,
      `Host: ${url.host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${websocketKey}`,
      "Sec-WebSocket-Version: 13",
      `KALSHI-ACCESS-KEY: ${keyId}`,
      `KALSHI-ACCESS-SIGNATURE: ${signature}`,
      `KALSHI-ACCESS-TIMESTAMP: ${timestamp}`,
      "User-Agent: DogeEdge/0.1",
      "",
      "",
    ].join("\r\n");
    const response = await rawTlsRequest({ host: url.hostname, port: Number(url.port || 443), payload: headers, timeoutMs });
    const statusLine = response.split(/\r?\n/, 1)[0] ?? "";
    const status = Number(statusLine.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1] ?? 0);
    return { ok: status === 101, status, wsUrl, statusLine, reason: status === 101 ? null : "websocket_upgrade_failed" };
  } catch (error) {
    return { ok: false, wsUrl, reason: errorMessage(error) };
  }
}

function rawTlsRequest({ host, port, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("websocket_handshake_timeout"));
    }, timeoutMs);
    socket.on("secureConnect", () => socket.write(payload));
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.includes("\r\n\r\n")) {
        clearTimeout(timer);
        socket.end();
        resolve(data);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
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

function signPss(privateKeyPem, text) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(text);
  signer.end();
  return signer.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

function normalizePrivateKey(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

async function writeEvidenceStatus({ generatedAt, dataRoot, status, preflight, targetSelection, evidenceOut }) {
  const outDir = path.resolve(evidenceOut ?? "artifacts/evidence");
  await mkdir(outDir, { recursive: true });
  const summary = {
    schemaVersion: "dogeedge.evidence-status.v1",
    generatedAt,
    status,
    preflightReady: preflight.failClosed === false,
    onlineProviderReady: preflight.readyForOnlineProviderCapture === true,
    offlineBootstrapReady: preflight.readyForOfflineBootstrap === true,
    closedTargetCount: targetSelection?.closedTargetCount ?? 0,
    activeTargetCount: targetSelection?.activeTargetCount ?? 0,
    blockerCount: preflight.blockerCount,
    blockers: preflight.blockers,
    nextStep: preflight.failClosed ? "resolve_preflight_blockers_or_run_with_mock_fixtures" : "run_factory_evidence_bootstrap",
    dataRoot,
    canPlaceOrders: false,
  };
  await writeFile(path.join(outDir, "evidence_status.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function evidencePreflightMarkdown(report) {
  return [
    "# DogeEdge Evidence Preflight",
    "",
    `Generated: ${report.generatedAt}`,
    `Branch: ${report.branch}`,
    `Fail closed: ${report.failClosed}`,
    `Online provider ready: ${report.readyForOnlineProviderCapture}`,
    `Offline bootstrap ready: ${report.readyForOfflineBootstrap}`,
    "",
    "## Targets",
    "",
    `Closed targets: ${report.targetSelectionSummary?.closedTargetCount ?? 0}`,
    `Active targets: ${report.targetSelectionSummary?.activeTargetCount ?? 0}`,
    "",
    "## Blockers",
    "",
    report.blockers.length ? report.blockers.map((row) => `- ${row.name}: ${row.reason}`).join("\n") : "- None.",
    "",
  ].join("\n");
}

async function ensureWritableDir(dir) {
  try {
    await mkdir(dir, { recursive: true });
    const probePath = path.join(dir, ".dogeedge-write-test");
    await writeFile(probePath, "ok\n", "utf8");
    await unlink(probePath).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function gitBranchMaybe() {
  try {
    const head = await readFile(path.join(repoRoot, ".git", "HEAD"), "utf8");
    if (head.startsWith("ref:")) return head.slice(5).trim().split("/").slice(2).join("/");
    return head.trim();
  } catch {
    return "UNKNOWN";
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))].sort();
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  runEvidencePreflight({
    ...args,
    online: Boolean(args.online),
    mock: Boolean(args.mock),
    mockSettlements: args["mock-settlements"],
    mockReplayRaw: args["mock-replay-raw"],
    targetMarketsFile: args["target-markets-file"],
    probeSource: args["probe-source"],
    evidenceOut: args["evidence-out"],
    dataRoot: args["data-root"],
    storageDir: args["storage-dir"],
  }).then((report) => {
    console.log(`Evidence preflight: ${report.failClosed ? "fail_closed" : "ready"}`);
    console.log(`Report: ${path.resolve(args.out ?? "artifacts/evidence-preflight", "report.json")}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
