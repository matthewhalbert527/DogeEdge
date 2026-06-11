import { average, roundRatio } from "./utils.mjs";

const epsilon = 1e-6;
const tradeCalibrationSchemaVersion = "dogeedge.trade-calibration.v1";
const forecastCalibrationSchemaVersion = "dogeedge.forecast-calibration.v1";

export function probabilityCalibrationForTrades(trades = [], { bucketCount = 10 } = {}) {
  const rows = trades
    .map((trade) => probabilityRowForTrade(trade))
    .filter(Boolean)
    .sort((left, right) => left.probability - right.probability);
  return calibrationSummary(rows, {
    schemaVersion: "dogeedge.probability-calibration.v1",
    calibrationKind: "trade_outcome",
    bucketCount,
  });
}

export function tradeCalibrationByCandidate(trades = [], { bucketCount = 10 } = {}) {
  return groupedCalibrationRows(
    trades.map((trade) => {
      const row = probabilityRowForTrade(trade);
      if (!row) return null;
      return {
        ...row,
        ...candidateFields(trade),
      };
    }).filter(Boolean),
    {
      schemaVersion: tradeCalibrationSchemaVersion,
      calibrationKind: "trade_outcome",
      bucketCount,
    },
  );
}

export function forecastCalibrationForDecisionRows(rows = [], { bucketCount = 10 } = {}) {
  return groupedCalibrationRows(
    rows.map((row) => officialForecastProbabilityRow(row)).filter(Boolean),
    {
      schemaVersion: forecastCalibrationSchemaVersion,
      calibrationKind: "official_forecast",
      bucketCount,
    },
  );
}

export function officialForecastCalibrationReport(rows = [], { bucketCount = 10 } = {}) {
  const calibrationRows = rows
    .map((row) => officialForecastProbabilityRow(row))
    .filter(Boolean)
    .sort((left, right) => left.probability - right.probability);
  return calibrationSummary(calibrationRows, {
    schemaVersion: forecastCalibrationSchemaVersion,
    calibrationKind: "official_forecast",
    bucketCount,
  });
}

function calibrationSummary(rows, { schemaVersion, calibrationKind, bucketCount }) {
  if (!rows.length) {
    return emptyCalibrationSummary(schemaVersion, calibrationKind);
  }
  const buckets = reliabilityBuckets(rows, bucketCount);
  return {
    schemaVersion,
    calibrationKind,
    labelKnownCount: rows.length,
    calibrationReady: rows.length >= Math.max(10, bucketCount),
    brierScore: roundRatio(average(rows.map((row) => (row.probability - row.outcome) ** 2)) ?? 0),
    logLoss: roundRatio(average(rows.map((row) => -row.outcome * Math.log(clampProb(row.probability)) - (1 - row.outcome) * Math.log(1 - clampProb(row.probability)))) ?? 0),
    expectedCalibrationError: expectedCalibrationError(buckets, rows.length),
    reliabilityBuckets: buckets,
  };
}

function groupedCalibrationRows(rows, { schemaVersion, calibrationKind, bucketCount }) {
  const groups = new Map();
  for (const row of rows) {
    const key = candidateKey(row);
    const group = groups.get(key) ?? {
      schemaVersion,
      calibrationKind,
      candidateKey: key,
      algoId: row.algoId ?? "",
      family: row.family ?? "",
      researchCandidateId: row.researchCandidateId ?? "",
      candidateConfigHash: row.candidateConfigHash ?? "",
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const summary = calibrationSummary(group.rows.sort((left, right) => left.probability - right.probability), {
        schemaVersion,
        calibrationKind,
        bucketCount,
      });
      return {
        schemaVersion,
        calibrationKind,
        candidateKey: group.candidateKey,
        algoId: group.algoId,
        family: group.family,
        researchCandidateId: group.researchCandidateId,
        candidateConfigHash: group.candidateConfigHash,
        labelKnownCount: summary.labelKnownCount,
        calibrationReady: summary.calibrationReady,
        brierScore: summary.brierScore,
        logLoss: summary.logLoss,
        expectedCalibrationError: summary.expectedCalibrationError,
      };
    })
    .sort((left, right) => right.labelKnownCount - left.labelKnownCount || left.candidateKey.localeCompare(right.candidateKey));
}

function probabilityRowForTrade(trade) {
  if (!trade || trade.status !== "closed") return null;
  const outcome = outcomeForTrade(trade);
  if (outcome === null) return null;
  const probability = probabilityForTrade(trade);
  if (probability === null) return null;
  return { probability, outcome };
}

function officialForecastProbabilityRow(row) {
  if (!row || row.officialResolutionAvailable !== true || row.settlementSource !== "official_resolution") return null;
  const side = normalizeSide(row.side ?? sideFromAction(row.modelAction ?? row.decisionAction));
  if (side !== "YES" && side !== "NO") return null;
  const outcome = officialForecastOutcome(row, side);
  if (outcome === null) return null;
  const probability = probabilityForForecastRow(row, side);
  if (probability === null) return null;
  return {
    ...candidateFields(row),
    probability,
    outcome,
  };
}

function officialForecastOutcome(row, side) {
  const outcomeSide = normalizeSide(row.outcomeSide ?? row.officialOutcome ?? row.winningSide);
  if (outcomeSide === "YES" || outcomeSide === "NO") return outcomeSide === side ? 1 : 0;
  if (typeof row.exitPrice === "number" && Number.isFinite(row.exitPrice) && (row.exitPrice === 0 || row.exitPrice === 1)) {
    return row.exitPrice === 1 ? 1 : 0;
  }
  return null;
}

function outcomeForTrade(trade) {
  if (typeof trade.win === "boolean") return trade.win ? 1 : 0;
  if (typeof trade.pnl === "number" && Number.isFinite(trade.pnl)) return trade.pnl > 0 ? 1 : 0;
  const result = String(trade.result ?? "").toLowerCase();
  if (result === "win" || result === "won") return 1;
  if (result === "loss" || result === "lost") return 0;
  return null;
}

function probabilityForForecastRow(row, side) {
  const explicit = numeric(row.calibratedProbability ?? row.chosenSideProbability ?? row.probability);
  if (explicit !== null) return clampProb(explicit);
  const fairYes = numeric(row.fairProbability);
  if (fairYes !== null) {
    const yesProb = fairYes > 1 ? fairYes / 100 : fairYes;
    return clampProb(side === "YES" ? yesProb : 1 - yesProb);
  }
  const confidence = numeric(row.modelConfidence ?? row.confidence);
  if (confidence !== null) {
    return clampProb(confidence > 1 ? confidence / 100 : confidence);
  }
  return inferProbabilityFromEdge(numeric(row.modelEdgeAfterFees ?? row.edgeAfterFees));
}

function probabilityForTrade(trade) {
  const context = trade.entryContext ?? {};
  const raw = context.calibratedProbability
    ?? context.fairProbability
    ?? context.confidence
    ?? inferProbabilityFromEdge(context.edgeAfterFees);
  if (typeof raw !== "number" || !Number.isFinite(raw)) return probabilityForForecastRow(trade, normalizeSide(trade.side));
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

function candidateFields(row) {
  return {
    algoId: stringOrEmpty(row.algoId ?? row.strategyId),
    family: stringOrEmpty(row.family),
    researchCandidateId: stringOrEmpty(row.researchCandidateId),
    candidateConfigHash: stringOrEmpty(row.candidateConfigHash),
  };
}

function candidateKey(row) {
  const researchKey = exactIdentityKey(row.researchCandidateId, row.candidateConfigHash);
  return researchKey ?? (stringOrEmpty(row.algoId) || "unknown");
}

function exactIdentityKey(researchCandidateId, candidateConfigHash) {
  if (!researchCandidateId || !candidateConfigHash) return null;
  return `${researchCandidateId}:${candidateConfigHash}`;
}

function sideFromAction(action) {
  const value = String(action ?? "").toLowerCase();
  if (value.includes("yes")) return "YES";
  if (value.includes("no")) return "NO";
  return "";
}

function normalizeSide(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (text === "YES" || text === "Y" || text === "TRUE" || text === "1") return "YES";
  if (text === "NO" || text === "N" || text === "FALSE" || text === "0") return "NO";
  return "";
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function emptyCalibrationSummary(schemaVersion, calibrationKind) {
  return {
    schemaVersion,
    calibrationKind,
    labelKnownCount: 0,
    calibrationReady: false,
    brierScore: null,
    logLoss: null,
    expectedCalibrationError: null,
    reliabilityBuckets: [],
  };
}
