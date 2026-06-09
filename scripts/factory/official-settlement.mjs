import { readFile, writeFile } from "node:fs/promises";
import { isRecord, numberOrNull, parseTime, roundRatio, stringOrNull } from "./utils.mjs";

export const officialSettlementSchemaVersion = "dogeedge.official-settlement.v1";
export const defaultKalshiHistoricalBaseUrl = "https://api.elections.kalshi.com/trade-api/v2";

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

export function normalizeKalshiHistoricalMarket(value, { sourceEndpoint = "kalshi_historical_markets", fetchedAt = new Date().toISOString() } = {}) {
  if (!isRecord(value)) return null;
  const market = isRecord(value.market) ? value.market : value;
  const marketTicker = stringOrNull(market.ticker)
    ?? stringOrNull(market.market_ticker)
    ?? stringOrNull(market.marketTicker);
  if (!marketTicker) return null;

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
    sourceEndpoint,
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
      ?? "kalshi_historical_market",
  };
}

export function officialOutcomeMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const normalized = row?.schemaVersion === officialSettlementSchemaVersion
      ? row
      : normalizeKalshiHistoricalMarket(row, { fetchedAt: row?.fetchedAt ?? new Date(0).toISOString() });
    if (!normalized?.marketTicker || normalized.officialResolutionAvailable !== true) continue;
    map.set(normalized.marketTicker, {
      outcomeSide: normalized.outcomeSide,
      labelTimestamp: normalized.labelTimestamp,
      settlementTimestamp: normalized.settlementTimestamp,
      resolvedAt: normalized.determinationTimestamp ?? normalized.settlementTimestamp,
      sourceEndpoint: normalized.sourceEndpoint,
      settlementValueDollars: normalized.settlementValueDollars,
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
    const normalized = row?.schemaVersion === officialSettlementSchemaVersion
      ? row
      : normalizeKalshiHistoricalMarket(row, { fetchedAt: row?.fetchedAt ?? new Date().toISOString() });
    if (!normalized?.marketTicker) continue;
    const previous = byTicker.get(normalized.marketTicker);
    if (!previous || rowPriority(normalized) >= rowPriority(previous)) {
      byTicker.set(normalized.marketTicker, normalized);
    }
  }
  return [...byTicker.values()].sort((left, right) => left.marketTicker.localeCompare(right.marketTicker));
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
  await writeFile(filePath, `${normalized.map((row) => JSON.stringify(row)).join("\n")}${normalized.length ? "\n" : ""}`, "utf8");
  return normalized;
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

function timeFromAny(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  return parseTime(value);
}

function rowPriority(row) {
  return (row.officialResolutionAvailable ? 10 : 0) + (row.finalized ? 5 : 0) + (row.amended ? 1 : 0);
}

function trimSlash(value) {
  return String(value).replace(/\/+$/, "");
}
