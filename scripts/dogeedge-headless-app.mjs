import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv.slice(2));
const url = stringArg("url", "http://127.0.0.1:5173");
const heartbeatSeconds = numberArg("heartbeat-seconds", 30);
const statusFile = path.resolve(stringArg("status-file", "artifacts/evidence/headless-app-status.json"));
const storageDir = path.resolve(stringArg("storage-dir", process.env.DOGEEDGE_LOCAL_WORKER_DIR ?? "D:\\DogeEdge\\data\\local-worker"));
const chromePath = stringArg("chrome-path", defaultChromePath());
const userDataDir = path.resolve(stringArg("user-data-dir", path.join(os.tmpdir(), "dogeedge-headless-chrome")));
const once = Boolean(args.once);

let chrome = null;
let startedAt = new Date().toISOString();

if (isMainModule()) {
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  await run();
}

async function run() {
  if (!existsSync(chromePath)) {
    throw new Error(`Chrome executable not found: ${chromePath}`);
  }
  for (;;) {
    ensureChrome();
    const status = await buildStatus().catch((error) => ({
      startedAt,
      checkedAt: new Date().toISOString(),
      url,
      status: "error",
      storageDir,
      chromePid: chrome?.pid ?? null,
      canaryAttempts: 0,
      dryRunGuarded: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    await writeStatus(status);
    if (!once && shouldRestartChrome(status)) {
      await closeChrome();
    }
    if (once) {
      shutdown(status.chromeAlive && status.latestFresh ? 0 : 1);
      return;
    }
    await sleep(Math.max(5, heartbeatSeconds) * 1000);
  }
}

function ensureChrome() {
  if (chrome && !chrome.killed && chrome.exitCode === null) return;
  startedAt = new Date().toISOString();
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${userDataDir}`,
    url,
  ], {
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  chrome.unref();
}

async function closeChrome() {
  if (chrome && !chrome.killed) {
    chrome.kill();
  }
  chrome = null;
  await sleep(1_000);
}

async function buildStatus() {
  const latestPath = path.join(storageDir, "latest.json");
  const executablePath = path.join(storageDir, "top-traders-executable.json");
  const executionCanariesPath = path.join(storageDir, "execution-canaries.json");
  const latest = await readJsonMaybe(latestPath);
  const executableDoc = await readJsonMaybe(executablePath);
  const executionCanaries = await readJsonMaybe(executionCanariesPath);
  const checkedAt = new Date().toISOString();
  const startedAgeSeconds = Math.max(0, (Date.parse(checkedAt) - Date.parse(startedAt)) / 1000);
  const latestStoredAt = stringOrNull(latest?.storedAt);
  const executableStoredAt = stringOrNull(executableDoc?.storedAt);
  const latestAgeSeconds = latestStoredAt ? Math.max(0, (Date.parse(checkedAt) - Date.parse(latestStoredAt)) / 1000) : null;
  const executableAgeSeconds = executableStoredAt ? Math.max(0, (Date.parse(checkedAt) - Date.parse(executableStoredAt)) / 1000) : null;
  const summary = summarizeCanaries(executableDoc?.topTradersExecutable);
  const selection = canarySelectionStatus(latest, executionCanaries, executableDoc?.topTradersExecutable);
  const gateReasons = Array.isArray(latest?.runtimeSnapshot?.gate?.reasons) ? latest.runtimeSnapshot.gate.reasons.map(String) : [];
  const dryRunGuarded = gateReasons.some((reason) => /paper-only mode is active/i.test(reason))
    && gateReasons.some((reason) => /live trading is not enabled/i.test(reason));
  return {
    startedAt,
    checkedAt,
    startedAgeSeconds,
    url,
    status: "ok",
    storageDir,
    chromePid: chrome?.pid ?? null,
    chromeAlive: Boolean(chrome && !chrome.killed && chrome.exitCode === null),
    latestStoredAt,
    executableStoredAt,
    latestAgeSeconds,
    executableAgeSeconds,
    latestFresh: latestAgeSeconds !== null && latestAgeSeconds <= Math.max(60, heartbeatSeconds * 3),
    executableFresh: executableAgeSeconds !== null && executableAgeSeconds <= Math.max(60, heartbeatSeconds * 3),
    topTradersStatus: stringOrNull(latest?.topTradersArena?.status),
    selectedAlgoCount: numberOrNull(latest?.topTradersArena?.selectedAlgoCount),
    marketTicker: stringOrNull(latest?.marketTicker ?? latest?.paperInput?.ticker),
    action: stringOrNull(latest?.paperInput?.action),
    secondsToClose: numberOrNull(latest?.paperInput?.secondsToClose),
    dryRunGuarded,
    gateReasons,
    ...summary,
    ...selection,
    canarySelectionRestartEligible: selection.canarySelectionStale === true
      && startedAgeSeconds >= Math.max(30, heartbeatSeconds * 2),
  };
}

export function canarySelectionStatus(latest, executionCanaries, executable = null) {
  const expectedCanaryIds = expectedCanaryAlgoIds(executionCanaries);
  const currentSelectedAlgoIds = selectedTopTraderAlgoIds(latest?.topTradersArena);
  const expectedSet = new Set(expectedCanaryIds);
  const currentSelectedCanaryIds = currentSelectedAlgoIds.filter((id) => expectedSet.has(id));
  const activeCanaryIds = activeCanaryAlgoIds(executable, expectedSet);
  const selectedCanaryIds = uniqueStrings([...currentSelectedCanaryIds, ...activeCanaryIds]);
  const selectedAlgoIds = uniqueStrings([...currentSelectedAlgoIds, ...activeCanaryIds]);
  const topTradersStatus = stringOrNull(latest?.topTradersArena?.status);
  const selectedAlgoCount = numberOrNull(latest?.topTradersArena?.selectedAlgoCount);
  const hasSelectionEvidence = selectedAlgoIds.length > 0 || Number(selectedAlgoCount ?? 0) > 0;
  const stale = expectedCanaryIds.length > 0
    && topTradersStatus === "running"
    && hasSelectionEvidence
    && selectedCanaryIds.length < expectedCanaryIds.length;
  return {
    expectedCanaryCount: expectedCanaryIds.length,
    selectedCanaryCount: selectedCanaryIds.length,
    expectedCanaryIds,
    selectedAlgoIds,
    selectedCanaryIds,
    currentSelectedAlgoIds,
    currentSelectedCanaryIds,
    activeCanaryIds,
    canarySelectionStale: stale,
  };
}

export function expectedCanaryAlgoIds(executionCanaries) {
  const probes = Array.isArray(executionCanaries?.probes) ? executionCanaries.probes : [];
  const ids = [];
  for (const probe of probes) {
    const id = stringOrNull(probe?.id);
    const sourceAlgoId = stringOrNull(probe?.sourceAlgoId);
    const generatedId = sourceAlgoId ? `generated:${sourceAlgoId}` : null;
    const candidate = id ?? generatedId;
    if (candidate) ids.push(candidate);
  }
  return uniqueStrings(ids);
}

function selectedTopTraderAlgoIds(arena) {
  const selected = Array.isArray(arena?.selectedAlgoIds) ? arena.selectedAlgoIds : [];
  return uniqueStrings([
    ...selected,
    stringOrNull(arena?.selectedAlgoId),
  ].filter(Boolean));
}

function activeCanaryAlgoIds(executable, expectedSet) {
  const stats = executable?.stats && typeof executable.stats === "object" ? executable.stats : {};
  const ids = [];
  for (const row of Object.values(stats)) {
    if (!(row?.lane === "exact_linked_execution_canary" || row?.evidenceStatus === "execution_canary_only")) continue;
    const id = stringOrNull(row?.algoId) ?? (stringOrNull(row?.sourceAlgoId) ? `generated:${stringOrNull(row?.sourceAlgoId)}` : null);
    if (id && expectedSet.has(id)) ids.push(id);
  }
  return uniqueStrings(ids);
}

function summarizeCanaries(executable) {
  const stats = executable?.stats && typeof executable.stats === "object" ? executable.stats : {};
  const rows = Object.values(stats).filter((row) => row?.lane === "exact_linked_execution_canary" || row?.evidenceStatus === "execution_canary_only");
  const summary = {
    canaryRows: rows.length,
    canarySignals: 0,
    canaryAttempts: 0,
    canaryAcceptedBuys: 0,
    canaryRejected: 0,
    canaryBuys: 0,
    canarySells: 0,
    canaryOpen: 0,
    canaryWins: 0,
    canaryLosses: 0,
    canaryTotalPnl: 0,
    lastAttemptAt: null,
  };
  for (const row of rows) {
    summary.canarySignals += numberOrZero(row.signals);
    summary.canaryAttempts += numberOrZero(row.attempts);
    summary.canaryAcceptedBuys += numberOrZero(row.acceptedBuys);
    summary.canaryRejected += numberOrZero(row.rejected);
    summary.canaryBuys += numberOrZero(row.buys);
    summary.canarySells += numberOrZero(row.sells);
    summary.canaryOpen += numberOrZero(row.open);
    summary.canaryWins += numberOrZero(row.wins);
    summary.canaryLosses += numberOrZero(row.losses);
    summary.canaryTotalPnl += numberOrZero(row.totalPnl);
    if (typeof row.lastAttemptAt === "string" && (!summary.lastAttemptAt || row.lastAttemptAt > summary.lastAttemptAt)) {
      summary.lastAttemptAt = row.lastAttemptAt;
    }
  }
  summary.canaryTotalPnl = Math.round(summary.canaryTotalPnl * 100) / 100;
  return summary;
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeStatus(status) {
  await mkdir(path.dirname(statusFile), { recursive: true });
  await writeFile(statusFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function stringArg(name, fallback) {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberArg(name, fallback) {
  const value = Number(args[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function defaultChromePath() {
  return process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome";
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value)).filter((value) => value.length > 0))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown(code) {
  if (chrome && !chrome.killed) {
    chrome.kill();
  }
  process.exit(code);
}

export function shouldRestartChrome(status) {
  if (!status || typeof status !== "object") return true;
  if (status.status !== "ok") return true;
  if (status.chromeAlive === false) return true;
  if (status.latestFresh === false || status.executableFresh === false) return true;
  if (status.topTradersStatus && status.topTradersStatus !== "running") return true;
  if (Number(status.selectedAlgoCount ?? 0) <= 0 && Number(status.canaryRows ?? 0) > 0) return true;
  if (status.canarySelectionRestartEligible === true) return true;
  return false;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
