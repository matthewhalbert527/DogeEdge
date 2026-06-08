export const defaultPromotionThresholds = {
  minResearchMarkets: 50,
  preferredPaperMarkets: 100,
  minDays: 7,
  minPositiveFoldRate: 0.7,
  minConservativeTotalPnl: 0,
  minExpectancyLowerBound: 0,
  maxDrawdown: -25,
  maxConcentrationShare: 0.55,
  minAdjustedConfidence: 0.7,
  minClosedTrades: 30,
  minWalkForwardClosed: 2,
  minCpcvPositivePathRate: 0.7,
  minHoldoutEvents: 12,
  minHoldoutClosed: 10,
  minHoldoutMarkets: 10,
  minHoldoutRoi: 0,
  minHoldoutExpectancyLowerBound: 0,
  maxPboProxy: 0.2,
  maxFamilyAdjustedPValue: 0.1,
  maxGlobalAdjustedPValue: 0.2,
  maxFalseDiscoveryRisk: 0.2,
  maxFamilyQValue: 0.1,
  maxGlobalQValue: 0.2,
  minOfficialSettlementCoverageForTinyLive: 0.95,
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
  const cpcv = metric.cpcvSummary ?? {};
  const holdout = metric.holdoutSummary ?? {};
  const paperEvidence = metric.paperEvidence ?? {};
  const settlementGate = officialSettlementGate(metric, thresholds);

  if (metric.dataQuality?.permissiveDebug) reasonCodes.push("permissive_debug_not_promotable");
  if ((metric.closed ?? 0) < thresholds.minClosedTrades) reasonCodes.push("too_few_closed_trades");
  if (closedMarkets < thresholds.minResearchMarkets) reasonCodes.push("insufficient_independent_markets");
  if (days > 0 && days < thresholds.minDays) reasonCodes.push("insufficient_days");
  if ((fold.positiveFoldRate ?? 0) < thresholds.minPositiveFoldRate) reasonCodes.push("poor_fold_consistency");
  if ((cpcv.positiveFoldRate ?? 0) < thresholds.minCpcvPositivePathRate) reasonCodes.push("poor_cpcv_consistency");
  if (!metric.walkForwardPass || (metric.walkForwardClosed ?? 0) < thresholds.minWalkForwardClosed) reasonCodes.push("walk_forward_failed");
  if (holdout.strictlyLater === false || metric.holdoutStrictlyLater === false) reasonCodes.push("holdout_not_strictly_later");
  if (!holdout.holdoutPass) reasonCodes.push("holdout_failed");
  if ((holdout.holdoutConservativeClosed ?? 0) < thresholds.minHoldoutClosed) reasonCodes.push("insufficient_holdout_closed");
  if ((holdout.holdoutConservativeMarkets ?? 0) < thresholds.minHoldoutMarkets) reasonCodes.push("insufficient_holdout_markets");
  if ((holdout.holdoutConservativeRoi ?? 0) < thresholds.minHoldoutRoi) reasonCodes.push("holdout_roi_too_low");
  if (holdout.holdoutLowerCi !== null && holdout.holdoutLowerCi < thresholds.minHoldoutExpectancyLowerBound) reasonCodes.push("holdout_expectancy_ci_below_zero");
  if (!conservative || conservative.totalPnl <= thresholds.minConservativeTotalPnl) reasonCodes.push("fails_conservative_costs");
  if (stress && stress.totalPnl <= 0) warnings.push("fails_stress_costs");
  if (expectancyCi?.lower !== null && expectancyCi?.lower < thresholds.minExpectancyLowerBound) reasonCodes.push("expectancy_ci_below_zero");
  if ((metric.maxDrawdown ?? 0) < thresholds.maxDrawdown) reasonCodes.push("drawdown_too_large");
  if ((metric.concentration?.maxMarketShare ?? 0) > thresholds.maxConcentrationShare) reasonCodes.push("market_concentration");
  if ((metric.concentration?.maxDayShare ?? 0) > thresholds.maxConcentrationShare) reasonCodes.push("day_concentration");
  if ((metric.concentration?.maxRegimeShare ?? 0) > thresholds.maxConcentrationShare) warnings.push("narrow_regime");
  if ((metric.adjustedConfidence ?? 0) < thresholds.minAdjustedConfidence) reasonCodes.push("multiple_testing_adjusted_confidence_low");
  if ((metric.pboApprox ?? 1) > thresholds.maxPboProxy) reasonCodes.push("pbo_proxy_too_high");
  if ((metric.familyAdjustedPValue ?? 1) > thresholds.maxFamilyAdjustedPValue) reasonCodes.push("family_adjusted_p_value_too_high");
  if ((metric.globalAdjustedPValue ?? 1) > thresholds.maxGlobalAdjustedPValue) reasonCodes.push("global_adjusted_p_value_too_high");
  if ((metric.falseDiscoveryRisk ?? 1) > thresholds.maxFalseDiscoveryRisk) reasonCodes.push("false_discovery_risk_too_high");
  if ((metric.familyQValue ?? 1) > thresholds.maxFamilyQValue) reasonCodes.push("family_q_value_too_high");
  if ((metric.globalQValue ?? 1) > thresholds.maxGlobalQValue) reasonCodes.push("global_q_value_too_high");
  if (paperEvidence.closedMarkets > 0 && !paperEvidence.driftOk) reasonCodes.push("paper_evidence_drift");
  if ((metric.totalPnl ?? 0) <= 0) reasonCodes.push("non_positive_full_sample_pnl");
  if (!settlementGate.ok) warnings.push(...settlementGate.reasonCodes);

  if (closedMarkets < thresholds.minResearchMarkets) {
    return verdict("insufficient_data", "research_candidate", reasonCodes, warnings, true);
  }
  if (reasonCodes.length) {
    return verdict("reject", "research_candidate", reasonCodes, warnings, true);
  }
  if ((paperEvidence.closedMarkets ?? 0) >= thresholds.preferredPaperMarkets && paperEvidence.driftOk && settlementGate.ok) {
    return verdict("tiny_live_eligible", "tiny_live_eligible", ["manual_approval_required", "live_disabled_by_default"], warnings, false);
  }
  return verdict("paper_only", "validation_candidate", [
    ...(!settlementGate.ok ? settlementGate.reasonCodes : []),
    "paper_evidence_required",
  ], warnings, false);
}

export function officialSettlementGate(metric, thresholds = defaultPromotionThresholds) {
  const labelSource = metric.labelSource ?? metric.settlementEvidence?.labelSource ?? "unknown";
  const settlementSource = metric.settlementSource ?? metric.settlementEvidence?.settlementSource ?? "unknown";
  const coverage = Number(metric.officialSettlementCoverage ?? metric.settlementEvidence?.officialSettlementCoverage ?? 0);
  const officialAvailable = metric.officialResolutionAvailable === true
    || metric.settlementEvidence?.officialResolutionAvailable === true
    || coverage >= (thresholds.minOfficialSettlementCoverageForTinyLive ?? 0.95);
  const reasonCodes = [];
  if (labelSource !== "official_resolution") reasonCodes.push("official_label_required");
  if (settlementSource !== "official_resolution") reasonCodes.push("official_settlement_required");
  if (!officialAvailable || coverage < (thresholds.minOfficialSettlementCoverageForTinyLive ?? 0.95)) reasonCodes.push("official_settlement_coverage_low");
  return {
    ok: reasonCodes.length === 0,
    reasonCodes,
    labelSource,
    settlementSource,
    officialSettlementCoverage: coverage,
    officialResolutionAvailable: officialAvailable,
  };
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
