import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeReplayRawEvent } from "./raw-tick-extract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
const tickers = args["tickers-file"] ? await readTickerFile(path.resolve(String(args["tickers-file"]))) : [];
const outRoot = path.resolve(args.out ?? path.join(dataRoot, "replay", "raw", "candles", new Date().toISOString().slice(0, 10)));
const period = Number(args.period ?? 1);

await mkdir(outRoot, { recursive: true });
let rowCount = 0;
if (args["mock-input"]) {
  const rows = await readRows(path.resolve(String(args["mock-input"])));
  const byMarket = new Map();
  for (const raw of rows) {
    const event = normalizeReplayRawEvent({
      ...raw,
      captureMode: "historical_candlestick",
      channel: "candlestick",
      messageType: "snapshot",
    }, { captureMode: "historical_candlestick", provider: args.provider ?? "kalshi", captureRunId: "candles-mock" });
    if (!event) continue;
    if (tickers.length && !tickers.includes(event.marketTicker)) continue;
    const values = byMarket.get(event.marketTicker) ?? [];
    values.push(event);
    byMarket.set(event.marketTicker, values);
  }
  for (const [marketTicker, events] of byMarket) {
    const dir = path.join(outRoot, safeSegment(marketTicker));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "candles.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
    rowCount += events.length;
  }
}

const manifest = {
  schemaVersion: "dogeedge.candlestick-fetch.v1",
  generatedAt: new Date().toISOString(),
  provider: args.provider ?? "kalshi",
  periodMinutes: period,
  targetMarketCount: tickers.length,
  rowCount,
  fallbackKind: "candlestick_diagnostic_only",
  replayGradeAvailable: false,
  executionSensitivePromotionAllowed: false,
  canPlaceOrders: false,
  reasonCodes: [
    "candlestick_diagnostic_only",
    ...(rowCount === 0 ? ["candlestick_rows_absent"] : []),
  ],
};
await writeFile(path.join(outRoot, "candlestick_fetch_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Historical candle fallback complete: ${rowCount} rows -> ${outRoot}`);
console.log("Replay-grade availability: false (candles are diagnostic-only).");

async function readTickerFile(filePath) {
  const text = await readFile(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return uniqueStrings(Array.isArray(parsed) ? parsed : Array.isArray(parsed.tickers) ? parsed.tickers : Array.isArray(parsed.markets) ? parsed.markets : []);
  }
  return uniqueStrings(text.split(/\r?\n|,/));
}

async function readRows(filePath) {
  const text = await readFile(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed.rows) ? parsed.rows : [parsed];
  }
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "_");
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))].sort();
}

async function defaultDataRoot() {
  if (process.platform === "win32") {
    try {
      await access("D:\\");
      return "D:\\DogeEdge\\data";
    } catch {
      // Fall back to repo-local data.
    }
  }
  return path.join(repoRoot, "data");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
