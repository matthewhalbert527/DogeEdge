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
  adjustedConfidence?: number;
  dsrApprox?: number;
  pboApprox?: number;
  robustScore?: number;
  conservativeTotalPnl?: number;
  stressTotalPnl?: number;
  paperEvidence?: {
    available?: boolean;
    driftOk?: boolean;
    closedMarkets?: number;
  };
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
