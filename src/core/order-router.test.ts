import { describe, expect, it } from "vitest";
import {
  buildExecutionPlan,
  buildKalshiOrderPayload,
  normalizeOrderRequest,
  riskCheckOrder,
  routerStatus,
} from "../../api/kalshi/order-router.js";

const status = routerStatus({
  KALSHI_API_KEY_ID: "key",
  KALSHI_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  DOGEEDGE_LIVE_DRY_RUN: "1",
  DOGEEDGE_CONSERVATIVE_MODE: "0",
});

const conservativeStatus = routerStatus({
  KALSHI_API_KEY_ID: "key",
  KALSHI_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  DOGEEDGE_LIVE_DRY_RUN: "1",
  DOGEEDGE_LIVE_MAX_EXPOSURE_DOLLARS: "50",
  DOGEEDGE_CONSERVATIVE_MODE: "1",
});

const liveStatus = routerStatus({
  KALSHI_API_KEY_ID: "key",
  KALSHI_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  DOGEEDGE_LIVE_SWITCH_ENABLED: "1",
  DOGEEDGE_LIVE_TRADING_ENABLED: "1",
  DOGEEDGE_LIVE_DRY_RUN: "0",
  DOGEEDGE_CONSERVATIVE_MODE: "0",
});

const validOrder = {
  algoId: "generated:ms-001",
  algoDisplayId: "MS-001",
  algoName: "Managed Scalp",
  ticker: "KXDOGE15M-26JUN01-T1234",
  side: "yes",
  action: "buy",
  signalAction: "buy_yes",
  count: 10,
  priceCents: 50,
  maxTradeDollars: 10,
};

const freshManagedScalpOrder = {
  ...validOrder,
  ticker: "KXDOGE15M-OLD",
  count: 333,
  priceCents: 3,
  algoFamily: "sweep-managed-scalp",
  algoSourceId: "managed-scalp-test",
  algoParams: {
    maxSpread: 0.04,
    minEdge: 0.02,
    feeBuffer: 0.014,
    yesMode: "none",
  },
  paperInput: {
    observedAt: "2026-06-01T04:00:00.000Z",
    marketLive: true,
    ticker: "KXDOGE15M-OLD",
    title: "DOGE",
    targetPrice: 0.1,
    estimate: 0.101,
    spotPrice: 0.101,
    oneMinuteChange: 0.0001,
    fairProbability: 0.5,
    action: "buy_yes",
    confidence: 90,
    edgeAfterFees: 0.2,
    sizeContracts: 3,
    secondsToClose: 500,
    yesAsk: 0.03,
    noAsk: 0.97,
    yesBid: 0.02,
    noBid: 0.96,
    yesAskDepth: 333,
    noAskDepth: 100,
    yesBidDepth: 100,
    noBidDepth: 100,
  },
  maxSlippageCents: 1,
};

const validSellOrder = {
  ...validOrder,
  ticker: "KXDOGE15M-FRESH",
  side: "no",
  action: "sell",
  signalAction: undefined,
  count: 33,
  priceCents: 30,
  maxTradeDollars: 10,
  maxSlippageCents: 1,
};

function mockFreshMarket({ yesAsk = 0.03, yesAskSize = 333, noBid = 0.97 } = {}) {
  const market = {
    ticker: "KXDOGE15M-FRESH",
    status: "active",
    title: "DOGE fresh",
    yes_sub_title: "Target Price: $0.1000000",
    close_time: "2026-06-01T04:15:00.000Z",
    yes_ask_dollars: yesAsk,
    yes_ask_size_fp: yesAskSize,
    no_ask_dollars: 0.98,
    no_ask_size_fp: 100,
  };
  globalThis.fetch = async (url: string | URL | Request) => {
    const text = String(url);
    if (text.includes("/markets?")) {
      return Response.json({ markets: [market] });
    }
    if (text.includes("/orderbook")) {
      return Response.json({
        orderbook_fp: {
          yes_dollars: [[0.02, 100]],
          no_dollars: [[noBid, yesAskSize]],
        },
      });
    }
    return Response.json({ market });
  };
}

describe("Kalshi live order router", () => {
  it("accepts a tiny selected-algo dry-run order", () => {
    const parsed = normalizeOrderRequest(validOrder, status);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.order.estimatedCostCents).toBe(500);
  });

  it("rejects orders above the backend per-trade cap", () => {
    const parsed = normalizeOrderRequest({
      ...validOrder,
      count: 25,
      priceCents: 50,
    }, status);

    expect(parsed.ok).toBe(false);
  });

  it("accepts max-cost sizing for cheap contracts", () => {
    const parsed = normalizeOrderRequest({
      ...validOrder,
      count: 333,
      priceCents: 3,
    }, status);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.order.estimatedCostCents).toBe(999);
  });

  it("rejects a manual side that does not match the selected algo signal", () => {
    const parsed = normalizeOrderRequest({
      ...validOrder,
      side: "no",
    }, status);

    expect(parsed.ok).toBe(false);
  });

  it("builds a Kalshi immediate-or-cancel buy without buy_max_cost", () => {
    const parsed = normalizeOrderRequest(validOrder, status);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(buildKalshiOrderPayload(parsed.order, "dogeedge-ms-001-test")).toMatchObject({
      ticker: validOrder.ticker,
      side: "yes",
      action: "buy",
      client_order_id: "dogeedge-ms-001-test",
      count: 10,
      yes_price: 50,
      time_in_force: "immediate_or_cancel",
    });
  });

  it("accepts a selected-algo reduce-only sell without a fresh buy signal", () => {
    const parsed = normalizeOrderRequest(validSellOrder, status);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.order.action).toBe("sell");
    expect(parsed.order.signalAction).toBe(null);
  });

  it("builds a Kalshi immediate-or-cancel reduce-only sell", () => {
    const parsed = normalizeOrderRequest(validSellOrder, status);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(buildKalshiOrderPayload(parsed.order, "dogeedge-ms-001-sell")).toMatchObject({
      ticker: validSellOrder.ticker,
      side: "no",
      action: "sell",
      client_order_id: "dogeedge-ms-001-sell",
      count: 33,
      no_price: 30,
      time_in_force: "immediate_or_cancel",
      reduce_only: true,
    });
  });

  it("blocks a buy above current Kalshi balance", () => {
    const parsed = normalizeOrderRequest(validOrder, status);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const risk = riskCheckOrder(parsed.order, {
      balanceCents: 499,
      openPositionCostCents: 0,
      restingBuyCostCents: 0,
      openPositionTickers: [],
      restingOrderTickers: [],
    }, status);

    expect(risk.ok).toBe(false);
  });

  it("blocks buys above the conservative DOGE exposure budget", () => {
    const parsed = normalizeOrderRequest({
      ...validOrder,
      executionProfile: "conservative",
    }, conservativeStatus);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const risk = riskCheckOrder(parsed.order, {
      balanceCents: 10_000,
      openPositionCostCents: 4_700,
      restingBuyCostCents: 0,
      openPositionTickers: [],
      restingOrderTickers: [],
    }, conservativeStatus);

    expect(risk.ok).toBe(false);
    if (risk.ok) return;
    expect(risk.error).toContain("$50.00");
  });

  it("allows additional chunks on a ticker that already has an open position", () => {
    const parsed = normalizeOrderRequest(validOrder, status);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const risk = riskCheckOrder(parsed.order, {
      balanceCents: 10_000,
      openPositionCostCents: 500,
      restingBuyCostCents: 0,
      openPositionTickers: [validOrder.ticker],
      restingOrderTickers: [],
    }, status);

    expect(risk.ok).toBe(true);
  });

  it("does not apply balance spending checks to reduce-only sells", () => {
    const parsed = normalizeOrderRequest({
      ...validSellOrder,
      count: 200,
      priceCents: 50,
    }, status);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const risk = riskCheckOrder(parsed.order, {
      balanceCents: 0,
      openPositionCostCents: 500,
      restingBuyCostCents: 0,
      openPositionTickers: [validSellOrder.ticker],
      restingOrderTickers: [],
    }, status);

    expect(risk.ok).toBe(true);
  });

  it("builds a fresh-book depth-aware plan for standard dry-run routing", async () => {
    const originalFetch = globalThis.fetch;
    mockFreshMarket();
    try {
      const parsed = normalizeOrderRequest(freshManagedScalpOrder, status);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const execution = await buildExecutionPlan(parsed.order, status);

      expect(execution.ok).toBe(true);
      if (!execution.ok) return;
      expect(execution.plan.totalCount).toBe(333);
      expect(execution.plan.totalEstimatedCostCents).toBe(999);
      expect(execution.plan.orders.map((order) => order.count)).toEqual([100, 100, 100, 33]);
      expect(execution.plan.orders.every((order) => order.ticker === "KXDOGE15M-FRESH")).toBe(true);
      expect(execution.plan.snapshot.source).toBe("fresh-depth");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("builds a fresh-book depth-aware plan at the requested price for live routing", async () => {
    const originalFetch = globalThis.fetch;
    mockFreshMarket();
    try {
      const parsed = normalizeOrderRequest(freshManagedScalpOrder, liveStatus);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const execution = await buildExecutionPlan(parsed.order, liveStatus);

      expect(execution.ok).toBe(true);
      if (!execution.ok) return;
      expect(execution.plan.totalCount).toBe(333);
      expect(execution.plan.totalEstimatedCostCents).toBe(999);
      expect(execution.plan.orders.map((order) => order.count)).toEqual([100, 100, 100, 33]);
      expect(execution.plan.orders.every((order) => order.ticker === "KXDOGE15M-FRESH")).toBe(true);
      expect(execution.plan.snapshot.source).toBe("fresh-depth");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps broad dry-run execution separate from conservative gates", async () => {
    const originalFetch = globalThis.fetch;
    mockFreshMarket();
    try {
      const parsed = normalizeOrderRequest(freshManagedScalpOrder, conservativeStatus);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.order.executionProfile).toBe("standard");
      const execution = await buildExecutionPlan(parsed.order, conservativeStatus);

      expect(execution.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("builds a fresh-book depth-aware reduce-only sell plan for live routing", async () => {
    const originalFetch = globalThis.fetch;
    mockFreshMarket({ noBid: 0.31, yesAskSize: 33 });
    try {
      const parsed = normalizeOrderRequest(validSellOrder, liveStatus);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const execution = await buildExecutionPlan(parsed.order, liveStatus);

      expect(execution.ok).toBe(true);
      if (!execution.ok) return;
      expect(execution.plan.totalCount).toBe(33);
      expect(execution.plan.totalEstimatedCostCents).toBe(1023);
      expect(execution.plan.orders).toHaveLength(1);
      expect(execution.plan.orders[0]).toMatchObject({
        action: "sell",
        side: "no",
        count: 33,
        priceCents: 31,
      });
      expect(execution.plan.snapshot.source).toBe("fresh-sell-depth");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("waits when the fresh ask moves beyond the slippage limit", async () => {
    const originalFetch = globalThis.fetch;
    mockFreshMarket({ yesAsk: 0.05, yesAskSize: 333, noBid: 0.95 });
    try {
      const parsed = normalizeOrderRequest(freshManagedScalpOrder, liveStatus);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const execution = await buildExecutionPlan(parsed.order, liveStatus);

      expect(execution.ok).toBe(false);
      if (execution.ok) return;
      expect(execution.error).toContain("above allowed 4c");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("labels positive-edge algo gate failures separately from true edge failures", async () => {
    const originalFetch = globalThis.fetch;
    mockFreshMarket();
    try {
      const parsed = normalizeOrderRequest({
        ...freshManagedScalpOrder,
        algoParams: {
          ...freshManagedScalpOrder.algoParams,
          minEdge: 0.45,
        },
      }, liveStatus);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const execution = await buildExecutionPlan(parsed.order, liveStatus);

      expect(execution.ok).toBe(false);
      if (execution.ok) return;
      expect(execution.error).toContain("algo gate failed");
      expect(execution.error).toContain("Edge is 44.6c");
      expect(execution.error).not.toContain("positive edge");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("waits in conservative mode until fresh confidence and probability are high enough", async () => {
    const originalFetch = globalThis.fetch;
    mockFreshMarket();
    try {
      const parsed = normalizeOrderRequest({
        ...freshManagedScalpOrder,
        executionProfile: "conservative",
      }, conservativeStatus);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const execution = await buildExecutionPlan(parsed.order, conservativeStatus);

      expect(execution.ok).toBe(false);
      if (execution.ok) return;
      expect(execution.error).toContain("Conservative mode");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
