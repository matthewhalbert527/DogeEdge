import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeDecisionFrame } from "../../scripts/factory/schema.mjs";
import { buildMarketEvents, deduplicateDecisionFrames } from "../../scripts/factory/data.mjs";
import { purgedEmbargoFolds } from "../../scripts/factory/splits.mjs";
import { simulateAlgoEvents } from "../../scripts/factory/simulator.mjs";
import { metricsForAlgo } from "../../scripts/factory/metrics.mjs";
import { rankFactoryMetrics } from "../../scripts/factory/ranking.mjs";
import { promotionReview } from "../../scripts/factory/promotion.mjs";
import { runFactoryResearchPipeline } from "../../scripts/factory/pipeline.mjs";
import { finalHoldoutSplit } from "../../scripts/factory/holdout.mjs";
import { detectEvidenceDrift } from "../../scripts/factory/drift.mjs";
import { compareInputManifest, decisionFrameInputManifest } from "../../scripts/factory/repro.mjs";
import { paperEvidenceForAlgo, readPaperEvidence } from "../../scripts/factory/paper-evidence.mjs";
import { markdownReport, metricsCsv } from "../../scripts/factory/reporting.mjs";

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

  it("warns instead of failing on stale non-live post-close frames", () => {
    const result = normalizeDecisionFrame({
      ...baseFrame,
      marketLive: false,
      observedAt: "2026-06-01T00:01:00.000Z",
      capturedAt: "2026-06-01T00:01:00.000Z",
      marketCloseTime: "2026-06-01T00:00:00.000Z",
      secondsToClose: 0,
    });

    expect(result.frame).not.toBeNull();
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.join(" ")).toContain("non-live");
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
  });

  it("increases multiple-testing penalty as trial count grows", () => {
    const metric = robustMetric("algo-0");
    const one = rankFactoryMetrics([metric])[0];
    const many = rankFactoryMetrics(Array.from({ length: 50 }, (_, index) => robustMetric(`algo-${index}`))).find((item) => item.algoId === "algo-0");

    expect(many?.multipleTestingPenalty).toBeGreaterThan(one.multipleTestingPenalty);
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
    };
    const strong = {
      ...robustMetric("strong-cpcv"),
      totalPnl: 10,
      cpcvSummary: { positiveFoldRate: 1, medianFoldPnl: 2 },
    };

    const ranked = rankFactoryMetrics([weak, strong], { bootstrapIterations: 100 });

    expect(ranked[0].algoId).toBe("strong-cpcv");
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
      paperTrades: Array.from({ length: 10 }, () => ({ pnl: -0.2 })),
      validationRegimes: { final_60s: 1 },
      paperRegimes: { early: 1 },
      validationFill: { fillRate: 0.95, avgSlippage: 0.01 },
      paperFill: { fillRate: 0.2, avgSlippage: 0.08 },
    });

    expect(stable.driftOk).toBe(true);
    expect(drifted.driftOk).toBe(false);
    expect(drifted.driftReasons).toEqual(expect.arrayContaining(["regime_share_drift", "fill_quality_drift"]));
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
    expect(csv).toContain("dsrApprox");
    expect(csv).toContain("pboApprox");
    expect(report).toContain("Approximation Notes");
    expect(Object.prototype.hasOwnProperty.call(metric, "dsrApprox")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(metric, "pboApprox")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(metric, "dsr")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(metric, "pbo")).toBe(false);
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
