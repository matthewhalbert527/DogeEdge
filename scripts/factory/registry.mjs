import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { childSeed, hashJson } from "./utils.mjs";
import { decisionFrameInputManifest } from "./repro.mjs";

const execFileAsync = promisify(execFile);

export async function experimentRegistryEntry({ repoRoot, dataRoot, framesDir, config, algos, folds, cpcvFolds = [], holdoutSplit = null, costModels, riskModel = defaultRiskModel(), metricsVersion = "robust-v1", seed = "dogeedge" }) {
  const inputManifest = await decisionFrameInputManifest(framesDir);
  const commit = await gitCommit(repoRoot);
  return {
    gitCommit: commit,
    codeVersion: commit ?? "UNAVAILABLE",
    dataRoot,
    framesDir,
    inputManifestHash: inputManifest.manifestHash,
    inputFiles: inputManifest.files,
    dataHash: inputManifest.manifestHash,
    configHash: hashJson(config),
    schemaVersion: "dogeedge.factory.registry.v2",
    trialCount: algos.length,
    families: familyCounts(algos),
    parameterHashes: Object.fromEntries(algos.map((algo) => [algo.id, hashJson(algo.params ?? {})])),
    foldDefinitions: folds.map((fold) => ({
      id: fold.id,
      trainEventIds: fold.trainEventIds,
      validationEventIds: fold.validationEventIds,
      purgedEventIds: fold.purgedEventIds,
      embargoedEventIds: fold.embargoedEventIds,
      embargoMs: fold.embargoMs,
    })),
    cpcvFoldDefinitions: cpcvFolds.map((fold) => ({
      id: fold.id,
      trainEventIds: fold.trainEventIds,
      validationEventIds: fold.validationEventIds,
      purgedEventIds: fold.purgedEventIds,
      embargoedEventIds: fold.embargoedEventIds,
      embargoMs: fold.embargoMs,
    })),
    holdoutDefinition: holdoutSplit ? {
      immutable: holdoutSplit.immutable,
      strictlyLater: holdoutSplit.strictlyLater,
      reason: holdoutSplit.reason,
      latestResearchEnd: holdoutSplit.latestResearchEnd,
      earliestHoldoutStart: holdoutSplit.earliestHoldoutStart,
      holdoutEventIds: holdoutSplit.holdoutEventIds,
    } : null,
    costModel: costModels,
    costModelHash: hashJson(costModels),
    riskModel,
    riskModelHash: hashJson(riskModel),
    metricsVersion,
    randomSeed: seed,
    seedPlan: {
      rootSeed: seed,
      bootstrapSeed: childSeed(seed, "metrics-bootstrap"),
      multipleTestingSeed: childSeed(seed, "multiple-testing"),
      simulatorSeed: childSeed(seed, "simulator"),
      foldSeed: childSeed(seed, "folds"),
      deterministic: true,
    },
    reproducibility: {
      exactInputHashes: true,
      gitAvailable: Boolean(commit),
      partial: !commit,
      versionState: commit ? "git_commit_recorded" : "git_unavailable",
    },
  };
}

export async function compareRuns(leftPath, rightPath) {
  const [left, right] = await Promise.all([readJson(leftPath), readJson(rightPath)]);
  const leftRows = new Map((left.candidates ?? left.metrics ?? []).map((row, index) => [row.algoId, { row, rank: index + 1 }]));
  const rightRows = new Map((right.candidates ?? right.metrics ?? []).map((row, index) => [row.algoId, { row, rank: index + 1 }]));
  const changes = [];
  for (const [algoId, rightValue] of rightRows) {
    const leftValue = leftRows.get(algoId);
    changes.push({
      algoId,
      algoName: rightValue.row.algoName,
      previousRank: leftValue?.rank ?? null,
      currentRank: rightValue.rank,
      rankDelta: leftValue ? leftValue.rank - rightValue.rank : null,
      previousRobustScore: leftValue?.row.robustScore ?? leftValue?.row.candidateScore ?? null,
      currentRobustScore: rightValue.row.robustScore ?? rightValue.row.candidateScore ?? null,
      previousVerdict: leftValue?.row.promotionVerdict ?? null,
      currentVerdict: rightValue.row.promotionVerdict ?? null,
      reason: explainRankChange(leftValue?.row, rightValue.row),
    });
  }
  return changes.sort((leftChange, rightChange) => Math.abs(rightChange.rankDelta ?? 999) - Math.abs(leftChange.rankDelta ?? 999)).slice(0, 50);
}

async function gitCommit(repoRoot) {
  for (const gitBinary of gitCandidates()) {
    try {
      const { stdout } = await execFileAsync(gitBinary, ["-C", repoRoot, "rev-parse", "HEAD"], { windowsHide: true });
      return stdout.trim();
    } catch {
      // Try the next common Git location.
    }
  }
  return null;
}

function gitCandidates() {
  if (process.platform !== "win32") return ["git"];
  return [
    "git",
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
  ];
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function familyCounts(algos) {
  return algos.reduce((counts, algo) => {
    counts[algo.family] = (counts[algo.family] ?? 0) + 1;
    return counts;
  }, {});
}

function explainRankChange(left, right) {
  if (!left) return "New candidate in this run.";
  const reasons = [];
  if ((right.robustScore ?? 0) !== (left.robustScore ?? 0)) reasons.push("robust score changed");
  if ((right.promotionVerdict ?? "") !== (left.promotionVerdict ?? "")) reasons.push("promotion verdict changed");
  if ((right.costModels?.conservative?.totalPnl ?? 0) !== (left.costModels?.conservative?.totalPnl ?? 0)) reasons.push("conservative-cost P/L changed");
  if ((right.foldSummary?.positiveFoldRate ?? 0) !== (left.foldSummary?.positiveFoldRate ?? 0)) reasons.push("fold consistency changed");
  return reasons.join("; ") || "Tie-break order changed.";
}

function defaultRiskModel() {
  return {
    maxContractsPerTrade: 10,
    maxCostPerTradeDollars: 5,
    maxCostPerMarketDollars: 10,
    maxCostPerStrategyDollars: 25,
    dailyLossStopDollars: 10,
    rollingDrawdownKillSwitchDollars: 15,
    lossStreakCooldownTrades: 3,
    fractionalKellyCap: 0.02,
    liveOrdersEnabledByFactory: false,
  };
}
