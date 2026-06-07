import { describe, expect, it } from "vitest";
import { normalizeDecisionFrame } from "../../scripts/factory/schema.mjs";
import { buildMarketEvents, deduplicateDecisionFrames } from "../../scripts/factory/data.mjs";
import { purgedEmbargoFolds } from "../../scripts/factory/splits.mjs";
import { simulateAlgoEvents } from "../../scripts/factory/simulator.mjs";
import { metricsForAlgo } from "../../scripts/factory/metrics.mjs";
import { rankFactoryMetrics } from "../../scripts/factory/ranking.mjs";
import { promotionReview } from "../../scripts/factory/promotion.mjs";
import { runFactoryResearchPipeline } from "../../scripts/factory/pipeline.mjs";

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

