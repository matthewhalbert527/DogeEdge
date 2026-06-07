import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hashJson } from "./utils.mjs";

const execFileAsync = promisify(execFile);

export async function experimentRegistryEntry({ repoRoot, dataRoot, framesDir, config, algos, folds, costModels, metricsVersion = "robust-v1", seed = "dogeedge" }) {
  return {
    gitCommit: await gitCommit(repoRoot),
    dataRoot,
    framesDir,
    dataHash: hashJson({
      framesDir,
      // The full data file hash can be expensive; config and frame count are included in run config.
      note: "Use rerun config plus local frame files for exact reproduction.",
    }),
    configHash: hashJson(config),
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
    costModel: costModels,
    riskModel: {
      maxPerTrade: "reported only; live router keeps separate hard caps",
      dailyLossStop: "reported only; no live orders enabled by factory",
    },
    metricsVersion,
    randomSeed: seed,
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
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { windowsHide: true });
    return stdout.trim();
  } catch {
    return null;
  }
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

