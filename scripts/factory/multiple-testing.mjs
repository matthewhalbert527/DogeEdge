import { average, roundRatio, seededRandom } from "./utils.mjs";

export function multipleTestingAdjustments(metrics, options = {}) {
  const iterations = Math.max(100, Math.min(5_000, Number(options.bootstrapIterations ?? 400)));
  const seed = String(options.seed ?? "factory-multiple-testing");
  const globalNull = bootstrapNullDistribution(metrics, iterations, seed);
  const byFamily = {};
  for (const metric of metrics) {
    byFamily[metric.family] ??= [];
    byFamily[metric.family].push(metric);
  }
  const familyNulls = Object.fromEntries(Object.entries(byFamily).map(([family, rows]) => [family, bootstrapNullDistribution(rows, iterations, `${seed}:${family}`)]));
  return Object.fromEntries(metrics.map((metric) => {
    const statistic = performanceStatistic(metric);
    const familyAdjustedPValue = pValue(statistic, familyNulls[metric.family] ?? []);
    const globalAdjustedPValue = pValue(statistic, globalNull);
    const falseDiscoveryRisk = roundRatio(Math.min(1, (familyAdjustedPValue + globalAdjustedPValue) / 2));
    return [metric.algoId, {
      familyAdjustedPValue,
      globalAdjustedPValue,
      falseDiscoveryRisk,
      realityCheckApprox: true,
      spaApprox: true,
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

function bootstrapNullDistribution(metrics, iterations, seed) {
  const tradePnls = metrics.flatMap((metric) => (metric.closedTrades ?? []).map((trade) => Number(trade.pnl ?? 0)));
  const centered = center(tradePnls);
  if (!centered.length) return [0];
  const rng = seededRandom(seed);
  const distribution = [];
  for (let index = 0; index < iterations; index += 1) {
    const sample = [];
    for (let draw = 0; draw < centered.length; draw += 1) {
      sample.push(centered[Math.floor(rng() * centered.length)]);
    }
    distribution.push(average(sample) ?? 0);
  }
  return distribution.sort((left, right) => left - right);
}

function center(values) {
  const finite = values.filter(Number.isFinite);
  const mean = average(finite) ?? 0;
  return finite.map((value) => value - mean);
}

function pValue(statistic, nullDistribution) {
  if (!nullDistribution.length) return 1;
  const exceedances = nullDistribution.filter((value) => value >= statistic).length;
  return roundRatio((exceedances + 1) / (nullDistribution.length + 1));
}

