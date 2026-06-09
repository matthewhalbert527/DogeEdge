import { average, roundRatio } from "./utils.mjs";

const epsilon = 1e-6;

export function probabilityCalibrationForTrades(trades = [], { bucketCount = 10 } = {}) {
  const rows = trades
    .map((trade) => probabilityRowForTrade(trade))
    .filter(Boolean)
    .sort((left, right) => left.probability - right.probability);
  if (!rows.length) {
    return {
      schemaVersion: "dogeedge.probability-calibration.v1",
      labelKnownCount: 0,
      calibrationReady: false,
      brierScore: null,
      logLoss: null,
      expectedCalibrationError: null,
      reliabilityBuckets: [],
    };
  }
  const buckets = reliabilityBuckets(rows, bucketCount);
  return {
    schemaVersion: "dogeedge.probability-calibration.v1",
    labelKnownCount: rows.length,
    calibrationReady: rows.length >= Math.max(10, bucketCount),
    brierScore: roundRatio(average(rows.map((row) => (row.probability - row.outcome) ** 2)) ?? 0),
    logLoss: roundRatio(average(rows.map((row) => -row.outcome * Math.log(clampProb(row.probability)) - (1 - row.outcome) * Math.log(1 - clampProb(row.probability)))) ?? 0),
    expectedCalibrationError: expectedCalibrationError(buckets, rows.length),
    reliabilityBuckets: buckets,
  };
}

function probabilityRowForTrade(trade) {
  if (!trade || trade.status !== "closed") return null;
  const outcome = outcomeForTrade(trade);
  if (outcome === null) return null;
  const probability = probabilityForTrade(trade);
  if (probability === null) return null;
  return { probability, outcome };
}

function outcomeForTrade(trade) {
  if (typeof trade.win === "boolean") return trade.win ? 1 : 0;
  if (typeof trade.pnl === "number" && Number.isFinite(trade.pnl)) return trade.pnl > 0 ? 1 : 0;
  const result = String(trade.result ?? "").toLowerCase();
  if (result === "win" || result === "won") return 1;
  if (result === "loss" || result === "lost") return 0;
  return null;
}

function probabilityForTrade(trade) {
  const context = trade.entryContext ?? {};
  const raw = context.calibratedProbability
    ?? context.fairProbability
    ?? context.confidence
    ?? inferProbabilityFromEdge(context.edgeAfterFees);
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return clampProb(raw);
}

function inferProbabilityFromEdge(edge) {
  if (typeof edge !== "number" || !Number.isFinite(edge)) return null;
  return 1 / (1 + Math.exp(-edge * 8));
}

function reliabilityBuckets(rows, bucketCount) {
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    bucket: index,
    lower: roundRatio(index / bucketCount),
    upper: roundRatio((index + 1) / bucketCount),
    count: 0,
    meanProbability: 0,
    empiricalWinRate: 0,
    absoluteError: 0,
  }));
  for (const row of rows) {
    const index = Math.min(bucketCount - 1, Math.floor(row.probability * bucketCount));
    const bucket = buckets[index];
    bucket.count += 1;
    bucket.meanProbability += row.probability;
    bucket.empiricalWinRate += row.outcome;
  }
  return buckets.map((bucket) => {
    if (bucket.count <= 0) return bucket;
    const meanProbability = bucket.meanProbability / bucket.count;
    const empiricalWinRate = bucket.empiricalWinRate / bucket.count;
    return {
      ...bucket,
      meanProbability: roundRatio(meanProbability),
      empiricalWinRate: roundRatio(empiricalWinRate),
      absoluteError: roundRatio(Math.abs(meanProbability - empiricalWinRate)),
    };
  });
}

function expectedCalibrationError(buckets, total) {
  if (!total) return null;
  const ece = buckets.reduce((sum, bucket) => sum + (bucket.count / total) * bucket.absoluteError, 0);
  return roundRatio(ece);
}

function clampProb(value) {
  return Math.min(1 - epsilon, Math.max(epsilon, value));
}
