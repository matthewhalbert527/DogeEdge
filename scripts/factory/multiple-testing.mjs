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

  return Object.fromEntries(metrics.map((metric) => {
    const familyNull = familyNulls[metric.family] ?? emptyNull();
    const observed = observedStatistic(metric);
    const familyAdjustedPValue = pValue(observed.studentized, familyNull.spa);
    const globalAdjustedPValue = pValue(observed.studentized, globalNull.spa);
    const realityCheckApproxPValue = pValue(observed.mean, globalNull.realityCheck);
    const spaApproxPValue = globalAdjustedPValue;
    const falseDiscoveryRisk = roundRatio(Math.min(1, (familyAdjustedPValue * 0.45) + (globalAdjustedPValue * 0.45) + (realityCheckApproxPValue * 0.1)));
    return [metric.algoId, {
      familyAdjustedPValue,
      globalAdjustedPValue,
      falseDiscoveryRisk,
      realityCheckApproxPValue,
      spaApproxPValue,
      realityCheckApprox: true,
      spaApprox: true,
      multipleTestingMethod: "market_block_menu_bootstrap_approx",
      multipleTestingIterations: iterations,
      multipleTestingSeed: childSeed(rootSeed, metric.family, metric.algoId),
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
