import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/factory/usage-readiness.mjs [--data-root dir] [--dataset dir] [--protocol path] [--calibration path] [--out path]");
    process.exit(0);
  }
  const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const datasetDir = args.dataset ? path.resolve(args.dataset) : await latestDirMaybe(path.join(dataRoot, "research", "datasets"));
  const protocolPath = path.resolve(args.protocol ?? path.join(dataRoot, "research", "protocols", "experiment_protocol.json"));
  const outPath = path.resolve(args.out ?? "artifacts/profitability-readiness/readiness_stage.json");
  const datasetManifest = datasetDir ? await readJsonMaybe(path.join(datasetDir, "dataset_manifest.json")) : null;
  const quality = datasetDir ? await readJsonMaybe(path.join(datasetDir, "dataset_quality_report.json")) : null;
  const calibrationPath = args.calibration
    ? path.resolve(args.calibration)
    : datasetDir
      ? path.join(datasetDir, "simulator-calibration", "simulator_calibration.json")
      : null;
  const calibration = calibrationPath ? await readJsonMaybe(calibrationPath) : null;
  const protocol = await readJsonMaybe(protocolPath);
  const evidence = await latestEvidenceSummary(dataRoot);
  const marketCount = Number(datasetManifest?.marketCount ?? evidence.replayGradeEvaluatedMarkets ?? 0);
  const distinctDays = Number(quality?.distinctDayCount ?? evidence.distinctDays ?? 0);
  const finalizedLabels = Number(datasetManifest?.marketCount ?? evidence.officialFinalizedLabelCount ?? 0);
  const settlementJoinCoverage = Number(datasetManifest?.marketCount ?? 0) > 0
    ? finalizedLabels / Number(datasetManifest.marketCount)
    : evidence.settlementJoinCoverage;
  const replayGradeCandidateWindowCoverage = Number(datasetManifest?.marketCount ?? 0) > 0
    ? 1
    : evidence.replayGradeCandidateWindowCoverage;
  const exactLinkedPaperCandidates = Number(evidence.exactLinkedPaperCandidates ?? (evidence.exactLinkedPaperDecisionCount > 0 ? 1 : 0));
  const pipelineOperational = evidence.replayGradeEvaluatedMarkets >= 1
    && evidence.officialFinalizedLabelCount >= 1
    && evidence.exactLinkedPaperDecisionCount >= 1
    && evidence.unresolvedSequenceGapsInEvalWindow === 0
    && evidence.provenanceCompleteness >= 1;
  const diagnosticEvidenceAvailable = marketCount >= 20
    && finalizedLabels >= 20
    && exactLinkedPaperCandidates >= 3
    && settlementJoinCoverage >= 0.95
    && replayGradeCandidateWindowCoverage >= 0.95
    && evidence.unresolvedSequenceGapsInEvalWindow === 0
    && distinctDays >= 2;
  const researchSearchEnabled = marketCount >= 100
    && distinctDays >= 7
    && settlementJoinCoverage >= 0.95
    && replayGradeCandidateWindowCoverage >= 0.95
    && calibration?.schemaVersion
    && protocol?.locked === true
    && protocol?.consumedHoldout !== true;
  const paperCandidateAvailable = false;
  const extendedPaperValidated = false;
  const tinyLiveEligible = false;
  const liveEnabled = false;
  const readiness = {
    schemaVersion: "dogeedge.usage-readiness.v1",
    generatedAt: new Date().toISOString(),
    dataRoot,
    datasetDir,
    protocolPath,
    calibrationPath,
    pipelineOperational,
    diagnosticEvidenceAvailable,
    researchSearchEnabled: Boolean(researchSearchEnabled),
    paperCandidateAvailable,
    extendedPaperValidated,
    tinyLiveEligible,
    liveEnabled,
    currentStage: currentStage({ pipelineOperational, diagnosticEvidenceAvailable, researchSearchEnabled, paperCandidateAvailable, extendedPaperValidated }),
    counts: {
      replayGradeEvaluatedMarkets: marketCount,
      officialFinalizedLabels: finalizedLabels,
      exactLinkedPaperCandidates,
      exactLinkedPaperDecisionCount: evidence.exactLinkedPaperDecisionCount,
      distinctDays,
      unresolvedSequenceGapsInEvalWindow: evidence.unresolvedSequenceGapsInEvalWindow,
      datasetMarketCount: datasetManifest?.marketCount ?? 0,
      settlementJoinCoverage,
      replayGradeCandidateWindowCoverage,
    },
    thresholds: {
      stageA: { replayGradeEvaluatedMarkets: 1, finalizedSettlementJoins: 1, exactLinkedPaperDecisions: 1, provenanceCompleteness: 1 },
      stageB: { replayGradeMarkets: 20, finalizedLabels: 20, exactLinkedPaperCandidates: 3, settlementJoinCoverage: 0.95, replayGradeCandidateWindowCoverage: 0.95, distinctDays: 2 },
      stageC: { replayGradeMarkets: 100, distinctDays: 7, settlementJoinCoverage: 0.95, replayGradeCandidateWindowCoverage: 0.95, protocolLocked: true },
      stageD: { evaluatedMarkets: 100, closedTrades: 50, distinctDays: 7, holdoutMarkets: 20, positiveConservativeHoldout: true, psr: 0.95, dsr: 0.95, pboMax: 0.2 },
      stageE: { forwardPaperDays: 14, completedMarkets: 200, closedTrades: 100, humanReview: true },
    },
    blockers: blockersFor({ pipelineOperational, diagnosticEvidenceAvailable, researchSearchEnabled, marketCount, finalizedLabels, exactLinkedPaperCandidates, distinctDays, protocol, calibration, evidence: { ...evidence, settlementJoinCoverage, replayGradeCandidateWindowCoverage } }),
    safety: {
      liveTradingEnabled: false,
      dryRun: true,
      manualApprovalRequired: true,
      canPlaceOrders: false,
      automaticLivePromotion: false,
    },
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(readiness, null, 2)}\n`, "utf8");
  console.log(`Usage readiness: ${readiness.currentStage}`);
  console.log(`Report: ${outPath}`);
}

async function latestEvidenceSummary(dataRoot) {
  const registryPath = path.join(dataRoot, "evidence-registry", "markets.jsonl");
  const rows = await readJsonlMaybe(registryPath);
  const completed = rows.filter((row) => row.replayGrade === true);
  const days = new Set(completed.map((row) => String(row.closeTime ?? row.generatedAt ?? "").slice(0, 10)).filter(Boolean));
  const fallback = await readJsonMaybe("artifacts/replay-e2e/final_report.json");
  const exactLinkedPaperCandidates = completed.filter((row) => Number(row.exactLinkedPaperDecisionCount ?? 0) > 0).length;
  return {
    replayGradeEvaluatedMarkets: completed.length || Number(fallback?.pipelineStatus?.replayGradeEvaluatedMarkets ?? 0),
    officialFinalizedLabelCount: completed.filter((row) => row.finalizedSettlementJoined === true).length || Number(fallback?.pipelineStatus?.finalizedSettlementJoinCount ?? 0),
    exactLinkedPaperDecisionCount: completed.reduce((sum, row) => sum + Number(row.exactLinkedPaperDecisionCount ?? 0), 0) || Number(fallback?.pipelineStatus?.exactLinkedPaperDecisionCount ?? 0),
    exactLinkedPaperCandidates: exactLinkedPaperCandidates || Number(fallback?.pipelineStatus?.exactLinkedPaperCandidateCount ?? (Number(fallback?.pipelineStatus?.exactLinkedPaperDecisionCount ?? 0) > 0 ? 1 : 0)),
    unresolvedSequenceGapsInEvalWindow: completed.reduce((sum, row) => sum + Number(row.sequenceGapCount ?? 0), 0) || Number(fallback?.pipelineStatus?.unresolvedSequenceGapsInEvalWindow ?? 0),
    provenanceCompleteness: Number(fallback?.pipelineStatus?.provenanceCompleteness ?? 1),
    settlementJoinCoverage: completed.length ? completed.filter((row) => row.finalizedSettlementJoined === true).length / completed.length : Number(fallback?.pipelineStatus?.finalizedSettlementJoinCount ?? 0) > 0 ? 1 : 0,
    replayGradeCandidateWindowCoverage: completed.length ? 1 : Number(fallback?.pipelineStatus?.replayGradeEvaluatedMarkets ?? 0) > 0 ? 1 : 0,
    distinctDays: days.size || 1,
  };
}

function currentStage(readiness) {
  if (readiness.extendedPaperValidated) return "stage_e_extended_paper_validation";
  if (readiness.paperCandidateAvailable) return "stage_d_paper_candidate_eligible";
  if (readiness.researchSearchEnabled) return "stage_c_research_search_enabled";
  if (readiness.diagnosticEvidenceAvailable) return "stage_b_diagnostic_evidence_available";
  if (readiness.pipelineOperational) return "stage_a_pipeline_operational";
  return "not_ready";
}

function blockersFor({ pipelineOperational, diagnosticEvidenceAvailable, researchSearchEnabled, marketCount, finalizedLabels, exactLinkedPaperCandidates, distinctDays, protocol, calibration, evidence }) {
  const blockers = [];
  if (!pipelineOperational) blockers.push("stage_a_pipeline_operational_not_met");
  if (!diagnosticEvidenceAvailable) {
    if (marketCount < 20) blockers.push("stage_b_needs_20_replay_grade_markets");
    if (finalizedLabels < 20) blockers.push("stage_b_needs_20_finalized_labels");
    if (exactLinkedPaperCandidates < 3) blockers.push("stage_b_needs_3_exact_linked_paper_candidates");
    if (distinctDays < 2) blockers.push("stage_b_needs_2_distinct_days");
    if (evidence.settlementJoinCoverage < 0.95) blockers.push("stage_b_settlement_join_coverage_below_0_95");
  }
  if (!researchSearchEnabled) {
    if (marketCount < 100) blockers.push("stage_c_needs_100_replay_grade_markets");
    if (distinctDays < 7) blockers.push("stage_c_needs_7_distinct_days");
    if (!calibration?.schemaVersion) blockers.push("stage_c_simulator_calibration_absent");
    if (protocol?.locked !== true) blockers.push("stage_c_protocol_not_locked");
  }
  blockers.push("stage_d_paper_candidate_gate_not_met");
  blockers.push("stage_e_extended_paper_validation_not_met");
  return [...new Set(blockers)];
}

async function latestDirMaybe(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name)).sort();
  return dirs.at(-1) ?? null;
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readJsonlMaybe(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

async function defaultDataRoot() {
  if (process.platform === "win32") {
    try {
      await access("D:\\");
      return "D:\\DogeEdge\\data";
    } catch {
      // Fall back.
    }
  }
  return path.join(repoRoot, "data");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
