import {
  defaultRiskConfig,
  estimateFinalMinuteSettlement,
  evaluateRiskGate,
  evaluateStrategy,
  type KalshiOrderBook,
  type PriceSample,
  type RiskGateResult,
  type SettlementEstimate,
  type StrategyDecision,
} from "../core/doge";
import {
  bestAskFromOrderbook,
  emptyKalshiMarket,
  type KalshiMarketData,
} from "../core/kalshi";

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type MarketFeedStatus = "connecting" | "live" | "rest" | "stale" | "error";

export interface LiveMarketData {
  status: MarketFeedStatus;
  sourceLabel: string;
  productId: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  open24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  lastTradeAt: string | null;
  receivedAt: string | null;
  latencyMs: number | null;
  candles: Candle[];
  samples: PriceSample[];
  error: string | null;
}

export interface RuntimeSnapshot {
  generatedAt: string;
  secondsToClose: number;
  activeTab: string;
  dataMode: "real-kalshi" | "real-spot" | "unavailable";
  feed: LiveMarketData;
  kalshi: KalshiMarketData;
  price: number;
  targetPrice: number;
  marketLabel: string;
  yesPrice: number;
  noPrice: number;
  oneMinuteChange: number;
  orderBook: KalshiOrderBook;
  candles: Candle[];
  finalMinuteSamples: PriceSample[];
  settlement: SettlementEstimate;
  decision: StrategyDecision;
  gate: RiskGateResult;
}

const strategyVersion = "final-60-lock-v1";

export function makeRuntimeSnapshot(now = new Date(), liveMarket?: LiveMarketData, kalshiMarket: KalshiMarketData = emptyKalshiMarket): RuntimeSnapshot {
  const seconds = Math.floor(now.getTime() / 1000);
  const secondsToClose = secondsToKalshiClose(now, kalshiMarket) ?? 15 * 60 - (seconds % (15 * 60));
  const hasLiveKalshi = kalshiMarket.status === "live" && kalshiMarket.market !== null;
  const dataMode = hasLiveKalshi ? "real-kalshi" : liveMarket?.price ? "real-spot" : "unavailable";
  const price = roundPrice(liveMarket?.price ?? kalshiMarket.market?.targetPrice ?? 0);
  const targetPrice = kalshiMarket.market?.targetPrice ?? (liveMarket?.price ? syntheticTargetFromPrice(price) : price);
  const marketLabel = kalshiMarket.market
    ? `${kalshiMarket.market.ticker} · ${kalshiMarket.market.yesSubTitle ?? `DOGE >= $${targetPrice.toFixed(4)}`}`
    : `DOGE >= $${targetPrice.toFixed(4)} (15m)`;
  const oneMinuteChange = roundPrice(priceChangeOverOneMinute(liveMarket, price, now));
  const finalMinuteSamples = liveMarket?.samples.length ? samplesForFinalMinute(liveMarket.samples, now, secondsToClose) : [];
  const settlement = estimateFinalMinuteSettlement(targetPrice, finalMinuteSamples, price, {
    plausibleMoveBuffer: 0.0035,
    sourceLabel: liveMarket?.price ? "coinbase-spot" : "exchange-estimate",
  });
  const orderBook = kalshiMarket.orderbook ?? emptyOrderBook(now);
  const yesAsk = bestAskFromOrderbook("YES", orderBook, kalshiMarket.market?.yesAsk ?? null) ?? 1;
  const noAsk = bestAskFromOrderbook("NO", orderBook, kalshiMarket.market?.noAsk ?? null) ?? 1;
  const decision = evaluateStrategy({
    targetPrice,
    estimate: settlement,
    yesAsk,
    noAsk,
    feeRate: 0.008,
    spreadPenalty: 0.009,
    strategyVersion,
  });
  const latestSample: PriceSample = {
    observedAt: now.toISOString(),
    price,
    source: "coinbase:doge-usd",
    latencyMs: liveMarket?.latencyMs ?? 9_999,
  };
  const gate = evaluateRiskGate({
    decision,
    book: orderBook,
    latestSample,
    secondsToClose,
    dailyLiveCostUsd: 0,
    openLivePositions: 0,
  }, defaultRiskConfig);

  return {
    generatedAt: now.toISOString(),
    secondsToClose,
    activeTab: "Now",
    dataMode,
    feed: liveMarket ?? unavailableMarketData(),
    kalshi: kalshiMarket,
    price,
    targetPrice,
    marketLabel,
    yesPrice: roundRatio(yesAsk),
    noPrice: roundRatio(noAsk),
    oneMinuteChange,
    orderBook,
    candles: liveMarket?.candles.length ? liveMarket.candles.slice(-300) : currentPriceCandle(now, price),
    finalMinuteSamples,
    settlement,
    decision,
    gate,
  };
}

function secondsToKalshiClose(now: Date, kalshiMarket: KalshiMarketData) {
  if (!kalshiMarket.market?.closeTime) return null;
  const closeMs = Date.parse(kalshiMarket.market.closeTime);
  if (!Number.isFinite(closeMs)) return null;
  return Math.max(0, Math.min(15 * 60, Math.ceil((closeMs - now.getTime()) / 1000)));
}

function emptyOrderBook(now: Date): KalshiOrderBook {
  return {
    yesBids: [],
    yesAsks: [],
    noBids: [],
    noAsks: [],
    observedAt: now.toISOString(),
  };
}

function currentPriceCandle(now: Date, price: number): Candle[] {
  return [{
    time: now.toISOString(),
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
  }];
}

function unavailableMarketData(): LiveMarketData {
  return {
    status: "error",
    sourceLabel: "Coinbase Exchange",
    productId: "DOGE-USD",
    price: null,
    bid: null,
    ask: null,
    bidSize: null,
    askSize: null,
    open24h: null,
    high24h: null,
    low24h: null,
    volume24h: null,
    lastTradeAt: null,
    receivedAt: null,
    latencyMs: null,
    candles: [],
    samples: [],
    error: "No live DOGE feed is available",
  };
}

function priceChangeOverOneMinute(liveMarket: LiveMarketData | undefined, price: number, now: Date) {
  const cutoff = now.getTime() - 60_000;
  const sample = [...(liveMarket?.samples ?? [])].reverse().find((item) => Date.parse(item.observedAt) <= cutoff);
  if (sample) return price - sample.price;
  const candle = [...(liveMarket?.candles ?? [])].reverse().find((item) => Date.parse(item.time) <= cutoff);
  return candle ? price - candle.close : 0;
}

function samplesForFinalMinute(samples: PriceSample[], now: Date, secondsToClose: number) {
  if (secondsToClose > 60) return [];
  const cutoff = now.getTime() - 60_000;
  return samples.filter((sample) => Date.parse(sample.observedAt) >= cutoff);
}

function syntheticTargetFromPrice(price: number) {
  return roundPrice(Math.ceil((price + 0.0002) * 1000) / 1000);
}


export function formatTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function roundPrice(value: number) {
  return Number(value.toFixed(6));
}

function roundRatio(value: number) {
  return Number(value.toFixed(4));
}
