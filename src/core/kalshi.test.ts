import { describe, expect, it } from "vitest";
import {
  bestAskFromOrderbook,
  bestBidFromOrderbook,
  deriveAsksFromOppositeBids,
  normalizeKalshiMarketPayload,
  normalizeKalshiPortfolioPayload,
} from "./kalshi";
import type { KalshiOrderBook } from "./doge";

const orderbook: KalshiOrderBook = {
  yesBids: [
    { price: 0.82, size: 50 },
    { price: 0.8, size: 100 },
  ],
  yesAsks: [],
  noBids: [
    { price: 0.14, size: 25 },
    { price: 0.12, size: 80 },
  ],
  noAsks: [],
  observedAt: "2026-05-31T04:20:00.000Z",
};

describe("Kalshi market normalization", () => {
  it("derives YES asks from NO bids and NO asks from YES bids", () => {
    expect(deriveAsksFromOppositeBids("YES", orderbook)).toEqual([
      { price: 0.86, size: 25 },
      { price: 0.88, size: 80 },
    ]);
    expect(deriveAsksFromOppositeBids("NO", orderbook)).toEqual([
      { price: 0.18, size: 50 },
      { price: 0.2, size: 100 },
    ]);
  });

  it("normalizes the active DOGE market payload into app-safe fields", () => {
    const market = normalizeKalshiMarketPayload({
      status: "live",
      sourceLabel: "Kalshi public Trade API",
      fetchedAt: "2026-05-31T04:20:00.000Z",
      seriesTicker: "KXDOGE15M",
      market: {
        ticker: "KXDOGE15M-26MAY310030-30",
        eventTicker: "KXDOGE15M-26MAY310030",
        title: "DOGE price up in next 15 mins?",
        yesSubTitle: "Target Price: $0.1010323",
        targetPrice: 0.101032,
        yesBid: "0.9700",
        yesAsk: "0.9850",
        noBid: "0.0150",
        noAsk: "0.0300",
        volume24h: "986.33",
        openInterest: "1148.33",
      },
      orderbook: {
        ...orderbook,
      },
    });

    expect(market.status).toBe("live");
    expect(market.market?.ticker).toBe("KXDOGE15M-26MAY310030-30");
    expect(market.market?.targetPrice).toBe(0.101032);
    expect(market.orderbook?.yesAsks[0]).toEqual({ price: 0.86, size: 25 });
    expect(bestBidFromOrderbook("YES", market.orderbook, market.market?.yesBid ?? null)).toBe(0.97);
    expect(bestAskFromOrderbook("YES", market.orderbook, market.market?.yesAsk ?? null)).toBe(0.985);
  });

  it("keeps previous market as stale when a backend fetch errors", () => {
    const previous = normalizeKalshiMarketPayload({
      status: "live",
      fetchedAt: "2026-05-31T04:20:00.000Z",
      market: { ticker: "KXDOGE15M-26MAY310030-30" },
      orderbook,
    });
    const next = normalizeKalshiMarketPayload({ status: "error", error: "upstream failed" }, previous);

    expect(next.status).toBe("stale");
    expect(next.market?.ticker).toBe("KXDOGE15M-26MAY310030-30");
    expect(next.error).toBe("upstream failed");
  });
});

describe("Kalshi portfolio normalization", () => {
  it("normalizes DOGE account performance fields", () => {
    const portfolio = normalizeKalshiPortfolioPayload({
      configured: true,
      status: "live",
      fetchedAt: "2026-05-31T04:21:00.000Z",
      ticker: "KXDOGE15M-26MAY310030-30",
      seriesTicker: "KXDOGE15M",
      balanceCents: "1250",
      portfolioValueCents: "1425",
      realizedPnlDollars: "3.75",
      totalPnlDollars: "3.75",
      feesPaidDollars: "0.14",
      orderCount: "9",
      wins: "6",
      losses: "3",
      settledTrades: "9",
      openPositions: "1",
      recentFills: "12",
    });

    expect(portfolio.status).toBe("live");
    expect(portfolio.seriesTicker).toBe("KXDOGE15M");
    expect(portfolio.totalPnlDollars).toBe(3.75);
    expect(portfolio.orderCount).toBe(9);
    expect(portfolio.wins).toBe(6);
    expect(portfolio.losses).toBe(3);
    expect(portfolio.settledTrades).toBe(9);
  });
});
