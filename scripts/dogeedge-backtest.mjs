import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFactoryDecisionFrames } from "./factory/data.mjs";
import { runFactoryResearchPipeline } from "./factory/pipeline.mjs";
import { metricsCsv as robustMetricsCsv, markdownReport as robustMarkdownReport } from "./factory/reporting.mjs";
import { experimentRegistryEntry, compareRuns } from "./factory/registry.mjs";
import { assertReplayInputManifest } from "./factory/repro.mjs";
import { readPaperEvidence } from "./factory/paper-evidence.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const validateMode = Boolean(args.validate);
const replayRunMode = Boolean(args["replay-run"]);
const promoteCheckMode = Boolean(args["promote-check"]);
const replayConfig = replayRunMode && typeof args.config === "string" ? await readReplayConfig(args.config) : null;
const dataRoot = path.resolve(args["data-root"] ?? replayConfig?.dataRoot ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
const framesDir = path.resolve(args.frames ?? replayConfig?.framesDir ?? path.join(dataRoot, "features", "decision-frames"));
const backtestsDir = path.resolve(args.out ?? path.join(dataRoot, "backtests"));
const algosDir = path.resolve(process.env.DOGEEDGE_ALGOS_DIR ?? path.join(path.dirname(dataRoot), "algos"));
const paperDataDir = path.resolve(args["paper-data"] ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
const runId = args["run-id"] ?? new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const sweepMode = Boolean(args.sweep);
const deepSweepMode = sweepMode && Boolean(args.deep);
const modeLabel = replayRunMode ? "replay-run" : validateMode ? "validate" : promoteCheckMode ? "promote-check" : sweepMode ? deepSweepMode ? "deep-sweep" : "sweep" : "default";
const runDir = path.join(backtestsDir, sweepMode ? "sweeps" : "runs", runId);
const selectedAlgoIds = args.algo ? new Set(String(args.algo).split(",").map((item) => item.trim()).filter(Boolean)) : null;
const sinceArg = args.since ?? replayConfig?.since ?? null;
const untilArg = args.until ?? replayConfig?.until ?? null;
const since = typeof sinceArg === "string" ? Date.parse(sinceArg) : null;
const until = typeof untilArg === "string" ? Date.parse(untilArg) : null;
const minCandidateClosed = Math.max(1, Number(args["min-closed"] ?? replayConfig?.minCandidateClosed ?? 3));
const walkForwardRatio = clamp(Number(args["walk-forward-ratio"] ?? replayConfig?.walkForwardRatio ?? 0.3), 0.1, 0.5);
const minWalkForwardClosed = Math.max(1, Number(args["min-walk-closed"] ?? replayConfig?.minWalkForwardClosed ?? 2));
const permissiveDebug = Boolean(args["permissive-debug"]);
const randomSeed = String(args.seed ?? replayConfig?.randomSeed ?? "dogeedge-factory-v1");
const embargoMs = Math.max(0, Number(args["embargo-ms"] ?? replayConfig?.embargoMs ?? 15 * 60_000));
const foldCount = Math.max(2, Number(args.folds ?? replayConfig?.foldCount ?? 5));
const bootstrapIterations = Math.max(100, Number(args["bootstrap-iterations"] ?? replayConfig?.bootstrapIterations ?? 400));
const thresholds = {
  minClosedTrades: Math.max(30, minCandidateClosed),
  minResearchEvents: Math.max(60, Number(args["min-research-events"] ?? replayConfig?.thresholds?.minResearchEvents ?? 60)),
  minHoldoutEvents: Math.max(12, Number(args["min-holdout-events"] ?? replayConfig?.thresholds?.minHoldoutEvents ?? 12)),
  minWalkForwardClosed: Math.max(2, minWalkForwardClosed),
  minHoldoutClosed: Math.max(5, Number(args["min-holdout-closed"] ?? replayConfig?.thresholds?.minHoldoutClosed ?? 10)),
  minHoldoutMarkets: Math.max(5, Number(args["min-holdout-markets"] ?? replayConfig?.thresholds?.minHoldoutMarkets ?? 10)),
  minHoldoutRoi: Number(args["min-holdout-roi"] ?? replayConfig?.thresholds?.minHoldoutRoi ?? 0),
  minHoldoutExpectancyLowerBound: Number(args["min-holdout-lower-ci"] ?? replayConfig?.thresholds?.minHoldoutExpectancyLowerBound ?? 0),
};

if (args.compare) {
  const [leftPath, rightPath] = await comparePaths(backtestsDir, args);
  const changes = await compareRuns(leftPath, rightPath);
  console.log(`DogeEdge factory comparison`);
  console.log(`Left: ${leftPath}`);
  console.log(`Right: ${rightPath}`);
  console.log(changes.map((change) => `${change.algoName}: rank ${change.previousRank ?? "-"} -> ${change.currentRank}, robust ${change.previousRobustScore ?? "-"} -> ${change.currentRobustScore ?? "-"}, ${change.reason}`).join("\n") || "No comparable candidate changes.");
  process.exit(0);
}

await Promise.all([
  mkdir(runDir, { recursive: true }),
  mkdir(algosDir, { recursive: true }),
]);

const defaultAlgos = algoDefinitions();
const allAlgos = sweepMode ? [...defaultAlgos, ...sweepAlgoDefinitions()] : defaultAlgos;
assertUniqueAlgoIds(allAlgos);
const algos = selectedAlgoIds ? allAlgos.filter((algo) => selectedAlgoIds.has(algo.id)) : allAlgos;
if (algos.length === 0) {
  throw new Error(`No algos selected. Known algos: ${allAlgos.map((algo) => algo.id).join(", ")}`);
}

await writeJsonIfMissing(path.join(algosDir, "registry.json"), {
  updatedAt: new Date().toISOString(),
  note: "Default DogeEdge algo factory registry. Backtests use the built-in definitions in scripts/dogeedge-backtest.mjs unless this script is extended to load external modules.",
  algos: allAlgos.map(({ signal: _signal, ...algo }) => algo),
});

const startedAt = new Date().toISOString();
const replayManifestCheck = replayRunMode && replayConfig
  ? await assertReplayInputManifest(framesDir, replayConfig.registry, { permissiveDebug })
  : null;
const paperEvidence = await readPaperEvidence({
  storageDir: paperDataDir,
  since,
  until,
});
const loadResult = await readFactoryDecisionFrames(framesDir, { permissiveDebug });
const pipeline = runFactoryResearchPipeline({
  algos,
  loadResult,
  since,
  until,
  options: {
    permissiveDebug,
    seed: randomSeed,
    embargoMs,
    foldCount,
    bootstrapIterations,
    testRatio: walkForwardRatio,
    minCandidateClosed,
    minWalkForwardClosed,
    thresholds,
    paperEvidence,
  },
});
const filteredFrames = pipeline.frames;
const metrics = pipeline.metrics;
const candidates = pipeline.candidates;
const trades = pipeline.trades;
const finishedAt = new Date().toISOString();
const registry = await experimentRegistryEntry({
  repoRoot,
  dataRoot,
  framesDir,
  config: {
    runId,
    mode: modeLabel,
    since: sinceArg,
    until: untilArg,
    permissiveDebug,
    randomSeed,
    embargoMs,
    foldCount,
    bootstrapIterations,
    walkForwardRatio,
    minCandidateClosed,
    minWalkForwardClosed,
    thresholds,
    paperDataDir,
    paperEvidence: paperEvidence.summary,
    replayManifestCheck,
    replayConfigHash: replayConfig?.registry?.configHash ?? null,
  },
  algos,
  folds: pipeline.purgedFolds,
  cpcvFolds: pipeline.cpcvFolds,
  holdoutSplit: pipeline.holdoutSplit,
  costModels: pipeline.costModels,
  seed: randomSeed,
});

await writeFile(path.join(runDir, "config.json"), `${JSON.stringify({
  runId,
  mode: modeLabel,
  startedAt,
  finishedAt,
  dataRoot,
  framesDir,
  paperDataDir,
  dataQuality: pipeline.dataQuality,
  paperEvidence: paperEvidence.summary,
  eventCount: pipeline.events.length,
  frameCount: filteredFrames.length,
  walkForwardFrameCount: pipeline.split.testEventIds.length,
  walkForwardRatio,
  algoCount: algos.length,
  deepSweepMode,
  minCandidateClosed,
  minWalkForwardClosed,
  thresholds,
  validateMode,
  replayRunMode,
  promoteCheckMode,
  replayConfigPath: replayRunMode ? args.config ?? null : null,
  replayConfigHash: replayConfig?.registry?.configHash ?? null,
  replayManifestCheck,
  permissiveDebug,
  randomSeed,
  embargoMs,
  foldCount,
  bootstrapIterations,
  registry,
  promoteCheck: promoteCheckSummary(metrics, candidates),
  split: pipeline.split,
  purgedFolds: pipeline.purgedFolds.map((fold) => ({
    id: fold.id,
    trainEventCount: fold.trainEventIds.length,
    validationEventCount: fold.validationEventIds.length,
    purgedEventCount: fold.purgedEventIds.length,
    embargoedEventCount: fold.embargoedEventIds.length,
    embargoMs: fold.embargoMs,
  })),
  cpcvFolds: pipeline.cpcvFolds.map((fold) => ({
    id: fold.id,
    trainEventCount: fold.trainEventIds.length,
    validationEventCount: fold.validationEventIds.length,
    purgedEventCount: fold.purgedEventIds.length,
    embargoedEventCount: fold.embargoedEventIds.length,
    embargoMs: fold.embargoMs,
  })),
  holdout: {
    immutable: pipeline.holdoutSplit.immutable,
    strictlyLater: pipeline.holdoutSplit.strictlyLater,
    reason: pipeline.holdoutSplit.reason,
    latestResearchEnd: pipeline.holdoutSplit.latestResearchEnd,
    earliestHoldoutStart: pipeline.holdoutSplit.earliestHoldoutStart,
    holdoutEventIds: pipeline.holdoutSplit.holdoutEventIds,
  },
  since: sinceArg,
  until: untilArg,
  algos: algos.map(({ signal: _signal, ...algo }) => algo),
}, null, 2)}\n`);
await writeFile(path.join(runDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
await writeFile(path.join(runDir, "metrics.csv"), `${robustMetricsCsv(metrics)}\n`);
await writeFile(path.join(runDir, "candidates.json"), `${JSON.stringify(candidates, null, 2)}\n`);
await writeFile(path.join(runDir, "candidates.csv"), `${robustMetricsCsv(candidates)}\n`);
await writeFile(path.join(runDir, "trades.jsonl"), trades.map((trade) => JSON.stringify(trade)).join("\n") + (trades.length ? "\n" : ""));
await writeFile(path.join(runDir, "experiment-registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
await writeFile(path.join(runDir, "report.md"), `${robustMarkdownReport({ runId, startedAt, finishedAt, dataRoot, framesDir, frameCount: filteredFrames.length, eventCount: pipeline.events.length, algoCount: algos.length, sweepMode, dataQuality: pipeline.dataQuality, metrics, candidates })}\n`);
await writeFile(path.join(backtestsDir, "latest.json"), `${JSON.stringify({
  runId,
  mode: modeLabel,
  runDir,
  finishedAt,
  dataRoot,
  paperDataDir,
  dataQuality: pipeline.dataQuality,
  paperEvidence: paperEvidence.summary,
  eventCount: pipeline.events.length,
  frameCount: filteredFrames.length,
  walkForwardFrameCount: pipeline.split.testEventIds.length,
  walkForwardRatio,
  algoCount: algos.length,
  deepSweepMode,
  permissiveDebug,
  randomSeed,
  embargoMs,
  foldCount,
  registry,
  replayManifestCheck,
  promoteCheck: promoteCheckSummary(metrics, candidates),
  metrics,
  candidates,
}, null, 2)}\n`);
if (sweepMode) {
  await writeFile(path.join(backtestsDir, "latest-sweep.json"), `${JSON.stringify({
    runId,
    mode: modeLabel,
    runDir,
    finishedAt,
    dataRoot,
    paperDataDir,
    dataQuality: pipeline.dataQuality,
    paperEvidence: paperEvidence.summary,
    eventCount: pipeline.events.length,
    frameCount: filteredFrames.length,
    walkForwardFrameCount: pipeline.split.testEventIds.length,
    walkForwardRatio,
    algoCount: algos.length,
    deepSweepMode,
    minCandidateClosed,
    minWalkForwardClosed,
    permissiveDebug,
    randomSeed,
    embargoMs,
    foldCount,
    registry,
    replayManifestCheck,
    promoteCheck: promoteCheckSummary(metrics, candidates),
    candidates,
    topMetrics: metrics.slice(0, 50),
  }, null, 2)}\n`);
}

console.log(`DogeEdge ${sweepMode ? deepSweepMode ? "deep sweep" : "sweep" : "backtest"} complete`);
if (validateMode) console.log(`Validation mode: integrity, split, holdout, and report checks completed`);
if (replayRunMode) console.log(`Replay-run mode: ${replayConfig ? `loaded saved config hash ${replayConfig.registry?.configHash ?? "unknown"}; input manifest ${replayManifestCheck?.matches ? "matched" : "not checked"}` : "no saved config supplied; ran deterministic replay defaults"}`);
if (promoteCheckMode) {
  const summary = promoteCheckSummary(metrics, candidates);
  console.log(`Promotion check: ${summary.promotionReady.length} ready, ${summary.nonPromotable.length} non-promotable`);
}
console.log(`Frames: ${filteredFrames.length}`);
console.log(`Market events: ${pipeline.events.length}`);
console.log(`Algos: ${algos.length}`);
console.log(`Run: ${runDir}`);
console.log((candidates.length ? candidates : metrics).slice(0, 8).map((metric) => `${metric.algoName}: ${money(metric.totalPnl)} P/L, ${percent(metric.roi)} ROI, ${metric.independentClosedMarkets ?? metric.closed} markets, ${metric.promotionVerdict ?? "review"} verdict, robust ${metric.robustScore?.toFixed(2) ?? "-"}`).join("\n"));

async function defaultDataRoot() {
  if (process.platform === "win32") {
    try {
      await access("D:\\");
      return "D:\\DogeEdge\\data";
    } catch {
      // Fall back to repo-local data below.
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
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

async function comparePaths(baseDir, parsedArgs) {
  if (typeof parsedArgs.left === "string" && typeof parsedArgs.right === "string") {
    return [path.resolve(parsedArgs.left), path.resolve(parsedArgs.right)];
  }
  const latest = path.join(baseDir, "latest.json");
  const latestSweep = path.join(baseDir, "latest-sweep.json");
  try {
    await access(latestSweep);
    return [latest, latestSweep];
  } catch {
    return [latest, latest];
  }
}

async function readReplayConfig(configPath) {
  const resolved = path.resolve(configPath);
  return JSON.parse(await readFile(resolved, "utf8"));
}

function promoteCheckSummary(metrics, candidates) {
  const candidateIds = new Set(candidates.map((candidate) => candidate.algoId));
  return {
    promotionReady: candidates.map((candidate) => ({
      algoId: candidate.algoId,
      algoName: candidate.algoName,
      verdict: candidate.promotionVerdict,
      robustScore: candidate.robustScore,
    })),
    nonPromotable: metrics
      .filter((metric) => !candidateIds.has(metric.algoId))
      .slice(0, 200)
      .map((metric) => ({
        algoId: metric.algoId,
        algoName: metric.algoName,
        verdict: metric.promotionVerdict,
        reasonCodes: metric.reasonCodes ?? [],
      })),
  };
}

function algoDefinitions() {
  return [
    {
      id: "final60-lock-v1",
      name: "Final-60 Lock v1",
      family: "paper",
      params: { maxSecondsToClose: 60 },
      signal: (frame) => {
        const side = sideFromAction(frame.modelAction);
        const spread = side ? spreadForSide(side, frame) : Number.POSITIVE_INFINITY;
        const allowed = side !== null
          && frame.secondsToClose <= 60
          && frame.modelEdgeAfterFees > 0
          && yesProbationAllows(side, frame.modelEdgeAfterFees, frame.modelConfidence, spread);
        return signal(allowed ? side : null, frame.modelEdgeAfterFees, frame.modelConfidence, frame.modelSizeContracts, frame.fairProbability, "Final-60 model signal inside final 60 seconds.");
      },
    },
    {
      id: "final60-strict",
      name: "Final-60 Strict",
      family: "paper-variant",
      params: { maxSecondsToClose: 60, minEdge: 0.07, minConfidence: 70 },
      signal: (frame) => {
        const side = sideFromAction(frame.modelAction);
        const spread = side ? spreadForSide(side, frame) : Number.POSITIVE_INFINITY;
        const allowed = side !== null
          && frame.secondsToClose <= 60
          && frame.modelEdgeAfterFees >= 0.07
          && frame.modelConfidence >= 70
          && yesProbationAllows(side, frame.modelEdgeAfterFees, frame.modelConfidence, spread);
        return signal(allowed ? side : null, frame.modelEdgeAfterFees, frame.modelConfidence, frame.modelConfidence >= 85 ? 4 : 2, frame.fairProbability, "Strict final-minute edge and confidence filter.");
      },
    },
    {
      id: "final60-aggressive",
      name: "Final-60 Aggressive",
      family: "paper-variant",
      params: { minEdge: 0.025, minConfidence: 45 },
      signal: (frame) => {
        const side = sideFromAction(frame.modelAction);
        const spread = side ? spreadForSide(side, frame) : Number.POSITIVE_INFINITY;
        const allowed = side !== null
          && frame.modelEdgeAfterFees >= 0.025
          && frame.modelConfidence >= 45
          && yesProbationAllows(side, frame.modelEdgeAfterFees, frame.modelConfidence, spread);
        return signal(allowed ? side : null, frame.modelEdgeAfterFees, frame.modelConfidence, frame.modelConfidence >= 75 ? 3 : 1, frame.fairProbability, "Aggressive positive-edge entry filter.");
      },
    },
    {
      id: "threshold-distance-020",
      name: "Threshold Distance >= 0.00020",
      family: "paper",
      params: { minDistance: 0.0002 },
      signal: thresholdDistanceSignal(0.0002),
    },
    {
      id: "spread-scalp-2c",
      name: "Spread Scalp <= 2c",
      family: "paper",
      params: { maxSpread: 0.02 },
      signal: spreadScalpSignal(0.02),
    },
    {
      id: "spread-scalp-4c",
      name: "Spread Scalp <= 4c",
      family: "paper-variant",
      params: { maxSpread: 0.04 },
      signal: spreadScalpSignal(0.04),
    },
    {
      id: "momentum-003",
      name: "Momentum >= 0.03%",
      family: "paper-variant",
      params: { minMovePercent: 0.0003 },
      signal: (frame) => {
        const side = frame.oneMinuteMovePercent >= 0 ? "YES" : "NO";
        const ask = askForSide(side, frame);
        const baseFair = side === "YES" ? frame.fairProbability : 1 - frame.fairProbability;
        const fairProbability = clamp(baseFair + Math.min(0.1, Math.abs(frame.oneMinuteMovePercent) * 180), 0.01, 0.99);
        const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.018);
        const confidence = clamp(Math.round(52 + Math.min(1, Math.abs(frame.oneMinuteMovePercent) / 0.001) * 34), 0, 88);
        const allowed = Math.abs(frame.oneMinuteMovePercent) >= 0.0003 && edge > 0;
        return signal(allowed ? side : null, edge, confidence, Math.abs(frame.oneMinuteMovePercent) >= 0.0006 ? 3 : 1, fairProbability, "Momentum requires at least a 0.03% one-minute move.");
      },
    },
    {
      id: "momentum-max-6c",
      name: "Momentum <= 6c spread",
      family: "paper",
      params: { minOneMinuteChange: 0.000015, maxSpread: 0.06 },
      signal: (frame) => {
        const side = frame.oneMinuteChange >= 0 ? "YES" : "NO";
        const ask = askForSide(side, frame);
        const spread = spreadForSide(side, frame);
        const momentumBoost = clamp(Math.abs(frame.oneMinuteChange) / 0.00035, 0, 1) * 0.12;
        const baseFair = side === "YES" ? frame.fairProbability : 1 - frame.fairProbability;
        const fairProbability = clamp(baseFair + momentumBoost, 0.01, 0.99);
        const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.018);
        const confidence = clamp(Math.round(48 + momentumBoost * 280), 0, 86);
        const allowed = Math.abs(frame.oneMinuteChange) >= 0.000015
          && spread <= 0.06
          && edge > 0
          && yesProbationAllows(side, edge, confidence, spread);
        return signal(allowed ? side : null, edge, confidence, confidence >= 78 ? 3 : 1, fairProbability, "Momentum variant with a 6c max selected spread.");
      },
    },
    {
      id: "yes-probation-strict",
      name: "YES Probation Strict",
      family: "paper-variant",
      params: { minEdge: 0.18, minConfidence: 80, maxSpread: 0.02 },
      signal: (frame) => {
        const side = "YES";
        const ask = frame.yesAsk;
        const spread = spreadForSide(side, frame);
        const distance = (frame.estimate ?? 0) - (frame.targetPrice ?? 0);
        const fairProbability = clamp(Math.max(frame.fairProbability, 0.5 + distance / 0.0012), 0.01, 0.99);
        const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.014);
        const confidence = clamp(Math.round(50 + Math.max(0, edge) * 180 + Math.max(0, distance) / 0.0002 * 18), 0, 96);
        const allowed = distance > 0 && edge >= 0.18 && confidence >= 80 && spread <= 0.02;
        return signal(allowed ? side : null, edge, confidence, 1, fairProbability, "Strict YES-only recovery test with high edge, high confidence, and tight spread.");
      },
    },
  ];
}

function sweepAlgoDefinitions() {
  return [
    ...modelWindowSweep(),
    ...distanceSweep(),
    ...spreadScalpSweep(),
    ...momentumSweep(),
    ...contrarianSweep(),
    ...managedScalpSweep(),
    ...cheapLongshotSweep(),
    ...lateFavoriteSweep(),
    ...liquidityImbalanceSweep(),
    ...dualYesNoSweep(),
  ];
}

function modelWindowSweep() {
  const algos = [];
  for (const maxSecondsToClose of [30, 45, 60, 90, 120, 180]) {
    for (const minEdge of [0, 0.02, 0.04, 0.07, 0.1, 0.14]) {
      for (const minConfidence of [35, 50, 65, 80]) {
        for (const maxSpread of [0.02, 0.04, 0.06, 0.1]) {
          for (const yesMode of ["strict", "loose"]) {
            const params = { maxSecondsToClose, minEdge, minConfidence, maxSpread, yesMode };
            algos.push({
              id: `sweep-model-t${maxSecondsToClose}-e${idRatio(minEdge)}-c${minConfidence}-s${idRatio(maxSpread)}-${yesMode}`,
              name: `Sweep Model T<=${maxSecondsToClose}s E>=${percent(minEdge)} C>=${minConfidence} S<=${priceLabel(maxSpread)} ${yesMode}`,
              family: "sweep-model",
              params,
              signal: (frame) => {
                const side = sideFromAction(frame.modelAction);
                const spread = side ? spreadForSide(side, frame) : Number.POSITIVE_INFINITY;
                const allowed = side !== null
                  && frame.secondsToClose <= maxSecondsToClose
                  && frame.modelEdgeAfterFees >= minEdge
                  && frame.modelConfidence >= minConfidence
                  && spread <= maxSpread
                  && yesGateAllows(yesMode, side, frame.modelEdgeAfterFees, frame.modelConfidence, spread);
                return signal(allowed ? side : null, frame.modelEdgeAfterFees, frame.modelConfidence, contractsForConfidence(frame.modelConfidence), frame.fairProbability, "Model action parameter sweep.");
              },
            });
          }
        }
      }
    }
  }
  return algos;
}

function distanceSweep() {
  const algos = [];
  const minDistances = depthValues([0.00008, 0.00012, 0.00018, 0.00025, 0.00035, 0.00055], [0.00005, 0.00015, 0.00045]);
  const feeBuffers = depthValues([0.006, 0.014, 0.025, 0.04], [0.01, 0.03]);
  const maxSpreads = depthValues([0.02, 0.04, 0.06, 0.1], [0.08]);
  const minConfidences = depthValues([45, 60, 75], [40, 85]);
  for (const minDistance of minDistances) {
    for (const feeBuffer of feeBuffers) {
      for (const maxSpread of maxSpreads) {
        for (const minConfidence of minConfidences) {
          for (const yesMode of ["strict", "loose"]) {
            const params = { minDistance, feeBuffer, maxSpread, minConfidence, yesMode };
            algos.push({
              id: `sweep-distance-d${idMarket(minDistance)}-f${idRatio(feeBuffer)}-s${idRatio(maxSpread)}-c${minConfidence}-${yesMode}`,
              name: `Sweep Distance D>=${marketLabel(minDistance)} F=${priceLabel(feeBuffer)} S<=${priceLabel(maxSpread)} C>=${minConfidence} ${yesMode}`,
              family: "sweep-distance",
              params,
              signal: (frame) => {
                const estimate = frame.estimate ?? 0;
                const targetPrice = frame.targetPrice ?? 0;
                const distance = estimate - targetPrice;
                const side = distance >= 0 ? "YES" : "NO";
                const ask = askForSide(side, frame);
                const fairProbability = side === "YES"
                  ? clamp(0.5 + distance / 0.0012, 0.01, 0.99)
                  : clamp(0.5 - distance / 0.0012, 0.01, 0.99);
                const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
                const spread = spreadForSide(side, frame);
                const confidence = clamp(Math.round(45 + Math.min(1, Math.abs(distance) / 0.00022) * 50), 0, 100);
                const allowed = Math.abs(distance) >= minDistance
                  && edge > 0
                  && confidence >= minConfidence
                  && spread <= maxSpread
                  && yesGateAllows(yesMode, side, edge, confidence, spread);
                return signal(allowed ? side : null, edge, confidence, contractsForConfidence(confidence), fairProbability, "Distance and fee buffer parameter sweep.");
              },
            });
          }
        }
      }
    }
  }
  return algos;
}

function spreadScalpSweep() {
  const algos = [];
  for (const maxSpread of [0.01, 0.02, 0.03, 0.04, 0.06, 0.08]) {
    for (const feeBuffer of [0.004, 0.006, 0.01, 0.015, 0.025]) {
      for (const minEdge of [0, 0.02, 0.05]) {
        for (const sideMode of ["best", "no-only", "yes-only"]) {
          for (const yesMode of ["strict", "loose", "none"]) {
            const params = { maxSpread, feeBuffer, minEdge, sideMode, yesMode };
            algos.push({
              id: `sweep-scalp-s${idRatio(maxSpread)}-f${idRatio(feeBuffer)}-e${idRatio(minEdge)}-${sideMode}-${yesMode}`,
              name: `Sweep Scalp S<=${priceLabel(maxSpread)} F=${priceLabel(feeBuffer)} E>=${percent(minEdge)} ${sideMode} ${yesMode}`,
              family: "sweep-scalp",
              params,
              signal: (frame) => {
                const yesEdge = frame.yesAsk === null ? -1 : frame.fairProbability - frame.yesAsk - feeBuffer;
                const noEdge = frame.noAsk === null ? -1 : (1 - frame.fairProbability) - frame.noAsk - feeBuffer;
                const side = sideMode === "yes-only" ? "YES" : sideMode === "no-only" ? "NO" : yesEdge >= noEdge ? "YES" : "NO";
                const edge = side === "YES" ? yesEdge : noEdge;
                const spread = spreadForSide(side, frame);
                const fairProbability = side === "YES" ? frame.fairProbability : 1 - frame.fairProbability;
                const confidence = clamp(Math.round(54 + Math.max(0, edge) * 140 - Math.max(0, spread - 0.02) * 120), 0, 95);
                const allowed = spread <= maxSpread
                  && edge >= minEdge
                  && yesGateAllows(yesMode, side, edge, confidence, spread);
                return signal(allowed ? side : null, edge, confidence, spread <= 0.02 ? 3 : 1, fairProbability, "Spread scalp side/margin parameter sweep.");
              },
            });
          }
        }
      }
    }
  }
  return algos;
}

function momentumSweep() {
  const algos = [];
  const minMovePercents = depthValues([0.00002, 0.00005, 0.0001, 0.0002, 0.0003, 0.0005], [0.00004, 0.00008]);
  const maxSpreads = depthValues([0.04, 0.06, 0.08, 0.12], [0.02, 0.1]);
  const feeBuffers = depthValues([0.006, 0.014, 0.018, 0.03], [0.01, 0.022]);
  const boostMultipliers = depthValues([80, 140, 220, 320], [60, 100]);
  for (const minMovePercent of minMovePercents) {
    for (const maxSpread of maxSpreads) {
      for (const feeBuffer of feeBuffers) {
        for (const boostMultiplier of boostMultipliers) {
          for (const yesMode of ["strict", "loose"]) {
            const params = { minMovePercent, maxSpread, feeBuffer, boostMultiplier, yesMode };
            algos.push({
              id: `sweep-momentum-m${idMoveRatio(minMovePercent)}-s${idRatio(maxSpread)}-f${idRatio(feeBuffer)}-b${boostMultiplier}-${yesMode}`,
              name: `Sweep Momentum M>=${movePercentLabel(minMovePercent)} S<=${priceLabel(maxSpread)} F=${priceLabel(feeBuffer)} B=${boostMultiplier} ${yesMode}`,
              family: "sweep-momentum",
              params,
              signal: (frame) => {
                const side = frame.oneMinuteMovePercent >= 0 ? "YES" : "NO";
                const ask = askForSide(side, frame);
                const spread = spreadForSide(side, frame);
                const baseFair = side === "YES" ? frame.fairProbability : 1 - frame.fairProbability;
                const fairProbability = clamp(baseFair + Math.min(0.12, Math.abs(frame.oneMinuteMovePercent) * boostMultiplier), 0.01, 0.99);
                const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
                const confidence = clamp(Math.round(48 + Math.min(1, Math.abs(frame.oneMinuteMovePercent) / 0.001) * 42 + Math.max(0, edge) * 40), 0, 94);
                const allowed = Math.abs(frame.oneMinuteMovePercent) >= minMovePercent
                  && spread <= maxSpread
                  && edge > 0
                  && yesGateAllows(yesMode, side, edge, confidence, spread);
                return signal(allowed ? side : null, edge, confidence, confidence >= 78 ? 3 : 1, fairProbability, "Momentum magnitude/boost parameter sweep.");
              },
            });
          }
        }
      }
    }
  }
  return algos;
}

function contrarianSweep() {
  return [
    ...weakModelFadeSweep(),
    ...momentumFadeSweep(),
    ...targetReversionSweep(),
  ];
}

function weakModelFadeSweep() {
  const algos = [];
  for (const maxSecondsToClose of [45, 60, 120, 300]) {
    for (const maxModelEdge of [0.02, 0.05, 0.1]) {
      for (const maxConfidence of [35, 50, 65]) {
        for (const maxSpread of [0.02, 0.04, 0.06, 0.1]) {
          for (const yesMode of ["loose", "none"]) {
            const params = { maxSecondsToClose, maxModelEdge, maxConfidence, maxSpread, yesMode };
            algos.push({
              id: `sweep-fade-model-t${maxSecondsToClose}-e${idRatio(maxModelEdge)}-c${maxConfidence}-s${idRatio(maxSpread)}-${yesMode}`,
              name: `Sweep Fade Weak Model T<=${maxSecondsToClose}s E<=${percent(maxModelEdge)} C<=${maxConfidence} S<=${priceLabel(maxSpread)} ${yesMode}`,
              family: "sweep-fade-model",
              params,
              signal: (frame) => {
                const modelSide = sideFromAction(frame.modelAction);
                const side = modelSide ? oppositeSide(modelSide) : null;
                const spread = side ? spreadForSide(side, frame) : Number.POSITIVE_INFINITY;
                const fairProbability = side === "YES" ? frame.fairProbability : 1 - frame.fairProbability;
                const ask = side ? askForSide(side, frame) : null;
                const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.014);
                const confidence = clamp(72 - frame.modelConfidence + Math.max(0, -frame.modelEdgeAfterFees) * 100, 0, 88);
                const allowed = side !== null
                  && frame.secondsToClose <= maxSecondsToClose
                  && frame.modelEdgeAfterFees <= maxModelEdge
                  && frame.modelConfidence <= maxConfidence
                  && spread <= maxSpread
                  && edge > -0.02
                  && yesGateAllows(yesMode, side, edge, confidence, spread);
                return signal(allowed ? side : null, edge, confidence, confidence >= 70 ? 2 : 1, fairProbability, "Contrarian fade when the normal model signal is weak.");
              },
            });
          }
        }
      }
    }
  }
  return algos;
}

function momentumFadeSweep() {
  const algos = [];
  for (const minMovePercent of [0.00005, 0.0001, 0.0002, 0.0003, 0.0005]) {
    for (const maxSpread of [0.02, 0.04, 0.06, 0.08, 0.12]) {
      for (const feeBuffer of [0.006, 0.014, 0.025]) {
        for (const boostMultiplier of [80, 140]) {
          for (const yesMode of ["loose", "none"]) {
            const params = { minMovePercent, maxSpread, feeBuffer, boostMultiplier, yesMode };
            algos.push({
              id: `sweep-fade-momentum-m${idMoveRatio(minMovePercent)}-s${idRatio(maxSpread)}-f${idRatio(feeBuffer)}-b${boostMultiplier}-${yesMode}`,
              name: `Sweep Fade Momentum M>=${movePercentLabel(minMovePercent)} S<=${priceLabel(maxSpread)} F=${priceLabel(feeBuffer)} B=${boostMultiplier} ${yesMode}`,
              family: "sweep-fade-momentum",
              params,
              signal: (frame) => {
                const side = frame.oneMinuteMovePercent >= 0 ? "NO" : "YES";
                const ask = askForSide(side, frame);
                const spread = spreadForSide(side, frame);
                const baseFair = side === "YES" ? frame.fairProbability : 1 - frame.fairProbability;
                const fairProbability = clamp(baseFair + Math.min(0.1, Math.abs(frame.oneMinuteMovePercent) * boostMultiplier), 0.01, 0.99);
                const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
                const confidence = clamp(Math.round(46 + Math.min(1, Math.abs(frame.oneMinuteMovePercent) / 0.001) * 38 + Math.max(0, edge) * 45), 0, 90);
                const allowed = Math.abs(frame.oneMinuteMovePercent) >= minMovePercent
                  && spread <= maxSpread
                  && edge > -0.02
                  && yesGateAllows(yesMode, side, edge, confidence, spread);
                return signal(allowed ? side : null, edge, confidence, confidence >= 78 ? 3 : 1, fairProbability, "Contrarian fade after a one-minute DOGE move.");
              },
            });
          }
        }
      }
    }
  }
  return algos;
}

function targetReversionSweep() {
  const algos = [];
  for (const minDistance of [0, 0.00002, 0.00005]) {
    for (const maxDistance of [0.00005, 0.0001, 0.0002, 0.00035]) {
      for (const maxSpread of [0.02, 0.04, 0.08]) {
        for (const feeBuffer of [0.006, 0.014, 0.025]) {
          for (const yesMode of ["loose", "none"]) {
            if (minDistance >= maxDistance) continue;
            const params = { minDistance, maxDistance, maxSpread, feeBuffer, yesMode };
            algos.push({
              id: `sweep-target-revert-min${idMarket(minDistance)}-max${idMarket(maxDistance)}-s${idRatio(maxSpread)}-f${idRatio(feeBuffer)}-${yesMode}`,
              name: `Sweep Target Revert ${marketLabel(minDistance)}-${marketLabel(maxDistance)} S<=${priceLabel(maxSpread)} F=${priceLabel(feeBuffer)} ${yesMode}`,
              family: "sweep-target-revert",
              params,
              signal: (frame) => {
                const distance = (frame.estimate ?? 0) - (frame.targetPrice ?? 0);
                const side = distance >= 0 ? "NO" : "YES";
                const ask = askForSide(side, frame);
                const spread = spreadForSide(side, frame);
                const distanceAbs = Math.abs(distance);
                const reversionBoost = clamp((maxDistance - distanceAbs) / Math.max(0.00001, maxDistance) * 0.12, 0, 0.12);
                const baseFair = side === "YES" ? frame.fairProbability : 1 - frame.fairProbability;
                const fairProbability = clamp(baseFair + reversionBoost, 0.01, 0.99);
                const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
                const confidence = clamp(Math.round(50 + reversionBoost * 260 + Math.max(0, edge) * 60), 0, 92);
                const allowed = distanceAbs >= minDistance
                  && distanceAbs <= maxDistance
                  && spread <= maxSpread
                  && edge > -0.02
                  && yesGateAllows(yesMode, side, edge, confidence, spread);
                return signal(allowed ? side : null, edge, confidence, confidence >= 78 ? 2 : 1, fairProbability, "Contrarian target reversion near the settlement threshold.");
              },
            });
          }
        }
      }
    }
  }
  return algos;
}

function managedScalpSweep() {
  const algos = [];
  for (const maxSpread of [0.02, 0.04, 0.06]) {
    for (const feeBuffer of [0.006, 0.014]) {
      for (const minEdge of [0.02, 0.05]) {
        for (const takeProfit of [0.04, 0.08, 0.12]) {
          for (const stopLoss of [0.04, 0.08]) {
            for (const maxHoldSeconds of [60, 180, 420]) {
              for (const yesMode of ["loose", "none"]) {
                const params = { maxSpread, feeBuffer, minEdge, takeProfit, stopLoss, maxHoldSeconds, yesMode };
                algos.push({
                  id: `sweep-managed-scalp-s${idRatio(maxSpread)}-f${idRatio(feeBuffer)}-e${idRatio(minEdge)}-tp${idRatio(takeProfit)}-sl${idRatio(stopLoss)}-h${maxHoldSeconds}-${yesMode}`,
                  name: `Managed Scalp S<=${priceLabel(maxSpread)} F=${priceLabel(feeBuffer)} E>=${percent(minEdge)} TP ${priceLabel(takeProfit)} SL ${priceLabel(stopLoss)} H${maxHoldSeconds}s ${yesMode}`,
                  family: "sweep-managed-scalp",
                  params,
                  exit: managedExit({ takeProfit, stopLoss, maxHoldSeconds }),
                  signal: (frame) => {
                    const yesEdge = frame.yesAsk === null ? -1 : frame.fairProbability - frame.yesAsk - feeBuffer;
                    const noEdge = frame.noAsk === null ? -1 : (1 - frame.fairProbability) - frame.noAsk - feeBuffer;
                    const side = yesEdge >= noEdge ? "YES" : "NO";
                    const edge = side === "YES" ? yesEdge : noEdge;
                    const spread = spreadForSide(side, frame);
                    const fairProbability = side === "YES" ? frame.fairProbability : 1 - frame.fairProbability;
                    const confidence = clamp(Math.round(56 + Math.max(0, edge) * 150 - Math.max(0, spread - 0.02) * 110), 0, 96);
                    const allowed = spread <= maxSpread
                      && edge >= minEdge
                      && yesGateAllows(yesMode, side, edge, confidence, spread);
                    return signal(allowed ? side : null, edge, confidence, spread <= 0.02 ? 3 : 1, fairProbability, "Scalp with explicit take-profit, stop-loss, and max-hold exit.");
                  },
                });
              }
            }
          }
        }
      }
    }
  }
  return algos;
}

function cheapLongshotSweep() {
  const algos = [];
  const maxAsks = depthValues([0.05, 0.08, 0.12, 0.18, 0.25, 0.32], [0.16]);
  const minEdges = depthValues([0, 0.02, 0.05, 0.1], [0.015, 0.03]);
  const minSecondsToCloseValues = depthValues([60, 120, 300, 600, 900], [240]);
  const maxSpreads = depthValues([0.04, 0.08, 0.14], [0.03, 0.12]);
  for (const maxAsk of maxAsks) {
    for (const minEdge of minEdges) {
      for (const minSecondsToClose of minSecondsToCloseValues) {
        for (const maxSpread of maxSpreads) {
          for (const sideMode of ["best", "yes-only", "no-only"]) {
            const params = { maxAsk, minEdge, minSecondsToClose, maxSpread, sideMode };
            algos.push({
              id: `sweep-longshot-a${idRatio(maxAsk)}-e${idRatio(minEdge)}-t${minSecondsToClose}-s${idRatio(maxSpread)}-${sideMode}`,
              name: `Cheap Longshot A<=${priceLabel(maxAsk)} E>=${percent(minEdge)} T>=${minSecondsToClose}s S<=${priceLabel(maxSpread)} ${sideMode}`,
              family: "sweep-cheap-longshot",
              params,
              signal: (frame) => {
                const yes = sideCandidate("YES", frame, 0.014);
                const no = sideCandidate("NO", frame, 0.014);
                const picked = sideMode === "yes-only" ? yes : sideMode === "no-only" ? no : yes.edge >= no.edge ? yes : no;
                const allowed = picked.ask !== null
                  && picked.ask <= maxAsk
                  && picked.edge >= minEdge
                  && picked.spread <= maxSpread
                  && frame.secondsToClose >= minSecondsToClose;
                return signal(allowed ? picked.side : null, picked.edge, picked.confidence, 1, picked.fairProbability, "Cheap convex payout with positive estimated edge.");
              },
            });
          }
        }
      }
    }
  }
  return algos;
}

function lateFavoriteSweep() {
  const algos = [];
  for (const maxSecondsToClose of [60, 120, 240]) {
    for (const minFairProbability of [0.65, 0.72, 0.8]) {
      for (const maxAsk of [0.75, 0.85, 0.95]) {
        for (const maxSpread of [0.04, 0.08, 0.14]) {
          for (const sideMode of ["fair", "model"]) {
            const params = { maxSecondsToClose, minFairProbability, maxAsk, maxSpread, sideMode };
            algos.push({
              id: `sweep-late-fav-t${maxSecondsToClose}-p${idRatio(minFairProbability)}-a${idRatio(maxAsk)}-s${idRatio(maxSpread)}-${sideMode}`,
              name: `Late Favorite T<=${maxSecondsToClose}s P>=${percent(minFairProbability)} A<=${priceLabel(maxAsk)} S<=${priceLabel(maxSpread)} ${sideMode}`,
              family: "sweep-late-favorite",
              params,
              signal: (frame) => {
                const modelSide = sideFromAction(frame.modelAction);
                const fairSide = frame.fairProbability >= 0.5 ? "YES" : "NO";
                const side = sideMode === "model" && modelSide ? modelSide : fairSide;
                const picked = sideCandidate(side, frame, 0.01);
                const allowed = frame.secondsToClose <= maxSecondsToClose
                  && picked.fairProbability >= minFairProbability
                  && picked.ask !== null
                  && picked.ask <= maxAsk
                  && picked.edge > 0
                  && picked.spread <= maxSpread
                  && yesGateAllows("loose", picked.side, picked.edge, picked.confidence, picked.spread);
                return signal(allowed ? picked.side : null, picked.edge, picked.confidence, picked.confidence >= 82 ? 3 : 1, picked.fairProbability, "Late-contract favorite with limited ask and spread.");
              },
            });
          }
        }
      }
    }
  }
  return algos;
}

function liquidityImbalanceSweep() {
  const algos = [];
  for (const maxSpread of [0.04, 0.08, 0.14]) {
    for (const minBidDepth of [1, 2, 5]) {
      for (const minImbalance of [0.1, 0.25, 0.5]) {
        for (const minEdge of [-0.02, 0, 0.02]) {
          for (const yesMode of ["loose", "none"]) {
            const params = { maxSpread, minBidDepth, minImbalance, minEdge, yesMode };
            algos.push({
              id: `sweep-liquidity-s${idRatio(maxSpread)}-d${minBidDepth}-i${idRatio(minImbalance)}-e${idRatio(minEdge)}-${yesMode}`,
              name: `Liquidity Imbalance S<=${priceLabel(maxSpread)} D>=${minBidDepth} I>=${percent(minImbalance)} E>=${percent(minEdge)} ${yesMode}`,
              family: "sweep-liquidity-imbalance",
              params,
              signal: (frame) => {
                const yes = sideCandidate("YES", frame, 0.014);
                const no = sideCandidate("NO", frame, 0.014);
                const yesImbalance = depthImbalanceForSide("YES", frame);
                const noImbalance = depthImbalanceForSide("NO", frame);
                const picked = yesImbalance >= noImbalance ? yes : no;
                const imbalance = picked.side === "YES" ? yesImbalance : noImbalance;
                const depth = bidDepthForSide(picked.side, frame);
                const allowed = picked.ask !== null
                  && picked.spread <= maxSpread
                  && depth >= minBidDepth
                  && imbalance >= minImbalance
                  && picked.edge >= minEdge
                  && yesGateAllows(yesMode, picked.side, picked.edge, picked.confidence, picked.spread);
                return signal(allowed ? picked.side : null, picked.edge, picked.confidence, depth >= 5 ? 3 : 1, picked.fairProbability, "Top-of-book depth imbalance with controlled spread.");
              },
            });
          }
        }
      }
    }
  }
  return algos;
}

function dualYesNoSweep() {
  const algos = [];
  for (const maxCost of [0.94, 0.97, 0.99, 1]) {
    for (const maxCombinedSpread of [0.08, 0.14, 0.22]) {
      for (const minSecondsToClose of [30, 120, 300]) {
        for (const takeProfit of [0.01, 0.03, 0.05]) {
          const params = { maxCost, maxCombinedSpread, minSecondsToClose, takeProfit };
          algos.push({
            id: `sweep-dual-yn-cost${idRatio(maxCost)}-s${idRatio(maxCombinedSpread)}-t${minSecondsToClose}-tp${idRatio(takeProfit)}`,
            name: `Dual YES+NO Cost<=${priceLabel(maxCost)} Spread<=${priceLabel(maxCombinedSpread)} T>=${minSecondsToClose}s TP ${priceLabel(takeProfit)}`,
            family: "sweep-dual-yes-no",
            params,
            exit: managedExit({ takeProfit, stopLoss: 0.08, maxHoldSeconds: 420 }),
            signal: (frame) => {
              const cost = askForSide("BOTH", frame);
              const bid = bidValueForSide("BOTH", frame);
              const spread = cost === null || bid === null ? Number.POSITIVE_INFINITY : Math.max(0, cost - bid);
              const edge = cost === null ? -1 : roundRatio(1 - cost);
              const allowed = cost !== null
                && cost <= maxCost
                && spread <= maxCombinedSpread
                && frame.secondsToClose >= minSecondsToClose;
              return signal(allowed ? "BOTH" : null, edge, 100, 1, 1, "Paired YES+NO buy when combined asks are cheap enough.");
            },
          });
        }
      }
    }
  }
  return algos;
}

function thresholdDistanceSignal(minDistance) {
  return (frame) => {
    const estimate = frame.estimate ?? 0;
    const targetPrice = frame.targetPrice ?? 0;
    const distance = estimate - targetPrice;
    const side = distance >= 0 ? "YES" : "NO";
    const ask = askForSide(side, frame);
    const fairProbability = side === "YES"
      ? clamp(0.5 + distance / 0.0012, 0.01, 0.99)
      : clamp(0.5 - distance / 0.0012, 0.01, 0.99);
    const confidence = clamp(Math.round(45 + Math.min(1, Math.abs(distance) / 0.00022) * 50), 0, 100);
    const edge = ask === null ? -1 : roundRatio(fairProbability - ask - 0.014);
    const spread = spreadForSide(side, frame);
    const allowed = Math.abs(distance) >= minDistance && edge > 0 && yesProbationAllows(side, edge, confidence, spread);
    return signal(allowed ? side : null, edge, confidence, confidence >= 82 ? 5 : confidence >= 68 ? 3 : 1, fairProbability, `Distance variant requiring at least ${minDistance.toFixed(5)} from the target.`);
  };
}

function spreadScalpSignal(maxSpread) {
  return (frame) => {
    const yesEdge = frame.yesAsk === null ? -1 : frame.fairProbability - frame.yesAsk - 0.006;
    const noEdge = frame.noAsk === null ? -1 : (1 - frame.fairProbability) - frame.noAsk - 0.006;
    const side = yesEdge >= noEdge ? "YES" : "NO";
    const spread = spreadForSide(side, frame);
    const edge = side === "YES" ? yesEdge : noEdge;
    const confidence = clamp(Math.round(55 + Math.max(0, edge) * 130), 0, 92);
    const allowed = spread <= maxSpread && edge > 0 && yesProbationAllows(side, edge, confidence, spread);
    return signal(allowed ? side : null, roundRatio(edge), confidence, spread <= 0.02 ? 3 : 1, side === "YES" ? frame.fairProbability : 1 - frame.fairProbability, `Paper variant scalp with a hard ${(maxSpread * 100).toFixed(0)}c spread cap.`);
  };
}

function signal(side, edgeAfterFees, confidence, contracts, fairProbability, reason) {
  return {
    side,
    edgeAfterFees: roundRatio(edgeAfterFees),
    confidence,
    contracts,
    fairProbability: roundRatio(fairProbability),
    reason,
  };
}

function managedExit({ takeProfit, stopLoss, maxHoldSeconds = null, exitBeforeClose = null }) {
  return (trade, frame, currentSignal) => {
    const exitPrice = bidForSide(trade.side, frame, currentSignal);
    if (!Number.isFinite(exitPrice)) return null;
    const unitPnl = exitPrice - trade.entryPrice;
    const ageSeconds = (Date.parse(frame.observedAt) - Date.parse(trade.openedAt)) / 1000;
    if (unitPnl >= takeProfit) return { price: exitPrice, reason: `Managed take-profit at ${priceLabel(takeProfit)}.` };
    if (unitPnl <= -stopLoss) return { price: exitPrice, reason: `Managed stop-loss at ${priceLabel(stopLoss)}.` };
    if (maxHoldSeconds !== null && ageSeconds >= maxHoldSeconds) return { price: exitPrice, reason: `Managed max hold of ${maxHoldSeconds}s reached.` };
    if (exitBeforeClose !== null && frame.secondsToClose <= exitBeforeClose) return { price: exitPrice, reason: `Managed exit ${exitBeforeClose}s before close.` };
    return null;
  };
}

function sideCandidate(side, frame, feeBuffer) {
  const ask = askForSide(side, frame);
  const spread = spreadForSide(side, frame);
  const fairProbability = side === "YES" ? frame.fairProbability : 1 - frame.fairProbability;
  const edge = ask === null ? -1 : roundRatio(fairProbability - ask - feeBuffer);
  const confidence = clamp(Math.round(50 + Math.max(0, edge) * 180 - Math.max(0, spread - 0.02) * 120), 0, 96);
  return {
    side,
    ask,
    bid: bidValueForSide(side, frame),
    fairProbability,
    spread,
    edge,
    confidence,
  };
}

async function writeJsonIfMissing(filePath, value) {
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }
}

function sideFromAction(action) {
  if (action === "buy_yes") return "YES";
  if (action === "buy_no") return "NO";
  return null;
}

function oppositeSide(side) {
  return side === "YES" ? "NO" : "YES";
}

function askForSide(side, frame) {
  if (side === "BOTH") {
    return frame.yesAsk !== null && frame.noAsk !== null ? roundPrice(frame.yesAsk + frame.noAsk) : null;
  }
  return side === "YES" ? frame.yesAsk : frame.noAsk;
}

function bidValueForSide(side, frame) {
  if (side === "BOTH") {
    return frame.yesBid !== null && frame.noBid !== null ? roundPrice(frame.yesBid + frame.noBid) : null;
  }
  return side === "YES" ? frame.yesBid : frame.noBid;
}

function bidForSide(side, frame, currentSignal) {
  const bid = bidValueForSide(side, frame);
  const maxBid = side === "BOTH" ? 1.1 : 1;
  if (bid !== null && bid > 0 && bid < maxBid) return bid;
  if (side === "BOTH") return 1;
  return clamp(side === "YES" ? currentSignal.fairProbability : 1 - currentSignal.fairProbability, 0, 1);
}

function spreadForSide(side, frame, fallback = Number.POSITIVE_INFINITY) {
  if (side === "BOTH") {
    const ask = askForSide(side, frame);
    const bid = bidValueForSide(side, frame);
    if (ask === null || bid === null) return fallback;
    return Math.max(0, ask - bid);
  }
  const storedSpread = side === "YES" ? frame.yesSpread : frame.noSpread;
  if (storedSpread !== null && Number.isFinite(storedSpread)) return storedSpread;
  const ask = askForSide(side, frame);
  const bid = bidValueForSide(side, frame);
  if (ask === null || bid === null) return fallback;
  return Math.max(0, ask - bid);
}

function bidDepthForSide(side, frame) {
  if (side === "YES") return frame.yesBidDepth ?? 0;
  if (side === "NO") return frame.noBidDepth ?? 0;
  return 0;
}

function depthImbalanceForSide(side, frame) {
  const selected = bidDepthForSide(side, frame);
  const other = bidDepthForSide(oppositeSide(side), frame);
  const total = selected + other;
  return total > 0 ? roundRatio((selected - other) / total) : 0;
}

function yesProbationAllows(side, edgeAfterFees, confidence, spread) {
  if (side !== "YES") return true;
  return edgeAfterFees >= 0.18 && confidence >= 80 && spread <= 0.02;
}

function yesGateAllows(mode, side, edgeAfterFees, confidence, spread) {
  if (side !== "YES" || mode === "none") return true;
  if (mode === "loose") return edgeAfterFees >= 0.08 && confidence >= 65 && spread <= 0.06;
  return yesProbationAllows(side, edgeAfterFees, confidence, spread);
}

function contractsForConfidence(confidence) {
  if (confidence >= 85) return 5;
  if (confidence >= 72) return 3;
  return 1;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function priceLabel(value) {
  return `${(value * 100).toFixed(1)}c`;
}

function marketLabel(value) {
  return value.toFixed(5);
}

function movePercentLabel(value) {
  const displayed = value * 100;
  if (displayed < 0.01) return `${displayed.toFixed(3)}%`;
  if (displayed < 0.1) return `${displayed.toFixed(2)}%`;
  return `${displayed.toFixed(1)}%`;
}

function idRatio(value) {
  return Math.round(value * 10000);
}

function idMoveRatio(value) {
  return Math.round(value * 1000000);
}

function idMarket(value) {
  return Math.round(value * 100000);
}

function money(value) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function roundPrice(value) {
  return Number(value.toFixed(4));
}

function roundRatio(value) {
  return Number(value.toFixed(4));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function depthValues(baseValues, deepOnlyValues) {
  if (!deepSweepMode) return baseValues;
  return [...new Set([...baseValues, ...deepOnlyValues])].sort((left, right) => left - right);
}

function assertUniqueAlgoIds(algos) {
  const seen = new Set();
  const duplicates = [];
  for (const algo of algos) {
    if (seen.has(algo.id)) {
      duplicates.push(algo.id);
    }
    seen.add(algo.id);
  }
  if (duplicates.length > 0) {
    throw new Error(`Duplicate algo IDs: ${[...new Set(duplicates)].slice(0, 20).join(", ")}`);
  }
}
