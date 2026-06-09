import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashJson, isRecord, stableStringify } from "./factory/utils.mjs";
import { loadSnapshotHistory, writeSnapshotHistory } from "./factory/snapshot-history.mjs";
import { familyRegistryPublic, familyRegistryEntry, researchLiveAlignment } from "./factory/family-registry.mjs";
import { researchCandidateIdentity, researchCandidateIdentityContext } from "./factory/candidate-identity.mjs";

const execFileAsync = promisify(execFile);
const schemaVersion = "dogeedge.eval.snapshot.v1";
const defaultRootSeed = "dogeedge-factory-v2";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const algoMetricsColumns = [
  "snapshotId",
  "windowStartAt",
  "windowEndAt",
  "algoId",
  "displayId",
  "algoName",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "batchId",
  "lineageGeneration",
  "lineageParentIdsJson",
  "status",
  "enabled",
  "slot",
  "promotionStage",
  "promotionVerdict",
  "labelSource",
  "settlementSource",
  "officialResolutionAvailable",
  "officialSettlementCoverage",
  "warningCodesJson",
  "reasonCodesJson",
  "closed",
  "independentClosedMarkets",
  "daysRepresented",
  "wins",
  "losses",
  "winRate",
  "averagePnl",
  "totalPnl",
  "totalCost",
  "roi",
  "conservativeTotalPnl",
  "stressTotalPnl",
  "maxDrawdown",
  "downsideDeviation",
  "profitFactor",
  "psr",
  "dsrApprox",
  "pboApprox",
  "familyAdjustedPValue",
  "globalAdjustedPValue",
  "falseDiscoveryRisk",
  "adjustedConfidence",
  "robustScore",
  "foldPositiveRate",
  "cpcvPositiveRate",
  "walkForwardPass",
  "walkForwardClosed",
  "walkForwardTotalPnl",
  "walkForwardRoi",
  "holdoutPass",
  "holdoutClosed",
  "holdoutConservativeMarkets",
  "holdoutConservativeTotalPnl",
  "holdoutLowerCi",
  "paperEvidenceAvailable",
  "paperClosedMarkets",
  "paperClosedTrades",
  "paperTotalPnl",
  "paperRoi",
  "driftOk",
  "driftScore",
  "driftReasonsJson",
  "avgSlippageCents",
  "avgPartialFillRatio",
  "avgFillProbability",
  "avgFillDepthUtilization",
  "sourceRunId",
  "sourceSnapshotHash",
];

const foldMetricsColumns = [
  "snapshotId",
  "algoId",
  "foldKind",
  "foldId",
  "trainEventIdsHash",
  "validationEventIdsHash",
  "purgedEventIdsHash",
  "embargoedEventIdsHash",
  "embargoMs",
  "strictlyLater",
  "trainEventCount",
  "validationEventCount",
  "purgedEventCount",
  "embargoedEventCount",
  "closed",
  "independentClosedMarkets",
  "wins",
  "losses",
  "winRate",
  "averagePnl",
  "totalPnl",
  "totalCost",
  "roi",
  "maxDrawdown",
  "lowerCi",
  "upperCi",
  "pass",
];

const decisionAggregateColumns = [
  "snapshotId",
  "windowStartAt",
  "windowEndAt",
  "algoId",
  "displayId",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "promotionStage",
  "promotionVerdict",
  "marketCount",
  "independentMarketCount",
  "decisionCount",
  "signalCount",
  "attemptCount",
  "acceptedBuys",
  "acceptRate",
  "buySignals",
  "exitSignals",
  "skipSignals",
  "rejectCount",
  "staleRejects",
  "edgeRejects",
  "depthRejects",
  "gateRejects",
  "priceRejects",
  "otherRejects",
  "featureTimestampMin",
  "featureTimestampMax",
  "decisionTimestampMin",
  "decisionTimestampMax",
  "regimeTimeToClose",
  "regimeSpread",
  "regimeLiquidity",
  "regimeVolatility",
  "regimeMomentum",
  "regimeDistance",
  "warningCodesJson",
];

const tradeAggregateColumns = [
  "snapshotId",
  "windowStartAt",
  "windowEndAt",
  "algoId",
  "displayId",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "promotionStage",
  "promotionVerdict",
  "openedCount",
  "closedCount",
  "openCount",
  "independentClosedMarkets",
  "wins",
  "losses",
  "totalContracts",
  "totalFees",
  "totalCost",
  "totalPnl",
  "roi",
  "averagePnl",
  "maxDrawdown",
  "averageHoldingSeconds",
  "averageEntryPrice",
  "averageExitPrice",
  "averageSlippageCents",
  "averageFillProbability",
  "averagePartialFillRatio",
  "staleQuoteRejections",
  "queueMisses",
  "depthRejections",
  "regimeTimeToClose",
  "regimeSpread",
  "regimeLiquidity",
  "regimeVolatility",
  "regimeMomentum",
  "regimeDistance",
  "warningCodesJson",
];

const decisionRowsColumns = [
  "snapshotId",
  "rowId",
  "marketTicker",
  "algoId",
  "displayId",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "featureTimestamp",
  "decisionTimestamp",
  "labelTimestamp",
  "settlementTimestamp",
  "labelSource",
  "settlementSource",
  "officialResolutionAvailable",
  "marketCloseTimestamp",
  "side",
  "decisionAction",
  "attempted",
  "accepted",
  "rejectCode",
  "rejectMessage",
  "observedAt",
  "capturedAt",
  "secondsToClose",
  "targetPrice",
  "estimate",
  "spotPrice",
  "oneMinuteChange",
  "oneMinuteMovePercent",
  "distanceFromTarget",
  "fairProbability",
  "modelAction",
  "modelConfidence",
  "modelEdgeAfterFees",
  "yesBid",
  "yesAsk",
  "noBid",
  "noAsk",
  "yesSpread",
  "noSpread",
  "yesBidDepth",
  "yesAskDepth",
  "noBidDepth",
  "noAskDepth",
  "regimeTimeToClose",
  "regimeSpread",
  "regimeLiquidity",
  "regimeVolatility",
  "regimeMomentum",
  "regimeDistance",
  "regimePhase",
  "independentKey",
  "overlapCount",
  "sourceFileHash",
  "sourceLine",
];

const tradeRowsColumns = [
  "snapshotId",
  "tradeId",
  "marketTicker",
  "algoId",
  "displayId",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "promotionStage",
  "promotionVerdict",
  "openedAt",
  "closedAt",
  "decisionTimestamp",
  "featureTimestamp",
  "labelTimestamp",
  "settlementTimestamp",
  "labelSource",
  "settlementSource",
  "officialResolutionAvailable",
  "status",
  "side",
  "contracts",
  "entryPrice",
  "exitPrice",
  "bestExitPrice",
  "feesPaid",
  "pnl",
  "roiPerTrade",
  "holdingSeconds",
  "fillProbability",
  "partialFillRatio",
  "slippageCents",
  "depthUtilization",
  "queueMiss",
  "rejectCode",
  "entryReason",
  "exitReason",
  "entryRegimeTimeToClose",
  "entryRegimeSpread",
  "entryRegimeLiquidity",
  "entryRegimeVolatility",
  "entryRegimeMomentum",
  "entryRegimeDistance",
  "sourceRunId",
  "sourceSnapshotHash",
];

const warningsColumns = [
  "snapshotId",
  "scope",
  "objectType",
  "objectId",
  "code",
  "severity",
  "firstSeenAt",
  "lastSeenAt",
  "count",
  "message",
  "remediationHint",
];

const rosterAlignmentColumns = [
  "snapshotId",
  "algoId",
  "displayId",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "linkageStatus",
  "researchSupported",
  "supportReason",
  "sourceResearchAlgoId",
  "sourceRunId",
  "sourceSnapshotHash",
  "promotionVerdictAtInstall",
  "researchSnapshotId",
  "researchVerdict",
  "researchAgeHours",
  "dryRunTotalPnl",
  "dryRunClosedExits",
  "dryRunAcceptedBuys",
  "defaultBucket",
  "watchOnly",
];

const familyCoverageColumns = [
  "snapshotId",
  "family",
  "count",
  "researchSupported",
  "supportReason",
  "source",
];

const promotionGateColumns = [
  "snapshotId",
  "algoId",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "promotionVerdict",
  "researchSupported",
  "gatePass",
  "reasonCodesJson",
  "conservativeTotalPnl",
  "stressTotalPnl",
  "holdoutPass",
  "holdoutLowerCi",
  "adjustedConfidence",
  "falseDiscoveryRisk",
];

const postCloseAuditColumns = [
  "snapshotId",
  "rawFrames",
  "usableFrames",
  "excludedFrames",
  "postCloseRowsDetected",
  "postCloseRowsExcluded",
  "featureAtOrAfterCloseCount",
  "labelBeforeFeatureCount",
  "settlementBeforeFeatureCount",
  "futureOutcomeFieldViolations",
  "duplicateFramesRemoved",
  "overlappingFramesDownsampled",
];

const paperDecisionLedgerColumns = [
  "snapshotId",
  "eventId",
  "eventType",
  "marketTicker",
  "algoId",
  "displayId",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "promotionStage",
  "promotionVerdict",
  "decisionTimestamp",
  "featureTimestamp",
  "marketCloseTimestamp",
  "labelTimestamp",
  "settlementTimestamp",
  "labelSource",
  "settlementSource",
  "officialResolutionAvailable",
  "side",
  "expectedEdgeAfterFees",
  "yesBid",
  "yesAsk",
  "noBid",
  "noAsk",
  "yesBidDepth",
  "yesAskDepth",
  "noBidDepth",
  "noAskDepth",
  "regimeTimeToClose",
  "regimeSpread",
  "regimeLiquidity",
  "regimeVolatility",
  "regimeMomentum",
  "regimeDistance",
  "attempted",
  "accepted",
  "rejected",
  "rejectCode",
  "rejectMessage",
  "fillProbability",
  "partialFillRatio",
  "depthUtilization",
  "queueMiss",
  "slippageCents",
  "sourceRunId",
  "gitCommit",
  "dataHash",
  "configHash",
];

const candidateLineageAuditColumns = [
  "snapshotId",
  "researchCandidateId",
  "candidateConfigHash",
  "sourceResearchAlgoId",
  "family",
  "promotionVerdict",
  "gatePass",
  "linkedLiveRows",
  "linkedDecisionRows",
  "linkedTradeRows",
  "officialSettlementCoverage",
  "conservativeTotalPnl",
  "stressTotalPnl",
  "holdoutPass",
  "adjustedConfidence",
  "falseDiscoveryRisk",
];

const unlinkedLiveRowsColumns = [
  "snapshotId",
  "algoId",
  "displayId",
  "family",
  "researchSupported",
  "linkageStatus",
  "reason",
  "dryRunTotalPnl",
  "attempts",
  "acceptedBuys",
  "closedExits",
];

const evidenceAllocationByFamilyColumns = [
  "snapshotId",
  "family",
  "researchSupported",
  "liveRows",
  "exactLinkedRows",
  "familyOnlyRows",
  "missingLinkRows",
  "unsupportedRows",
  "normalBudgetRows",
  "explorationBudgetRows",
  "unsupportedBudgetRows",
  "recommendedAction",
];

const evidenceAllocationByCandidateColumns = [
  "snapshotId",
  "algoId",
  "displayId",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "linkageStatus",
  "budgetBucket",
  "normalBudgetEligible",
  "reason",
  "dryRunTotalPnl",
];

const missingProvenanceRowsColumns = [
  "snapshotId",
  "source",
  "rowId",
  "algoId",
  "family",
  "missingFieldsJson",
  "promotableEvidenceAllowed",
];

const supportedLiveLinkageColumns = [
  "snapshotId",
  "algoId",
  "displayId",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "sourceResearchAlgoId",
  "sourceRunId",
  "sourceSnapshotHash",
  "promotionVerdictAtInstall",
  "researchVerdict",
  "linkageStatus",
  "budgetBucket",
  "dryRunTotalPnl",
  "dryRunClosedExits",
  "dryRunAcceptedBuys",
];

const officialSettlementColumns = [
  "snapshotId",
  "marketTicker",
  "closeTime",
  "resolutionTime",
  "settlementTime",
  "settledOutcome",
  "labelSource",
  "settlementSource",
  "officialResolutionAvailable",
  "source",
  "sourceRowCount",
];

const officialSettlementCoverageByFamilyColumns = [
  "snapshotId",
  "family",
  "candidateCount",
  "officialCandidateCount",
  "averageOfficialSettlementCoverage",
  "minOfficialSettlementCoverage",
  "maxOfficialSettlementCoverage",
  "promotionGradeCandidateCount",
  "failClosed",
  "reasonCodes",
];

const officialSettlementCoverageByCandidateColumns = [
  "snapshotId",
  "algoId",
  "displayId",
  "family",
  "researchCandidateId",
  "candidateConfigHash",
  "labelSource",
  "settlementSource",
  "officialResolutionAvailable",
  "officialSettlementCoverage",
  "promotionGradeScoringAllowed",
  "beyondPaperAllowed",
  "reasonCodes",
];

const rawMarketTickCoverageColumns = [
  "snapshotId",
  "marketTicker",
  "available",
  "format",
  "jsonlRows",
  "relativePath",
  "uncoveredReason",
];

const simulatorCalibrationColumns = [
  "snapshotId",
  "family",
  "regimeTimeToClose",
  "regimeSpread",
  "regimeLiquidity",
  "regimeVolatility",
  "predictedFillRate",
  "realizedFillRate",
  "predictedPartialFillRatio",
  "realizedPartialFillRatio",
  "predictedSlippage",
  "realizedSlippage",
  "predictedRejectRate",
  "realizedRejectRate",
  "attempts",
  "accepted",
  "rejected",
  "rejectMixJson",
  "calibrationAction",
];

const officialScoringCoverageThreshold = 0.8;
const officialPromotionCoverageThreshold = 0.95;

export async function exportEvaluationSnapshot(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const generatedAt = now.toISOString();
  const snapshotId = options.snapshotId ?? `snap-${compactIso(now)}`;
  const windowMinutes = numberOption(options.windowMinutes, 30);
  const windowEndAt = generatedAt;
  const windowStartAt = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const dataRoot = path.resolve(options.dataRoot ?? defaultDataRoot());
  const storageDir = path.resolve(options.storageDir ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
  const backtestsDir = path.resolve(options.backtestsDir ?? path.join(dataRoot, "backtests"));
  const outRoot = path.resolve(options.outDir ?? path.join(dataRoot, "gpt-review-packets"));
  const snapshotsRoot = path.join(outRoot, "snapshots");
  const priorHistory = await loadSnapshotHistory({ snapshotsRoot, hours: 48 });
  const snapshotDir = path.join(outRoot, "snapshots", snapshotId);
  const includeRows = options.includeRows !== false;
  const fullRows = options.fullRows === true;
  const maxRowLines = fullRows ? Number.MAX_SAFE_INTEGER : numberOption(options.maxRowLines, 1_000);
  const maxMetrics = numberOption(options.maxMetrics, 600);
  const rowExportMode = includeRows ? fullRows ? "full" : "capped" : "disabled";
  await mkdir(snapshotDir, { recursive: true });

  const localLatestPath = path.join(storageDir, "latest.json");
  const localSummaryPath = path.join(storageDir, "summary.md");
  const liveSwitchPath = path.join(storageDir, "live-switch.json");
  const factoryAutomationPath = path.join(storageDir, "factory-automation.json");
  const topTradersPath = path.join(storageDir, "top-traders-executable.json");
  const latestBacktestPath = path.join(backtestsDir, "latest.json");
  const latestSweepPath = path.join(backtestsDir, "latest-sweep.json");

  const [
    localLatest,
    liveSwitch,
    factoryAutomationFile,
    topTradersFile,
    latestBacktest,
    latestSweep,
    gitInfo,
  ] = await Promise.all([
    readJsonMaybe(localLatestPath),
    readJsonMaybe(liveSwitchPath),
    readJsonMaybe(factoryAutomationPath),
    readJsonMaybe(topTradersPath),
    readJsonMaybe(latestBacktestPath),
    readJsonMaybe(latestSweepPath),
    repoInfo(),
  ]);

  const primaryRun = choosePrimaryRun(latestSweep, latestBacktest);
  const runDir = stringOrNull(primaryRun?.runDir);
  const registry = primaryRun?.registry ?? await readJsonMaybe(runDir ? path.join(runDir, "experiment-registry.json") : null) ?? {};
  const metrics = await selectPrimaryRunMetrics(primaryRun, maxMetrics);
  const snapshotCostModels = costModelsForSnapshot(registry, primaryRun);
  const identityContext = researchCandidateIdentityContext({
    primaryRun,
    registry,
    costModels: snapshotCostModels,
    riskModel: registry.riskModel ?? primaryRun?.riskModel ?? {},
  });
  const identityByAlgoId = researchCandidateIdentityMap(metrics, identityContext);
  const metricByAlgoId = new Map(metrics.map((metric) => [metric.algoId, metric]));
  const topExecutable = topTradersFile?.topTradersExecutable ?? localLatest?.topTradersExecutable ?? null;
  const topStats = isRecord(topExecutable?.stats) ? topExecutable.stats : {};
  const sourceSnapshotHash = await hashFileMaybe(localLatestPath);
  const localStoredAt = parseTime(localLatest?.storedAt);
  const dataQuality = dataQualitySummary(primaryRun, metrics);
  const safety = liveSafetyState(liveSwitch);

  const algoRollup = metrics.map((metric) => algoRollupRow(metric, {
    snapshotId,
    windowStartAt,
    windowEndAt,
    sourceRunId: primaryRun?.runId ?? null,
    sourceSnapshotHash,
    topStats,
    identityByAlgoId,
  }));
  const decisionAggregates = decisionAggregateRows({ snapshotId, windowStartAt, windowEndAt, topStats, metricByAlgoId, identityByAlgoId });
  const tradeAggregates = tradeAggregateRows({ snapshotId, windowStartAt, windowEndAt, metrics, topStats, identityByAlgoId });
  const foldDefinitions = foldDefinitionRows(registry, primaryRun);
  const foldMetrics = foldMetricRows({ snapshotId, metrics, registry, primaryRun });
  const alignment = researchLiveAlignment({ researchMetrics: metrics, liveStats: topStats });
  const leakageAudit = leakageAuditSummary({ snapshotId, dataQuality, metrics });
  const alignmentArtifacts = alignmentRows({ snapshotId, metrics, topStats, primaryRun, alignment, leakageAudit, identityByAlgoId });
  let decisionRows = [];
  let tradeRows = [];
  const warnings = warningRows({
    snapshotId,
    generatedAt,
    safety,
    localStoredAt,
    dataQuality,
    gitInfo,
    registry,
    topStats,
    includeRows,
    rowExportMode,
  });

  const filesToWrite = [
    { logicalName: "algoMetrics.tsv.gz", relativePath: "algoMetrics.tsv.gz", content: tsv(algoMetricsColumns, algoRollup.map((row) => flattenAlgoMetrics(row))) },
    { logicalName: "foldMetrics.tsv.gz", relativePath: "foldMetrics.tsv.gz", content: tsv(foldMetricsColumns, foldMetrics) },
    { logicalName: "decisionAggregates.tsv.gz", relativePath: "decisionAggregates.tsv.gz", content: tsv(decisionAggregateColumns, decisionAggregates) },
    { logicalName: "tradeAggregates.tsv.gz", relativePath: "tradeAggregates.tsv.gz", content: tsv(tradeAggregateColumns, tradeAggregates) },
    { logicalName: "warnings.tsv.gz", relativePath: "warnings.tsv.gz", content: tsv(warningsColumns, warnings.map(flattenWarning)) },
    { logicalName: "roster_alignment.tsv.gz", relativePath: "roster_alignment.tsv.gz", content: tsv(rosterAlignmentColumns, alignmentArtifacts.rosterAlignment) },
    { logicalName: "research_coverage_by_family.tsv.gz", relativePath: "research_coverage_by_family.tsv.gz", content: tsv(familyCoverageColumns, alignmentArtifacts.researchCoverage) },
    { logicalName: "live_coverage_by_family.tsv.gz", relativePath: "live_coverage_by_family.tsv.gz", content: tsv(familyCoverageColumns, alignmentArtifacts.liveCoverage) },
    { logicalName: "unsupported_live_families.tsv.gz", relativePath: "unsupported_live_families.tsv.gz", content: tsv(familyCoverageColumns, alignmentArtifacts.unsupportedLiveFamilies) },
    { logicalName: "promotion_gate_results.tsv.gz", relativePath: "promotion_gate_results.tsv.gz", content: tsv(promotionGateColumns, alignmentArtifacts.promotionGateResults) },
    { logicalName: "post_close_frame_audit.tsv.gz", relativePath: "post_close_frame_audit.tsv.gz", content: tsv(postCloseAuditColumns, [alignmentArtifacts.postCloseFrameAudit]) },
  ];

  if (includeRows) {
    decisionRows = await readDecisionRows({ dataRoot, snapshotId, maxRowLines });
    tradeRows = await readTradeRows({
      filePath: path.join(storageDir, "paper-trades.jsonl"),
      snapshotId,
      maxRowLines,
      metricByAlgoId,
      identityByAlgoId,
      sourceRunId: primaryRun?.runId ?? null,
      sourceSnapshotHash,
    });
    decisionRows = enrichRowsWithCandidateIdentity(decisionRows, identityByAlgoId);
    tradeRows = enrichRowsWithCandidateIdentity(tradeRows, identityByAlgoId);
    filesToWrite.push(
      { logicalName: "decisionRows.tsv.gz", relativePath: "decisionRows.tsv.gz", content: tsv(decisionRowsColumns, decisionRows) },
      { logicalName: "tradeRows.tsv.gz", relativePath: "tradeRows.tsv.gz", content: tsv(tradeRowsColumns, tradeRows) },
    );
  }
  const identityArtifacts = exactCandidateArtifacts({
    snapshotId,
    metrics,
    topStats,
    decisionRows,
    tradeRows,
    identityByAlgoId,
    metricByAlgoId,
    alignmentArtifacts,
  });
  const settlementArtifacts = officialSettlementArtifacts({
    snapshotId,
    generatedAt,
    metrics,
    decisionRows,
    tradeRows,
    dataQuality,
  });
  const simulatorCalibration = simulatorCalibrationArtifacts({
    snapshotId,
    generatedAt,
    decisionRows,
    tradeRows,
    topStats,
  });
  filesToWrite.push(
    { logicalName: "candidate_lineage_audit.tsv.gz", relativePath: "candidate_lineage_audit.tsv.gz", content: tsv(candidateLineageAuditColumns, identityArtifacts.candidateLineageAudit) },
    { logicalName: "unlinked_live_rows.tsv.gz", relativePath: "unlinked_live_rows.tsv.gz", content: tsv(unlinkedLiveRowsColumns, identityArtifacts.unlinkedLiveRows) },
    { logicalName: "evidence_allocation_by_family.tsv.gz", relativePath: "evidence_allocation_by_family.tsv.gz", content: tsv(evidenceAllocationByFamilyColumns, identityArtifacts.evidenceAllocationByFamily) },
    { logicalName: "evidence_allocation_by_candidate.tsv.gz", relativePath: "evidence_allocation_by_candidate.tsv.gz", content: tsv(evidenceAllocationByCandidateColumns, identityArtifacts.evidenceAllocationByCandidate) },
    { logicalName: "missing_provenance_rows.tsv.gz", relativePath: "missing_provenance_rows.tsv.gz", content: tsv(missingProvenanceRowsColumns, identityArtifacts.missingProvenanceRows) },
    { logicalName: "supported_live_linkage.tsv.gz", relativePath: "supported_live_linkage.tsv.gz", content: tsv(supportedLiveLinkageColumns, identityArtifacts.supportedLiveLinkage) },
    { logicalName: "supported_live_exact_links.tsv.gz", relativePath: "supported_live_exact_links.tsv.gz", content: tsv(supportedLiveLinkageColumns, identityArtifacts.supportedLiveExactLinks) },
    { logicalName: "official_settlements.tsv.gz", relativePath: "official_settlements.tsv.gz", content: tsv(officialSettlementColumns, settlementArtifacts.settlements) },
    { logicalName: "official_settlement_coverage_by_family.tsv.gz", relativePath: "official_settlement_coverage_by_family.tsv.gz", content: tsv(officialSettlementCoverageByFamilyColumns, settlementArtifacts.coverageByFamily) },
    { logicalName: "official_settlement_coverage_by_candidate.tsv.gz", relativePath: "official_settlement_coverage_by_candidate.tsv.gz", content: tsv(officialSettlementCoverageByCandidateColumns, settlementArtifacts.coverageByCandidate) },
    { logicalName: "simulator_calibration_by_regime.tsv.gz", relativePath: "simulator_calibration_by_regime.tsv.gz", content: tsv(simulatorCalibrationColumns, simulatorCalibration.rows) },
    { logicalName: "calibration_by_bucket.tsv.gz", relativePath: "calibration_by_bucket.tsv.gz", content: tsv(simulatorCalibrationColumns, simulatorCalibration.rows) },
  );

  const fileManifest = [];
  for (const file of filesToWrite) {
    const absolutePath = path.join(snapshotDir, file.relativePath);
    await writeGzipText(absolutePath, file.content);
    const info = await fileInfo(absolutePath, file.logicalName, file.relativePath, rowCountFromTsv(file.content));
    fileManifest.push(info);
  }

  const exactExportFiles = await writeExactReviewFiles({
    snapshotDir,
    snapshotId,
    generatedAt,
    dataRoot,
    decisionRows,
    tradeRows,
    topStats,
    metricByAlgoId,
    identityByAlgoId,
    primaryRun,
    registry,
    gitInfo,
    rawTickFormat: options.rawTickFormat ?? "jsonl",
    maxRawTickMarkets: numberOption(options.maxRawTickMarkets, 20),
    maxRawTickRowsPerMarket: numberOption(options.maxRawTickRowsPerMarket, 50_000),
    sourceRunId: primaryRun?.runId ?? null,
    sourceSnapshotHash,
    officialSettlements: settlementArtifacts.settlements,
  });
  fileManifest.push(...exactExportFiles);
  const rawTickManifest = await readJsonMaybe(path.join(snapshotDir, "raw_market_ticks", "manifest.json"));
  const replayParityReport = replayParityReportFromRawManifest({ snapshotId, generatedAt, rawTickManifest });
  const rejectStreamSummary = rejectStreamSummaryReport({ snapshotId, generatedAt, decisionRows, tradeRows, topStats });
  const topRosterAudit = topRosterDefaultSortAudit({ snapshotId, alignmentArtifacts });
  const executableReadinessGate = executableReadinessGateReport({
    snapshotId,
    generatedAt,
    exactLinkSummary: identityArtifacts.exactLinkSummary,
    settlementCoverageReport: settlementArtifacts.coverageReport,
    rawTickManifest,
    simulatorCalibrationReport: simulatorCalibration.report,
    topRosterDefaultSortAudit: topRosterAudit,
  });
  const auditExportFiles = await writeAuditReviewFiles({
    snapshotDir,
    alignment,
    leakageAudit,
    familyAllocationReport: familyAllocationReport({ snapshotId, alignment, metrics, topStats }),
    topRosterDefaultSortAudit: topRosterAudit,
    researchLiveIdentityAlignment: identityArtifacts.researchLiveIdentityAlignment,
    exactLinkSummary: identityArtifacts.exactLinkSummary,
    settlementCoverageReport: settlementArtifacts.coverageReport,
    replayParityReport,
    rejectStreamSummary,
    executableReadinessGate,
    simulatorCalibrationReport: simulatorCalibration.report,
    simulatorCalibrationMarkdown: simulatorCalibration.markdown,
    schedulerBudgetReport: identityArtifacts.schedulerBudgetReport,
    provenanceCompletenessReport: identityArtifacts.provenanceCompletenessReport,
  });
  fileManifest.push(...auditExportFiles);

  const snapshot = {
    schemaVersion,
    snapshotId,
    generatedAt,
    sourceTimezone: options.sourceTimezone ?? process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    window: {
      startAt: windowStartAt,
      endAt: windowEndAt,
      durationMinutes: windowMinutes,
      isDelta: true,
      baselineSnapshotId: priorHistory.at(-1)?.snapshotId ?? null,
      evaluationWindowKind: windowKind(windowMinutes),
    },
    snapshotLineage: {
      previousSnapshotId: priorHistory.at(-1)?.snapshotId ?? null,
      baseline48hSnapshotId: priorHistory[0]?.snapshotId ?? null,
      priorSnapshotCount48h: priorHistory.length,
    },
    repo: {
      commitHash: gitInfo.commitHash ?? "UNAVAILABLE",
      branch: gitInfo.branch ?? "UNAVAILABLE",
      dirty: gitInfo.dirty,
      repoPathHint: "_REPO_ROOT_",
      packageJsonSha256: await hashFileMaybe(path.join(repoRoot, "package.json")),
      algoFactoryDocSha256: await hashFileMaybe(path.join(repoRoot, "DOGEEDGE_ALGO_FACTORY.md")),
    },
    timestampSemantics: {
      allTimestampsUtc: true,
      featureTimestampDefinition: "when the input feature was first observable in a local market/feed snapshot",
      decisionTimestampDefinition: "when the app or algo made a buy, skip, or exit decision",
      labelTimestampDefinition: "when the research label becomes knowable for the event",
      settlementTimestampDefinition: "time used by the local evaluation pipeline to settle the event",
      settlementSource: snapshotSettlementSource(metrics),
    },
    appState: {
      liveSafety: safety,
      factoryAutomation: localLatest?.factoryAutomation ?? factoryAutomationFile?.factoryAutomation ?? factoryAutomationFile ?? {},
      topRosterSummary: localLatest?.topTradersExecutableSummary ?? summarizeTopStats(topStats),
      latestStoredAt: localLatest?.storedAt ?? null,
      localWorkerSummarySha256: await hashFileMaybe(localSummaryPath),
    },
    dataQuality,
    leakageAudit,
    researchLiveAlignment: alignment,
    researchLiveIdentityAlignment: identityArtifacts.researchLiveIdentityAlignment,
    exactLinkSummary: identityArtifacts.exactLinkSummary,
    officialSettlementCoverageSummary: settlementArtifacts.coverageReport.summary,
    simulatorCalibrationReport: simulatorCalibration.report,
    replayParityReport,
    rejectStreamSummary,
    executableReadinessGate,
    schedulerBudgetReport: identityArtifacts.schedulerBudgetReport,
    provenanceCompletenessReport: identityArtifacts.provenanceCompletenessReport,
    familyRegistry: familyRegistryPublic(),
    experimentRegistry: {
      gitCommit: registry.gitCommit ?? primaryRun?.gitCommit ?? null,
      codeVersion: registry.codeVersion ?? primaryRun?.codeVersion ?? registry.gitCommit ?? null,
      configHash: registry.configHash ?? primaryRun?.configHash ?? "UNAVAILABLE",
      dataHash: registry.dataHash ?? registry.inputManifestHash ?? primaryRun?.dataHash ?? "UNAVAILABLE",
      inputManifestHash: registry.inputManifestHash ?? null,
      trialCount: numberOrZero(registry.trialCount ?? primaryRun?.algoCount),
      metricsVersion: registry.metricsVersion ?? "robust-v1",
      randomSeed: registry.randomSeed ?? primaryRun?.randomSeed ?? defaultRootSeed,
      families: registry.families ?? {},
      seedPlan: registry.seedPlan ?? { rootSeed: registry.randomSeed ?? primaryRun?.randomSeed ?? defaultRootSeed, deterministic: true },
    },
    costModels: snapshotCostModels,
    simulatorAssumptions: {
      askSideEntries: true,
      bidSideExits: true,
      visibleDepthOnly: true,
      staleQuoteRuleEnabled: true,
      partialFillsModeled: true,
      simulatorTelemetryFields: [
        "averageSlippageCents",
        "averagePartialFillRatio",
        "averageFillProbability",
        "averageFillDepthUtilization",
        "queueResults",
        "staleQuoteRejections",
        "depthRejections",
      ],
    },
    foldDefinitions,
    algoRollup,
    decisionAggregates,
    tradeAggregates,
    warnings: warnings.map((warning) => ({
      scope: warning.scope,
      objectType: warning.objectType,
      objectId: warning.objectId,
      code: warning.code,
      severity: warning.severity,
      firstSeenAt: warning.firstSeenAt,
      lastSeenAt: warning.lastSeenAt,
      count: warning.count,
      message: warning.message,
      remediationHint: warning.remediationHint,
    })),
    alerts: warnings
      .filter((warning) => ["high", "critical"].includes(warning.severity))
      .map((warning) => ({ code: warning.code, severity: warning.severity, objectId: warning.objectId, message: warning.message })),
    filesManifest: fileManifest,
    rowExport: {
      mode: rowExportMode,
      includeRows,
      rowsCapped: includeRows && !fullRows,
      rowCap: includeRows && !fullRows ? maxRowLines : null,
      promotionReviewComplete: includeRows && fullRows,
    },
  };

  const validation = validateEvaluationSnapshot(snapshot);
  if (!validation.ok) {
    snapshot.warnings.push({
      scope: "snapshot",
      objectType: "snapshot",
      objectId: snapshotId,
      code: "snapshot_schema_warning",
      severity: "high",
      message: validation.errors.join("; "),
      remediationHint: "Fix exporter inputs before relying on this review packet.",
    });
  }

  const snapshotPath = path.join(snapshotDir, `${snapshotId}.json.gz`);
  await writeGzipText(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  const snapshotInfo = await fileInfo(snapshotPath, `${snapshotId}.json.gz`, `${snapshotId}.json.gz`, null);
  const manifest = {
    schemaVersion: "dogeedge.eval.export.manifest.v1",
    snapshotId,
    generatedAt,
    snapshotPath,
    gitCommit: snapshot.repo.commitHash,
    dataHash: snapshot.experimentRegistry.dataHash,
    configHash: snapshot.experimentRegistry.configHash,
    costModelHash: registry.costModelHash ?? hashJson(snapshot.costModels),
    riskModelHash: registry.riskModelHash ?? hashJson(registry.riskModel ?? {}),
    timestampSemantics: snapshot.timestampSemantics,
    dataRoot: "_DATA_ROOT_",
    storageDir: "_DATA_ROOT_/local-worker",
    backtestsDir: "_DATA_ROOT_/backtests",
    primaryRunId: primaryRun?.runId ?? null,
    primaryRunDir: runDir ? "_DATA_ROOT_/backtests/" + path.basename(path.dirname(runDir)) + "/" + path.basename(runDir) : null,
    safetyStatus: safety,
    rowExport: snapshot.rowExport,
    files: [snapshotInfo, ...fileManifest],
    warnings: snapshot.warnings,
    validation,
  };
  const manifestPath = path.join(snapshotDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const history = await writeSnapshotHistory({ snapshotsRoot, outRoot, hours: 48 });

  return {
    snapshot,
    snapshotDir,
    snapshotPath,
    manifestPath,
    manifest,
    history,
  };
}

export async function buildReviewBundle(options = {}) {
  const snapshotResult = await exportEvaluationSnapshot(options);
  const outRoot = path.resolve(options.outDir ?? path.join(path.resolve(options.dataRoot ?? defaultDataRoot()), "gpt-review-packets"));
  const generatedAt = snapshotResult.snapshot.generatedAt;
  const bundleId = `dogeedge-review-bundle-${compactIso(new Date(generatedAt))}`;
  const bundleRoot = path.join(outRoot, "bundles", bundleId);
  const bundlePath = `${bundleRoot}.zip`;
  const bundleHours = numberOption(options.bundleHours, 2);
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(path.join(bundleRoot, "snapshots"), { recursive: true });
  await mkdir(path.join(bundleRoot, "repo"), { recursive: true });
  await mkdir(path.join(bundleRoot, "registry"), { recursive: true });

  const snapshotExportRows = snapshotExportRowsByName(snapshotResult);
  const latestSnapshotDirs = await latestNamedDirs(path.join(outRoot, "snapshots"), Math.max(1, Math.ceil((bundleHours * 60) / numberOption(options.windowMinutes, 30))));
  const bundleFiles = [];
  for (const dir of latestSnapshotDirs) {
    const files = await readdir(dir).catch(() => []);
    for (const name of files) {
      if (name.endsWith(".json.gz")) {
        const target = path.join(bundleRoot, "snapshots", name);
        await copyFile(path.join(dir, name), target);
        bundleFiles.push(await fileInfo(target, name, path.relative(bundleRoot, target), null));
      }
    }
  }
  for (const name of [
    "algoMetrics.tsv.gz",
    "foldMetrics.tsv.gz",
    "decisionAggregates.tsv.gz",
    "tradeAggregates.tsv.gz",
    "warnings.tsv.gz",
    "decisionRows.tsv.gz",
    "tradeRows.tsv.gz",
    "decision_frames.jsonl",
    "trades.csv",
    "paper_decision_ledger.csv",
    "official_settlements.tsv.gz",
    "official_settlements.jsonl",
    "leakage_audit.json",
    "research_live_alignment.json",
    "research_live_identity_alignment.json",
    "exact_link_summary.json",
    "settlement_coverage_report.json",
    "official_settlement_coverage_by_family.tsv.gz",
    "official_settlement_coverage_by_candidate.tsv.gz",
    "simulator_calibration_by_regime.tsv.gz",
    "calibration_by_bucket.tsv.gz",
    "simulator_calibration_report.json",
    "calibration_report.json",
    "simulator_calibration_report.md",
    "reject_stream_summary.json",
    "replay_parity_report.json",
    "executable_readiness_gate.json",
    "family_allocation_report.json",
    "scheduler_budget_report.json",
    "provenance_completeness_report.json",
    "top_roster_default_sort_audit.json",
    "roster_alignment.tsv.gz",
    "research_coverage_by_family.tsv.gz",
    "live_coverage_by_family.tsv.gz",
    "unsupported_live_families.tsv.gz",
    "promotion_gate_results.tsv.gz",
    "candidate_lineage_audit.tsv.gz",
    "unlinked_live_rows.tsv.gz",
    "evidence_allocation_by_family.tsv.gz",
    "evidence_allocation_by_candidate.tsv.gz",
    "supported_live_linkage.tsv.gz",
    "supported_live_exact_links.tsv.gz",
    "missing_provenance_rows.tsv.gz",
    "post_close_frame_audit.tsv.gz",
  ]) {
    const source = path.join(snapshotResult.snapshotDir, name);
    if (await exists(source)) {
      const target = path.join(bundleRoot, "snapshots", name);
      await copyFile(source, target);
      bundleFiles.push(await fileInfo(target, name, path.relative(bundleRoot, target), snapshotExportRows.get(name) ?? null));
    }
  }
  const rawTicksManifest = path.join(snapshotResult.snapshotDir, "raw_market_ticks", "manifest.json");
  let rawTicksManifestPresent = false;
  let rawTicksManifestJson = null;
  if (await exists(rawTicksManifest)) {
    rawTicksManifestPresent = true;
    rawTicksManifestJson = await readJsonMaybe(rawTicksManifest);
    const target = path.join(bundleRoot, "snapshots", "raw_market_ticks", "manifest.json");
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(rawTicksManifest, target);
    bundleFiles.push(await fileInfo(target, "raw_market_ticks/manifest.json", path.relative(bundleRoot, target), snapshotExportRows.get("raw_market_ticks/manifest.json") ?? null));
  }
  const rawTicksSchema = path.join(snapshotResult.snapshotDir, "raw_market_ticks", "schema.json");
  if (await exists(rawTicksSchema)) {
    const target = path.join(bundleRoot, "snapshots", "raw_market_ticks", "schema.json");
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(rawTicksSchema, target);
    bundleFiles.push(await fileInfo(target, "raw_market_ticks/schema.json", path.relative(bundleRoot, target), snapshotExportRows.get("raw_market_ticks/schema.json") ?? null));
  }
  const rawTicksCoverage = path.join(snapshotResult.snapshotDir, "raw_market_ticks", "coverage.tsv.gz");
  if (await exists(rawTicksCoverage)) {
    const target = path.join(bundleRoot, "snapshots", "raw_market_ticks", "coverage.tsv.gz");
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(rawTicksCoverage, target);
    bundleFiles.push(await fileInfo(target, "raw_market_ticks/coverage.tsv.gz", path.relative(bundleRoot, target), snapshotExportRows.get("raw_market_ticks/coverage.tsv.gz") ?? null));
  }
  const rawTicksJsonlFiles = await latestFilesRecursive(path.join(snapshotResult.snapshotDir, "raw_market_ticks", "jsonl"), [".jsonl"], 200);
  for (const source of rawTicksJsonlFiles.filter((file) => file.endsWith(".jsonl"))) {
    const relative = slashPath(path.relative(snapshotResult.snapshotDir, source));
    const target = path.join(bundleRoot, "snapshots", relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    bundleFiles.push(await fileInfo(target, relative, path.relative(bundleRoot, target), snapshotExportRows.get(relative) ?? null));
  }
  for (const name of ["snapshot-history-48h.json", "snapshot-history-48h.md"]) {
    const source = path.join(outRoot, name);
    if (await exists(source)) {
      const target = path.join(bundleRoot, "snapshots", name);
      await copyFile(source, target);
      bundleFiles.push(await fileInfo(target, name, path.relative(bundleRoot, target), null));
    }
  }

  const repoFiles = await copyRepoBundle({ bundleRoot, options });
  bundleFiles.push(...repoFiles);
  const registryFile = await writeRegistryTarball({ bundleRoot, options, snapshot: snapshotResult.snapshot });
  if (registryFile) bundleFiles.push(registryFile);
  let bundleCompleteness = await reviewBundleCompletenessReport({ bundleRoot, bundleFiles, snapshotResult });
  const bundleCompletenessPath = path.join(bundleRoot, "bundle_completeness_report.json");
  await writeFile(bundleCompletenessPath, `${JSON.stringify(bundleCompleteness, null, 2)}\n`, "utf8");
  bundleFiles.push(await fileInfo(bundleCompletenessPath, "bundle_completeness_report.json", "bundle_completeness_report.json", null));
  bundleCompleteness = await reviewBundleCompletenessReport({ bundleRoot, bundleFiles, snapshotResult });
  const rawMarketTickExport = rawMarketTickBundleSummary(rawTicksManifestJson, rawTicksManifestPresent);
  const rowExport = snapshotResult.snapshot.rowExport;
  const exactLinkSummary = snapshotResult.snapshot.exactLinkSummary ?? snapshotResult.snapshot.researchLiveIdentityAlignment ?? {};
  const reviewBundleQuality = rowExport?.promotionReviewComplete === true && rowExport?.rowsCapped !== true && bundleCompleteness.ok
    ? "full_row_promotion_grade"
    : rowExport?.promotionReviewComplete === true && rowExport?.rowsCapped !== true
      ? "incomplete_review_bundle"
      : "capped_debug_bundle";

  const manifest = {
    schemaVersion: "dogeedge.eval.review.bundle.v1",
    bundleId,
    generatedAt,
    snapshotId: snapshotResult.snapshot.snapshotId,
    gitCommit: snapshotResult.snapshot.repo.commitHash,
    codeVersion: snapshotResult.snapshot.repo.commitHash,
    snapshotCount: latestSnapshotDirs.length,
    bundleHours,
    safetyStatus: snapshotResult.snapshot.appState.liveSafety,
    rowExport,
    reviewBundleQuality,
    bundleCompleteness,
    repoDirty: bundleCompleteness.repoDirty,
    dirtyDiffIncluded: bundleCompleteness.dirtyDiffIncluded,
    exactLinkRate: numberOrNull(exactLinkSummary.exactLinkRate ?? exactLinkSummary.exactLinkCoverage),
    exactLinkSummary,
    officialSettlementCoverageSummary: officialSettlementCoverageSummary(snapshotResult.snapshot),
    rawMarketTickExport,
    rawTickCoverageSummary: rawMarketTickExport.targetMarketCoverage,
    executableReadinessGate: snapshotResult.snapshot.executableReadinessGate,
    alerts: snapshotResult.snapshot.alerts,
    files: bundleFiles,
    limitations: bundleLimitations({
      rowExport,
      rawMarketTickExport,
      officialSettlementCoverageSummary: snapshotResult.snapshot.officialSettlementCoverageSummary,
      bundleCompleteness,
    }),
    notes: [
      "Local-only review bundle. No external uploads were performed by DogeEdge.",
      "Absolute paths are replaced by _REPO_ROOT_ and _DATA_ROOT_ in JSON metadata.",
      "Row-level extracts are capped by --max-row-lines unless --full-rows is supplied.",
    ],
  };
  await writeFile(path.join(bundleRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const zipped = await zipDirectory(bundleRoot, bundlePath);
  return {
    ...snapshotResult,
    bundleRoot,
    bundlePath: zipped ? bundlePath : null,
    bundleManifest: manifest,
  };
}

function snapshotExportRowsByName(snapshotResult) {
  const rowsByName = new Map();
  for (const file of [
    ...(Array.isArray(snapshotResult?.manifest?.files) ? snapshotResult.manifest.files : []),
    ...(Array.isArray(snapshotResult?.snapshot?.filesManifest) ? snapshotResult.snapshot.filesManifest : []),
  ]) {
    if (!isRecord(file)) continue;
    const rows = typeof file.rows === "number" ? file.rows : null;
    for (const key of [file.logicalName, file.relativePath]) {
      if (typeof key === "string" && !rowsByName.has(slashPath(key))) rowsByName.set(slashPath(key), rows);
    }
  }
  return rowsByName;
}

async function reviewBundleCompletenessReport({ bundleRoot, bundleFiles, snapshotResult }) {
  const present = new Set((Array.isArray(bundleFiles) ? bundleFiles : [])
    .map((file) => slashPath(file?.relativePath ?? ""))
    .filter(Boolean));
  const snapshotFiles = Array.isArray(snapshotResult?.snapshot?.filesManifest)
    ? snapshotResult.snapshot.filesManifest
    : [];
  const expectedSnapshotFiles = uniqueStrings(snapshotFiles
    .map((file) => slashPath(file?.relativePath ?? ""))
    .filter(Boolean)
    .map((relativePath) => `snapshots/${relativePath}`));
  const missingManifestFiles = [];
  for (const relativePath of expectedSnapshotFiles) {
    if (present.has(relativePath)) continue;
    if (await exists(path.join(bundleRoot, relativePath))) continue;
    missingManifestFiles.push(relativePath);
  }
  const listedMissingFiles = [];
  for (const relativePath of present) {
    if (!(await exists(path.join(bundleRoot, relativePath)))) listedMissingFiles.push(relativePath);
  }
  const repoDirty = snapshotResult?.snapshot?.repo?.dirty === true;
  const dirtyDiffIncluded = present.has("repo/UNCOMMITTED_DIFF.patch") && await exists(path.join(bundleRoot, "repo", "UNCOMMITTED_DIFF.patch"));
  const failureCodes = uniqueStrings([
    ...(missingManifestFiles.length > 0 ? ["manifest_listed_files_missing"] : []),
    ...(listedMissingFiles.length > 0 ? ["bundle_file_index_has_missing_physical_files"] : []),
    ...(repoDirty && !dirtyDiffIncluded ? ["dirty_repo_without_patch"] : []),
  ]);
  return {
    schemaVersion: "dogeedge.eval.review.bundle-completeness.v1",
    ok: failureCodes.length === 0,
    advertisedSnapshotFilesChecked: expectedSnapshotFiles.length,
    presentFileCount: present.size,
    missingManifestFiles,
    listedMissingFiles,
    repoDirty,
    dirtyDiffIncluded,
    failureCodes,
  };
}

function rawMarketTickBundleSummary(manifest, manifestPresent) {
  const parseOk = isRecord(manifest);
  const sourceSnapshotFiles = Array.isArray(manifest?.sourceSnapshotFiles) ? manifest.sourceSnapshotFiles : [];
  const targetMarkets = Array.isArray(manifest?.targetMarkets) ? manifest.targetMarkets : [];
  const coveredTargetMarkets = uniqueStrings(
    Array.isArray(manifest?.coveredTargetMarkets)
      ? manifest.coveredTargetMarkets
      : [],
  );
  const uncoveredTargetMarkets = uniqueStrings(
    Array.isArray(manifest?.uncoveredTargetMarkets)
      ? manifest.uncoveredTargetMarkets
      : targetMarkets.filter((marketTicker) => !coveredTargetMarkets.includes(marketTicker)),
  );
  const jsonlFiles = Array.isArray(manifest?.jsonlFiles) ? manifest.jsonlFiles : [];
  const requestedFormat = typeof manifest?.requestedFormat === "string"
    ? manifest.requestedFormat
    : typeof manifest?.format === "string" ? manifest.format : null;
  const exportedFormat = typeof manifest?.exportedFormat === "string"
    ? manifest.exportedFormat
    : manifest?.available === true && typeof manifest?.format === "string" ? manifest.format : null;
  const targetMarketCount = numberOrZero(manifest?.targetMarketCount ?? targetMarkets.length);
  const coveredTargetMarketCount = numberOrZero(manifest?.coveredTargetMarketCount ?? jsonlFiles.length);
  const uncoveredTargetMarketCount = numberOrZero(manifest?.uncoveredTargetMarketCount ?? Math.max(0, targetMarketCount - coveredTargetMarketCount));
  const sourceSnapshotFileCount = numberOrZero(manifest?.sourceSnapshotFileCount ?? sourceSnapshotFiles.length);
  const hashedSourceSnapshotFileCount = numberOrZero(manifest?.hashedSourceSnapshotFileCount ?? sourceSnapshotFiles.filter((source) => source?.sha256).length);
  const hashSkippedSourceSnapshotFileCount = numberOrZero(manifest?.hashSkippedSourceSnapshotFileCount ?? sourceSnapshotFiles.filter((source) => source?.hashSkipped).length);
  const sourceHashPolicy = rawSourceHashPolicy(sourceSnapshotFiles, manifest?.sourceHashPolicy);
  const coveredTargetSample = coveredTargetMarkets.slice(0, 10);
  const uncoveredTargetSample = uncoveredTargetMarkets.slice(0, 10);
  const skippedLargeFileSample = sourceSnapshotFiles
    .filter((source) => source?.hashSkipped)
    .slice(0, 5)
    .map((source) => ({
      relativePath: slashPath(source.relativePath ?? ""),
      bytes: numberOrZero(source.bytes),
      hashSkipped: true,
    }))
    .filter((source) => source.relativePath);
  const warningCodes = uniqueStrings([
    ...(!manifestPresent ? ["raw_market_tick_manifest_absent"] : []),
    ...(manifestPresent && !parseOk ? ["raw_market_tick_manifest_parse_failed"] : []),
    ...(Array.isArray(manifest?.warningCodes) ? manifest.warningCodes : []),
  ]);
  return {
    manifestPresent,
    parseOk,
    available: manifest?.available === true,
    format: exportedFormat,
    requestedFormat,
    exportedFormat,
    availabilityStatus: typeof manifest?.availabilityStatus === "string" ? manifest.availabilityStatus : null,
    reason: typeof manifest?.reason === "string" ? manifest.reason : null,
    parquetAvailable: manifest?.parquetAvailable === true,
    jsonlAvailable: manifest?.jsonlAvailable === true,
    executionSensitivePromotionAllowed: manifest?.executionSensitivePromotionAllowed === true,
    targetMarketCount,
    jsonlFileCount: jsonlFiles.length,
    sourceSnapshotFileCount,
    targetMarketCoverage: {
      covered: coveredTargetMarketCount,
      uncovered: uncoveredTargetMarketCount,
      ratio: targetMarketCount > 0 ? roundDisplayRatio(coveredTargetMarketCount / targetMarketCount) : null,
      executionSensitivePromotionAllowed: manifest?.executionSensitivePromotionAllowed === true,
    },
    targetMarketSamples: {
      covered: coveredTargetSample,
      uncovered: uncoveredTargetSample,
      omittedCoveredCount: Math.max(0, coveredTargetMarketCount - coveredTargetSample.length),
      omittedUncoveredCount: Math.max(0, uncoveredTargetMarketCount - uncoveredTargetSample.length),
    },
    sourceHash: {
      hashedFileCount: hashedSourceSnapshotFileCount,
      skippedLargeFileCount: hashSkippedSourceSnapshotFileCount,
      sha256MaxBytes: numberOrNull(manifest?.sourceHashPolicy?.sha256MaxBytes),
      totalSourceBytes: sourceHashPolicy.totalSourceBytes,
      hashedSourceBytes: sourceHashPolicy.hashedSourceBytes,
      hashSkippedSourceBytes: sourceHashPolicy.hashSkippedSourceBytes,
      hashSkippedByteRatio: sourceHashPolicy.hashSkippedByteRatio,
      skippedLargeFileSample,
      omittedSkippedLargeFileCount: Math.max(0, hashSkippedSourceSnapshotFileCount - skippedLargeFileSample.length),
    },
    warningCodes,
  };
}

function rawSourceHashPolicy(sourceSnapshotFiles, policy = {}) {
  const sources = Array.isArray(sourceSnapshotFiles) ? sourceSnapshotFiles : [];
  const hashedSources = sources.filter((source) => source?.sha256);
  const skippedSources = sources.filter((source) => source?.hashSkipped);
  const totalSourceBytes = numberOrNull(policy?.totalSourceBytes) ?? sumSourceBytes(sources);
  const hashedSourceBytes = numberOrNull(policy?.hashedSourceBytes) ?? sumSourceBytes(hashedSources);
  const hashSkippedSourceBytes = numberOrNull(policy?.hashSkippedSourceBytes) ?? sumSourceBytes(skippedSources);
  const hashSkippedByteRatio = numberOrNull(policy?.hashSkippedByteRatio)
    ?? (totalSourceBytes > 0 ? roundDisplayRatio(hashSkippedSourceBytes / totalSourceBytes) : null);
  return {
    sha256MaxBytes: numberOrNull(policy?.sha256MaxBytes),
    totalSourceBytes,
    hashedSourceBytes,
    hashSkippedSourceBytes,
    hashSkippedByteRatio,
  };
}

function sumSourceBytes(sources) {
  return sources.reduce((total, source) => total + sourceByteValue(source), 0);
}

function sourceByteValue(source) {
  const parsed = Number(source?.bytes);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function bundleLimitations({ rowExport, rawMarketTickExport, officialSettlementCoverageSummary, bundleCompleteness }) {
  return uniqueStrings([
    ...(rowExport?.rowsCapped ? ["rows_capped"] : []),
    ...(officialSettlementCoverageSummary?.promotionGradeScoringAllowed === false ? ["official_settlement_coverage_below_scoring_threshold"] : []),
    ...(officialSettlementCoverageSummary?.beyondPaperAllowed === false ? ["official_settlement_coverage_below_promotion_threshold"] : []),
    ...(Array.isArray(rawMarketTickExport?.warningCodes) ? rawMarketTickExport.warningCodes : []),
    ...(bundleCompleteness?.ok === false ? ["review_bundle_contract_incomplete"] : []),
    ...(bundleCompleteness?.repoDirty === true && bundleCompleteness?.dirtyDiffIncluded !== true ? ["dirty_repo_without_patch"] : []),
  ]);
}

export function validateEvaluationSnapshot(snapshot) {
  const errors = [];
  for (const key of [
    "schemaVersion",
    "snapshotId",
    "generatedAt",
    "sourceTimezone",
    "window",
    "repo",
    "timestampSemantics",
    "appState",
    "dataQuality",
    "experimentRegistry",
    "costModels",
    "simulatorAssumptions",
    "foldDefinitions",
    "algoRollup",
    "decisionAggregates",
    "tradeAggregates",
    "warnings",
    "filesManifest",
  ]) {
    if (snapshot?.[key] === undefined) errors.push(`missing ${key}`);
  }
  if (snapshot?.schemaVersion !== schemaVersion) errors.push("wrong schemaVersion");
  if (snapshot?.timestampSemantics?.allTimestampsUtc !== true) errors.push("timestamps must be UTC");
  if (snapshot?.appState?.liveSafety?.liveTradingEnabled !== false) errors.push("live trading must remain disabled in review snapshot");
  if (snapshot?.appState?.liveSafety?.manualApprovalRequired !== true) errors.push("manual approval flag must be true");
  if (!Array.isArray(snapshot?.algoRollup)) errors.push("algoRollup must be an array");
  if (!Array.isArray(snapshot?.filesManifest) || snapshot.filesManifest.length === 0) errors.push("filesManifest must not be empty");
  if (!snapshot?.experimentRegistry?.randomSeed) errors.push("random seed is required");
  if (!snapshot?.experimentRegistry?.configHash) errors.push("config hash is required");
  return { ok: errors.length === 0, errors };
}

function choosePrimaryRun(latestSweep, latestBacktest) {
  if (latestSweep?.runId) return latestSweep;
  return latestBacktest?.runId ? latestBacktest : {};
}

async function selectPrimaryRunMetrics(primaryRun, maxMetrics) {
  const runDir = stringOrNull(primaryRun?.runDir);
  const fullMetrics = await readJsonMaybe(runDir ? path.join(runDir, "metrics.json") : null);
  if (Array.isArray(fullMetrics)) return fullMetrics.slice(0, maxMetrics);
  if (Array.isArray(fullMetrics?.metrics)) return fullMetrics.metrics.slice(0, maxMetrics);
  return selectMetrics(primaryRun, maxMetrics);
}

function selectMetrics(primaryRun, maxMetrics) {
  const metrics = Array.isArray(primaryRun?.topMetrics)
    ? primaryRun.topMetrics
    : Array.isArray(primaryRun?.metrics) ? primaryRun.metrics : [];
  return metrics.slice(0, maxMetrics);
}

function researchCandidateIdentityMap(metrics, context) {
  const rows = new Map();
  for (const metric of metrics) {
    const identity = researchCandidateIdentity(metric, context);
    if (identity.sourceResearchAlgoId) rows.set(identity.sourceResearchAlgoId, identity);
    if (metric.algoId) rows.set(metric.algoId, identity);
    if (metric.id) rows.set(metric.id, identity);
  }
  return rows;
}

function algoRollupRow(metric, context) {
  const topStat = topStatForMetric(context.topStats, metric);
  const paperEvidence = metric.paperEvidence ?? {};
  const drift = metric.drift ?? paperEvidence;
  const telemetry = metric.executionTelemetry?.conservative ?? metric.executionTelemetry?.base ?? {};
  const displayId = displayIdFromMetric(metric, topStat);
  const identity = identityForAlgo(context.identityByAlgoId, metric.algoId);
  return {
    algoId: metric.algoId,
    displayId,
    algoName: metric.algoName ?? metric.name ?? metric.algoId,
    family: metric.family ?? topStat?.family ?? "unknown",
    researchCandidateId: identity?.researchCandidateId ?? "",
    candidateConfigHash: identity?.candidateConfigHash ?? "",
    batchId: batchIdFromAlgo(metric.algoId ?? topStat?.sourceAlgoId),
    lineageGeneration: metric.params?.generation ?? "",
    lineageParentIdsJson: jsonCell(metric.params?.parentIds ?? []),
    status: topStat ? "active_or_tracked" : metric.nonPromotable ? "research_only" : "factory_metric",
    enabled: Boolean(topStat),
    slot: slotFromMetric(metric, topStat),
    promotionStage: metric.promotionStage ?? "research_candidate",
    promotionVerdict: metric.promotionVerdict ?? "insufficient_data",
    labelSource: metric.labelSource ?? metric.settlementEvidence?.labelSource ?? "unknown",
    settlementSource: metric.settlementSource ?? metric.settlementEvidence?.settlementSource ?? "unknown",
    officialResolutionAvailable: metric.officialResolutionAvailable === true || metric.settlementEvidence?.officialResolutionAvailable === true,
    officialSettlementCoverage: numberOrNull(metric.officialSettlementCoverage ?? metric.settlementEvidence?.officialSettlementCoverage) ?? 0,
    warningCodes: metric.warnings ?? metric.warningCodes ?? [],
    reasonCodes: metric.reasonCodes ?? [],
    sampleSize: {
      closedTrades: numberOrZero(metric.closed),
      independentClosedMarkets: numberOrZero(metric.independentClosedMarkets),
      daysRepresented: numberOrZero(metric.daysRepresented),
      decisionCount: numberOrZero(topStat?.signals),
      attemptCount: numberOrZero(topStat?.attempts),
    },
    performance: {
      wins: numberOrZero(metric.wins),
      losses: numberOrZero(metric.losses),
      winRate: numberOrNull(metric.winRate),
      averagePnl: numberOrNull(metric.averagePnl),
      totalPnl: numberOrNull(metric.totalPnl),
      totalCost: numberOrNull(metric.totalCost),
      roi: numberOrNull(metric.roi),
      conservativeTotalPnl: numberOrNull(metric.conservativeTotalPnl ?? metric.costModels?.conservative?.totalPnl),
      stressTotalPnl: numberOrNull(metric.stressTotalPnl ?? metric.costModels?.stress?.totalPnl),
      maxDrawdown: numberOrNull(metric.maxDrawdown),
      downsideDeviation: numberOrNull(metric.downsideDeviation),
      profitFactor: numberOrNull(metric.profitFactor),
      robustScore: numberOrNull(metric.robustScore),
    },
    validation: {
      psr: numberOrNull(metric.psr),
      dsrApprox: numberOrNull(metric.dsrApprox),
      pboApprox: numberOrNull(metric.pboApprox),
      familyAdjustedPValue: numberOrNull(metric.familyAdjustedPValue),
      globalAdjustedPValue: numberOrNull(metric.globalAdjustedPValue),
      falseDiscoveryRisk: numberOrNull(metric.falseDiscoveryRisk),
      adjustedConfidence: numberOrNull(metric.adjustedConfidence),
      foldPositiveRate: numberOrNull(metric.foldSummary?.positiveFoldRate ?? metric.foldSummary?.foldConsistency),
      cpcvPositiveRate: numberOrNull(metric.cpcvSummary?.positiveFoldRate),
      walkForwardPass: Boolean(metric.walkForwardPass),
      walkForwardClosed: numberOrZero(metric.walkForwardClosed),
      walkForwardTotalPnl: numberOrNull(metric.walkForwardTotalPnl),
      walkForwardRoi: numberOrNull(metric.walkForwardRoi),
      holdoutPass: Boolean(metric.holdoutPass),
      holdoutClosed: numberOrZero(metric.holdoutClosed ?? metric.holdoutSummary?.holdoutClosed),
      holdoutConservativeMarkets: numberOrZero(metric.holdoutSummary?.holdoutConservativeMarkets ?? metric.holdoutSummary?.holdoutMarkets),
      holdoutConservativeTotalPnl: numberOrNull(metric.holdoutConservativeTotalPnl ?? metric.holdoutSummary?.holdoutConservativeTotalPnl),
      holdoutLowerCi: numberOrNull(metric.holdoutLowerCi ?? metric.holdoutSummary?.holdoutLowerCi),
    },
    paperEvidence: {
      available: Boolean(paperEvidence.available),
      closedMarkets: numberOrZero(paperEvidence.closedMarkets),
      closedTrades: numberOrZero(paperEvidence.closedTrades),
      totalPnl: numberOrNull(paperEvidence.totalPnl),
      roi: numberOrNull(paperEvidence.roi),
    },
    drift: {
      driftOk: drift.driftOk !== false,
      driftScore: numberOrNull(drift.driftScore) ?? 0,
      driftReasons: Array.isArray(drift.driftReasons) ? drift.driftReasons : [],
    },
    execution: {
      avgSlippageCents: numberOrNull(telemetry.averageSlippageCents ?? metric.averageSlippageCents) ?? 0,
      avgPartialFillRatio: numberOrNull(telemetry.averagePartialFillRatio ?? metric.averagePartialFillRatio) ?? 0,
      avgFillProbability: numberOrNull(telemetry.averageFillProbability ?? metric.averageFillProbability) ?? 0,
      avgFillDepthUtilization: numberOrNull(telemetry.averageFillDepthUtilization ?? metric.averageFillDepthUtilization) ?? 0,
      staleQuoteRejections: numberOrZero(telemetry.staleQuoteRejections),
      queueMisses: numberOrZero(telemetry.queueMisses),
      depthRejections: numberOrZero(telemetry.depthRejections),
    },
    warningCodes: metric.warnings ?? metric.warningCodes ?? [],
    reasonCodes: metric.reasonCodes ?? [],
    nonPromotable: Boolean(metric.nonPromotable),
    sourceRunId: context.sourceRunId,
    sourceSnapshotHash: context.sourceSnapshotHash,
  };
}

function flattenAlgoMetrics(row) {
  return {
    snapshotId: row.snapshotId,
    windowStartAt: row.windowStartAt,
    windowEndAt: row.windowEndAt,
    algoId: row.algoId,
    displayId: row.displayId,
    algoName: row.algoName,
    family: row.family,
    researchCandidateId: row.researchCandidateId,
    candidateConfigHash: row.candidateConfigHash,
    batchId: row.batchId,
    lineageGeneration: row.lineageGeneration,
    lineageParentIdsJson: row.lineageParentIdsJson,
    status: row.status,
    enabled: row.enabled,
    slot: row.slot,
    promotionStage: row.promotionStage,
    promotionVerdict: row.promotionVerdict,
    labelSource: row.labelSource,
    settlementSource: row.settlementSource,
    officialResolutionAvailable: row.officialResolutionAvailable,
    officialSettlementCoverage: row.officialSettlementCoverage,
    warningCodesJson: jsonCell(row.warningCodes),
    reasonCodesJson: jsonCell(row.reasonCodes),
    closed: row.sampleSize.closedTrades,
    independentClosedMarkets: row.sampleSize.independentClosedMarkets,
    daysRepresented: row.sampleSize.daysRepresented,
    wins: row.performance.wins,
    losses: row.performance.losses,
    winRate: row.performance.winRate,
    averagePnl: row.performance.averagePnl,
    totalPnl: row.performance.totalPnl,
    totalCost: row.performance.totalCost,
    roi: row.performance.roi,
    conservativeTotalPnl: row.performance.conservativeTotalPnl,
    stressTotalPnl: row.performance.stressTotalPnl,
    maxDrawdown: row.performance.maxDrawdown,
    downsideDeviation: row.performance.downsideDeviation,
    profitFactor: row.performance.profitFactor,
    psr: row.validation.psr,
    dsrApprox: row.validation.dsrApprox,
    pboApprox: row.validation.pboApprox,
    familyAdjustedPValue: row.validation.familyAdjustedPValue,
    globalAdjustedPValue: row.validation.globalAdjustedPValue,
    falseDiscoveryRisk: row.validation.falseDiscoveryRisk,
    adjustedConfidence: row.validation.adjustedConfidence,
    robustScore: row.performance.robustScore,
    foldPositiveRate: row.validation.foldPositiveRate,
    cpcvPositiveRate: row.validation.cpcvPositiveRate,
    walkForwardPass: row.validation.walkForwardPass,
    walkForwardClosed: row.validation.walkForwardClosed,
    walkForwardTotalPnl: row.validation.walkForwardTotalPnl,
    walkForwardRoi: row.validation.walkForwardRoi,
    holdoutPass: row.validation.holdoutPass,
    holdoutClosed: row.validation.holdoutClosed,
    holdoutConservativeMarkets: row.validation.holdoutConservativeMarkets,
    holdoutConservativeTotalPnl: row.validation.holdoutConservativeTotalPnl,
    holdoutLowerCi: row.validation.holdoutLowerCi,
    paperEvidenceAvailable: row.paperEvidence.available,
    paperClosedMarkets: row.paperEvidence.closedMarkets,
    paperClosedTrades: row.paperEvidence.closedTrades,
    paperTotalPnl: row.paperEvidence.totalPnl,
    paperRoi: row.paperEvidence.roi,
    driftOk: row.drift.driftOk,
    driftScore: row.drift.driftScore,
    driftReasonsJson: jsonCell(row.drift.driftReasons),
    avgSlippageCents: row.execution.avgSlippageCents,
    avgPartialFillRatio: row.execution.avgPartialFillRatio,
    avgFillProbability: row.execution.avgFillProbability,
    avgFillDepthUtilization: row.execution.avgFillDepthUtilization,
    sourceRunId: row.sourceRunId,
    sourceSnapshotHash: row.sourceSnapshotHash,
  };
}

function decisionAggregateRows({ snapshotId, windowStartAt, windowEndAt, topStats, metricByAlgoId, identityByAlgoId }) {
  return Object.values(topStats).map((stat) => {
    const metric = metricByAlgoId.get(stat.sourceAlgoId) ?? metricByAlgoId.get(stat.algoId) ?? {};
    const identity = identityForAlgo(identityByAlgoId, stat.sourceAlgoId ?? stat.algoId);
    const attempts = numberOrZero(stat.attempts);
    return {
      snapshotId,
      windowStartAt,
      windowEndAt,
      algoId: stat.sourceAlgoId ?? stat.algoId ?? "",
      displayId: stat.displayId ?? displayIdFromMetric(metric, stat),
      family: stat.family ?? metric.family ?? "",
      researchCandidateId: identity?.researchCandidateId ?? "",
      candidateConfigHash: identity?.candidateConfigHash ?? "",
      promotionStage: metric.promotionStage ?? "dry_run_evidence",
      promotionVerdict: metric.promotionVerdict ?? "dry_run_evidence_only",
      marketCount: numberOrZero(metric.independentClosedMarkets),
      independentMarketCount: numberOrZero(metric.independentClosedMarkets),
      decisionCount: numberOrZero(stat.signals),
      signalCount: numberOrZero(stat.signals),
      attemptCount: attempts,
      acceptedBuys: numberOrZero(stat.acceptedBuys),
      acceptRate: attempts ? numberOrZero(stat.acceptedBuys) / attempts : 0,
      buySignals: numberOrZero(stat.buys),
      exitSignals: numberOrZero(stat.sells),
      skipSignals: Math.max(0, numberOrZero(stat.signals) - attempts),
      rejectCount: numberOrZero(stat.rejected),
      staleRejects: numberOrZero(stat.staleRejects),
      edgeRejects: numberOrZero(stat.edgeRejects),
      depthRejects: numberOrZero(stat.depthRejects),
      gateRejects: numberOrZero(stat.gateRejects),
      priceRejects: numberOrZero(stat.priceRejects),
      otherRejects: numberOrZero(stat.otherRejects),
      featureTimestampMin: stat.startedAt ?? "",
      featureTimestampMax: stat.lastSignalAt ?? "",
      decisionTimestampMin: stat.startedAt ?? "",
      decisionTimestampMax: stat.lastAttemptAt ?? stat.lastSignalAt ?? "",
      regimeTimeToClose: "",
      regimeSpread: "",
      regimeLiquidity: "",
      regimeVolatility: "",
      regimeMomentum: "",
      regimeDistance: "",
      warningCodesJson: jsonCell(metric.warnings ?? []),
    };
  });
}

function tradeAggregateRows({ snapshotId, windowStartAt, windowEndAt, metrics, topStats, identityByAlgoId }) {
  return metrics.map((metric) => {
    const stat = topStatForMetric(topStats, metric);
    const identity = identityForAlgo(identityByAlgoId, metric.algoId);
    return {
      snapshotId,
      windowStartAt,
      windowEndAt,
      algoId: metric.algoId,
      displayId: displayIdFromMetric(metric, stat),
      family: metric.family ?? stat?.family ?? "",
      researchCandidateId: identity?.researchCandidateId ?? "",
      candidateConfigHash: identity?.candidateConfigHash ?? "",
      promotionStage: metric.promotionStage ?? "research_candidate",
      promotionVerdict: metric.promotionVerdict ?? "insufficient_data",
      openedCount: numberOrZero(metric.closed) + numberOrZero(metric.open),
      closedCount: numberOrZero(metric.closed),
      openCount: numberOrZero(metric.open),
      independentClosedMarkets: numberOrZero(metric.independentClosedMarkets),
      wins: numberOrZero(metric.wins),
      losses: numberOrZero(metric.losses),
      totalContracts: numberOrZero(metric.turnover),
      totalFees: numberOrZero(metric.totalFees ?? metric.feesPaid),
      totalCost: numberOrZero(metric.totalCost),
      totalPnl: numberOrNull(metric.totalPnl) ?? 0,
      roi: numberOrNull(metric.roi) ?? 0,
      averagePnl: numberOrNull(metric.averagePnl) ?? 0,
      maxDrawdown: numberOrNull(metric.maxDrawdown) ?? 0,
      averageHoldingSeconds: numberOrNull(metric.exposureSeconds) ?? "",
      averageEntryPrice: numberOrNull(metric.averageEntryPrice) ?? "",
      averageExitPrice: numberOrNull(metric.averageExitPrice) ?? "",
      averageSlippageCents: numberOrNull(metric.averageSlippageCents ?? metric.executionTelemetry?.conservative?.averageSlippageCents) ?? 0,
      averageFillProbability: numberOrNull(metric.averageFillProbability ?? metric.executionTelemetry?.conservative?.averageFillProbability) ?? 0,
      averagePartialFillRatio: numberOrNull(metric.averagePartialFillRatio ?? metric.executionTelemetry?.conservative?.averagePartialFillRatio) ?? 0,
      staleQuoteRejections: numberOrZero(metric.executionTelemetry?.conservative?.staleQuoteRejections),
      queueMisses: numberOrZero(metric.executionTelemetry?.conservative?.queueMisses),
      depthRejections: numberOrZero(metric.executionTelemetry?.conservative?.depthRejections),
      regimeTimeToClose: jsonCell(metric.regimeBreakdown?.timeToClose ?? {}),
      regimeSpread: jsonCell(metric.regimeBreakdown?.spread ?? {}),
      regimeLiquidity: jsonCell(metric.regimeBreakdown?.liquidity ?? {}),
      regimeVolatility: jsonCell(metric.regimeBreakdown?.volatility ?? {}),
      regimeMomentum: jsonCell(metric.regimeBreakdown?.momentum ?? {}),
      regimeDistance: jsonCell(metric.regimeBreakdown?.distance ?? {}),
      warningCodesJson: jsonCell(metric.warnings ?? []),
    };
  });
}

function foldDefinitionRows(registry, primaryRun) {
  const rows = [];
  for (const fold of registry.foldDefinitions ?? primaryRun?.purgedFolds ?? []) {
    rows.push(foldDefinitionRow(fold, "purged"));
  }
  for (const fold of registry.cpcvFoldDefinitions ?? primaryRun?.cpcvFolds ?? []) {
    rows.push(foldDefinitionRow(fold, "cpcv"));
  }
  const holdout = registry.holdoutDefinition ?? primaryRun?.holdoutDefinition;
  if (holdout) {
    rows.push({
      id: "holdout",
      kind: "holdout",
      trainEventIdsHash: null,
      validationEventIdsHash: hashEventIds(holdout.holdoutEventIds),
      purgedEventIdsHash: null,
      embargoedEventIdsHash: null,
      embargoMs: null,
      strictlyLater: holdout.strictlyLater === true,
      holdoutEventIdsHash: hashEventIds(holdout.holdoutEventIds),
      reason: holdout.reason ?? null,
    });
  }
  if (primaryRun?.walkForwardFrameCount) {
    rows.push({
      id: "walk-forward",
      kind: "walkForward",
      trainEventIdsHash: null,
      validationEventIdsHash: null,
      purgedEventIdsHash: null,
      embargoedEventIdsHash: null,
      embargoMs: null,
      strictlyLater: true,
    });
  }
  return rows;
}

function foldDefinitionRow(fold, kind) {
  return {
    id: fold.id,
    kind,
    trainEventIdsHash: hashEventIds(fold.trainEventIds),
    validationEventIdsHash: hashEventIds(fold.validationEventIds),
    purgedEventIdsHash: hashEventIds(fold.purgedEventIds),
    embargoedEventIdsHash: hashEventIds(fold.embargoedEventIds),
    embargoMs: numberOrNull(fold.embargoMs),
    strictlyLater: kind === "holdout" ? fold.strictlyLater === true : null,
    trainEventCount: Array.isArray(fold.trainEventIds) ? fold.trainEventIds.length : 0,
    validationEventCount: Array.isArray(fold.validationEventIds) ? fold.validationEventIds.length : 0,
    purgedEventCount: Array.isArray(fold.purgedEventIds) ? fold.purgedEventIds.length : 0,
    embargoedEventCount: Array.isArray(fold.embargoedEventIds) ? fold.embargoedEventIds.length : 0,
  };
}

function foldMetricRows({ snapshotId, metrics, registry, primaryRun }) {
  const definitionById = new Map(foldDefinitionRows(registry, primaryRun).map((fold) => [fold.id, fold]));
  const rows = [];
  for (const metric of metrics) {
    for (const fold of metric.foldMetrics ?? []) {
      rows.push(foldMetricRow(snapshotId, metric.algoId, "purged", fold, definitionById.get(fold.foldId ?? fold.id)));
    }
    for (const fold of metric.cpcvMetrics ?? metric.cpcvPathMetrics ?? []) {
      rows.push(foldMetricRow(snapshotId, metric.algoId, "cpcv", fold, definitionById.get(fold.foldId ?? fold.id)));
    }
    if (metric.walkForwardClosed !== undefined) {
      rows.push({
        snapshotId,
        algoId: metric.algoId,
        foldKind: "walkForward",
        foldId: "walk-forward",
        trainEventIdsHash: "",
        validationEventIdsHash: "",
        purgedEventIdsHash: "",
        embargoedEventIdsHash: "",
        embargoMs: "",
        strictlyLater: true,
        trainEventCount: "",
        validationEventCount: "",
        purgedEventCount: "",
        embargoedEventCount: "",
        closed: numberOrZero(metric.walkForwardClosed),
        independentClosedMarkets: numberOrZero(metric.walkForwardClosed),
        wins: numberOrZero(metric.walkForwardWins),
        losses: numberOrZero(metric.walkForwardLosses),
        winRate: numberOrNull(metric.walkForwardWinRate),
        averagePnl: "",
        totalPnl: numberOrNull(metric.walkForwardTotalPnl),
        totalCost: numberOrNull(metric.walkForwardTotalCost),
        roi: numberOrNull(metric.walkForwardRoi),
        maxDrawdown: numberOrNull(metric.walkForwardMaxDrawdown),
        lowerCi: "",
        upperCi: "",
        pass: Boolean(metric.walkForwardPass),
      });
    }
    if (metric.holdoutSummary || metric.holdoutClosed !== undefined) {
      rows.push({
        snapshotId,
        algoId: metric.algoId,
        foldKind: "holdout",
        foldId: "holdout",
        trainEventIdsHash: "",
        validationEventIdsHash: definitionById.get("holdout")?.holdoutEventIdsHash ?? "",
        purgedEventIdsHash: "",
        embargoedEventIdsHash: "",
        embargoMs: "",
        strictlyLater: metric.holdoutStrictlyLater ?? metric.holdoutSummary?.strictlyLater ?? true,
        trainEventCount: "",
        validationEventCount: metric.holdoutSummary?.holdoutMarkets ?? "",
        purgedEventCount: "",
        embargoedEventCount: "",
        closed: numberOrZero(metric.holdoutClosed ?? metric.holdoutSummary?.holdoutClosed),
        independentClosedMarkets: numberOrZero(metric.holdoutSummary?.holdoutMarkets ?? metric.holdoutClosed),
        wins: "",
        losses: "",
        winRate: "",
        averagePnl: "",
        totalPnl: numberOrNull(metric.holdoutConservativeTotalPnl ?? metric.holdoutSummary?.holdoutConservativeTotalPnl),
        totalCost: "",
        roi: numberOrNull(metric.holdoutSummary?.holdoutConservativeRoi ?? metric.holdoutRoi),
        maxDrawdown: numberOrNull(metric.holdoutMaxDrawdown),
        lowerCi: numberOrNull(metric.holdoutLowerCi ?? metric.holdoutSummary?.holdoutLowerCi),
        upperCi: "",
        pass: Boolean(metric.holdoutPass),
      });
    }
  }
  return rows;
}

function foldMetricRow(snapshotId, algoId, kind, fold, definition = {}) {
  return {
    snapshotId,
    algoId,
    foldKind: kind,
    foldId: fold.foldId ?? fold.id,
    trainEventIdsHash: definition.trainEventIdsHash ?? "",
    validationEventIdsHash: definition.validationEventIdsHash ?? "",
    purgedEventIdsHash: definition.purgedEventIdsHash ?? "",
    embargoedEventIdsHash: definition.embargoedEventIdsHash ?? "",
    embargoMs: definition.embargoMs ?? "",
    strictlyLater: definition.strictlyLater ?? "",
    trainEventCount: definition.trainEventCount ?? "",
    validationEventCount: definition.validationEventCount ?? "",
    purgedEventCount: definition.purgedEventCount ?? "",
    embargoedEventCount: definition.embargoedEventCount ?? "",
    closed: numberOrZero(fold.closed),
    independentClosedMarkets: numberOrZero(fold.independentClosedMarkets ?? fold.closed),
    wins: numberOrZero(fold.wins),
    losses: numberOrZero(fold.losses),
    winRate: numberOrNull(fold.winRate),
    averagePnl: numberOrNull(fold.averagePnl),
    totalPnl: numberOrNull(fold.totalPnl),
    totalCost: numberOrNull(fold.totalCost),
    roi: numberOrNull(fold.roi),
    maxDrawdown: numberOrNull(fold.maxDrawdown),
    lowerCi: numberOrNull(fold.lowerCi ?? fold.bootstrap?.meanPnl?.lower),
    upperCi: numberOrNull(fold.upperCi ?? fold.bootstrap?.meanPnl?.upper),
    pass: (fold.totalPnl ?? 0) > 0,
  };
}

async function readDecisionRows({ dataRoot, snapshotId, maxRowLines }) {
  const framesDir = path.join(dataRoot, "features", "decision-frames");
  const files = await latestFilesRecursive(framesDir, [".jsonl", ".ndjson"], 3);
  const rows = [];
  for (const file of files) {
    const hash = await hashFileMaybe(file);
    const lines = await readTailLines(file, Math.max(1, Math.ceil(maxRowLines / Math.max(1, files.length))));
    lines.forEach((line, index) => {
      const parsed = parseJsonLine(line);
      if (!parsed) return;
      const row = decisionRowFromFrame(parsed, { snapshotId, sourceFileHash: hash, sourceLine: index + 1 });
      if (isPostCloseDecisionRow(row)) return;
      rows.push(row);
    });
  }
  return rows.slice(-maxRowLines);
}

function isPostCloseDecisionRow(row) {
  const closeMs = parseTime(row.marketCloseTimestamp);
  if (closeMs === null) return false;
  const featureMs = parseTime(row.featureTimestamp);
  const decisionMs = parseTime(row.decisionTimestamp);
  return (featureMs !== null && featureMs >= closeMs)
    || (decisionMs !== null && decisionMs > closeMs);
}

function decisionRowFromFrame(frame, context) {
  const marketTicker = frame.marketTicker ?? frame.market_id ?? frame.marketId ?? "";
  const observedAt = frame.observedAt ?? frame.frame_timestamp_utc ?? frame.featureTimestamp ?? "";
  const capturedAt = frame.capturedAt ?? observedAt;
  const marketClose = frame.marketCloseTimestamp ?? frame.marketCloseTime ?? frame.market_close_timestamp_utc ?? "";
  return {
    snapshotId: context.snapshotId,
    rowId: frame.id ?? frame.frame_id ?? `${marketTicker}:${observedAt}`,
    marketTicker,
    algoId: frame.strategyId ?? frame.strategy_id ?? "",
    displayId: displayIdFromAlgo(frame.strategyId ?? frame.strategy_id ?? ""),
    family: frame.family ?? "",
    researchCandidateId: frame.researchCandidateId ?? "",
    candidateConfigHash: frame.candidateConfigHash ?? "",
    featureTimestamp: frame.featureTimestamp ?? frame.feature_timestamps?.estimate ?? observedAt,
    decisionTimestamp: frame.decisionTimestamp ?? observedAt,
    labelTimestamp: frame.labelTimestamp ?? frame.label_timestamp_utc ?? marketClose,
    settlementTimestamp: frame.settlementTimestamp ?? frame.label_timestamp_utc ?? marketClose,
    labelSource: frame.labelSource ?? frame.label_source ?? "unknown",
    settlementSource: frame.settlementSource ?? "estimated",
    officialResolutionAvailable: frame.officialResolutionAvailable === true || frame.settlementSource === "official_resolution",
    marketCloseTimestamp: marketClose,
    side: sideFromAction(frame.modelAction ?? frame.decisionAction),
    decisionAction: frame.modelAction ?? frame.decisionAction ?? "",
    attempted: Boolean(frame.attempted ?? false),
    accepted: Boolean(frame.accepted ?? false),
    rejectCode: frame.rejectCode ?? "",
    rejectMessage: frame.rejectMessage ?? "",
    observedAt,
    capturedAt,
    secondsToClose: numberOrNull(frame.secondsToClose ?? frame.feature_map?.secondsToClose),
    targetPrice: numberOrNull(frame.targetPrice ?? frame.feature_map?.targetPrice),
    estimate: numberOrNull(frame.estimate ?? frame.feature_map?.estimate),
    spotPrice: numberOrNull(frame.spotPrice ?? frame.feature_map?.spotPrice),
    oneMinuteChange: numberOrNull(frame.oneMinuteChange),
    oneMinuteMovePercent: numberOrNull(frame.oneMinuteMovePercent),
    distanceFromTarget: numberOrNull(frame.distanceFromTarget),
    fairProbability: numberOrNull(frame.fairProbability),
    modelAction: frame.modelAction ?? "",
    modelConfidence: numberOrNull(frame.modelConfidence),
    modelEdgeAfterFees: numberOrNull(frame.modelEdgeAfterFees),
    yesBid: numberOrNull(frame.yesBid ?? frame.feature_map?.yesBid),
    yesAsk: numberOrNull(frame.yesAsk ?? frame.feature_map?.yesAsk),
    noBid: numberOrNull(frame.noBid ?? frame.feature_map?.noBid),
    noAsk: numberOrNull(frame.noAsk ?? frame.feature_map?.noAsk),
    yesSpread: numberOrNull(frame.yesSpread),
    noSpread: numberOrNull(frame.noSpread),
    yesBidDepth: numberOrNull(frame.yesTopDepth?.bidSize ?? frame.yesBidDepth),
    yesAskDepth: numberOrNull(frame.yesTopDepth?.askSize ?? frame.yesAskDepth),
    noBidDepth: numberOrNull(frame.noTopDepth?.bidSize ?? frame.noBidDepth),
    noAskDepth: numberOrNull(frame.noTopDepth?.askSize ?? frame.noAskDepth),
    regimeTimeToClose: frame.regime?.timeToClose ?? frame.regime_tags?.timeToClose ?? "",
    regimeSpread: frame.regime?.spread ?? frame.regime_tags?.spread ?? "",
    regimeLiquidity: frame.regime?.liquidity ?? frame.regime_tags?.liquidity ?? "",
    regimeVolatility: frame.regime?.volatility ?? frame.regime_tags?.volatility ?? "",
    regimeMomentum: frame.regime?.momentum ?? frame.regime_tags?.momentum ?? "",
    regimeDistance: frame.regime?.distance ?? frame.regime_tags?.distance ?? "",
    regimePhase: frame.regime?.phase ?? frame.regime_tags?.phase ?? "",
    independentKey: marketTicker,
    overlapCount: numberOrZero(frame.overlapCount),
    sourceFileHash: context.sourceFileHash,
    sourceLine: context.sourceLine,
  };
}

async function readTradeRows({ filePath, snapshotId, maxRowLines, metricByAlgoId, identityByAlgoId, sourceRunId, sourceSnapshotHash }) {
  const lines = await readTailLines(filePath, maxRowLines);
  return lines.map((line) => parseJsonLine(line))
    .filter(Boolean)
    .map((trade) => tradeRowFromPaperTrade(trade, { snapshotId, metricByAlgoId, identityByAlgoId, sourceRunId, sourceSnapshotHash }));
}

function tradeRowFromPaperTrade(trade, context) {
  const rawAlgoId = trade.strategyId ?? trade.algoId ?? "";
  const algoId = rawAlgoId.startsWith("generated:") ? rawAlgoId.slice("generated:".length) : rawAlgoId;
  const metric = context.metricByAlgoId.get(algoId) ?? context.metricByAlgoId.get(rawAlgoId) ?? {};
  const identity = identityForAlgo(context.identityByAlgoId, algoId);
  return {
    snapshotId: context.snapshotId,
    tradeId: trade.id ?? trade.tradeId ?? "",
    marketTicker: trade.marketTicker ?? trade.market_id ?? "",
    algoId,
    displayId: displayIdFromAlgo(algoId),
    family: trade.family ?? metric.family ?? "",
    researchCandidateId: identity?.researchCandidateId ?? "",
    candidateConfigHash: identity?.candidateConfigHash ?? "",
    promotionStage: metric.promotionStage ?? "paper_evidence",
    promotionVerdict: metric.promotionVerdict ?? "dry_run_evidence_only",
    openedAt: trade.openedAt ?? trade.timestamp ?? "",
    closedAt: trade.closedAt ?? "",
    decisionTimestamp: trade.decisionTimestamp ?? trade.openedAt ?? trade.timestamp ?? "",
    featureTimestamp: trade.featureTimestamp ?? trade.openedAt ?? trade.timestamp ?? "",
    labelTimestamp: trade.labelTimestamp ?? trade.closedAt ?? "",
    settlementTimestamp: trade.settlementTimestamp ?? trade.closedAt ?? "",
    labelSource: trade.labelSource ?? trade.entryContext?.labelSource ?? "unknown",
    settlementSource: trade.settlementSource ?? "estimated",
    officialResolutionAvailable: trade.officialResolutionAvailable === true || trade.settlementSource === "official_resolution",
    status: trade.status ?? "",
    side: trade.side ?? "",
    contracts: numberOrZero(trade.contracts ?? trade.size),
    entryPrice: numberOrNull(trade.entryPrice ?? trade.price),
    exitPrice: numberOrNull(trade.exitPrice),
    bestExitPrice: numberOrNull(trade.bestExitPrice),
    feesPaid: numberOrNull(trade.feesPaid),
    pnl: numberOrNull(trade.pnl),
    roiPerTrade: numberOrNull(trade.roi ?? trade.roiPerTrade),
    holdingSeconds: holdingSeconds(trade),
    fillProbability: numberOrNull(trade.fillProbability ?? trade.entryContext?.fillProbability),
    partialFillRatio: numberOrNull(trade.partialFillRatio ?? trade.entryContext?.partialFillRatio),
    slippageCents: numberOrNull(trade.slippageCents ?? trade.entryContext?.slippageCents),
    depthUtilization: numberOrNull(trade.depthUtilization ?? trade.entryContext?.fillDepthUtilization),
    queueMiss: Boolean(trade.queueMiss ?? trade.entryContext?.queueMiss),
    rejectCode: trade.rejectCode ?? "",
    entryReason: trade.entryReason ?? trade.reason ?? "",
    exitReason: trade.exitReason ?? "",
    entryRegimeTimeToClose: trade.entryContext?.regime?.timeToClose ?? "",
    entryRegimeSpread: trade.entryContext?.regime?.spread ?? "",
    entryRegimeLiquidity: trade.entryContext?.regime?.liquidity ?? "",
    entryRegimeVolatility: trade.entryContext?.regime?.volatility ?? "",
    entryRegimeMomentum: trade.entryContext?.regime?.momentum ?? "",
    entryRegimeDistance: trade.entryContext?.regime?.distance ?? "",
    sourceRunId: context.sourceRunId,
    sourceSnapshotHash: context.sourceSnapshotHash,
  };
}

async function writeExactReviewFiles({
  snapshotDir,
  snapshotId,
  generatedAt,
  dataRoot,
  decisionRows,
  tradeRows,
  topStats,
  metricByAlgoId,
  identityByAlgoId,
  primaryRun,
  registry,
  gitInfo,
  rawTickFormat = "jsonl",
  maxRawTickMarkets = 20,
  maxRawTickRowsPerMarket = 50_000,
  sourceRunId,
  sourceSnapshotHash,
  officialSettlements = [],
}) {
  const files = [];
  const decisionFramesPath = path.join(snapshotDir, "decision_frames.jsonl");
  const tradeCsvPath = path.join(snapshotDir, "trades.csv");
  const ledgerCsvPath = path.join(snapshotDir, "paper_decision_ledger.csv");
  const officialSettlementsJsonlPath = path.join(snapshotDir, "official_settlements.jsonl");

  await writeFile(
    decisionFramesPath,
    decisionRows.map(decisionFrameJsonLine).join("\n") + (decisionRows.length ? "\n" : ""),
    "utf8",
  );
  files.push(await fileInfo(decisionFramesPath, "decision_frames.jsonl", "decision_frames.jsonl", decisionRows.length));

  await writeFile(tradeCsvPath, csv(tradeRowsColumns, tradeRows), "utf8");
  files.push(await fileInfo(tradeCsvPath, "trades.csv", "trades.csv", tradeRows.length));

  const ledgerRows = paperDecisionLedgerRows({
    snapshotId,
    decisionRows,
    tradeRows,
    topStats,
    metricByAlgoId,
    identityByAlgoId,
    sourceRunId,
    sourceSnapshotHash,
    gitCommit: gitInfo.commitHash ?? primaryRun?.gitCommit ?? registry?.gitCommit ?? "UNAVAILABLE",
    dataHash: registry?.dataHash ?? registry?.inputManifestHash ?? primaryRun?.dataHash ?? "UNAVAILABLE",
    configHash: registry?.configHash ?? primaryRun?.configHash ?? "UNAVAILABLE",
  });
  await writeFile(ledgerCsvPath, csv(paperDecisionLedgerColumns, ledgerRows), "utf8");
  files.push(await fileInfo(ledgerCsvPath, "paper_decision_ledger.csv", "paper_decision_ledger.csv", ledgerRows.length));

  await writeFile(
    officialSettlementsJsonlPath,
    officialSettlements.length
      ? officialSettlements.map((row) => JSON.stringify(officialSettlementJsonLine(row))).join("\n") + "\n"
      : "\n",
    "utf8",
  );
  files.push(await fileInfo(officialSettlementsJsonlPath, "official_settlements.jsonl", "official_settlements.jsonl", officialSettlements.length));

  files.push(...await writeRawMarketTicksManifest({
    snapshotDir,
    dataRoot,
    snapshotId,
    generatedAt,
    gitInfo,
    decisionRows,
    tradeRows,
    rawTickFormat,
    maxRawTickMarkets,
    maxRawTickRowsPerMarket,
  }));
  return files;
}

async function writeAuditReviewFiles({
  snapshotDir,
  alignment,
  leakageAudit,
  familyAllocationReport,
  topRosterDefaultSortAudit,
  researchLiveIdentityAlignment,
  exactLinkSummary,
  settlementCoverageReport,
  replayParityReport,
  rejectStreamSummary,
  executableReadinessGate,
  simulatorCalibrationReport,
  simulatorCalibrationMarkdown,
  schedulerBudgetReport,
  provenanceCompletenessReport,
}) {
  const files = [];
  const writes = [
    ["leakage_audit.json", leakageAudit],
    ["research_live_alignment.json", alignment],
    ["research_live_identity_alignment.json", researchLiveIdentityAlignment],
    ["exact_link_summary.json", exactLinkSummary],
    ["settlement_coverage_report.json", settlementCoverageReport],
    ["simulator_calibration_report.json", simulatorCalibrationReport],
    ["calibration_report.json", simulatorCalibrationReport],
    ["replay_parity_report.json", replayParityReport],
    ["reject_stream_summary.json", rejectStreamSummary],
    ["executable_readiness_gate.json", executableReadinessGate],
    ["family_allocation_report.json", familyAllocationReport],
    ["scheduler_budget_report.json", schedulerBudgetReport],
    ["provenance_completeness_report.json", provenanceCompletenessReport],
    ["top_roster_default_sort_audit.json", topRosterDefaultSortAudit],
  ];
  for (const [name, value] of writes) {
    const filePath = path.join(snapshotDir, name);
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    files.push(await fileInfo(filePath, name, name, null));
  }
  if (typeof simulatorCalibrationMarkdown === "string") {
    const markdownPath = path.join(snapshotDir, "simulator_calibration_report.md");
    await writeFile(markdownPath, simulatorCalibrationMarkdown, "utf8");
    files.push(await fileInfo(markdownPath, "simulator_calibration_report.md", "simulator_calibration_report.md", null));
  }
  return files;
}

function alignmentRows({ snapshotId, metrics, topStats, primaryRun, alignment, leakageAudit, identityByAlgoId }) {
  const metricByExactIdentity = new Map(metrics.map((metric) => {
    const identity = identityForAlgo(identityByAlgoId, metric.algoId);
    const researchCandidateId = stringOrNull(metric.researchCandidateId) ?? identity?.researchCandidateId ?? "";
    const candidateConfigHash = stringOrNull(metric.candidateConfigHash) ?? identity?.candidateConfigHash ?? "";
    return [exactIdentityKey(researchCandidateId, candidateConfigHash), metric];
  }).filter(([key]) => key !== null));
  const researchSnapshotId = primaryRun?.runId ?? null;
  const researchFinishedMs = parseTime(primaryRun?.finishedAt);
  const nowMs = Date.now();
  const researchAgeHours = Number.isFinite(researchFinishedMs) ? roundDisplayRatio((nowMs - researchFinishedMs) / 3_600_000) : null;
  const rosterAlignment = Object.values(topStats).map((stat) => {
    const statResearchCandidateId = stringOrNull(stat.researchCandidateId);
    const statCandidateConfigHash = stringOrNull(stat.candidateConfigHash);
    const exactKey = exactIdentityKey(statResearchCandidateId, statCandidateConfigHash);
    const metric = exactKey ? metricByExactIdentity.get(exactKey) ?? null : null;
    const sourceResearchAlgoId = stringOrNull(stat.sourceResearchAlgoId) ?? metric?.algoId ?? stat.sourceAlgoId ?? stat.algoId ?? "";
    const family = stat.family ?? metric?.family ?? "unknown";
    const familyEntry = familyRegistryEntry(family);
    const researchSupported = familyEntry.researchSupported === true;
    const researchVerdict = metric?.promotionVerdict ?? "missing";
    const identity = metric ? identityForAlgo(identityByAlgoId, metric.algoId) : null;
    const linkageStatus = metric
      ? "exact_candidate_linked"
      : researchSupported ? "missing_exact_link" : "unsupported_unlinked";
    const dryRunTotalPnl = numberOrZero(stat.totalPnl);
    const gate = metricGate(metric, researchSupported);
    return {
      snapshotId,
      algoId: stat.sourceAlgoId ?? stat.algoId ?? "",
      displayId: stat.displayId ?? displayIdFromAlgo(stat.sourceAlgoId ?? stat.algoId ?? ""),
      family,
      researchCandidateId: statResearchCandidateId ?? identity?.researchCandidateId ?? "",
      candidateConfigHash: statCandidateConfigHash ?? identity?.candidateConfigHash ?? "",
      linkageStatus,
      researchSupported,
      supportReason: familyEntry.reason ?? "research_adapter_available",
      sourceResearchAlgoId: metric ? metric.algoId : sourceResearchAlgoId,
      sourceRunId: stringOrNull(stat.sourceRunId) ?? stringOrNull(primaryRun?.runId) ?? "",
      sourceSnapshotHash: stringOrNull(stat.sourceSnapshotHash) ?? "",
      promotionVerdictAtInstall: stringOrNull(stat.promotionVerdictAtInstall) ?? "",
      researchSnapshotId: metric ? researchSnapshotId : "",
      researchVerdict,
      researchAgeHours: metric ? researchAgeHours : "",
      dryRunTotalPnl,
      dryRunClosedExits: numberOrZero(stat.sells),
      dryRunAcceptedBuys: numberOrZero(stat.acceptedBuys),
      defaultBucket: gate.ok ? "research_validated" : "watch",
      watchOnly: !gate.ok,
    };
  });
  const researchCoverage = Object.entries(alignment.researchFamilies ?? {}).map(([family, count]) => familyCoverageRow(snapshotId, family, count, "research"));
  const liveCoverage = Object.entries(alignment.liveFamilies ?? {}).map(([family, count]) => familyCoverageRow(snapshotId, family, count, "live"));
  const unsupportedLiveFamilies = (alignment.unsupportedLiveFamilies ?? []).map((row) => familyCoverageRow(snapshotId, row.family, row.count, "live_unsupported"));
  const promotionGateResults = metrics.map((metric) => {
    const familyEntry = familyRegistryEntry(metric.family);
    const gate = metricGate(metric, familyEntry.researchSupported === true);
    const identity = identityForAlgo(identityByAlgoId, metric.algoId);
    return {
      snapshotId,
      algoId: metric.algoId ?? "",
      family: metric.family ?? "unknown",
      researchCandidateId: identity?.researchCandidateId ?? "",
      candidateConfigHash: identity?.candidateConfigHash ?? "",
      promotionVerdict: metric.promotionVerdict ?? "unknown",
      researchSupported: familyEntry.researchSupported === true,
      gatePass: gate.ok,
      reasonCodesJson: jsonCell(gate.reasonCodes),
      conservativeTotalPnl: numberOrNull(metric.conservativeTotalPnl),
      stressTotalPnl: numberOrNull(metric.stressTotalPnl),
      holdoutPass: metric.holdoutPass === true,
      holdoutLowerCi: numberOrNull(metric.holdoutLowerCi),
      adjustedConfidence: numberOrNull(metric.adjustedConfidence),
      falseDiscoveryRisk: numberOrNull(metric.falseDiscoveryRisk),
    };
  });
  return {
    rosterAlignment,
    researchCoverage,
    liveCoverage,
    unsupportedLiveFamilies,
    promotionGateResults,
    postCloseFrameAudit: postCloseFrameAuditRow(snapshotId, leakageAudit),
  };
}

function familyCoverageRow(snapshotId, family, count, source) {
  const entry = familyRegistryEntry(family);
  return {
    snapshotId,
    family,
    count,
    researchSupported: entry.researchSupported === true,
    supportReason: entry.reason ?? "research_adapter_available",
    source,
  };
}

function exactCandidateArtifacts({ snapshotId, metrics, topStats, decisionRows, tradeRows, identityByAlgoId, metricByAlgoId, alignmentArtifacts }) {
  const liveRows = Object.values(topStats);
  const rosterRows = alignmentArtifacts.rosterAlignment;
  const liveBySource = new Map(liveRows.map((row) => [String(row.sourceAlgoId ?? row.algoId ?? ""), row]));
  const liveByExactIdentity = new Map(liveRows.map((row) => [exactIdentityKey(row.researchCandidateId, row.candidateConfigHash), row]).filter(([key]) => key !== null));
  const candidateLineageAudit = metrics.map((metric) => {
    const identity = identityForAlgo(identityByAlgoId, metric.algoId);
    const gate = metricGate(metric, familyRegistryEntry(metric.family).researchSupported === true);
    const linkedLiveRows = liveByExactIdentity.has(exactIdentityKey(
      stringOrNull(metric.researchCandidateId) ?? identity?.researchCandidateId,
      stringOrNull(metric.candidateConfigHash) ?? identity?.candidateConfigHash,
    )) ? 1 : 0;
    return {
      snapshotId,
      researchCandidateId: identity?.researchCandidateId ?? "",
      candidateConfigHash: identity?.candidateConfigHash ?? "",
      sourceResearchAlgoId: metric.algoId ?? "",
      family: metric.family ?? "unknown",
      promotionVerdict: metric.promotionVerdict ?? "unknown",
      gatePass: gate.ok,
      linkedLiveRows,
      linkedDecisionRows: decisionRows.filter((row) => row.researchCandidateId === identity?.researchCandidateId).length,
      linkedTradeRows: tradeRows.filter((row) => row.researchCandidateId === identity?.researchCandidateId).length,
      officialSettlementCoverage: numberOrZero(metric.officialSettlementCoverage),
      conservativeTotalPnl: numberOrNull(metric.conservativeTotalPnl) ?? 0,
      stressTotalPnl: numberOrNull(metric.stressTotalPnl) ?? 0,
      holdoutPass: metric.holdoutPass === true,
      adjustedConfidence: numberOrNull(metric.adjustedConfidence) ?? 0,
      falseDiscoveryRisk: numberOrNull(metric.falseDiscoveryRisk) ?? 1,
    };
  });
  const evidenceAllocationByCandidate = rosterRows.map((row) => {
    const exactLinked = row.linkageStatus === "exact_candidate_linked";
    const metric = metricByAlgoId.get(row.sourceResearchAlgoId);
    const gate = metricGate(metric, row.researchSupported);
    const normalBudgetEligible = exactLinked && gate.ok;
    const budgetBucket = normalBudgetEligible
      ? "exploitation"
      : exactLinked ? "linked_watch"
        : row.researchSupported ? "controlled_exploration"
          : "unsupported_zero";
    return {
      snapshotId,
      algoId: row.algoId,
      displayId: row.displayId,
      family: row.family,
      researchCandidateId: row.researchCandidateId,
      candidateConfigHash: row.candidateConfigHash,
      linkageStatus: row.linkageStatus,
      budgetBucket,
      normalBudgetEligible,
      reason: allocationReason({ row, exactLinked, gate }),
      dryRunTotalPnl: row.dryRunTotalPnl,
    };
  });
  const unlinkedLiveRows = evidenceAllocationByCandidate
    .filter((row) => row.linkageStatus !== "exact_candidate_linked")
    .map((row) => {
      const stat = liveBySource.get(row.algoId) ?? {};
      return {
        snapshotId,
        algoId: row.algoId,
        displayId: row.displayId,
        family: row.family,
        researchSupported: row.budgetBucket === "controlled_exploration",
        linkageStatus: row.linkageStatus,
        reason: row.reason,
        dryRunTotalPnl: row.dryRunTotalPnl,
        attempts: numberOrZero(stat.attempts),
        acceptedBuys: numberOrZero(stat.acceptedBuys),
        closedExits: numberOrZero(stat.sells),
      };
    });
  const evidenceAllocationByFamily = evidenceAllocationFamilies({ snapshotId, evidenceAllocationByCandidate });
  const missingProvenanceRows = missingProvenance({ snapshotId, rosterRows, decisionRows, tradeRows });
  const supportedLiveLinkage = evidenceAllocationByCandidate
    .filter((row) => familyRegistryEntry(row.family).researchSupported === true)
    .map((row) => {
      const roster = rosterRows.find((item) => item.algoId === row.algoId) ?? {};
      return {
        snapshotId,
        algoId: row.algoId,
        displayId: row.displayId,
        family: row.family,
        researchCandidateId: row.researchCandidateId,
        candidateConfigHash: row.candidateConfigHash,
        sourceResearchAlgoId: roster.sourceResearchAlgoId ?? "",
        sourceRunId: roster.sourceRunId ?? "",
        sourceSnapshotHash: roster.sourceSnapshotHash ?? "",
        promotionVerdictAtInstall: roster.promotionVerdictAtInstall ?? "",
        researchVerdict: roster.researchVerdict ?? "missing",
        linkageStatus: row.linkageStatus,
        budgetBucket: row.budgetBucket,
        dryRunTotalPnl: row.dryRunTotalPnl,
        dryRunClosedExits: roster.dryRunClosedExits ?? 0,
        dryRunAcceptedBuys: roster.dryRunAcceptedBuys ?? 0,
      };
    });
  const supportedLiveExactLinks = supportedLiveLinkage.filter((row) => row.linkageStatus === "exact_candidate_linked");
  const exactLinkedLiveRows = evidenceAllocationByCandidate.filter((row) => row.linkageStatus === "exact_candidate_linked").length;
  const exactLinkedNormalBudgetRows = evidenceAllocationByCandidate.filter((row) => row.normalBudgetEligible).length;
  const familyOnlyLiveRows = evidenceAllocationByCandidate.filter((row) => row.linkageStatus === "family_only_unlinked").length;
  const missingExactLinkRows = evidenceAllocationByCandidate.filter((row) => row.linkageStatus === "missing_exact_link").length;
  const unsupportedLiveRows = evidenceAllocationByCandidate.filter((row) => row.linkageStatus === "unsupported_unlinked").length;
  const exactLinkRate = evidenceAllocationByCandidate.length ? roundDisplayRatio(exactLinkedLiveRows / evidenceAllocationByCandidate.length) : 0;
  const researchLiveIdentityAlignment = {
    schemaVersion: "dogeedge.research-live-identity-alignment.v1",
    snapshotId,
    researchCandidateCount: candidateLineageAudit.length,
    liveRowCount: evidenceAllocationByCandidate.length,
    exactLinkedLiveRows,
    exactLinkCoverage: exactLinkRate,
    exactLinkRate,
    exactLinkedNormalBudgetRows,
    familyOnlyLiveRows,
    missingExactLinkRows,
    unsupportedLiveRows,
    unlinkedLiveRows: familyOnlyLiveRows + missingExactLinkRows + unsupportedLiveRows,
    status: exactLinkedLiveRows > 0 ? "exact_linkage_present" : "exact_linkage_absent",
    failClosed: exactLinkedNormalBudgetRows === 0,
  };
  const exactLinkSummary = {
    schemaVersion: "dogeedge.exact-link-summary.v1",
    snapshotId,
    exactLinkedRows: exactLinkedLiveRows,
    familyOnlyRows: familyOnlyLiveRows,
    missingLinkRows: missingExactLinkRows,
    unsupportedRows: unsupportedLiveRows,
    exactLinkRate,
    supportedLiveExactLinkedCount: supportedLiveLinkage.filter((row) => row.linkageStatus === "exact_candidate_linked").length,
    supportedLiveMissingLinkCount: supportedLiveLinkage.filter((row) => row.linkageStatus !== "exact_candidate_linked").length,
    failClosed: exactLinkedNormalBudgetRows === 0,
  };
  const provenanceCompletenessReport = {
    schemaVersion: "dogeedge.provenance-completeness.v1",
    snapshotId,
    checkedRows: rosterRows.length + decisionRows.length + tradeRows.length,
    missingRows: missingProvenanceRows.length,
    missingFamilyRows: missingProvenanceRows.filter((row) => JSON.parse(row.missingFieldsJson).includes("family")).length,
    missingResearchCandidateIdRows: missingProvenanceRows.filter((row) => JSON.parse(row.missingFieldsJson).includes("researchCandidateId")).length,
    promotableEvidenceAllowedForMissingRows: false,
  };
  const schedulerBudgetReport = {
    schemaVersion: "dogeedge.scheduler-budget.v1",
    snapshotId,
    state: exactLinkedNormalBudgetRows > 0 ? "evidence_allocation_ready" : "evidence_starved",
    exploitationRows: exactLinkedNormalBudgetRows,
    controlledExplorationRows: familyOnlyLiveRows + missingExactLinkRows,
    unsupportedRows: unsupportedLiveRows,
    unsupportedNormalBudgetRows: 0,
    allocationTarget: {
      exploitation: exactLinkedNormalBudgetRows > 0 ? "80-95%" : "0%",
      controlledExploration: familyOnlyLiveRows + missingExactLinkRows > 0 ? "5-20%" : "0%",
      unsupported: "0%",
    },
    reasonCodes: schedulerReasonCodes({ exactLinkedLiveRows, exactLinkedNormalBudgetRows, familyOnlyLiveRows, missingExactLinkRows, unsupportedLiveRows }),
  };
  return {
    candidateLineageAudit,
    unlinkedLiveRows,
    evidenceAllocationByFamily,
    evidenceAllocationByCandidate,
    supportedLiveLinkage,
    supportedLiveExactLinks,
    missingProvenanceRows,
    researchLiveIdentityAlignment,
    exactLinkSummary,
    schedulerBudgetReport,
    provenanceCompletenessReport,
  };
}

function evidenceAllocationFamilies({ snapshotId, evidenceAllocationByCandidate }) {
  const byFamily = new Map();
  for (const row of evidenceAllocationByCandidate) {
    const current = byFamily.get(row.family) ?? {
      snapshotId,
      family: row.family,
      researchSupported: familyRegistryEntry(row.family).researchSupported === true,
      liveRows: 0,
      exactLinkedRows: 0,
      familyOnlyRows: 0,
      missingLinkRows: 0,
      unsupportedRows: 0,
      normalBudgetRows: 0,
      explorationBudgetRows: 0,
      unsupportedBudgetRows: 0,
      recommendedAction: "",
    };
    current.liveRows += 1;
    if (row.linkageStatus === "exact_candidate_linked") current.exactLinkedRows += 1;
    if (row.linkageStatus === "family_only_unlinked") current.familyOnlyRows += 1;
    if (row.linkageStatus === "missing_exact_link") current.missingLinkRows += 1;
    if (row.linkageStatus === "unsupported_unlinked") current.unsupportedRows += 1;
    if (row.normalBudgetEligible) current.normalBudgetRows += 1;
    if (row.budgetBucket === "controlled_exploration") current.explorationBudgetRows += 1;
    if (row.budgetBucket === "unsupported_zero") current.unsupportedBudgetRows += 0;
    byFamily.set(row.family, current);
  }
  return [...byFamily.values()].map((row) => ({
    ...row,
    recommendedAction: row.normalBudgetRows > 0
      ? "allocate_exploitation_budget"
      : row.researchSupported ? "link_exact_candidate_before_primary_budget" : "freeze_unsupported_budget",
  })).sort((left, right) => right.liveRows - left.liveRows || left.family.localeCompare(right.family));
}

function missingProvenance({ snapshotId, rosterRows, decisionRows, tradeRows }) {
  const rows = [];
  for (const row of rosterRows) {
    const missing = missingFields(row, ["family", "algoId"]);
    if (!row.researchCandidateId) missing.push("researchCandidateId");
    if (missing.length) rows.push(missingProvenanceRow(snapshotId, "roster_alignment", row.algoId, row.algoId, row.family, missing));
  }
  for (const row of decisionRows) {
    const missing = missingFields(row, ["family", "algoId"]);
    if (!row.researchCandidateId) missing.push("researchCandidateId");
    if (missing.length) rows.push(missingProvenanceRow(snapshotId, "decision_rows", row.rowId, row.algoId, row.family, missing));
  }
  for (const row of tradeRows) {
    const missing = missingFields(row, ["family", "algoId", "sourceRunId"]);
    if (!row.researchCandidateId) missing.push("researchCandidateId");
    if (missing.length) rows.push(missingProvenanceRow(snapshotId, "trade_rows", row.tradeId, row.algoId, row.family, missing));
  }
  return rows;
}

function missingProvenanceRow(snapshotId, source, rowId, algoId, family, missing) {
  return {
    snapshotId,
    source,
    rowId: rowId ?? "",
    algoId: algoId ?? "",
    family: family ?? "",
    missingFieldsJson: jsonCell(uniqueStrings(missing)),
    promotableEvidenceAllowed: false,
  };
}

function missingFields(row, fields) {
  return fields.filter((field) => row?.[field] === null || row?.[field] === undefined || row?.[field] === "");
}

function allocationReason({ row, exactLinked, gate }) {
  if (!row.researchSupported) return "unsupported_family_zero_budget";
  if (!exactLinked) return "exact_candidate_link_required";
  if (!gate.ok) return gate.reasonCodes.join(",") || "research_gate_failed";
  return "research_gate_passed";
}

function schedulerReasonCodes({ exactLinkedLiveRows, exactLinkedNormalBudgetRows, familyOnlyLiveRows, missingExactLinkRows, unsupportedLiveRows }) {
  const codes = [];
  if (exactLinkedLiveRows === 0) codes.push("exact_candidate_linkage_absent");
  if (exactLinkedNormalBudgetRows === 0) codes.push("no_gate_passing_exact_candidates");
  if (familyOnlyLiveRows > 0) codes.push("family_only_live_rows_need_lineage");
  if (missingExactLinkRows > 0) codes.push("missing_exact_link_rows_zero_normal_budget");
  if (unsupportedLiveRows > 0) codes.push("unsupported_live_rows_zero_budget");
  return codes;
}

function enrichRowsWithCandidateIdentity(rows, identityByAlgoId) {
  return rows.map((row) => {
    const identity = identityForAlgo(identityByAlgoId, row.algoId);
    return {
      ...row,
      researchCandidateId: identity?.researchCandidateId ?? row.researchCandidateId ?? "",
      candidateConfigHash: identity?.candidateConfigHash ?? row.candidateConfigHash ?? "",
    };
  });
}

function leakageAuditSummary({ snapshotId, dataQuality, metrics }) {
  const postCloseRowsExcluded = numberOrZero(dataQuality.postCloseFramesExcluded);
  const futureOutcomeFieldViolations = metrics.reduce((total, metric) => (
    total + (metric.warnings ?? []).filter((warning) => String(warning).toLowerCase().includes("future/outcome")).length
  ), 0);
  return {
    snapshotId,
    postCloseRowsDetected: postCloseRowsExcluded,
    postCloseRowsExcluded,
    featureAtOrAfterCloseCount: postCloseRowsExcluded,
    labelBeforeFeatureCount: 0,
    settlementBeforeFeatureCount: 0,
    futureOutcomeFieldViolations,
    duplicateFramesRemoved: numberOrZero(dataQuality.duplicateFramesRemoved),
    overlappingFramesDownsampled: numberOrZero(dataQuality.overlappingFramesDownsampled),
    rawFrames: numberOrZero(dataQuality.rawFrames),
    usableFrames: numberOrZero(dataQuality.usableFrames),
    excludedFrames: numberOrZero(dataQuality.excludedFrames),
  };
}

function postCloseFrameAuditRow(snapshotId, leakageAudit) {
  return {
    snapshotId,
    rawFrames: leakageAudit.rawFrames,
    usableFrames: leakageAudit.usableFrames,
    excludedFrames: leakageAudit.excludedFrames,
    postCloseRowsDetected: leakageAudit.postCloseRowsDetected,
    postCloseRowsExcluded: leakageAudit.postCloseRowsExcluded,
    featureAtOrAfterCloseCount: leakageAudit.featureAtOrAfterCloseCount,
    labelBeforeFeatureCount: leakageAudit.labelBeforeFeatureCount,
    settlementBeforeFeatureCount: leakageAudit.settlementBeforeFeatureCount,
    futureOutcomeFieldViolations: leakageAudit.futureOutcomeFieldViolations,
    duplicateFramesRemoved: leakageAudit.duplicateFramesRemoved,
    overlappingFramesDownsampled: leakageAudit.overlappingFramesDownsampled,
  };
}

function familyAllocationReport({ snapshotId, alignment, metrics, topStats }) {
  const byFamily = {};
  for (const metric of metrics) {
    const family = metric.family ?? "unknown";
    byFamily[family] = byFamily[family] ?? familyAllocationRow(family);
    byFamily[family].researchCount += 1;
    if (metric.promotionVerdict === "reject") byFamily[family].rejectedResearchCount += 1;
    if (numberOrZero(metric.conservativeTotalPnl) > 0) byFamily[family].positiveConservativeCount += 1;
  }
  for (const stat of Object.values(topStats)) {
    const family = stat.family ?? "unknown";
    byFamily[family] = byFamily[family] ?? familyAllocationRow(family);
    byFamily[family].liveCount += 1;
    byFamily[family].liveTotalPnl = roundDisplayMoney(byFamily[family].liveTotalPnl + numberOrZero(stat.totalPnl));
  }
  const families = Object.values(byFamily).map((row) => ({
    ...row,
    recommendedAction: row.researchSupported
      ? row.positiveConservativeCount > 0 ? "allocate_cautiously" : "hold_until_conservative_edge"
      : row.liveTotalPnl > 0 ? "build_research_adapter_before_more_minting" : "freeze_new_minting",
  })).sort((left, right) => right.liveCount - left.liveCount || left.family.localeCompare(right.family));
  return {
    snapshotId,
    familyRegistryVersion: alignment.familyRegistryVersion,
    summary: {
      liveAlgoCount: alignment.liveAlgoCount,
      researchAlgoCount: alignment.researchAlgoCount,
      unsupportedLiveAlgoCount: alignment.unsupportedLiveAlgoCount,
      supportedLiveAlgoCount: alignment.supportedLiveAlgoCount,
    },
    families,
  };
}

function familyAllocationRow(family) {
  const entry = familyRegistryEntry(family);
  return {
    family,
    researchSupported: entry.researchSupported === true,
    supportReason: entry.reason ?? "research_adapter_available",
    researchCount: 0,
    rejectedResearchCount: 0,
    positiveConservativeCount: 0,
    liveCount: 0,
    liveTotalPnl: 0,
  };
}

function topRosterDefaultSortAudit({ snapshotId, alignmentArtifacts }) {
  const rows = alignmentArtifacts.rosterAlignment;
  const researchRankedRows = rows.filter((row) => row.defaultBucket === "research_validated" && row.watchOnly !== true);
  const telemetryWatchRows = rows.filter((row) => row.watchOnly === true || row.defaultBucket !== "research_validated");
  const supportedNonNegative = rows.filter((row) => row.researchSupported && row.dryRunTotalPnl >= 0 && row.researchVerdict !== "missing");
  const first = researchRankedRows[0] ?? null;
  const unsafeFirst = Boolean(first && (!first.researchSupported || first.dryRunTotalPnl < 0) && supportedNonNegative.length > 0);
  return {
    snapshotId,
    checkedRows: rows.length,
    researchRankedRosterCount: researchRankedRows.length,
    telemetryWatchlistCount: telemetryWatchRows.length,
    supportedNonNegativeCount: supportedNonNegative.length,
    defaultRankOneAlgoId: first?.algoId ?? null,
    defaultRankOneFamily: first?.family ?? null,
    defaultRankOneSupported: first?.researchSupported ?? null,
    defaultRankOneDryRunTotalPnl: first?.dryRunTotalPnl ?? null,
    unsafeRankOne: unsafeFirst,
    verdict: unsafeFirst ? "fail_closed" : "ok_or_no_supported_nonnegative_rows",
  };
}

function officialSettlementArtifacts({ snapshotId, generatedAt, metrics, decisionRows, tradeRows, dataQuality }) {
  const officialByMarket = new Map();
  const ingest = (row, source) => {
    const marketTicker = stringOrNull(row.marketTicker);
    if (!marketTicker) return;
    if (row.labelSource !== "official_resolution" || row.settlementSource !== "official_resolution") return;
    const current = officialByMarket.get(marketTicker) ?? {
      snapshotId,
      marketTicker,
      closeTime: row.marketCloseTimestamp ?? "",
      resolutionTime: row.labelTimestamp ?? row.settlementTimestamp ?? "",
      settlementTime: row.settlementTimestamp ?? row.labelTimestamp ?? "",
      settledOutcome: settledOutcomeFromRow(row),
      labelSource: row.labelSource,
      settlementSource: row.settlementSource,
      officialResolutionAvailable: row.officialResolutionAvailable === true,
      source,
      sourceRowCount: 0,
    };
    current.closeTime = current.closeTime || row.marketCloseTimestamp || "";
    current.resolutionTime = current.resolutionTime || row.labelTimestamp || row.settlementTimestamp || "";
    current.settlementTime = current.settlementTime || row.settlementTimestamp || row.labelTimestamp || "";
    current.settledOutcome = current.settledOutcome || settledOutcomeFromRow(row);
    current.officialResolutionAvailable = current.officialResolutionAvailable || row.officialResolutionAvailable === true;
    current.source = uniqueStrings([current.source, source]).join(",");
    current.sourceRowCount += 1;
    officialByMarket.set(marketTicker, current);
  };
  for (const row of decisionRows) ingest(row, "decision_frame");
  for (const row of tradeRows) ingest(row, "paper_trade");

  const settlements = [...officialByMarket.values()].sort((left, right) => left.marketTicker.localeCompare(right.marketTicker));
  const metricRows = Array.isArray(metrics) ? metrics : [];
  const metricCoverageValues = metricRows
    .map((row) => numberOrNull(row.officialSettlementCoverage ?? row.settlementEvidence?.officialSettlementCoverage))
    .filter((value) => value !== null);
  const dataQualityEvidence = dataQuality?.settlementEvidence ?? {};
  const averageMetricCoverage = metricCoverageValues.length
    ? metricCoverageValues.reduce((total, value) => total + value, 0) / metricCoverageValues.length
    : 0;
  const officialCoverage = numberOrNull(dataQualityEvidence.officialSettlementCoverage) ?? averageMetricCoverage;
  const officialMetricRows = metricRows.filter((row) => (
    (row.labelSource ?? row.settlementEvidence?.labelSource) === "official_resolution"
    && (row.settlementSource ?? row.settlementEvidence?.settlementSource) === "official_resolution"
  )).length;
  const targetMarketCount = uniqueStrings([
    ...decisionRows.map((row) => row.marketTicker),
    ...tradeRows.map((row) => row.marketTicker),
  ]).length;
  const reasonCodes = [
    ...(officialCoverage < officialScoringCoverageThreshold ? ["official_coverage_below_scoring_threshold"] : []),
    ...(officialCoverage < officialPromotionCoverageThreshold ? ["official_coverage_below_promotion_threshold"] : []),
    ...(settlements.length === 0 ? ["official_settlement_rows_absent"] : []),
  ];
  const summary = {
    metricRows: metricRows.length,
    officialMetricRows,
    targetMarketCount,
    officialSettlementRows: settlements.length,
    officialSettlementCoverage: roundDisplayRatio(officialCoverage) ?? 0,
    minMetricCoverage: metricCoverageValues.length ? Math.min(...metricCoverageValues) : 0,
    maxMetricCoverage: metricCoverageValues.length ? Math.max(...metricCoverageValues) : 0,
    averageMetricCoverage: roundDisplayRatio(averageMetricCoverage) ?? 0,
    scoringThreshold: officialScoringCoverageThreshold,
    promotionThreshold: officialPromotionCoverageThreshold,
    promotionGradeScoringAllowed: officialCoverage >= officialScoringCoverageThreshold,
    beyondPaperAllowed: officialCoverage >= officialPromotionCoverageThreshold,
    failClosed: officialCoverage < officialScoringCoverageThreshold || officialCoverage < officialPromotionCoverageThreshold,
    labelSource: dataQualityEvidence.labelSource ?? snapshotSettlementSource(metricRows),
    settlementSource: dataQualityEvidence.settlementSource ?? snapshotSettlementSource(metricRows),
  };
  const coverageByCandidate = metricRows.map((metric) => {
    const coverage = numberOrZero(metric.officialSettlementCoverage ?? metric.settlementEvidence?.officialSettlementCoverage);
    const labelSource = metric.labelSource ?? metric.settlementEvidence?.labelSource ?? "unknown";
    const settlementSource = metric.settlementSource ?? metric.settlementEvidence?.settlementSource ?? "unknown";
    const candidateReasons = [
      ...(labelSource !== "official_resolution" ? ["official_label_required"] : []),
      ...(settlementSource !== "official_resolution" ? ["official_settlement_required"] : []),
      ...(coverage < officialScoringCoverageThreshold ? ["official_coverage_below_scoring_threshold"] : []),
      ...(coverage < officialPromotionCoverageThreshold ? ["official_coverage_below_promotion_threshold"] : []),
    ];
    return {
      snapshotId,
      algoId: metric.algoId ?? "",
      displayId: metric.displayId ?? displayIdFromAlgo(metric.algoId),
      family: metric.family ?? "unknown",
      researchCandidateId: metric.researchCandidateId ?? "",
      candidateConfigHash: metric.candidateConfigHash ?? "",
      labelSource,
      settlementSource,
      officialResolutionAvailable: metric.officialResolutionAvailable === true || metric.settlementEvidence?.officialResolutionAvailable === true,
      officialSettlementCoverage: roundDisplayRatio(coverage) ?? 0,
      promotionGradeScoringAllowed: coverage >= officialScoringCoverageThreshold,
      beyondPaperAllowed: coverage >= officialPromotionCoverageThreshold,
      reasonCodes: candidateReasons.join(","),
    };
  });
  const coverageByFamily = officialSettlementCoverageByFamily({ snapshotId, coverageByCandidate });
  return {
    settlements,
    coverageByFamily,
    coverageByCandidate,
    coverageReport: {
      schemaVersion: "dogeedge.settlement-coverage-report.v1",
      snapshotId,
      generatedAt,
      summary,
      reasonCodes,
      thresholds: {
        officialScoringCoverageThreshold,
        officialPromotionCoverageThreshold,
      },
    },
  };
}

function officialSettlementJsonLine(row) {
  return {
    snapshot_id: row.snapshotId,
    market_ticker: row.marketTicker,
    close_time: row.closeTime,
    resolution_time: row.resolutionTime,
    settlement_time: row.settlementTime,
    settled_outcome: row.settledOutcome,
    label_source: row.labelSource,
    settlement_source: row.settlementSource,
    official_resolution_available: row.officialResolutionAvailable,
    source: row.source,
    source_row_count: row.sourceRowCount,
  };
}

function officialSettlementCoverageByFamily({ snapshotId, coverageByCandidate }) {
  const byFamily = new Map();
  for (const row of coverageByCandidate) {
    const family = row.family || "unknown";
    const current = byFamily.get(family) ?? {
      snapshotId,
      family,
      candidateCount: 0,
      officialCandidateCount: 0,
      coverages: [],
      promotionGradeCandidateCount: 0,
      reasons: new Set(),
    };
    current.candidateCount += 1;
    const coverage = numberOrZero(row.officialSettlementCoverage);
    current.coverages.push(coverage);
    if (row.labelSource === "official_resolution" && row.settlementSource === "official_resolution") current.officialCandidateCount += 1;
    if (row.beyondPaperAllowed === true) current.promotionGradeCandidateCount += 1;
    for (const reason of String(row.reasonCodes || "").split(",").filter(Boolean)) current.reasons.add(reason);
    byFamily.set(family, current);
  }
  return [...byFamily.values()].map((row) => {
    const average = row.coverages.length
      ? row.coverages.reduce((total, value) => total + value, 0) / row.coverages.length
      : 0;
    return {
      snapshotId: row.snapshotId,
      family: row.family,
      candidateCount: row.candidateCount,
      officialCandidateCount: row.officialCandidateCount,
      averageOfficialSettlementCoverage: roundDisplayRatio(average) ?? 0,
      minOfficialSettlementCoverage: row.coverages.length ? Math.min(...row.coverages) : 0,
      maxOfficialSettlementCoverage: row.coverages.length ? Math.max(...row.coverages) : 0,
      promotionGradeCandidateCount: row.promotionGradeCandidateCount,
      failClosed: row.promotionGradeCandidateCount === 0 || average < officialPromotionCoverageThreshold,
      reasonCodes: [...row.reasons].join(","),
    };
  }).sort((left, right) => right.candidateCount - left.candidateCount || left.family.localeCompare(right.family));
}

function settledOutcomeFromRow(row) {
  const explicit = stringOrNull(row.settledOutcome ?? row.outcome ?? row.resolution);
  if (explicit) return explicit;
  if (row.accepted === true && (row.decisionAction === "buy_yes" || row.side === "YES")) return "YES";
  if (row.accepted === true && (row.decisionAction === "buy_no" || row.side === "NO")) return "NO";
  return "";
}

function simulatorCalibrationArtifacts({ snapshotId, generatedAt, decisionRows, tradeRows, topStats }) {
  const groups = new Map();
  const ensure = (keyParts) => {
    const key = keyParts.join("|");
    const existing = groups.get(key);
    if (existing) return existing;
    const created = {
      snapshotId,
      family: keyParts[0],
      regimeTimeToClose: keyParts[1],
      regimeSpread: keyParts[2],
      regimeLiquidity: keyParts[3],
      regimeVolatility: keyParts[4],
      predictedFillValues: [],
      realizedFillValues: [],
      predictedPartialValues: [],
      realizedPartialValues: [],
      predictedSlippageValues: [],
      realizedSlippageValues: [],
      attempts: 0,
      accepted: 0,
      rejected: 0,
      rejectMix: {},
    };
    groups.set(key, created);
    return created;
  };
  const groupFor = (row) => ensure([
    row.family || "unknown",
    row.regimeTimeToClose ?? row.entryRegimeTimeToClose ?? "unknown",
    row.regimeSpread ?? row.entryRegimeSpread ?? "unknown",
    row.regimeLiquidity ?? row.entryRegimeLiquidity ?? "unknown",
    row.regimeVolatility ?? row.entryRegimeVolatility ?? "unknown",
  ].map((value) => String(value || "unknown")));

  for (const row of decisionRows) {
    if (row.attempted !== true && row.accepted !== true && !row.rejectCode) continue;
    const group = groupFor(row);
    group.attempts += 1;
    if (row.accepted === true) group.accepted += 1;
    if (row.accepted !== true || row.rejectCode) {
      group.rejected += 1;
      incrementRejectMix(group.rejectMix, row.rejectCode || "decision_not_accepted");
    }
    group.realizedFillValues.push(row.accepted === true ? 1 : 0);
  }
  for (const row of tradeRows) {
    const group = groupFor(row);
    const accepted = !row.rejectCode && row.status !== "rejected";
    group.attempts += 1;
    if (accepted) group.accepted += 1;
    if (!accepted) {
      group.rejected += 1;
      incrementRejectMix(group.rejectMix, row.rejectCode || "paper_trade_rejected");
    }
    const fillProbability = numberOrNull(row.fillProbability);
    if (fillProbability !== null) group.predictedFillValues.push(fillProbability);
    group.realizedFillValues.push(accepted ? 1 : 0);
    const partialFillRatio = numberOrNull(row.partialFillRatio);
    if (partialFillRatio !== null) {
      group.predictedPartialValues.push(partialFillRatio);
      if (accepted) group.realizedPartialValues.push(partialFillRatio);
    }
    const slippageCents = numberOrNull(row.slippageCents);
    if (slippageCents !== null) {
      group.predictedSlippageValues.push(slippageCents);
      if (accepted) group.realizedSlippageValues.push(slippageCents);
    }
  }
  for (const stat of Object.values(topStats)) {
    const attempts = numberOrZero(stat.attempts);
    if (attempts <= 0) continue;
    const group = ensure([stat.family || "unknown", "unknown", "unknown", "unknown", "unknown"]);
    group.attempts += attempts;
    group.accepted += numberOrZero(stat.acceptedBuys);
    group.rejected += numberOrZero(stat.rejected);
    for (const reason of topStatRejectReasons(stat)) incrementRejectMix(group.rejectMix, reason.code, reason.count);
    group.realizedFillValues.push(attempts > 0 ? numberOrZero(stat.acceptedBuys) / attempts : 0);
  }

  const rows = [...groups.values()].map((group) => {
    const predictedFillRate = averageOrNull(group.predictedFillValues);
    const realizedFillRate = group.attempts > 0 ? group.accepted / group.attempts : averageOrNull(group.realizedFillValues);
    const predictedSlippage = averageOrNull(group.predictedSlippageValues);
    const realizedSlippage = averageOrNull(group.realizedSlippageValues);
    return {
      snapshotId,
      family: group.family,
      regimeTimeToClose: group.regimeTimeToClose,
      regimeSpread: group.regimeSpread,
      regimeLiquidity: group.regimeLiquidity,
      regimeVolatility: group.regimeVolatility,
      predictedFillRate: roundDisplayRatio(predictedFillRate),
      realizedFillRate: roundDisplayRatio(realizedFillRate),
      predictedPartialFillRatio: roundDisplayRatio(averageOrNull(group.predictedPartialValues)),
      realizedPartialFillRatio: roundDisplayRatio(averageOrNull(group.realizedPartialValues)),
      predictedSlippage: roundDisplayRatio(predictedSlippage),
      realizedSlippage: roundDisplayRatio(realizedSlippage),
      predictedRejectRate: roundDisplayRatio(predictedFillRate === null ? null : 1 - predictedFillRate),
      realizedRejectRate: roundDisplayRatio(group.attempts > 0 ? group.rejected / group.attempts : null),
      attempts: group.attempts,
      accepted: group.accepted,
      rejected: group.rejected,
      rejectMixJson: jsonCell(group.rejectMix),
      calibrationAction: calibrationAction({ predictedFillRate, realizedFillRate, predictedSlippage, realizedSlippage, attempts: group.attempts }),
    };
  }).sort((left, right) => right.attempts - left.attempts
    || left.family.localeCompare(right.family)
    || left.regimeTimeToClose.localeCompare(right.regimeTimeToClose)
    || left.regimeSpread.localeCompare(right.regimeSpread));
  const report = {
    schemaVersion: "dogeedge.simulator-calibration-report.v1",
    snapshotId,
    generatedAt,
    regimeCount: rows.length,
    attempts: rows.reduce((total, row) => total + row.attempts, 0),
    accepted: rows.reduce((total, row) => total + row.accepted, 0),
    rejected: rows.reduce((total, row) => total + row.rejected, 0),
    tighteningOnly: true,
    calibrationPolicy: "paper_evidence_can_reduce_fill_probability_or_increase_costs_only",
    actionCounts: countBy(rows.map((row) => row.calibrationAction)),
  };
  return {
    rows,
    report,
    markdown: simulatorCalibrationMarkdown(report, rows),
  };
}

function simulatorCalibrationMarkdown(report, rows) {
  const lines = [
    "# Simulator Calibration Report",
    "",
    `Snapshot: ${report.snapshotId}`,
    `Regime rows: ${report.regimeCount}`,
    `Attempts: ${report.attempts}`,
    `Accepted: ${report.accepted}`,
    `Rejected: ${report.rejected}`,
    "",
    "Policy: paper evidence can only tighten fill probability or increase costs; it cannot loosen promotion safeguards.",
    "",
    "| family | regimeTimeToClose | regimeSpread | attempts | predictedFillRate | realizedFillRate | action |",
    "|---|---|---:|---:|---:|---:|---|",
    ...rows.slice(0, 50).map((row) => `| ${row.family} | ${row.regimeTimeToClose} | ${row.regimeSpread} | ${row.attempts} | ${row.predictedFillRate ?? ""} | ${row.realizedFillRate ?? ""} | ${row.calibrationAction} |`),
  ];
  return `${lines.join("\n")}\n`;
}

function rejectStreamSummaryReport({ snapshotId, generatedAt, decisionRows, tradeRows, topStats }) {
  const byCode = {};
  let opportunities = 0;
  let attempted = 0;
  let accepted = 0;
  let rejected = 0;
  let skipped = 0;
  for (const row of decisionRows) {
    opportunities += 1;
    if (row.attempted === true || row.accepted === true || row.rejectCode) attempted += 1;
    else skipped += 1;
    if (row.accepted === true) accepted += 1;
    if (row.rejectCode || row.rejected === true || row.accepted === false && row.attempted === true) {
      rejected += 1;
      incrementRejectMix(byCode, row.rejectCode || "decision_not_accepted");
    }
  }
  for (const row of tradeRows) {
    attempted += 1;
    if (row.rejectCode || row.status === "rejected") {
      rejected += 1;
      incrementRejectMix(byCode, row.rejectCode || "paper_trade_rejected");
    } else {
      accepted += 1;
    }
  }
  for (const stat of Object.values(topStats)) {
    const statAttempts = numberOrZero(stat.attempts);
    attempted += statAttempts;
    accepted += numberOrZero(stat.acceptedBuys);
    rejected += numberOrZero(stat.rejected);
    skipped += Math.max(0, numberOrZero(stat.signals) - statAttempts);
    for (const reason of topStatRejectReasons(stat)) incrementRejectMix(byCode, reason.code, reason.count);
  }
  return {
    schemaVersion: "dogeedge.reject-stream-summary.v1",
    snapshotId,
    generatedAt,
    opportunities,
    attempted,
    accepted,
    rejected,
    skipped,
    rejectRate: roundDisplayRatio(attempted > 0 ? rejected / attempted : null),
    acceptRate: roundDisplayRatio(attempted > 0 ? accepted / attempted : null),
    fullRejectStreamPresent: attempted > 0 && rejected > 0,
    failClosed: attempted === 0 || rejected === 0,
    reasonCodes: [
      ...(attempted === 0 ? ["paper_attempt_stream_absent"] : []),
      ...(rejected === 0 ? ["reject_stream_absent_or_incomplete"] : []),
    ],
    rejectMix: byCode,
  };
}

function replayParityReportFromRawManifest({ snapshotId, generatedAt, rawTickManifest }) {
  const manifest = isRecord(rawTickManifest) ? rawTickManifest : {};
  const targetMarketCount = numberOrZero(manifest.targetMarketCount);
  const coveredTargetMarketCount = numberOrZero(manifest.coveredTargetMarketCount);
  const uncoveredTargetMarketCount = numberOrZero(manifest.uncoveredTargetMarketCount ?? Math.max(0, targetMarketCount - coveredTargetMarketCount));
  const parquetAvailable = manifest.parquetAvailable === true;
  const jsonlAvailable = manifest.jsonlAvailable === true;
  const replayGrade = parquetAvailable && targetMarketCount > 0 && uncoveredTargetMarketCount === 0;
  const sampleParity = (jsonlAvailable || parquetAvailable) && targetMarketCount > 0 && uncoveredTargetMarketCount === 0;
  return {
    schemaVersion: "dogeedge.replay-parity-report.v1",
    snapshotId,
    generatedAt,
    targetMarketCount,
    coveredTargetMarketCount,
    uncoveredTargetMarketCount,
    parquetAvailable,
    jsonlAvailable,
    replayGrade,
    sampleParity,
    executionSensitivePromotionAllowed: replayGrade,
    sourceSnapshotFileCount: numberOrZero(manifest.sourceSnapshotFileCount),
    hashedSourceSnapshotFileCount: numberOrZero(manifest.hashedSourceSnapshotFileCount),
    sequenceGapCheckAvailable: manifest.sequenceGapCheckAvailable === true,
    failClosed: !replayGrade,
    reasonCodes: [
      ...(!parquetAvailable ? ["raw_market_tick_parquet_absent"] : []),
      ...(targetMarketCount === 0 ? ["target_market_set_absent"] : []),
      ...(uncoveredTargetMarketCount > 0 ? ["raw_market_tick_target_coverage_gap"] : []),
      ...(manifest.sequenceGapCheckAvailable !== true ? ["sequence_gap_check_absent"] : []),
    ],
  };
}

function executableReadinessGateReport({
  snapshotId,
  generatedAt,
  exactLinkSummary,
  settlementCoverageReport,
  rawTickManifest,
  simulatorCalibrationReport,
  topRosterDefaultSortAudit,
}) {
  const replayParity = replayParityReportFromRawManifest({ snapshotId, generatedAt, rawTickManifest });
  const exactLinked = numberOrZero(exactLinkSummary?.supportedLiveExactLinkedCount ?? exactLinkSummary?.exactLinkedRows);
  const officialCoverage = numberOrZero(settlementCoverageReport?.summary?.officialSettlementCoverage);
  const calibrationAttempts = numberOrZero(simulatorCalibrationReport?.attempts);
  const rosterCount = numberOrZero(topRosterDefaultSortAudit?.researchRankedRosterCount);
  const reasonCodes = [
    ...(exactLinked <= 0 ? ["exact_linked_supported_live_rows_zero"] : []),
    ...(officialCoverage < officialPromotionCoverageThreshold ? ["official_settlement_coverage_below_threshold"] : []),
    ...(!replayParity.replayGrade ? ["replay_grade_target_market_ticks_absent"] : []),
    ...(calibrationAttempts <= 0 ? ["simulator_calibration_evidence_absent"] : []),
    ...(rosterCount <= 0 ? ["research_validated_roster_empty"] : []),
  ];
  return {
    schemaVersion: "dogeedge.executable-readiness-gate.v1",
    snapshotId,
    generatedAt,
    allowedToLoadArenaBatch: reasonCodes.length === 0,
    state: reasonCodes.length === 0 ? "executable_ready" : "hold_gather_evidence",
    exactLinkedSupportedLiveRows: exactLinked,
    officialSettlementCoverage: roundDisplayRatio(officialCoverage) ?? 0,
    replayGradeTargetMarketCoverage: replayParity.targetMarketCount > 0
      ? roundDisplayRatio(replayParity.coveredTargetMarketCount / replayParity.targetMarketCount)
      : 0,
    simulatorCalibrationAttempts: calibrationAttempts,
    researchValidatedRosterCount: rosterCount,
    reasonCodes,
  };
}

function incrementRejectMix(mix, code, count = 1) {
  const key = stringOrNull(code) ?? "unknown_reject";
  mix[key] = numberOrZero(mix[key]) + count;
}

function averageOrNull(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : null;
}

function calibrationAction({ predictedFillRate, realizedFillRate, predictedSlippage, realizedSlippage, attempts }) {
  if (attempts <= 0) return "insufficient_paper_evidence";
  if (predictedFillRate !== null && realizedFillRate !== null && realizedFillRate < predictedFillRate) return "tighten_fill_probability";
  if (predictedSlippage !== null && realizedSlippage !== null && realizedSlippage > predictedSlippage) return "increase_slippage";
  return "hold_or_collect_more_evidence";
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = numberOrZero(counts[value]) + 1;
    return counts;
  }, {});
}

function metricGate(metric, researchSupported = true) {
  if (!metric) return { ok: false, reasonCodes: ["missing_research_evidence"] };
  const reasonCodes = [];
  if (!researchSupported) reasonCodes.push("unsupported_for_research");
  if (metric.nonPromotable) reasonCodes.push("non_promotable");
  if (metric.promotionVerdict !== "paper_only" && metric.promotionVerdict !== "tiny_live_eligible") reasonCodes.push("promotion_verdict_not_validated");
  if ((metric.labelSource ?? metric.settlementEvidence?.labelSource) !== "official_resolution") reasonCodes.push("official_label_required");
  if ((metric.settlementSource ?? metric.settlementEvidence?.settlementSource) !== "official_resolution") reasonCodes.push("official_settlement_required");
  const officialCoverage = numberOrZero(metric.officialSettlementCoverage ?? metric.settlementEvidence?.officialSettlementCoverage);
  if (officialCoverage < officialScoringCoverageThreshold) reasonCodes.push("official_settlement_coverage_below_scoring_threshold");
  if (officialCoverage < officialPromotionCoverageThreshold) reasonCodes.push("official_settlement_coverage_low");
  if (metric.holdoutPass !== true) reasonCodes.push("holdout_failed");
  if (numberOrZero(metric.conservativeTotalPnl) <= 0) reasonCodes.push("conservative_pnl_not_positive");
  if (numberOrZero(metric.stressTotalPnl) < 0) reasonCodes.push("stress_pnl_negative");
  if (numberOrZero(metric.adjustedConfidence) < 0.7) reasonCodes.push("adjusted_confidence_low");
  if (numberOrZero(metric.falseDiscoveryRisk ?? 1) > 0.2) reasonCodes.push("false_discovery_risk_high");
  return { ok: reasonCodes.length === 0, reasonCodes };
}

function snapshotSettlementSource(metrics) {
  if (!Array.isArray(metrics) || metrics.length === 0) return "estimated";
  const sources = new Set(metrics.map((metric) => metric.settlementSource ?? metric.settlementEvidence?.settlementSource ?? "unknown"));
  if (sources.size === 1) return [...sources][0];
  if (sources.has("official_resolution")) return "mixed";
  if (sources.has("estimated")) return "estimated";
  return "unknown";
}

function officialSettlementCoverageSummary(snapshot) {
  if (isRecord(snapshot?.officialSettlementCoverageSummary)) return snapshot.officialSettlementCoverageSummary;
  const rows = Array.isArray(snapshot?.algoRollup) ? snapshot.algoRollup : [];
  const coverages = rows
    .map((row) => numberOrNull(row.officialSettlementCoverage))
    .filter((value) => value !== null);
  const officialRows = rows.filter((row) => row.labelSource === "official_resolution" && row.settlementSource === "official_resolution").length;
  return {
    metricRows: rows.length,
    officialRows,
    minCoverage: coverages.length ? Math.min(...coverages) : 0,
    maxCoverage: coverages.length ? Math.max(...coverages) : 0,
    averageCoverage: coverages.length ? roundDisplayRatio(coverages.reduce((total, value) => total + value, 0) / coverages.length) : 0,
    promotionGradeCoverageRows: rows.filter((row) => numberOrZero(row.officialSettlementCoverage) >= 0.95).length,
    failClosed: rows.length === 0 || coverages.every((value) => value < 0.95),
  };
}

function decisionFrameJsonLine(row) {
  return JSON.stringify({
    snapshot_id: row.snapshotId,
    row_id: row.rowId,
    source_file_hash: row.sourceFileHash,
    source_line: row.sourceLine,
    captured_at: row.capturedAt,
    observed_at: row.observedAt,
    feature_timestamp: row.featureTimestamp,
    decision_timestamp: row.decisionTimestamp,
    label_timestamp: row.labelTimestamp,
    settlement_timestamp: row.settlementTimestamp,
    label_source: row.labelSource,
    settlement_source: row.settlementSource,
    official_resolution_available: row.officialResolutionAvailable,
    market_close_timestamp: row.marketCloseTimestamp,
    market_ticker: row.marketTicker,
    target_price: row.targetPrice,
    research_candidate_id: row.researchCandidateId ?? "",
    candidate_config_hash: row.candidateConfigHash ?? "",
    estimate: row.estimate,
    spot_price: row.spotPrice,
    distance_from_target: row.distanceFromTarget,
    one_minute_change: row.oneMinuteChange,
    seconds_to_close: row.secondsToClose,
    yes_bid: row.yesBid,
    yes_ask: row.yesAsk,
    no_bid: row.noBid,
    no_ask: row.noAsk,
    yes_bid_depth: row.yesBidDepth,
    yes_ask_depth: row.yesAskDepth,
    no_bid_depth: row.noBidDepth,
    no_ask_depth: row.noAskDepth,
    decision_action: row.decisionAction,
    side: row.side,
    attempted: row.attempted,
    accepted: row.accepted,
    reject_code: row.rejectCode,
    reject_message: row.rejectMessage,
    model_edge_after_fees: row.modelEdgeAfterFees,
    regime: {
      time_to_close: row.regimeTimeToClose,
      spread: row.regimeSpread,
      liquidity: row.regimeLiquidity,
      volatility: row.regimeVolatility,
      momentum: row.regimeMomentum,
      distance: row.regimeDistance,
      phase: row.regimePhase,
    },
    independent_key: row.independentKey,
    overlap_count: row.overlapCount,
  });
}

function paperDecisionLedgerRows(context) {
  return [
    ...ledgerRowsFromDecisionRows(context),
    ...ledgerRowsFromTradeRows(context),
    ...ledgerRowsFromTopStats(context),
  ].sort((left, right) => String(left.decisionTimestamp).localeCompare(String(right.decisionTimestamp))
    || String(left.algoId).localeCompare(String(right.algoId))
    || String(left.eventId).localeCompare(String(right.eventId)));
}

function ledgerRowsFromDecisionRows(context) {
  return context.decisionRows.map((row) => ({
    snapshotId: context.snapshotId,
    eventId: row.rowId,
    eventType: row.accepted ? "decision_accept" : row.rejected || row.rejectCode ? "decision_reject" : row.attempted ? "decision_attempt" : "decision_observed",
    marketTicker: row.marketTicker,
    algoId: row.algoId,
    displayId: row.displayId,
    family: row.family,
    researchCandidateId: row.researchCandidateId ?? "",
    candidateConfigHash: row.candidateConfigHash ?? "",
    promotionStage: metricForLedger(context, row.algoId).promotionStage ?? "paper_decision_ledger",
    promotionVerdict: metricForLedger(context, row.algoId).promotionVerdict ?? "dry_run_evidence_only",
    decisionTimestamp: row.decisionTimestamp,
    featureTimestamp: row.featureTimestamp,
    marketCloseTimestamp: row.marketCloseTimestamp,
    labelTimestamp: row.labelTimestamp,
    settlementTimestamp: row.settlementTimestamp,
    labelSource: row.labelSource,
    settlementSource: row.settlementSource,
    officialResolutionAvailable: row.officialResolutionAvailable,
    side: row.side,
    expectedEdgeAfterFees: row.modelEdgeAfterFees,
    yesBid: row.yesBid,
    yesAsk: row.yesAsk,
    noBid: row.noBid,
    noAsk: row.noAsk,
    yesBidDepth: row.yesBidDepth,
    yesAskDepth: row.yesAskDepth,
    noBidDepth: row.noBidDepth,
    noAskDepth: row.noAskDepth,
    regimeTimeToClose: row.regimeTimeToClose,
    regimeSpread: row.regimeSpread,
    regimeLiquidity: row.regimeLiquidity,
    regimeVolatility: row.regimeVolatility,
    regimeMomentum: row.regimeMomentum,
    regimeDistance: row.regimeDistance,
    attempted: row.attempted,
    accepted: row.accepted,
    rejected: Boolean(row.rejectCode),
    rejectCode: row.rejectCode,
    rejectMessage: row.rejectMessage,
    fillProbability: "",
    partialFillRatio: "",
    depthUtilization: "",
    queueMiss: "",
    slippageCents: "",
    sourceRunId: context.sourceRunId,
    gitCommit: context.gitCommit,
    dataHash: context.dataHash,
    configHash: context.configHash,
  }));
}

function ledgerRowsFromTradeRows(context) {
  return context.tradeRows.map((row) => ({
    snapshotId: context.snapshotId,
    eventId: row.tradeId,
    eventType: row.status === "rejected" || row.rejectCode ? "paper_trade_reject" : row.status === "closed" ? "paper_trade_close" : "paper_trade_open",
    marketTicker: row.marketTicker,
    algoId: row.algoId,
    displayId: row.displayId,
    family: row.family,
    researchCandidateId: row.researchCandidateId ?? "",
    candidateConfigHash: row.candidateConfigHash ?? "",
    promotionStage: row.promotionStage,
    promotionVerdict: row.promotionVerdict,
    decisionTimestamp: row.decisionTimestamp,
    featureTimestamp: row.featureTimestamp,
    marketCloseTimestamp: "",
    labelTimestamp: row.labelTimestamp,
    settlementTimestamp: row.settlementTimestamp,
    labelSource: row.labelSource,
    settlementSource: row.settlementSource,
    officialResolutionAvailable: row.officialResolutionAvailable,
    side: row.side,
    expectedEdgeAfterFees: "",
    yesBid: "",
    yesAsk: "",
    noBid: "",
    noAsk: "",
    yesBidDepth: "",
    yesAskDepth: "",
    noBidDepth: "",
    noAskDepth: "",
    regimeTimeToClose: row.entryRegimeTimeToClose,
    regimeSpread: row.entryRegimeSpread,
    regimeLiquidity: row.entryRegimeLiquidity,
    regimeVolatility: row.entryRegimeVolatility,
    regimeMomentum: row.entryRegimeMomentum,
    regimeDistance: row.entryRegimeDistance,
    attempted: true,
    accepted: !row.rejectCode,
    rejected: Boolean(row.rejectCode),
    rejectCode: row.rejectCode,
    rejectMessage: "",
    fillProbability: row.fillProbability,
    partialFillRatio: row.partialFillRatio,
    depthUtilization: row.depthUtilization,
    queueMiss: row.queueMiss,
    slippageCents: row.slippageCents,
    sourceRunId: row.sourceRunId,
    gitCommit: context.gitCommit,
    dataHash: context.dataHash,
    configHash: context.configHash,
  }));
}

function ledgerRowsFromTopStats(context) {
  const rows = [];
  for (const [key, stat] of Object.entries(context.topStats)) {
    const sourceAlgoId = stat.sourceAlgoId ?? key;
    const metric = metricForLedger(context, sourceAlgoId);
    const rejected = numberOrZero(stat.rejected);
    const attempts = numberOrZero(stat.attempts);
    if (attempts > 0) {
      rows.push(topStatLedgerRow(context, stat, metric, {
        eventId: `${sourceAlgoId}:attempts`,
        eventType: "top_traders_attempt_summary",
        attempted: true,
        accepted: numberOrZero(stat.acceptedBuys) > 0,
        rejected: false,
        rejectCode: "",
        rejectMessage: "",
      }));
    }
    if (rejected > 0) {
      for (const reason of topStatRejectReasons(stat)) {
        rows.push(topStatLedgerRow(context, stat, metric, {
          eventId: `${sourceAlgoId}:reject:${reason.code}`,
          eventType: "top_traders_reject_summary",
          attempted: true,
          accepted: false,
          rejected: true,
          rejectCode: reason.code,
          rejectMessage: `${reason.count} ${reason.label} reject(s) captured by executable dry-run stats.`,
        }));
      }
    }
  }
  return rows;
}

function topStatLedgerRow(context, stat, metric, fields) {
  const timestamp = stat.lastAttemptAt ?? stat.lastSignalAt ?? stat.startedAt ?? "";
  const identity = identityForAlgo(context.identityByAlgoId, stat.sourceAlgoId ?? stat.algoId);
  return {
    snapshotId: context.snapshotId,
    eventId: fields.eventId,
    eventType: fields.eventType,
    marketTicker: stat.marketTicker ?? stat.lastMarketTicker ?? "",
    algoId: stat.sourceAlgoId ?? stat.algoId ?? "",
    displayId: stat.displayId ?? displayIdFromAlgo(stat.sourceAlgoId ?? stat.algoId),
    family: stat.family ?? metric.family ?? "",
    researchCandidateId: identity?.researchCandidateId ?? "",
    candidateConfigHash: identity?.candidateConfigHash ?? "",
    promotionStage: metric.promotionStage ?? "dry_run_evidence",
    promotionVerdict: metric.promotionVerdict ?? "dry_run_evidence_only",
    decisionTimestamp: timestamp,
    featureTimestamp: timestamp,
    marketCloseTimestamp: "",
    labelTimestamp: "",
    settlementTimestamp: "",
    labelSource: metric.labelSource ?? "unknown",
    settlementSource: metric.settlementSource ?? "unknown",
    officialResolutionAvailable: metric.officialResolutionAvailable === true,
    side: "",
    expectedEdgeAfterFees: "",
    yesBid: "",
    yesAsk: "",
    noBid: "",
    noAsk: "",
    yesBidDepth: "",
    yesAskDepth: "",
    noBidDepth: "",
    noAskDepth: "",
    regimeTimeToClose: "",
    regimeSpread: "",
    regimeLiquidity: "",
    regimeVolatility: "",
    regimeMomentum: "",
    regimeDistance: "",
    attempted: fields.attempted,
    accepted: fields.accepted,
    rejected: fields.rejected,
    rejectCode: fields.rejectCode,
    rejectMessage: fields.rejectMessage,
    fillProbability: "",
    partialFillRatio: "",
    depthUtilization: "",
    queueMiss: "",
    slippageCents: "",
    sourceRunId: context.sourceRunId,
    gitCommit: context.gitCommit,
    dataHash: context.dataHash,
    configHash: context.configHash,
  };
}

function topStatRejectReasons(stat) {
  const reasons = [
    ["stale_reject", "stale", stat.staleRejects],
    ["edge_reject", "edge", stat.edgeRejects],
    ["depth_reject", "depth", stat.depthRejects],
    ["gate_reject", "gate", stat.gateRejects],
    ["price_reject", "price", stat.priceRejects],
    ["other_reject", "other", stat.otherRejects],
  ].map(([code, label, count]) => ({ code, label, count: numberOrZero(count) }))
    .filter((reason) => reason.count > 0);
  const known = reasons.reduce((total, reason) => total + reason.count, 0);
  const remaining = Math.max(0, numberOrZero(stat.rejected) - known);
  if (remaining > 0) reasons.push({ code: "reject_unspecified", label: "unspecified", count: remaining });
  return reasons;
}

function metricForLedger(context, algoId) {
  return context.metricByAlgoId.get(algoId)
    ?? context.metricByAlgoId.get(String(algoId ?? "").replace(/^generated:/, ""))
    ?? {};
}

async function writeRawMarketTicksManifest({
  snapshotDir,
  dataRoot,
  snapshotId,
  generatedAt,
  gitInfo,
  decisionRows = [],
  tradeRows = [],
  rawTickFormat = "jsonl",
  maxRawTickMarkets = 20,
  maxRawTickRowsPerMarket = 50_000,
}) {
  const dir = path.join(snapshotDir, "raw_market_ticks");
  await mkdir(dir, { recursive: true });
  const requestedFormat = rawTickFormat === "jsonl" ? "jsonl" : "parquet";
  const schema = {
    schemaVersion: "dogeedge.raw-market-ticks.schema.v1",
    format: requestedFormat,
    fields: [
      "ts_event",
      "ts_receive",
      "market_ticker",
      "channel",
      "event_type",
      "side",
      "book_side",
      "price",
      "size",
      "level",
      "sequence_number",
      "best_yes_bid",
      "best_yes_ask",
      "best_no_bid",
      "best_no_ask",
      "market_status",
      "source",
      "source_message_hash",
      "snapshot_id",
      "git_commit",
    ],
  };
  const rawSnapshotFiles = await latestFilesRecursive(path.join(dataRoot, "raw", "snapshots"), [".jsonl", ".ndjson", ".json", ".csv"], 10);
  const targetMarkets = uniqueStrings([
    ...decisionRows.map((row) => row.marketTicker),
    ...tradeRows.map((row) => row.marketTicker),
  ]).slice(0, Math.max(1, maxRawTickMarkets));
  const jsonlFiles = requestedFormat === "jsonl"
    ? await writeRawTickJsonlSamples({
      dir,
      rawSnapshotFiles,
      snapshotId,
      gitInfo,
      targetMarkets,
      maxRowsPerMarket: maxRawTickRowsPerMarket,
    })
    : [];
  const sources = [];
  for (const file of rawSnapshotFiles) {
    const info = await stat(file).catch(() => null);
    sources.push({
      relativePath: slashPath(path.relative(dataRoot, file)),
      bytes: info?.size ?? 0,
      sha256: info && info.size <= 50 * 1024 * 1024 ? await hashFileMaybe(file) : null,
      hashSkipped: info ? info.size > 50 * 1024 * 1024 : true,
    });
  }
  const coveredTargetMarkets = uniqueStrings(jsonlFiles.map((file) => file.marketTicker));
  const coveredSet = new Set(coveredTargetMarkets);
  const uncoveredTargetMarkets = targetMarkets.filter((marketTicker) => !coveredSet.has(marketTicker));
  const available = jsonlFiles.length > 0;
  const executionSensitivePromotionAllowed = available && targetMarkets.length > 0 && uncoveredTargetMarkets.length === 0;
  const exportedFormat = available ? "jsonl" : null;
  const availabilityStatus = available
    ? uncoveredTargetMarkets.length > 0 ? "partial_sample_exported" : "sample_exported"
    : targetMarkets.length === 0 ? "no_target_markets"
      : sources.length === 0 ? "raw_snapshot_source_absent"
        : "target_samples_absent";
  const hashedSourceSnapshotFileCount = sources.filter((source) => source.sha256).length;
  const hashSkippedSourceSnapshotFileCount = sources.filter((source) => source.hashSkipped).length;
  const sourceHashPolicy = rawSourceHashPolicy(sources, { sha256MaxBytes: 50 * 1024 * 1024 });
  const manifest = {
    schemaVersion: "dogeedge.raw-market-ticks.manifest.v1",
    snapshotId,
    generatedAt,
    available,
    format: exportedFormat,
    requestedFormat,
    exportedFormat,
    availabilityStatus,
    parquetAvailable: false,
    jsonlAvailable: available,
    executionSensitivePromotionAllowed,
    promotionGateRequirement: "raw_target_market_ticks_required_for_execution_sensitive_promotion",
    reason: rawTickAvailabilityReason({ availabilityStatus, requestedFormat }),
    gitCommit: gitInfo.commitHash ?? "UNAVAILABLE",
    expectedDirectory: "raw_market_ticks/<market_ticker>.parquet",
    jsonlDirectory: "raw_market_ticks/jsonl/<market_ticker>.jsonl",
    targetMarkets,
    targetMarketCount: targetMarkets.length,
    coveredTargetMarkets,
    uncoveredTargetMarkets,
    coveredTargetMarketCount: coveredTargetMarkets.length,
    uncoveredTargetMarketCount: uncoveredTargetMarkets.length,
    jsonlFiles: jsonlFiles.map((file) => ({
      relativePath: slashPath(path.relative(snapshotDir, file.path)),
      marketTicker: file.marketTicker,
      rows: file.rows,
    })),
    sourceSnapshotFiles: sources,
    sourceSnapshotFileCount: sources.length,
    hashedSourceSnapshotFileCount,
    hashSkippedSourceSnapshotFileCount,
    sourceHashPolicy: {
      sha256MaxBytes: sourceHashPolicy.sha256MaxBytes,
      hashedFileCount: hashedSourceSnapshotFileCount,
      skippedLargeFileCount: hashSkippedSourceSnapshotFileCount,
      totalSourceBytes: sourceHashPolicy.totalSourceBytes,
      hashedSourceBytes: sourceHashPolicy.hashedSourceBytes,
      hashSkippedSourceBytes: sourceHashPolicy.hashSkippedSourceBytes,
      hashSkippedByteRatio: sourceHashPolicy.hashSkippedByteRatio,
    },
    warningCodes: [
      "raw_market_tick_parquet_absent",
      ...(requestedFormat === "jsonl" && !available ? ["raw_market_tick_jsonl_absent"] : []),
      ...(jsonlFiles.length > 0 ? ["raw_market_tick_jsonl_sample"] : []),
      ...(uncoveredTargetMarkets.length > 0 ? ["raw_market_tick_target_coverage_gap"] : []),
      ...(sources.length === 0 ? ["raw_snapshot_source_absent"] : []),
      ...(sources.some((source) => source.hashSkipped) ? ["raw_snapshot_hash_skipped_large_file"] : []),
    ],
  };
  const schemaPath = path.join(dir, "schema.json");
  const manifestPath = path.join(dir, "manifest.json");
  const coveragePath = path.join(dir, "coverage.tsv.gz");
  const coverageRows = rawTickCoverageRows({
    snapshotId,
    targetMarkets,
    jsonlFiles,
    requestedFormat,
  });
  await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeGzipText(coveragePath, tsv(rawMarketTickCoverageColumns, coverageRows));
  return [
    await fileInfo(schemaPath, "raw_market_ticks/schema.json", "raw_market_ticks/schema.json", null),
    await fileInfo(manifestPath, "raw_market_ticks/manifest.json", "raw_market_ticks/manifest.json", null),
    await fileInfo(coveragePath, "raw_market_ticks/coverage.tsv.gz", "raw_market_ticks/coverage.tsv.gz", coverageRows.length),
    ...await Promise.all(jsonlFiles.map((file) => fileInfo(file.path, `raw_market_ticks/jsonl/${file.marketTicker}.jsonl`, slashPath(path.relative(snapshotDir, file.path)), file.rows))),
  ];
}

function rawTickCoverageRows({ snapshotId, targetMarkets, jsonlFiles, requestedFormat }) {
  const byMarket = new Map(jsonlFiles.map((file) => [file.marketTicker, file]));
  return targetMarkets.map((marketTicker) => {
    const file = byMarket.get(marketTicker);
    return {
      snapshotId,
      marketTicker,
      available: Boolean(file),
      format: file ? requestedFormat : "",
      jsonlRows: file?.rows ?? 0,
      relativePath: file ? slashPath(path.relative(path.dirname(path.dirname(file.path)), file.path)) : "",
      uncoveredReason: file ? "" : "target_market_raw_tick_sample_absent",
    };
  });
}

function rawTickAvailabilityReason({ availabilityStatus, requestedFormat }) {
  if (availabilityStatus === "sample_exported") {
    return "Replayable compact JSONL raw-tick samples are exported for every target review market; parquet remains absent.";
  }
  if (availabilityStatus === "partial_sample_exported") {
    return "Replayable compact JSONL raw-tick samples are exported for some target review markets; uncovered targets are listed explicitly.";
  }
  if (availabilityStatus === "raw_snapshot_source_absent") {
    return "No local raw snapshot source files were found; schema and manifest are exported so raw-tick coverage gaps remain explicit.";
  }
  if (availabilityStatus === "no_target_markets") {
    return "No target review markets were available for raw-tick extraction; schema and source manifest are exported for audit context.";
  }
  if (requestedFormat === "jsonl") {
    return "No matching JSONL raw-tick sample rows were found for the target review markets; source files and uncovered targets are listed explicitly.";
  }
  return "Replayable per-market parquet tick export is not present in current local artifacts; schema and source manifest are exported so calibration gaps remain explicit.";
}

async function writeRawTickJsonlSamples({ dir, rawSnapshotFiles, snapshotId, gitInfo, targetMarkets, maxRowsPerMarket }) {
  if (!rawSnapshotFiles.length) return [];
  const jsonlDir = path.join(dir, "jsonl");
  await mkdir(jsonlDir, { recursive: true });
  const targets = new Set(targetMarkets);
  const rowsByMarket = new Map();
  const sourceLineLimit = Math.min(10_000, Math.max(1_000, targetMarkets.length * 500));
  for (const file of rawSnapshotFiles.slice(0, 3)) {
    const lines = await readTailLines(file, sourceLineLimit);
    for (const line of lines) {
      const raw = parseJsonLine(line);
      const marketTicker = stringOrNull(raw?.marketTicker ?? raw?.paperInput?.ticker);
      if (!marketTicker) continue;
      if (targets.size > 0 && !targets.has(marketTicker)) continue;
      const current = rowsByMarket.get(marketTicker) ?? [];
      if (current.length >= maxRowsPerMarket) continue;
      current.push(JSON.stringify(compactRawTickRow(raw, line, { snapshotId, gitCommit: gitInfo.commitHash ?? "UNAVAILABLE" })));
      rowsByMarket.set(marketTicker, current);
      if (targets.size === 0 && rowsByMarket.size >= 20) break;
    }
  }
  const files = [];
  for (const [marketTicker, rows] of rowsByMarket) {
    const safeTicker = marketTicker.replace(/[^A-Za-z0-9_.-]/g, "_");
    const filePath = path.join(jsonlDir, `${safeTicker}.jsonl`);
    await writeFile(filePath, `${rows.join("\n")}${rows.length ? "\n" : ""}`, "utf8");
    files.push({ marketTicker, rows: rows.length, path: filePath });
  }
  return files;
}

function compactRawTickRow(raw, sourceLine, context) {
  const input = raw?.paperInput ?? {};
  const feed = raw?.runtimeSnapshot?.feed ?? {};
  return {
    ts_event: input.observedAt ?? raw?.capturedAt ?? null,
    ts_receive: raw?.capturedAt ?? raw?.runtimeSnapshot?.generatedAt ?? null,
    market_ticker: raw?.marketTicker ?? input.ticker ?? null,
    channel: "local_raw_snapshot",
    event_type: "orderbook_snapshot",
    side: input.action?.includes("no") ? "NO" : input.action?.includes("yes") ? "YES" : "",
    book_side: "top",
    price: numberOrNull(input.selectedAsk ?? input.yesAsk ?? input.noAsk),
    size: numberOrNull(input.sizeContracts),
    level: 0,
    sequence_number: null,
    best_yes_bid: numberOrNull(input.yesBid),
    best_yes_ask: numberOrNull(input.yesAsk),
    best_no_bid: numberOrNull(input.noBid),
    best_no_ask: numberOrNull(input.noAsk),
    market_status: input.marketLive === true ? "open" : "unknown",
    source: "local_raw_snapshot",
    source_message_hash: sha256(sourceLine),
    snapshot_id: context.snapshotId,
    git_commit: context.gitCommit,
    spot_price: numberOrNull(input.spotPrice ?? feed.price),
    target_price: numberOrNull(input.targetPrice),
    seconds_to_close: numberOrNull(input.secondsToClose),
  };
}

function warningRows({ snapshotId, generatedAt, safety, localStoredAt, dataQuality, gitInfo, registry, topStats, includeRows, rowExportMode }) {
  const warnings = [];
  const add = (code, severity, message, remediationHint, fields = {}) => {
    warnings.push({
      snapshotId,
      scope: fields.scope ?? "system",
      objectType: fields.objectType ?? "snapshot",
      objectId: fields.objectId ?? snapshotId,
      code,
      severity,
      firstSeenAt: generatedAt,
      lastSeenAt: generatedAt,
      count: fields.count ?? 1,
      message,
      remediationHint,
    });
  };
  if (safety.liveTradingEnabled || !safety.dryRun) {
    add("live_safety_flip", "critical", "Live safety flags are not in the default paper-only state.", "Stop review automation and inspect live-switch settings before any further patching.");
  }
  if (!Number.isFinite(localStoredAt)) {
    add("missing_local_worker_snapshot", "high", "No local-worker latest snapshot timestamp was found.", "Start the local worker and app, then rerun the exporter.");
  } else if (Date.now() - localStoredAt > 45 * 60_000) {
    add("snapshot_stale", "high", "The newest local-worker snapshot is older than 45 minutes.", "Confirm the app and local worker are still running.");
  }
  if (dataQuality.errorCount > 0) {
    add("data_quality_errors", "critical", "Factory output reports data-quality errors.", "Inspect latest factory report and do not promote affected algos.");
  }
  if (!gitInfo.commitHash) {
    add("missing_git_commit", "high", "Git commit could not be recorded.", "Install/repair Git or run inside a Git worktree for exact reproducibility.");
  }
  if (!registry?.inputManifestHash) {
    add("missing_input_manifest_hash", "high", "Experiment registry does not include an exact input manifest hash.", "Rerun factory validation so exact file hashes are recorded.");
  }
  if (Object.keys(topStats).length === 0) {
    add("missing_top_traders_executable", "warn", "No top-traders executable roster stats were found.", "Keep the app/local worker running until executable roster stats are persisted.");
  }
  if (!includeRows) {
    add("row_exports_disabled", "warn", "Decision/trade row extracts were not included in this packet.", "Run with --include-rows for first upload or when reject/drift alerts fire.");
  } else if (rowExportMode === "capped") {
    add("row_exports_capped", "warn", "Decision/trade row extracts are capped.", "Run eval:bundle with --full-rows for promotion-review or reconciliation audits.");
  }
  const rejectTotals = Object.values(topStats).reduce((total, stat) => total + numberOrZero(stat.rejected), 0);
  if (rejectTotals === 0) {
    add("missing_reject_stream", "warn", "No reject counts are present in the top-traders stats.", "Exporter can only audit fill/reject realism when rejection evidence is present.");
  }
  return warnings;
}

function flattenWarning(warning) {
  return warning;
}

function dataQualitySummary(primaryRun, metrics) {
  const source = primaryRun?.dataQuality ?? {};
  return {
    rawFrames: numberOrZero(source.rawFrames ?? primaryRun?.frameCount),
    usableFrames: numberOrZero(source.usableFrames ?? primaryRun?.frameCount),
    excludedFrames: numberOrZero(source.excludedFrames),
    postCloseFramesExcluded: numberOrZero(source.postCloseFramesExcluded),
    duplicateFramesRemoved: numberOrZero(source.duplicateFramesRemoved),
    overlappingFramesDownsampled: numberOrZero(source.overlappingFramesDownsampled),
    marketEvents: numberOrZero(source.marketEvents ?? primaryRun?.eventCount),
    warningCount: numberOrZero(source.warningCount) + metrics.reduce((total, metric) => total + (metric.warnings?.length ?? 0), 0),
    errorCount: numberOrZero(source.errorCount),
    settlementEvidence: source.settlementEvidence ?? {},
  };
}

function liveSafetyState(liveSwitch) {
  const dryRun = liveSwitch?.dryRun !== false;
  const liveTradingEnabled = liveSwitch?.enabled === true && dryRun === false;
  return {
    dryRun,
    liveTradingEnabled,
    manualApprovalRequired: true,
    switchEnabled: liveSwitch?.enabled === true,
    updatedAt: liveSwitch?.updatedAt ?? null,
  };
}

function costModelsForSnapshot(registry, primaryRun) {
  const models = Array.isArray(registry.costModel) ? registry.costModel : Array.isArray(primaryRun?.costModels) ? primaryRun.costModels : [];
  return models.map((model) => ({
    id: model.id ?? "",
    label: model.label ?? model.id ?? "",
    fees: numberOrNull(model.feeRate ?? model.fees),
    slippage: numberOrNull(model.slippageCents ?? model.slippage),
    stress: model.id === "stress" || model.stress === true,
    feeRate: numberOrNull(model.feeRate),
    feePerContract: numberOrNull(model.feePerContract),
    slippageCents: numberOrNull(model.slippageCents),
    spreadPenaltyCents: numberOrNull(model.spreadPenaltyCents),
    stressSlippageCents: numberOrNull(model.stressSlippageCents),
    maxLatencyMs: numberOrNull(model.maxLatencyMs),
    depthShare: numberOrNull(model.depthShare),
    minFillProbability: numberOrNull(model.minFillProbability),
    allowPartialFills: model.allowPartialFills !== false,
  }));
}

async function copyRepoBundle({ bundleRoot, options }) {
  const dataRoot = path.resolve(options.dataRoot ?? defaultDataRoot());
  const storageDir = path.resolve(options.storageDir ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
  const backtestsDir = path.resolve(options.backtestsDir ?? path.join(dataRoot, "backtests"));
  const latestSweep = await readJsonMaybe(path.join(backtestsDir, "latest-sweep.json"));
  const runDir = stringOrNull(latestSweep?.runDir);
  const files = [];
  const writeTextTarget = async (relativePath, text) => {
    const target = path.join(bundleRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
    files.push(await fileInfo(target, path.basename(relativePath), relativePath, null));
  };
  const gitInfo = await repoInfo();
  await writeTextTarget("repo/COMMIT_HASH.txt", `${gitInfo.commitHash ?? "UNAVAILABLE"}\n`);
  if (gitInfo.dirty) {
    const diffText = await gitDiffForBundle();
    await writeTextTarget(
      "repo/UNCOMMITTED_DIFF.patch",
      diffText.trim().length > 0
        ? diffText
        : "Repository was reported dirty, but no textual git diff was available.\n",
    );
  }
  for (const item of [
    { source: path.join(repoRoot, "package.json"), target: "repo/package.json" },
    { source: path.join(repoRoot, "DOGEEDGE_ALGO_FACTORY.md"), target: "repo/DOGEEDGE_ALGO_FACTORY.md" },
    { source: path.join(storageDir, "latest.json"), target: "repo/local-worker-latest.json" },
    { source: path.join(storageDir, "summary.md"), target: "repo/local-worker-summary.md" },
    { source: path.join(storageDir, "algorithm-candidates.json"), target: "repo/algorithm-candidates.json" },
    { source: path.join(storageDir, "rules-active.json"), target: "repo/rules-active.json" },
    { source: path.join(storageDir, "top-traders-executable.json"), target: "repo/top-traders-executable.json" },
    { source: path.join(backtestsDir, "latest.json"), target: "repo/backtests-latest.json" },
    { source: path.join(backtestsDir, "latest-sweep.json"), target: "repo/latest-sweep.json" },
    { source: runDir ? path.join(runDir, "candidates.json") : "", target: "repo/candidates.json" },
    { source: runDir ? path.join(runDir, "metrics.csv") : "", target: "repo/latest-sweep-metrics.csv" },
    { source: runDir ? path.join(runDir, "report.md") : "", target: "repo/latest-sweep-report.md" },
  ]) {
    if (!item.source || !(await exists(item.source))) continue;
    const target = path.join(bundleRoot, item.target);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(item.source, target);
    files.push(await fileInfo(target, path.basename(item.target), item.target, null));
  }
  return files;
}

async function gitDiffForBundle() {
  const git = await gitBinary();
  if (!git) return "";
  try {
    const diff = await execFileAsync(git, ["-C", repoRoot, "diff", "--binary", "HEAD"], { windowsHide: true, maxBuffer: 50 * 1024 * 1024 });
    return diff.stdout;
  } catch {
    return "";
  }
}

async function writeRegistryTarball({ bundleRoot, options, snapshot }) {
  const dataRoot = path.resolve(options.dataRoot ?? defaultDataRoot());
  const backtestsDir = path.resolve(options.backtestsDir ?? path.join(dataRoot, "backtests"));
  const latestSweep = await readJsonMaybe(path.join(backtestsDir, "latest-sweep.json"));
  const runDir = stringOrNull(latestSweep?.runDir);
  const registrySource = runDir ? path.join(runDir, "experiment-registry.json") : "";
  const registryDir = path.join(bundleRoot, "registry");
  await mkdir(registryDir, { recursive: true });
  const registryJson = path.join(registryDir, "experiment-registry.json");
  if (registrySource && await exists(registrySource)) {
    await copyFile(registrySource, registryJson);
  } else {
    await writeFile(registryJson, `${JSON.stringify(snapshot.experimentRegistry, null, 2)}\n`, "utf8");
  }
  const tarPath = path.join(registryDir, "experiment-registry.tar.gz");
  try {
    await execFileAsync("tar", ["-czf", tarPath, "-C", registryDir, "experiment-registry.json"], { windowsHide: true });
    return fileInfo(tarPath, "experiment-registry.tar.gz", "registry/experiment-registry.tar.gz", null);
  } catch {
    const gzPath = path.join(registryDir, "experiment-registry.json.gz");
    await writeGzipText(gzPath, await readFile(registryJson, "utf8"));
    return fileInfo(gzPath, "experiment-registry.json.gz", "registry/experiment-registry.json.gz", null);
  }
}

async function zipDirectory(sourceDir, destinationZip) {
  await rm(destinationZip, { force: true });
  if (process.platform === "win32") {
    try {
      const command = [
        `$items = Get-ChildItem -LiteralPath ${powerShellString(sourceDir)}`,
        `Compress-Archive -LiteralPath $items.FullName -DestinationPath ${powerShellString(destinationZip)} -Force`,
      ].join("; ");
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ], { windowsHide: true, timeout: 120_000 });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await execFileAsync("zip", ["-qr", destinationZip, "."], { cwd: sourceDir, timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

async function repoInfo() {
  const git = await gitBinary();
  if (!git) return { commitHash: null, branch: null, dirty: true };
  try {
    const [commit, branch, status] = await Promise.all([
      execFileAsync(git, ["-C", repoRoot, "rev-parse", "HEAD"], { windowsHide: true }),
      execFileAsync(git, ["-C", repoRoot, "branch", "--show-current"], { windowsHide: true }),
      execFileAsync(git, ["-C", repoRoot, "status", "--porcelain"], { windowsHide: true }),
    ]);
    return {
      commitHash: commit.stdout.trim() || null,
      branch: branch.stdout.trim() || null,
      dirty: status.stdout.trim().length > 0,
    };
  } catch {
    return { commitHash: null, branch: null, dirty: true };
  }
}

async function gitBinary() {
  for (const candidate of process.platform === "win32"
    ? ["git", "C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"]
    : ["git"]) {
    try {
      await execFileAsync(candidate, ["--version"], { windowsHide: true });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function latestNamedDirs(root, limit) {
  try {
    const names = await readdir(root);
    const entries = [];
    for (const name of names) {
      const absolutePath = path.join(root, name);
      const info = await stat(absolutePath).catch(() => null);
      if (info?.isDirectory()) entries.push({ absolutePath, time: info.mtimeMs });
    }
    return entries.sort((left, right) => right.time - left.time).slice(0, limit).map((entry) => entry.absolutePath);
  } catch {
    return [];
  }
}

async function latestFilesRecursive(root, extensions, limit) {
  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
        const info = await stat(absolutePath).catch(() => null);
        if (info) found.push({ absolutePath, time: info.mtimeMs });
      }
    }
  }
  await walk(root);
  return found.sort((left, right) => right.time - left.time).slice(0, limit).map((entry) => entry.absolutePath);
}

async function readTailLines(filePath, maxLines) {
  if (!filePath || !(await exists(filePath))) return [];
  const info = await stat(filePath);
  const chunkSize = 256 * 1024;
  const maxBytes = Math.min(info.size, 8 * 1024 * 1024);
  const chunks = [];
  let position = info.size;
  let loaded = 0;
  let text = "";
  while (position > 0 && loaded < maxBytes && countLines(text) <= maxLines + 1) {
    const readSize = Math.min(chunkSize, position, maxBytes - loaded);
    position -= readSize;
    loaded += readSize;
    const buffer = Buffer.alloc(readSize);
    const handle = await import("node:fs/promises").then((mod) => mod.open(filePath, "r"));
    try {
      await handle.read(buffer, 0, readSize, position);
    } finally {
      await handle.close();
    }
    chunks.unshift(buffer);
    text = Buffer.concat(chunks).toString("utf8");
  }
  return text.split(/\r?\n/).filter(Boolean).slice(-maxLines);
}

function countLines(text) {
  return (text.match(/\n/g) ?? []).length;
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readJsonMaybe(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileInfo(filePath, logicalName, relativePath, rows) {
  const [info, sha256] = await Promise.all([stat(filePath), hashFileMaybe(filePath)]);
  return {
    logicalName,
    relativePath: slashPath(relativePath),
    sha256,
    bytes: info.size,
    rows,
  };
}

async function hashFileMaybe(filePath) {
  if (!filePath || !(await exists(filePath))) return null;
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function writeGzipText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, gzipSync(text));
}

function tsv(columns, rows) {
  return [
    columns.join("\t"),
    ...rows.map((row) => columns.map((column) => tsvValue(row[column])).join("\t")),
  ].join("\n") + "\n";
}

function tsvValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = typeof value === "object" ? stableStringify(value) : String(value);
  return text.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
}

function csv(columns, rows) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
  ].join("\n") + "\n";
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = typeof value === "object" ? stableStringify(value) : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function rowCountFromTsv(text) {
  return Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1);
}

function topStatForMetric(topStats, metric) {
  return topStats[metric.algoId]
    ?? Object.values(topStats).find((stat) => stat?.sourceAlgoId === metric.algoId || stat?.algoId === metric.algoId)
    ?? null;
}

function summarizeTopStats(topStats) {
  return Object.values(topStats).reduce((summary, stat) => {
    summary.strategyStats += 1;
    summary.signals += numberOrZero(stat.signals);
    summary.attempts += numberOrZero(stat.attempts);
    summary.acceptedBuys += numberOrZero(stat.acceptedBuys);
    summary.rejected += numberOrZero(stat.rejected);
    summary.open += numberOrZero(stat.open);
    summary.wins += numberOrZero(stat.wins);
    summary.losses += numberOrZero(stat.losses);
    return summary;
  }, { strategyStats: 0, signals: 0, attempts: 0, acceptedBuys: 0, rejected: 0, open: 0, wins: 0, losses: 0 });
}

function hashEventIds(values) {
  return Array.isArray(values) ? hashJson(values) : null;
}

function displayIdFromMetric(metric, stat) {
  return metric.displayId ?? stat?.displayId ?? displayIdFromAlgo(metric.algoId) ?? null;
}

function displayIdFromAlgo(algoId) {
  const match = String(algoId ?? "").match(/(?:batch-)?([a-z])-([a-z0-9]+)?-?(\d{4})$/i)
    ?? String(algoId ?? "").match(/([A-Z])-(\d{4})$/i);
  if (!match) return null;
  const batch = match[1].toUpperCase();
  const serial = match[3] ?? match[2];
  return serial ? `${batch}-${serial.slice(-4).toUpperCase()}` : null;
}

function batchIdFromAlgo(algoId) {
  const match = String(algoId ?? "").match(/batch-([a-z])/i);
  return match ? match[1].toUpperCase() : "";
}

function slotFromMetric(metric, stat) {
  if (metric.promotionVerdict === "tiny_live_eligible") return "manual_review";
  if (metric.promotionVerdict === "paper_only") return "paper_only";
  if (stat) return "dry_run_evidence";
  return "research";
}

function sideFromAction(action) {
  if (String(action ?? "").toLowerCase().includes("yes")) return "YES";
  if (String(action ?? "").toLowerCase().includes("no")) return "NO";
  return "";
}

function holdingSeconds(trade) {
  const opened = parseTime(trade.openedAt);
  const closed = parseTime(trade.closedAt);
  return Number.isFinite(opened) && Number.isFinite(closed) ? Math.max(0, (closed - opened) / 1000) : "";
}

function parseTime(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : null;
}

function defaultDataRoot() {
  if (process.env.DOGEEDGE_DATA_ROOT) return process.env.DOGEEDGE_DATA_ROOT;
  if (process.platform === "win32") return "D:\\DogeEdge\\data";
  return path.join(repoRoot, "data");
}

function windowKind(minutes) {
  if (minutes === 30) return "30m";
  if (minutes === 120) return "2h";
  if (minutes === 1440) return "24h";
  return `${minutes}m`;
}

function compactIso(date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

function numberOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function roundDisplayRatio(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function roundDisplayMoney(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function identityForAlgo(identityByAlgoId, algoId) {
  const text = String(algoId ?? "");
  return identityByAlgoId?.get(text)
    ?? identityByAlgoId?.get(text.replace(/^generated:/, ""))
    ?? null;
}

function exactIdentityKey(researchCandidateId, candidateConfigHash) {
  const id = stringOrNull(researchCandidateId);
  const hash = stringOrNull(candidateConfigHash);
  return id && hash ? `${id}|${hash}` : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function jsonCell(value) {
  return JSON.stringify(value ?? null);
}

function slashPath(value) {
  return String(value).replaceAll(path.sep, "/");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return {
    dataRoot: result["data-root"],
    storageDir: result["storage-dir"],
    backtestsDir: result["backtests-dir"],
    outDir: result.out,
    windowMinutes: result["window-minutes"],
    bundleHours: result["bundle-hours"],
    bundle: Boolean(result.bundle),
    includeRows: result["no-rows"] ? false : true,
    fullRows: Boolean(result["full-rows"]),
    maxRowLines: result["max-row-lines"],
    maxMetrics: result["max-metrics"],
    rawTickFormat: result["raw-tick-format"],
    maxRawTickMarkets: result["max-raw-tick-markets"],
    maxRawTickRowsPerMarket: result["max-raw-tick-rows-per-market"],
    sourceTimezone: result.timezone,
  };
}

function powerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = options.bundle
    ? await buildReviewBundle(options)
    : await exportEvaluationSnapshot(options);
  const summary = {
    snapshotId: result.snapshot.snapshotId,
    snapshotPath: result.snapshotPath,
    manifestPath: result.manifestPath,
    bundlePath: result.bundlePath ?? null,
    bundleRoot: result.bundleRoot ?? null,
    alerts: result.snapshot.alerts,
    liveSafety: result.snapshot.appState.liveSafety,
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
