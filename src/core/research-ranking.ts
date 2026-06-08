export type ResearchEvidenceForRanking = {
  promotionVerdict?: string;
  promotionStage?: string;
  nonPromotable?: boolean;
  labelSource?: string;
  settlementSource?: string;
  officialResolutionAvailable?: boolean;
  officialSettlementCoverage?: number;
  holdoutPass?: boolean;
  holdoutStrictlyLater?: boolean;
  holdoutConservativeTotalPnl?: number;
  holdoutLowerCi?: number | null;
  walkForwardPass?: boolean;
  cpcvSummary?: {
    positiveFoldRate?: unknown;
  };
  adjustedConfidence?: number;
  dsrApprox?: number;
  pboApprox?: number;
  familyAdjustedPValue?: number;
  globalAdjustedPValue?: number;
  falseDiscoveryRisk?: number;
  robustScore?: number;
  conservativeTotalPnl?: number;
  stressTotalPnl?: number;
  paperEvidence?: {
    available?: boolean;
    driftOk?: boolean;
    closedMarkets?: number;
  };
};

export type ResearchPromotionGateResult = {
  ok: boolean;
  classification: "research_validated" | "telemetry_only" | "insufficient_data" | "not_promotable";
  reasonCodes: string[];
};

export const defaultResearchPromotionGateThresholds = {
  minOfficialSettlementCoverage: 0.95,
  minAdjustedConfidence: 0.7,
  minDsrApprox: 0.8,
  maxPboApprox: 0.2,
  maxFamilyAdjustedPValue: 0.1,
  maxGlobalAdjustedPValue: 0.1,
  maxFalseDiscoveryRisk: 0.2,
  minCpcvPositiveRate: 0.7,
  minConservativeTotalPnl: 0,
  minStressTotalPnl: 0,
  minHoldoutConservativeTotalPnl: 0,
  minHoldoutLowerCi: 0,
};

export function researchEvidenceSortScore(evidence: ResearchEvidenceForRanking | null | undefined) {
  if (!evidence) return -5_000;
  const coverage = finiteNumber(evidence.officialSettlementCoverage, 0);
  const official = evidence.labelSource === "official_resolution" && evidence.settlementSource === "official_resolution"
    ? 1
    : 0;
  const verdictScore = promotionVerdictScore(evidence.promotionVerdict, evidence.nonPromotable);
  const stageScore = promotionStageScore(evidence.promotionStage);
  const holdoutScore = evidence.holdoutPass && evidence.holdoutStrictlyLater !== false ? 90 : -120;
  const confidenceScore = finiteNumber(evidence.adjustedConfidence, 0) * 70;
  const dsrScore = finiteNumber(evidence.dsrApprox, 0) * 35;
  const pboPenalty = finiteNumber(evidence.pboApprox, 1) * 45;
  const paper = evidence.paperEvidence ?? {};
  const paperScore = paper.available
    ? (paper.driftOk === false ? -90 : 35 + Math.min(30, finiteNumber(paper.closedMarkets, 0) * 0.3))
    : -20;
  const pnlScore = Math.max(-40, Math.min(60, finiteNumber(evidence.conservativeTotalPnl, 0) * 4))
    + Math.max(-25, Math.min(35, finiteNumber(evidence.stressTotalPnl, 0) * 3));
  const robustScore = Math.max(-80, Math.min(120, finiteNumber(evidence.robustScore, 0)));
  return official * 600
    + coverage * 120
    + verdictScore
    + stageScore
    + holdoutScore
    + confidenceScore
    + dsrScore
    - pboPenalty
    + paperScore
    + pnlScore
    + robustScore;
}

export function researchEvidenceCanMature(evidence: ResearchEvidenceForRanking | null | undefined) {
  if (!evidence) return false;
  if (evidence.nonPromotable) return false;
  if (evidence.promotionVerdict !== "paper_only" && evidence.promotionVerdict !== "tiny_live_eligible") return false;
  if (evidence.holdoutPass !== true || evidence.holdoutStrictlyLater === false) return false;
  if (evidence.paperEvidence?.available && evidence.paperEvidence.driftOk === false) return false;
  return true;
}

export function researchPromotionGate(
  evidence: ResearchEvidenceForRanking | null | undefined,
  thresholds: Partial<typeof defaultResearchPromotionGateThresholds> = {},
): ResearchPromotionGateResult {
  const config = { ...defaultResearchPromotionGateThresholds, ...thresholds };
  if (!evidence) {
    return { ok: false, classification: "telemetry_only", reasonCodes: ["missing_research_evidence"] };
  }

  const reasonCodes: string[] = [];
  if (evidence.nonPromotable) reasonCodes.push("non_promotable");
  if (evidence.promotionVerdict !== "paper_only" && evidence.promotionVerdict !== "tiny_live_eligible") {
    reasonCodes.push(evidence.promotionVerdict === "insufficient_data" ? "insufficient_data" : "promotion_verdict_not_validated");
  }
  if (evidence.labelSource !== "official_resolution") reasonCodes.push("official_label_required");
  if (evidence.settlementSource !== "official_resolution") reasonCodes.push("official_settlement_required");
  if (finiteNumber(evidence.officialSettlementCoverage, 0) < config.minOfficialSettlementCoverage) reasonCodes.push("official_settlement_coverage_low");
  if (evidence.holdoutPass !== true || evidence.holdoutStrictlyLater === false) reasonCodes.push("holdout_failed");
  if (finiteNumber(evidence.holdoutConservativeTotalPnl, Number.NEGATIVE_INFINITY) <= config.minHoldoutConservativeTotalPnl) reasonCodes.push("holdout_conservative_pnl_not_positive");
  if (finiteNullableNumber(evidence.holdoutLowerCi) === null || finiteNumber(evidence.holdoutLowerCi, Number.NEGATIVE_INFINITY) < config.minHoldoutLowerCi) reasonCodes.push("holdout_lower_ci_below_zero");
  if (evidence.walkForwardPass !== true) reasonCodes.push("walk_forward_failed");
  if (finiteNumber(evidence.cpcvSummary?.positiveFoldRate, 0) < config.minCpcvPositiveRate) reasonCodes.push("poor_cpcv_consistency");
  if (finiteNumber(evidence.conservativeTotalPnl, Number.NEGATIVE_INFINITY) <= config.minConservativeTotalPnl) reasonCodes.push("conservative_pnl_not_positive");
  if (finiteNumber(evidence.stressTotalPnl, Number.NEGATIVE_INFINITY) <= config.minStressTotalPnl) reasonCodes.push("stress_pnl_not_positive");
  if (finiteNumber(evidence.adjustedConfidence, 0) < config.minAdjustedConfidence) reasonCodes.push("adjusted_confidence_low");
  if (finiteNumber(evidence.dsrApprox, 0) < config.minDsrApprox) reasonCodes.push("dsr_approx_low");
  if (finiteNumber(evidence.pboApprox, 1) > config.maxPboApprox) reasonCodes.push("pbo_approx_high");
  if (finiteNumber(evidence.familyAdjustedPValue, 1) > config.maxFamilyAdjustedPValue) reasonCodes.push("family_adjusted_p_value_high");
  if (finiteNumber(evidence.globalAdjustedPValue, 1) > config.maxGlobalAdjustedPValue) reasonCodes.push("global_adjusted_p_value_high");
  if (finiteNumber(evidence.falseDiscoveryRisk, 1) > config.maxFalseDiscoveryRisk) reasonCodes.push("false_discovery_risk_high");
  if (evidence.paperEvidence?.available && evidence.paperEvidence.driftOk === false) reasonCodes.push("paper_drift_detected");

  const ok = reasonCodes.length === 0;
  return {
    ok,
    classification: ok
      ? "research_validated"
      : reasonCodes.includes("insufficient_data") ? "insufficient_data" : evidence.promotionVerdict ? "not_promotable" : "telemetry_only",
    reasonCodes,
  };
}

export function hasResearchPromotionCandidate(rows: Array<ResearchEvidenceForRanking | null | undefined> | null | undefined) {
  return Array.isArray(rows) && rows.some((row) => researchPromotionGate(row).ok);
}

export function researchEvidenceClassLabel(evidence: ResearchEvidenceForRanking | null | undefined) {
  const gate = researchPromotionGate(evidence);
  if (gate.classification === "research_validated") return "Research validated";
  if (gate.classification === "insufficient_data") return "Insufficient data";
  if (gate.classification === "not_promotable") return "Not promotable";
  return "Telemetry only";
}

function promotionVerdictScore(verdict: string | undefined, nonPromotable: boolean | undefined) {
  if (nonPromotable) return -350;
  if (verdict === "tiny_live_eligible") return 280;
  if (verdict === "paper_only") return 210;
  if (verdict === "insufficient_data") return -180;
  if (verdict === "reject") return -300;
  return -40;
}

function promotionStageScore(stage: string | undefined) {
  if (stage === "tiny_live_eligible") return 80;
  if (stage === "validation_candidate") return 55;
  if (stage === "paper_candidate") return 45;
  if (stage === "research_candidate") return 0;
  return 0;
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
