import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { selectTargetMarkets, writeTargetMarketSelection } from "./target-markets.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/factory/collect-evidence.mjs [--online] [--asset DOGE] [--continuous] [--hours n] [--max-markets n] [--resume] [--capture-before-open-seconds n] [--minimum-remaining-seconds n] [--wait-for-settlement] [--out dir] [--status-file path] [--stop-after-stage stage]");
    process.exit(0);
  }

  const startedAt = new Date().toISOString();
  const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const outRoot = path.resolve(args.out ?? "artifacts/evidence-runtime");
  const statusFile = path.resolve(args["status-file"] ?? path.join(outRoot, "status.json"));
  const lockPath = path.join(outRoot, ".collector.lock");
  const registryPath = path.resolve(args["registry"] ?? path.join(dataRoot, "evidence-registry", "markets.jsonl"));
  const maxMarkets = Math.max(1, Number(args["max-markets"] ?? 1));
  const hours = Number(args.hours ?? 0);
  const deadlineMs = hours > 0 ? Date.now() + hours * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
  const minimumRemainingSeconds = Math.max(0, Number(args["minimum-remaining-seconds"] ?? 90));
  const durationSeconds = Math.max(5, Number(args["duration-seconds"] ?? Math.min(90, Math.max(30, minimumRemainingSeconds))));
  const runId = String(args.resume && args["run-id"] ? args["run-id"] : `collector-${startedAt.replaceAll(":", "-")}`);
  const completed = [];
  const failed = [];

  await mkdir(outRoot, { recursive: true });
  await mkdir(path.dirname(registryPath), { recursive: true });
  await acquireLock(lockPath, { runId, startedAt, statusFile, dataRoot, canPlaceOrders: false });
  try {
    await writeRuntimeJson(path.join(outRoot, "provider_health.json"), {
      schemaVersion: "dogeedge.evidence-provider-health.v1",
      generatedAt: new Date().toISOString(),
      online: Boolean(args.online),
      asset: String(args.asset ?? "DOGE"),
      canPlaceOrders: false,
      reasonCodes: [],
    });
    for (let ordinal = 0; ordinal < maxMarkets && Date.now() < deadlineMs; ordinal += 1) {
      await heartbeat(outRoot, statusFile, { runId, startedAt, ordinal, maxMarkets, completed, failed, status: "selecting_market" });
      const selection = await selectTargetMarkets({
        dataRoot,
        providerActive: args.online === true,
        maxClosedTargets: 5,
        maxActiveTargets: Math.max(3, maxMarkets - ordinal),
        activeMinLeadMinutes: Math.max(0, Math.ceil(minimumRemainingSeconds / 60)),
        providerActiveHorizonMinutes: Math.max(30, Number(args["active-horizon-minutes"] ?? 180)),
        seriesTicker: seriesTickerForAsset(args.asset ?? "DOGE"),
      });
      const target = chooseTarget(selection.activeTargets ?? [], { completed, failed, minimumRemainingSeconds });
      await writeRuntimeJson(path.join(outRoot, "current_market.json"), {
        schemaVersion: "dogeedge.evidence-current-market.v1",
        generatedAt: new Date().toISOString(),
        runId,
        selected: target ?? null,
        activeTargetCount: selection.activeTargetCount,
        reasonCodes: target ? [] : ["active_target_market_absent"],
      });
      if (!target) {
        failed.push({ marketTicker: null, reasonCode: "active_target_market_absent", generatedAt: new Date().toISOString() });
        break;
      }

      const marketRunId = `${runId}-${safeSegment(target.marketTicker)}`;
      const targetDir = path.join(outRoot, "target-markets", marketRunId);
      const targetSelection = {
        ...selection,
        activeTargets: [target],
        activeTickers: [target.marketTicker],
        activeTargetCount: 1,
        closedTargets: [],
        closedTickers: [],
        closedTargetCount: 0,
      };
      const targetPaths = await writeTargetMarketSelection(targetSelection, targetDir);
      await heartbeat(outRoot, statusFile, { runId, startedAt, ordinal, maxMarkets, completed, failed, status: "capturing", target });
      const e2eOut = path.join(outRoot, "e2e-runs");
      const result = await runNode([
        "scripts/factory/run-e2e-evidence.mjs",
        ...(args.online ? ["--online"] : []),
        "--target-markets", targetPaths.activeJsonPath,
        "--auto-select-candidate",
        "--resume", marketRunId,
        "--out", e2eOut,
        "--duration-seconds", String(durationSeconds),
        ...(args["wait-for-settlement"] ? ["--wait-for-settlement"] : []),
      ]);
      const runDir = path.join(e2eOut, marketRunId);
      const status = await readJsonMaybe(path.join(runDir, "pipeline_status.json"));
      const replayFinalDestination = await persistReplayFinal({ runDir, dataRoot, marketTicker: target.marketTicker });
      const record = {
        schemaVersion: "dogeedge.evidence-registry-market.v1",
        generatedAt: new Date().toISOString(),
        collectorRunId: runId,
        marketTicker: target.marketTicker,
        closeTime: target.closeTime ?? null,
        e2eRunDir: runDir,
        replayFinalDestination,
        commandStatus: result.status,
        replayGrade: Number(status?.replayGradeEvaluatedMarkets ?? 0) > 0,
        finalizedSettlementJoined: Number(status?.finalizedSettlementJoinCount ?? 0) > 0,
        exactLinkedPaperDecisionCount: Number(status?.exactLinkedPaperDecisionCount ?? 0),
        labelKnownCount: Number(status?.labelKnownCount ?? 0),
        sequenceGapCount: Number(status?.unresolvedSequenceGapsInEvalWindow ?? 0),
        candidateEvaluationComplete: status?.candidateEvaluationComplete === true,
        pipelineOperational: status?.pipelineOperational === true,
        canPlaceOrders: false,
        artifactHashes: await hashArtifacts(runDir),
        reasonCodes: status?.blockers?.map((item) => item.code) ?? [],
      };
      await appendJsonl(registryPath, record);
      if (record.replayGrade) {
        completed.push(record);
        await appendJsonl(path.join(outRoot, "completed_markets.jsonl"), record);
      } else {
        failed.push({ ...record, reasonCode: record.reasonCodes[0] ?? "replay_grade_not_available" });
        await appendJsonl(path.join(outRoot, "failed_markets.jsonl"), { ...record, reasonCode: record.reasonCodes[0] ?? "replay_grade_not_available" });
      }
      await writeRuntimeJson(path.join(outRoot, "settlement_queue.json"), {
        schemaVersion: "dogeedge.evidence-settlement-queue.v1",
        generatedAt: new Date().toISOString(),
        waiting: completed.filter((row) => !row.finalizedSettlementJoined).map((row) => row.marketTicker),
        canPlaceOrders: false,
      });
      await writeDiskUsage(outRoot, dataRoot);
      if (args["stop-after-stage"] === "market") break;
      if (!args.continuous && ordinal + 1 >= maxMarkets) break;
    }

    const finalStatus = {
      schemaVersion: "dogeedge.evidence-collector-status.v1",
      generatedAt: new Date().toISOString(),
      runId,
      status: completed.length > 0 ? "evidence_collected" : "blocked_or_waiting",
      completedMarketCount: completed.length,
      failedMarketCount: failed.length,
      maxMarkets,
      registryPath,
      completedMarkets: completed.map((row) => row.marketTicker),
      failedMarkets: failed.map((row) => ({ marketTicker: row.marketTicker, reasonCode: row.reasonCode ?? row.reasonCodes?.[0] ?? "unknown" })),
      canPlaceOrders: false,
    };
    await writeRuntimeJson(statusFile, finalStatus);
    await heartbeat(outRoot, statusFile, { runId, startedAt, completed, failed, status: finalStatus.status });
    console.log(`Evidence collection status: ${finalStatus.status}`);
    console.log(`Completed replay-grade markets: ${completed.length}/${maxMarkets}`);
    console.log(`Registry: ${registryPath}`);
  } finally {
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

async function persistReplayFinal({ runDir, dataRoot, marketTicker }) {
  const source = path.join(runDir, "replay-final", safeSegment(marketTicker));
  const destination = path.join(dataRoot, "replay", "final", safeSegment(marketTicker));
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
    return destination;
  } catch {
    return null;
  }
}

function chooseTarget(activeTargets, { completed, failed, minimumRemainingSeconds }) {
  const used = new Set([...completed, ...failed].map((row) => row.marketTicker).filter(Boolean));
  const nowMs = Date.now();
  return [...activeTargets]
    .filter((row) => row?.marketTicker && !used.has(row.marketTicker))
    .filter((row) => {
      const closeMs = Date.parse(row.closeTime ?? "");
      return Number.isFinite(closeMs) && closeMs - nowMs >= minimumRemainingSeconds * 1000;
    })
    .sort((left, right) => Date.parse(left.closeTime ?? "") - Date.parse(right.closeTime ?? "") || left.marketTicker.localeCompare(right.marketTicker))[0] ?? null;
}

async function heartbeat(outRoot, statusFile, value) {
  await writeRuntimeJson(path.join(outRoot, "heartbeat.json"), {
    schemaVersion: "dogeedge.evidence-heartbeat.v1",
    generatedAt: new Date().toISOString(),
    statusFile,
    canPlaceOrders: false,
    ...value,
  });
}

async function acquireLock(lockPath, value) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    await writeFile(lockPath, `${JSON.stringify({ ...value, pid: process.pid })}\n`, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") {
      const existing = await readJsonMaybe(lockPath);
      if (existing?.pid && !isProcessRunning(existing.pid)) {
        await rm(lockPath, { force: true }).catch(() => {});
        await writeFile(lockPath, `${JSON.stringify({ ...value, pid: process.pid, recoveredStaleLock: true })}\n`, { flag: "wx" });
        return;
      }
      throw new Error(`duplicate_collector_lockout:${lockPath}`);
    }
    throw error;
  }
}

function isProcessRunning(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

async function runNode(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, { cwd: repoRoot, windowsHide: true, maxBuffer: 60 * 1024 * 1024 });
    return { status: "ok", stdout: tail(stdout), stderr: tail(stderr) };
  } catch (error) {
    return { status: "failed", stdout: tail(error?.stdout), stderr: tail(error?.stderr ?? error?.message ?? error) };
  }
}

async function hashArtifacts(root) {
  const files = ["pipeline_status.json", "manifest.json", "capture_manifest.json", "replay_coverage_report.json", "official_settlement.json", "paper_replay_parity_report.json"];
  const rows = [];
  for (const file of files) {
    const filePath = path.join(root, file);
    try {
      const bytes = await readFile(filePath);
      rows.push({ relativePath: file, bytes: bytes.length, sha256: sha256(bytes) });
    } catch {
      // Missing artifacts are reflected in status reason codes.
    }
  }
  return rows;
}

async function writeDiskUsage(outRoot, dataRoot) {
  await writeRuntimeJson(path.join(outRoot, "disk_usage.json"), {
    schemaVersion: "dogeedge.evidence-disk-usage.v1",
    generatedAt: new Date().toISOString(),
    outRoot,
    dataRoot,
    outRootBytes: await directoryBytes(outRoot),
    dataRootBytes: await directoryBytes(path.join(dataRoot, "replay")).catch(() => 0),
    warningBytes: Number(process.env.DOGEEDGE_EVIDENCE_DISK_WARN_BYTES ?? 250 * 1024 * 1024 * 1024),
    pruningPerformed: false,
    reasonCodes: [],
  });
}

async function directoryBytes(root) {
  const entries = await stat(root).catch(() => null);
  if (!entries) return 0;
  if (entries.isFile()) return entries.size;
  const { readdir } = await import("node:fs/promises");
  const children = await readdir(root, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const child of children) total += await directoryBytes(path.join(root, child.name));
  return total;
}

async function writeRuntimeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(filePath, { force: true }).catch(() => {});
  await import("node:fs/promises").then(({ rename }) => rename(tmp, filePath));
}

async function appendJsonl(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function seriesTickerForAsset(asset) {
  return String(asset ?? "DOGE").toUpperCase() === "DOGE" ? "KXDOGE15M" : `KX${String(asset).toUpperCase()}15M`;
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

function safeSegment(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function tail(value, max = 6000) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(-max) : text;
}

async function defaultDataRoot() {
  if (process.platform === "win32") {
    try {
      await stat("D:\\");
      return "D:\\DogeEdge\\data";
    } catch {
      // Fall through to repo-local data.
    }
  }
  return path.join(repoRoot, "data");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(String(error?.message ?? "").startsWith("duplicate_collector_lockout") ? 2 : 1);
});
