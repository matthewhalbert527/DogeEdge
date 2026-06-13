import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dayKey, isRecord, numberOrNull, parseTime, roundRatio, stableStringify, stringOrNull } from "./utils.mjs";

export const officialSettlementSchemaVersion = "dogeedge.official-settlement.v1";
export const defaultKalshiHistoricalBaseUrl = "https://external-api.kalshi.com/trade-api/v2";
export const defaultOfficialSettlementProvider = "kalshi";
export const defaultOfficialSettlementProviderVersion = "kalshi-historical-v1";

export function kalshiHistoricalCutoffUrl(baseUrl = defaultKalshiHistoricalBaseUrl) {
  return `${trimSlash(baseUrl)}/historical/cutoff`;
}

export function kalshiHistoricalMarketsUrl({ baseUrl = defaultKalshiHistoricalBaseUrl, cursor = null, limit = 1000, status = "finalized", tickers = [] } = {}) {
  const url = new URL(`${trimSlash(baseUrl)}/historical/markets`);
  if (cursor) url.searchParams.set("cursor", cursor);
  if (limit) url.searchParams.set("limit", String(limit));
  if (status) url.searchParams.set("status", status);
  if (Array.isArray(tickers) && tickers.length) url.searchParams.set("tickers", tickers.join(","));
  return url.toString();
}

export function kalshiHistoricalMarketUrl(ticker, baseUrl = defaultKalshiHistoricalBaseUrl) {
  return `${trimSlash(baseUrl)}/historical/markets/${encodeURIComponent(String(ticker))}`;
}

export function kalshiLiveMarketUrl(ticker, baseUrl = defaultKalshiHistoricalBaseUrl) {
  return `${trimSlash(baseUrl)}/markets/${encodeURIComponent(String(ticker))}`;
}

export function normalizeKalshiHistoricalMarket(
  value,
  {
    sourceEndpoint = "kalshi_historical_markets",
    fetchedAt = new Date().toISOString(),
    provider = defaultOfficialSettlementProvider,
    providerVersion = defaultOfficialSettlementProviderVersion,
  } = {},
) {
  if (!isRecord(value)) return null;
  const market = isRecord(value.market) ? value.market : value;
  const marketTicker = stringOrNull(market.ticker)
    ?? stringOrNull(market.market_ticker)
    ?? stringOrNull(market.marketTicker);
  if (!marketTicker) return null;

  const eventTicker = stringOrNull(market.event_ticker)
    ?? stringOrNull(market.eventTicker)
    ?? stringOrNull(market.event?.ticker)
    ?? null;
  const status = stringOrNull(market.status)?.toLowerCase()
    ?? stringOrNull(market.market_status)?.toLowerCase()
    ?? "unknown";
  const outcomeSide = normalizeOutcomeSide(
    market.result
    ?? market.outcome
    ?? market.settled_outcome
    ?? market.settledOutcome
    ?? market.winning_side
    ?? market.winningSide
    ?? market.resolution
    ?? market.expiration_value
    ?? market.expirationValue
  );
  const settlementValueDollars = numberFromAny(market.settlement_value_dollars ?? market.settlementValueDollars ?? market.settlement_value);
  const closeMs = timeFromAny(market.close_time ?? market.closeTime ?? market.expiration_time ?? market.expirationTime);
  const determinationMs = timeFromAny(market.determination_ts ?? market.determinationTime ?? market.determined_time ?? market.determinedTime);
  const settlementMs = timeFromAny(market.settlement_ts ?? market.settlementTime ?? market.settlement_time ?? market.finalized_time ?? market.finalizedTime)
    ?? determinationMs;
  const finalized = ["finalized", "settled", "determined", "resolved"].includes(status)
    || Boolean(outcomeSide && settlementMs !== null);
  const officialResolutionAvailable = Boolean(outcomeSide && finalized && settlementMs !== null);
  const source = officialResolutionAvailable ? "official_resolution" : "official_contract_outcome_unavailable";

  return {
    schemaVersion: officialSettlementSchemaVersion,
    marketTicker,
    eventTicker,
    sourceEndpoint: stringOrNull(value.sourceEndpoint) ?? sourceEndpoint,
    fetchedAt,
    status,
    finalized,
    provisional: !finalized,
    amended: Boolean(market.amended ?? market.is_amended),
    officialResolutionAvailable,
    officialOutcome: outcomeSide,
    outcomeSide,
    settlementValueDollars,
    closeTime: closeMs === null ? null : new Date(closeMs).toISOString(),
    determinationTimestamp: determinationMs === null ? null : new Date(determinationMs).toISOString(),
    labelTimestamp: (determinationMs ?? settlementMs) === null ? null : new Date(determinationMs ?? settlementMs).toISOString(),
    settlementTimestamp: settlementMs === null ? null : new Date(settlementMs).toISOString(),
    labelSource: source,
    settlementSource: source,
    verificationSource: stringOrNull(market.rules_primary_source)
      ?? stringOrNull(market.rulesPrimarySource)
      ?? stringOrNull(market.settlement_source)
      ?? stringOrNull(value.sourceEndpoint)
      ?? sourceEndpoint,
    sourcePayloadSha256: sha256(stableStringify(value)),
    provider,
    providerVersion,
    routeChosen: stringOrNull(value.routeChosen),
    endpointAttempted: stringOrNull(value.endpointAttempted),
    endpointsAttempted: arrayOfStrings(value.endpointsAttempted),
    httpStatus: numberFromAny(value.httpStatus ?? value.providerFetchStatus),
    reasonCode: stringOrNull(value.reasonCode),
    settled: typeof value.settled === "boolean" ? value.settled : officialResolutionAvailable,
  };
}

export function normalizeOfficialSettlementRow(value, options = {}) {
  if (!isRecord(value)) return null;
  if (value.schemaVersion === officialSettlementSchemaVersion) {
    const normalized = normalizeCanonicalSettlementRow(value, options);
    return normalized?.marketTicker ? normalized : null;
  }
  if (isRecord(value.market)) return normalizeKalshiHistoricalMarket(value, options);
  if (value.marketTicker || value.outcomeSide || value.officialOutcome || value.settlementTimestamp || value.verificationSource) {
    const normalized = normalizeCanonicalSettlementRow(value, options);
    return normalized?.marketTicker ? normalized : null;
  }
  return normalizeKalshiHistoricalMarket(value, options);
}

export function officialOutcomeMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const normalized = normalizeOfficialSettlementRow(row, { fetchedAt: row?.fetchedAt ?? new Date(0).toISOString() });
    if (!normalized?.marketTicker || normalized.officialResolutionAvailable !== true) continue;
    map.set(normalized.marketTicker, {
      outcomeSide: normalized.outcomeSide,
      officialResolutionAvailable: normalized.officialResolutionAvailable,
      labelTimestamp: normalized.labelTimestamp,
      settlementTimestamp: normalized.settlementTimestamp,
      resolvedAt: normalized.determinationTimestamp ?? normalized.settlementTimestamp,
      sourceEndpoint: normalized.sourceEndpoint,
      settlementValueDollars: normalized.settlementValueDollars,
      provider: normalized.provider,
      providerVersion: normalized.providerVersion,
      verificationSource: normalized.verificationSource,
      sourcePayloadSha256: normalized.sourcePayloadSha256,
    });
  }
  return map;
}

export function officialSettlementCoverageForEvents(events = [], settlementRows = []) {
  const outcomes = officialOutcomeMap(settlementRows);
  const totalEvents = Array.isArray(events) ? events.length : 0;
  const officialEvents = events.filter((event) => outcomes.has(event.marketTicker ?? event.id)).length;
  return {
    schemaVersion: "dogeedge.official-settlement-coverage.v1",
    totalEvents,
    officialEvents,
    officialSettlementCoverage: totalEvents ? roundRatio(officialEvents / totalEvents) : 0,
    missingMarketTickers: events
      .map((event) => event.marketTicker ?? event.id)
      .filter((ticker) => ticker && !outcomes.has(ticker)),
  };
}

export function mergeOfficialSettlementRows(existingRows = [], incomingRows = []) {
  const byTicker = new Map();
  for (const row of [...existingRows, ...incomingRows]) {
    const normalized = normalizeOfficialSettlementRow(row, { fetchedAt: row?.fetchedAt ?? new Date().toISOString() });
    if (!normalized?.marketTicker) continue;
    const previous = byTicker.get(normalized.marketTicker);
    if (!previous || compareRowPriority(normalized, previous) >= 0) {
      byTicker.set(normalized.marketTicker, normalized);
    }
  }
  return [...byTicker.values()].sort((left, right) => left.marketTicker.localeCompare(right.marketTicker));
}

export function officialSettlementCoverageReport({
  snapshotId = "manual",
  generatedAt = new Date().toISOString(),
  events = [],
  metrics = [],
  settlementRows = [],
  scoringThreshold = 0.8,
  promotionThreshold = 0.95,
} = {}) {
  const outcomes = officialOutcomeMap(settlementRows);
  const targetMarkets = uniqueStrings([
    ...events.map((event) => event.marketTicker ?? event.id),
    ...metrics.flatMap((metric) => Array.isArray(metric.marketTickers) ? metric.marketTickers : []),
  ]);
  const markets = targetMarkets.map((marketTicker) => ({
    snapshotId,
    marketTicker,
    day: dayKeyFromTickerOrEvent(marketTicker, events),
    officialResolutionAvailable: outcomes.has(marketTicker),
    provider: outcomes.get(marketTicker)?.provider ?? "",
    sourcePayloadSha256: outcomes.get(marketTicker)?.sourcePayloadSha256 ?? "",
  }));
  const officialCount = markets.filter((row) => row.officialResolutionAvailable).length;
  const coverage = markets.length ? roundRatio(officialCount / markets.length) : 0;
  return {
    schemaVersion: "dogeedge.settlement-fetch-report.v1",
    snapshotId,
    generatedAt,
    summary: {
      targetMarketCount: markets.length,
      officialSettlementRows: settlementRows.length,
      officialMarketCount: officialCount,
      officialSettlementCoverage: coverage,
      scoringThreshold,
      promotionThreshold,
      promotionGradeScoringAllowed: coverage >= scoringThreshold,
      beyondPaperAllowed: coverage >= promotionThreshold,
      failClosed: coverage < promotionThreshold,
    },
    reasonCodes: [
      ...(settlementRows.length === 0 ? ["official_settlement_rows_absent"] : []),
      ...(officialCount === 0 ? ["official_resolution_rows_absent"] : []),
      ...(coverage < scoringThreshold ? ["official_coverage_below_scoring_threshold"] : []),
      ...(coverage < promotionThreshold ? ["official_coverage_below_promotion_threshold"] : []),
    ],
    coverageByMarket: markets,
    coverageByDay: coverageBy(markets, "day"),
  };
}

export async function readOfficialSettlementStore(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function writeOfficialSettlementStore(filePath, rows = []) {
  const normalized = mergeOfficialSettlementRows([], rows);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${normalized.map((row) => JSON.stringify(row)).join("\n")}${normalized.length ? "\n" : ""}`, "utf8");
  return normalized;
}

function normalizeCanonicalSettlementRow(value, options = {}) {
  const marketTicker = stringOrNull(value.marketTicker)
    ?? stringOrNull(value.market_ticker)
    ?? stringOrNull(value.ticker);
  if (!marketTicker) return null;
  const fetchedAt = stringOrNull(value.fetchedAt) ?? options.fetchedAt ?? new Date().toISOString();
  const outcomeSide = normalizeOutcomeSide(value.outcomeSide ?? value.officialOutcome);
  const settlementMs = timeFromAny(value.settlementTimestamp);
  const determinationMs = timeFromAny(value.determinationTimestamp);
  const labelMs = timeFromAny(value.labelTimestamp) ?? determinationMs ?? settlementMs;
  const finalized = Boolean(value.finalized) || String(value.status ?? "").toLowerCase() === "finalized";
  const officialResolutionAvailable = (value.officialResolutionAvailable !== false)
    && outcomeSide !== null
    && finalized
    && labelMs !== null
    && settlementMs !== null;
  const payloadHash = stringOrNull(value.sourcePayloadSha256) ?? sha256(stableStringify({
    ...value,
    sourcePayloadSha256: undefined,
  }));
  return {
    schemaVersion: officialSettlementSchemaVersion,
    marketTicker,
    eventTicker: stringOrNull(value.eventTicker),
    status: stringOrNull(value.status) ?? (finalized ? "finalized" : "provisional"),
    finalized,
    provisional: typeof value.provisional === "boolean" ? value.provisional : !finalized,
    amended: Boolean(value.amended),
    officialResolutionAvailable,
    officialOutcome: outcomeSide,
    outcomeSide,
    settlementValueDollars: numberFromAny(value.settlementValueDollars),
    closeTime: isoOrNull(value.closeTime),
    determinationTimestamp: determinationMs === null ? null : new Date(determinationMs).toISOString(),
    labelTimestamp: labelMs === null ? null : new Date(labelMs).toISOString(),
    settlementTimestamp: settlementMs === null ? null : new Date(settlementMs).toISOString(),
    sourceEndpoint: stringOrNull(value.sourceEndpoint) ?? options.sourceEndpoint ?? "manual_or_mock_official_settlement",
    verificationSource: stringOrNull(value.verificationSource) ?? "manual_or_mock",
    fetchedAt,
    sourcePayloadSha256: payloadHash,
    provider: stringOrNull(value.provider) ?? options.provider ?? defaultOfficialSettlementProvider,
    providerVersion: stringOrNull(value.providerVersion) ?? options.providerVersion ?? defaultOfficialSettlementProviderVersion,
    labelSource: officialResolutionAvailable ? "official_resolution" : "official_contract_outcome_unavailable",
    settlementSource: officialResolutionAvailable ? "official_resolution" : "official_contract_outcome_unavailable",
    routeChosen: stringOrNull(value.routeChosen),
    endpointAttempted: stringOrNull(value.endpointAttempted),
    endpointsAttempted: arrayOfStrings(value.endpointsAttempted),
    httpStatus: numberFromAny(value.httpStatus ?? value.providerFetchStatus),
    reasonCode: stringOrNull(value.reasonCode),
    settled: typeof value.settled === "boolean" ? value.settled : officialResolutionAvailable,
  };
}

function normalizeOutcomeSide(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (["YES", "Y", "TRUE", "1"].includes(text)) return "YES";
  if (["NO", "N", "FALSE", "0"].includes(text)) return "NO";
  return null;
}

function numberFromAny(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return numberOrNull(value);
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function timeFromAny(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  return parseTime(value);
}

function compareRowPriority(left, right) {
  const leftPriority = rowPriority(left);
  const rightPriority = rowPriority(right);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const leftFetched = parseTime(left.fetchedAt) ?? 0;
  const rightFetched = parseTime(right.fetchedAt) ?? 0;
  return leftFetched - rightFetched;
}

function rowPriority(row) {
  return (row.officialResolutionAvailable ? 100 : 0)
    + (row.finalized ? 20 : 0)
    + (row.provisional ? -10 : 0)
    + (row.amended ? 2 : 0)
    + (row.outcomeSide ? 1 : 0);
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function isoOrNull(value) {
  const ms = timeFromAny(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
}

function dayKeyFromTickerOrEvent(marketTicker, events) {
  const event = events.find((item) => (item.marketTicker ?? item.id) === marketTicker);
  if (event?.day) return event.day;
  if (event?.marketCloseTimestamp) return dayKey(event.marketCloseTimestamp);
  return "unknown";
}

function coverageBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const name = row[key] ?? "unknown";
    const current = groups.get(name) ?? { key: name, total: 0, official: 0, coverage: 0 };
    current.total += 1;
    if (row.officialResolutionAvailable) current.official += 1;
    groups.set(name, current);
  }
  return [...groups.values()].map((row) => ({
    ...row,
    coverage: row.total ? roundRatio(row.official / row.total) : 0,
  })).sort((left, right) => String(left.key).localeCompare(String(right.key)));
}
