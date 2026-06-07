import { describe, expect, it } from "vitest";
import {
  defaultRiskConfig,
  estimateFinalMinuteSettlement,
  evaluateRiskGate,
  evaluateStrategy,
  promoteStrategy,
  type KalshiOrderBook,
  type PriceSample,
} from "./doge";

const sample = (price: number, index: number): PriceSample => ({
  observedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  price,
  source: "coinbase:doge-usd",
  latencyMs: 24,
});

const book: KalshiOrderBook = {
  yesBids: [{ price: 0.62, size: 100 }],
  yesAsks: [{ price: 0.65, size: 100 }],
  noBids: [{ price: 0.32, size: 100 }],
  noAsks: [{ price: 0.35, size: 100 }],
  observedAt: new Date().toISOString(),
};

describe("DOGE settlement estimator", () => {
  it("marks a final-minute average as hard to flip when remaining prices cannot plausibly cross target", () => {
    const samples = Array.from({ length: 52 }, (_, index) => sample(0.242, index));
    const estimate = estimateFinalMinuteSettlement(0.235, samples, 0.241, { plausibleMoveBuffer: 0.002 });

    expect(estimate.completedSeconds).toBe(52);
    expect(estimate.remainingSeconds).toBe(8);
    expect(estimate.couldStillFlip).toBe(false);
    expect(estimate.confidence).toBeGreaterThanOrEqual(80);
  });

  it("keeps confidence lower when the remaining window can still flip the result", () => {
    const samples = Array.from({ length: 30 }, (_, index) => sample(index % 2 === 0 ? 0.236 : 0.234, index));
    const estimate = estimateFinalMinuteSettlement(0.235, samples, 0.235, { plausibleMoveBuffer: 0.003 });

    expect(estimate.couldStillFlip).toBe(true);
    expect(estimate.confidenceLabel).not.toBe("high");
  });
});

describe("strategy and risk gates", () => {
  it("blocks live trading while paper-only safety defaults are active", () => {
    const estimate = estimateFinalMinuteSettlement(0.235, Array.from({ length: 56 }, (_, index) => sample(0.244, index)), 0.244);
    const decision = evaluateStrategy({
      targetPrice: 0.235,
      estimate,
      yesAsk: 0.65,
      noAsk: 0.35,
      feeRate: 0.01,
      spreadPenalty: 0.01,
      strategyVersion: "final-60-lock-v1",
    });
    const gate = evaluateRiskGate({
      decision,
      book,
      latestSample: sample(0.244, 59),
      secondsToClose: 40,
      dailyLiveCostUsd: 0,
      openLivePositions: 0,
    });

    expect(gate.status).toBe("blocked");
    expect(gate.reasons).toContain("paper-only mode is active");
    expect(gate.reasons).toContain("kill switch is armed");
  });

  it("allows a tiny live order only when every live gate is clear", () => {
    const estimate = estimateFinalMinuteSettlement(0.235, Array.from({ length: 58 }, (_, index) => sample(0.248, index)), 0.248);
    const decision = evaluateStrategy({
      targetPrice: 0.235,
      estimate,
      yesAsk: 0.65,
      noAsk: 0.35,
      feeRate: 0.005,
      spreadPenalty: 0.006,
      strategyVersion: "final-60-lock-v1",
    });
    const gate = evaluateRiskGate({
      decision: { ...decision, sizeContracts: 3 },
      book,
      latestSample: sample(0.248, 59),
      secondsToClose: 34,
      dailyLiveCostUsd: 2,
      openLivePositions: 0,
    }, {
      ...defaultRiskConfig,
      paperOnly: false,
      killSwitchArmed: false,
      liveEnabled: true,
    });

    expect(gate.status).toBe("allowed");
    expect(gate.maxCostUsd).toBeLessThanOrEqual(5);
  });
});

describe("strategy promotion", () => {
  it("requires paper evidence before tiny live promotion", () => {
    expect(promoteStrategy({
      trades: 180,
      roi: 0.18,
      maxDrawdown: 0.11,
      winRate: 0.61,
      edgeCapture: 0.62,
      paperTrades: 5,
      paperEdgePreserved: true,
      dataQuality: 0.92,
    })).toBe("Walk-Forward Passed");

    expect(promoteStrategy({
      trades: 220,
      roi: 0.2,
      maxDrawdown: 0.1,
      winRate: 0.63,
      edgeCapture: 0.67,
      paperTrades: 45,
      paperEdgePreserved: true,
      dataQuality: 0.95,
    })).toBe("Tiny Live Enabled");
  });
});
