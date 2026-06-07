import { describe, expect, it } from "vitest";
import {
  advanceLearningState,
  buildLearningReport,
  emptyLearningState,
  type LearningState,
} from "./learning";
import type { PaperEngineInput, PaperStrategyId, PaperTrade, PaperTradeContext } from "./paper";

const baseInput: PaperEngineInput = {
  observedAt: "2026-05-31T05:00:00.000Z",
  marketLive: true,
  ticker: "KXDOGE15M-26MAY310500-235",
  title: "DOGE above target in next 15 minutes",
  targetPrice: 0.235,
  estimate: 0.244,
  spotPrice: 0.244,
  oneMinuteChange: 0.00008,
  fairProbability: 0.83,
  action: "buy_yes",
  confidence: 84,
  edgeAfterFees: 0.08,
  sizeContracts: 4,
  secondsToClose: 42,
  yesAsk: 0.7,
  noAsk: 0.31,
  yesBid: 0.67,
  noBid: 0.28,
};

describe("learning strategy lab", () => {
  it("runs shadow variants without changing real paper state", () => {
    const next = advanceLearningState(emptyLearningState, baseInput);

    expect(next.shadow.trades.map((trade) => trade.variantId)).toEqual(expect.arrayContaining([
      "final60Strict",
      "final60Aggressive",
      "spreadScalpMax4c",
      "momentum003",
    ]));
    expect(next.shadow.trades.every((trade) => trade.entryContext.edgeAfterFees > 0)).toBe(true);
  });

  it("settles shadow variants and reports the best one", () => {
    const opened = advanceLearningState(emptyLearningState, baseInput);
    const settled = advanceLearningState(opened, {
      ...baseInput,
      observedAt: "2026-05-31T05:15:01.000Z",
      ticker: "KXDOGE15M-26MAY310515-235",
      estimate: 0.246,
      secondsToClose: 42,
    });
    const report = buildLearningReport({ trades: [], events: [] }, settled);

    expect(settled.shadow.trades.some((trade) => trade.status === "closed" && trade.result === "Win")).toBe(true);
    expect(report.bestShadowVariant).not.toBeNull();
    expect(report.bestShadowVariant?.closed).toBeGreaterThan(0);
  });

  it("flags weak momentum performance when wide spreads underperform", () => {
    const report = buildLearningReport({
      trades: [
        closedTrade("momentumFlip", "Momentum Flip", -0.2, context({ spread: 0.07, secondsToClose: 50 })),
        closedTrade("momentumFlip", "Momentum Flip", -0.1, context({ spread: 0.08, secondsToClose: 48 })),
        closedTrade("momentumFlip", "Momentum Flip", 0.3, context({ spread: 0.02, secondsToClose: 44 })),
        closedTrade("momentumFlip", "Momentum Flip", 0.2, context({ spread: 0.03, secondsToClose: 42 })),
      ],
      events: [],
    }, emptyLearningState);

    expect(report.insights.find((insight) => insight.id === "momentum-spread")).toMatchObject({
      tone: "warning",
      sampleSize: 4,
    });
    expect(report.strategyMetrics.find((metric) => metric.strategyId === "momentumFlip")).toMatchObject({
      closed: 4,
      wins: 2,
      losses: 2,
    });
    expect(report.bestAlgoProjection).toMatchObject({
      algorithmName: "Momentum Flip",
      dailyBudget: 50,
      projectedDailyProfit: 5,
      projectedDailyValue: 55,
    });
  });

  it("normalizes invalid learning state to an empty lab", () => {
    const report = buildLearningReport({ trades: [], events: [] }, { shadow: { trades: [{ bad: true }], events: [{ bad: true }] } } as unknown as LearningState);

    expect(report.shadowMetrics.every((metric) => metric.closed === 0 && metric.open === 0)).toBe(true);
  });
});

function closedTrade(strategyId: PaperStrategyId, strategyName: string, pnl: number, entryContext: PaperTradeContext): PaperTrade {
  return {
    id: `trade-${strategyId}-${entryContext.selectedSpread}-${pnl}`,
    strategyId,
    strategyName,
    marketTicker: "KXDOGE15M-26MAY310500-235",
    marketTitle: "DOGE above target",
    side: "YES",
    contracts: 1,
    entryPrice: 0.5,
    exitPrice: 0.5 + pnl,
    targetPrice: entryContext.targetPrice,
    openedAt: entryContext.observedAt,
    closedAt: "2026-05-31T05:15:00.000Z",
    status: "closed",
    result: pnl > 0 ? "Win" : "Loss",
    pnl,
    feesPaid: 0,
    entryEstimate: entryContext.estimate,
    lastEstimate: entryContext.estimate,
    reason: "test trade",
    entryContext,
    exitContext: entryContext,
  };
}

function context({ spread, secondsToClose }: { spread: number; secondsToClose: number }): PaperTradeContext {
  return {
    observedAt: "2026-05-31T05:00:00.000Z",
    side: "YES",
    targetPrice: 0.235,
    estimate: 0.236,
    spotPrice: 0.236,
    oneMinuteChange: 0.00008,
    oneMinuteMovePercent: 0.0003,
    distanceFromTarget: 0.001,
    fairProbability: 0.65,
    edgeAfterFees: 0.05,
    confidence: 74,
    secondsToClose,
    yesAsk: 0.5,
    noAsk: 0.51,
    yesBid: 0.5 - spread,
    noBid: 0.49,
    selectedAsk: 0.5,
    selectedBid: 0.5 - spread,
    selectedSpread: spread,
    yesSpread: spread,
    noSpread: 0.02,
  };
}
