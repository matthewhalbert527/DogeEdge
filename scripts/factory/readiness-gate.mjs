import { replayParityReportFromManifest } from "./replay-coverage.mjs";
import { roundRatio } from "./utils.mjs";

export const defaultReadinessThresholds = {
  diagnosticOfficialSettlementCoverage: 0.8,
  minOfficialSettlementCoverageForScoring: 0.8,
  minOfficialSettlementCoverageForPromotion: 0.95,
  diagnosticReplaySampleCoverage: 0.8,
  minReplayGradeTargetMarketCoverage: 1,
  diagnosticEvidenceProbeCount: 1,
  minEvidenceProbeCountForPromotion: 3,
  diagnosticExactLinkedSupportedRows: 1,
  minExactLinkedSupportedRowsForPromotion: 3,
  diagnosticCalibrationLabelKnownCount: 10,
  minCalibrationLabelKnownCountForPromotion: 50,
  minRepresentedDays: 7,
  minIndependentMarkets: 50,
  seedCompleteness: 1,
  minPaperEvidenceAttempts: 1,
};

export function buildExecutableReadinessGate({
  snapshotId,
  generatedAt,
  exactLinkSummary = {},
  settlementCoverageReport = {},
  rawTickManifest = {},
  replayParityReport = null,
  simulatorCalibrationReport = {},
  topRosterDefaultSortAudit = {},
  dataQuality = {},
  evidenceProbeSummary = {},
  seedCompleteness = 0,
  thresholds = {},
} = {}) {
  const config = { ...defaultReadinessThresholds, ...thresholds };
  const replayParity = replayParityReport ?? replayParityReportFromManifest({ snapshotId, generatedAt, rawTickManifest });
  const exactLinked = numeric(exactLinkSummary.supportedLiveExactLinkedCount ?? exactLinkSummary.exactLinkedRows);
  const officialCoverage = numeric(settlementCoverageReport?.summary?.officialSettlementCoverage);
  const representedDays = numeric(dataQuality.representedDays ?? dataQuality.sampleSufficiency?.counts?.daysRepresented);
  const independentMarkets = numeric(dataQuality.independentMarkets ?? dataQuality.sampleSufficiency?.counts?.independentMarkets ?? dataQuality.marketEvents);
  const calibrationAttempts = numeric(simulatorCalibrationReport?.attempts);
  const calibrationLabelKnownCount = numeric(simulatorCalibrationReport?.labelKnownCount ?? simulatorCalibrationReport?.officialLabelKnownCount);
  const rosterCount = numeric(topRosterDefaultSortAudit?.researchRankedRosterCount);
  const evidenceProbeCount = numeric(evidenceProbeSummary.exactLinkedProbeCount ?? evidenceProbeSummary.installedProbeCount);
  const seedCompletenessRatio = numeric(seedCompleteness);
  const replayGradeCoverage = replayParity.targetMarketCount > 0
    ? roundRatio(replayParity.coveredTargetMarketCount / replayParity.targetMarketCount)
    : 0;
  const reasonCodes = [
    ...(exactLinked <= 0 && evidenceProbeCount <= 0 ? ["exact_linked_supported_live_rows_zero"] : []),
    ...(exactLinked < config.minExactLinkedSupportedRowsForPromotion && evidenceProbeCount < config.minEvidenceProbeCountForPromotion ? ["exact_linked_supported_live_rows_below_threshold"] : []),
    ...(officialCoverage < config.minOfficialSettlementCoverageForScoring ? ["official_settlement_coverage_below_scoring_threshold"] : []),
    ...(officialCoverage < config.minOfficialSettlementCoverageForPromotion ? ["official_settlement_coverage_below_threshold"] : []),
    ...(replayParity.replayGrade !== true || replayGradeCoverage < config.minReplayGradeTargetMarketCoverage ? ["replay_grade_target_market_ticks_absent"] : []),
    ...(representedDays > 0 && representedDays < config.minRepresentedDays ? ["represented_days_below_threshold"] : []),
    ...(independentMarkets > 0 && independentMarkets < config.minIndependentMarkets ? ["independent_markets_below_threshold"] : []),
    ...(calibrationAttempts < config.minPaperEvidenceAttempts ? ["simulator_calibration_evidence_absent"] : []),
    ...(calibrationLabelKnownCount > 0 && calibrationLabelKnownCount < config.minCalibrationLabelKnownCountForPromotion ? ["calibration_label_known_count_below_threshold"] : []),
    ...(seedCompletenessRatio < config.seedCompleteness ? ["seed_completeness_below_threshold"] : []),
    ...(rosterCount <= 0 ? ["research_validated_roster_empty"] : []),
  ];
  return {
    schemaVersion: "dogeedge.executable-readiness-gate.v1",
    snapshotId,
    generatedAt,
    allowedToLoadArenaBatch: reasonCodes.length === 0,
    state: reasonCodes.length === 0 ? "executable_ready" : "hold_gather_evidence",
    executableReadinessVerdict: reasonCodes.length === 0 ? "ready" : "lab_only",
    officialSettlementReady: officialCoverage >= config.minOfficialSettlementCoverageForPromotion,
    rawTickReplayReady: replayParity.replayGrade === true,
    exactLinkReady: exactLinked >= config.minExactLinkedSupportedRowsForPromotion || evidenceProbeCount >= config.minEvidenceProbeCountForPromotion,
    evidenceProbeReady: evidenceProbeCount >= config.minEvidenceProbeCountForPromotion,
    evidenceProbeDiagnosticReady: evidenceProbeCount >= config.diagnosticEvidenceProbeCount,
    representedDaysReady: representedDays === 0 || representedDays >= config.minRepresentedDays,
    independentMarketsReady: independentMarkets === 0 || independentMarkets >= config.minIndependentMarkets,
    paperEvidenceReady: calibrationAttempts >= config.minPaperEvidenceAttempts,
    exactLinkedSupportedLiveRows: exactLinked,
    officialSettlementCoverage: roundRatio(officialCoverage),
    replayGradeTargetMarketCoverage: replayGradeCoverage,
    representedDays,
    independentMarkets,
    simulatorCalibrationAttempts: calibrationAttempts,
    calibrationLabelKnownCount,
    exactLinkedEvidenceProbeCount: evidenceProbeCount,
    seedCompleteness: seedCompletenessRatio,
    researchValidatedRosterCount: rosterCount,
    thresholds: config,
    reasonCodes,
  };
}

export function readinessKpisFromGate(gate = {}, { settlementCoverageReport = {}, replayParityReport = {}, exactLinkSummary = {}, evidenceProbeSummary = {} } = {}) {
  return {
    schemaVersion: "dogeedge.readiness-kpis.v1",
    snapshotId: gate.snapshotId ?? null,
    generatedAt: gate.generatedAt ?? null,
    headlineState: gate.state ?? "hold_gather_evidence",
    allowedToLoadArenaBatch: gate.allowedToLoadArenaBatch === true,
    officialSettlementCoverage: numeric(gate.officialSettlementCoverage),
    officialSettlementReady: gate.officialSettlementReady === true,
    finalizedMarketsBackfilled: numeric(settlementCoverageReport?.summary?.officialRows),
    exactLinkRate: numeric(exactLinkSummary.exactLinkRate),
    exactLinkedSupportedLiveRows: numeric(gate.exactLinkedSupportedLiveRows),
    exactLinkedEvidenceProbeCount: numeric(gate.exactLinkedEvidenceProbeCount ?? evidenceProbeSummary.exactLinkedProbeCount),
    replayGradeTargetMarketCoverage: numeric(gate.replayGradeTargetMarketCoverage),
    replaySampleCoverage: numeric(replayParityReport?.coverageRate),
    replayGradeReady: gate.rawTickReplayReady === true,
    replayFallbackKind: replayParityReport?.fallbackKind ?? "unknown",
    researchValidatedRosterCount: numeric(gate.researchValidatedRosterCount),
    simulatorCalibrationAttempts: numeric(gate.simulatorCalibrationAttempts),
    calibrationLabelKnownCount: numeric(gate.calibrationLabelKnownCount),
    seedCompleteness: numeric(gate.seedCompleteness),
    thresholds: gate.thresholds ?? defaultReadinessThresholds,
    progressState: gate.allowedToLoadArenaBatch === true ? "promotion_ready" : "progress_improving_or_blocked",
    blockerCount: Array.isArray(gate.reasonCodes) ? gate.reasonCodes.length : 0,
    blockers: gate.reasonCodes ?? [],
  };
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
