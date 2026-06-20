import { execFile, spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { executionCanaryHealth, mergedCanaryExclusions } from "./factory/evidence-bootstrap.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const once = Boolean(args.once);
const statusOnly = Boolean(args["status-only"]);
const heartbeatSeconds = numberArg("heartbeat-seconds", 30);
const maxProbes = Math.max(0, Math.floor(numberArg("max-probes", 3)));
const appUrl = stringArg("app-url", "http://127.0.0.1:5173");
const workerUrl = stringArg("worker-url", "http://127.0.0.1:8787/health");
const dataRoot = path.resolve(stringArg("data-root", process.env.DOGEEDGE_DATA_ROOT ?? "D:\\DogeEdge\\data"));
const storageDir = path.resolve(stringArg("storage-dir", process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker")));
const evidenceOut = path.resolve(stringArg("evidence-out", "C:\\Users\\matth\\DogeEdge\\artifacts\\evidence"));
const evidenceLoopOut = path.resolve(stringArg("out", "C:\\Users\\matth\\DogeEdge\\artifacts\\evidence-live-run"));
const headlessStatusFile = path.resolve(stringArg("headless-status-file", "artifacts/evidence/headless-app-status.json"));
const headlessUserDataDir = path.resolve(stringArg("headless-user-data-dir", path.join(evidenceLoopOut, "headless-chrome-profile")));
const supervisorStatusFile = path.resolve(stringArg("status-file", "artifacts/evidence/supervisor-status.json"));
const logsDir = path.resolve(stringArg("logs-dir", "artifacts/evidence/supervisor-logs"));

const children = new Map();
await mkdir(path.dirname(supervisorStatusFile), { recursive: true });
await mkdir(logsDir, { recursive: true });

if (isMainModule()) {
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  await run();
}

async function run() {
  for (;;) {
    const status = await superviseOnce();
    await writeFile(supervisorStatusFile, `${JSON.stringify(status, null, 2)}\n`, "utf8");
    if (once) {
      process.exitCode = status.ok ? 0 : 1;
      return;
    }
    await sleep(Math.max(5, heartbeatSeconds) * 1000);
  }
}

async function superviseOnce() {
  const checkedAt = new Date().toISOString();
  const checks = {
    worker: await checkHttp(workerUrl),
    app: await checkHttp(appUrl),
    headless: await checkHeadless(),
    executionCanaries: await checkExecutionCanaries(),
    evidenceLoop: await checkEvidenceLoop(),
  };
  const actions = [];
  if (!statusOnly) {
    if (checks.executionCanaries.status === "fail") {
      actions.push(await reseedExecutionCanaries(checks.executionCanaries));
      checks.executionCanaries = await checkExecutionCanaries();
    }
    if (!checks.worker.ok) actions.push(await startManaged("worker", [process.execPath, ["scripts/dogeedge-local-worker.mjs"], workerEnv()]));
    if (!checks.app.ok) actions.push(await startManaged("app", [process.execPath, [viteBin(), "--host", "127.0.0.1", "--port", "5173"], process.env]));
    if (!checks.headless.ok) {
      actions.push(await restartManaged("headless", [
        process.execPath,
        [
          "scripts/dogeedge-headless-app.mjs",
          "--url",
          appUrl,
          "--status-file",
          headlessStatusFile,
          "--storage-dir",
          storageDir,
          "--heartbeat-seconds",
          String(heartbeatSeconds),
          "--user-data-dir",
          headlessUserDataDir,
        ],
        process.env,
      ]));
    }
    if (!checks.evidenceLoop.ok) {
      actions.push(await startManaged("evidence-loop", [
        process.execPath,
        evidenceLoopArgsForSupervisor({ maxProbes, evidenceLoopOut, evidenceOut }),
        process.env,
      ]));
    }
  }

  return {
    schemaVersion: "dogeedge.evidence-supervisor.v1",
    checkedAt,
    ok: Object.values(checks).every((check) => check.ok),
    statusOnly,
    appUrl,
    workerUrl,
    dataRoot,
    storageDir,
    evidenceOut,
    evidenceLoopOut,
    checks,
    managedChildren: [...children.entries()].map(([name, child]) => ({ name, pid: child.pid, exitCode: child.exitCode })),
    actions,
    canPlaceOrders: false,
  };
}

export function evidenceLoopArgsForSupervisor({ maxProbes = 3, evidenceLoopOut, evidenceOut } = {}) {
  return [
    "scripts/factory/evidence-loop.mjs",
    "--online",
    "--max-closed",
    "50",
    "--max-active",
    "10",
    "--mode",
    "websocket",
    "--duration-seconds",
    "900",
    "--interval-minutes",
    "10",
    "--active-min-lead-minutes",
    "1",
    "--provider-active-horizon-minutes",
    "180",
    "--run-backtest",
    "--promote-check-max-sweep-algos",
    "500",
    "--refresh-bundle",
    "--max-probes",
    String(maxProbes),
    "--out",
    evidenceLoopOut,
    "--evidence-out",
    evidenceOut,
  ];
}

async function startManaged(name, spec) {
  const existing = children.get(name);
  if (existing && !existing.killed && existing.exitCode === null) {
    return { name, action: "already_managed", pid: existing.pid };
  }
  const [command, childArgs, env] = spec;
  const stdout = await open(path.join(logsDir, `${name}.stdout.log`), "a");
  const stderr = await open(path.join(logsDir, `${name}.stderr.log`), "a");
  const child = spawn(command, childArgs, {
    cwd: repoRoot,
    env,
    stdio: ["ignore", stdout.fd, stderr.fd],
    windowsHide: true,
  });
  children.set(name, child);
  child.on("exit", () => {
    void stdout.close().catch(() => {});
    void stderr.close().catch(() => {});
  });
  return { name, action: "started", pid: child.pid, command: [command, ...childArgs] };
}

async function restartManaged(name, spec) {
  const existing = children.get(name);
  if (existing && !existing.killed && existing.exitCode === null) {
    existing.kill();
    children.delete(name);
    await sleep(1_000);
  }
  const started = await startManaged(name, spec);
  return { ...started, action: started.action === "started" ? "restarted" : started.action };
}

async function checkHttp(url) {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    return { ok: response.ok, status: response.status, url };
  } catch (error) {
    return { ok: false, url, error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkHeadless() {
  const doc = await readJsonMaybe(headlessStatusFile);
  const checkedAt = new Date().toISOString();
  const ageSeconds = doc?.checkedAt ? Math.max(0, (Date.parse(checkedAt) - Date.parse(doc.checkedAt)) / 1000) : null;
  const fresh = ageSeconds !== null && ageSeconds <= Math.max(90, heartbeatSeconds * 4);
  return {
    ok: Boolean(doc?.status === "ok" && fresh && doc.latestFresh !== false && doc.executableFresh !== false && doc.topTradersStatus === "running" && doc.canarySelectionStale !== true),
    status: doc?.status ?? null,
    checkedAt: doc?.checkedAt ?? null,
    ageSeconds,
    fresh,
    topTradersStatus: doc?.topTradersStatus ?? null,
    selectedAlgoCount: doc?.selectedAlgoCount ?? null,
    canaryAttempts: doc?.canaryAttempts ?? null,
    canaryAcceptedBuys: doc?.canaryAcceptedBuys ?? null,
    expectedCanaryCount: doc?.expectedCanaryCount ?? null,
    selectedCanaryCount: doc?.selectedCanaryCount ?? null,
    canarySelectionStale: doc?.canarySelectionStale === true,
    canarySelectionRestartEligible: doc?.canarySelectionRestartEligible === true,
  };
}

async function checkExecutionCanaries() {
  const executableFile = await readJsonMaybe(path.join(storageDir, "top-traders-executable.json"));
  const health = executionCanarySupervisorHealth(executableFile?.topTradersExecutable);
  await mkdir(evidenceOut, { recursive: true });
  await writeFile(path.join(evidenceOut, "execution_canary_health.json"), `${JSON.stringify({ ...health, source: "supervisor" }, null, 2)}\n`, "utf8");
  return health;
}

export function executionCanarySupervisorHealth(topTradersExecutable, options = {}) {
  const health = executionCanaryHealth(topTradersExecutable, options);
  return {
    ok: health.status !== "fail",
    ...health,
  };
}

async function reseedExecutionCanaries(canaryHealth) {
  if (maxProbes <= 0) {
    return { name: "execution-canaries", action: "skipped", reason: "max_probes_zero" };
  }
  const executionCanaries = await readJsonMaybe(path.join(storageDir, "execution-canaries.json"));
  const excludedSourceAlgoIds = mergedCanaryExclusions(executionCanaries, canaryHealth);
  const childArgs = [
    "scripts/factory/evidence-lane.mjs",
    "--data-root",
    dataRoot,
    "--storage-dir",
    storageDir,
    "--max-probes",
    String(Math.min(3, maxProbes)),
    "--executable-only",
    "--from",
    "best-supported-research",
  ];
  if (excludedSourceAlgoIds.length > 0) childArgs.push("--exclude-source-algos", excludedSourceAlgoIds.join(","));
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, childArgs, {
      cwd: repoRoot,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      name: "execution-canaries",
      action: "reseeded_unhealthy_canaries",
      reasonCodes: canaryHealth.reasonCodes ?? [],
      excludedSourceAlgoIds,
      command: ["node", ...childArgs],
      stdout: tail(stdout),
      stderr: tail(stderr),
    };
  } catch (error) {
    return {
      name: "execution-canaries",
      action: "reseed_failed",
      reasonCodes: canaryHealth.reasonCodes ?? [],
      excludedSourceAlgoIds,
      command: ["node", ...childArgs],
      stdout: tail(error?.stdout ?? ""),
      stderr: tail(error?.stderr ?? errorMessage(error)),
    };
  }
}

async function checkEvidenceLoop() {
  const latestPath = path.join(evidenceLoopOut, "latest.json");
  const doc = await readJsonMaybe(latestPath);
  return evidenceLoopHealth(doc, { nowMs: Date.now(), heartbeatSeconds });
}

export function evidenceLoopHealth(doc, { nowMs = Date.now(), heartbeatSeconds = 30 } = {}) {
  const nextRunAt = doc?.nextRunAt ? Date.parse(doc.nextRunAt) : null;
  const finishedAt = doc?.finishedAt ? Date.parse(doc.finishedAt) : null;
  const startedAt = doc?.startedAt ? Date.parse(doc.startedAt) : null;
  const loopPid = Number(doc?.loopPid);
  const loopAlive = Number.isInteger(loopPid) && loopPid > 0 ? processExists(loopPid) : false;
  const overdue = nextRunAt ? nowMs > nextRunAt + Math.max(5 * 60_000, heartbeatSeconds * 4 * 1000) : false;
  const recentEnough = finishedAt ? nowMs - finishedAt <= 60 * 60_000 : false;
  const running = doc?.status === "running";
  const runningFresh = running && loopAlive && startedAt ? nowMs - startedAt <= Math.max(45 * 60_000, heartbeatSeconds * 8 * 1000) : false;
  return {
    ok: Boolean((doc?.status === "ok" && !overdue && recentEnough) || runningFresh),
    status: doc?.status ?? null,
    loopPid: Number.isInteger(loopPid) && loopPid > 0 ? loopPid : null,
    loopAlive,
    startedAt: doc?.startedAt ?? null,
    finishedAt: doc?.finishedAt ?? null,
    nextRunAt: doc?.nextRunAt ?? null,
    runningFresh,
    overdue,
    recentEnough,
    canPlaceOrders: doc?.canPlaceOrders === true ? true : false,
  };
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function workerEnv() {
  return {
    ...process.env,
    DOGEEDGE_DATA_ROOT: dataRoot,
    DOGEEDGE_DATA_DIR: storageDir,
    DOGEEDGE_PERSIST_BACKTEST_TELEMETRY: process.env.DOGEEDGE_PERSIST_BACKTEST_TELEMETRY ?? "1",
    DOGEEDGE_PERSIST_PAPER_EVENTS: process.env.DOGEEDGE_PERSIST_PAPER_EVENTS ?? "1",
  };
}

function viteBin() {
  return path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
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

function stringArg(name, fallback) {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberArg(name, fallback) {
  const value = Number(args[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function tail(value, max = 6000) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(-max) : text;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function shutdown(code) {
  for (const child of children.values()) {
    if (child && !child.killed) child.kill();
  }
  process.exit(code);
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
