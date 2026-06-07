const KALSHI_BASE_URL = process.env.KALSHI_BASE_URL ?? "https://external-api.kalshi.com";
const TRADE_API_PATH = "/trade-api/v2";
const DOGE_15M_SERIES = "KXDOGE15M";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ status: "error", error: "Method not allowed" });
    return;
  }

  response.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const now = new Date();
    const market = await discoverActiveDogeMarket(now);
    const [freshMarket, orderbook] = await Promise.all([
      kalshiGet(`/markets/${encodeURIComponent(market.ticker)}`).then((payload) => payload.market ?? market),
      kalshiGet(`/markets/${encodeURIComponent(market.ticker)}/orderbook?depth=20`).then((payload) => payload.orderbook_fp ?? {}),
    ]);

    response.status(200).json(normalizeDogeMarketResponse(freshMarket, orderbook, now));
  } catch (error) {
    response.status(200).json({
      status: "error",
      sourceLabel: "Kalshi public Trade API",
      fetchedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Kalshi DOGE market fetch failed",
      market: null,
      orderbook: null,
    });
  }
}

async function discoverActiveDogeMarket(now) {
  const payload = await kalshiGet(`/markets?series_ticker=${DOGE_15M_SERIES}&status=open&limit=1000`);
  const markets = Array.isArray(payload.markets) ? payload.markets : [];
  if (!markets.length) throw new Error(`No open ${DOGE_15M_SERIES} markets returned by Kalshi`);

  const scored = markets
    .filter((market) => market?.ticker && String(market.status ?? "").toLowerCase() !== "closed")
    .map((market) => {
      const closeMs = Date.parse(market.close_time ?? market.close ?? "");
      const millisecondsToClose = Number.isFinite(closeMs) ? closeMs - now.getTime() : Number.POSITIVE_INFINITY;
      return {
        market,
        score: [
          market.status === "active" ? 0 : 1,
          millisecondsToClose >= -15_000 ? 0 : 1,
          Math.abs(millisecondsToClose),
        ],
      };
    })
    .sort((a, b) => compareScores(a.score, b.score));

  if (!scored.length) throw new Error(`No usable ${DOGE_15M_SERIES} markets returned by Kalshi`);
  return scored[0].market;
}

async function kalshiGet(pathWithQuery) {
  const url = `${KALSHI_BASE_URL}${TRADE_API_PATH}${pathWithQuery}`;
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "DogeEdge/0.1",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kalshi ${pathWithQuery} failed with ${response.status}: ${text.slice(0, 180)}`);
  }
  return response.json();
}

function normalizeDogeMarketResponse(market, orderbook, now) {
  const observedAt = now.toISOString();
  const yesBids = normalizeBidLevels(orderbook.yes_dollars);
  const noBids = normalizeBidLevels(orderbook.no_dollars);
  const yesAsk = toNumber(market.yes_ask_dollars ?? market.yes_ask);
  const noAsk = toNumber(market.no_ask_dollars ?? market.no_ask);
  const orderbookSnapshot = deriveOrderbookSnapshot({
    yesBids,
    noBids,
    yesAsk,
    noAsk,
    yesAskSize: toNumber(market.yes_ask_size_fp),
    noAskSize: toNumber(market.no_ask_size_fp),
    observedAt,
  });

  return {
    status: "live",
    sourceLabel: "Kalshi public Trade API",
    fetchedAt: observedAt,
    seriesTicker: DOGE_15M_SERIES,
    market: {
      ticker: String(market.ticker),
      eventTicker: stringOrNull(market.event_ticker),
      title: stringOrNull(market.title),
      yesSubTitle: stringOrNull(market.yes_sub_title),
      noSubTitle: stringOrNull(market.no_sub_title),
      targetPrice: targetPriceFromMarket(market),
      closeTime: stringOrNull(market.close_time ?? market.close),
      expirationTime: stringOrNull(market.expiration_time ?? market.latest_expiration_time),
      status: stringOrNull(market.status),
      yesBid: toNumber(market.yes_bid_dollars ?? market.yes_bid),
      yesAsk,
      noBid: toNumber(market.no_bid_dollars ?? market.no_bid),
      noAsk,
      lastPrice: toNumber(market.last_price_dollars ?? market.last_price),
      volume: toNumber(market.volume_fp ?? market.volume),
      volume24h: toNumber(market.volume_24h_fp ?? market.volume_24h),
      openInterest: toNumber(market.open_interest_fp ?? market.open_interest),
      liquidity: toNumber(market.liquidity),
      rulesPrimary: stringOrNull(market.rules_primary),
      rulesSecondary: stringOrNull(market.rules_secondary),
    },
    orderbook: orderbookSnapshot,
  };
}

function deriveOrderbookSnapshot({ yesBids, noBids, yesAsk, noAsk, yesAskSize, noAskSize, observedAt }) {
  const yesAsks = noBids
    .map((level) => ({ price: roundRatio(1 - level.price), size: level.size }))
    .filter((level) => level.price > 0 && level.price < 1)
    .sort((a, b) => a.price - b.price);
  const noAsks = yesBids
    .map((level) => ({ price: roundRatio(1 - level.price), size: level.size }))
    .filter((level) => level.price > 0 && level.price < 1)
    .sort((a, b) => a.price - b.price);

  return {
    yesBids,
    yesAsks: withTopAsk(yesAsks, yesAsk, yesAskSize),
    noBids,
    noAsks: withTopAsk(noAsks, noAsk, noAskSize),
    observedAt,
  };
}

function withTopAsk(levels, ask, size) {
  if (ask === null) return levels;
  if (levels.some((level) => Math.abs(level.price - ask) < 0.00001)) return levels;
  return [{ price: roundRatio(ask), size: size ?? 0 }, ...levels].sort((a, b) => a.price - b.price);
}

function normalizeBidLevels(levels) {
  if (!Array.isArray(levels)) return [];
  return levels
    .map((level) => ({
      price: roundRatio(toNumber(level?.[0]) ?? 0),
      size: roundSize(toNumber(level?.[1]) ?? 0),
    }))
    .filter((level) => level.price > 0 && level.price < 1 && level.size > 0)
    .sort((a, b) => b.price - a.price);
}

function targetPriceFromMarket(market) {
  const direct = toNumber(market.floor_strike ?? market.floor);
  if (direct !== null) return direct;
  const subtitle = String(market.yes_sub_title ?? "");
  const match = subtitle.match(/\$([0-9.]+)/);
  return match ? toNumber(match[1]) : null;
}

function compareScores(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function stringOrNull(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundRatio(value) {
  return Number(value.toFixed(4));
}

function roundSize(value) {
  return Number(value.toFixed(2));
}
