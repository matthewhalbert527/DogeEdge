import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
import { applyFamilySearchBudget, searchBudgetDecision } from "../../scripts/factory/search-budget.mjs";
import { normalizeKalshiHistoricalMarket, officialOutcomeMap, officialSettlementCoverageForEvents } from "../../scripts/factory/official-settlement.mjs";
import { compactReplayTickRow, rawTickReplayManifest } from "../../scripts/factory/raw-tick-extract.mjs";
import { replayParityReportFromManifest } from "../../scripts/factory/replay-coverage.mjs";
import { buildExecutableReadinessGate } from "../../scripts/factory/readiness-gate.mjs";
import { probabilityCalibrationForTrades } from "../../scripts/factory/probability-calibration.mjs";
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
    expect(finalReview).toContain("Raw ticks: target_samples_absent");
    expect(finalReview).toContain("Coverage: 0/2 target markets");
    expect(finalReview).toContain("raw_market_tick_jsonl_absent");
    expect(finalReview).toContain("Uncovered target sample: m-0, m-1");
    expect(finalReview).toContain("skipped bytes: 60000000/60000000 (100%)");
    expect(finalReview).toContain("Hash-skipped source sample: raw/snapshots/records.jsonl (60000000 bytes)");
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

  it("computes proper scoring diagnostics only from label-known closed trades", () => {
    const calibration = probabilityCalibrationForTrades([
      { status: "closed", pnl: 1, entryContext: { fairProbability: 0.8 } },
      { status: "closed", pnl: -1, entryContext: { fairProbability: 0.7 } },
      { status: "open", pnl: null, entryContext: { fairProbability: 0.99 } },
      { status: "closed", pnl: null, entryContext: { fairProbability: 0.1 } },
    ], { bucketCount: 5 });

    expect(calibration).toMatchObject({
      schemaVersion: "dogeedge.probability-calibration.v1",
      labelKnownCount: 2,
      calibrationReady: false,
      brierScore: expect.any(Number),
      logLoss: expect.any(Number),
      expectedCalibrationError: expect.any(Number),
    });
    expect(calibration.reliabilityBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);
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
