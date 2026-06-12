import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { fetchKalshiHistoricalSettlements } from "./provider-kalshi.mjs";
import {
  mergeOfficialSettlementRows,
  normalizeOfficialSettlementRow,
  officialOutcomeMap,
  officialSettlementCoverageReport,
  readOfficialSettlementStore,
  writeOfficialSettlementStore,
} from "./official-settlement.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("Usage: node scripts/factory/fetch-official-settlements.mjs [--mock-input file] [--tickers-file file] [--missing-only] [--provider kalshi] [--base-url url] [--since date] [--until date] [--data-root dir] [--out file] [--report-out file]");
  process.exit(0);
}
const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
const storePath = path.resolve(args.out ?? args.store ?? process.env.DOGEEDGE_OFFICIAL_SETTLEMENTS ?? path.join(dataRoot, "official_settlements.jsonl"));
const provider = String(args.provider ?? (args["mock-input"] ? "mock" : "kalshi"));
const fetchedAt = new Date().toISOString();

const targetRows = await requestedTargetRows(args, dataRoot);
const tickers = uniqueStrings(targetRows.map((row) => row.marketTicker));
const existing = await readOfficialSettlementStore(storePath);
const incoming = args["mock-input"]
  ? await readMockRows(path.resolve(String(args["mock-input"])), { fetchedAt, provider })
  : await fetchProviderRows({ provider, args, tickers });
const missingOnly = Boolean(args["missing-only"]);
const existingOfficial = new Set(existing.filter((row) => row.officialResolutionAvailable === true).map((row) => row.marketTicker));
const incomingFiltered = missingOnly
  ? incoming.filter((row) => !existingOfficial.has(row.marketTicker))
  : incoming;
const merged = mergeOfficialSettlementRows(existing, incomingFiltered);
await writeOfficialSettlementStore(storePath, merged);

const report = officialSettlementCoverageReport({
  snapshotId: "settlement-fetch",
  generatedAt: fetchedAt,
  events: targetRows,
  settlementRows: merged,
});
const fetchReport = {
  schemaVersion: "dogeedge.settlement-fetch-job.v1",
  generatedAt: fetchedAt,
  provider,
  networkRequired: !args["mock-input"],
  dryRunOnly: true,
  canPlaceOrders: false,
  storePath,
  existingRows: existing.length,
  incomingRows: incoming.length,
  fetchedRows: incoming.length,
  incomingRowsAfterMissingOnly: incomingFiltered.length,
  mergedRows: merged.length,
  storedRows: merged.length,
  requestedTickerCount: tickers.length,
  missingOnly,
  mockInput: args["mock-input"] ? path.resolve(String(args["mock-input"])) : null,
  coverage: report.summary,
  reasonCodes: report.reasonCodes,
};
const reportPath = path.resolve(args["report-out"] ?? path.join(path.dirname(storePath), "settlement_fetch_report.json"));
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(fetchReport, null, 2)}\n`, "utf8");
await writeCoverageTsvs(path.dirname(reportPath), report, targetRows, merged);

console.log(`Official settlement ingest complete`);
console.log(`Store: ${storePath}`);
console.log(`Rows: existing ${existing.length}, incoming ${incoming.length}, merged ${merged.length}`);
console.log(`Coverage: ${(report.summary.officialSettlementCoverage * 100).toFixed(1)}% (${report.summary.officialMarketCount}/${report.summary.targetMarketCount})`);
console.log(`Report: ${reportPath}`);

async function fetchProviderRows({ provider, args, tickers }) {
  if (provider !== "kalshi") {
    throw new Error(`Unsupported provider ${provider}; use --mock-input or --provider kalshi.`);
  }
  const result = await fetchKalshiHistoricalSettlements({
    baseUrl: args["base-url"],
    tickers,
    since: args.since,
    until: args.until,
  });
  return result.rows;
}

async function readMockRows(filePath, options) {
  const text = await readFile(filePath, "utf8");
  const parsed = filePath.endsWith(".json")
    ? JSON.parse(text)
    : text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed.rows) ? parsed.rows : [parsed];
  return values
    .map((row) => normalizeOfficialSettlementRow(row, {
      ...options,
      sourceEndpoint: "mock_input",
      providerVersion: "mock-fixture-v1",
    }))
    .filter(Boolean);
}

async function requestedTargetRows(args, dataRoot) {
  if (args["tickers-file"]) return readTargetFile(path.resolve(String(args["tickers-file"])));
  const known = new Set();
  for (const file of [
    path.join(dataRoot, "backtests", "latest-sweep.json"),
    path.join(dataRoot, "backtests", "latest.json"),
  ]) {
    const json = await readJsonMaybe(file);
    collectTickers(json, known);
  }
  return [...known].sort().map((marketTicker) => ({ marketTicker }));
}

async function readTargetFile(filePath) {
  const text = await readFile(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.closedTargets)) return parsed.closedTargets.map(targetRowFromValue).filter(Boolean);
    if (Array.isArray(parsed?.activeTargets)) return parsed.activeTargets.map(targetRowFromValue).filter(Boolean);
    if (Array.isArray(parsed?.targets)) return parsed.targets.map(targetRowFromValue).filter(Boolean);
    return uniqueStrings(Array.isArray(parsed) ? parsed : Array.isArray(parsed.tickers) ? parsed.tickers : Array.isArray(parsed.markets) ? parsed.markets : [])
      .map((marketTicker) => ({ marketTicker }));
  }
  return uniqueStrings(text.split(/\r?\n|,/).map((item) => item.trim())).map((marketTicker) => ({ marketTicker }));
}

function collectTickers(value, output) {
  if (!value || typeof value !== "object") return;
  if (typeof value.marketTicker === "string") output.add(value.marketTicker);
  if (typeof value.id === "string" && value.id.startsWith("KX")) output.add(value.id);
  if (Array.isArray(value.marketTickers)) for (const ticker of value.marketTickers) if (typeof ticker === "string") output.add(ticker);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) for (const item of child) collectTickers(item, output);
    else if (child && typeof child === "object") collectTickers(child, output);
  }
}

function targetRowFromValue(value) {
  if (typeof value === "string") return { marketTicker: value };
  if (!value || typeof value !== "object") return null;
  const marketTicker = typeof value.marketTicker === "string" ? value.marketTicker : typeof value.ticker === "string" ? value.ticker : null;
  if (!marketTicker) return null;
  return {
    marketTicker,
    family: value.family ?? "",
    researchCandidateId: value.researchCandidateId ?? "",
    candidateConfigHash: value.candidateConfigHash ?? "",
    day: value.day ?? "",
    closeTime: value.closeTime ?? value.marketCloseTime ?? value.marketCloseTimestamp ?? "",
  };
}

async function writeCoverageTsvs(outDir, report, targetRows, settlementRows) {
  await writeFile(path.join(outDir, "official_settlement_coverage_by_market.tsv"), tsv(["marketTicker", "day", "officialResolutionAvailable", "provider", "sourcePayloadSha256"], report.coverageByMarket), "utf8");
  await writeFile(path.join(outDir, "official_settlement_coverage_by_day.tsv"), tsv(["key", "total", "official", "coverage"], report.coverageByDay), "utf8");
  const outcomes = officialOutcomeMap(settlementRows);
  const enrichedTargets = targetRows.map((row) => ({
    ...row,
    officialResolutionAvailable: outcomes.has(row.marketTicker),
  }));
  const familyRows = coverageRows(enrichedTargets, "family");
  const candidateRows = coverageRows(enrichedTargets, "researchCandidateId");
  const unresolvedRows = enrichedTargets
    .filter((row) => !row.officialResolutionAvailable)
    .map((row) => ({
      marketTicker: row.marketTicker,
      family: row.family ?? "",
      researchCandidateId: row.researchCandidateId ?? "",
      candidateConfigHash: row.candidateConfigHash ?? "",
      reason: "official_settlement_missing_or_provisional",
    }));
  await writeGzipTsv(path.join(outDir, "official_settlement_coverage_by_family.tsv.gz"), ["key", "total", "official", "coverage"], familyRows);
  await writeGzipTsv(path.join(outDir, "official_settlement_coverage_by_candidate.tsv.gz"), ["key", "total", "official", "coverage"], candidateRows);
  await writeGzipTsv(path.join(outDir, "unresolved_settlement_targets.tsv.gz"), ["marketTicker", "family", "researchCandidateId", "candidateConfigHash", "reason"], unresolvedRows);
}

function coverageRows(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key] || "unknown";
    const group = groups.get(value) ?? { key: value, total: 0, official: 0 };
    group.total += 1;
    if (row.officialResolutionAvailable) group.official += 1;
    groups.set(value, group);
  }
  return [...groups.values()]
    .map((row) => ({ ...row, coverage: row.total ? row.official / row.total : 0 }))
    .sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

async function writeGzipTsv(filePath, columns, rows) {
  await writeFile(filePath, gzipSync(tsv(columns, rows)));
}

function tsv(columns, rows) {
  return `${columns.join("\t")}\n${rows.map((row) => columns.map((column) => String(row[column] ?? "")).join("\t")).join("\n")}${rows.length ? "\n" : ""}`;
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
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
