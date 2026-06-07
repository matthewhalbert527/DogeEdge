import crypto from "node:crypto";

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

  const keyId = process.env.KALSHI_API_KEY_ID;
  const privateKeyPem = normalizePrivateKey(process.env.KALSHI_PRIVATE_KEY_PEM);
  if (!keyId || !privateKeyPem) {
    response.status(200).json({
      configured: false,
      status: "not_configured",
      fetchedAt: new Date().toISOString(),
      seriesTicker: DOGE_15M_SERIES,
      message: "Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PEM on the backend to enable read-only live fills, positions, and true Kalshi P/L.",
    });
    return;
  }

  try {
    const ticker = typeof request.query?.ticker === "string" ? request.query.ticker : undefined;
    const [balance, openPositions, settledPositions, fills, historicalFills, settlements] = await Promise.all([
      signedKalshiGet("/portfolio/balance", keyId, privateKeyPem),
      signedKalshiGetPaged("/portfolio/positions", "market_positions", keyId, privateKeyPem, { limit: "100", settlement_status: "unsettled", position: "position,total_traded" }),
      signedKalshiGetPaged("/portfolio/positions", "market_positions", keyId, privateKeyPem, { limit: "100", settlement_status: "settled", position: "position,total_traded" }),
      signedKalshiGetPaged("/portfolio/fills", "fills", keyId, privateKeyPem, { limit: "1000" }),
      signedKalshiGetPaged("/historical/fills", "fills", keyId, privateKeyPem, { limit: "1000" }).catch(() => ({ fills: [] })),
      signedKalshiGetPaged("/portfolio/settlements", "settlements", keyId, privateKeyPem, { limit: "1000" }).catch(() => ({ settlements: [] })),
    ]);

    response.status(200).json(normalizePortfolioResponse({
      balance,
      openPositions,
      settledPositions,
      fills,
      historicalFills,
      settlements,
      ticker,
      seriesTicker: DOGE_15M_SERIES,
    }));
  } catch (error) {
    response.status(200).json({
      configured: true,
      status: "error",
      fetchedAt: new Date().toISOString(),
      seriesTicker: DOGE_15M_SERIES,
      error: error instanceof Error ? error.message : "Kalshi portfolio fetch failed",
    });
  }
}

async function signedKalshiGet(pathWithQuery, keyId, privateKeyPem) {
  const timestamp = String(Date.now());
  const method = "GET";
  const pathWithoutQuery = `${TRADE_API_PATH}${pathWithQuery}`.split("?")[0];
  const signature = signPss(privateKeyPem, `${timestamp}${method}${pathWithoutQuery}`);
  const response = await fetch(`${KALSHI_BASE_URL}${TRADE_API_PATH}${pathWithQuery}`, {
    headers: {
      "Accept": "application/json",
      "KALSHI-ACCESS-KEY": keyId,
      "KALSHI-ACCESS-SIGNATURE": signature,
      "KALSHI-ACCESS-TIMESTAMP": timestamp,
      "User-Agent": "DogeEdge/0.1",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kalshi ${pathWithoutQuery} failed with ${response.status}: ${text.slice(0, 180)}`);
  }
  return response.json();
}

async function signedKalshiGetPaged(path, rowKey, keyId, privateKeyPem, params = {}) {
  const rows = [];
  let cursor = null;
  let lastPayload = null;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ limit: String(params.limit ?? "100") });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    }
    if (cursor) query.set("cursor", cursor);
    const payload = await signedKalshiGet(`${path}?${query.toString()}`, keyId, privateKeyPem);
    lastPayload = payload;
    const pageRows = Array.isArray(payload[rowKey]) ? payload[rowKey] : [];
    rows.push(...pageRows);
    cursor = stringOrNull(payload.cursor ?? payload.next_cursor);
    if (!cursor) break;
  }
  return {
    ...(isRecord(lastPayload) ? lastPayload : {}),
    [rowKey]: rows,
    cursor: null,
  };
}

function signPss(privateKeyPem, text) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(text);
  signer.end();
  return signer.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

function normalizePortfolioResponse({ balance, openPositions, settledPositions, fills, historicalFills, settlements, ticker, seriesTicker }) {
  const openPositionRows = filterSeriesRows(positionRows(openPositions), seriesTicker)
    .filter((position) => Math.abs(toNumber(position.position_fp ?? position.position) ?? 0) > 0);
  const settledPositionRows = filterSeriesRows(positionRows(settledPositions), seriesTicker)
    .filter((position) => Math.abs(positionPnl(position) ?? 0) > 0 || Math.abs(toNumber(position.total_traded_fp ?? position.total_traded) ?? 0) > 0);
  const fillRows = uniqueRowsByKey([
    ...filterSeriesRows(Array.isArray(fills.fills) ? fills.fills : [], seriesTicker),
    ...filterSeriesRows(Array.isArray(historicalFills.fills) ? historicalFills.fills : [], seriesTicker),
  ], fillKey);
  const settlementRows = filterSeriesRows(Array.isArray(settlements.settlements) ? settlements.settlements : [], seriesTicker);

  const allPositionRows = [...openPositionRows, ...settledPositionRows];
  const realizedPnlDollars = sumMoney(allPositionRows.map(positionPnl));
  const settledPnlValues = settledPositionRows.map(positionPnl).filter((value) => value !== null);
  const fallbackSettlementPnlValues = settledPnlValues.length ? [] : settlementRows.map(settlementPnl).filter((value) => value !== null);
  const outcomePnlValues = settledPnlValues.length ? settledPnlValues : fallbackSettlementPnlValues;
  const feesPaidDollars = sumMoney(allPositionRows.map(positionFees));

  return {
    configured: true,
    status: "live",
    fetchedAt: new Date().toISOString(),
    ticker: ticker ?? null,
    seriesTicker,
    balanceCents: toNumber(balance.balance),
    portfolioValueCents: toNumber(balance.portfolio_value),
    realizedPnlDollars: roundMoney(realizedPnlDollars),
    totalPnlDollars: roundMoney(realizedPnlDollars),
    feesPaidDollars: roundMoney(feesPaidDollars),
    orderCount: countOrders(fillRows),
    wins: outcomePnlValues.filter((pnl) => pnl > 0).length,
    losses: outcomePnlValues.filter((pnl) => pnl < 0).length,
    settledTrades: outcomePnlValues.filter((pnl) => pnl !== 0).length,
    openPositions: openPositionRows.length,
    recentFills: fillRows.length,
    positions: openPositionRows.slice(0, 25).map((position) => ({
      marketTicker: stringOrNull(position.market_ticker ?? position.ticker),
      position: toNumber(position.position_fp ?? position.position),
      costDollars: toNumber(position.position_cost_dollars),
      realizedPnlDollars: positionPnl(position),
      feesPaidDollars: positionFees(position),
    })),
    fills: fillRows.slice(0, 25).map((fill) => ({
      fillId: stringOrNull(fill.fill_id),
      marketTicker: stringOrNull(fill.market_ticker ?? fill.ticker),
      side: stringOrNull(fill.side ?? fill.outcome_side),
      action: stringOrNull(fill.action),
      count: toNumber(fill.count_fp ?? fill.count),
      yesPrice: toNumber(fill.yes_price_dollars),
      noPrice: toNumber(fill.no_price_dollars),
      feeCost: toNumber(fill.fee_cost),
      createdTime: stringOrNull(fill.created_time),
    })),
  };
}

function positionRows(payload) {
  return Array.isArray(payload.market_positions)
    ? payload.market_positions
    : Array.isArray(payload.positions)
      ? payload.positions
      : [];
}

function filterSeriesRows(rows, seriesTicker) {
  return rows.filter((row) => {
    const ticker = marketTicker(row);
    return ticker !== null && ticker.startsWith(seriesTicker);
  });
}

function marketTicker(row) {
  return isRecord(row) ? stringOrNull(row.market_ticker ?? row.ticker ?? row.marketTicker) : null;
}

function fillKey(fill) {
  if (!isRecord(fill)) return null;
  return stringOrNull(fill.order_id ?? fill.orderId ?? fill.client_order_id ?? fill.clientOrderId ?? fill.fill_id ?? fill.trade_id);
}

function countOrders(fills) {
  if (!fills.length) return 0;
  const orderIds = new Set(fills.map(fillKey).filter(Boolean));
  return orderIds.size || fills.length;
}

function uniqueRowsByKey(rows, keyFn) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) {
      unique.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

function positionPnl(position) {
  return moneyValue(position, ["realized_pnl_dollars", "realized_pnl"], ["realized_pnl_cents", "pnl_cents"]);
}

function settlementPnl(settlement) {
  return moneyValue(settlement, ["realized_pnl_dollars", "realized_pnl", "pnl_dollars", "pnl"], ["realized_pnl_cents", "pnl_cents"]);
}

function positionFees(position) {
  return moneyValue(position, ["fees_paid_dollars", "position_fee_cost_dollars"], ["fees_paid", "fees_paid_cents", "position_fee_cost_cents"]);
}

function moneyValue(record, dollarKeys, centKeys) {
  if (!isRecord(record)) return null;
  for (const key of dollarKeys) {
    const value = toNumber(record[key]);
    if (value !== null) return value;
  }
  for (const key of centKeys) {
    const value = toNumber(record[key]);
    if (value !== null) return value / 100;
  }
  return null;
}

function sumMoney(values) {
  return values.reduce((total, value) => total + (value ?? 0), 0);
}

function normalizePrivateKey(value) {
  if (!value) return null;
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function stringOrNull(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}
