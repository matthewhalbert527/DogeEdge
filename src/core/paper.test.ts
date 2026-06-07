import { describe, expect, it } from "vitest";
import {
  advancePaperStrategies,
  advancePaperState,
  defaultPaperAlgoUpgrades,
  defaultPaperStrategies,
  emptyPaperState,
  normalizeEnabledStrategies,
  normalizeGeneratedPaperAlgos,
  normalizePaperAlgoUpgrades,
  normalizePaperState,
  paperSummary,
  type GeneratedPaperAlgo,
  type PaperEngineInput,
} from "./paper";

const baseInput: PaperEngineInput = {
  observedAt: "2026-05-31T05:00:00.000Z",
  marketLive: true,
  ticker: "KXDOGE15M-26MAY310500-235",
  title: "DOGE below target in next 15 minutes",
  targetPrice: 0.245,
  estimate: 0.244,
  spotPrice: 0.244,
  oneMinuteChange: -0.00008,
  fairProbability: 0.17,
  action: "buy_no",
  confidence: 84,
  edgeAfterFees: 0.08,
  sizeContracts: 4,
  secondsToClose: 42,
  yesAsk: 0.7,
  noAsk: 0.31,
  yesBid: 0.69,
  noBid: 0.3,
};

describe("paper trading engine", () => {
  it("opens a paper buy from a live positive-edge model signal", () => {
    const next = advancePaperState(emptyPaperState, baseInput);

    expect(next.trades).toHaveLength(1);
    expect(next.trades[0]).toMatchObject({
      marketTicker: baseInput.ticker,
      side: "NO",
      entryPrice: 0.31,
      contracts: 4,
      status: "open",
    });
    expect(next.trades[0].entryContext).toMatchObject({
      confidence: 84,
      edgeAfterFees: 0.08,
      secondsToClose: 42,
      selectedSpread: 0.01,
      distanceFromTarget: -0.001,
    });
    expect(next.events[0]).toMatchObject({
      action: "BUY",
      side: "NO",
      price: 0.31,
      status: "open",
    });
    expect(paperSummary(next)).toMatchObject({ buys: 1, sells: 0, open: 1 });
  });

  it("sells an open paper position when the model flips sides", () => {
    const opened = advancePaperState(emptyPaperState, baseInput);
    const closed = advancePaperState(opened, {
      ...baseInput,
      observedAt: "2026-05-31T05:00:11.000Z",
      action: "buy_yes",
      estimate: 0.246,
      oneMinuteChange: 0.00008,
      fairProbability: 0.84,
      confidence: 91,
      edgeAfterFees: 0.2,
      yesAsk: 0.6,
      yesBid: 0.59,
      noAsk: 0.8,
      noBid: 0.76,
    });

    const soldNo = closed.trades.find((trade) => trade.status === "closed" && trade.side === "NO");
    const newYes = closed.trades.find((trade) => trade.status === "open" && trade.side === "YES");

    expect(soldNo).toMatchObject({
      status: "closed",
      exitPrice: 0.76,
      result: "Win",
      pnl: 1.8,
    });
    expect(soldNo?.exitContext).toMatchObject({
      selectedBid: 0.76,
      secondsToClose: 42,
    });
    expect(newYes).toMatchObject({
      status: "open",
      entryPrice: 0.6,
    });
    expect(closed.events[0]).toMatchObject({
      action: "BUY",
      side: "YES",
    });
    expect(closed.events[1]).toMatchObject({
      action: "SELL",
      side: "NO",
      result: "Win",
      pnl: 1.8,
    });
    expect(paperSummary(closed)).toMatchObject({ buys: 2, sells: 1, open: 1, wins: 1, losses: 0, totalPnl: 1.8 });
  });

  it("settles open paper positions when the contract rolls to a new ticker", () => {
    const opened = advancePaperState(emptyPaperState, {
      ...baseInput,
      noAsk: 0.31,
      noBid: 0.3,
    });
    const settled = advancePaperState(opened, {
      ...baseInput,
      observedAt: "2026-05-31T05:15:01.000Z",
      ticker: "KXDOGE15M-26MAY310515-235",
      estimate: 0.23,
      noAsk: 0.42,
      noBid: 0.4,
    });

    expect(settled.trades.find((trade) => trade.marketTicker === baseInput.ticker)).toMatchObject({
      status: "closed",
      exitPrice: 1,
      result: "Win",
      pnl: 2.76,
    });
    expect(settled.events.some((event) => event.action === "SELL" && event.result === "Win")).toBe(true);
    expect(paperSummary(settled)).toMatchObject({ buys: 2, sells: 1, open: 1, wins: 1, totalPnl: 2.76 });
  });

  it("runs enabled paper strategies independently on the same live input", () => {
    const next = advancePaperStrategies(emptyPaperState, baseInput, defaultPaperStrategies);

    expect(next.trades.map((trade) => trade.strategyId)).toEqual(expect.arrayContaining([
      "final60",
      "thresholdDistance",
      "orderbookScalp",
      "momentumFlip",
    ]));
    expect(next.trades.some((trade) => trade.strategyId === "noTradeSentinel")).toBe(false);
    expect(paperSummary(next, "final60")).toMatchObject({ buys: 1, open: 1 });
    expect(paperSummary(next, "thresholdDistance")).toMatchObject({ buys: 1, open: 1 });
    expect(paperSummary(next, "orderbookScalp")).toMatchObject({ buys: 1, open: 1 });
    expect(paperSummary(next, "momentumFlip")).toMatchObject({ buys: 1, open: 1 });
    expect(paperSummary(next)).toMatchObject({ buys: 4, sells: 0, open: 4 });
  });

  it("puts active YES entries on strict probation", () => {
    const next = advancePaperStrategies(emptyPaperState, {
      ...baseInput,
      targetPrice: 0.243,
      estimate: 0.244,
      oneMinuteChange: 0.00008,
      fairProbability: 0.84,
      action: "buy_yes",
      edgeAfterFees: 0.08,
      yesAsk: 0.7,
      yesBid: 0.67,
    }, defaultPaperStrategies);

    expect(next.trades.every((trade) => trade.side !== "YES")).toBe(true);
  });

  it("blocks momentum entries above a 6c selected spread", () => {
    const next = advancePaperStrategies(emptyPaperState, {
      ...baseInput,
      noBid: 0.2,
    }, defaultPaperStrategies);

    expect(next.trades.some((trade) => trade.strategyId === "momentumFlip")).toBe(false);
  });

  it("blocks scalp entries above a 2c selected spread", () => {
    const next = advancePaperStrategies(emptyPaperState, {
      ...baseInput,
      noBid: 0.28,
    }, defaultPaperStrategies);

    expect(next.trades.some((trade) => trade.strategyId === "orderbookScalp")).toBe(false);
  });

  it("honors disabled strategies for new paper entries", () => {
    const disabled = normalizeEnabledStrategies({
      final60: false,
      thresholdDistance: false,
      orderbookScalp: false,
      momentumFlip: false,
      noTradeSentinel: false,
    });

    const next = advancePaperStrategies(emptyPaperState, baseInput, disabled);

    expect(next.trades).toHaveLength(0);
    expect(next.events).toHaveLength(0);
  });

  it("applies a promoted shadow variant to a future paper strategy slot", () => {
    const next = advancePaperStrategies(emptyPaperState, baseInput, defaultPaperStrategies, {
      ...defaultPaperAlgoUpgrades,
      final60: "final60Strict",
    });

    expect(next.trades.find((trade) => trade.strategyId === "final60")).toMatchObject({
      strategyName: "Final-60 Strict",
      side: "NO",
      status: "open",
    });
  });

  it("ignores promoted variants that do not belong to the requested paper slot", () => {
    const normalized = normalizePaperAlgoUpgrades({
      final60: "momentum003",
      momentumFlip: "momentum003",
    });

    expect(normalized.final60).toBe("standard");
    expect(normalized.momentumFlip).toBe("momentum003");
  });

  it("promotes a generated cheap-longshot sweep algo into live paper entries", () => {
    const generated: GeneratedPaperAlgo = {
      id: "generated:sweep-longshot-a1800-e200-t120-s400-best",
      displayId: "CL-001",
      sourceAlgoId: "sweep-longshot-a1800-e200-t120-s400-best",
      name: "Cheap Longshot A<=18.0c E>=2.0% T>=120s S<=4.0c best",
      family: "sweep-cheap-longshot",
      params: {
        maxAsk: 0.18,
        minEdge: 0.02,
        minSecondsToClose: 120,
        maxSpread: 0.04,
        sideMode: "best",
      },
      enabled: true,
      promotedAt: "2026-05-31T05:00:00.000Z",
      sourceRunId: "sweep-run",
      sourceMetrics: {
        closed: 3,
        wins: 1,
        losses: 2,
        totalPnl: 0.51,
        totalCost: 0.49,
        roi: 1.0408,
        maxDrawdown: -0.16,
      },
    };
    const disabled = normalizeEnabledStrategies({
      final60: false,
      thresholdDistance: false,
      orderbookScalp: false,
      momentumFlip: false,
      noTradeSentinel: false,
    });
    const next = advancePaperStrategies(emptyPaperState, {
      ...baseInput,
      secondsToClose: 180,
      noAsk: 0.16,
      noBid: 0.13,
    }, disabled, defaultPaperAlgoUpgrades, [generated]);

    expect(next.trades).toHaveLength(1);
    expect(next.trades[0]).toMatchObject({
      strategyId: generated.id,
      strategyName: `${generated.displayId} ${generated.name}`,
      side: "NO",
      entryPrice: 0.16,
      status: "open",
    });
    expect(paperSummary(next, generated.id)).toMatchObject({ buys: 1, open: 1 });
  });

  it("can size a generated paper run up to a dollar risk limit", () => {
    const generated: GeneratedPaperAlgo = {
      id: "generated:sweep-scalp-risk-test",
      displayId: "SC-RISK",
      sourceAlgoId: "sweep-scalp-s200-f60-e0-best-strict",
      name: "Sweep Scalp Risk Test",
      family: "sweep-scalp",
      params: { maxSpread: 0.02, feeBuffer: 0.006, minEdge: 0, sideMode: "best", yesMode: "loose" },
      enabled: true,
      promotedAt: "2026-05-31T05:00:00.000Z",
      sourceRunId: "test",
      sourceMetrics: { closed: 10, wins: 6, losses: 4, totalPnl: 1, totalCost: 5, roi: 0.2, maxDrawdown: -1 },
    };
    const disabled = normalizeEnabledStrategies({
      final60: false,
      thresholdDistance: false,
      orderbookScalp: false,
      momentumFlip: false,
      noTradeSentinel: false,
    });
    const next = advancePaperStrategies(emptyPaperState, {
      ...baseInput,
      fairProbability: 0.8,
      yesAsk: 0.4,
      yesBid: 0.39,
      noAsk: 0.7,
      noBid: 0.68,
    }, disabled, defaultPaperAlgoUpgrades, [generated], {
      startingBalance: 50,
      maxCostPerTrade: 10,
      stakeMode: "max-cost",
    });

    expect(next.trades[0]).toMatchObject({
      strategyId: generated.id,
      entryPrice: 0.4,
      contracts: 25,
    });
  });

  it("blocks new arena entries when the configured bankroll is unavailable", () => {
    const next = advancePaperStrategies(emptyPaperState, baseInput, defaultPaperStrategies, defaultPaperAlgoUpgrades, [], {
      startingBalance: 0.2,
      maxCostPerTrade: 10,
      stakeMode: "max-cost",
    });

    expect(paperSummary(next)).toMatchObject({ buys: 0, open: 0 });
  });

  it("caps executable arena entries to visible entry and exit depth", () => {
    const generated = managedScalpAlgo();
    const next = advancePaperStrategies(emptyPaperState, {
      ...baseInput,
      noAskDepth: 20,
      noBidDepth: 20,
    }, disabledStrategies(), defaultPaperAlgoUpgrades, [generated], executableRisk());

    expect(next.trades[0]).toMatchObject({
      strategyId: generated.id,
      side: "NO",
      entryPrice: 0.31,
      contracts: 5,
      status: "open",
    });
    expect(next.trades[0].feesPaid).toBeGreaterThan(0);
    expect(next.trades[0].reason).toContain("Executable fill");
  });

  it("blocks executable arena entries when exit depth is missing", () => {
    const next = advancePaperStrategies(emptyPaperState, {
      ...baseInput,
      noAskDepth: 20,
      noBidDepth: 0,
    }, disabledStrategies(), defaultPaperAlgoUpgrades, [managedScalpAlgo()], executableRisk());

    expect(paperSummary(next)).toMatchObject({ buys: 0, open: 0 });
  });

  it("subtracts estimated executable fees from arena exits", () => {
    const generated = managedScalpAlgo();
    const opened = advancePaperStrategies(emptyPaperState, {
      ...baseInput,
      noAskDepth: 20,
      noBidDepth: 20,
    }, disabledStrategies(), defaultPaperAlgoUpgrades, [generated], executableRisk());
    const closed = advancePaperStrategies(opened, {
      ...baseInput,
      observedAt: "2026-05-31T05:00:11.000Z",
      action: "buy_yes",
      estimate: 0.246,
      fairProbability: 0.84,
      edgeAfterFees: 0.2,
      yesAsk: 0.4,
      yesBid: 0.39,
      yesAskDepth: 20,
      yesBidDepth: 20,
      noAsk: 0.7,
      noBid: 0.5,
      noAskDepth: 20,
      noBidDepth: 20,
    }, disabledStrategies(), defaultPaperAlgoUpgrades, [generated], executableRisk());

    const soldNo = closed.trades.find((trade) => trade.status === "closed" && trade.side === "NO");
    expect(soldNo).toBeDefined();
    expect(soldNo?.feesPaid).toBeGreaterThan(0);
    expect(soldNo?.pnl).toBeLessThan(0.95);
    expect(soldNo?.reason).toContain("Executable exit");
  });

  it("runs a generated momentum-trail scalp and sells after a profitable pullback", () => {
    const generated = momentumTrailAlgo();
    const opened = advancePaperStrategies(emptyPaperState, {
      ...baseInput,
      secondsToClose: 600,
      oneMinuteChange: -0.00009,
      noAsk: 0.31,
      noBid: 0.3,
      noAskDepth: 20,
      noBidDepth: 20,
    }, disabledStrategies(), defaultPaperAlgoUpgrades, [generated], executableRisk());
    const markedHigh = advancePaperStrategies(opened, {
      ...baseInput,
      observedAt: "2026-05-31T05:00:12.000Z",
      secondsToClose: 588,
      oneMinuteChange: -0.00008,
      noAsk: 0.39,
      noBid: 0.38,
      noAskDepth: 20,
      noBidDepth: 20,
    }, disabledStrategies(), defaultPaperAlgoUpgrades, [generated], executableRisk());
    const closed = advancePaperStrategies(markedHigh, {
      ...baseInput,
      observedAt: "2026-05-31T05:00:24.000Z",
      secondsToClose: 576,
      oneMinuteChange: -0.00003,
      noAsk: 0.36,
      noBid: 0.35,
      noAskDepth: 20,
      noBidDepth: 20,
    }, disabledStrategies(), defaultPaperAlgoUpgrades, [generated], executableRisk());

    expect(opened.trades[0]).toMatchObject({
      strategyId: generated.id,
      side: "NO",
      status: "open",
      bestExitPrice: 0.3,
    });
    expect(markedHigh.trades[0]).toMatchObject({
      status: "open",
      bestExitPrice: 0.38,
    });
    expect(closed.trades[0]).toMatchObject({
      status: "closed",
      exitPrice: 0.35,
      result: "Win",
    });
    expect(closed.trades[0].reason).toContain("trailing pullback exit");
  });

  it("runs a generated order-flow pressure scalp from book-depth deltas", () => {
    const generated: GeneratedPaperAlgo = {
      id: "generated:test-of-001",
      displayId: "OF-001",
      sourceAlgoId: "order-flow-pressure-test",
      name: "Order Flow Pressure",
      family: "sweep-order-flow-pressure",
      params: {
        minPressure: 0.2,
        maxSpread: 0.02,
        minEdge: 0.08,
        feeBuffer: 0.014,
        minBidDepth: 2,
        minAskDepth: 1,
        minSecondsToClose: 20,
        minMovePercent: 0,
        sideMode: "pressure",
        yesMode: "loose",
        takeProfit: 0.05,
        stopLoss: 0.04,
        maxHoldSeconds: 120,
      },
      enabled: true,
      promotedAt: "2026-05-31T05:00:00.000Z",
      sourceRunId: "test",
      sourceMetrics: {
        closed: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        totalCost: 0,
        roi: 0,
        maxDrawdown: 0,
      },
    };
    const next = advancePaperStrategies(
      emptyPaperState,
      {
        ...baseInput,
        secondsToClose: 180,
        fairProbability: 0.35,
        noAsk: 0.33,
        noBid: 0.32,
        yesAsk: 0.67,
        yesBid: 0.66,
        noBidDepth: 12,
        yesBidDepth: 2,
        noAskDepth: 4,
        yesAskDepth: 8,
        noBidDepthDelta: 5,
        yesBidDepthDelta: -2,
        noAskDepthDelta: -3,
        yesAskDepthDelta: 1,
        noBidPriceDelta: 0.01,
        yesBidPriceDelta: -0.01,
        noAskPriceDelta: 0.01,
        yesAskPriceDelta: -0.01,
      },
      disabledStrategies(),
      defaultPaperAlgoUpgrades,
      [generated],
    );

    expect(next.trades[0]).toMatchObject({
      strategyId: generated.id,
      side: "NO",
      entryPrice: 0.33,
      status: "open",
    });
    expect(next.trades[0].reason).toContain("order-flow pressure");
  });

  it("promotes a legacy shadow momentum candidate into generated paper entries", () => {
    const generated: GeneratedPaperAlgo = {
      id: "generated:momentum-003:1780257000000",
      displayId: "MO-001",
      sourceAlgoId: "momentum-003",
      name: "Momentum >= 0.03%",
      family: "shadow",
      params: { minMovePercent: 0.0003 },
      enabled: true,
      promotedAt: "2026-05-31T05:00:00.000Z",
      sourceRunId: "sweep-run",
      sourceMetrics: {
        closed: 3,
        wins: 2,
        losses: 1,
        totalPnl: 0.42,
        totalCost: 0.58,
        roi: 0.7241,
        maxDrawdown: -0.12,
      },
    };
    const disabled = normalizeEnabledStrategies({
      final60: false,
      thresholdDistance: false,
      orderbookScalp: false,
      momentumFlip: false,
      noTradeSentinel: false,
    });
    const next = advancePaperStrategies(emptyPaperState, {
      ...baseInput,
      spotPrice: 0.225,
      oneMinuteChange: -0.00012,
      noAsk: 0.31,
      noBid: 0.28,
    }, disabled, defaultPaperAlgoUpgrades, [generated]);

    expect(next.trades[0]).toMatchObject({
      strategyId: generated.id,
      strategyName: `${generated.displayId} ${generated.name}`,
      side: "NO",
      status: "open",
    });
  });

  it("normalizes legacy paper records into the default strategy", () => {
    const normalized = normalizePaperState({
      trades: [{
        id: "legacy-trade",
        marketTicker: baseInput.ticker,
        marketTitle: baseInput.title,
        side: "YES",
        contracts: 2,
        entryPrice: 0.4,
        exitPrice: null,
        targetPrice: baseInput.targetPrice,
        openedAt: baseInput.observedAt,
        closedAt: null,
        status: "open",
        result: "-",
        pnl: null,
        entryEstimate: baseInput.estimate,
        lastEstimate: baseInput.estimate,
        reason: "Legacy paper entry.",
      }],
      events: [{
        id: "legacy-event",
        time: baseInput.observedAt,
        action: "BUY",
        marketTicker: baseInput.ticker,
        side: "YES",
        contracts: 2,
        price: 0.4,
        status: "open",
        result: "-",
        pnl: null,
        reason: "Legacy paper event.",
      }],
    });

    expect(normalized.trades[0]).toMatchObject({
      strategyId: "final60",
      strategyName: "Final-60 Lock",
    });
    expect(normalized.events[0]).toMatchObject({
      strategyId: "final60",
      strategyName: "Final-60 Lock",
    });
  });

  it("keeps generated paper algos normalized and capped", () => {
    const normalized = normalizeGeneratedPaperAlgos([{
      sourceAlgoId: "sweep-scalp-s400-f600-e0-best-none",
      name: "Sweep Scalp S<=4.0c",
      family: "sweep-scalp",
      params: { maxSpread: 0.04 },
      sourceMetrics: { closed: 5, totalPnl: 1, roi: 0.5 },
    }]);

    expect(normalized[0]).toMatchObject({
      id: "generated:sweep-scalp-s400-f600-e0-best-none",
      displayId: expect.stringMatching(/^SC-/),
      enabled: true,
      sourceMetrics: {
        closed: 5,
        totalPnl: 1,
        roi: 0.5,
      },
    });
  });
});

function managedScalpAlgo(): GeneratedPaperAlgo {
  return {
    id: "generated:test-ms-001:1780257000000",
    displayId: "MS-001",
    sourceAlgoId: "managed-scalp-test",
    name: "Managed Scalp",
    family: "sweep-managed-scalp",
    params: {
      maxSpread: 0.04,
      minEdge: 0.02,
      feeBuffer: 0.014,
      takeProfit: 0.04,
      stopLoss: 0.04,
      maxHoldSeconds: 180,
      yesMode: "none",
    },
    enabled: true,
    promotedAt: "2026-05-31T05:00:00.000Z",
    sourceRunId: "test",
    sourceMetrics: {
      closed: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      totalCost: 0,
      roi: 0,
      maxDrawdown: 0,
    },
  };
}

function momentumTrailAlgo(): GeneratedPaperAlgo {
  return {
    id: "generated:test-mt-001:1780257000000",
    displayId: "MT-001",
    sourceAlgoId: "momentum-trail-test",
    name: "Momentum Trail",
    family: "sweep-momentum-trail",
    params: {
      minMovePercent: 0.0002,
      maxSpread: 0.02,
      feeBuffer: 0.018,
      boostMultiplier: 150,
      minEdge: 0.04,
      minSecondsToClose: 45,
      takeProfit: 0.2,
      stopLoss: 0.2,
      trailingStop: 0.02,
      trailAfterProfit: 0.02,
      minHoldSeconds: 6,
      maxHoldSeconds: 180,
      exitBeforeClose: 30,
      exitOnMomentumFlip: true,
      momentumExitMovePercent: 0.00008,
      yesMode: "none",
    },
    enabled: true,
    promotedAt: "2026-05-31T05:00:00.000Z",
    sourceRunId: "test",
    sourceMetrics: {
      closed: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      totalCost: 0,
      roi: 0,
      maxDrawdown: 0,
    },
  };
}

function disabledStrategies() {
  return normalizeEnabledStrategies({
    final60: false,
    thresholdDistance: false,
    orderbookScalp: false,
    momentumFlip: false,
    noTradeSentinel: false,
  });
}

function executableRisk() {
  return {
    startingBalance: 50,
    maxCostPerTrade: 10,
    stakeMode: "max-cost" as const,
    executionMode: "executable" as const,
    feeRate: 0.07,
    maxEntrySpread: 0.02,
    minEdgeAfterFees: 0.08,
    maxDepthShare: 0.25,
    minExitDepthContracts: 1,
    maxEntriesPerMarket: 2,
    blockReentryAfterLoss: true,
  };
}
