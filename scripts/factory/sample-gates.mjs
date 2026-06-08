import { roundRatio } from "./utils.mjs";

export const defaultSampleGateThresholds = {
  minResearchEvents: 60,
  minHoldoutEvents: 12,
  minClosedTrades: 30,
  minIndependentMarkets: 50,
  minDays: 7,
  minFoldClosed: 5,
  maxInsufficientMetrics: 100,
};

export function sampleSufficiency({ events = [], holdoutSplit = null, folds = [], thresholds = {} } = {}) {
  const config = { ...defaultSampleGateThresholds, ...thresholds };
  const researchCount = holdoutSplit?.researchEvents?.length ?? events.length;
  const holdoutCount = holdoutSplit?.holdoutEvents?.length ?? holdoutSplit?.holdoutEventIds?.length ?? 0;
  const foldValidationMin = folds.length
    ? Math.min(...folds.map((fold) => fold.validationEventIds?.length ?? fold.validationEvents?.length ?? 0))
    : 0;
  const reasonCodes = [];
  if (events.length < config.minResearchEvents) reasonCodes.push("insufficient_research_events");
  if (holdoutCount < config.minHoldoutEvents) reasonCodes.push("insufficient_holdout_events");
  if (folds.length && foldValidationMin < config.minFoldClosed) reasonCodes.push("insufficient_fold_events");
  if (holdoutSplit?.strictlyLater === false) reasonCodes.push("holdout_not_strictly_later");
  return {
    ok: reasonCodes.length === 0,
    reasonCodes,
    thresholds: config,
    counts: {
      totalEvents: events.length,
      researchEvents: researchCount,
      holdoutEvents: holdoutCount,
      foldCount: folds.length,
      minFoldValidationEvents: foldValidationMin,
    },
    warning: reasonCodes.length
      ? `Research sample is too small for ranking or promotion: ${reasonCodes.join(", ")}.`
      : null,
  };
}

export function insufficientDataMetric(algo, sufficiency, dataQuality = {}) {
  return {
    algoId: algo.id,
    algoName: algo.name,
    family: algo.family,
    params: algo.params ?? {},
    closed: 0,
    open: 0,
    independentClosedMarkets: 0,
    daysRepresented: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    averagePnl: null,
    medianPnl: null,
    totalPnl: 0,
    totalCost: 0,
    roi: 0,
    maxDrawdown: 0,
    downsideDeviation: 0,
    profitFactor: 0,
    conservativeTotalPnl: 0,
    stressTotalPnl: 0,
    foldSummary: emptyFoldSummary(),
    purgedSummary: emptyFoldSummary(),
    cpcvSummary: emptyFoldSummary(),
    cpcvPathMetrics: [],
    walkForwardSummary: { closed: 0, totalPnl: 0, roi: 0, conservativeClosed: 0, conservativeTotalPnl: 0, conservativeRoi: 0, pass: false },
    holdoutSummary: {
      holdoutClosed: 0,
      holdoutMarkets: 0,
      holdoutTotalPnl: 0,
      holdoutRoi: 0,
      holdoutMaxDrawdown: 0,
      holdoutPositive: false,
      holdoutConservativeClosed: 0,
      holdoutConservativeMarkets: 0,
      holdoutConservativeTotalPnl: 0,
      holdoutConservativeRoi: 0,
      holdoutLowerCi: null,
      holdoutPass: false,
      strictlyLater: sufficiency.counts.holdoutEvents === 0 ? null : true,
    },
    paperEvidence: { available: false, status: "missing", closedMarkets: 0, closedTrades: 0, totalPnl: null, roi: null, driftOk: true, driftReasons: [], driftScore: 0 },
    drift: { driftOk: true, driftReasons: ["drift_not_evaluated_insufficient_sample"], driftScore: 0, sampleStatus: "insufficient_research_sample" },
    walkForwardPass: false,
    walkForwardClosed: 0,
    walkForwardTotalPnl: 0,
    walkForwardRoi: 0,
    holdoutPass: false,
    holdoutClosed: 0,
    holdoutConservativeTotalPnl: 0,
    holdoutLowerCi: null,
    psr: 0,
    dsrApprox: 0,
    pboApprox: 1,
    familyAdjustedPValue: 1,
    globalAdjustedPValue: 1,
    familyQValue: 1,
    globalQValue: 1,
    falseDiscoveryRisk: 1,
    adjustedConfidence: 0,
    robustScore: -999,
    candidateScore: -999,
    promotionVerdict: "insufficient_data",
    promotionStage: "research_candidate",
    reasonCodes: sufficiency.reasonCodes,
    warnings: ["sample_gate_failed"],
    nonPromotable: true,
    sampleSufficiency: sufficiency,
    dataQuality,
  };
}

export function insufficientDataMetrics(algos, sufficiency, dataQuality = {}, options = {}) {
  const limit = Math.max(1, Number(options.maxInsufficientMetrics ?? sufficiency.thresholds.maxInsufficientMetrics ?? defaultSampleGateThresholds.maxInsufficientMetrics));
  return algos.slice(0, limit).map((algo) => insufficientDataMetric(algo, sufficiency, dataQuality));
}

export function foldSampleWarnings(foldMetrics = [], thresholds = defaultSampleGateThresholds) {
  const tested = foldMetrics.filter((fold) => fold.closed > 0);
  const tooSmall = tested.filter((fold) => fold.closed < thresholds.minFoldClosed);
  return {
    foldClosedMin: tested.length ? Math.min(...tested.map((fold) => fold.closed)) : 0,
    foldClosedMedian: tested.length ? tested.map((fold) => fold.closed).sort((a, b) => a - b)[Math.floor((tested.length - 1) / 2)] : 0,
    insufficientFoldRate: tested.length ? roundRatio(tooSmall.length / tested.length) : 1,
    reasonCodes: tooSmall.length ? ["fold_sample_too_small"] : [],
  };
}

function emptyFoldSummary() {
  return {
    foldCount: 0,
    testedFoldCount: 0,
    positiveFoldCount: 0,
    positiveFoldRate: 0,
    minFoldPnl: 0,
    medianFoldPnl: 0,
    foldConsistency: 0,
  };
}
