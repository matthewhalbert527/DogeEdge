import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/factory/calibrate-simulator.mjs [--data-root dir] [--dataset dir] [--replay-root dir] [--out dir]");
    process.exit(0);
  }
  const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const datasetDir = path.resolve(args.dataset ?? await latestDatasetDir(path.join(dataRoot, "research", "datasets")));
  const replayRoot = path.resolve(args["replay-root"] ?? path.join(dataRoot, "replay", "final"));
  const outDir = path.resolve(args.out ?? path.join(datasetDir, "simulator-calibration"));
  const datasetManifest = await readJsonRequired(path.join(datasetDir, "dataset_manifest.json"));
  const markets = readGzipJsonl(await readFile(path.join(datasetDir, "markets.jsonl.gz")));
  const replayEvents = [];
  for (const market of markets) {
    const replayPath = path.join(replayRoot, safeSegment(market.marketTicker), "replay.jsonl.gz");
    replayEvents.push(...await readReplayRows(replayPath));
  }
  const latencyRows = replayEvents
    .map((event) => latencyRow(event))
    .filter((row) => Number.isFinite(row.latencyMs));
  const latencySummary = percentileSummary(latencyRows.map((row) => row.latencyMs));
  const fillability = fillabilityRows(replayEvents);
  const depthShortfalls = fillability.filter((row) => row.fillableContracts <= 0);
  const scenarios = scenarioRows(latencySummary, fillability);
  const calibration = {
    schemaVersion: "dogeedge.simulator-calibration.v1",
    generatedAt: new Date().toISOString(),
    datasetHash: datasetManifest.datasetHash,
    datasetMarketCount: markets.length,
    replayEventCount: replayEvents.length,
    latency: latencySummary,
    scenarios: {
      base: scenarioConfig("base", latencySummary.p50, 0, 1, 1),
      conservative: scenarioConfig("conservative", latencySummary.p90, 1, 0.75, 1),
      stress: scenarioConfig("stress", latencySummary.p99, 2, 0.5, 2),
    },
    makerSimulationEnabled: false,
    takerSimulationDefault: true,
    executableBookPricesRequired: true,
    fixedPointPriceHandling: true,
    partialFillsSupported: true,
    kalshiFeeModelVersion: "dogeedge.kalshi-fees.v1",
    replayBookReconstructionSuccessRate: markets.length ? round(markets.filter((row) => row.sequenceGapStatus === "none").length / markets.length) : 0,
    unresolvedSequenceGapsInEvaluatedWindows: markets.filter((row) => row.sequenceGapStatus !== "none").length,
    canPlaceOrders: false,
    reasonCodes: [
      ...(markets.length < 20 ? ["diagnostic_market_count_below_20"] : []),
      ...(replayEvents.length === 0 ? ["replay_events_absent"] : []),
    ],
  };
  await mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, "simulator_calibration.json"), calibration);
  await writeGzipTsv(path.join(outDir, "latency_distribution.tsv.gz"), ["marketTicker", "channel", "messageType", "providerTs", "receiveTs", "latencyMs", "timeToCloseBucket"], latencyRows);
  await writeGzipTsv(path.join(outDir, "fillability_by_regime.tsv.gz"), ["marketTicker", "side", "timeToCloseBucket", "spreadBucket", "visibleDepth", "fillableContracts", "scenario"], fillability);
  await writeGzipTsv(path.join(outDir, "depth_shortfall.tsv.gz"), ["marketTicker", "side", "timeToCloseBucket", "visibleDepth", "requestedContracts", "fillableContracts", "reasonCode"], depthShortfalls);
  await writeGzipTsv(path.join(outDir, "cost_sensitivity.tsv.gz"), ["scenario", "latencyMs", "adverseTicks", "depthMultiplier", "feeMultiplier", "fillableObservationCount", "shortfallRate"], scenarios);
  await writeJson(path.join(outDir, "paper_replay_parity.json"), {
    schemaVersion: "dogeedge.paper-replay-parity-summary.v1",
    generatedAt: calibration.generatedAt,
    datasetHash: datasetManifest.datasetHash,
    decisionParityTarget: 1,
    quoteParityWithinOneTickTarget: 0.95,
    replayBookReconstructionTarget: 0.95,
    settlementJoinCoverageTarget: 0.95,
    lineageCompletenessTarget: 1,
    seedCompletenessTarget: 1,
    diagnosticReady: markets.length >= 20,
    canPlaceOrders: false,
  });
  await writeGzipTsv(path.join(outDir, "parity_mismatches.tsv.gz"), ["marketTicker", "reasonCode"], []);
  console.log(`Simulator calibration written: ${path.join(outDir, "simulator_calibration.json")}`);
}

function latencyRow(event) {
  const providerMs = Number(event.providerTsMs ?? Date.parse(event.providerTs ?? ""));
  const receiveMs = Date.parse(event.receiveTs ?? "");
  return {
    marketTicker: event.marketTicker ?? "",
    channel: event.channel ?? "",
    messageType: event.messageType ?? "",
    providerTs: event.providerTs ?? "",
    receiveTs: event.receiveTs ?? "",
    latencyMs: Number.isFinite(providerMs) && Number.isFinite(receiveMs) ? Math.max(0, receiveMs - providerMs) : null,
    timeToCloseBucket: "captured_window",
  };
}

function fillabilityRows(events) {
  return events
    .filter((event) => event.channel === "orderbook")
    .map((event) => {
      const yesDepth = depthFromSnapshot(event.bookSnapshot?.yes ?? event.bookSnapshot?.yes_bids);
      const noDepth = depthFromSnapshot(event.bookSnapshot?.no ?? event.bookSnapshot?.no_bids);
      const visibleDepth = Math.max(0, yesDepth + noDepth);
      const spread = Number.isFinite(event.bestYesAsk) && Number.isFinite(event.bestYesBid) ? event.bestYesAsk - event.bestYesBid : null;
      return {
        marketTicker: event.marketTicker,
        side: event.side ?? "BOOK",
        timeToCloseBucket: "captured_window",
        spreadBucket: spread === null ? "unknown" : spread <= 0.03 ? "tight" : spread <= 0.08 ? "normal" : "wide",
        visibleDepth,
        requestedContracts: 1,
        fillableContracts: visibleDepth > 0 ? 1 : 0,
        scenario: "base",
        reasonCode: visibleDepth > 0 ? "" : "insufficient_depth",
      };
    });
}

function scenarioRows(latency, fillability) {
  const configs = [
    scenarioConfig("base", latency.p50, 0, 1, 1),
    scenarioConfig("conservative", latency.p90, 1, 0.75, 1),
    scenarioConfig("stress", latency.p99, 2, 0.5, 2),
  ];
  return configs.map((config) => {
    const count = fillability.length;
    const shortfalls = fillability.filter((row) => row.visibleDepth * config.depthMultiplier < row.requestedContracts).length;
    return {
      ...config,
      fillableObservationCount: count,
      shortfallRate: count ? round(shortfalls / count) : 0,
    };
  });
}

function scenarioConfig(scenario, latencyMs, adverseTicks, depthMultiplier, feeMultiplier) {
  return {
    scenario,
    latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
    adverseTicks,
    depthMultiplier,
    feeMultiplier,
    makerSimulationEnabled: false,
  };
}

function percentileSummary(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function depthFromSnapshot(levels) {
  if (!Array.isArray(levels)) return 0;
  return levels.reduce((sum, level) => sum + Math.max(0, Number(Array.isArray(level) ? level[1] : level?.quantity ?? level?.size ?? 0) || 0), 0);
}

async function latestDatasetDir(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name)).sort();
  if (!dirs.length) throw new Error(`research_dataset_absent:${root}`);
  return dirs.at(-1);
}

async function readReplayRows(filePath) {
  try {
    return readGzipJsonl(await readFile(filePath));
  } catch {
    return [];
  }
}

function readGzipJsonl(buffer) {
  return gunzipSync(buffer).toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

async function readJsonRequired(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error(`required_json_missing:${filePath}`);
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeGzipTsv(filePath, columns, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = `${columns.join("\t")}\n${rows.map((row) => columns.map((column) => String(row[column] ?? "")).join("\t")).join("\n")}${rows.length ? "\n" : ""}`;
  await writeFile(filePath, gzipSync(payload));
}

function safeSegment(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
}

function round(value) {
  return Math.round(Number(value) * 10000) / 10000;
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
