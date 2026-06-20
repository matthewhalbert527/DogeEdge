import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeDecisionFrame } from "../../scripts/factory/schema.mjs";
import { buildMarketEvents, deduplicateDecisionFrames, readFactoryDecisionFrames } from "../../scripts/factory/data.mjs";
import { purgedEmbargoFolds } from "../../scripts/factory/splits.mjs";
import { simulateAlgoEvents, stateDepthShare, stateFillProbability } from "../../scripts/factory/simulator.mjs";
import { metricsForAlgo } from "../../scripts/factory/metrics.mjs";
import { pboRankDegradationApprox, rankFactoryMetrics } from "../../scripts/factory/ranking.mjs";
import { effectiveTrialCount, qValueMap } from "../../scripts/factory/multiple-testing.mjs";
import { promotionReview } from "../../scripts/factory/promotion.mjs";
import { runFactoryResearchPipeline } from "../../scripts/factory/pipeline.mjs";
import { finalHoldoutSplit } from "../../scripts/factory/holdout.mjs";
import { detectEvidenceDrift } from "../../scripts/factory/drift.mjs";
import { compareInputManifest, decisionFrameInputManifest } from "../../scripts/factory/repro.mjs";
import { paperEvidenceForAlgo, readPaperEvidence } from "../../scripts/factory/paper-evidence.mjs";
import { markdownReport, metricsCsv } from "../../scripts/factory/reporting.mjs";
import { auditReviewExports } from "../../scripts/factory/audit-exports.mjs";
import { researchLiveAlignment } from "../../scripts/factory/family-registry.mjs";
import { researchCandidateIdentity } from "../../scripts/factory/candidate-identity.mjs";
import { sampleSufficiency } from "../../scripts/factory/sample-gates.mjs";
import { applyFamilySearchBudget, applyPromoteCheckDiagnosticCap, searchBudgetDecision } from "../../scripts/factory/search-budget.mjs";
import {
  normalizeKalshiHistoricalMarket,
  normalizeOfficialSettlementRow,
  officialOutcomeMap,
  officialSettlementCoverageForEvents,
} from "../../scripts/factory/official-settlement.mjs";
import { compactReplayTickRow, normalizeReplayRawEvent, rawTickReplayManifest, replaySequenceReport, selectReplaySegment } from "../../scripts/factory/raw-tick-extract.mjs";
import { replayParityReportFromManifest } from "../../scripts/factory/replay-coverage.mjs";
import { buildExecutableReadinessGate } from "../../scripts/factory/readiness-gate.mjs";
import { forecastCalibrationForDecisionRows, officialForecastCalibrationReport, probabilityCalibrationForTrades, tradeCalibrationByCandidate } from "../../scripts/factory/probability-calibration.mjs";
import { deterministicLinkageBackfill } from "../../scripts/factory/backfill-linkage.mjs";
import { loadSourceSweep, materializeExactLinkageForSource, mergeTopTradersExecutable, selectEvidenceProbes } from "../../scripts/factory/evidence-lane.mjs";
import { countTargetMarkets, evalBundleArgsForBootstrap, executionCanariesNeedReseed, executionCanaryHealth, mergedCanaryExclusions, mirrorTargetMarketSelectionArtifacts, readinessComponent, writeReadinessPercent } from "../../scripts/factory/evidence-bootstrap.mjs";
import { evidenceLoopArgsForSupervisor, evidenceLoopHealth, executionCanarySupervisorHealth, headlessSupervisorOk } from "../../scripts/dogeedge-evidence-supervisor.mjs";
import { canarySelectionStatus, shouldRestartChrome } from "../../scripts/dogeedge-headless-app.mjs";
import { runEvidencePreflight } from "../../scripts/factory/evidence-preflight.mjs";
import { fetchKalshiHistoricalSettlements } from "../../scripts/factory/provider-kalshi.mjs";
import { selectTargetMarkets } from "../../scripts/factory/target-markets.mjs";
import { officialSettlementJoinArtifacts } from "../../scripts/export-eval-snapshot.mjs";
import {
  decodeServerWebSocketFrames,
  encodeClientWebSocketFrame,
  kalshiReplaySubscription,
  normalizeKalshiWsReplayMessage,
} from "../../scripts/factory/kalshi-ws-replay.mjs";
import { loadKalshiWsCredentials, redactedCredentialReport } from "../../scripts/factory/kalshi-ws-auth.mjs";
import { reconstructOrderBook } from "../../scripts/factory/orderbook-state.mjs";
import { shouldCaptureReplayEvent } from "../../scripts/factory/capture-replay.mjs";
import {
  hasResearchPromotionCandidate,
  researchEvidenceCanMature,
  researchEvidenceClassLabel,
  researchEvidenceDefaultRankScore,
  researchEvidenceSortScore,
  researchPromotionGate,
} from "./research-ranking";
import { familyResearchSupported } from "./family-registry";

const baseFrame = {
  id: "frame-1",
  capturedAt: "2026-06-01T00:00:00.000Z",
  observedAt: "2026-06-01T00:00:00.000Z",
  marketLive: true,
  marketTicker: "KXDOGE15M-01",
  marketCloseTime: "2026-06-01T00:00:30.000Z",
  targetPrice: 0.25,
  estimate: 0.251,
  spotPrice: 0.251,
  oneMinuteChange: 0.0001,
  distanceFromTarget: 0.001,
  secondsToClose: 30,
  fairProbability: 0.7,
  modelAction: "buy_yes",
  modelConfidence: 90,
  modelEdgeAfterFees: 0.2,
  modelSizeContracts: 4,
  yesAsk: 0.4,
  yesBid: 0.39,
  noAsk: 0.62,
  noBid: 0.61,
  yesTopDepth: { bidSize: 20, askSize: 20 },
  noTopDepth: { bidSize: 20, askSize: 20 },
};

function writeSweepRun(sweepsDir: string, runId: string, config: Record<string, unknown>, metrics: unknown[]) {
  const runDir = path.join(sweepsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "config.json"), `${JSON.stringify({ runId, ...config })}\n`);
  writeFileSync(path.join(runDir, "candidates.json"), "[]\n");
  writeFileSync(path.join(runDir, "metrics.json"), `${JSON.stringify(metrics)}\n`);
}

function responseJson(payload: unknown, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => payload,
    headers: { get: () => null },
  };
}

const alwaysYesAlgo = {
  id: "always-yes",
  name: "Always YES",
  family: "test",
  params: { one: 1 },
  signal: () => ({
    side: "YES",
    edgeAfterFees: 0.2,
    confidence: 90,
    contracts: 4,
    fairProbability: 0.7,
    reason: "test signal",
  }),
};

describe("factory research safeguards", () => {
  it("fails closed when a decision frame carries future outcome fields", () => {
    const result = normalizeDecisionFrame({ ...baseFrame, winningSide: "YES" });

    expect(result.frame).toBeNull();
    expect(result.errors.join(" ")).toContain("future/outcome");
  });

  it("fails closed on post-close feature frames unless explicitly allowed", () => {
    const result = normalizeDecisionFrame({
      ...baseFrame,
      marketLive: false,
      observedAt: "2026-06-01T00:01:00.000Z",
      capturedAt: "2026-06-01T00:01:00.000Z",
      marketCloseTime: "2026-06-01T00:00:00.000Z",
      secondsToClose: 0,
    });

    expect(result.frame).toBeNull();
    expect(result.errors.join(" ")).toContain("strictly before");

    const allowed = normalizeDecisionFrame({
      ...baseFrame,
      marketLive: false,
      observedAt: "2026-06-01T00:01:00.000Z",
      capturedAt: "2026-06-01T00:01:00.000Z",
      marketCloseTime: "2026-06-01T00:00:00.000Z",
      secondsToClose: 0,
    }, { allowPostCloseFrames: true });
    expect(allowed.frame).not.toBeNull();
  });

  it("excludes post-close feature rows during decision-frame ingestion", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dogeedge-postclose-ingest-"));
    writeFileSync(path.join(dir, "records.jsonl"), [
      JSON.stringify(baseFrame),
      JSON.stringify({
        ...baseFrame,
        id: "post-close",
        marketLive: false,
        observedAt: "2026-06-01T00:01:00.000Z",
        capturedAt: "2026-06-01T00:01:00.000Z",
        marketCloseTime: "2026-06-01T00:00:30.000Z",
      }),
    ].join("\n"));

    const result = await readFactoryDecisionFrames(dir);

    expect(result.frameCount).toBe(1);
    expect(result.frameCountRaw).toBe(2);
    expect(result.excludedFrameCount).toBe(1);
    expect(result.postCloseExcludedCount).toBe(1);
    expect(result.frames.some((frame) => frame.id === "post-close")).toBe(false);
    expect(result.warningCount ?? result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.map((warning) => warning.message).join(" ")).toContain("row excluded");
  });

  it("deduplicates exact and near-identical overlapping frames", () => {
    const first = normalizeDecisionFrame(baseFrame).frame;
    const duplicate = normalizeDecisionFrame({ ...baseFrame, id: "frame-2" }).frame;
    const overlap = normalizeDecisionFrame({ ...baseFrame, id: "frame-3", observedAt: "2026-06-01T00:00:02.000Z", capturedAt: "2026-06-01T00:00:02.000Z" }).frame;

    const result = deduplicateDecisionFrames([first, duplicate, overlap]);

    expect(result.frames).toHaveLength(1);
    expect(result.duplicateFrameCount).toBe(1);
    expect(result.overlappingFrameCount).toBe(1);
  });

  it("purges train events whose label windows overlap validation and applies embargo", () => {
    const events = [
      event("a", "2026-06-01T00:00:00.000Z", "2026-06-01T00:15:00.000Z"),
      event("b", "2026-06-01T00:10:00.000Z", "2026-06-01T00:25:00.000Z"),
      event("c", "2026-06-01T00:30:00.000Z", "2026-06-01T00:45:00.000Z"),
      event("d", "2026-06-01T01:30:00.000Z", "2026-06-01T01:45:00.000Z"),
    ];

    const folds = purgedEmbargoFolds(events, { foldCount: 2, embargoMs: 20 * 60_000 });
    const firstFold = folds[0];

    expect(firstFold.validationEventIds).toContain("a");
    expect(firstFold.validationEventIds).toContain("b");
    expect(firstFold.embargoedEventIds).toContain("c");
    expect(firstFold.trainEventIds).toContain("d");
  });

  it("higher execution costs reduce apparent edge", () => {
    const events = marketEvents();

    const base = simulateAlgoEvents(alwaysYesAlgo, events, { costModel: costModel("base", 0, 1), seed: "base" });
    const stress = simulateAlgoEvents(alwaysYesAlgo, events, { costModel: costModel("stress", 4, 1), seed: "stress" });
    const baseMetric = metricsForAlgo(alwaysYesAlgo, base.trades);
    const stressMetric = metricsForAlgo(alwaysYesAlgo, stress.trades);

    expect(baseMetric.totalPnl).toBeGreaterThan(stressMetric.totalPnl);
    expect(stress.trades[0]?.entryContext.slippageCents).toBeGreaterThan(0);
    expect(stressMetric.averageSlippageCents).toBeGreaterThan(0);
    expect(stressMetric.executionTelemetry.queueResults.filled).toBeGreaterThan(0);
  });

  it("rejects a one-lucky-trade candidate as insufficient data", () => {
    const frames = marketEvents().flatMap((marketEvent) => marketEvent.frames);
    const loadResult = {
      frames,
      warnings: [],
      errors: [],
      frameCountRaw: frames.length,
      frameCount: frames.length,
      duplicateFrameCount: 0,
      overlappingFrameCount: 0,
      eventCount: 1,
    };

    const result = runFactoryResearchPipeline({ algos: [alwaysYesAlgo], loadResult, options: { foldCount: 2, bootstrapIterations: 100 } });

    expect(result.candidates).toHaveLength(0);
    expect(result.metrics[0].promotionVerdict).toBe("insufficient_data");
    expect(result.metrics[0].nonPromotable).toBe(true);
    expect(result.metrics[0].sampleSufficiency.ok).toBe(false);
  });

  it("can run a bounded trade export without retaining closed trade rows in ranked metrics", () => {
    const loadResult = pipelineLoadResult(20);
    const algos = Array.from({ length: 4 }, (_, index) => ({
      ...alwaysYesAlgo,
      id: `memory-safe-${index}`,
      name: `Memory Safe ${index}`,
    }));

    const result = runFactoryResearchPipeline({
      algos,
      loadResult,
      options: {
        foldCount: 2,
        bootstrapIterations: 100,
        maxExportTrades: 5,
        retainClosedTradesForRanking: false,
        thresholds: {
          minResearchEvents: 10,
          minHoldoutEvents: 2,
          minHoldoutClosed: 1,
          minHoldoutMarkets: 1,
          minClosedTrades: 1,
          minWalkForwardClosed: 1,
        },
      },
    });

    expect(result.tradeExport).toMatchObject({
      mode: "bounded",
      maxRows: 5,
      exportedRows: 5,
      truncated: true,
    });
    expect(result.tradeExport.totalRows).toBeGreaterThan(5);
    expect(result.trades).toHaveLength(5);
    expect(result.metrics[0].closedTrades).toBeUndefined();
    expect(result.metrics[0].concentration.maxMarketShare).toEqual(expect.any(Number));
    expect(result.metrics[0].familyAdjustedPValue).toEqual(expect.any(Number));
  });

  it("hard-fails research samples below event, holdout, or fold thresholds", () => {
    const events = Array.from({ length: 8 }, (_, index) => event(
      `tiny-${index}`,
      `2026-06-01T00:${String(index).padStart(2, "0")}:00.000Z`,
      `2026-06-01T00:${String(index + 1).padStart(2, "0")}:00.000Z`,
    ));
    const split = finalHoldoutSplit(events, { minHoldoutEvents: 12 });
    const sufficiency = sampleSufficiency({ events, holdoutSplit: split, folds: [], thresholds: { minResearchEvents: 60, minHoldoutEvents: 12 } });

    expect(sufficiency.ok).toBe(false);
    expect(sufficiency.reasonCodes).toEqual(expect.arrayContaining(["insufficient_research_events", "insufficient_holdout_events"]));
  });

  it("does not improve adjusted confidence mechanically as the tested menu grows", () => {
    const metric = robustMetric("algo-0");
    const one = rankFactoryMetrics([metric])[0];
    const many = rankFactoryMetrics(Array.from({ length: 50 }, (_, index) => robustMetric(`algo-${index}`))).find((item) => item.algoId === "algo-0");

    expect(many?.adjustedConfidence).toBeLessThanOrEqual(one.adjustedConfidence);
  });

  it("computes q-values and correlated effective trial counts deterministically", () => {
    const metrics = Array.from({ length: 5 }, (_, index) => ({
      ...robustMetric(`q-${index}`),
      closedTrades: Array.from({ length: 10 }, (_, tradeIndex) => ({
        marketTicker: `m-${tradeIndex}`,
        pnl: index === 0 ? 0.1 : tradeIndex % 2 ? 0.01 : -0.01,
      })),
    }));
    const qValues = qValueMap(metrics.map((metric, index) => [metric.algoId, 0.01 + index * 0.05]), { method: "BY" });
    const first = effectiveTrialCount(metrics);
    const second = effectiveTrialCount(metrics);

    expect(qValues["q-0"]).toBeLessThanOrEqual(qValues["q-4"]);
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(metrics.length);
  });

  it("keeps statistical adjustments deterministic for the same root seed", () => {
    const metrics = Array.from({ length: 6 }, (_, index) => robustMetric(`seeded-${index}`));
    const first = rankFactoryMetrics(metrics, { seed: "same-seed", bootstrapIterations: 120 });
    const second = rankFactoryMetrics(metrics, { seed: "same-seed", bootstrapIterations: 120 });

    expect(first.map((row) => [row.algoId, row.dsrApprox, row.pboApprox, row.familyAdjustedPValue, row.globalAdjustedPValue]))
      .toEqual(second.map((row) => [row.algoId, row.dsrApprox, row.pboApprox, row.familyAdjustedPValue, row.globalAdjustedPValue]));
  });

  it("requires paper evidence before tiny-live eligibility", () => {
    const review = promotionReview(robustMetric("paper-needed"), {
      minResearchMarkets: 1,
      preferredPaperMarkets: 2,
      minDays: 1,
      minPositiveFoldRate: 0.5,
      minConservativeTotalPnl: 0,
      minExpectancyLowerBound: -1,
      maxDrawdown: -100,
      maxConcentrationShare: 1,
      minAdjustedConfidence: 0,
      minClosedTrades: 1,
    });

    expect(review.promotionVerdict).toBe("paper_only");
    expect(review.reasonCodes).toContain("paper_evidence_required");
  });

  it("blocks tiny-live eligibility when settlement or label evidence is still estimated", () => {
    const metric = {
      ...robustMetric("estimated-settlement"),
      paperEvidence: { available: true, status: "matched", closedMarkets: 120, closedTrades: 120, totalPnl: 5, roi: 0.1, driftOk: true, driftReasons: [], driftScore: 0 },
      labelSource: "pre_close_frame_proxy",
      settlementSource: "estimated",
      officialResolutionAvailable: false,
      officialSettlementCoverage: 0,
    };
    const review = promotionReview(metric, permissivePromotionThresholds());

    expect(review.promotionVerdict).toBe("paper_only");
    expect(review.promotionStage).toBe("validation_candidate");
    expect(review.reasonCodes).toEqual(expect.arrayContaining(["official_label_required", "official_settlement_required"]));
    expect(review.reasonCodes).not.toContain("manual_approval_required");
  });

  it("allows tiny-live review only when official settlement and paper drift gates pass", () => {
    const metric = {
      ...robustMetric("official-settlement"),
      paperEvidence: { available: true, status: "matched", closedMarkets: 120, closedTrades: 120, totalPnl: 5, roi: 0.1, driftOk: true, driftReasons: [], driftScore: 0 },
      labelSource: "official_resolution",
      settlementSource: "official_resolution",
      officialResolutionAvailable: true,
      officialSettlementCoverage: 1,
    };
    const review = promotionReview(metric, permissivePromotionThresholds());

    expect(review.promotionVerdict).toBe("tiny_live_eligible");
    expect(review.reasonCodes).toContain("manual_approval_required");
  });

  it("caps deep sweeps when independent events or official settlement coverage are too low", () => {
    const limited = searchBudgetDecision({
      eventCount: 80,
      officialSettlementCoverage: 0,
      requestedSweepAlgos: 6045,
      sweepMode: true,
      deepSweepMode: true,
    });
    const open = searchBudgetDecision({
      eventCount: 400,
      officialSettlementCoverage: 0.98,
      requestedSweepAlgos: 500,
      sweepMode: true,
      deepSweepMode: true,
    });

    expect(limited.limited).toBe(true);
    expect(limited.deepSweepAllowed).toBe(false);
    expect(limited.maxGeneratedAlgos).toBeLessThan(6045);
    expect(limited.executableMintingAllowed).toBe(false);
    expect(limited.labResearchAllowed).toBe(true);
    expect(limited.reasonCodes).toEqual(expect.arrayContaining(["search_budget_limited_by_sample_size", "deep_sweep_blocked_low_official_coverage"]));
    expect(open.limited).toBe(false);
    expect(open.deepSweepAllowed).toBe(true);
    expect(open.executableMintingAllowed).toBe(true);
  });

  it("keeps low-evidence executable minting at zero and allows only tiny lab research", () => {
    const requested = [
      ...Array.from({ length: 300 }, (_, index) => ({ id: `model-${index}`, family: "sweep-model" })),
      ...Array.from({ length: 80 }, (_, index) => ({ id: `scalp-${index}`, family: "sweep-scalp" })),
      ...Array.from({ length: 80 }, (_, index) => ({ id: `liq-${index}`, family: "sweep-liquidity-imbalance" })),
      ...Array.from({ length: 80 }, (_, index) => ({ id: `trail-${index}`, family: "sweep-momentum-trail" })),
    ];
    const decision = searchBudgetDecision({
      eventCount: 80,
      officialSettlementCoverage: 0,
      requestedSweepAlgos: requested.length,
      sweepMode: true,
      deepSweepMode: true,
    });
    const budgeted = applyFamilySearchBudget(requested, decision);
    const selectedFamilies = new Set(budgeted.algos.map((algo) => algo.family));

    expect(budgeted.algos.length).toBeLessThanOrEqual(decision.maxGeneratedAlgos);
    expect(budgeted.algos).toHaveLength(25);
    expect(selectedFamilies.has("sweep-scalp")).toBe(false);
    expect(selectedFamilies.has("sweep-liquidity-imbalance")).toBe(false);
    expect(selectedFamilies.has("sweep-model")).toBe(true);
    expect(selectedFamilies.has("sweep-momentum-trail")).toBe(false);
    expect(budgeted.summary.unsupportedMintingCount).toBe(0);
    expect(budgeted.familyBudget).toMatchObject({
      executableMintingAllowed: false,
      labResearchAllowed: true,
    });
    expect(budgeted.familyBudget.families.find((row) => row.family === "sweep-model")).toMatchObject({
      researchSupported: true,
      labOnly: true,
      selected: 25,
      budgetLane: "research_only_family",
      budgetBucket: "lab_only_research",
      action: "tiny_lab_research",
    });
    expect(budgeted.familyBudget.families.find((row) => row.family === "sweep-scalp")).toMatchObject({
      researchSupported: true,
      selected: 0,
      action: "supported_budget_waiting",
    });
    expect(budgeted.familyBudget.families.find((row) => row.family === "sweep-momentum-trail")).toMatchObject({
      researchSupported: false,
      selected: 0,
      action: "freeze_new_minting",
    });
  });

  it("caps promote-check as a diversified supported-family diagnostic without lab or unsupported minting", () => {
    const requested = [
      ...Array.from({ length: 120 }, (_, index) => ({ id: `model-${index}`, family: "sweep-model" })),
      ...Array.from({ length: 80 }, (_, index) => ({ id: `scalp-${index}`, family: "sweep-scalp" })),
      ...Array.from({ length: 80 }, (_, index) => ({ id: `liq-${index}`, family: "sweep-liquidity-imbalance" })),
      ...Array.from({ length: 80 }, (_, index) => ({ id: `trail-${index}`, family: "sweep-momentum-trail" })),
    ];
    const openDecision = searchBudgetDecision({
      eventCount: 400,
      officialSettlementCoverage: 0.98,
      requestedSweepAlgos: requested.length,
      sweepMode: true,
      deepSweepMode: false,
    });
    const decision = applyPromoteCheckDiagnosticCap(openDecision, {
      promoteCheckMode: true,
      maxSweepAlgos: 60,
    });
    const budgeted = applyFamilySearchBudget(requested, decision);
    const selectedFamilies = new Set(budgeted.algos.map((algo) => algo.family));

    expect(decision.limited).toBe(true);
    expect(decision.reasonCodes).toContain("promote_check_diagnostic_cap");
    expect(decision.executableMintingAllowed).toBe(true);
    expect(decision.labResearchAllowed).toBe(false);
    expect(decision.promoteCheckDiagnosticCap).toMatchObject({
      applied: true,
      maxGeneratedAlgos: 60,
    });
    expect(budgeted.algos).toHaveLength(60);
    expect(selectedFamilies.has("sweep-scalp")).toBe(true);
    expect(selectedFamilies.has("sweep-liquidity-imbalance")).toBe(true);
    expect(selectedFamilies.has("sweep-model")).toBe(false);
    expect(selectedFamilies.has("sweep-momentum-trail")).toBe(false);
    expect(budgeted.summary.unsupportedMintingCount).toBe(0);
  });

  it("counts family overlap when supported live-family adapters are in the research set", () => {
    const alignment = researchLiveAlignment({
      researchMetrics: [
        { algoId: "research-scalp-1", family: "sweep-scalp" },
        { algoId: "research-liquidity-1", family: "sweep-liquidity-imbalance" },
      ],
      liveStats: {
        "live-scalp-1": { sourceAlgoId: "live-scalp-1", family: "sweep-scalp" },
        "live-trail-1": { sourceAlgoId: "live-trail-1", family: "sweep-momentum-trail" },
      },
    });

    expect(alignment.overlapByFamilyCount).toBe(1);
    expect(alignment.supportedLiveAlgoCount).toBe(1);
    expect(alignment.unsupportedLiveAlgoCount).toBe(1);
    expect(alignment.supportedLiveFamilies).toEqual([{ family: "sweep-scalp", count: 1 }]);
  });

  it("derives stable exact candidate identity from canonical strategy material", () => {
    const metric = {
      algoId: "sweep-scalp-s200-f60-e0-best-strict",
      family: "sweep-scalp",
      params: { maxSpread: 0.02, feeBuffer: 0.006, sideMode: "best" },
      labelSource: "pre_close_frame_proxy",
      settlementSource: "estimated",
    };
    const context = {
      seed: "dogeedge-test",
      sourceRunId: "run-a",
      configHash: "config-a",
      costModelHash: "cost-a",
      riskModelHash: "risk-a",
    };
    const left = researchCandidateIdentity(metric, context);
    const right = researchCandidateIdentity({ ...metric, params: { sideMode: "best", feeBuffer: 0.006, maxSpread: 0.02 } }, context);
    const changed = researchCandidateIdentity({ ...metric, params: { ...metric.params, feeBuffer: 0.01 } }, context);

    expect(left.researchCandidateId).toMatch(/^rcid-[a-f0-9]{24}$/);
    expect(left.candidateConfigHash).toHaveLength(64);
    expect(left).toMatchObject(right);
    expect(changed.researchCandidateId).not.toBe(left.researchCandidateId);
  });

  it("ranks research evidence ahead of dry-run-only appearance", () => {
    const researchValidated = {
      promotionVerdict: "paper_only",
      promotionStage: "validation_candidate",
      labelSource: "official_resolution",
      settlementSource: "official_resolution",
      officialResolutionAvailable: true,
      officialSettlementCoverage: 1,
      holdoutPass: true,
      holdoutStrictlyLater: true,
      adjustedConfidence: 0.8,
      dsrApprox: 0.75,
      pboApprox: 0.1,
      robustScore: 15,
      conservativeTotalPnl: 3,
      stressTotalPnl: 1,
      paperEvidence: { available: true, driftOk: true, closedMarkets: 30 },
    };
    const dryRunOnly = {
      promotionVerdict: "insufficient_data",
      promotionStage: "research_candidate",
      nonPromotable: true,
      labelSource: "pre_close_frame_proxy",
      settlementSource: "estimated",
      officialSettlementCoverage: 0,
      holdoutPass: false,
      adjustedConfidence: 0.1,
      dsrApprox: 0.1,
      pboApprox: 0.9,
      robustScore: 100,
      conservativeTotalPnl: 25,
      stressTotalPnl: 10,
    };

    expect(researchEvidenceCanMature(researchValidated)).toBe(true);
    expect(researchEvidenceCanMature(dryRunOnly)).toBe(false);
    expect(researchEvidenceSortScore(researchValidated)).toBeGreaterThan(researchEvidenceSortScore(dryRunOnly));
  });

  it("keeps unsupported negative dry-run rows below supported non-negative research rows by default", () => {
    const supportedEvidence = strictResearchEvidence("supported-row");
    const unsupportedEvidence = {
      ...strictResearchEvidence("unsupported-row"),
      robustScore: 1_000,
      holdoutLowerCi: 1,
    };

    expect(familyResearchSupported("sweep-model")).toBe(true);
    expect(familyResearchSupported("sweep-scalp")).toBe(true);
    expect(familyResearchSupported("sweep-momentum-trail")).toBe(false);
    expect(researchEvidenceDefaultRankScore({
      evidence: supportedEvidence,
      researchSupported: familyResearchSupported("sweep-model"),
      executableTotalPnl: 5,
      executablePnlPerCycle: 0.5,
    })).toBeGreaterThan(researchEvidenceDefaultRankScore({
      evidence: unsupportedEvidence,
      researchSupported: familyResearchSupported("sweep-momentum-trail"),
      executableTotalPnl: -500,
      executablePnlPerCycle: -10,
    }));
  });

  it("does not let reject or insufficient-data verdicts earn default-rank lift", () => {
    const valid = strictResearchEvidence("valid-row");
    const rejected = {
      ...strictResearchEvidence("reject-row"),
      promotionVerdict: "reject",
      nonPromotable: true,
      robustScore: 10_000,
    };
    const insufficient = {
      ...strictResearchEvidence("insufficient-row"),
      promotionVerdict: "insufficient_data",
      nonPromotable: true,
      robustScore: 10_000,
    };
    const validScore = researchEvidenceDefaultRankScore({
      evidence: valid,
      researchSupported: true,
      executableTotalPnl: 1,
      executablePnlPerCycle: 0.1,
    });

    expect(validScore).toBeGreaterThan(researchEvidenceDefaultRankScore({
      evidence: rejected,
      researchSupported: true,
      executableTotalPnl: 10_000,
      executablePnlPerCycle: 100,
    }));
    expect(validScore).toBeGreaterThan(researchEvidenceDefaultRankScore({
      evidence: insufficient,
      researchSupported: true,
      executableTotalPnl: 10_000,
      executablePnlPerCycle: 100,
    }));
  });

  it("uses one strict research gate before arena automation can treat a row as valid", () => {
    const valid = strictResearchEvidence("valid-gate");
    const dryRunOnly = {
      ...valid,
      promotionVerdict: "insufficient_data",
      nonPromotable: true,
      labelSource: "pre_close_frame_proxy",
      settlementSource: "estimated",
      officialResolutionAvailable: false,
      officialSettlementCoverage: 0,
      holdoutPass: false,
      adjustedConfidence: 0.2,
      dsrApprox: 0.2,
      pboApprox: 0.9,
    };

    expect(researchPromotionGate(valid)).toMatchObject({ ok: true, classification: "research_validated" });
    expect(researchEvidenceClassLabel(valid)).toBe("Research validated");
    expect(hasResearchPromotionCandidate([dryRunOnly])).toBe(false);
    expect(hasResearchPromotionCandidate([dryRunOnly, valid])).toBe(true);

    const blocked = researchPromotionGate(dryRunOnly);
    expect(blocked.ok).toBe(false);
    expect(blocked.reasonCodes).toEqual(expect.arrayContaining([
      "insufficient_data",
      "official_label_required",
      "official_settlement_required",
      "holdout_failed",
      "pbo_approx_high",
    ]));
    expect(researchEvidenceClassLabel(dryRunOnly)).toBe("Insufficient data");
  });

  it("keeps final holdout events strictly later than research windows", () => {
    const events = Array.from({ length: 10 }, (_, index) => event(
      `m-${index}`,
      `2026-06-01T${String(index).padStart(2, "0")}:00:00.000Z`,
      `2026-06-01T${String(index).padStart(2, "0")}:15:00.000Z`,
    ));

    const split = finalHoldoutSplit(events, { holdoutRatio: 0.2, minHoldoutEvents: 2 });
    const latestResearchEnd = Math.max(...split.researchEvents.map((item) => item.labelWindowEndMs));
    const earliestHoldoutStart = Math.min(...split.holdoutEvents.map((item) => item.labelWindowStartMs));

    expect(split.holdoutEvents).toHaveLength(2);
    expect(split.strictlyLater).toBe(true);
    expect(earliestHoldoutStart).toBeGreaterThanOrEqual(latestResearchEnd);
  });

  it("blocks promotion above research candidate when final holdout fails", () => {
    const metric = robustMetric("holdout-fails");
    const review = promotionReview({
      ...metric,
      holdoutPass: false,
      holdoutSummary: {
        ...metric.holdoutSummary,
        holdoutPass: false,
        holdoutConservativeTotalPnl: -1,
        holdoutLowerCi: -0.1,
      },
    }, permissivePromotionThresholds());

    expect(review.promotionStage).toBe("research_candidate");
    expect(review.nonPromotable).toBe(true);
    expect(review.reasonCodes).toContain("holdout_failed");
  });

  it("treats walk-forward failure as a hard promotion veto", () => {
    const review = promotionReview({
      ...robustMetric("walk-fails"),
      walkForwardPass: false,
      walkForwardClosed: 20,
      walkForwardTotalPnl: -0.5,
    }, permissivePromotionThresholds());

    expect(review.promotionStage).toBe("research_candidate");
    expect(review.reasonCodes).toContain("walk_forward_failed");
  });

  it("lets CPCV evidence affect ranking order", () => {
    const weak = {
      ...robustMetric("weak-cpcv"),
      totalPnl: 10,
      cpcvSummary: { positiveFoldRate: 0.1, medianFoldPnl: -2 },
      cpcvTrainMetrics: [{ foldId: "cpcv-1", closed: 10, totalPnl: 8, roi: 0.5 }],
      cpcvMetrics: [{ foldId: "cpcv-1", closed: 10, totalPnl: -2, roi: -0.1 }],
    };
    const strong = {
      ...robustMetric("strong-cpcv"),
      totalPnl: 10,
      cpcvSummary: { positiveFoldRate: 1, medianFoldPnl: 2 },
      cpcvTrainMetrics: [{ foldId: "cpcv-1", closed: 10, totalPnl: 4, roi: 0.2 }],
      cpcvMetrics: [{ foldId: "cpcv-1", closed: 10, totalPnl: 3, roi: 0.15 }],
    };

    const ranked = rankFactoryMetrics([weak, strong], { bootstrapIterations: 100 });

    expect(ranked[0].algoId).toBe("strong-cpcv");
    expect(ranked[0].pboPathSummary.pathCount).toBeGreaterThan(0);
  });

  it("flags train-vs-validation rank degradation in the PBO approximation", () => {
    const overfit = {
      ...robustMetric("overfit"),
      cpcvTrainMetrics: [
        { foldId: "cpcv-1", closed: 20, totalPnl: 10, roi: 0.5 },
        { foldId: "cpcv-2", closed: 20, totalPnl: 9, roi: 0.45 },
      ],
      cpcvMetrics: [
        { foldId: "cpcv-1", closed: 20, totalPnl: -2, roi: -0.1 },
        { foldId: "cpcv-2", closed: 20, totalPnl: -1, roi: -0.05 },
      ],
    };
    const stable = {
      ...robustMetric("stable"),
      cpcvTrainMetrics: [
        { foldId: "cpcv-1", closed: 20, totalPnl: 4, roi: 0.2 },
        { foldId: "cpcv-2", closed: 20, totalPnl: 4, roi: 0.2 },
      ],
      cpcvMetrics: [
        { foldId: "cpcv-1", closed: 20, totalPnl: 3, roi: 0.15 },
        { foldId: "cpcv-2", closed: 20, totalPnl: 3, roi: 0.15 },
      ],
    };

    expect(pboRankDegradationApprox(overfit, [overfit, stable])).toBeGreaterThan(pboRankDegradationApprox(stable, [overfit, stable]));
  });

  it("detects paper/live-paper drift in pnl, regime, or fill quality", () => {
    const stable = detectEvidenceDrift({
      paperTrades: Array.from({ length: 10 }, () => ({ pnl: 0.02 })),
      validationRegimes: { final_60s: 1 },
      paperRegimes: { final_60s: 1 },
      validationFill: { fillRate: 0.9, avgSlippage: 0.01 },
      paperFill: { fillRate: 0.88, avgSlippage: 0.01 },
    });
    const drifted = detectEvidenceDrift({
      paperTrades: Array.from({ length: 25 }, () => ({ pnl: -0.2 })),
      validationRegimes: { final_60s: 1 },
      paperRegimes: { early: 1 },
      validationFill: { fillRate: 0.95, avgSlippage: 0.01 },
      paperFill: { fillRate: 0.2, avgSlippage: 0.08 },
    });

    expect(stable.driftOk).toBe(true);
    expect(drifted.driftOk).toBe(false);
    expect(drifted.driftReasons).toEqual(expect.arrayContaining(["regime_share_drift", "fill_quality_drift"]));
  });

  it("keeps drift warning-only when paper sample is too small", () => {
    const drift = detectEvidenceDrift({
      paperTrades: [{ pnl: -10 }],
      validationRegimes: { final_60s: 1 },
      paperRegimes: { early: 1 },
      validationFill: { fillRate: 1, avgSlippage: 0 },
      paperFill: { fillRate: 0, avgSlippage: 1 },
      thresholds: { minPaperTradesForDecision: 20 },
    });

    expect(drift.driftOk).toBe(true);
    expect(drift.sampleStatus).toBe("insufficient_paper_sample_warning_only");
    expect(drift.warnings).toContain("insufficient_paper_sample_for_drift_decision");
  });

  it("uses state-conditional fill probability and depth share", () => {
    const good = normalizeDecisionFrame({
      ...baseFrame,
      capturedAt: "2026-06-01T00:00:00.100Z",
      yesAsk: 0.4,
      yesBid: 0.39,
      yesTopDepth: { bidSize: 100, askSize: 100 },
      secondsToClose: 300,
    }).frame;
    const bad = normalizeDecisionFrame({
      ...baseFrame,
      capturedAt: "2026-06-01T00:00:04.000Z",
      yesAsk: 0.5,
      yesBid: 0.4,
      yesTopDepth: { bidSize: 2, askSize: 2 },
      secondsToClose: 20,
    }).frame;
    const model = costModel("conditional", 1, 0.9);

    expect(stateFillProbability(bad, "YES", "entry", model)).toBeLessThan(stateFillProbability(good, "YES", "entry", model));
    expect(stateDepthShare(bad, "YES", "entry", model)).toBeLessThan(stateDepthShare(good, "YES", "entry", model));
  });

  it("hashes exact decision-frame files and changes when bytes change", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dogeedge-repro-"));
    const file = path.join(dir, "frames.jsonl");
    writeFileSync(file, `${JSON.stringify(baseFrame)}\n`);
    const first = await decisionFrameInputManifest(dir);

    writeFileSync(file, `${JSON.stringify({ ...baseFrame, id: "changed" })}\n`);
    const second = await decisionFrameInputManifest(dir);

    expect(first.files).toHaveLength(1);
    expect(first.files[0].sha256).not.toBe(second.files[0].sha256);
    expect(first.manifestHash).not.toBe(second.manifestHash);
  });

  it("detects replay input manifest mismatches exactly", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dogeedge-replay-manifest-"));
    const file = path.join(dir, "frames.jsonl");
    writeFileSync(file, `${JSON.stringify(baseFrame)}\n`);
    const saved = await decisionFrameInputManifest(dir);

    writeFileSync(file, `${JSON.stringify({ ...baseFrame, id: "changed" })}\n`);
    const current = await decisionFrameInputManifest(dir);
    const check = compareInputManifest({ inputManifestHash: saved.manifestHash, inputFiles: saved.files }, current);

    expect(check.matches).toBe(false);
    expect(check.reasonCodes).toEqual(expect.arrayContaining(["input_manifest_hash_changed", "input_file_changed:frames.jsonl"]));
  });

  it("matches real paper evidence back to generated factory algo ids", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dogeedge-paper-evidence-"));
    writeFileSync(path.join(dir, "paper-trades.jsonl"), `${JSON.stringify({
      id: "paper-1",
      strategyId: "generated:always-yes:1780000000000",
      marketTicker: "KXDOGE15M-PAPER",
      side: "YES",
      contracts: 2,
      entryPrice: 0.4,
      exitPrice: 0.46,
      openedAt: "2026-06-02T00:00:00.000Z",
      closedAt: "2026-06-02T00:01:00.000Z",
      status: "closed",
      pnl: 0.12,
      feesPaid: 0,
      entryContext: { secondsToClose: 45 },
    })}\n`);

    const evidence = await readPaperEvidence({ storageDir: dir });
    const summary = paperEvidenceForAlgo("always-yes", evidence, {
      validationTrades: [{ pnl: 0.12 }],
      validationRegimes: { final_60s: 1 },
      validationFill: { fillRate: 1, avgSlippage: 0 },
    });

    expect(evidence.byAlgoId["always-yes"]).toHaveLength(1);
    expect(summary.available).toBe(true);
    expect(summary.closedMarkets).toBe(1);
    expect(summary.totalPnl).toBe(0.12);
  });

  it("uses exact-linked Top Traders executable positions as diagnostic paper evidence", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dogeedge-executable-paper-evidence-"));
    writeFileSync(path.join(dir, "paper-trades.jsonl"), "");
    writeFileSync(path.join(dir, "top-traders-executable.json"), `${JSON.stringify({
      storedAt: "2026-06-20T00:00:00.000Z",
      topTradersExecutable: {
        stats: {
          "sweep-scalp-linked": {
            sourceAlgoId: "sweep-scalp-linked",
            algoId: "generated:sweep-scalp-linked",
            family: "sweep-scalp",
            lane: "exact_linked_execution_canary",
            evidenceStatus: "execution_canary_only",
            paperOnly: true,
            exactLinked: true,
            researchCandidateId: "rcid-linked",
            candidateConfigHash: "hash-linked",
          },
          "legacy-unlinked": {
            sourceAlgoId: "legacy-unlinked",
            algoId: "generated:legacy-unlinked",
            paperOnly: true,
            exactLinked: false,
          },
        },
        positions: [
          {
            id: "linked-position",
            algoId: "generated:sweep-scalp-linked",
            algoSourceId: "sweep-scalp-linked",
            ticker: "KXDOGE15M-LINKED",
            side: "YES",
            contracts: 2,
            entryPrice: 0.4,
            exitPrice: 0.45,
            openedAt: "2026-06-20T00:00:00.000Z",
            closedAt: "2026-06-20T00:00:10.000Z",
            status: "closed",
            realizedPnl: 0.1,
          },
          {
            id: "legacy-position",
            algoId: "generated:legacy-unlinked",
            algoSourceId: "legacy-unlinked",
            ticker: "KXDOGE15M-LEGACY",
            side: "NO",
            contracts: 2,
            entryPrice: 0.4,
            exitPrice: 0.45,
            openedAt: "2026-06-20T00:00:00.000Z",
            closedAt: "2026-06-20T00:00:10.000Z",
            status: "closed",
            realizedPnl: 0.1,
          },
        ],
      },
    })}\n`);

    const evidence = await readPaperEvidence({ storageDir: dir });
    const summary = paperEvidenceForAlgo("sweep-scalp-linked", evidence, {
      validationTrades: [{ pnl: 0.1 }],
      validationRegimes: { unknown: 1 },
      validationFill: { fillRate: 1, avgSlippage: 0 },
    });

    expect(evidence.summary).toMatchObject({
      rawTradeRows: 0,
      executablePositionRows: 1,
      rawEvidenceRows: 1,
      matchedAlgoCount: 1,
    });
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]).toMatchObject({
      sourceAlgoId: "sweep-scalp-linked",
      researchCandidateId: "rcid-linked",
      candidateConfigHash: "hash-linked",
      promotionStage: "evidence_probe_only",
      promotionVerdict: "evidence_probe_only",
    });
    expect(evidence.byAlgoId["sweep-scalp-linked"]).toHaveLength(1);
    expect(evidence.byAlgoId["legacy-unlinked"]).toBeUndefined();
    expect(summary).toMatchObject({
      available: true,
      closedMarkets: 1,
      closedTrades: 1,
      totalPnl: 0.1,
    });
  });

  it("runs validate, replay-run, and promote-check CLI modes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-cli-"));
    const framesDir = path.join(root, "frames");
    const outDir = path.join(root, "backtests");
    const dataRoot = path.join(root, "data");
    const script = path.resolve("scripts/dogeedge-backtest.mjs");
    const common = ["--data-root", dataRoot, "--frames", framesDir, "--out", outDir, "--algo", "final60-lock-v1", "--bootstrap-iterations", "100"];

    const validateOutput = execFileSync(process.execPath, [script, ...common, "--validate", "--run-id", "cli-validate"], { cwd: path.resolve("."), encoding: "utf8" });
    const configPath = path.join(outDir, "runs", "cli-validate", "config.json");
    const replayOutput = execFileSync(process.execPath, [script, ...common, "--replay-run", "--config", configPath, "--run-id", "cli-replay"], { cwd: path.resolve("."), encoding: "utf8" });
    const promoteOutput = execFileSync(process.execPath, [script, ...common, "--sweep", "--promote-check", "--run-id", "cli-promote"], { cwd: path.resolve("."), encoding: "utf8" });
    const validateConfig = JSON.parse(readFileSync(configPath, "utf8"));

    expect(validateOutput).toContain("Validation mode");
    expect(replayOutput).toContain("Replay-run mode");
    expect(promoteOutput).toContain("Promotion check");
    expect(validateConfig.validateMode).toBe(true);
    expect(validateConfig.registry.schemaVersion).toBe("dogeedge.factory.registry.v2");
    expect(validateConfig.registry.costModelHash).toBeTruthy();
    expect(validateConfig.registry.riskModelHash).toBeTruthy();
  });

  it("audits review export packets and writes fold diff artifacts", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-review-export-"));
    const input = path.join(root, "review_exports");
    const out = path.join(root, "artifacts", "factory-audit");
    writeReviewExportFixture(input);

    const audit = await auditReviewExports({ input, outDir: out, foldCount: 2, embargoMs: 60_000, gateReport: true });
    const finalReview = readFileSync(path.join(out, "final-review.md"), "utf8");
    const foldDiff = JSON.parse(readFileSync(path.join(out, "fold-diff.json"), "utf8"));

    expect(audit.verdict).not.toBe("fail_closed");
    expect(audit.gate?.state).toBe("hold_gather_evidence");
    expect(audit.gate?.allowedToLoadArenaBatch).toBe(false);
    expect(finalReview).toContain("Executive Summary");
    expect(finalReview).toContain("Research Gate");
    expect(foldDiff.tables.foldCounts.recomputedPurged).toBeGreaterThan(0);
  });

  it("surfaces bundle row caps and raw tick coverage gaps in final review", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-review-bundle-"));
    const input = path.join(root, "review_exports");
    const out = path.join(root, "artifacts", "factory-audit");
    writeReviewBundleFixture(input);

    const audit = await auditReviewExports({ input, outDir: out, foldCount: 2, embargoMs: 60_000, gateReport: true });
    const finalReview = readFileSync(path.join(out, "final-review.md"), "utf8");

    expect(audit.verdict).not.toBe("fail_closed");
    expect(audit.bundleEvidence).toMatchObject({
      rowExport: {
        mode: "capped",
        rowsCapped: true,
        rowCap: 1000,
        promotionReviewComplete: false,
      },
      rawTicks: {
        available: false,
        availabilityStatus: "target_samples_absent",
        coverage: {
          covered: 0,
          uncovered: 2,
          ratio: 0,
        },
        targetMarketSamples: {
          covered: [],
          uncovered: ["m-0", "m-1"],
          omittedCoveredCount: 0,
          omittedUncoveredCount: 0,
        },
        sourceHash: {
          hashedFileCount: 0,
          skippedLargeFileCount: 1,
          sha256MaxBytes: 50 * 1024 * 1024,
          totalSourceBytes: 60_000_000,
          hashedSourceBytes: 0,
          hashSkippedSourceBytes: 60_000_000,
          hashSkippedByteRatio: 1,
          skippedLargeFileSample: [
            { relativePath: "raw/snapshots/records.jsonl", bytes: 60_000_000, hashSkipped: true },
          ],
          omittedSkippedLargeFileCount: 0,
        },
      },
      limitations: expect.arrayContaining(["rows_capped", "raw_market_tick_target_coverage_gap"]),
    });
    expect(finalReview).toContain("Bundle Evidence");
    expect(finalReview).toContain("Rows: capped at 1000");
    expect(finalReview).toContain("Canonical replay: no replay parity report present.");
    expect(finalReview).toContain("Raw ticks: target_samples_absent");
    expect(finalReview).toContain("Raw diagnostic coverage: 0/2 target markets");
    expect(finalReview).toContain("raw_market_tick_jsonl_absent");
    expect(finalReview).toContain("Uncovered target sample: m-0, m-1");
    expect(finalReview).toContain("skipped bytes: 60000000/60000000 (100%)");
    expect(finalReview).toContain("Hash-skipped source sample: raw/snapshots/records.jsonl (60000000 bytes)");
  });

  it("distinguishes replay-grade parity from raw tick diagnostic sample coverage", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-review-replay-parity-"));
    const input = path.join(root, "review_exports");
    const out = path.join(root, "artifacts", "factory-audit");
    writeReviewBundleFixture(input);
    writeFileSync(path.join(input, "snapshots", "replay_parity_report.json"), `${JSON.stringify({
      schemaVersion: "dogeedge.replay-parity-report.v1",
      snapshotId: "snap-fixture",
      generatedAt: "2026-06-01T00:00:00.000Z",
      targetMarketCount: 1,
      coveredTargetMarketCount: 1,
      uncoveredTargetMarketCount: 0,
      replayGradeTargetMarketCount: 1,
      coverageRate: 1,
      replayGradeTargetMarketCoverage: 1,
      parquetAvailable: false,
      jsonlAvailable: true,
      replayGrade: true,
      sampleParity: true,
      executionSensitivePromotionAllowed: true,
      fallbackKind: "replay_grade",
      sourceSnapshotFileCount: 42,
      sequenceGapCheckAvailable: true,
      failClosed: false,
      reasonCodes: [],
    })}\n`);

    const audit = await auditReviewExports({ input, outDir: out, foldCount: 2, embargoMs: 60_000, gateReport: true });
    const finalReview = readFileSync(path.join(out, "final-review.md"), "utf8");

    expect(audit.bundleEvidence?.replay).toMatchObject({
      reportPresent: true,
      source: "replay_parity_report",
      replayGrade: true,
      executionSensitivePromotionAllowed: true,
      targetMarketCount: 1,
      replayGradeTargetMarketCount: 1,
      replayGradeTargetMarketCoverage: 1,
      sourceSnapshotFileCount: 42,
      sequenceGapCheckAvailable: true,
      reasonCodes: [],
    });
    expect(finalReview).toContain("Canonical replay: replay-grade; 1/1 target markets (100%)");
    expect(finalReview).toContain("Replay diagnostics: source replay_parity_report; fallback replay_grade; sequence-gap check available");
    expect(finalReview).toContain("Raw diagnostic coverage: 0/2 target markets");
  });

  it("audits the latest review bundle when given the review_exports parent", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-review-bundle-parent-"));
    const input = path.join(root, "review_exports");
    const bundle = path.join(input, "bundles", "dogeedge-review-bundle-20260620T030521Z");
    const out = path.join(root, "artifacts", "factory-audit");
    mkdirSync(bundle, { recursive: true });
    writeReviewBundleFixture(bundle);

    const audit = await auditReviewExports({ input, outDir: out, foldCount: 2, embargoMs: 60_000, gateReport: true });
    const finalReview = readFileSync(path.join(out, "final-review.md"), "utf8");

    expect(audit.inputRoot).toBe(path.resolve(bundle));
    expect(audit.requestedInputRoot).toBe(path.resolve(input));
    expect(audit.bundleEvidence).toMatchObject({
      rowExport: {
        mode: "capped",
        rowsCapped: true,
      },
      rawTicks: {
        availabilityStatus: "target_samples_absent",
      },
    });
    expect(finalReview).toContain("Rows: capped at 1000");
    expect(finalReview).not.toContain("No bundle manifest was present");
  });

  it("strict export audit fails closed on post-close decision rows", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-postclose-audit-"));
    const input = path.join(root, "review_exports");
    const out = path.join(root, "artifacts", "factory-audit");
    writeReviewExportFixture(input);
    writeFileSync(path.join(input, "frames", "decision-frames.sample.ndjson"), `${JSON.stringify({
      frame_id: "bad-post-close",
      market_id: "m-post",
      frame_timestamp_utc: "2026-06-01T00:16:00.000Z",
      decision_timestamp: "2026-06-01T00:16:00.000Z",
      feature_timestamp: "2026-06-01T00:15:59.000Z",
      label_timestamp_utc: "2026-06-01T00:15:00.000Z",
      market_close_timestamp_utc: "2026-06-01T00:15:00.000Z",
      settlement_timestamp: "2026-06-01T00:15:00.000Z",
    })}\n`);

    const audit = await auditReviewExports({ input, outDir: out, strict: true });

    expect(audit.verdict).toBe("fail_closed");
    expect(audit.schema.errors).toEqual(expect.arrayContaining(["post_close_decision_rows"]));
  });

  it("reports holdout, CPCV, bootstrap, drift, and approximate metric fields", () => {
    const metric = rankFactoryMetrics([robustMetric("reporting")], { bootstrapIterations: 100 })[0];
    const csv = metricsCsv([metric]);
    const report = markdownReport({
      runId: "report-test",
      startedAt: "2026-06-01T00:00:00.000Z",
      finishedAt: "2026-06-01T00:01:00.000Z",
      dataRoot: "data",
      framesDir: "frames",
      frameCount: 1,
      eventCount: 1,
      algoCount: 1,
      sweepMode: true,
      dataQuality: null,
      metrics: [metric],
      candidates: [metric],
    });

    expect(csv).toContain("holdoutPass");
    expect(csv).toContain("cpcvPositivePathRate");
    expect(csv).toContain("bootstrapMeanLower");
    expect(csv).toContain("driftOk");
    expect(csv).toContain("paperEvidenceStatus");
    expect(csv).toContain("avgSlippageCents");
    expect(csv).toContain("brierScore");
    expect(csv).toContain("expectedCalibrationError");
    expect(csv).toContain("realityCheckApproxPValue");
    expect(csv).toContain("dsrApprox");
    expect(csv).toContain("pboApprox");
    expect(csv).toContain("familyQValue");
    expect(csv).toContain("globalQValue");
    expect(csv).toContain("effectiveTotalTrials");
    expect(csv).toContain("pboPathCount");
    expect(report).toContain("Approximation Notes");
    expect(report).toContain("Simulator Telemetry");
    expect(report).toContain("CPCV Path Degradation");
    expect(Object.prototype.hasOwnProperty.call(metric, "dsrApprox")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(metric, "pboApprox")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(metric, "dsr")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(metric, "pbo")).toBe(false);
  });

  it("does not elevate the best rejected metric as a viable report winner", () => {
    const rejected = {
      ...robustMetric("best-reject"),
      promotionVerdict: "reject",
      nonPromotable: true,
      labelSource: "pre_close_frame_proxy",
      settlementSource: "estimated",
      officialSettlementCoverage: 0,
      reasonCodes: ["official_settlement_required"],
    };

    const report = markdownReport({
      runId: "best-reject-test",
      startedAt: "2026-06-01T00:00:00.000Z",
      finishedAt: "2026-06-01T00:01:00.000Z",
      dataRoot: "data",
      framesDir: "frames",
      frameCount: 1,
      eventCount: 1,
      algoCount: 1,
      sweepMode: true,
      dataQuality: null,
      metrics: [rejected],
      candidates: [rejected],
    });

    expect(report).toContain("No viable candidate");
    expect(report).toContain("not trusted ranked winners");
    expect(report).not.toContain("best-reject: reject with robust score");
  });

  it("normalizes Kalshi historical market settlements into official outcome labels", () => {
    const settled = normalizeKalshiHistoricalMarket({
      ticker: "KXDOGE15M-26JUN091200-50",
      status: "finalized",
      result: "yes",
      close_time: "2026-06-09T12:00:00.000Z",
      settlement_ts: "2026-06-09T12:01:02.000Z",
      settlement_value_dollars: "0.5123",
    }, {
      sourceEndpoint: "/historical/markets/KXDOGE15M-26JUN091200-50",
      fetchedAt: "2026-06-09T12:05:00.000Z",
    });

    expect(settled).toMatchObject({
      schemaVersion: "dogeedge.official-settlement.v1",
      marketTicker: "KXDOGE15M-26JUN091200-50",
      officialResolutionAvailable: true,
      outcomeSide: "YES",
      labelSource: "official_resolution",
      settlementSource: "official_resolution",
      settlementValueDollars: 0.5123,
    });
    const outcomes = officialOutcomeMap([settled]);
    const officialBase = {
      ...baseFrame,
      marketTicker: settled.marketTicker,
      marketCloseTime: "2026-06-09T12:00:00.000Z",
      capturedAt: "2026-06-09T11:59:30.000Z",
      observedAt: "2026-06-09T11:59:30.000Z",
    };
    const events = buildMarketEvents(deduplicateDecisionFrames([
      normalizeDecisionFrame({ ...officialBase, id: "official-open", secondsToClose: 30 }).frame,
      normalizeDecisionFrame({ ...officialBase, id: "official-close", observedAt: "2026-06-09T11:59:59.000Z", capturedAt: "2026-06-09T11:59:59.000Z", secondsToClose: 1 }).frame,
    ]).frames, { officialOutcomes: outcomes }).events;

    expect(events[0]).toMatchObject({
      marketTicker: settled.marketTicker,
      labelSource: "official_resolution",
      settlementSource: "official_resolution",
      officialResolutionAvailable: true,
      outcomeSide: "YES",
    });
    expect(officialSettlementCoverageForEvents(events, [settled])).toMatchObject({
      officialEvents: 1,
      officialSettlementCoverage: 1,
    });
  });

  it("marks compact JSONL tick samples as diagnostic-only when replay sequencing is absent", () => {
    const row = compactReplayTickRow({
      marketTicker: "KXDOGE15M-FIXTURE",
      capturedAt: "2026-06-09T12:00:00.100Z",
      paperInput: {
        ticker: "KXDOGE15M-FIXTURE",
        observedAt: "2026-06-09T12:00:00.000Z",
        action: "buy_yes",
        yesBid: 0.49,
        yesAsk: 0.5,
        noBid: 0.5,
        noAsk: 0.51,
        sizeContracts: 1,
        marketLive: true,
      },
    }, "{\"sample\":true}", { snapshotId: "snap", gitCommit: "abc" });
    const manifest = rawTickReplayManifest({
      snapshotId: "snap",
      generatedAt: "2026-06-09T12:00:01.000Z",
      requestedFormat: "jsonl",
      targetMarkets: ["KXDOGE15M-FIXTURE"],
      jsonlFiles: [{ marketTicker: "KXDOGE15M-FIXTURE", rows: 1, relativePath: "raw_market_ticks/jsonl/KXDOGE15M-FIXTURE.jsonl" }],
      sourceSnapshotFiles: [{ relativePath: "raw/snapshots/source.jsonl", bytes: 100 }],
    });
    const parity = replayParityReportFromManifest({ snapshotId: "snap", generatedAt: manifest.generatedAt, rawTickManifest: manifest });

    expect(row).toMatchObject({
      market_ticker: "KXDOGE15M-FIXTURE",
      event_type: "orderbook_snapshot",
      side: "YES",
      best_yes_ask: 0.5,
    });
    expect(manifest).toMatchObject({
      jsonlAvailable: true,
      replayGradeAvailable: false,
      executionSensitivePromotionAllowed: false,
      warningCodes: expect.arrayContaining(["sequence_gap_check_absent"]),
    });
    expect(parity).toMatchObject({
      sampleParity: true,
      replayGrade: false,
      executionSensitivePromotionAllowed: false,
      fallbackKind: "jsonl_or_candlestick_diagnostic_only",
    });
  });

  it("surfaces run-level readiness blockers before strategy quality", () => {
    const gate = buildExecutableReadinessGate({
      snapshotId: "snap",
      generatedAt: "2026-06-09T12:00:00.000Z",
      exactLinkSummary: { supportedLiveExactLinkedCount: 0, exactLinkRate: 0 },
      settlementCoverageReport: { summary: { officialSettlementCoverage: 0 } },
      rawTickManifest: { targetMarketCount: 1, coveredTargetMarketCount: 1, uncoveredTargetMarketCount: 0, jsonlAvailable: true, parquetAvailable: false, sequenceGapCheckAvailable: false },
      simulatorCalibrationReport: { attempts: 0 },
      topRosterDefaultSortAudit: { researchRankedRosterCount: 0 },
      dataQuality: { marketEvents: 20, sampleSufficiency: { counts: { daysRepresented: 2, independentMarkets: 20 } } },
    });

    expect(gate).toMatchObject({
      allowedToLoadArenaBatch: false,
      state: "hold_gather_evidence",
      officialSettlementReady: false,
      rawTickReplayReady: false,
      exactLinkReady: false,
      reasonCodes: expect.arrayContaining([
        "exact_linked_supported_live_rows_zero",
        "official_settlement_coverage_below_threshold",
        "replay_grade_target_market_ticks_absent",
        "represented_days_below_threshold",
        "independent_markets_below_threshold",
      ]),
    });
  });

  it("fails closed when represented days or independent markets are missing", () => {
    const gate = buildExecutableReadinessGate({
      snapshotId: "snap",
      generatedAt: "2026-06-09T12:00:00.000Z",
      exactLinkSummary: { supportedLiveExactLinkedCount: 3, exactLinkRate: 1 },
      settlementCoverageReport: { summary: { officialSettlementCoverage: 1 } },
      replayParityReport: {
        replayGrade: true,
        targetMarketCount: 1,
        replayGradeTargetMarketCoverage: 1,
      },
      simulatorCalibrationReport: { attempts: 10, labelKnownCount: 50 },
      topRosterDefaultSortAudit: { researchRankedRosterCount: 1 },
      dataQuality: {},
      evidenceProbeSummary: { exactLinkedProbeCount: 3 },
      seedCompleteness: 1,
    });

    expect(gate.allowedToLoadArenaBatch).toBe(false);
    expect(gate.representedDaysReady).toBe(false);
    expect(gate.independentMarketsReady).toBe(false);
    expect(gate.reasonCodes).toEqual(expect.arrayContaining([
      "represented_days_missing",
      "independent_markets_missing",
    ]));
  });

  it("uses replay-grade coverage, not diagnostic sample coverage, for readiness", () => {
    const gate = buildExecutableReadinessGate({
      snapshotId: "snap",
      generatedAt: "2026-06-09T12:00:00.000Z",
      exactLinkSummary: { supportedLiveExactLinkedCount: 3, exactLinkRate: 1 },
      settlementCoverageReport: { summary: { officialSettlementCoverage: 1 } },
      replayParityReport: {
        replayGrade: false,
        targetMarketCount: 2,
        coveredTargetMarketCount: 2,
        replayGradeTargetMarketCount: 1,
        replayGradeTargetMarketCoverage: 0.5,
        coverageRate: 1,
        fallbackKind: "absent",
      },
      simulatorCalibrationReport: { attempts: 2, labelKnownCount: 50 },
      topRosterDefaultSortAudit: { researchRankedRosterCount: 1 },
      dataQuality: { marketEvents: 60, sampleSufficiency: { counts: { daysRepresented: 7, independentMarkets: 60 } } },
      evidenceProbeSummary: { exactLinkedProbeCount: 3 },
      seedCompleteness: 1,
    });

    expect(gate.replayGradeTargetMarketCoverage).toBe(0.5);
    expect(gate.rawTickReplayReady).toBe(false);
    expect(gate.reasonCodes).toContain("replay_grade_target_market_ticks_absent");
  });

  it("reports readiness coverage progress using displayed percent units", () => {
    expect(readinessComponent("replay-grade target coverage", 1, 1, "coverage")).toMatchObject({
      value: 100,
      target: 100,
      unit: "percent",
      progress: 1,
      status: "pass",
    });
    expect(readinessComponent("official settlement coverage", 0.42, 0.95, "coverage")).toMatchObject({
      value: 42,
      target: 95,
      unit: "percent",
      progress: expect.closeTo(42 / 95, 6),
      status: "blocked",
    });
  });

  it("keeps evidence bundle refresh pointed at the active runtime data directories", () => {
    const args = evalBundleArgsForBootstrap({
      dataRoot: "D:\\DogeEdge\\data",
      storageDir: "D:\\DogeEdge\\data\\local-worker",
      evidenceDir: "C:\\Users\\matth\\DogeEdge\\artifacts\\evidence",
    });

    expect(args).toEqual(expect.arrayContaining([
      "--data-root",
      "D:\\DogeEdge\\data",
      "--storage-dir",
      "D:\\DogeEdge\\data\\local-worker",
      "--evidence-dir",
      "C:\\Users\\matth\\DogeEdge\\artifacts\\evidence",
    ]));
  });

  it("reseeds execution canaries when the lane is missing, undersized, or stale", () => {
    expect(executionCanariesNeedReseed({
      executionCanaries: null,
      sourceRunId: "run-2",
      maxExecutionCanaries: 3,
    })).toBe(true);
    expect(executionCanariesNeedReseed({
      executionCanaries: { sourceRunId: "run-2", probes: [{}, {}] },
      sourceRunId: "run-2",
      maxExecutionCanaries: 3,
    })).toBe(true);
    expect(executionCanariesNeedReseed({
      executionCanaries: { sourceRunId: "run-1", probes: [{}, {}, {}] },
      sourceRunId: "run-2",
      maxExecutionCanaries: 3,
    })).toBe(true);
    const healthyCanary = {
      exactLinked: true,
      paperOnly: true,
      enabled: true,
      lane: "exact_linked_execution_canary",
      researchCandidateId: "rcid-1",
      candidateConfigHash: "hash-1",
    };
    expect(executionCanariesNeedReseed({
      executionCanaries: {
        sourceRunId: "run-1",
        paperOnly: true,
        executableOnly: true,
        lane: "exact_linked_execution_canary",
        probes: [healthyCanary, healthyCanary, healthyCanary],
      },
      sourceRunId: "run-2",
      maxExecutionCanaries: 3,
    })).toBe(false);
    expect(executionCanariesNeedReseed({
      executionCanaries: {
        sourceRunId: "2026-06-09T04-22-19Z",
        paperOnly: true,
        executableOnly: true,
        lane: "exact_linked_execution_canary",
        probes: [healthyCanary, healthyCanary, healthyCanary],
      },
      sourceRunId: "2026-06-20T00-05-37Z",
      maxExecutionCanaries: 3,
      maxSourceAgeHours: 72,
    })).toBe(true);
    expect(executionCanariesNeedReseed({
      executionCanaries: { sourceRunId: "run-2", probes: [{}, {}, {}] },
      sourceRunId: "run-2",
      maxExecutionCanaries: 3,
    })).toBe(true);
    expect(executionCanariesNeedReseed({
      executionCanaries: {
        sourceRunId: "run-2",
        paperOnly: true,
        executableOnly: true,
        lane: "exact_linked_execution_canary",
        probes: [healthyCanary, healthyCanary, healthyCanary],
      },
      sourceRunId: "run-2",
      maxExecutionCanaries: 3,
    })).toBe(false);
  });

  it("fails execution canary health after enough negative paper evidence and triggers reseed", () => {
    const health = executionCanaryHealth({
      stats: {
        "canary-a": {
          sourceAlgoId: "canary-a",
          lane: "exact_linked_execution_canary",
          attempts: 16,
          acceptedBuys: 8,
          rejected: 2,
          sells: 8,
          open: 0,
          totalPnl: -14,
          startedAt: "2026-06-20T00:00:00.000Z",
          lastAttemptAt: "2026-06-20T00:20:00.000Z",
        },
        "canary-b": {
          sourceAlgoId: "canary-b",
          evidenceStatus: "execution_canary_only",
          attempts: 18,
          acceptedBuys: 8,
          rejected: 3,
          sells: 8,
          open: 0,
          totalPnl: -13,
          startedAt: "2026-06-20T00:00:00.000Z",
          lastAttemptAt: "2026-06-20T00:21:00.000Z",
        },
      },
    }, {
      minAttempts: 30,
      minSells: 10,
      maxLossDollars: 25,
      now: "2026-06-20T00:30:00.000Z",
    });
    expect(health).toMatchObject({
      status: "fail",
      totalPnl: -27,
      reasonCodes: ["canary_loss_limit_exceeded"],
      unhealthySourceAlgoIds: ["canary-a", "canary-b"],
    });
    expect(executionCanariesNeedReseed({
      executionCanaries: {
        sourceRunId: "run-2",
        paperOnly: true,
        executableOnly: true,
        lane: "exact_linked_execution_canary",
        probes: [
          { exactLinked: true, paperOnly: true, enabled: true, lane: "exact_linked_execution_canary", researchCandidateId: "rcid-a", candidateConfigHash: "hash-a" },
          { exactLinked: true, paperOnly: true, enabled: true, lane: "exact_linked_execution_canary", researchCandidateId: "rcid-b", candidateConfigHash: "hash-b" },
          { exactLinked: true, paperOnly: true, enabled: true, lane: "exact_linked_execution_canary", researchCandidateId: "rcid-c", candidateConfigHash: "hash-c" },
        ],
      },
      sourceRunId: "run-2",
      maxExecutionCanaries: 3,
      canaryHealth: health,
    })).toBe(true);
  });

  it("fails execution canary health when one paper canary breaches row loss limits", () => {
    const health = executionCanaryHealth({
      stats: {
        "fast-fail": {
          sourceAlgoId: "fast-fail",
          lane: "exact_linked_execution_canary",
          attempts: 9,
          acceptedBuys: 6,
          rejected: 1,
          sells: 6,
          open: 0,
          totalPnl: -16.25,
          startedAt: "2026-06-20T00:00:00.000Z",
          lastAttemptAt: "2026-06-20T00:12:00.000Z",
        },
        "still-collecting": {
          sourceAlgoId: "still-collecting",
          lane: "exact_linked_execution_canary",
          attempts: 2,
          acceptedBuys: 1,
          rejected: 0,
          sells: 1,
          open: 0,
          totalPnl: 0.25,
          startedAt: "2026-06-20T00:00:00.000Z",
          lastAttemptAt: "2026-06-20T00:12:00.000Z",
        },
      },
    }, {
      minAttempts: 30,
      minSells: 10,
      maxLossDollars: 25,
      minRowAttempts: 8,
      minRowSells: 5,
      maxRowLossDollars: 15,
      now: "2026-06-20T00:15:00.000Z",
    });
    expect(health).toMatchObject({
      status: "fail",
      reasonCodes: ["canary_row_loss_limit_exceeded"],
      unhealthySourceAlgoIds: ["fast-fail"],
    });
  });

  it("fails execution canary health when closed sells prove row loss before the attempt threshold", () => {
    const health = executionCanaryHealth({
      stats: {
        "closed-loss": {
          sourceAlgoId: "closed-loss",
          lane: "exact_linked_execution_canary",
          attempts: 7,
          acceptedBuys: 5,
          rejected: 2,
          sells: 5,
          open: 0,
          totalPnl: -17.66,
          startedAt: "2026-06-20T00:00:00.000Z",
          lastAttemptAt: "2026-06-20T00:12:00.000Z",
        },
      },
    }, {
      minAttempts: 30,
      minSells: 10,
      maxLossDollars: 25,
      minRowAttempts: 8,
      minRowSells: 5,
      maxRowLossDollars: 15,
      now: "2026-06-20T00:15:00.000Z",
    });
    expect(health).toMatchObject({
      status: "fail",
      reasonCodes: ["canary_row_loss_limit_exceeded"],
      unhealthySourceAlgoIds: ["closed-loss"],
    });
  });

  it("marks small execution canary samples as warming up instead of pass", () => {
    const health = executionCanaryHealth({
      stats: {
        "fresh-canary": {
          sourceAlgoId: "fresh-canary",
          lane: "exact_linked_execution_canary",
          attempts: 15,
          acceptedBuys: 0,
          rejected: 15,
          sells: 0,
          open: 0,
          totalPnl: 0,
          startedAt: "2026-06-20T00:00:00.000Z",
          lastAttemptAt: "2026-06-20T00:12:00.000Z",
        },
      },
    }, {
      minAttempts: 30,
      minSells: 10,
      minRejectRateAttempts: 25,
      maxRejectRate: 0.7,
      now: "2026-06-20T00:15:00.000Z",
    });
    expect(health).toMatchObject({
      status: "warming_up",
      reasonCodes: ["canary_warming_up_insufficient_sample"],
      rejectRate: 1,
      attempts: 15,
      acceptedBuys: 0,
    });
  });

  it("fails stalled execution canary warmup so the supervisor can reseed", () => {
    const health = executionCanaryHealth({
      stats: {
        "stalled-canary": {
          sourceAlgoId: "stalled-canary",
          lane: "exact_linked_execution_canary",
          attempts: 5,
          acceptedBuys: 0,
          rejected: 5,
          sells: 0,
          open: 0,
          totalPnl: 0,
          startedAt: "2026-06-20T00:00:00.000Z",
          lastAttemptAt: "2026-06-20T00:10:00.000Z",
        },
      },
    }, {
      minAttempts: 30,
      minSells: 10,
      minRejectRateAttempts: 25,
      maxWarmupIdleMinutes: 60,
      now: "2026-06-20T01:15:00.000Z",
    });
    expect(health).toMatchObject({
      status: "fail",
      reasonCodes: ["canary_warmup_stalled"],
      unhealthySourceAlgoIds: ["stalled-canary"],
    });
    expect(executionCanariesNeedReseed({
      executionCanaries: {
        sourceRunId: "run-2",
        paperOnly: true,
        executableOnly: true,
        lane: "exact_linked_execution_canary",
        probes: [
          { exactLinked: true, paperOnly: true, enabled: true, lane: "exact_linked_execution_canary", researchCandidateId: "rcid-a", candidateConfigHash: "hash-a" },
          { exactLinked: true, paperOnly: true, enabled: true, lane: "exact_linked_execution_canary", researchCandidateId: "rcid-b", candidateConfigHash: "hash-b" },
          { exactLinked: true, paperOnly: true, enabled: true, lane: "exact_linked_execution_canary", researchCandidateId: "rcid-c", candidateConfigHash: "hash-c" },
        ],
      },
      sourceRunId: "run-2",
      maxExecutionCanaries: 3,
      canaryHealth: health,
    })).toBe(true);
  });

  it("carries forward prior unhealthy canary exclusions across reseeds", () => {
    expect(mergedCanaryExclusions(
      { excludedSourceAlgoIds: ["old-bad", "still-bad"] },
      { unhealthySourceAlgoIds: ["still-bad", "new-bad"] },
    )).toEqual(["old-bad", "still-bad", "new-bad"]);
  });

  it("marks supervisor canary health unhealthy when row loss limits are crossed", () => {
    expect(executionCanarySupervisorHealth({
      stats: {
        "fast-fail": {
          sourceAlgoId: "fast-fail",
          lane: "exact_linked_execution_canary",
          attempts: 8,
          acceptedBuys: 6,
          rejected: 0,
          sells: 5,
          totalPnl: -15.25,
          startedAt: "2026-06-20T00:00:00.000Z",
          lastAttemptAt: "2026-06-20T00:10:00.000Z",
        },
      },
    }, {
      minRowAttempts: 8,
      minRowSells: 5,
      maxRowLossDollars: 15,
      now: "2026-06-20T00:12:00.000Z",
    })).toMatchObject({
      ok: false,
      status: "fail",
      reasonCodes: ["canary_row_loss_limit_exceeded"],
      unhealthySourceAlgoIds: ["fast-fail"],
    });
  });

  it("treats a fresh running evidence loop as healthy and stale running loops as unhealthy", () => {
    const nowMs = Date.parse("2026-06-20T01:30:00.000Z");
    expect(evidenceLoopHealth({
      status: "running",
      startedAt: "2026-06-20T01:10:00.000Z",
      loopPid: process.pid,
      canPlaceOrders: false,
    }, { nowMs, heartbeatSeconds: 30 })).toMatchObject({
      ok: true,
      loopAlive: true,
      runningFresh: true,
      status: "running",
    });
    expect(evidenceLoopHealth({
      status: "running",
      startedAt: "2026-06-20T01:10:00.000Z",
      canPlaceOrders: false,
    }, { nowMs, heartbeatSeconds: 30 })).toMatchObject({
      ok: false,
      loopAlive: false,
      runningFresh: false,
      status: "running",
    });
    expect(evidenceLoopHealth({
      status: "running",
      startedAt: "2026-06-20T00:30:00.000Z",
      loopPid: process.pid,
      canPlaceOrders: false,
    }, { nowMs, heartbeatSeconds: 30 })).toMatchObject({
      ok: false,
      loopAlive: true,
      runningFresh: false,
      status: "running",
    });
  });

  it("does not treat a stopped evidence loop as healthy just because the last cycle was recent", () => {
    const nowMs = Date.parse("2026-06-20T01:30:00.000Z");
    expect(evidenceLoopHealth({
      status: "ok",
      loopPid: 99999999,
      finishedAt: "2026-06-20T01:25:00.000Z",
      nextRunAt: "2026-06-20T01:45:00.000Z",
      canPlaceOrders: false,
    }, { nowMs, heartbeatSeconds: 30 })).toMatchObject({
      ok: false,
      loopAlive: false,
      recentEnough: true,
      overdue: false,
    });
  });

  it("starts the evidence loop frequently enough to catch 15-minute replay targets", () => {
    const args = evidenceLoopArgsForSupervisor({
      maxProbes: 3,
      evidenceLoopOut: "C:\\Users\\matth\\DogeEdge\\artifacts\\evidence-live-run",
      evidenceOut: "C:\\Users\\matth\\DogeEdge\\artifacts\\evidence",
    });

    expect(args).toEqual(expect.arrayContaining([
      "--interval-minutes",
      "10",
      "--active-min-lead-minutes",
      "1",
      "--provider-active-horizon-minutes",
      "180",
    ]));
  });

  it("does not reinstall source algos excluded after unhealthy execution canary evidence", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dogeedge-canary-exclude-"));
    const storageDir = path.join(dir, "local-worker");
    mkdirSync(storageDir, { recursive: true });
    const sourcePath = path.join(dir, "source.json");
    const candidate = (algoId: string, robustScore: number, family = "sweep-scalp") => ({
      algoId,
      algoName: algoId,
      family,
      params: family === "sweep-liquidity-imbalance"
        ? { maxSpread: 0.04, minBidDepth: 1, minImbalance: 0.25, minEdge: 0, yesMode: "none" }
        : { maxSpread: 0.04, feeBuffer: 0.004, minEdge: 0, sideMode: "best", yesMode: "loose" },
      researchCandidateId: `rcid-${algoId}`,
      candidateConfigHash: `hash-${algoId}`,
      conservativeTotalPnl: 1,
      closed: 20,
      independentClosedMarkets: 20,
      walkForwardClosed: 5,
      robustScore,
    });
    writeFileSync(sourcePath, `${JSON.stringify({
      runId: "run-canary-exclude",
      candidates: [
        candidate("bad-scalp", 100),
        candidate("bad-liquidity", 90, "sweep-liquidity-imbalance"),
        candidate("replacement-scalp", 80),
        candidate("replacement-liquidity", 70, "sweep-liquidity-imbalance"),
      ],
    })}\n`);
    execFileSync(process.execPath, [
      "scripts/factory/evidence-lane.mjs",
      "--data-root", dir,
      "--storage-dir", storageDir,
      "--from", sourcePath,
      "--max-probes", "2",
      "--executable-only",
      "--exclude-source-algos", "bad-scalp,bad-liquidity",
    ], { cwd: process.cwd() });
    const lane = JSON.parse(readFileSync(path.join(storageDir, "execution-canaries.json"), "utf8"));
    expect(lane.probes.map((probe: { sourceAlgoId: string }) => probe.sourceAlgoId)).toEqual([
      "replacement-scalp",
      "replacement-liquidity",
    ]);
    expect(lane.rejected.filter((row: { reasonCodes: string[] }) => row.reasonCodes.includes("excluded_unhealthy_execution_canary"))).toHaveLength(2);
  });

  it("fills execution canaries from recent sweep fallback runs without loosening eligibility", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dogeedge-canary-fallback-"));
    const dataRoot = path.join(dir, "data");
    const storageDir = path.join(dataRoot, "local-worker");
    const fallbackRunDir = path.join(dataRoot, "backtests", "sweeps", "fallback-run");
    mkdirSync(storageDir, { recursive: true });
    mkdirSync(fallbackRunDir, { recursive: true });
    const candidate = (algoId: string, family: string, runId: string, sideMode = "best", robustScore = 10, conservativeTotalPnl = 1) => ({
      algoId,
      algoName: algoId,
      family,
      params: family === "sweep-liquidity-imbalance"
        ? { maxSpread: 0.04, minBidDepth: 1, minImbalance: 0.25, minEdge: 0, yesMode: "none" }
        : { maxSpread: 0.01, feeBuffer: 0.004, minEdge: 0, sideMode, yesMode: "loose" },
      researchCandidateId: `rcid-${runId}-${algoId}`,
      candidateConfigHash: `hash-${runId}-${algoId}`,
      sourceRunId: runId,
      sourceSnapshotHash: `snapshot-${runId}`,
      seed: `seed-${runId}`,
      conservativeTotalPnl,
      closed: 20,
      independentClosedMarkets: 20,
      walkForwardClosed: 5,
      robustScore,
    });
    const primarySourcePath = path.join(dir, "primary.json");
    writeFileSync(primarySourcePath, `${JSON.stringify({
      runId: "primary-run",
      randomSeed: "seed-primary",
      candidates: [
        candidate("primary-scalp", "sweep-scalp", "primary-run", "yes-only", 50),
        candidate("primary-liquidity", "sweep-liquidity-imbalance", "primary-run", "best", 40),
      ],
    })}\n`);
    writeFileSync(path.join(fallbackRunDir, "config.json"), `${JSON.stringify({
      runId: "fallback-run",
      randomSeed: "seed-fallback",
      registry: {
        configHash: "config-fallback",
        inputManifestHash: "snapshot-fallback",
      },
    })}\n`);
    writeFileSync(path.join(fallbackRunDir, "metrics.json"), `${JSON.stringify([
      candidate("fallback-negative", "sweep-scalp", "fallback-run", "no-only", 60, -1),
      candidate("primary-scalp", "sweep-scalp", "fallback-run", "yes-only", 55, 1),
      candidate("fallback-safe-no", "sweep-scalp", "fallback-run", "no-only", 30, 1),
    ])}\n`);
    writeFileSync(path.join(fallbackRunDir, "candidates.json"), "[]\n");
    const oldTime = new Date("2026-06-20T00:00:00.000Z");
    utimesSync(fallbackRunDir, oldTime, oldTime);
    for (let index = 0; index < 30; index += 1) {
      const fillerDir = path.join(dataRoot, "backtests", "sweeps", `filler-run-${String(index).padStart(2, "0")}`);
      mkdirSync(fillerDir, { recursive: true });
      writeFileSync(path.join(fillerDir, "config.json"), `${JSON.stringify({ runId: `filler-run-${index}`, randomSeed: `seed-filler-${index}` })}\n`);
      writeFileSync(path.join(fillerDir, "metrics.json"), "[]\n");
      const fillerTime = new Date(Date.parse("2026-06-20T01:00:00.000Z") + index * 1000);
      utimesSync(fillerDir, fillerTime, fillerTime);
    }

    execFileSync(process.execPath, [
      "scripts/factory/evidence-lane.mjs",
      "--data-root", dataRoot,
      "--storage-dir", storageDir,
      "--from", primarySourcePath,
      "--max-probes", "3",
      "--executable-only",
    ], { cwd: process.cwd() });
    const lane = JSON.parse(readFileSync(path.join(storageDir, "execution-canaries.json"), "utf8"));

    expect(lane.probes.map((probe: { sourceAlgoId: string }) => probe.sourceAlgoId)).toContain("fallback-safe-no");
    expect(lane.probes.map((probe: { sourceAlgoId: string }) => probe.sourceAlgoId)).not.toContain("fallback-negative");
    expect(lane.probes.map((probe: { sourceAlgoId: string }) => probe.sourceAlgoId).filter((sourceAlgoId: string) => sourceAlgoId === "primary-scalp")).toHaveLength(1);
    expect(lane.probes).toHaveLength(3);
    expect(lane.sourceRunIds).toEqual(expect.arrayContaining(["primary-run", "fallback-run"]));
    expect(lane.summary.fallbackCandidateRows).toBeGreaterThanOrEqual(1);
    expect(lane.summary.reasonCodes).not.toContain("insufficient_supported_execution_canary_candidates");
  });

  it("marks headless top-trader selection stale when it is not on the installed execution canary lane", () => {
    const executionCanaries = {
      probes: [
        { id: "generated:sweep-scalp-current", sourceAlgoId: "sweep-scalp-current" },
        { id: "generated:sweep-liquidity-current", sourceAlgoId: "sweep-liquidity-current" },
      ],
    };
    expect(canarySelectionStatus({
      topTradersArena: {
        status: "running",
        selectedAlgoId: "generated:sweep-scalp-legacy",
        selectedAlgoIds: ["generated:sweep-scalp-legacy"],
      },
    }, executionCanaries)).toMatchObject({
      expectedCanaryCount: 2,
      selectedCanaryCount: 0,
      canarySelectionStale: true,
    });
    expect(canarySelectionStatus({
      topTradersArena: {
        status: "running",
        selectedAlgoId: "generated:sweep-scalp-current",
        selectedAlgoIds: ["generated:sweep-scalp-current", "generated:sweep-liquidity-current"],
      },
    }, executionCanaries)).toMatchObject({
      expectedCanaryCount: 2,
      selectedCanaryCount: 2,
      canarySelectionStale: false,
    });
  });

  it("counts active execution canary rows when latest only exposes the current selected algo", () => {
    const executionCanaries = {
      probes: [
        { id: "generated:sweep-scalp-current", sourceAlgoId: "sweep-scalp-current" },
        { id: "generated:sweep-liquidity-current", sourceAlgoId: "sweep-liquidity-current" },
        { id: "generated:sweep-scalp-third", sourceAlgoId: "sweep-scalp-third" },
      ],
    };
    expect(canarySelectionStatus({
      topTradersArena: {
        status: "running",
        selectedAlgoId: "generated:sweep-scalp-current",
        selectedAlgoCount: 3,
      },
    }, executionCanaries, {
      stats: {
        "sweep-scalp-current": {
          algoId: "generated:sweep-scalp-current",
          lane: "exact_linked_execution_canary",
        },
        "sweep-liquidity-current": {
          algoId: "generated:sweep-liquidity-current",
          evidenceStatus: "execution_canary_only",
        },
        "sweep-scalp-third": {
          sourceAlgoId: "sweep-scalp-third",
          lane: "exact_linked_execution_canary",
        },
      },
    })).toMatchObject({
      expectedCanaryCount: 3,
      selectedCanaryCount: 3,
      currentSelectedCanaryIds: ["generated:sweep-scalp-current"],
      activeCanaryIds: [
        "generated:sweep-scalp-current",
        "generated:sweep-liquidity-current",
        "generated:sweep-scalp-third",
      ],
      canarySelectionStale: false,
    });
  });

  it("does not let active canary stats mask a stale legacy selected top-trader roster", () => {
    const executionCanaries = {
      probes: [
        { id: "generated:sweep-scalp-current", sourceAlgoId: "sweep-scalp-current" },
        { id: "generated:sweep-liquidity-current", sourceAlgoId: "sweep-liquidity-current" },
        { id: "generated:sweep-scalp-third", sourceAlgoId: "sweep-scalp-third" },
      ],
    };
    expect(canarySelectionStatus({
      topTradersArena: {
        status: "running",
        selectedAlgoId: "generated:sweep-scalp-legacy",
        selectedAlgoCount: 3,
      },
    }, executionCanaries, {
      stats: {
        "sweep-scalp-current": {
          algoId: "generated:sweep-scalp-current",
          lane: "exact_linked_execution_canary",
        },
        "sweep-liquidity-current": {
          algoId: "generated:sweep-liquidity-current",
          evidenceStatus: "execution_canary_only",
        },
        "sweep-scalp-third": {
          sourceAlgoId: "sweep-scalp-third",
          lane: "exact_linked_execution_canary",
        },
      },
    })).toMatchObject({
      expectedCanaryCount: 3,
      selectedCanaryCount: 3,
      currentSelectedCanaryIds: [],
      activeCanaryIds: [
        "generated:sweep-scalp-current",
        "generated:sweep-liquidity-current",
        "generated:sweep-scalp-third",
      ],
      canarySelectionStale: true,
    });
  });

  it("mirrors current target-market selection into stable evidence status artifacts", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-target-mirror-"));
    const sourceDir = path.join(root, "run", "target-markets");
    const targetDir = path.join(root, "evidence", "target-markets");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, "target_markets.json"), `${JSON.stringify({
      schemaVersion: "dogeedge.target-markets.v1",
      generatedAt: "2026-06-20T03:25:00.000Z",
      closedTargetCount: 50,
      activeTargetCount: 2,
      activeTickers: ["KXDOGE15M-A", "KXDOGE15M-B"],
    })}\n`);
    writeFileSync(path.join(sourceDir, "active-targets.json"), `${JSON.stringify({ markets: ["KXDOGE15M-A", "KXDOGE15M-B"] })}\n`);
    writeFileSync(path.join(sourceDir, "active-targets.txt"), "KXDOGE15M-A\nKXDOGE15M-B\n");

    const copied = await mirrorTargetMarketSelectionArtifacts(sourceDir, targetDir);
    const mirrored = JSON.parse(readFileSync(path.join(targetDir, "target_markets.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(path.join(targetDir, "mirror_manifest.json"), "utf8"));

    expect(copied.map((file) => path.basename(file))).toEqual(expect.arrayContaining([
      "target_markets.json",
      "active-targets.json",
      "active-targets.txt",
    ]));
    expect(mirrored.activeTargetCount).toBe(2);
    expect(mirrored.activeTickers).toEqual(["KXDOGE15M-A", "KXDOGE15M-B"]);
    expect(manifest).toMatchObject({
      schemaVersion: "dogeedge.target-markets-mirror.v1",
      copiedFiles: expect.arrayContaining(["target_markets.json"]),
    });
  });

  it("counts active replay target documents without falling back to closed targets", () => {
    expect(countTargetMarkets({ markets: [] })).toBe(0);
    expect(countTargetMarkets({ activeTargets: [], closedTargets: [{ marketTicker: "KXDOGE15M-CLOSED" }] })).toBe(0);
    expect(countTargetMarkets({ markets: ["KXDOGE15M-A", "KXDOGE15M-A", "KXDOGE15M-B"] })).toBe(2);
    expect(countTargetMarkets({
      activeTargets: [
        { marketTicker: "KXDOGE15M-A" },
        { ticker: "KXDOGE15M-B" },
        { id: "KXDOGE15M-B" },
      ],
    })).toBe(2);
  });

  it("restarts headless Chrome only when stale canary selection is restart-eligible", () => {
    expect(shouldRestartChrome({
      status: "ok",
      chromeAlive: true,
      latestFresh: true,
      executableFresh: true,
      topTradersStatus: "running",
      selectedAlgoCount: 3,
      canaryRows: 3,
      canarySelectionStale: true,
      canarySelectionRestartEligible: false,
    })).toBe(false);
    expect(shouldRestartChrome({
      status: "ok",
      chromeAlive: true,
      latestFresh: true,
      executableFresh: true,
      topTradersStatus: "running",
      selectedAlgoCount: 3,
      canaryRows: 3,
      canarySelectionStale: true,
      canarySelectionRestartEligible: true,
    })).toBe(true);
  });

  it("does not restart healthy headless monitoring only because local worker timestamps are quiet", () => {
    const quietStatus = {
      status: "ok",
      chromeAlive: true,
      latestFresh: false,
      executableFresh: false,
      topTradersStatus: "running",
      selectedAlgoCount: 3,
      canaryRows: 3,
      canarySelectionStale: false,
      canarySelectionRestartEligible: false,
    };

    expect(shouldRestartChrome(quietStatus)).toBe(false);
    expect(headlessSupervisorOk(quietStatus, { fresh: true })).toBe(true);
  });

  it("loads the latest rich supported research source instead of a bounded promote-check", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "dogeedge-best-supported-research-"));
    const sweepsDir = path.join(dataRoot, "backtests", "sweeps");
    const supportedRow = {
      algoId: "sweep-scalp-rich",
      algoName: "Rich Supported Scalp",
      family: "sweep-scalp",
      params: { maxSpread: 0.08, feeBuffer: 0.004, minEdge: 0.02, sideMode: "best", yesMode: "loose" },
      researchCandidateId: "rcid-rich",
      candidateConfigHash: "hash-rich",
      conservativeTotalPnl: 1.2,
      closed: 40,
      independentClosedMarkets: 35,
      walkForwardClosed: 5,
      robustScore: 4,
    };
    writeSweepRun(sweepsDir, "2026-06-20T00-45-11Z", {
      mode: "promote-check",
      algoCount: 109,
      deepSweepMode: false,
      requestedDeepSweepMode: false,
    }, [{
      ...supportedRow,
      algoId: "sweep-scalp-bounded",
      researchCandidateId: "rcid-bounded",
      candidateConfigHash: "hash-bounded",
    }]);
    writeSweepRun(sweepsDir, "2026-06-20T00-05-37Z", {
      mode: "deep-sweep",
      algoCount: 981,
      deepSweepMode: true,
      requestedDeepSweepMode: true,
    }, [supportedRow]);
    writeFileSync(path.join(dataRoot, "backtests", "latest-sweep.json"), `${JSON.stringify({
      runId: "2026-06-20T00-45-11Z",
      mode: "promote-check",
      topMetrics: [],
    })}\n`);

    const source = await loadSourceSweep({ from: "best-supported-research" }, dataRoot);

    expect(source.runId).toBe("2026-06-20T00-05-37Z");
    expect(source.sourceSelection).toMatchObject({
      mode: "best_supported_research",
      selectedRunId: "2026-06-20T00-05-37Z",
      richResearchRun: true,
      eligibleExecutionCanaryCandidates: 1,
    });
  });

  it("keeps promotion readiness fail-closed when only evidence collection is complete", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-readiness-percent-"));
    const storageDir = path.join(root, "local-worker");
    const evidenceDir = path.join(root, "evidence");
    const outDir = path.join(root, "bootstrap");
    mkdirSync(storageDir, { recursive: true });
    mkdirSync(evidenceDir, { recursive: true });
    mkdirSync(path.join(outDir, "target-markets"), { recursive: true });
    mkdirSync(path.join(root, "review_exports", "bundles", "dogeedge-review-bundle-test", "snapshots"), { recursive: true });
    writeFileSync(path.join(evidenceDir, "settlement_fetch_report.json"), `${JSON.stringify({ coverage: { officialSettlementCoverage: 1 } })}\n`);
    writeFileSync(path.join(evidenceDir, "replay_coverage_report.json"), `${JSON.stringify({ replayGradeTargetMarketCoverage: 1 })}\n`);
    writeFileSync(path.join(storageDir, "evidence-probes.json"), `${JSON.stringify({ probes: [{ exactLinked: true }, { exactLinked: true }, { exactLinked: true }] })}\n`);
    writeFileSync(path.join(storageDir, "latest.json"), `${JSON.stringify({
      topTradersExecutable: {
        stats: {
          one: { researchCandidateId: "rcid-1", candidateConfigHash: "hash-1" },
          two: { researchCandidateId: "rcid-2", candidateConfigHash: "hash-2" },
          three: { researchCandidateId: "rcid-3", candidateConfigHash: "hash-3" },
        },
      },
    })}\n`);
    writeFileSync(path.join(outDir, "target-markets", "target_markets.json"), `${JSON.stringify({ activeTargetCount: 1 })}\n`);
    writeFileSync(path.join(root, "review_exports", "bundles", "dogeedge-review-bundle-test", "snapshots", "executable_readiness_gate.json"), `${JSON.stringify({
      allowedToLoadArenaBatch: false,
      reasonCodes: ["research_validated_roster_empty"],
      officialSettlementCoverage: 0.969,
      replayGradeTargetMarketCoverage: 1,
    })}\n`);
    writeFileSync(path.join(evidenceDir, "research_roster_blockers.json"), `${JSON.stringify({
      currentBottleneck: "conservative_holdout_not_passing",
      validationStatus: "supported_family_holdout_failure_partial_search",
      nextEvidenceNeed: "Need a supported exact-linked candidate with positive conservative holdout P/L.",
      supportedExecutableSweepCoverage: {
        requested: 972,
        selected: 500,
        fullyCovered: false,
      },
      topReasons: [
        { code: "holdout_failed", count: 500 },
      ],
    })}\n`);

    await writeReadinessPercent({
      finishedAt: "2026-06-19T17:24:23.215Z",
      storageDir,
      evidenceDir,
      outDir,
      reviewRoot: path.join(root, "review_exports"),
    });
    const readiness = JSON.parse(readFileSync(path.join(evidenceDir, "readiness_percent.json"), "utf8"));

    expect(readiness).toMatchObject({
      headline: "evidence_collection_ready_hold_promotion_gates",
      promotionReady: false,
      promotionReadinessPercent: 0,
      evidenceCollectionReady: true,
      evidenceCollectionProgressPercent: 100,
      promotionGateSource: "executable_readiness_gate",
      promotionGateReasonCodes: ["research_validated_roster_empty"],
      promotionBlockerDetail: {
        currentBottleneck: "conservative_holdout_not_passing",
        validationStatus: "supported_family_holdout_failure_partial_search",
        nextEvidenceNeed: "Need a supported exact-linked candidate with positive conservative holdout P/L.",
        supportedExecutableSweepCoverage: {
          requested: 972,
          selected: 500,
          fullyCovered: false,
        },
      },
      canPlaceOrders: false,
    });
    expect(readiness.components.find((component: { kpi: string }) => component.kpi === "official settlement coverage")).toMatchObject({
      value: 96.9,
      target: 95,
      status: "pass",
    });
  });

  it("counts selected exact-linked execution canaries before every canary emits stats", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-readiness-canaries-"));
    const storageDir = path.join(root, "local-worker");
    const evidenceDir = path.join(root, "evidence");
    const outDir = path.join(root, "bootstrap");
    mkdirSync(storageDir, { recursive: true });
    mkdirSync(evidenceDir, { recursive: true });
    mkdirSync(path.join(outDir, "target-markets"), { recursive: true });
    const canary = (index: number) => ({
      id: `generated:canary-${index}`,
      sourceAlgoId: `canary-${index}`,
      researchCandidateId: `rcid-${index}`,
      candidateConfigHash: `hash-${index}`,
      paperOnly: true,
      promotionEligibility: "not_promotion_eligible",
      evidenceStatus: "execution_canary_only",
      lane: "exact_linked_execution_canary",
    });
    writeFileSync(path.join(evidenceDir, "settlement_fetch_report.json"), `${JSON.stringify({ coverage: { officialSettlementCoverage: 1 } })}\n`);
    writeFileSync(path.join(evidenceDir, "replay_coverage_report.json"), `${JSON.stringify({ replayGradeTargetMarketCoverage: 1 })}\n`);
    writeFileSync(path.join(evidenceDir, "executable_readiness_gate.json"), `${JSON.stringify({
      allowedToLoadArenaBatch: false,
      reasonCodes: ["research_validated_roster_empty"],
      officialSettlementCoverage: 1,
      replayGradeTargetMarketCoverage: 1,
    })}\n`);
    writeFileSync(path.join(storageDir, "evidence-probes.json"), `${JSON.stringify({ probes: [{ exactLinked: true }, { exactLinked: true }, { exactLinked: true }] })}\n`);
    writeFileSync(path.join(storageDir, "latest.json"), `${JSON.stringify({
      topTradersArena: { selectedAlgoCount: 3 },
      topTradersExecutable: {
        stats: {
          one: { researchCandidateId: "rcid-1", candidateConfigHash: "hash-1" },
        },
      },
    })}\n`);
    writeFileSync(path.join(storageDir, "factory-batches.json"), `${JSON.stringify({
      factoryAlgoBatches: [{ algos: [canary(1), canary(2), canary(3)] }],
    })}\n`);
    writeFileSync(path.join(outDir, "target-markets", "target_markets.json"), `${JSON.stringify({ activeTargetCount: 1 })}\n`);

    await writeReadinessPercent({
      finishedAt: "2026-06-19T18:20:00.000Z",
      storageDir,
      evidenceDir,
      outDir,
    });
    const readiness = JSON.parse(readFileSync(path.join(evidenceDir, "readiness_percent.json"), "utf8"));
    const executionRows = readiness.components.find((component: { kpi: string }) => component.kpi === "exact-linked execution rows");

    expect(executionRows).toMatchObject({ value: 3, target: 3, status: "pass" });
    expect(readiness).toMatchObject({
      headline: "evidence_collection_ready_hold_promotion_gates",
      promotionReady: false,
      promotionReadinessPercent: 0,
      evidenceCollectionReady: true,
      evidenceCollectionProgressPercent: 100,
    });
  });

  it("treats absent active replay targets as waiting when replay evidence is already green", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-readiness-waiting-active-"));
    const storageDir = path.join(root, "local-worker");
    const evidenceDir = path.join(root, "evidence");
    const outDir = path.join(root, "bootstrap");
    mkdirSync(storageDir, { recursive: true });
    mkdirSync(evidenceDir, { recursive: true });
    mkdirSync(path.join(outDir, "target-markets"), { recursive: true });
    writeFileSync(path.join(evidenceDir, "settlement_fetch_report.json"), `${JSON.stringify({ coverage: { officialSettlementCoverage: 1 } })}\n`);
    writeFileSync(path.join(evidenceDir, "replay_coverage_report.json"), `${JSON.stringify({ replayGradeTargetMarketCoverage: 1 })}\n`);
    writeFileSync(path.join(evidenceDir, "executable_readiness_gate.json"), `${JSON.stringify({
      allowedToLoadArenaBatch: false,
      reasonCodes: ["research_validated_roster_empty"],
      officialSettlementCoverage: 1,
      replayGradeTargetMarketCoverage: 1,
    })}\n`);
    writeFileSync(path.join(storageDir, "evidence-probes.json"), `${JSON.stringify({ probes: [{ exactLinked: true }, { exactLinked: true }, { exactLinked: true }] })}\n`);
    writeFileSync(path.join(storageDir, "latest.json"), `${JSON.stringify({
      topTradersArena: { selectedAlgoCount: 3 },
      topTradersExecutable: {
        stats: {
          one: { researchCandidateId: "rcid-1", candidateConfigHash: "hash-1" },
          two: { researchCandidateId: "rcid-2", candidateConfigHash: "hash-2" },
          three: { researchCandidateId: "rcid-3", candidateConfigHash: "hash-3" },
        },
      },
    })}\n`);
    writeFileSync(path.join(outDir, "target-markets", "target_markets.json"), `${JSON.stringify({ activeTargetCount: 0 })}\n`);

    await writeReadinessPercent({
      finishedAt: "2026-06-19T18:20:00.000Z",
      storageDir,
      evidenceDir,
      outDir,
    });
    const readiness = JSON.parse(readFileSync(path.join(evidenceDir, "readiness_percent.json"), "utf8"));
    const activeTargets = readiness.components.find((component: { kpi: string }) => component.kpi === "active replay targets available");

    expect(readiness).toMatchObject({
      headline: "evidence_collection_ready_waiting_for_active_target_hold_promotion_gates",
      evidenceCollectionReady: true,
      evidenceCollectionProgressPercent: 100,
    });
    expect(activeTargets).toMatchObject({
      value: 0,
      target: 1,
      status: "waiting",
    });
  });

  it("computes proper scoring diagnostics only from label-known closed trades", () => {
    const calibration = probabilityCalibrationForTrades([
      { status: "closed", pnl: 1, entryContext: { fairProbability: 0.8 } },
      { status: "closed", pnl: -1, entryContext: { fairProbability: 0.7 } },
      { status: "closed", pnl: 1, entryPrice: 0.4 },
      { status: "open", pnl: null, entryContext: { fairProbability: 0.99 } },
      { status: "closed", pnl: null, entryContext: { fairProbability: 0.1 } },
    ], { bucketCount: 5 });

    expect(calibration).toMatchObject({
      schemaVersion: "dogeedge.probability-calibration.v1",
      labelKnownCount: 3,
      calibrationReady: false,
      brierScore: expect.any(Number),
      logLoss: expect.any(Number),
      expectedCalibrationError: expect.any(Number),
    });
    expect(calibration.reliabilityBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
  });

  it("prefers finalized official settlement rows over weaker duplicates", () => {
    const provisional = normalizeOfficialSettlementRow({
      marketTicker: "KXDOGE15M-DUPE",
      status: "provisional",
      finalized: false,
      provisional: true,
      outcomeSide: "YES",
      closeTime: "2026-06-09T12:00:00.000Z",
      settlementTimestamp: "2026-06-09T12:01:00.000Z",
      sourceEndpoint: "mock",
      verificationSource: "mock-provisional",
    });
    const finalized = normalizeOfficialSettlementRow({
      marketTicker: "KXDOGE15M-DUPE",
      status: "finalized",
      finalized: true,
      provisional: false,
      outcomeSide: "NO",
      closeTime: "2026-06-09T12:00:00.000Z",
      settlementTimestamp: "2026-06-09T12:02:00.000Z",
      sourceEndpoint: "mock",
      verificationSource: "mock-final",
    });

    const outcomes = officialOutcomeMap([provisional, finalized]);

    expect(outcomes.get("KXDOGE15M-DUPE")).toMatchObject({
      outcomeSide: "NO",
      officialResolutionAvailable: true,
      verificationSource: "mock-final",
    });
  });

  it("ingests mock official settlement fixtures offline", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "dogeedge-settlement-test-"));
    const fixture = path.join(tmp, "official-settlements.mock.jsonl");
    const out = path.join(tmp, "official_settlements.jsonl");
    writeFileSync(fixture, `${JSON.stringify({
      marketTicker: "KXDOGE15M-MOCK",
      status: "finalized",
      finalized: true,
      officialOutcome: "YES",
      closeTime: "2026-06-09T12:00:00.000Z",
      settlementTimestamp: "2026-06-09T12:02:00.000Z",
      sourceEndpoint: "mock://settlements",
      verificationSource: "unit-fixture",
    })}\n`, "utf8");

    execFileSync(process.execPath, [
      "scripts/factory/fetch-official-settlements.mjs",
      "--mock-input",
      fixture,
      "--out",
      out,
      "--data-root",
      tmp,
    ], { cwd: process.cwd(), stdio: "pipe" });

    const stored = readFileSync(out, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const report = JSON.parse(readFileSync(path.join(tmp, "settlement_fetch_report.json"), "utf8"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      schemaVersion: "dogeedge.official-settlement.v1",
      marketTicker: "KXDOGE15M-MOCK",
      officialResolutionAvailable: true,
      provider: "mock",
    });
    expect(report).toMatchObject({
      canPlaceOrders: false,
      fetchedRows: 1,
      storedRows: 1,
    });
  });

  it("routes Kalshi ticker settlement fetches through live markets before historical archives", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.endsWith("/historical/cutoff")) {
        return responseJson({ cutoff_time: "2026-06-01T00:00:00.000Z" });
      }
      if (url.endsWith("/markets/KXDOGE15M-ROUTE")) {
        return responseJson({
          market: {
            ticker: "KXDOGE15M-ROUTE",
            status: "settled",
            result: "YES",
            close_time: "2026-06-12T16:45:00.000Z",
            settlement_ts: "2026-06-12T16:46:00.000Z",
            settlement_value_dollars: 1,
          },
        });
      }
      return responseJson({ error: "not found" }, { ok: false, status: 404, statusText: "Not Found" });
    };

    const result = await fetchKalshiHistoricalSettlements({
      baseUrl: "https://kalshi.test/trade-api/v2",
      tickers: ["KXDOGE15M-ROUTE"],
      fetchImpl,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      marketTicker: "KXDOGE15M-ROUTE",
      officialResolutionAvailable: true,
      outcomeSide: "YES",
      sourceEndpoint: "kalshi_live_market",
      routeChosen: "live_market",
      settled: true,
    });
    expect(calls.some((url) => url.includes("/historical/markets/KXDOGE15M-ROUTE"))).toBe(false);
  });

  it("detects replay sequence gaps and keeps polling fallback diagnostic-only", () => {
    const good = [
      normalizeReplayRawEvent({ marketTicker: "KXDOGE15M-SEQ", messageType: "snapshot", seq: 10, receiveTs: "2026-06-09T12:00:00.000Z", bookSnapshot: { yes: [[0.5, 10]] } }),
      normalizeReplayRawEvent({ marketTicker: "KXDOGE15M-SEQ", messageType: "delta", seq: 11, prevSeq: 10, receiveTs: "2026-06-09T12:00:00.100Z", side: "YES", price: 0.51, delta: 2 }),
    ];
    const gapped = [
      ...good,
      normalizeReplayRawEvent({ marketTicker: "KXDOGE15M-SEQ", messageType: "delta", seq: 13, prevSeq: 11, receiveTs: "2026-06-09T12:00:00.200Z", side: "YES", price: 0.52, delta: -1 }),
      normalizeReplayRawEvent({ marketTicker: "KXDOGE15M-SEQ", messageType: "delta", seq: 13, prevSeq: 12, receiveTs: "2026-06-09T12:00:00.300Z", side: "YES", price: 0.52, delta: -1 }),
    ];
    const polling = [
      normalizeReplayRawEvent({ marketTicker: "KXDOGE15M-POLL", captureMode: "polling", messageType: "snapshot", receiveTs: "2026-06-09T12:00:00.000Z" }),
    ];
    const withTrades = [
      ...good,
      normalizeReplayRawEvent({ marketTicker: "KXDOGE15M-SEQ", channel: "trade", messageType: "trade", seq: 10, receiveTs: "2026-06-09T12:00:00.050Z", price: 0.51 }),
    ];

    expect(replaySequenceReport(good)).toMatchObject({
      replayGradeAvailable: true,
      fallbackKind: "replay_grade",
      gapCount: 0,
      duplicateCount: 0,
    });
    expect(replaySequenceReport(withTrades)).toMatchObject({
      replayGradeAvailable: true,
      tradeCount: 1,
      duplicateCount: 0,
    });
    expect(replaySequenceReport(gapped)).toMatchObject({
      replayGradeAvailable: false,
      gapCount: 1,
      duplicateCount: 1,
    });
    expect(replaySequenceReport(polling)).toMatchObject({
      replayGradeAvailable: false,
      fallbackKind: "polling_diagnostic_only",
    });
  });

  it("selects one replay-grade websocket segment when overlapping captures reset sequence numbers", () => {
    const firstCapture = [
      normalizeReplayRawEvent({ marketTicker: "KXDOGE15M-OVERLAP", captureRunId: "capture-a", wsSessionId: "session-a", messageType: "snapshot", seq: 1, receiveTs: "2026-06-20T09:34:44.000Z", sourceFileOrdinal: 1, bookSnapshot: { yes: [[0.5, 10]] } }),
      normalizeReplayRawEvent({ marketTicker: "KXDOGE15M-OVERLAP", captureRunId: "capture-a", wsSessionId: "session-a", messageType: "delta", seq: 2, receiveTs: "2026-06-20T09:34:45.000Z", sourceFileOrdinal: 2, side: "YES", price: 0.51, delta: 1 }),
    ];
    const overlappingCapture = [
      normalizeReplayRawEvent({ marketTicker: "KXDOGE15M-OVERLAP", captureRunId: "capture-b", wsSessionId: "session-b", messageType: "snapshot", seq: 1, receiveTs: "2026-06-20T09:38:44.000Z", sourceFileOrdinal: 10, bookSnapshot: { yes: [[0.5, 10]] } }),
      normalizeReplayRawEvent({ marketTicker: "KXDOGE15M-OVERLAP", captureRunId: "capture-b", wsSessionId: "session-b", messageType: "delta", seq: 2, receiveTs: "2026-06-20T09:38:45.000Z", sourceFileOrdinal: 11, side: "YES", price: 0.52, delta: 1 }),
    ];
    const combined = [...firstCapture, ...overlappingCapture].filter(Boolean);

    expect(replaySequenceReport(combined)).toMatchObject({
      replayGradeAvailable: false,
      duplicateCount: 2,
    });
    expect(selectReplaySegment(combined)).toMatchObject({
      sourceEventCount: 4,
      evaluatedSegmentCount: 2,
      sequence: {
        replayGradeAvailable: true,
        gapCount: 0,
        duplicateCount: 0,
      },
      segmentSummaries: [
        {
          replayGradeAvailable: true,
          rowCount: 2,
        },
        {
          replayGradeAvailable: true,
          rowCount: 2,
        },
      ],
    });
  });

  it("normalizes Kalshi websocket replay messages with explicit yes-leg price scale", () => {
    const subscription = kalshiReplaySubscription({
      marketTickers: ["KXDOGE15M-WS"],
      channels: ["orderbook_delta", "trade", "market_lifecycle_v2"],
      useYesPrice: true,
    });
    expect(subscription).toMatchObject({
      cmd: "subscribe",
      params: {
        market_tickers: ["KXDOGE15M-WS"],
        use_yes_price: true,
      },
    });

    const encoded = encodeClientWebSocketFrame(JSON.stringify({ ok: true }), { maskKey: Buffer.from([1, 2, 3, 4]) });
    const decoded = decodeServerWebSocketFrames(encoded);
    expect(JSON.parse(decoded.frames[0].payload.toString("utf8"))).toEqual({ ok: true });

    const snapshot = normalizeKalshiWsReplayMessage({
      type: "orderbook_snapshot",
      sid: 11,
      seq: 100,
      msg: {
        market_ticker: "KXDOGE15M-WS",
        yes: [[51, 10]],
        no: [[49, 7]],
        ts_ms: 1781360000000,
      },
    }, {
      receiveTs: "2026-06-13T18:00:00.000Z",
      wsSessionId: "session-1",
      captureRunId: "capture-1",
      gitCommit: "abc",
      sourceFileOrdinal: 1,
      useYesPrice: true,
    });
    const delta = normalizeKalshiWsReplayMessage({
      type: "orderbook_delta",
      sid: 11,
      seq: 101,
      msg: {
        market_ticker: "KXDOGE15M-WS",
        side: "yes",
        price: 52,
        delta: 3,
      },
    }, {
      receiveTs: "2026-06-13T18:00:01.000Z",
      wsSessionId: "session-1",
      captureRunId: "capture-1",
      gitCommit: "abc",
      sourceFileOrdinal: 2,
      useYesPrice: true,
    });

    expect(snapshot).toMatchObject({
      marketTicker: "KXDOGE15M-WS",
      channel: "orderbook",
      messageType: "snapshot",
      seq: 100,
      useYesPrice: true,
      priceScale: "yes_leg",
      bestYesBid: 0.51,
    });
    expect(delta).toMatchObject({
      messageType: "delta",
      side: "YES",
      priceDollars: 0.52,
      deltaContracts: 3,
    });
    expect(replaySequenceReport([snapshot, delta]).replayGradeAvailable).toBe(true);
  });

  it("loads Kalshi websocket credentials from a key file and redacts secret material", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-kalshi-key-"));
    const keyPath = path.join(root, "kalshi-test-key.pem");
    writeFileSync(keyPath, pem);

    const credentials = await loadKalshiWsCredentials({
      KALSHI_API_KEY_ID: "test-key-id",
      KALSHI_PRIVATE_KEY_PATH: keyPath,
    });
    expect(credentials.ok).toBe(true);
    expect(redactedCredentialReport(credentials)).toEqual({
      keyIdPresent: true,
      privateKeyPresent: true,
      privateKeyPathPresent: true,
      privateKeySource: "file",
      reason: null,
    });
    expect(JSON.stringify(redactedCredentialReport(credentials))).not.toContain("BEGIN PRIVATE KEY");
  });

  it("reconstructs a deterministic yes-price order book from snapshot and deltas", () => {
    const snapshot = normalizeReplayRawEvent({
      marketTicker: "KXDOGE15M-BOOK",
      channel: "orderbook",
      messageType: "snapshot",
      seq: 1,
      receiveTs: "2026-06-20T10:00:00.000Z",
      bookSnapshot: { yes: [[0.49, 10]], no: [[0.5, 8]] },
      useYesPrice: true,
    });
    const add = normalizeReplayRawEvent({
      marketTicker: "KXDOGE15M-BOOK",
      channel: "orderbook",
      messageType: "delta",
      seq: 2,
      receiveTs: "2026-06-20T10:00:01.000Z",
      side: "YES",
      priceDollars: 0.51,
      deltaContracts: 3,
      useYesPrice: true,
    });
    const reduce = normalizeReplayRawEvent({
      marketTicker: "KXDOGE15M-BOOK",
      channel: "orderbook",
      messageType: "delta",
      seq: 3,
      receiveTs: "2026-06-20T10:00:02.000Z",
      side: "YES",
      priceDollars: 0.49,
      deltaContracts: -10,
      useYesPrice: true,
    });

    const reconstruction = reconstructOrderBook([snapshot, add, reduce]);
    expect(reconstruction).toMatchObject({
      initialized: true,
      valid: true,
      useYesPrice: true,
      appliedDeltas: 2,
      finalTopOfBook: {
        bestYesBid: 0.51,
        bestYesAsk: 0.5,
      },
    });
    expect(reconstructOrderBook([snapshot, add, reduce]).deterministicHash).toBe(reconstruction.deterministicHash);
  });

  it("keeps a valid replay segment when Kalshi emits an empty terminal snapshot frame", () => {
    const snapshot = normalizeReplayRawEvent({
      marketTicker: "KXDOGE15M-BOOK",
      channel: "orderbook",
      messageType: "snapshot",
      seq: 1,
      receiveTs: "2026-06-20T10:00:00.000Z",
      bookSnapshot: { yes_dollars_fp: [["0.1000", "5.00"]], no_dollars_fp: [["0.9000", "4.00"]] },
      useYesPrice: true,
    });
    const delta = normalizeReplayRawEvent({
      marketTicker: "KXDOGE15M-BOOK",
      channel: "orderbook",
      messageType: "delta",
      seq: 2,
      receiveTs: "2026-06-20T10:00:01.000Z",
      side: "NO",
      priceDollars: 0.9,
      deltaContracts: -1,
      useYesPrice: true,
    });
    const terminalEmptySnapshot = normalizeReplayRawEvent({
      marketTicker: "KXDOGE15M-BOOK",
      channel: "orderbook",
      messageType: "snapshot",
      seq: 3,
      receiveTs: "2026-06-20T10:00:02.000Z",
      bookSnapshot: { market_ticker: "KXDOGE15M-BOOK" },
      useYesPrice: true,
    });

    const reconstruction = reconstructOrderBook([snapshot, delta, terminalEmptySnapshot]);
    expect(reconstruction.valid).toBe(true);
    expect(reconstruction.warningCount).toBe(1);
    expect(reconstruction.warnings[0].reasonCode).toBe("snapshot_without_book_levels_ignored");
    expect(reconstruction.finalTopOfBook.bestYesBid).toBe(0.1);
    expect(reconstruction.finalTopOfBook.bestYesAsk).toBe(0.1);
  });

  it("keeps replay/e2e evidence commands read-only from order routing APIs", () => {
    const files = [
      "scripts/factory/capture-replay.mjs",
      "scripts/factory/kalshi-ws-smoke.mjs",
      "scripts/factory/run-e2e-evidence.mjs",
      "scripts/factory/install-execution-canaries.mjs",
    ];
    const forbidden = /\b(createOrder|placeOrder|submitOrder|cancelOrder|amendOrder|routeOrder|orderRouter|portfolio\/orders|\/orders)\b/;
    for (const file of files) {
      const text = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(text).not.toMatch(forbidden);
    }
  });

  it("builds an offline e2e evidence artifact from exact-linked paper, replay, and settlement fixtures", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-e2e-fixture-"));
    const dataRoot = path.join(root, "data");
    const storageDir = path.join(dataRoot, "local-worker");
    const outDir = path.join(root, "artifacts", "e2e");
    mkdirSync(storageDir, { recursive: true });
    writeFileSync(path.join(storageDir, "execution-canaries.json"), JSON.stringify({
      schemaVersion: "dogeedge.evidence-probe-lane.v1",
      lane: "exact_linked_execution_canary",
      paperOnly: true,
      executableOnly: true,
      probes: [{
        id: "generated:e2e-canary",
        sourceAlgoId: "e2e-canary",
        family: "sweep-scalp",
        paperOnly: true,
        exactLinked: true,
        researchCandidateId: "rcid-e2e",
        candidateConfigHash: "hash-e2e",
        sourceRunId: "run-e2e",
        sourceSnapshotHash: "snapshot-e2e",
        seed: "seed-e2e",
        params: { sideMode: "best", minEdge: 0 },
      }],
    }));
    const targetsPath = path.join(root, "targets.json");
    writeFileSync(targetsPath, JSON.stringify({ targets: ["KXDOGE15M-E2E"] }));
    const replayPath = path.join(root, "replay.jsonl");
    writeFileSync(replayPath, [
      JSON.stringify({ marketTicker: "KXDOGE15M-E2E", channel: "orderbook", messageType: "snapshot", seq: 1, receiveTs: "2026-06-20T10:00:00.000Z", bookSnapshot: { yes: [[0.49, 10]], no: [[0.5, 8]] }, useYesPrice: true }),
      JSON.stringify({ marketTicker: "KXDOGE15M-E2E", channel: "orderbook", messageType: "delta", seq: 2, receiveTs: "2026-06-20T10:00:01.000Z", side: "YES", priceDollars: 0.5, deltaContracts: 1, useYesPrice: true }),
      JSON.stringify({ marketTicker: "KXDOGE15M-E2E", channel: "trade", messageType: "trade", receiveTs: "2026-06-20T10:00:02.000Z", useYesPrice: true }),
    ].join("\n") + "\n");
    const settlementPath = path.join(root, "settlements.jsonl");
    writeFileSync(settlementPath, `${JSON.stringify({
      marketTicker: "KXDOGE15M-E2E",
      status: "finalized",
      finalized: true,
      provisional: false,
      officialResolutionAvailable: true,
      officialOutcome: "YES",
      outcomeSide: "YES",
      labelTimestamp: "2026-06-20T10:15:00.000Z",
      settlementTimestamp: "2026-06-20T10:16:00.000Z",
      sourceEndpoint: "mock",
      verificationSource: "mock",
      fetchedAt: "2026-06-20T10:20:00.000Z",
      provider: "mock",
    })}\n`);
    const paperPath = path.join(root, "paper.jsonl");
    writeFileSync(paperPath, `${JSON.stringify({
      id: "decision-e2e",
      marketTicker: "KXDOGE15M-E2E",
      decisionTimestamp: "2026-06-20T10:00:01.500Z",
      action: "buy_yes",
      researchCandidateId: "rcid-e2e",
      candidateConfigHash: "hash-e2e",
      selectedPrice: 0.5,
    })}\n`);

    execFileSync(process.execPath, [
      "scripts/factory/run-e2e-evidence.mjs",
      "--target-markets", targetsPath,
      "--mock-replay-raw", replayPath,
      "--mock-settlements", settlementPath,
      "--paper-decisions", paperPath,
      "--data-root", dataRoot,
      "--storage-dir", storageDir,
      "--out", outDir,
      "--duration-seconds", "1",
    ], { cwd: process.cwd(), stdio: "pipe", maxBuffer: 20 * 1024 * 1024 });
    const runDir = path.join(outDir, readdirSync(outDir).find((name) => name.startsWith("e2e-evidence-")) ?? "");
    const status = JSON.parse(readFileSync(path.join(runDir, "pipeline_status.json"), "utf8"));
    expect(status).toMatchObject({
      pipelineOperational: true,
      candidateEvaluationComplete: true,
      candidateStatisticallyValidated: false,
      candidatePromotionEligible: false,
      replayGradeEvaluatedMarkets: 1,
      finalizedSettlementJoinCount: 1,
      exactLinkedPaperDecisionCount: 1,
      labelKnownCount: 1,
      canPlaceOrders: false,
    });
    expect(readFileSync(path.join(runDir, "paper_replay_parity_report.json"), "utf8")).toContain("dogeedge.paper-replay-parity-report.v1");
  });

  it("filters provider replay events to the selected target markets", () => {
    const targetSet = new Set(["KXDOGE15M-TARGET"]);
    expect(shouldCaptureReplayEvent({ marketTicker: "KXDOGE15M-TARGET" }, targetSet)).toBe(true);
    expect(shouldCaptureReplayEvent({ marketTicker: "KXMLB-NONTARGET" }, targetSet)).toBe(false);
    expect(shouldCaptureReplayEvent(null, targetSet)).toBe(true);
    expect(shouldCaptureReplayEvent({ marketTicker: "KXMLB-NONTARGET" }, new Set())).toBe(true);
  });

  it("joins finalized settlement-store rows into forecast calibration inputs", () => {
    const joined = officialSettlementJoinArtifacts({
      snapshotId: "snap-join",
      decisionRows: [{
        rowId: "decision-1",
        marketTicker: "KXDOGE15M-JOIN",
        algoId: "algo-join",
        family: "sweep-model",
        researchCandidateId: "rcid-join",
        candidateConfigHash: "hash-join",
        side: "YES",
        fairProbability: 0.72,
        labelSource: "estimated",
        settlementSource: "estimated",
        officialResolutionAvailable: false,
      }],
      tradeRows: [],
      settlementRows: [{
        schemaVersion: "dogeedge.official-settlement.v1",
        marketTicker: "KXDOGE15M-JOIN",
        status: "finalized",
        finalized: true,
        provisional: false,
        officialResolutionAvailable: true,
        officialOutcome: "YES",
        outcomeSide: "YES",
        labelTimestamp: "2026-06-13T18:15:00.000Z",
        settlementTimestamp: "2026-06-13T18:16:00.000Z",
        sourceEndpoint: "kalshi_live_market",
        verificationSource: "kalshi_live_market",
        fetchedAt: "2026-06-13T18:20:00.000Z",
        sourcePayloadSha256: "abc",
        provider: "kalshi",
        providerVersion: "test",
      }],
    });
    expect(joined.decisionRows[0]).toMatchObject({
      labelSource: "official_resolution",
      settlementSource: "official_resolution",
      officialResolutionAvailable: true,
      outcomeSide: "YES",
    });
    expect(joined.auditRows[0]).toMatchObject({
      officialRowPresent: true,
      officialResolutionAvailable: true,
      reasonCodes: expect.stringContaining("official_join_available"),
    });
    expect(officialForecastCalibrationReport(joined.decisionRows, { bucketCount: 1 })).toMatchObject({
      calibrationKind: "official_forecast",
      labelKnownCount: 1,
    });
  });

  it("backfills exact linkage only when the match is deterministic", () => {
    const report = deterministicLinkageBackfill({
      researchRows: [
        { algoId: "candidate-a", family: "sweep-model", researchCandidateId: "rcid-a", candidateConfigHash: "hash-a", sourceRunId: "run-1" },
        { algoId: "candidate-b1", family: "sweep-model", researchCandidateId: "rcid-b1", candidateConfigHash: "hash-b1", sourceRunId: "run-1" },
        { algoId: "candidate-b2", family: "sweep-model", researchCandidateId: "rcid-b2", candidateConfigHash: "hash-b2", sourceRunId: "run-1" },
        { algoId: "candidate-dupe", family: "sweep-model", researchCandidateId: "rcid-dupe-1", candidateConfigHash: "hash-dupe-1", sourceRunId: "run-1" },
        { algoId: "candidate-dupe", family: "sweep-model", researchCandidateId: "rcid-dupe-2", candidateConfigHash: "hash-dupe-2", sourceRunId: "run-2" },
      ],
      executableRows: [
        { algoId: "generated:candidate-a", sourceAlgoId: "candidate-a", family: "sweep-model" },
        { algoId: "generated:candidate-dupe", sourceAlgoId: "candidate-dupe", family: "sweep-model" },
        { algoId: "generated:unsupported", sourceAlgoId: "candidate-x", family: "sweep-momentum-trail" },
      ],
    });

    expect(report.linked.find((row) => row.sourceAlgoId === "candidate-a")).toMatchObject({
      linkageStatus: "backfilled_exact_link",
      researchCandidateId: "rcid-a",
      candidateConfigHash: "hash-a",
    });
    expect(report.unresolved.find((row) => row.sourceAlgoId === "candidate-x")).toMatchObject({
      linkageStatus: "unsupported_unlinked",
    });
    expect(report.unresolved.find((row) => row.sourceAlgoId === "candidate-dupe")).toMatchObject({
      linkageStatus: "ambiguous_unresolved",
      reasonCodes: ["ambiguous_candidate_match"],
    });
  });

  it("installs evidence probes only for exact-linked supported paper candidates", () => {
    const rows = [
      {
        algoId: "probe-good",
        algoName: "Probe Good",
        family: "sweep-model",
        params: { threshold: 0.1 },
        researchCandidateId: "rcid-good",
        candidateConfigHash: "hash-good",
        sourceRunId: "run-1",
        sourceSnapshotHash: "snapshot-hash",
        promotionVerdict: "paper_only",
        seed: "seed-good",
        closed: 4,
        conservativeTotalPnl: 0.01,
      },
      {
        algoId: "probe-missing-link",
        family: "sweep-model",
        params: { threshold: 0.2 },
        closed: 4,
        conservativeTotalPnl: 1,
      },
      {
        algoId: "probe-unsupported",
        family: "sweep-momentum-trail",
        params: { threshold: 0.3 },
        researchCandidateId: "rcid-unsupported",
        candidateConfigHash: "hash-unsupported",
        closed: 4,
        conservativeTotalPnl: 1,
      },
      {
        algoId: "probe-scalp",
        family: "sweep-scalp",
        params: { threshold: 0.3 },
        researchCandidateId: "rcid-scalp",
        candidateConfigHash: "hash-scalp",
        closed: 4,
        conservativeTotalPnl: 1,
      },
    ];
    const result = selectEvidenceProbes(rows, { maxProbes: 3 });

    expect(result.selected).toHaveLength(2);
    expect(result.selected[0]).toMatchObject({
      lane: "exact_linked_evidence_probe",
      evidenceStatus: "evidence_probe_only",
      promotionEligibility: "not_promotion_eligible",
      paperOnly: true,
      exactLinked: true,
      researchCandidateId: "rcid-good",
    });
    const canaryResult = selectEvidenceProbes(rows, { maxProbes: 3, executableOnly: true });
    expect(canaryResult.selected).toHaveLength(1);
    expect(canaryResult.selected[0]).toMatchObject({
      lane: "exact_linked_execution_canary",
      evidenceStatus: "execution_canary_only",
      paperOnly: true,
      exactLinked: true,
      family: "sweep-scalp",
      promotionEligibility: "not_promotion_eligible",
    });
    expect(result.rejected.map((row) => row.reasonCodes).flat()).toEqual(expect.arrayContaining([
      "research_candidate_id_required",
      "unsupported_family",
    ]));
    expect(canaryResult.rejected.find((row) => row.algoId === "probe-good")?.reasonCodes).toContain("not_supported_execution_canary_family");
  });

  it("deterministically materializes missing exact links for supported execution canary rows", () => {
    const rows = materializeExactLinkageForSource({
      runId: "run-canary",
      randomSeed: "seed-canary",
      registry: {
        configHash: "config-hash",
        inputManifestHash: "snapshot-hash",
        costModelHash: "cost-hash",
        riskModelHash: "risk-hash",
        metricsVersion: "robust-v1",
      },
      topMetrics: [{
        algoId: "sweep-scalp-s100-f40-e0-no-only-none",
        algoName: "Sweep Scalp",
        family: "sweep-scalp",
        params: { maxSpread: 0.01, feeBuffer: 0.004, minEdge: 0, sideMode: "no-only" },
        closed: 12,
        independentClosedMarkets: 12,
        daysRepresented: 7,
        robustScore: 4.2,
        officialSettlementCoverage: 0.97,
        walkForwardPass: true,
        walkForwardClosed: 5,
        holdoutPass: false,
        holdoutClosed: 4,
        holdoutSummary: {
          holdoutClosed: 4,
          holdoutMarkets: 4,
          holdoutConservativeClosed: 3,
          holdoutConservativeMarkets: 3,
          holdoutConservativeTotalPnl: -0.12,
          holdoutLowerCi: -0.03,
        },
        conservativeTotalPnl: 0.42,
        promotionVerdict: "reject",
      }],
    });
    expect(rows[0]).toMatchObject({
      researchCandidateId: expect.stringMatching(/^rcid-[a-f0-9]{24}$/),
      candidateConfigHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceRunId: "run-canary",
      sourceSnapshotHash: "snapshot-hash",
      seed: "seed-canary",
    });

    const canaryResult = selectEvidenceProbes(rows, { maxProbes: 1, executableOnly: true });
    expect(canaryResult.selected).toHaveLength(1);
    expect(canaryResult.selected[0]).toMatchObject({
      lane: "exact_linked_execution_canary",
      evidenceStatus: "execution_canary_only",
      sourceRunId: "run-canary",
      family: "sweep-scalp",
      paperOnly: true,
      sourceMetrics: {
        closed: 12,
        independentClosedMarkets: 12,
        daysRepresented: 7,
        conservativeTotalPnl: 0.42,
        robustScore: 4.2,
        officialSettlementCoverage: 0.97,
        walkForwardPass: true,
        walkForwardClosed: 5,
        holdoutPass: false,
        holdoutClosed: 4,
        holdoutMarkets: 4,
        holdoutConservativeClosed: 3,
        holdoutConservativeMarkets: 3,
        holdoutConservativeTotalPnl: -0.12,
        holdoutLowerCi: -0.03,
      },
    });
  });

  it("replaces stale execution canary lineage when a newer run reseeds the same source algo", () => {
    const merged = mergeTopTradersExecutable({
      topTradersExecutable: {
        startedAt: "2026-06-19T19:00:00.000Z",
        stats: {
          "sweep-scalp": {
            sourceAlgoId: "sweep-scalp",
            sourceRunId: "old-run",
            candidateConfigHash: "hash-old",
            lane: "exact_linked_execution_canary",
            evidenceStatus: "execution_canary_only",
            attempts: 9,
            sourceMetrics: { closed: 1, holdoutConservativeTotalPnl: -9 },
          },
        },
        positions: [{ id: "pos-1", status: "open" }],
      },
    }, [{
      id: "generated:sweep-scalp",
      displayId: "E-0001",
      sourceAlgoId: "sweep-scalp",
      family: "sweep-scalp",
      researchCandidateId: "rcid-new",
      candidateConfigHash: "hash-new",
      sourceRunId: "new-run",
      sourceSnapshotHash: "snapshot-new",
      sourceMetrics: { closed: 12, holdoutConservativeTotalPnl: -0.12 },
    }], "2026-06-19T20:00:00.000Z");

    expect(merged.positions).toEqual([{ id: "pos-1", status: "open" }]);
    expect(merged.stats["sweep-scalp"]).toMatchObject({
      sourceRunId: "new-run",
      candidateConfigHash: "hash-new",
      researchCandidateId: "rcid-new",
      attempts: 0,
      sourceMetrics: { closed: 12, holdoutConservativeTotalPnl: -0.12 },
      promotionEligibility: "not_promotion_eligible",
      paperOnly: true,
      exactLinked: true,
    });
  });

  it("diversifies execution canaries across supported families without negative min-edge probes", () => {
    const rows = [
      {
        algoId: "scalp-high",
        algoName: "Scalp High",
        family: "sweep-scalp",
        params: { maxSpread: 0.01, minEdge: 0 },
        researchCandidateId: "rcid-scalp-high",
        candidateConfigHash: "hash-scalp-high",
        closed: 20,
        independentClosedMarkets: 20,
        conservativeTotalPnl: 2,
        robustScore: 10,
      },
      {
        algoId: "scalp-second",
        algoName: "Scalp Second",
        family: "sweep-scalp",
        params: { maxSpread: 0.01, minEdge: 0 },
        researchCandidateId: "rcid-scalp-second",
        candidateConfigHash: "hash-scalp-second",
        closed: 20,
        independentClosedMarkets: 20,
        conservativeTotalPnl: 2,
        robustScore: 9,
      },
      {
        algoId: "liquidity-ok",
        algoName: "Liquidity OK",
        family: "sweep-liquidity-imbalance",
        params: { maxSpread: 0.04, minEdge: 0 },
        researchCandidateId: "rcid-liquidity-ok",
        candidateConfigHash: "hash-liquidity-ok",
        closed: 80,
        independentClosedMarkets: 75,
        conservativeTotalPnl: 1,
        robustScore: -30,
      },
      {
        algoId: "liquidity-negative-edge",
        algoName: "Liquidity Negative Edge",
        family: "sweep-liquidity-imbalance",
        params: { maxSpread: 0.04, minEdge: -0.02 },
        researchCandidateId: "rcid-liquidity-negative-edge",
        candidateConfigHash: "hash-liquidity-negative-edge",
        closed: 80,
        independentClosedMarkets: 75,
        conservativeTotalPnl: 3,
        robustScore: 11,
      },
    ];

    const result = selectEvidenceProbes(rows, { maxProbes: 3, executableOnly: true });

    expect(result.selected.map((probe) => probe.sourceAlgoId)).toEqual([
      "scalp-high",
      "liquidity-ok",
      "scalp-second",
    ]);
    expect(result.selected.map((probe) => probe.family)).toEqual([
      "sweep-scalp",
      "sweep-liquidity-imbalance",
      "sweep-scalp",
    ]);
    expect(result.rejected.find((row) => row.algoId === "liquidity-negative-edge")?.reasonCodes).toContain("negative_min_edge_execution_canary");
  });

  it("prefers side-diverse safe execution canaries over same-side ranking concentration", () => {
    const base = {
      algoName: "Scalp",
      family: "sweep-scalp",
      researchCandidateId: "rcid",
      candidateConfigHash: "hash",
      closed: 20,
      independentClosedMarkets: 20,
      conservativeTotalPnl: 1,
    };
    const rows = [
      {
        ...base,
        algoId: "yes-top",
        researchCandidateId: "rcid-yes-top",
        candidateConfigHash: "hash-yes-top",
        params: { maxSpread: 0.01, minEdge: 0, sideMode: "yes-only" },
        robustScore: 30,
      },
      {
        ...base,
        algoId: "yes-second",
        researchCandidateId: "rcid-yes-second",
        candidateConfigHash: "hash-yes-second",
        params: { maxSpread: 0.01, minEdge: 0, sideMode: "yes-only" },
        robustScore: 29,
      },
      {
        ...base,
        algoId: "no-safe",
        researchCandidateId: "rcid-no-safe",
        candidateConfigHash: "hash-no-safe",
        params: { maxSpread: 0.01, minEdge: 0, sideMode: "no-only" },
        robustScore: 2,
      },
      {
        ...base,
        algoId: "flex-safe",
        researchCandidateId: "rcid-flex-safe",
        candidateConfigHash: "hash-flex-safe",
        params: { maxSpread: 0.01, minEdge: 0, sideMode: "best" },
        robustScore: 1,
      },
    ];

    const result = selectEvidenceProbes(rows, { maxProbes: 3, executableOnly: true });

    expect(result.selected.map((probe) => probe.sourceAlgoId)).toEqual([
      "yes-top",
      "no-safe",
      "flex-safe",
    ]);
  });

  it("selects closed and active target markets from local evidence", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "dogeedge-targets-test-"));
    const storageDir = path.join(dataRoot, "local-worker");
    const framesDir = path.join(dataRoot, "features", "decision-frames");
    mkdirSync(framesDir, { recursive: true });
    mkdirSync(storageDir, { recursive: true });
    writeFileSync(path.join(framesDir, "records.jsonl"), [
      JSON.stringify({
        marketTicker: "KXDOGE15M-CLOSED",
        marketCloseTime: "2026-06-09T12:00:00.000Z",
        family: "sweep-model",
      }),
      JSON.stringify({
        marketTicker: "KXDOGE15M-ACTIVE",
        marketCloseTime: "2026-06-09T12:45:00.000Z",
        family: "sweep-model",
      }),
    ].join("\n"));

    const selection = await selectTargetMarkets({
      dataRoot,
      storageDir,
      now: "2026-06-09T12:15:00.000Z",
      activeHorizonMinutes: 60,
    });

    expect(selection).toMatchObject({
      schemaVersion: "dogeedge.target-markets.v1",
      closedTargetCount: 1,
      activeTargetCount: 1,
    });
    expect(selection.closedTickers).toContain("KXDOGE15M-CLOSED");
    expect(selection.activeTickers).toContain("KXDOGE15M-ACTIVE");
  });

  it("falls back to provider open DOGE markets for active replay targets", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "dogeedge-provider-targets-test-"));
    const storageDir = path.join(dataRoot, "local-worker");
    mkdirSync(storageDir, { recursive: true });
    const calls: string[] = [];
    const selection = await selectTargetMarkets({
      dataRoot,
      storageDir,
      now: "2026-06-17T14:00:00.000Z",
      maxActiveTargets: 2,
      providerActive: true,
      seriesTicker: "KXDOGE15M",
      fetchImpl: async (url: URL) => {
        calls.push(String(url));
        return {
          ok: true,
          json: async () => ({
            markets: [
              {
                ticker: "KXDOGE15M-26JUN171405-05",
                status: "active",
                close_time: "2026-06-17T14:05:00.000Z",
              },
              {
                ticker: "KXDOGE15M-26JUN171415-15",
                status: "active",
                close_time: "2026-06-17T14:15:00.000Z",
              },
            ],
          }),
        };
      },
    });

    expect(calls[0]).toContain("series_ticker=KXDOGE15M");
    expect(selection.activeTargetCount).toBe(1);
    expect(selection.activeMinLeadMinutes).toBe(10);
    expect(selection.activeTickers).toEqual(["KXDOGE15M-26JUN171415-15"]);
    expect(selection.activeTargets[0].evidenceSources).toContain("kalshi_provider_open_market");
    expect(selection.reasonCodes).not.toContain("active_target_markets_absent");
  });

  it("does not select unknown-close local worker markets for replay capture", async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), "dogeedge-local-targets-test-"));
    const storageDir = path.join(dataRoot, "local-worker");
    mkdirSync(storageDir, { recursive: true });
    writeFileSync(path.join(storageDir, "latest.json"), `${JSON.stringify({
      paperInput: {
        ticker: "KXDOGE15M-NO-CLOSE",
      },
    })}\n`);

    const selection = await selectTargetMarkets({
      dataRoot,
      storageDir,
      now: "2026-06-17T14:00:00.000Z",
      maxActiveTargets: 2,
      providerActive: true,
      seriesTicker: "KXDOGE15M",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          markets: [{
            ticker: "KXDOGE15M-TOO-SOON",
            status: "active",
            close_time: "2026-06-17T14:03:00.000Z",
          }],
        }),
      }),
    });

    expect(selection.activeTargetCount).toBe(0);
    expect(selection.activeTickers).toEqual([]);
    expect(selection.reasonCodes).toContain("active_target_markets_absent");
  });

  it("preflights evidence bootstrap offline without pretending provider auth is ready", async () => {
    const oldKey = process.env.KALSHI_API_KEY_ID;
    const oldPrivateKey = process.env.KALSHI_PRIVATE_KEY_PEM;
    delete process.env.KALSHI_API_KEY_ID;
    delete process.env.KALSHI_PRIVATE_KEY_PEM;
    try {
      const dataRoot = mkdtempSync(path.join(tmpdir(), "dogeedge-preflight-test-"));
      const storageDir = path.join(dataRoot, "local-worker");
      const framesDir = path.join(dataRoot, "features", "decision-frames");
      const backtestsDir = path.join(dataRoot, "backtests");
      const outDir = path.join(dataRoot, "preflight");
      mkdirSync(framesDir, { recursive: true });
      mkdirSync(backtestsDir, { recursive: true });
      mkdirSync(storageDir, { recursive: true });
      writeFileSync(path.join(framesDir, "records.jsonl"), `${JSON.stringify({
        marketTicker: "KXDOGE15M-PREFLIGHT",
        marketCloseTime: "2026-06-09T12:00:00.000Z",
        family: "sweep-model",
      })}\n`);
      const sweep = {
        runId: "preflight-run",
        randomSeed: "preflight-seed",
        candidates: [{
          algoId: "preflight-probe",
          family: "sweep-model",
          params: { threshold: 0.1 },
          researchCandidateId: "rcid-preflight",
          candidateConfigHash: "hash-preflight",
          seed: "seed-preflight",
          closed: 2,
          conservativeTotalPnl: 0.01,
        }],
      };
      const sweepPath = path.join(backtestsDir, "latest-sweep.json");
      writeFileSync(sweepPath, `${JSON.stringify(sweep)}\n`);

      const report = await runEvidencePreflight({
        dataRoot,
        storageDir,
        out: outDir,
        mock: true,
        mockSettlements: "fixture-settlements.jsonl",
        mockReplayRaw: "fixture-replay.jsonl",
        probeSource: sweepPath,
        evidenceOut: path.join(dataRoot, "evidence"),
      });

      expect(report).toMatchObject({
        schemaVersion: "dogeedge.evidence-preflight.v1",
        mockMode: true,
        readyForOfflineBootstrap: true,
        canPlaceOrders: false,
      });
      expect(report.checks.find((check) => check.name === "kalshi_auth_material")).toMatchObject({
        status: "blocked",
        reason: "KALSHI_API_KEY_ID_or_KALSHI_PRIVATE_KEY_PEM_missing",
      });
      expect(JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8"))).toMatchObject({
        schemaVersion: "dogeedge.evidence-preflight.v1",
      });
    } finally {
      if (oldKey === undefined) delete process.env.KALSHI_API_KEY_ID;
      else process.env.KALSHI_API_KEY_ID = oldKey;
      if (oldPrivateKey === undefined) delete process.env.KALSHI_PRIVATE_KEY_PEM;
      else process.env.KALSHI_PRIVATE_KEY_PEM = oldPrivateKey;
    }
  });

  it("separates official forecast calibration from realized trade calibration", () => {
    const forecastRows = forecastCalibrationForDecisionRows([
      { algoId: "cal-a", family: "sweep-model", researchCandidateId: "rcid-cal", candidateConfigHash: "hash-cal", side: "YES", fairProbability: 0.8, officialResolutionAvailable: true, settlementSource: "official_resolution", outcomeSide: "YES" },
      { algoId: "cal-a", family: "sweep-model", researchCandidateId: "rcid-cal", candidateConfigHash: "hash-cal", side: "NO", fairProbability: 0.7, officialResolutionAvailable: true, settlementSource: "official_resolution", outcomeSide: "YES" },
      { algoId: "cal-a", family: "sweep-model", researchCandidateId: "rcid-cal", candidateConfigHash: "hash-cal", side: "YES", fairProbability: 0.99, officialResolutionAvailable: false, settlementSource: "estimated", outcomeSide: "YES" },
    ], { bucketCount: 2 });
    const tradeRows = tradeCalibrationByCandidate([
      { algoId: "cal-a", family: "sweep-model", researchCandidateId: "rcid-cal", candidateConfigHash: "hash-cal", status: "closed", side: "YES", fairProbability: 0.8, pnl: 1 },
      { algoId: "cal-a", family: "sweep-model", researchCandidateId: "rcid-cal", candidateConfigHash: "hash-cal", status: "closed", side: "YES", fairProbability: 0.8, pnl: -1 },
    ], { bucketCount: 2 });

    expect(forecastRows[0]).toMatchObject({
      calibrationKind: "official_forecast",
      labelKnownCount: 2,
      researchCandidateId: "rcid-cal",
      brierScore: expect.any(Number),
    });
    expect(tradeRows[0]).toMatchObject({
      calibrationKind: "trade_outcome",
      labelKnownCount: 2,
      researchCandidateId: "rcid-cal",
      brierScore: expect.any(Number),
    });
  });
});

function marketEvents() {
  const open = normalizeDecisionFrame(baseFrame).frame;
  const close = normalizeDecisionFrame({
    ...baseFrame,
    id: "frame-close",
    capturedAt: "2026-06-01T00:00:29.000Z",
    observedAt: "2026-06-01T00:00:29.000Z",
    secondsToClose: 1,
    estimate: 0.252,
  }).frame;
  const deduped = deduplicateDecisionFrames([open, close]).frames;
  return buildMarketEvents(deduped).events;
}

function pipelineLoadResult(eventCount: number) {
  const frames = [];
  const startMs = Date.parse("2026-06-01T00:00:00.000Z");
  for (let index = 0; index < eventCount; index += 1) {
    const ticker = `KXDOGE15M-MEM-${String(index).padStart(3, "0")}`;
    const closeMs = startMs + (index + 1) * 15 * 60_000;
    const openMs = closeMs - 30_000;
    const labelMs = closeMs - 1_000;
    frames.push(
      normalizeDecisionFrame({
        ...baseFrame,
        id: `${ticker}-open`,
        marketTicker: ticker,
        marketCloseTime: new Date(closeMs).toISOString(),
        capturedAt: new Date(openMs).toISOString(),
        observedAt: new Date(openMs).toISOString(),
        secondsToClose: 30,
        estimate: 0.252 + index * 0.000001,
      }).frame,
      normalizeDecisionFrame({
        ...baseFrame,
        id: `${ticker}-label`,
        marketTicker: ticker,
        marketCloseTime: new Date(closeMs).toISOString(),
        capturedAt: new Date(labelMs).toISOString(),
        observedAt: new Date(labelMs).toISOString(),
        secondsToClose: 1,
        estimate: 0.253 + index * 0.000001,
      }).frame,
    );
  }
  const deduped = deduplicateDecisionFrames(frames.filter(Boolean)).frames;
  return {
    frames: deduped,
    warnings: [],
    errors: [],
    frameCountRaw: deduped.length,
    frameCount: deduped.length,
    duplicateFrameCount: 0,
    overlappingFrameCount: 0,
    eventCount,
  };
}

function event(id: string, start: string, end: string) {
  return {
    id,
    marketTicker: id,
    labelWindowStartMs: Date.parse(start),
    labelWindowEndMs: Date.parse(end),
  };
}

function costModel(id: string, slippageCents: number, minFillProbability: number) {
  return {
    id,
    label: id,
    feeRate: 0.01,
    feePerContract: 0,
    slippageCents,
    spreadPenaltyCents: 0,
    stressSlippageCents: 0,
    maxLatencyMs: 10_000,
    depthShare: 1,
    minFillProbability,
    allowPartialFills: true,
  };
}

function robustMetric(algoId: string) {
  return {
    algoId,
    algoName: algoId,
    family: "test",
    params: { a: 1, b: 2 },
    closed: 100,
    open: 0,
    independentClosedMarkets: 100,
    daysRepresented: 10,
    wins: 60,
    losses: 40,
    winRate: 0.6,
    averagePnl: 0.05,
    totalPnl: 5,
    totalCost: 40,
    roi: 0.125,
    maxDrawdown: -2,
    downsideDeviation: 0.1,
    sharpeLike: 1.3,
    bootstrap: { meanPnl: { lower: 0.01, median: 0.05, upper: 0.1 } },
    costModels: {
      conservative: { totalPnl: 3, bootstrap: { meanPnl: { lower: 0.01, median: 0.03, upper: 0.08 } }, downsideDeviation: 0.1 },
      stress: { totalPnl: 1 },
    },
    foldSummary: { positiveFoldRate: 0.8, foldConsistency: 0.8 },
    cpcvSummary: { positiveFoldRate: 0.8, medianFoldPnl: 1, foldConsistency: 0.8 },
    walkForwardPass: true,
    walkForwardClosed: 20,
    walkForwardTotalPnl: 1,
    walkForwardRoi: 0.1,
    holdoutPass: true,
    holdoutStrictlyLater: true,
    holdoutConservativeTotalPnl: 1,
    holdoutLowerCi: 0.01,
    holdoutSummary: {
      holdoutPass: true,
      holdoutClosed: 20,
      holdoutMarkets: 20,
      holdoutConservativeClosed: 20,
      holdoutConservativeMarkets: 20,
      holdoutConservativeTotalPnl: 1,
      holdoutConservativeRoi: 0.1,
      holdoutLowerCi: 0.01,
      strictlyLater: true,
    },
    paperEvidence: { available: false, status: "missing", closedMarkets: 0, closedTrades: 0, totalPnl: null, roi: null, driftOk: true, driftReasons: [], driftScore: 0 },
    familyAdjustedPValue: 0.01,
    globalAdjustedPValue: 0.01,
    falseDiscoveryRisk: 0.01,
    adjustedConfidence: 0.8,
    drift: { driftOk: true, driftReasons: [], driftScore: 0 },
    foldMetrics: [{ closed: 10, totalPnl: 1, roi: 0.1 }],
    closedTrades: Array.from({ length: 100 }, (_, index) => ({
      marketTicker: `m-${index}`,
      closedAt: `2026-06-${String((index % 10) + 1).padStart(2, "0")}T00:00:00.000Z`,
      openedAt: `2026-06-${String((index % 10) + 1).padStart(2, "0")}T00:00:00.000Z`,
      side: index % 2 ? "YES" : "NO",
      pnl: index % 3 ? 0.05 : -0.02,
      entryContext: { regime: { timeToClose: "final_60s" } },
    })),
  };
}

function strictResearchEvidence(algoId: string) {
  return {
    ...robustMetric(algoId),
    promotionVerdict: "paper_only",
    promotionStage: "validation_candidate",
    nonPromotable: false,
    labelSource: "official_resolution",
    settlementSource: "official_resolution",
    officialResolutionAvailable: true,
    officialSettlementCoverage: 1,
    conservativeTotalPnl: 3,
    stressTotalPnl: 1,
    dsrApprox: 0.85,
    pboApprox: 0.1,
    familyAdjustedPValue: 0.05,
    globalAdjustedPValue: 0.05,
    falseDiscoveryRisk: 0.1,
    adjustedConfidence: 0.8,
    paperEvidence: { available: true, driftOk: true, closedMarkets: 50 },
  };
}

function permissivePromotionThresholds() {
  return {
    minResearchMarkets: 1,
    preferredPaperMarkets: 2,
    minDays: 1,
    minPositiveFoldRate: 0.5,
    minConservativeTotalPnl: 0,
    minExpectancyLowerBound: -1,
    maxDrawdown: -100,
    maxConcentrationShare: 1,
    minAdjustedConfidence: 0,
    minClosedTrades: 1,
    minWalkForwardClosed: 1,
    minCpcvPositivePathRate: 0.5,
    minHoldoutClosed: 1,
    minHoldoutMarkets: 1,
    minHoldoutRoi: 0,
    minHoldoutExpectancyLowerBound: -1,
  };
}

function writeReviewExportFixture(input: string) {
  for (const dir of [
    "",
    "factory",
    "trades",
    "frames",
    "simulator",
    "registry",
    "ui",
    "raw/one-week-sample",
    "screens",
  ]) {
    mkdirSync(path.join(input, dir), { recursive: true });
  }
  const events = Array.from({ length: 8 }, (_, index) => ({
    id: `m-${index}`,
    start: Date.parse("2026-06-01T00:00:00.000Z") + index * 15 * 60_000,
    end: Date.parse("2026-06-01T00:15:00.000Z") + index * 15 * 60_000,
  }));
  const frameLines = events.flatMap((item) => [
    {
      frame_id: `${item.id}:open`,
      strategy_id: "fixture",
      market_id: item.id,
      frame_timestamp_utc: new Date(item.start).toISOString(),
      feature_map: { estimate: 0.5, targetPrice: 0.49, yesAsk: 0.45, yesBid: 0.44, noAsk: 0.56, noBid: 0.55, secondsToClose: 900 },
      feature_timestamps: { estimate: new Date(item.start).toISOString() },
      label: "YES",
      label_timestamp_utc: new Date(item.end).toISOString(),
      market_close_timestamp_utc: new Date(item.end).toISOString(),
      regime_tags: { timeToClose: "early" },
    },
  ]);
  const purgedFolds = [
    { id: "purged-1", trainEventIds: ["m-4"], validationEventIds: ["m-0", "m-1"], purgedEventIds: ["m-2"], embargoedEventIds: ["m-3"], embargoMs: 60_000 },
    { id: "purged-2", trainEventIds: ["m-0", "m-1"], validationEventIds: ["m-4"], purgedEventIds: ["m-3", "m-5"], embargoedEventIds: [], embargoMs: 60_000 },
  ];
  const cpcvFolds = [
    { id: "cpcv-1-2", trainEventIds: ["m-5"], validationEventIds: ["m-0", "m-1", "m-2"], purgedEventIds: ["m-3", "m-4"], embargoedEventIds: [], embargoMs: 60_000 },
  ];
  const metric = rankFactoryMetrics([{
    ...robustMetric("fixture-algo"),
    foldMetrics: [{ foldId: "purged-1", closed: 5, totalPnl: 1, roi: 0.1 }],
    cpcvMetrics: [{ foldId: "cpcv-1-2", closed: 5, totalPnl: 1, roi: 0.1 }],
    cpcvTrainMetrics: [{ foldId: "cpcv-1-2", closed: 5, totalPnl: 1, roi: 0.1 }],
    executionTelemetry: { conservative: { fillRate: 0.9, averageSlippageCents: 1, averagePartialFillRatio: 1, averageFillProbability: 0.85, queueMisses: 1, staleQuoteRejections: 0, depthRejections: 0 } },
  }], { seed: "fixture", bootstrapIterations: 100 })[0];
  const fullRun = {
    runId: "fixture-run",
    mode: "sweep",
    startedAt: "2026-06-01T00:00:00.000Z",
    finishedAt: "2026-06-01T00:01:00.000Z",
    dataRoot: "_DATA_ROOT_",
    framesDir: "_DATA_ROOT_/features/decision-frames",
    gitCommit: "abc",
    codeVersion: "abc",
    randomSeed: "fixture",
    configHash: "cfg",
    dataHash: "data",
    dataQuality: { rawFrames: 8, usableFrames: 8, duplicateFramesRemoved: 0, overlappingFramesDownsampled: 0, marketEvents: 8, warningCount: 0, errorCount: 0 },
    split: { trainEventIds: ["m-0", "m-1"], validationEventIds: ["m-2"], testEventIds: ["m-3"], holdoutEventIds: ["m-6", "m-7"] },
    purgedFolds,
    cpcvFolds,
    holdoutDefinition: { immutable: true, strictlyLater: true, reason: "ok", holdoutEventIds: ["m-6", "m-7"] },
    costModels: [costModel("base", 0, 1), costModel("conservative", 1, 0.85)],
    metrics: [metric],
    candidates: [],
    registry: { inputManifestHash: "manifest", trialCount: 1 },
  };
  const registry = {
    gitCommit: "abc",
    codeVersion: "abc",
    dataRoot: "_DATA_ROOT_",
    framesDir: "_DATA_ROOT_/features/decision-frames",
    inputManifestHash: "manifest",
    inputFiles: [{ relativePath: "records.jsonl", byteSize: 1, sha256: "hash" }],
    dataHash: "manifest",
    configHash: "cfg",
    trialCount: 1,
    families: { test: 1 },
    parameterHashes: { "fixture-algo": "hash" },
    foldDefinitions: purgedFolds,
    cpcvFoldDefinitions: cpcvFolds,
    holdoutDefinition: { immutable: true, strictlyLater: true, reason: "ok", holdoutEventIds: ["m-6", "m-7"] },
    costModel: [costModel("base", 0, 1)],
    riskModel: { maxContractsPerTrade: 10 },
    metricsVersion: "robust-v1",
    randomSeed: "fixture",
  };
  writeFileSync(path.join(input, "repo-snapshot.txt"), "repo_path=_REPO_ROOT_\ngit_rev_parse_head=abc\ngit_status_porcelain=CLEAN\ngit_branch=main\nnode_version=v26.1.0\nnpm_version=10\nos=test\nexport_created_at_utc=2026-06-01T00:00:00.000Z\n");
  writeFileSync(path.join(input, "factory", "factory-full-run.json"), `${JSON.stringify(fullRun)}\n`);
  writeFileSync(path.join(input, "trades", "per-trade.csv"), "trade_id,strategy_id,market_id,side,size,price,timestamp_utc,fill_type,top_of_book_size,top_of_book_bid,top_of_book_ask,latency_ms\n");
  writeFileSync(path.join(input, "frames", "decision-frames.sample.ndjson"), `${frameLines.map((row) => JSON.stringify(row)).join("\n")}\n`);
  writeFileSync(path.join(input, "frames", "decision-frame-manifest.json"), JSON.stringify({ sourceFiles: ["records.jsonl"], rowCounts: { sample: frameLines.length } }));
  writeFileSync(path.join(input, "simulator", "simulator-config.json"), JSON.stringify({ seed: "fixture", costModels: [costModel("base", 0, 1), costModel("conservative", 1, 0.85)] }));
  writeFileSync(path.join(input, "registry", "experiment-registry.json"), `${JSON.stringify(registry)}\n`);
  writeFileSync(path.join(input, "ui", "latest-sweep.json"), JSON.stringify({ runId: "fixture-run", mode: "sweep", topMetrics: [metric], candidates: [], algoCount: 1 }));
  writeFileSync(path.join(input, "ui", "candidates.json"), "[]\n");
  writeFileSync(path.join(input, "ui", "report.md"), "# Fixture\n");
  writeFileSync(path.join(input, "raw", "one-week-sample", "sample-manifest.json"), JSON.stringify({ rowCounts: { snapshots: 0 } }));
}

function writeReviewBundleFixture(input: string) {
  writeReviewExportFixture(input);
  for (const dir of [
    "repo",
    "snapshots",
    "snapshots/raw_market_ticks",
  ]) {
    mkdirSync(path.join(input, dir), { recursive: true });
  }

  const rawTickManifest = {
    schemaVersion: "dogeedge.raw-market-ticks.manifest.v1",
    snapshotId: "snap-fixture",
    generatedAt: "2026-06-01T00:00:00.000Z",
    available: false,
    format: null,
    requestedFormat: "jsonl",
    exportedFormat: null,
    availabilityStatus: "target_samples_absent",
    reason: "No matching JSONL raw-tick sample rows were found for the target review markets.",
    targetMarketCount: 2,
    coveredTargetMarkets: [],
    uncoveredTargetMarkets: ["m-0", "m-1"],
    coveredTargetMarketCount: 0,
    uncoveredTargetMarketCount: 2,
    jsonlFiles: [],
    sourceSnapshotFiles: [{ relativePath: "raw/snapshots/records.jsonl", bytes: 60_000_000, sha256: null, hashSkipped: true }],
    sourceSnapshotFileCount: 1,
    hashedSourceSnapshotFileCount: 0,
    hashSkippedSourceSnapshotFileCount: 1,
    sourceHashPolicy: {
      sha256MaxBytes: 50 * 1024 * 1024,
      hashedFileCount: 0,
      skippedLargeFileCount: 1,
      totalSourceBytes: 60_000_000,
      hashedSourceBytes: 0,
      hashSkippedSourceBytes: 60_000_000,
      hashSkippedByteRatio: 1,
    },
    warningCodes: [
      "raw_market_tick_parquet_absent",
      "raw_market_tick_jsonl_absent",
      "raw_market_tick_target_coverage_gap",
    ],
  };
  const bundleManifest = {
    schemaVersion: "dogeedge.eval.review.bundle.v1",
    bundleId: "dogeedge-review-bundle-fixture",
    generatedAt: "2026-06-01T00:00:00.000Z",
    snapshotId: "snap-fixture",
    rowExport: {
      mode: "capped",
      includeRows: true,
      rowsCapped: true,
      rowCap: 1000,
      promotionReviewComplete: false,
    },
    rawMarketTickExport: {
      manifestPresent: true,
      parseOk: true,
      available: false,
      format: null,
      requestedFormat: "jsonl",
      exportedFormat: null,
      availabilityStatus: "target_samples_absent",
      reason: rawTickManifest.reason,
      targetMarketCount: 2,
      jsonlFileCount: 0,
      sourceSnapshotFileCount: 1,
      targetMarketCoverage: {
        covered: 0,
        uncovered: 2,
        ratio: 0,
      },
      sourceHash: {
        hashedFileCount: 0,
        skippedLargeFileCount: 1,
        sha256MaxBytes: 50 * 1024 * 1024,
        totalSourceBytes: 60_000_000,
        hashedSourceBytes: 0,
        hashSkippedSourceBytes: 60_000_000,
        hashSkippedByteRatio: 1,
      },
      warningCodes: rawTickManifest.warningCodes,
    },
    limitations: [
      "rows_capped",
      "raw_market_tick_jsonl_absent",
      "raw_market_tick_target_coverage_gap",
    ],
    files: [],
  };

  writeFileSync(path.join(input, "manifest.json"), `${JSON.stringify(bundleManifest)}\n`);
  writeFileSync(path.join(input, "repo", "latest-sweep.json"), readFileSync(path.join(input, "ui", "latest-sweep.json"), "utf8"));
  writeFileSync(path.join(input, "snapshots", "decision_frames.jsonl"), readFileSync(path.join(input, "frames", "decision-frames.sample.ndjson"), "utf8"));
  writeFileSync(path.join(input, "snapshots", "trades.csv"), "tradeId,algoId,pnl\ntrade-1,fixture-algo,0.10\n");
  writeFileSync(path.join(input, "snapshots", "leakage_audit.json"), `${JSON.stringify({ postCloseRowsDetected: 0, postCloseRowsExcluded: 0, duplicateFramesRemoved: 0, overlappingFramesDownsampled: 0 })}\n`);
  writeFileSync(path.join(input, "snapshots", "research_live_alignment.json"), `${JSON.stringify({ researchAlgoCount: 1, liveAlgoCount: 0, overlapByIdCount: 0, overlapByFamilyCount: 0, unsupportedLiveAlgoCount: 0 })}\n`);
  writeFileSync(path.join(input, "snapshots", "roster_alignment.tsv.gz"), "snapshotId\talgoId\nsnap-fixture\tfixture-algo\n");
  writeFileSync(path.join(input, "snapshots", "promotion_gate_results.tsv.gz"), "snapshotId\talgoId\tgatePass\nsnap-fixture\tfixture-algo\tfalse\n");
  writeFileSync(path.join(input, "snapshots", "post_close_frame_audit.tsv.gz"), "snapshotId\tpostCloseRowsDetected\nsnap-fixture\t0\n");
  writeFileSync(path.join(input, "snapshots", "raw_market_ticks", "manifest.json"), `${JSON.stringify(rawTickManifest)}\n`);
}
