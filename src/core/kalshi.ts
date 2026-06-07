import type { KalshiOrderBook, OrderBookLevel } from "./doge";

export type KalshiMarketStatus = "connecting" | "live" | "stale" | "error" | "not_configured";

export interface KalshiMarketDetails {
  ticker: string;
  eventTicker: string | null;
  title: string | null;
  yesSubTitle: string | null;
  noSubTitle: string | null;
  targetPrice: number | null;
  closeTime: string | null;
  expirationTime: string | null;
  status: string | null;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  lastPrice: number | null;
  volume: number | null;
  volume24h: number | null;
  openInterest: number | null;
  liquidity: number | null;
  rulesPrimary: string | null;
  rulesSecondary: string | null;
}

export interface KalshiMarketData {
  status: KalshiMarketStatus;
  sourceLabel: string;
  fetchedAt: string | null;
  seriesTicker: string | null;
  market: KalshiMarketDetails | null;
  orderbook: KalshiOrderBook | null;
  error: string | null;
}

export interface KalshiPortfolioSummary {
  configured: boolean;
  status: "connecting" | "live" | "error" | "not_configured";
  fetchedAt: string | null;
  ticker: string | null;
  seriesTicker: string | null;
  balanceCents: number | null;
  portfolioValueCents: number | null;
  realizedPnlDollars: number | null;
  totalPnlDollars: number | null;
  feesPaidDollars: number | null;
  orderCount: number | null;
  wins: number | null;
  losses: number | null;
  settledTrades: number | null;
  openPositions: number;
  recentFills: number;
  message: string | null;
  error: string | null;
}

export const emptyKalshiMarket: KalshiMarketData = {
  status: "connecting",
  sourceLabel: "Kalshi public Trade API",
  fetchedAt: null,
  seriesTicker: null,
  market: null,
  orderbook: null,
  error: null,
};

export const emptyKalshiPortfolio: KalshiPortfolioSummary = {
  configured: false,
  status: "connecting",
  fetchedAt: null,
  ticker: null,
  seriesTicker: null,
  balanceCents: null,
  portfolioValueCents: null,
  realizedPnlDollars: null,
  totalPnlDollars: null,
  feesPaidDollars: null,
  orderCount: null,
  wins: null,
  losses: null,
  settledTrades: null,
  openPositions: 0,
  recentFills: 0,
  message: null,
  error: null,
};

export function normalizeKalshiMarketPayload(payload: unknown, previous: KalshiMarketData = emptyKalshiMarket): KalshiMarketData {
  if (!isRecord(payload)) {
    return { ...previous, status: previous.market ? "stale" : "error", error: "Kalshi market payload was not an object" };
  }

  if (payload.status === "error") {
    return {
      ...previous,
      status: previous.market ? "stale" : "error",
      fetchedAt: stringOrNull(payload.fetchedAt) ?? previous.fetchedAt,
      error: stringOrNull(payload.error) ?? "Kalshi market fetch failed",
    };
  }

  const market = isRecord(payload.market) ? normalizeMarketDetails(payload.market) : null;
  const orderbook = isRecord(payload.orderbook) ? normalizeOrderbook(payload.orderbook) : null;

  return {
    status: market ? "live" : "error",
    sourceLabel: stringOrNull(payload.sourceLabel) ?? "Kalshi public Trade API",
    fetchedAt: stringOrNull(payload.fetchedAt),
    seriesTicker: stringOrNull(payload.seriesTicker),
    market,
    orderbook,
    error: market ? null : "Kalshi market payload did not include an active market",
  };
}

export function normalizeKalshiPortfolioPayload(payload: unknown, previous: KalshiPortfolioSummary = emptyKalshiPortfolio): KalshiPortfolioSummary {
  if (!isRecord(payload)) {
    return { ...previous, status: previous.configured ? "error" : "not_configured", error: "Kalshi portfolio payload was not an object" };
  }

  const configured = Boolean(payload.configured);
  return {
    configured,
    status: payload.status === "live" ? "live" : configured ? "error" : "not_configured",
    fetchedAt: stringOrNull(payload.fetchedAt),
    ticker: stringOrNull(payload.ticker),
    seriesTicker: stringOrNull(payload.seriesTicker),
    balanceCents: numberOrNull(payload.balanceCents),
    portfolioValueCents: numberOrNull(payload.portfolioValueCents),
    realizedPnlDollars: numberOrNull(payload.realizedPnlDollars),
    totalPnlDollars: numberOrNull(payload.totalPnlDollars) ?? numberOrNull(payload.realizedPnlDollars),
    feesPaidDollars: numberOrNull(payload.feesPaidDollars),
    orderCount: numberOrNull(payload.orderCount),
    wins: numberOrNull(payload.wins),
    losses: numberOrNull(payload.losses),
    settledTrades: numberOrNull(payload.settledTrades),
    openPositions: numberOrNull(payload.openPositions) ?? 0,
    recentFills: numberOrNull(payload.recentFills) ?? 0,
    message: stringOrNull(payload.message),
    error: stringOrNull(payload.error),
  };
}

export function bestAskFromOrderbook(side: "YES" | "NO", orderbook: KalshiOrderBook | null, explicitAsk: number | null) {
  if (explicitAsk !== null) return explicitAsk;
  const levels = side === "YES" ? orderbook?.yesAsks : orderbook?.noAsks;
  if (!levels?.length) return null;
  return Math.min(...levels.map((level) => level.price));
}

export function bestBidFromOrderbook(side: "YES" | "NO", orderbook: KalshiOrderBook | null, explicitBid: number | null) {
  if (explicitBid !== null) return explicitBid;
  const levels = side === "YES" ? orderbook?.yesBids : orderbook?.noBids;
  if (!levels?.length) return null;
  return Math.max(...levels.map((level) => level.price));
}

export function deriveAsksFromOppositeBids(side: "YES" | "NO", orderbook: KalshiOrderBook) {
  const oppositeBids = side === "YES" ? orderbook.noBids : orderbook.yesBids;
  return oppositeBids
    .map((level) => ({ price: roundRatio(1 - level.price), size: level.size }))
    .filter((level) => level.price > 0 && level.price < 1)
    .sort((a, b) => a.price - b.price);
}

function normalizeMarketDetails(payload: Record<string, unknown>): KalshiMarketDetails {
  return {
    ticker: stringOrNull(payload.ticker) ?? "UNKNOWN",
    eventTicker: stringOrNull(payload.eventTicker),
    title: stringOrNull(payload.title),
    yesSubTitle: stringOrNull(payload.yesSubTitle),
    noSubTitle: stringOrNull(payload.noSubTitle),
    targetPrice: numberOrNull(payload.targetPrice),
    closeTime: stringOrNull(payload.closeTime),
    expirationTime: stringOrNull(payload.expirationTime),
    status: stringOrNull(payload.status),
    yesBid: numberOrNull(payload.yesBid),
    yesAsk: numberOrNull(payload.yesAsk),
    noBid: numberOrNull(payload.noBid),
    noAsk: numberOrNull(payload.noAsk),
    lastPrice: numberOrNull(payload.lastPrice),
    volume: numberOrNull(payload.volume),
    volume24h: numberOrNull(payload.volume24h),
    openInterest: numberOrNull(payload.openInterest),
    liquidity: numberOrNull(payload.liquidity),
    rulesPrimary: stringOrNull(payload.rulesPrimary),
    rulesSecondary: stringOrNull(payload.rulesSecondary),
  };
}

function normalizeOrderbook(payload: Record<string, unknown>): KalshiOrderBook {
  const observedAt = stringOrNull(payload.observedAt) ?? new Date().toISOString();
  const yesBids = normalizeLevels(payload.yesBids, "desc");
  const noBids = normalizeLevels(payload.noBids, "desc");
  const base: KalshiOrderBook = {
    yesBids,
    noBids,
    yesAsks: normalizeLevels(payload.yesAsks, "asc"),
    noAsks: normalizeLevels(payload.noAsks, "asc"),
    observedAt,
  };
  return {
    ...base,
    yesAsks: base.yesAsks.length ? base.yesAsks : deriveAsksFromOppositeBids("YES", base),
    noAsks: base.noAsks.length ? base.noAsks : deriveAsksFromOppositeBids("NO", base),
  };
}

function normalizeLevels(value: unknown, direction: "asc" | "desc"): OrderBookLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const price = numberOrNull(item.price);
      const size = numberOrNull(item.size);
      if (price === null || size === null || price <= 0 || price >= 1 || size <= 0) return null;
      return { price: roundRatio(price), size };
    })
    .filter((item): item is OrderBookLevel => item !== null)
    .sort((a, b) => direction === "asc" ? a.price - b.price : b.price - a.price);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function roundRatio(value: number) {
  return Number(value.toFixed(4));
}
