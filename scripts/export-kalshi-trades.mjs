import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const TRADE_API_PATH = "/trade-api/v2";
const DEFAULT_SERIES = "KXDOGE15M";
const CENTRAL_OFFSET_MS = 5 * 60 * 60 * 1000;

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "1"];
}));

const envPath = args.get("env") ?? path.join(process.env.TEMP ?? process.cwd(), "dogeedge-vercel-prod.env");
const outDir = args.get("out") ?? path.join(process.cwd(), "outputs", "kalshi-trades");
const series = args.get("series") ?? DEFAULT_SERIES;
const mode = args.get("mode") ?? "export";

const env = { ...process.env, ...parseDotenv(await fs.readFile(envPath, "utf8")) };
const keyId = env.KALSHI_API_KEY_ID;
const privateKeyPem = normalizePrivateKey(env.KALSHI_PRIVATE_KEY_PEM);
const baseUrl = env.KALSHI_BASE_URL ?? "https://external-api.kalshi.com";

if (!keyId || !privateKeyPem) {
  throw new Error("KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PEM are required.");
}

const now = new Date();
const centralNow = new Date(now.getTime() - CENTRAL_OFFSET_MS);
const fromCentral = new Date(Date.UTC(
  centralNow.getUTCFullYear(),
  centralNow.getUTCMonth(),
  centralNow.getUTCDate(),
  0,
  0,
  0,
));
const fromUtc = new Date(fromCentral.getTime() + CENTRAL_OFFSET_MS);

const [portfolioFills, historicalFills, settlements, settledPositions] = await Promise.all([
  signedKalshiGetPaged("/portfolio/fills", "fills", { limit: "1000" }),
  signedKalshiGetPaged("/historical/fills", "fills", { limit: "1000" }).catch(() => ({ fills: [] })),
  signedKalshiGetPaged("/portfolio/settlements", "settlements", { limit: "1000" }).catch(() => ({ settlements: [] })),
  signedKalshiGetPaged("/portfolio/positions", "market_positions", { limit: "1000", settlement_status: "settled", position: "position,total_traded" }).catch(() => ({ market_positions: [] })),
]);

const fills = uniqueByKey([
  ...arrayRows(portfolioFills.fills),
  ...arrayRows(historicalFills.fills),
], fillKey)
  .filter((fill) => marketTicker(fill)?.startsWith(series))
  .sort((a, b) => Date.parse(createdTime(a) ?? "") - Date.parse(createdTime(b) ?? ""));

const seriesSettlements = arrayRows(settlements.settlements)
  .filter((row) => marketTicker(row)?.startsWith(series));
const seriesPositions = arrayRows(settledPositions.market_positions ?? settledPositions.positions)
  .filter((row) => marketTicker(row)?.startsWith(series));

if (mode === "inspect") {
  const sampleFill = fills.at(-1) ?? fills[0] ?? null;
  const sampleSettlement = seriesSettlements.at(0) ?? null;
  const samplePosition = seriesPositions.at(0) ?? null;
  console.log(JSON.stringify({
    fillCount: fills.length,
    lastNightFillCount: fills.filter((fill) => Date.parse(createdTime(fill) ?? "") >= fromUtc.getTime()).length,
    sampleFillKeys: sampleFill ? Object.keys(sampleFill).sort() : [],
    sampleFill: sampleFill ? redactedSample(sampleFill) : null,
    sampleSettlementKeys: sampleSettlement ? Object.keys(sampleSettlement).sort() : [],
    sampleSettlement: sampleSettlement ? redactedSample(sampleSettlement) : null,
    samplePositionKeys: samplePosition ? Object.keys(samplePosition).sort() : [],
    samplePosition: samplePosition ? redactedSample(samplePosition) : null,
  }, null, 2));
  process.exit(0);
}

await fs.mkdir(outDir, { recursive: true });
const exportData = buildTradeExport(fills, seriesSettlements, seriesPositions, fromUtc, now, series);
await fs.writeFile(path.join(outDir, "kalshi-trade-export.json"), JSON.stringify(exportData, null, 2));
await writeCsv(path.join(outDir, "kalshi-trades-last-night.csv"), exportData.lastNightTrades);
await writeCsv(path.join(outDir, "kalshi-fills-last-night.csv"), exportData.lastNightFills);
await writeXlsx(path.join(outDir, "kalshi-trades-last-night.xlsx"), exportData);
console.log(JSON.stringify({
  outDir,
  xlsx: path.join(outDir, "kalshi-trades-last-night.xlsx"),
  trades: exportData.lastNightTrades.length,
  fills: exportData.lastNightFills.length,
}, null, 2));

function buildTradeExport(allFills, settlementRows, positionRows, fromDate, toDate, seriesTicker) {
  const settlementByTicker = new Map(settlementRows.map((row) => [marketTicker(row), row]).filter(([ticker]) => ticker));
  const positionByTicker = new Map(positionRows.map((row) => [marketTicker(row), row]).filter(([ticker]) => ticker));
  const fillRows = allFills.map(normalizeFill).filter(Boolean);
  const lastNightFills = fillRows.filter((fill) => Date.parse(fill.time) >= fromDate.getTime() && Date.parse(fill.time) <= toDate.getTime());
  const trades = pairTrades(fillRows, settlementByTicker, positionByTicker);
  const lastNightTrades = trades.filter((trade) => {
    const opened = Date.parse(trade.entryTime);
    const closed = trade.exitTime ? Date.parse(trade.exitTime) : opened;
    return (opened >= fromDate.getTime() && opened <= toDate.getTime())
      || (closed >= fromDate.getTime() && closed <= toDate.getTime());
  });
  return {
    generatedAt: new Date().toISOString(),
    seriesTicker,
    fromUtc: fromDate.toISOString(),
    toUtc: toDate.toISOString(),
    summary: summaryRows(lastNightTrades, lastNightFills),
    algoSummary: groupSummary(lastNightTrades, "algo"),
    allTrades: trades,
    lastNightTrades,
    lastNightFills,
  };
}

function normalizeFill(fill) {
  const ticker = marketTicker(fill);
  const time = createdTime(fill);
  const side = stringOrNull(fill.side ?? fill.outcome_side)?.toUpperCase();
  const action = stringOrNull(fill.action)?.toLowerCase();
  const count = toNumber(fill.count_fp ?? fill.count);
  if (!ticker || !time || (side !== "YES" && side !== "NO") || (action !== "buy" && action !== "sell") || !count) return null;
  const yesPrice = toNumber(fill.yes_price_dollars ?? fill.yes_price);
  const noPrice = toNumber(fill.no_price_dollars ?? fill.no_price);
  const price = side === "YES" ? yesPrice : noPrice;
  return {
    fillId: stringOrNull(fill.fill_id ?? fill.id),
    orderId: stringOrNull(fill.order_id),
    clientOrderId: stringOrNull(fill.client_order_id ?? fill.clientOrderId),
    algo: algoFromFill(fill),
    marketTicker: ticker,
    time,
    action: action.toUpperCase(),
    side,
    count,
    price: round(price ?? 0, 4),
    yesPrice,
    noPrice,
    fee: round(toNumber(fill.fee_cost ?? fill.fee_cost_dollars ?? fill.fee) ?? 0, 4),
    rawStatus: stringOrNull(fill.status),
  };
}

function pairTrades(fills, settlementByTicker, positionByTicker) {
  const openLots = new Map();
  const trades = [];
  const sorted = fills.slice().sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  for (const fill of sorted) {
    const key = `${fill.marketTicker}:${fill.side}`;
    if (fill.action === "BUY") {
      if (!openLots.has(key)) openLots.set(key, []);
      openLots.get(key).push({ ...fill, remaining: fill.count });
      continue;
    }
    let remainingSell = fill.count;
    const lots = openLots.get(key) ?? [];
    while (remainingSell > 0 && lots.length) {
      const lot = lots[0];
      const contracts = Math.min(lot.remaining, remainingSell);
      trades.push(tradeRow(lot, fill, contracts, "Sold"));
      lot.remaining -= contracts;
      remainingSell -= contracts;
      if (lot.remaining <= 0) lots.shift();
    }
  }
  for (const lots of openLots.values()) {
    for (const lot of lots) {
      if (lot.remaining <= 0) continue;
      const settlementPrice = settlementExitPrice(lot, settlementByTicker.get(lot.marketTicker), positionByTicker.get(lot.marketTicker));
      trades.push(tradeRow(lot, {
        ...lot,
        time: settlementTime(settlementByTicker.get(lot.marketTicker)) ?? lot.time,
        action: "SETTLE",
        price: settlementPrice,
        fee: 0,
      }, lot.remaining, settlementPrice === null ? "Unmatched/Open" : "Settled"));
    }
  }
  return trades.sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
}

function tradeRow(entry, exit, contracts, status) {
  const entryCost = contracts * entry.price;
  const exitValue = exit.price === null ? null : contracts * exit.price;
  const entryFee = prorate(entry.fee, contracts, entry.count);
  const exitFee = exit.action === "SETTLE" ? 0 : prorate(exit.fee, contracts, exit.count);
  const totalFees = round(entryFee + exitFee, 4);
  const pnl = exitValue === null ? null : round(exitValue - entryCost - totalFees, 4);
  return {
    algo: entry.algo,
    status,
    marketTicker: entry.marketTicker,
    side: entry.side,
    contracts,
    entryTime: entry.time,
    exitTime: exit.action === "SETTLE" || exit.action === "SELL" ? exit.time : null,
    entryPrice: entry.price,
    exitPrice: exit.price,
    entryCost: round(entryCost, 4),
    exitValue: exitValue === null ? null : round(exitValue, 4),
    fees: totalFees,
    pnl,
    roi: pnl === null || entryCost + entryFee <= 0 ? null : round(pnl / (entryCost + entryFee), 6),
    result: pnl === null ? "Open" : pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Flat",
    entryFillId: entry.fillId,
    exitFillId: exit.fillId,
    entryClientOrderId: entry.clientOrderId,
    exitClientOrderId: exit.clientOrderId,
  };
}

function settlementExitPrice(fill, settlement, position) {
  const direct = toNumber(settlement?.settlement_price ?? settlement?.price ?? settlement?.yes_price_dollars);
  if (direct !== null) return fill.side === "YES" ? direct : round(1 - direct, 4);
  const result = stringOrNull(settlement?.result ?? settlement?.market_result ?? position?.result ?? position?.market_result)?.toUpperCase();
  if (result === "YES") return fill.side === "YES" ? 1 : 0;
  if (result === "NO") return fill.side === "NO" ? 1 : 0;
  const positionPnl = toNumber(position?.realized_pnl_dollars ?? position?.realized_pnl);
  if (positionPnl !== null) {
    return null;
  }
  return null;
}

function settlementTime(settlement) {
  return stringOrNull(settlement?.settled_time ?? settlement?.settlement_time ?? settlement?.created_time);
}

function summaryRows(trades, fills) {
  const closed = trades.filter((trade) => trade.pnl !== null);
  const totalPnl = closed.reduce((sum, trade) => sum + trade.pnl, 0);
  const totalFees = trades.reduce((sum, trade) => sum + (trade.fees ?? 0), 0);
  const wins = closed.filter((trade) => trade.pnl > 0).length;
  const losses = closed.filter((trade) => trade.pnl < 0).length;
  return [
    { metric: "Trades", value: trades.length },
    { metric: "Closed Trades", value: closed.length },
    { metric: "Fills", value: fills.length },
    { metric: "Wins", value: wins },
    { metric: "Losses", value: losses },
    { metric: "Win Rate", value: closed.length ? wins / closed.length : null },
    { metric: "Total P/L", value: round(totalPnl, 4) },
    { metric: "Fees", value: round(totalFees, 4) },
  ];
}

function groupSummary(trades, key) {
  const groups = new Map();
  for (const trade of trades) {
    const name = trade[key] ?? "Unknown";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(trade);
  }
  return [...groups.entries()].map(([name, rows]) => {
    const closed = rows.filter((trade) => trade.pnl !== null);
    const pnl = closed.reduce((sum, trade) => sum + trade.pnl, 0);
    const fees = rows.reduce((sum, trade) => sum + (trade.fees ?? 0), 0);
    const wins = closed.filter((trade) => trade.pnl > 0).length;
    const losses = closed.filter((trade) => trade.pnl < 0).length;
    const cost = rows.reduce((sum, trade) => sum + trade.entryCost, 0);
    return {
      algo: name,
      trades: rows.length,
      closed: closed.length,
      wins,
      losses,
      winRate: closed.length ? round(wins / closed.length, 6) : null,
      totalPnl: round(pnl, 4),
      totalFees: round(fees, 4),
      totalEntryCost: round(cost, 4),
      roi: cost ? round(pnl / cost, 6) : null,
    };
  }).sort((a, b) => b.totalPnl - a.totalPnl);
}

async function writeCsv(filePath, rows) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const csv = [headers.join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\n");
  await fs.writeFile(filePath, csv, "utf8");
}

async function writeXlsx(filePath, data) {
  const files = buildXlsxFiles([
    { name: "Summary", rows: data.summary },
    { name: "By Algo", rows: data.algoSummary },
    { name: "Trades", rows: data.lastNightTrades },
    { name: "Fills", rows: data.lastNightFills },
  ]);
  await zipStore(filePath, files);
}

function buildXlsxFiles(sheets) {
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbookRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const files = new Map([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17324D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`],
  ]);
  sheets.forEach((sheet, index) => {
    files.set(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet.rows));
  });
  return files;
}

function worksheetXml(rows) {
  const headers = rows.length ? Object.keys(rows[0]) : ["No data"];
  const allRows = [headers, ...rows.map((row) => headers.map((header) => row[header]))];
  const sheetRows = allRows.map((row, rIndex) => {
    const cells = row.map((value, cIndex) => cellXml(rIndex + 1, cIndex + 1, value, rIndex === 0));
    return `<row r="${rIndex + 1}">${cells.join("")}</row>`;
  }).join("");
  const lastCell = `${colName(headers.length)}${Math.max(1, allRows.length)}`;
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><dimension ref="A1:${lastCell}"/><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${lastCell}"/></worksheet>`;
}

function cellXml(row, col, value, header) {
  const ref = `${colName(col)}${row}`;
  if (value === null || value === undefined) return `<c r="${ref}"${header ? ' s="1"' : ""}/>`;
  if (value instanceof Date) return `<c r="${ref}"${header ? ' s="1"' : ""}><v>${value.toISOString()}</v></c>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${header ? 1 : Math.abs(value) <= 1 && String(value).includes(".") ? 3 : 2}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ""}><is><t>${xmlEscape(String(value))}</t></is></c>`;
}

async function zipStore(filePath, files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files.entries()) {
    const data = Buffer.from(content, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  await fs.writeFile(filePath, Buffer.concat([...chunks, ...central, end]));
}

function crc32(buf) {
  let crc = -1;
  for (const byte of buf) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function colName(number) {
  let name = "";
  let n = number;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

async function signedKalshiGet(pathWithQuery) {
  const timestamp = String(Date.now());
  const method = "GET";
  const pathWithoutQuery = `${TRADE_API_PATH}${pathWithQuery}`.split("?")[0];
  const signature = signPss(privateKeyPem, `${timestamp}${method}${pathWithoutQuery}`);
  const response = await fetch(`${baseUrl}${TRADE_API_PATH}${pathWithQuery}`, {
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

async function signedKalshiGetPaged(pathName, rowKey, params = {}) {
  const rows = [];
  let cursor = null;
  let lastPayload = null;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ limit: String(params.limit ?? "100") });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    }
    if (cursor) query.set("cursor", cursor);
    const payload = await signedKalshiGet(`${pathName}?${query.toString()}`);
    lastPayload = payload;
    rows.push(...arrayRows(payload[rowKey]));
    cursor = stringOrNull(payload.cursor ?? payload.next_cursor);
    if (!cursor) break;
  }
  return {
    ...(isRecord(lastPayload) ? lastPayload : {}),
    [rowKey]: rows,
    cursor: null,
  };
}

function signPss(privateKey, text) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(text);
  signer.end();
  return signer.sign({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

function parseDotenv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function normalizePrivateKey(value) {
  if (!value) return null;
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function redactedSample(row) {
  return Object.fromEntries(Object.entries(row)
    .filter(([key]) => !key.toLowerCase().includes("key") && !key.toLowerCase().includes("signature"))
    .slice(0, 40));
}

function arrayRows(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueByKey(rows, keyFn) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (!key || !seen.has(key)) unique.push(row);
    if (key) seen.add(key);
  }
  return unique;
}

function fillKey(fill) {
  return stringOrNull(fill?.fill_id ?? fill?.id ?? fill?.trade_id ?? fill?.order_id ?? fill?.client_order_id);
}

function marketTicker(row) {
  return stringOrNull(row?.market_ticker ?? row?.ticker ?? row?.marketTicker);
}

function createdTime(row) {
  return stringOrNull(row?.created_time ?? row?.createdTime ?? row?.time);
}

function algoFromFill(fill) {
  const clientOrderId = stringOrNull(fill.client_order_id ?? fill.clientOrderId);
  if (!clientOrderId) return "Unknown";
  const upper = clientOrderId.toUpperCase();
  const known = upper.match(/\b(MS|MO|TD|CL|SC|TR|LI|LF|FM|FD)-[A-Z0-9]+/);
  if (known) return known[0];
  if (upper.includes("MS-001") || upper.includes("MANAGED")) return "MS-001";
  return clientOrderId.startsWith("dogeedge-") ? "DogeEdge" : "Unknown";
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prorate(value, contracts, totalContracts) {
  if (!value || !totalContracts) return 0;
  return round(value * contracts / totalContracts, 4);
}

function round(value, digits) {
  if (value === null || value === undefined || !Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function xmlEscape(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
