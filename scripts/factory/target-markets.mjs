import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { familyResearchSupported } from "./family-registry.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const targetMarketSchemaVersion = "dogeedge.target-markets.v1";

export async function selectTargetMarkets(options = {}) {
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const dataRoot = path.resolve(options.dataRoot ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const storageDir = path.resolve(options.storageDir ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
  const maxClosedTargets = Math.max(0, Number(options.maxClosedTargets ?? options.maxTargets ?? 250));
  const maxActiveTargets = Math.max(0, Number(options.maxActiveTargets ?? 25));
  const activeHorizonMinutes = Math.max(1, Number(options.activeHorizonMinutes ?? 180));
  const activeHorizonMs = activeHorizonMinutes * 60_000;
  const closed = new Map();
  const active = new Map();
  const diagnostics = [];

  const addTarget = (bucket, marketTicker, source, extra = {}) => {
    if (!marketTicker || typeof marketTicker !== "string") return;
    const closeMs = parseTime(extra.closeTime ?? extra.marketCloseTime ?? extra.marketCloseTimestamp);
    const day = closeMs === null ? "" : new Date(closeMs).toISOString().slice(0, 10);
    const existing = bucket.get(marketTicker) ?? {
      marketTicker,
      day,
      closeTime: closeMs === null ? null : new Date(closeMs).toISOString(),
      family: extra.family ?? "",
      researchCandidateId: extra.researchCandidateId ?? "",
      candidateConfigHash: extra.candidateConfigHash ?? "",
      evidenceSources: [],
      priority: 0,
    };
    existing.evidenceSources = uniqueStrings([...existing.evidenceSources, source]);
    existing.priority = Math.max(existing.priority, Number(extra.priority ?? 0));
    if (!existing.closeTime && closeMs !== null) existing.closeTime = new Date(closeMs).toISOString();
    if (!existing.day && day) existing.day = day;
    if (!existing.family && extra.family) existing.family = extra.family;
    if (!existing.researchCandidateId && extra.researchCandidateId) existing.researchCandidateId = extra.researchCandidateId;
    if (!existing.candidateConfigHash && extra.candidateConfigHash) existing.candidateConfigHash = extra.candidateConfigHash;
    bucket.set(marketTicker, existing);
  };

  for (const file of [
    path.join(dataRoot, "backtests", "latest-sweep.json"),
    path.join(dataRoot, "backtests", "latest.json"),
  ]) {
    const json = await readJsonMaybe(file);
    if (!json) continue;
    collectFromResearchRun(json, { nowMs, activeHorizonMs, addTarget, closed, active });
  }

  const frameFiles = await latestFilesRecursive(path.join(dataRoot, "features", "decision-frames"), [".jsonl", ".ndjson"], Number(options.maxFrameFiles ?? 12));
  for (const file of frameFiles) {
    for (const row of await readJsonLines(file, Number(options.maxFrameRowsPerFile ?? 2500))) {
      const marketTicker = stringOrNull(row.marketTicker ?? row.market_ticker ?? row.ticker);
      const closeMs = parseTime(row.marketCloseTime ?? row.marketCloseTimestamp ?? row.market_close_timestamp_utc);
      if (!marketTicker || closeMs === null) continue;
      if (closeMs <= nowMs) addTarget(closed, marketTicker, "decision_frame_closed", { closeTime: closeMs, family: row.family, priority: 80 });
      else if (closeMs <= nowMs + activeHorizonMs) addTarget(active, marketTicker, "decision_frame_active", { closeTime: closeMs, family: row.family, priority: 70 });
    }
  }

  for (const row of await readJsonLines(path.join(storageDir, "paper-trades.jsonl"), Number(options.maxTradeRows ?? 5000))) {
    const marketTicker = stringOrNull(row.marketTicker ?? row.market_ticker);
    const closeMs = parseTime(row.closedAt ?? row.settlementTimestamp ?? row.labelTimestamp);
    if (!marketTicker) continue;
    if (row.status === "closed" || closeMs !== null && closeMs <= nowMs) {
      addTarget(closed, marketTicker, "paper_trade_closed", {
        closeTime: closeMs,
        family: row.family,
        researchCandidateId: row.researchCandidateId,
        candidateConfigHash: row.candidateConfigHash,
        priority: row.researchCandidateId && row.candidateConfigHash ? 100 : 60,
      });
    }
  }

  const latest = await readJsonMaybe(path.join(storageDir, "latest.json"));
  collectCurrentLocalMarkets(latest, { nowMs, activeHorizonMs, addTarget, active });

  const closedTargets = sortTargets([...closed.values()]).slice(0, maxClosedTargets);
  const activeTargets = sortTargets([...active.values()]).slice(0, maxActiveTargets);
  if (!closedTargets.length) diagnostics.push("closed_target_markets_absent");
  if (!activeTargets.length) diagnostics.push("active_target_markets_absent");

  return {
    schemaVersion: targetMarketSchemaVersion,
    generatedAt: new Date().toISOString(),
    dataRoot,
    storageDir,
    maxClosedTargets,
    maxActiveTargets,
    activeHorizonMinutes,
    closedTargets,
    activeTargets,
    closedTargetCount: closedTargets.length,
    activeTargetCount: activeTargets.length,
    closedTickers: closedTargets.map((row) => row.marketTicker),
    activeTickers: activeTargets.map((row) => row.marketTicker),
    reasonCodes: diagnostics,
  };
}

export async function writeTargetMarketSelection(selection, outDir) {
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "target_markets.json");
  await writeFile(jsonPath, `${JSON.stringify(selection, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "closed-targets.txt"), `${selection.closedTickers.join("\n")}${selection.closedTickers.length ? "\n" : ""}`, "utf8");
  await writeFile(path.join(outDir, "active-targets.txt"), `${selection.activeTickers.join("\n")}${selection.activeTickers.length ? "\n" : ""}`, "utf8");
  await writeFile(path.join(outDir, "closed-targets.json"), `${JSON.stringify({ schemaVersion: targetMarketSchemaVersion, markets: selection.closedTickers }, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "active-targets.json"), `${JSON.stringify({ schemaVersion: targetMarketSchemaVersion, markets: selection.activeTickers }, null, 2)}\n`, "utf8");
  return {
    jsonPath,
    closedTextPath: path.join(outDir, "closed-targets.txt"),
    activeTextPath: path.join(outDir, "active-targets.txt"),
    closedJsonPath: path.join(outDir, "closed-targets.json"),
    activeJsonPath: path.join(outDir, "active-targets.json"),
  };
}

async function targetMarketCli() {
  const args = parseArgs(process.argv.slice(2));
  const selection = await selectTargetMarkets({
    dataRoot: args["data-root"],
    storageDir: args["storage-dir"],
    maxClosedTargets: args["max-closed"],
    maxActiveTargets: args["max-active"],
    activeHorizonMinutes: args["active-horizon-minutes"],
    maxFrameFiles: args["max-frame-files"],
  });
  const outDir = path.resolve(args.out ?? "artifacts/evidence/target-markets");
  const paths = await writeTargetMarketSelection(selection, outDir);
  console.log(`Target-market selection complete: closed ${selection.closedTargetCount}, active ${selection.activeTargetCount}`);
  console.log(`Output: ${paths.jsonPath}`);
}

function collectFromResearchRun(run, { nowMs, activeHorizonMs, addTarget, closed, active }) {
  const rows = [
    ...(Array.isArray(run?.candidates) ? run.candidates : []),
    ...(Array.isArray(run?.topMetrics) ? run.topMetrics : []),
    ...(Array.isArray(run?.metrics) ? run.metrics : []),
  ];
  for (const row of rows) {
    if (row?.family && !familyResearchSupported(row.family)) continue;
    const exactLinked = Boolean(row?.researchCandidateId && row?.candidateConfigHash);
    const priority = exactLinked ? 90 : 50;
    for (const marketTicker of uniqueStrings(Array.isArray(row?.marketTickers) ? row.marketTickers : [])) {
      addTarget(closed, marketTicker, "research_metric_market", {
        family: row.family,
        researchCandidateId: row.researchCandidateId,
        candidateConfigHash: row.candidateConfigHash,
        priority,
      });
    }
    for (const item of Array.isArray(row?.markets) ? row.markets : []) {
      const marketTicker = stringOrNull(item?.marketTicker ?? item?.ticker ?? item?.id);
      const closeMs = parseTime(item?.closeTime ?? item?.marketCloseTime ?? item?.marketCloseTimestamp);
      if (!marketTicker) continue;
      if (closeMs !== null && closeMs > nowMs && closeMs <= nowMs + activeHorizonMs) {
        addTarget(active, marketTicker, "research_metric_active_market", { ...row, closeTime: closeMs, priority });
      } else {
        addTarget(closed, marketTicker, "research_metric_closed_market", { ...row, closeTime: closeMs, priority });
      }
    }
  }
}

function collectCurrentLocalMarkets(latest, { nowMs, activeHorizonMs, addTarget, active }) {
  const candidates = [
    latest?.market,
    latest?.currentMarket,
    latest?.runtimeSnapshot?.market,
    latest?.paperInput,
  ];
  for (const row of candidates) {
    const marketTicker = stringOrNull(row?.marketTicker ?? row?.ticker ?? row?.market_ticker);
    const closeMs = parseTime(row?.marketCloseTime ?? row?.marketCloseTimestamp ?? row?.closeTime);
    if (marketTicker && (closeMs === null || closeMs >= nowMs && closeMs <= nowMs + activeHorizonMs)) {
      addTarget(active, marketTicker, "local_worker_current_market", { closeTime: closeMs, priority: 75 });
    }
  }
}

async function latestFilesRecursive(root, extensions, limit) {
  const files = await listFiles(root, extensions);
  const stats = await Promise.all(files.map(async (file) => {
    try {
      const text = await readFile(file);
      return { file, mtimeMs: 0, size: text.length };
    } catch {
      return { file, mtimeMs: 0, size: 0 };
    }
  }));
  return stats.sort((left, right) => right.mtimeMs - left.mtimeMs || left.file.localeCompare(right.file)).slice(0, limit).map((row) => row.file);
}

async function listFiles(root, extensions) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      return entry.isDirectory() ? listFiles(fullPath, extensions) : extensions.some((ext) => fullPath.endsWith(ext)) ? [fullPath] : [];
    }));
    return nested.flat().sort();
  } catch {
    return [];
  }
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readJsonLines(filePath, maxRows = 5000) {
  try {
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxRows).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function sortTargets(rows) {
  return rows.sort((left, right) => right.priority - left.priority || String(right.closeTime ?? "").localeCompare(String(left.closeTime ?? "")) || left.marketTicker.localeCompare(right.marketTicker));
}

function parseTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value > 10_000_000_000 ? value : value * 1000;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))].sort();
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
  targetMarketCli().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
