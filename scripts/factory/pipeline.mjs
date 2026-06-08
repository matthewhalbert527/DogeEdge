import { dataQualitySummary, filterFramesByTime, buildMarketEvents } from "./data.mjs";
import { chronologicalSplit, cpcvApproximationFolds, purgedEmbargoFolds } from "./splits.mjs";
import { defaultCostModels, simulateAlgos } from "./simulator.mjs";
import { costComparisonMetrics, executionTelemetryForSimulation, foldMetricsForAlgo, metricsForAlgo, summarizeFoldMetrics, trainMetricsForAlgo } from "./metrics.mjs";
import { attachClosedTrades, candidateMetrics, rankFactoryMetrics } from "./ranking.mjs";
import { finalHoldoutSplit, holdoutSummary } from "./holdout.mjs";
import { paperEvidenceForAlgo } from "./paper-evidence.mjs";
import { roundRatio } from "./utils.mjs";
import { defaultSampleGateThresholds, insufficientDataMetrics, sampleSufficiency } from "./sample-gates.mjs";

export function runFactoryResearchPipeline({ algos, loadResult, since = null, until = null, options = {} }) {
  const filteredFrames = filterFramesByTime(loadResult.frames, { since, until });
  const eventResult = buildMarketEvents(filteredFrames, options);
  const events = eventResult.events;
  const holdoutSplit = finalHoldoutSplit(events, {
    holdoutRatio: options.holdoutRatio ?? 0.2,
    minHoldoutEvents: options.minHoldoutEvents ?? options.thresholds?.minHoldoutEvents ?? defaultSampleGateThresholds.minHoldoutEvents,
  });
  const researchEvents = holdoutSplit.researchEvents;
  const split = chronologicalSplit(researchEvents, {
    validationRatio: options.validationRatio ?? 0.2,
    testRatio: options.testRatio ?? 0.2,
  });
  const purgedFolds = purgedEmbargoFolds(researchEvents, {
    foldCount: options.foldCount ?? 5,
    embargoMs: options.embargoMs,
  });
  const cpcvFolds = cpcvApproximationFolds(researchEvents, {
    foldCount: options.foldCount ?? 5,
    embargoMs: options.embargoMs,
    maxCombinations: options.maxCpcvCombinations ?? 10,
  });
  const baseDataQuality = dataQualitySummary({
    ...loadResult,
    frameCount: filteredFrames.length,
    eventCount: events.length,
    warnings: [...loadResult.warnings, ...eventResult.warnings],
  });
  const sufficiency = sampleSufficiency({
    events,
    holdoutSplit,
    folds: purgedFolds,
    thresholds: options.sampleThresholds ?? options.thresholds ?? {},
  });
  if (!sufficiency.ok) {
    const sampleWarning = { message: sufficiency.warning, reasonCodes: sufficiency.reasonCodes, counts: sufficiency.counts };
    const dataQuality = { ...baseDataQuality, sampleSufficiency: sufficiency };
    const metrics = insufficientDataMetrics(algos, sufficiency, dataQuality, options);
    return {
      frames: filteredFrames,
      events,
      holdoutSplit,
      split: {
        trainEventIds: split.train.map((event) => event.id),
        validationEventIds: split.validation.map((event) => event.id),
        testEventIds: split.test.map((event) => event.id),
        holdoutEventIds: holdoutSplit.holdoutEventIds,
      },
      purgedFolds,
      cpcvFolds,
      metrics,
      candidates: [],
      trades: [],
      costModels: options.costModels ?? defaultCostModels,
      dataQuality,
      warnings: [...loadResult.warnings, ...eventResult.warnings, sampleWarning],
    };
  }
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
    const cpcvTrainMetrics = trainMetricsForAlgo(simulation.algo, conservative.trades, cpcvFolds, options);
    const cpcvSummary = summarizeFoldMetrics(cpcvMetrics);
    const testEventIds = new Set(split.test.map((event) => event.id));
    const holdoutEventIds = new Set(holdoutSplit.holdoutEventIds);
    const walkForwardMetric = metricsForAlgo(simulation.algo, base.trades.filter((trade) => testEventIds.has(trade.marketTicker)), options);
    const walkForwardConservativeMetric = metricsForAlgo(simulation.algo, conservative.trades.filter((trade) => testEventIds.has(trade.marketTicker)), options);
    const holdoutMetric = metricsForAlgo(simulation.algo, base.trades.filter((trade) => holdoutEventIds.has(trade.marketTicker)), options);
    const holdoutConservativeMetric = metricsForAlgo(simulation.algo, conservative.trades.filter((trade) => holdoutEventIds.has(trade.marketTicker)), options);
    const holdout = holdoutSummary({
      baseMetric: holdoutMetric,
      conservativeMetric: holdoutConservativeMetric,
      thresholds: options.thresholds,
    });
    const holdoutEvidence = {
      ...holdout,
      immutable: holdoutSplit.immutable,
      strictlyLater: holdoutSplit.strictlyLater,
      latestResearchEnd: holdoutSplit.latestResearchEnd,
      earliestHoldoutStart: holdoutSplit.earliestHoldoutStart,
      reason: holdoutSplit.reason,
    };
    const walkForwardSummary = {
      closed: walkForwardMetric.closed,
      totalPnl: walkForwardMetric.totalPnl,
      roi: walkForwardMetric.roi,
      conservativeClosed: walkForwardConservativeMetric.closed,
      conservativeTotalPnl: walkForwardConservativeMetric.totalPnl,
      conservativeRoi: walkForwardConservativeMetric.roi,
      pass: walkForwardConservativeMetric.closed > 0 && walkForwardConservativeMetric.totalPnl > 0 && walkForwardConservativeMetric.roi > 0,
    };
    const validationTrades = conservative.trades.filter((trade) => testEventIds.has(trade.marketTicker));
    const paperEvidence = paperEvidenceForAlgo(simulation.algo.id, options.paperEvidence, {
      validationTrades,
      validationRegimes: regimeShareFromTrades(validationTrades),
      validationFill: fillQualityFromSimulation(conservative),
    });
    const drift = paperEvidence.drift;
    const metric = attachClosedTrades({
      ...baseMetric,
      costModels: costModelsMetrics,
      conservativeTotalPnl: costModelsMetrics.conservative?.totalPnl ?? 0,
      stressTotalPnl: costModelsMetrics.stress?.totalPnl ?? 0,
      foldMetrics,
      foldSummary,
      purgedSummary: foldSummary,
      cpcvMetrics,
      cpcvTrainMetrics,
      cpcvSummary,
      walkForwardSummary,
      holdoutSummary: holdoutEvidence,
      drift,
      paperEvidence,
      walkForwardPass: walkForwardSummary.pass,
      walkForwardClosed: walkForwardMetric.closed,
      walkForwardWins: walkForwardMetric.wins,
      walkForwardLosses: walkForwardMetric.losses,
      walkForwardWinRate: walkForwardMetric.winRate,
      walkForwardTotalPnl: walkForwardMetric.totalPnl,
      walkForwardTotalCost: walkForwardMetric.totalCost,
      walkForwardRoi: walkForwardMetric.roi,
      walkForwardMaxDrawdown: walkForwardMetric.maxDrawdown,
      holdoutStrictlyLater: holdoutSplit.strictlyLater,
      holdoutClosed: holdoutEvidence.holdoutClosed,
      holdoutTotalPnl: holdoutEvidence.holdoutTotalPnl,
      holdoutRoi: holdoutEvidence.holdoutRoi,
      holdoutMaxDrawdown: holdoutEvidence.holdoutMaxDrawdown,
      holdoutPositive: holdoutEvidence.holdoutPositive,
      holdoutConservativeTotalPnl: holdoutEvidence.holdoutConservativeTotalPnl,
      holdoutLowerCi: holdoutEvidence.holdoutLowerCi,
      holdoutPass: holdoutEvidence.holdoutPass,
      rejects: Object.fromEntries(Object.entries(simulation.byCostModel).map(([id, result]) => [id, rejectSummary(result.rejects)])),
      executionTelemetry: Object.fromEntries(Object.entries(simulation.byCostModel).map(([id, result]) => [id, executionTelemetryForSimulation(result)])),
      fillQuality: fillQualityFromSimulation(conservative),
      dataQuality: {
        ...baseDataQuality,
        sampleSufficiency: sufficiency,
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
    holdoutSplit,
    split: {
      trainEventIds: split.train.map((event) => event.id),
      validationEventIds: split.validation.map((event) => event.id),
      testEventIds: split.test.map((event) => event.id),
      holdoutEventIds: holdoutSplit.holdoutEventIds,
    },
    purgedFolds,
    cpcvFolds,
    metrics: rankedMetrics,
    candidates,
    trades,
    costModels,
    dataQuality: {
      ...baseDataQuality,
      sampleSufficiency: sufficiency,
    },
    warnings: [...loadResult.warnings, ...eventResult.warnings],
  };
}

function publicMetric(metric) {
  const {
    closedTrades: _closedTrades,
    foldMetrics,
    cpcvMetrics,
    cpcvTrainMetrics,
    costModels,
    equityCurve: _equityCurve,
    regimeBreakdown,
    ...rest
  } = metric;
  return {
    ...rest,
    costModels: compactCostModels(costModels),
    foldMetrics: compactFoldMetrics(foldMetrics),
    cpcvMetrics: compactFoldMetrics(cpcvMetrics),
    cpcvPathMetrics: compactCpcvPathMetrics(cpcvMetrics, cpcvTrainMetrics),
    regimeBreakdown: compactRegimeBreakdown(regimeBreakdown),
  };
}

function compactCostModels(costModels = {}) {
  return Object.fromEntries(Object.entries(costModels).map(([id, metric]) => [id, {
    closed: metric.closed,
    independentClosedMarkets: metric.independentClosedMarkets,
    daysRepresented: metric.daysRepresented,
    wins: metric.wins,
    losses: metric.losses,
    winRate: metric.winRate,
    averagePnl: metric.averagePnl,
    totalPnl: metric.totalPnl,
    totalCost: metric.totalCost,
    roi: metric.roi,
    maxDrawdown: metric.maxDrawdown,
    downsideDeviation: metric.downsideDeviation,
    profitFactor: metric.profitFactor,
    bootstrap: metric.bootstrap,
    averageSlippageCents: metric.averageSlippageCents,
    averagePartialFillRatio: metric.averagePartialFillRatio,
    averageFillProbability: metric.averageFillProbability,
    averageFillDepthUtilization: metric.averageFillDepthUtilization,
  }]));
}

function compactFoldMetrics(folds = []) {
  return folds.map((fold) => ({
    foldId: fold.foldId,
    trainEventCount: fold.trainEventCount,
    validationEventCount: fold.validationEventCount,
    purgedEventCount: fold.purgedEventCount,
    embargoedEventCount: fold.embargoedEventCount,
    closed: fold.closed,
    independentClosedMarkets: fold.independentClosedMarkets,
    wins: fold.wins,
    losses: fold.losses,
    winRate: fold.winRate,
    averagePnl: fold.averagePnl,
    totalPnl: fold.totalPnl,
    totalCost: fold.totalCost,
    roi: fold.roi,
    maxDrawdown: fold.maxDrawdown,
  }));
}

function compactCpcvPathMetrics(validationFolds = [], trainFolds = []) {
  const trainById = new Map(trainFolds.map((fold) => [fold.foldId, fold]));
  return validationFolds.map((fold) => {
    const train = trainById.get(fold.foldId);
    return {
      foldId: fold.foldId,
      trainClosed: train?.closed ?? 0,
      trainTotalPnl: train?.totalPnl ?? 0,
      trainRoi: train?.roi ?? 0,
      validationClosed: fold.closed,
      validationTotalPnl: fold.totalPnl,
      validationRoi: fold.roi,
    };
  });
}

function compactRegimeBreakdown(regimeBreakdown = {}) {
  return regimeBreakdown;
}

function rejectSummary(rejects) {
  const summary = {};
  for (const reject of rejects) {
    summary[reject.reasonCode] = (summary[reject.reasonCode] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(summary).sort((left, right) => right[1] - left[1]).map(([key, value]) => [key, roundRatio(value)]));
}

function regimeShareFromTrades(trades) {
  const counts = {};
  for (const trade of trades) {
    const key = trade.entryContext?.regime?.timeToClose ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const total = Math.max(1, Object.values(counts).reduce((sum, value) => sum + value, 0));
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, roundRatio(value / total)]));
}

function fillQualityFromSimulation(simulation) {
  const telemetry = executionTelemetryForSimulation(simulation);
  return {
    fillRate: telemetry.fillRate,
    avgSlippage: telemetry.averageSlippageCents,
    averagePartialFillRatio: telemetry.averagePartialFillRatio,
    staleQuoteRejections: telemetry.staleQuoteRejections,
    queueMisses: telemetry.queueMisses,
    depthRejections: telemetry.depthRejections,
  };
}
