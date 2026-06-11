import {
  defaultKalshiHistoricalBaseUrl,
  defaultOfficialSettlementProviderVersion,
  kalshiHistoricalMarketUrl,
  kalshiHistoricalMarketsUrl,
  normalizeKalshiHistoricalMarket,
} from "./official-settlement.mjs";

export const kalshiProviderName = "kalshi";
export const kalshiProviderVersion = defaultOfficialSettlementProviderVersion;

export async function fetchKalshiHistoricalSettlements({
  baseUrl = defaultKalshiHistoricalBaseUrl,
  tickers = [],
  since = null,
  until = null,
  limit = 1000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable in this Node runtime; use --mock-input or upgrade Node.");
  }
  const fetchedAt = new Date().toISOString();
  const rawRows = [];
  if (Array.isArray(tickers) && tickers.length) {
    for (const ticker of tickers) {
      const response = await fetchImpl(kalshiHistoricalMarketUrl(ticker, baseUrl));
      if (!response.ok) throw new Error(`Kalshi historical market fetch failed for ${ticker}: HTTP ${response.status}`);
      rawRows.push(await response.json());
    }
  } else {
    let cursor = null;
    do {
      const response = await fetchImpl(kalshiHistoricalMarketsUrl({ baseUrl, cursor, limit, status: "finalized" }));
      if (!response.ok) throw new Error(`Kalshi historical markets fetch failed: HTTP ${response.status}`);
      const payload = await response.json();
      const pageRows = Array.isArray(payload?.markets) ? payload.markets : Array.isArray(payload?.data) ? payload.data : [];
      rawRows.push(...pageRows);
      cursor = typeof payload?.cursor === "string" && payload.cursor.length ? payload.cursor : null;
    } while (cursor);
  }

  const sinceMs = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  const untilMs = until ? Date.parse(until) : Number.POSITIVE_INFINITY;
  const rows = rawRows
    .map((row) => normalizeKalshiHistoricalMarket(row, {
      fetchedAt,
      provider: kalshiProviderName,
      providerVersion: kalshiProviderVersion,
      sourceEndpoint: "kalshi_historical_markets",
    }))
    .filter(Boolean)
    .filter((row) => {
      const closeMs = Date.parse(row.closeTime ?? row.settlementTimestamp ?? row.labelTimestamp ?? "");
      if (!Number.isFinite(closeMs)) return true;
      return closeMs >= sinceMs && closeMs <= untilMs;
    });
  return {
    provider: kalshiProviderName,
    providerVersion: kalshiProviderVersion,
    fetchedAt,
    rawCount: rawRows.length,
    rows,
  };
}
