import {
  defaultKalshiHistoricalBaseUrl,
  defaultOfficialSettlementProviderVersion,
  kalshiHistoricalCutoffUrl,
  kalshiHistoricalMarketUrl,
  kalshiHistoricalMarketsUrl,
  kalshiLiveMarketUrl,
  normalizeOfficialSettlementRow,
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
  const cutoff = await fetchHistoricalCutoff({ baseUrl, fetchImpl });
  if (Array.isArray(tickers) && tickers.length) {
    for (const ticker of tickers) {
      rawRows.push(await fetchTickerSettlementRoute({ ticker, baseUrl, fetchImpl, fetchedAt, cutoff }));
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
    .map((row) => normalizeOfficialSettlementRow(row, {
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
    historicalCutoff: cutoff,
    rawCount: rawRows.length,
    rows,
  };
}

async function fetchTickerSettlementRoute({ ticker, baseUrl, fetchImpl, fetchedAt, cutoff }) {
  const attempts = [];
  const live = await fetchJsonAttempt({
    fetchImpl,
    url: kalshiLiveMarketUrl(ticker, baseUrl),
    endpoint: "kalshi_live_market",
  });
  attempts.push(live);
  if (live.ok) {
    const liveRow = routePayload(live.payload, {
      ticker,
      fetchedAt,
      cutoff,
      routeChosen: "live_market",
      sourceEndpoint: "kalshi_live_market",
      attempts,
    });
    const normalized = normalizeOfficialSettlementRow(liveRow, {
      fetchedAt,
      provider: kalshiProviderName,
      providerVersion: kalshiProviderVersion,
      sourceEndpoint: "kalshi_live_market",
    });
    if (normalized?.officialResolutionAvailable === true) return liveRow;
  }

  const historical = await fetchJsonAttempt({
    fetchImpl,
    url: kalshiHistoricalMarketUrl(ticker, baseUrl),
    endpoint: "kalshi_historical_market",
  });
  attempts.push(historical);
  if (historical.ok) {
    return routePayload(historical.payload, {
      ticker,
      fetchedAt,
      cutoff,
      routeChosen: "historical_market",
      sourceEndpoint: "kalshi_historical_market",
      attempts,
    });
  }

  if (live.ok) {
    return routePayload(live.payload, {
      ticker,
      fetchedAt,
      cutoff,
      routeChosen: "live_market_unsettled",
      sourceEndpoint: "kalshi_live_market",
      attempts,
      reasonCode: "live_market_present_but_official_resolution_unavailable",
    });
  }

  const last = attempts.at(-1) ?? {};
  return {
    marketTicker: ticker,
    status: "not_found_live_or_historical",
    finalized: false,
    provisional: true,
    officialResolutionAvailable: false,
    officialOutcome: null,
    outcomeSide: null,
    sourceEndpoint: "kalshi_market_route",
    verificationSource: "kalshi_market_route_unresolved",
    fetchedAt,
    routeChosen: "unresolved",
    endpointAttempted: last.url ?? null,
    endpointsAttempted: attempts.map((attempt) => `${attempt.endpoint}:${attempt.status ?? "error"}`),
    httpStatus: last.status ?? null,
    reasonCode: "market_not_found_live_or_historical",
    settled: false,
    provider: kalshiProviderName,
    providerVersion: kalshiProviderVersion,
    historicalCutoff: cutoff,
  };
}

async function fetchJsonAttempt({ fetchImpl, url, endpoint }) {
  try {
    const response = await fetchImpl(url, { cache: "no-store" });
    if (!response.ok) {
      return { endpoint, url, ok: false, status: response.status, statusText: response.statusText };
    }
    return { endpoint, url, ok: true, status: response.status, payload: await response.json() };
  } catch (error) {
    return { endpoint, url, ok: false, status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function routePayload(payload, { ticker, fetchedAt, cutoff, routeChosen, sourceEndpoint, attempts, reasonCode = null }) {
  const latestAttempt = attempts.at(-1) ?? {};
  return {
    ...(payload && typeof payload === "object" ? payload : {}),
    marketTicker: payload?.marketTicker ?? payload?.market_ticker ?? payload?.ticker ?? payload?.market?.ticker ?? ticker,
    sourceEndpoint,
    fetchedAt,
    routeChosen,
    endpointAttempted: latestAttempt.url ?? null,
    endpointsAttempted: attempts.map((attempt) => `${attempt.endpoint}:${attempt.status ?? "error"}`),
    httpStatus: latestAttempt.status ?? null,
    reasonCode,
    historicalCutoff: cutoff,
  };
}

async function fetchHistoricalCutoff({ baseUrl, fetchImpl }) {
  const attempt = await fetchJsonAttempt({
    fetchImpl,
    url: kalshiHistoricalCutoffUrl(baseUrl),
    endpoint: "kalshi_historical_cutoff",
  });
  if (!attempt.ok) return { available: false, endpointAttempted: attempt.url, httpStatus: attempt.status, reasonCode: "historical_cutoff_unavailable" };
  return { available: true, endpointAttempted: attempt.url, httpStatus: attempt.status, payload: attempt.payload };
}
