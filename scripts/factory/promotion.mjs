export const defaultPromotionThresholds = {
  minResearchMarkets: 50,
  preferredPaperMarkets: 100,
  minDays: 7,
  minPositiveFoldRate: 0.7,
  minConservativeTotalPnl: 0,
  minExpectancyLowerBound: 0,
  maxDrawdown: -25,
  maxConcentrationShare: 0.55,
  minAdjustedConfidence: 0.6,
  minClosedTrades: 20,
};

export function promotionReview(metric, thresholds = defaultPromotionThresholds) {
  const reasonCodes = [];
  const warnings = [];
  const closedMarkets = metric.independentClosedMarkets ?? 0;
  const days = metric.daysRepresented ?? 0;
  const conservative = metric.costModels?.conservative ?? null;
  const stress = metric.costModels?.stress ?? null;
  const expectancyCi = conservative?.bootstrap?.meanPnl ?? metric.bootstrap?.meanPnl ?? null;
  const fold = metric.foldSummary ?? {};

  if (metric.dataQuality?.permissiveDebug) reasonCodes.push("permissive_debug_not_promotable");
  if ((metric.closed ?? 0) < thresholds.minClosedTrades) reasonCodes.push("too_few_closed_trades");
  if (closedMarkets < thresholds.minResearchMarkets) reasonCodes.push("insufficient_independent_markets");
  if (days > 0 && days < thresholds.minDays) reasonCodes.push("insufficient_days");
  if ((fold.positiveFoldRate ?? 0) < thresholds.minPositiveFoldRate) reasonCodes.push("poor_fold_consistency");
  if (!conservative || conservative.totalPnl <= thresholds.minConservativeTotalPnl) reasonCodes.push("fails_conservative_costs");
  if (stress && stress.totalPnl <= 0) warnings.push("fails_stress_costs");
  if (expectancyCi?.lower !== null && expectancyCi?.lower < thresholds.minExpectancyLowerBound) reasonCodes.push("expectancy_ci_below_zero");
  if ((metric.maxDrawdown ?? 0) < thresholds.maxDrawdown) reasonCodes.push("drawdown_too_large");
  if ((metric.concentration?.maxMarketShare ?? 0) > thresholds.maxConcentrationShare) reasonCodes.push("market_concentration");
  if ((metric.concentration?.maxDayShare ?? 0) > thresholds.maxConcentrationShare) reasonCodes.push("day_concentration");
  if ((metric.concentration?.maxRegimeShare ?? 0) > thresholds.maxConcentrationShare) warnings.push("narrow_regime");
  if ((metric.adjustedConfidence ?? 0) < thresholds.minAdjustedConfidence) reasonCodes.push("multiple_testing_adjusted_confidence_low");
  if ((metric.totalPnl ?? 0) <= 0) reasonCodes.push("non_positive_full_sample_pnl");

  if (closedMarkets < thresholds.minResearchMarkets) {
    return verdict("insufficient_data", "research_candidate", reasonCodes, warnings, true);
  }
  if (reasonCodes.length) {
    return verdict("reject", "research_candidate", reasonCodes, warnings, true);
  }
  if ((metric.paperEvidence?.closedMarkets ?? 0) >= thresholds.preferredPaperMarkets && metric.paperEvidence?.driftOk) {
    return verdict("tiny_live_eligible", "tiny_live_eligible", ["manual_approval_required", "live_disabled_by_default"], warnings, false);
  }
  return verdict("paper_only", "validation_candidate", ["paper_evidence_required"], warnings, false);
}

function verdict(promotionVerdict, promotionStage, reasonCodes, warnings, nonPromotable) {
  return {
    promotionVerdict,
    promotionStage,
    reasonCodes,
    warnings,
    nonPromotable,
  };
}

