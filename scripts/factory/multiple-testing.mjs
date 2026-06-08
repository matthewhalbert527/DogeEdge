import { average, childSeed, roundRatio, seededRandom, stddev } from "./utils.mjs";

// Practical White Reality Check / Hansen SPA approximations:
// White (2000) tests the best model from a searched menu against a benchmark with
// bootstrap dependence preserved. Hansen (2005) improves power by studentizing
// and reducing the influence of poor alternatives. Here each 15m market is a
// bootstrap block, and each strategy contributes one P/L series over those blocks.
export function multipleTestingAdjustments(metrics, options = {}) {
  const iterationCap = metrics.length > 3_000 ? 200 : metrics.length > 1_000 ? 300 : 5_000;
  const iterations = Math.max(100, Math.min(iterationCap, Number(options.bootstrapIterations ?? 400)));
  const rootSeed = String(options.seed ?? "factory-multiple-testing");
  const globalNull = menuBootstrapNull(metrics, {
    iterations,
    seed: childSeed(rootSeed, "global-menu"),
  });
  const byFamily = {};
  for (const metric of metrics) {
    byFamily[metric.family] ??= [];
    byFamily[metric.family].push(metric);
  }
  const familyNulls = Object.fromEntries(Object.entries(byFamily).map(([family, rows]) => [family, menuBootstrapNull(rows, {
    iterations,
    seed: childSeed(rootSeed, "family-menu", family),
  })]));

  const rawRows = metrics.map((metric) => {
    const familyNull = familyNulls[metric.family] ?? emptyNull();
    const observed = observedStatistic(metric);
    const familyAdjustedPValue = pValue(observed.studentized, familyNull.spa);
    const globalAdjustedPValue = pValue(observed.studentized, globalNull.spa);
    const realityCheckApproxPValue = pValue(observed.mean, globalNull.realityCheck);
    const spaApproxPValue = globalAdjustedPValue;
    return {
      metric,
      observed,
      familyAdjustedPValue,
      globalAdjustedPValue,
      realityCheckApproxPValue,
      spaApproxPValue,
    };
  });
  const globalQ = qValueMap(rawRows.map((row) => [row.metric.algoId, row.globalAdjustedPValue]), { method: "BY" });
  const familyQ = {};
  for (const [family, rows] of Object.entries(byFamily)) {
    const ids = new Set(rows.map((metric) => metric.algoId));
    Object.assign(familyQ, qValueMap(rawRows.filter((row) => ids.has(row.metric.algoId)).map((row) => [row.metric.algoId, row.familyAdjustedPValue]), { method: "BH" }));
  }
  const effectiveGlobalTrials = effectiveTrialCount(metrics);
  const effectiveFamilyTrials = Object.fromEntries(Object.entries(byFamily).map(([family, rows]) => [family, effectiveTrialCount(rows)]));
  return Object.fromEntries(rawRows.map((row) => {
    const familyQValue = familyQ[row.metric.algoId] ?? 1;
    const globalQValue = globalQ[row.metric.algoId] ?? 1;
    const falseDiscoveryRisk = roundRatio(Math.min(1, (
      row.familyAdjustedPValue * 0.25
      + row.globalAdjustedPValue * 0.25
      + familyQValue * 0.2
      + globalQValue * 0.2
      + row.realityCheckApproxPValue * 0.1
    )));
    return [row.metric.algoId, {
      familyAdjustedPValue: row.familyAdjustedPValue,
      globalAdjustedPValue: row.globalAdjustedPValue,
      familyQValue,
      globalQValue,
      falseDiscoveryRisk,
      realityCheckApproxPValue: row.realityCheckApproxPValue,
      spaApproxPValue: row.spaApproxPValue,
      realityCheckApprox: true,
      spaApprox: true,
      multipleTestingMethod: "market_block_menu_bootstrap_with_q_values_approx",
      multipleTestingIterations: iterations,
      multipleTestingSeed: childSeed(rootSeed, row.metric.family, row.metric.algoId),
      effectiveFamilyTrials: effectiveFamilyTrials[row.metric.family] ?? 1,
      effectiveGlobalTrials,
    }];
  }));
}

export function performanceStatistic(metric) {
  const conservative = metric.costModels?.conservative ?? metric;
  const mean = conservative.averagePnl ?? 0;
  const lower = conservative.bootstrap?.meanPnl?.lower ?? mean;
  const foldRate = metric.foldSummary?.positiveFoldRate ?? 0;
  const cpcvRate = metric.cpcvSummary?.positiveFoldRate ?? 0;
  return roundRatio(mean + lower + foldRate * 0.02 + cpcvRate * 0.02);
}

function menuBootstrapNull(metrics, options) {
  const rows = metrics.map((metric) => ({
    metric,
    series: marketBlockSeries(metric),
  })).filter((row) => row.series.values.length > 0);
  if (!rows.length) return emptyNull();
  const marketIds = [...new Set(rows.flatMap((row) => row.series.marketIds))].sort();
  const centeredRows = rows.map((row) => ({
    mean: row.series.mean,
    stdev: row.series.stdev,
    byMarket: row.series.byMarket,
  }));
  const rng = seededRandom(options.seed);
  const realityCheck = [];
  const spa = [];
  for (let index = 0; index < options.iterations; index += 1) {
    let maxMean = Number.NEGATIVE_INFINITY;
    let maxStudentized = Number.NEGATIVE_INFINITY;
    for (const row of centeredRows) {
      const sample = [];
      for (let draw = 0; draw < marketIds.length; draw += 1) {
        const market = marketIds[Math.floor(rng() * marketIds.length)];
        sample.push((row.byMarket.get(market) ?? 0) - row.mean);
      }
      const sampleMean = average(sample) ?? 0;
      const sampleStd = stddev(sample) ?? 0;
      maxMean = Math.max(maxMean, sampleMean);
      maxStudentized = Math.max(maxStudentized, sampleStd > 0 ? sampleMean / (sampleStd / Math.sqrt(sample.length)) : sampleMean > 0 ? Number.POSITIVE_INFINITY : 0);
    }
    realityCheck.push(maxMean);
    spa.push(Math.max(0, maxStudentized));
  }
  return {
    realityCheck: realityCheck.sort((left, right) => left - right),
    spa: spa.sort((left, right) => left - right),
  };
}

function marketBlockSeries(metric) {
  const byMarket = new Map();
  for (const trade of metric.closedTrades ?? []) {
    const key = trade.marketTicker ?? trade.market_id ?? trade.marketId ?? "unknown";
    byMarket.set(key, (byMarket.get(key) ?? 0) + Number(trade.pnl ?? 0));
  }
  const marketIds = [...byMarket.keys()].sort();
  const values = marketIds.map((key) => byMarket.get(key) ?? 0);
  return {
    marketIds,
    values,
    byMarket,
    mean: average(values) ?? 0,
    stdev: stddev(values) ?? 0,
  };
}

export function effectiveTrialCount(metrics) {
  if (metrics.length <= 1) return metrics.length;
  const marketIds = [...new Set(metrics.flatMap((metric) => marketBlockSeries(metric).marketIds))].sort();
  if (!marketIds.length) return metrics.length;
  const vectors = metrics.map((metric) => {
    const series = marketBlockSeries(metric);
    return marketIds.map((id) => series.byMarket.get(id) ?? 0);
  });
  const correlations = [];
  for (let left = 0; left < vectors.length; left += 1) {
    for (let right = left + 1; right < vectors.length; right += 1) {
      correlations.push(Math.abs(correlation(vectors[left], vectors[right])));
    }
  }
  const meanAbsCorrelation = average(correlations.filter(Number.isFinite)) ?? 0;
  return roundRatio(Math.max(1, Math.min(metrics.length, 1 + (metrics.length - 1) * (1 - meanAbsCorrelation))));
}

export function qValueMap(pairs, { method = "BH" } = {}) {
  const sorted = pairs
    .map(([id, pValue]) => ({ id, pValue: Math.min(1, Math.max(0, Number(pValue ?? 1))) }))
    .sort((left, right) => left.pValue - right.pValue);
  const m = sorted.length;
  if (!m) return {};
  const harmonic = method === "BY"
    ? Array.from({ length: m }, (_, index) => 1 / (index + 1)).reduce((total, value) => total + value, 0)
    : 1;
  let running = 1;
  const output = {};
  for (let index = m - 1; index >= 0; index -= 1) {
    const rank = index + 1;
    running = Math.min(running, sorted[index].pValue * m * harmonic / rank);
    output[sorted[index].id] = roundRatio(Math.min(1, running));
  }
  return output;
}

function correlation(left, right) {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = average(left) ?? 0;
  const rightMean = average(right) ?? 0;
  let numerator = 0;
  let leftDenominator = 0;
  let rightDenominator = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftDenominator += leftDelta ** 2;
    rightDenominator += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftDenominator * rightDenominator);
  return denominator > 0 ? numerator / denominator : 0;
}

function observedStatistic(metric) {
  const series = marketBlockSeries(metric);
  const mean = series.mean;
  const studentized = series.stdev > 0 && series.values.length > 1
    ? mean / (series.stdev / Math.sqrt(series.values.length))
    : mean > 0 ? Number.POSITIVE_INFINITY : 0;
  return {
    mean: roundRatio(mean),
    studentized: roundRatio(studentized),
  };
}

function pValue(statistic, nullDistribution) {
  if (!nullDistribution.length || !Number.isFinite(statistic)) return statistic === Number.POSITIVE_INFINITY ? roundRatio(1 / (nullDistribution.length + 1)) : 1;
  const exceedances = nullDistribution.filter((value) => value >= statistic).length;
  return roundRatio((exceedances + 1) / (nullDistribution.length + 1));
}

function emptyNull() {
  return { realityCheck: [0], spa: [0] };
}
