import { dataQualitySummary, filterFramesByTime, buildMarketEvents } from "./data.mjs";
import { chronologicalSplit, cpcvApproximationFolds, purgedEmbargoFolds } from "./splits.mjs";
import { defaultCostModels, simulateAlgos } from "./simulator.mjs";
import { costComparisonMetrics, foldMetricsForAlgo, metricsForAlgo, summarizeFoldMetrics } from "./metrics.mjs";
import { attachClosedTrades, candidateMetrics, rankFactoryMetrics } from "./ranking.mjs";
import { roundRatio } from "./utils.mjs";

export function runFactoryResearchPipeline({ algos, loadResult, since = null, until = null, options = {} }) {
  const filteredFrames = filterFramesByTime(loadResult.frames, { since, until });
  const eventResult = buildMarketEvents(filteredFrames, options);
  const events = eventResult.events;
  const split = chronologicalSplit(events, {
    validationRatio: options.validationRatio ?? 0.2,
    testRatio: options.testRatio ?? 0.2,
  });
  const purgedFolds = purgedEmbargoFolds(events, {
    foldCount: options.foldCount ?? 5,
    embargoMs: options.embargoMs,
  });
  const cpcvFolds = cpcvApproximationFolds(events, {
    foldCount: options.foldCount ?? 5,
    embargoMs: options.embargoMs,
    maxCombinations: options.maxCpcvCombinations ?? 10,
  });
  const costModels = options.costModels ?? defaultCostModels;
  const simulations = simulateAlgos(algos, events, {
    costModels,
    seed: options.seed,
    bootstrapIterations: options.bootstrapIterations,
  });

  const metrics = simulations.map((simulation) => {
    const base = simulation.byCostModel.base ?? Object.values(simulation.byCostModel)[0];
    const conservative = simulation.byCostModel.conservative ?? base;
    const baseMetric = metricsForAlgo(simulation.algo, base.trades, options);
    const costModelsMetrics = costComparisonMetrics(simulation.algo, simulation.byCostModel, options);
    const foldMetrics = foldMetricsForAlgo(simulation.algo, conservative.trades, purgedFolds, options);
    const foldSummary = summarizeFoldMetrics(foldMetrics);
    const cpcvMetrics = foldMetricsForAlgo(simulation.algo, conservative.trades, cpcvFolds, options);
    const cpcvSummary = summarizeFoldMetrics(cpcvMetrics);
    const testEventIds = new Set(split.test.map((event) => event.id));
    const walkForwardMetric = metricsForAlgo(simulation.algo, base.trades.filter((trade) => testEventIds.has(trade.marketTicker)), options);
    const metric = attachClosedTrades({
      ...baseMetric,
      costModels: costModelsMetrics,
      conservativeTotalPnl: costModelsMetrics.conservative?.totalPnl ?? 0,
      stressTotalPnl: costModelsMetrics.stress?.totalPnl ?? 0,
      foldMetrics,
      foldSummary,
      cpcvSummary,
      walkForwardPass: walkForwardMetric.closed > 0 && walkForwardMetric.totalPnl > 0 && walkForwardMetric.roi > 0,
      walkForwardClosed: walkForwardMetric.closed,
      walkForwardWins: walkForwardMetric.wins,
      walkForwardLosses: walkForwardMetric.losses,
      walkForwardWinRate: walkForwardMetric.winRate,
      walkForwardTotalPnl: walkForwardMetric.totalPnl,
      walkForwardTotalCost: walkForwardMetric.totalCost,
      walkForwardRoi: walkForwardMetric.roi,
      walkForwardMaxDrawdown: walkForwardMetric.maxDrawdown,
      rejects: Object.fromEntries(Object.entries(simulation.byCostModel).map(([id, result]) => [id, rejectSummary(result.rejects)])),
      dataQuality: {
        ...dataQualitySummary({
          ...loadResult,
          frameCount: filteredFrames.length,
          eventCount: events.length,
          warnings: [...loadResult.warnings, ...eventResult.warnings],
        }),
        permissiveDebug: Boolean(options.permissiveDebug),
      },
    }, base.trades);
    return metric;
  });

  const rankedMetrics = rankFactoryMetrics(metrics, options).map(publicMetric);
  const candidates = candidateMetrics(rankedMetrics);
  const trades = simulations.flatMap((simulation) => {
    const base = simulation.byCostModel.base ?? Object.values(simulation.byCostModel)[0];
    return base.trades.map((trade) => ({
      algoId: simulation.algo.id,
      algoName: simulation.algo.name,
      ...trade,
    }));
  }).sort((left, right) => String(left.algoName).localeCompare(String(right.algoName)) || Date.parse(left.openedAt) - Date.parse(right.openedAt));

  return {
    frames: filteredFrames,
    events,
    split: {
      trainEventIds: split.train.map((event) => event.id),
      validationEventIds: split.validation.map((event) => event.id),
      testEventIds: split.test.map((event) => event.id),
    },
    purgedFolds,
    cpcvFolds,
    metrics: rankedMetrics,
    candidates,
    trades,
    costModels,
    dataQuality: dataQualitySummary({
      ...loadResult,
      frameCount: filteredFrames.length,
      eventCount: events.length,
      warnings: [...loadResult.warnings, ...eventResult.warnings],
    }),
    warnings: [...loadResult.warnings, ...eventResult.warnings],
  };
}

function publicMetric(metric) {
  const { closedTrades: _closedTrades, ...rest } = metric;
  return rest;
}

function rejectSummary(rejects) {
  const summary = {};
  for (const reject of rejects) {
    summary[reject.reasonCode] = (summary[reject.reasonCode] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort((left, right) => right[1] - left[1]).map(([key, value]) => [key, roundRatio(value)]));
}
