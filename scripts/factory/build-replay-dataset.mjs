import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { normalizeReplayRawEvent, replaySequenceReport } from "./raw-tick-extract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = parseArgs(process.argv.slice(2));
const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
const inputRoot = path.resolve(args.input ?? path.join(dataRoot, "replay", "raw"));
const outputRoot = path.resolve(args.out ?? path.join(dataRoot, "replay", "final"));
const markets = args["markets-file"] ? await readMarketsFile(path.resolve(String(args["markets-file"]))) : [];
const gitCommit = await gitCommitMaybe();
const captureRunId = String(args["capture-run-id"] ?? `build-${new Date().toISOString().replaceAll(":", "-")}`);

const rawFiles = await listFiles(inputRoot, [".jsonl", ".jsonl.gz", ".ndjson"]);
const eventsByMarket = new Map();
let sourceFileOrdinal = 0;
for (const file of rawFiles) {
  sourceFileOrdinal += 1;
  const rows = readJsonLinesMaybeGzip(file);
  for (const raw of rows) {
    const event = normalizeReplayRawEvent(raw, {
      gitCommit,
      captureRunId,
      sourceFileOrdinal,
      provider: args.provider ?? raw?.provider ?? "kalshi",
      captureMode: args.mode ?? raw?.captureMode ?? "websocket",
    });
    if (!event) continue;
    if (markets.length && !markets.includes(event.marketTicker)) continue;
    const rowsForMarket = eventsByMarket.get(event.marketTicker) ?? [];
    rowsForMarket.push(event);
    eventsByMarket.set(event.marketTicker, rowsForMarket);
  }
}

await mkdir(outputRoot, { recursive: true });
const targetMarkets = markets.length ? markets : [...eventsByMarket.keys()].sort();
const marketSummaries = [];
const gapRows = [];
for (const marketTicker of targetMarkets) {
  const events = (eventsByMarket.get(marketTicker) ?? []).sort(compareReplayEvents);
  const marketDir = path.join(outputRoot, safeSegment(marketTicker));
  await mkdir(marketDir, { recursive: true });
  const replayPayload = events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : "");
  const replayPath = path.join(marketDir, "replay.jsonl.gz");
  await writeFile(replayPath, gzipSync(replayPayload));
  const sequence = replaySequenceReport(events);
  const index = {
    schemaVersion: "dogeedge.replay-index.v1",
    marketTicker,
    rowCount: events.length,
    firstReceiveTs: events[0]?.receiveTs ?? null,
    lastReceiveTs: events.at(-1)?.receiveTs ?? null,
    firstSeq: firstNumber(events.map((event) => event.seq)),
    lastSeq: lastNumber(events.map((event) => event.seq)),
    sha256: sha256(replayPayload),
    sequence,
  };
  const manifest = {
    schemaVersion: "dogeedge.replay-market-manifest.v1",
    marketTicker,
    generatedAt: new Date().toISOString(),
    provider: events[0]?.provider ?? args.provider ?? "kalshi",
    captureMode: events[0]?.captureMode ?? args.mode ?? "absent",
    replayGradeAvailable: sequence.replayGradeAvailable,
    executionSensitivePromotionAllowed: sequence.replayGradeAvailable,
    fallbackKind: sequence.fallbackKind,
    replayFile: "replay.jsonl.gz",
    indexFile: "replay.index.json",
    rowCount: events.length,
    sha256: index.sha256,
    gitCommit,
    captureRunId,
  };
  await writeFile(path.join(marketDir, "replay.index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await writeFile(path.join(marketDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  marketSummaries.push(manifest);
  for (const gap of sequence.gaps) gapRows.push({ marketTicker, ...gap });
}

const covered = marketSummaries.filter((row) => row.rowCount > 0).length;
const replayGrade = marketSummaries.filter((row) => row.replayGradeAvailable).length;
const summary = {
  schemaVersion: "dogeedge.replay-manifest-summary.v1",
  generatedAt: new Date().toISOString(),
  inputRoot,
  outputRoot,
  rawFileCount: rawFiles.length,
  targetMarketCount: targetMarkets.length,
  coveredTargetMarketCount: covered,
  replayGradeTargetMarketCount: replayGrade,
  replayGradeTargetMarketCoverage: targetMarkets.length ? round(replayGrade / targetMarkets.length) : 0,
  replayGradeAvailable: targetMarkets.length > 0 && replayGrade === targetMarkets.length,
  executionSensitivePromotionAllowed: targetMarkets.length > 0 && replayGrade === targetMarkets.length,
  fallbackKind: targetMarkets.length > 0 && replayGrade === targetMarkets.length
    ? "replay_grade"
    : covered > 0 && marketSummaries.some((row) => row.fallbackKind === "polling_diagnostic_only")
      ? "polling_diagnostic_only"
      : covered > 0 && marketSummaries.some((row) => row.fallbackKind === "candlestick_diagnostic_only")
        ? "candlestick_diagnostic_only"
        : "absent",
  reasonCodes: [
    ...(targetMarkets.length === 0 ? ["target_market_set_absent"] : []),
    ...(covered < targetMarkets.length ? ["replay_target_market_coverage_gap"] : []),
    ...(replayGrade < targetMarkets.length ? ["replay_sequence_incomplete_or_gap"] : []),
  ],
  markets: marketSummaries,
};
await writeFile(path.join(outputRoot, "replay_manifest_summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(path.join(outputRoot, "replay_gap_report.tsv"), tsv(["marketTicker", "expectedSeq", "actualSeq", "gapSize"], gapRows), "utf8");

console.log(`Replay dataset build complete`);
console.log(`Raw files: ${rawFiles.length}`);
console.log(`Markets: ${covered}/${targetMarkets.length} covered; replay-grade ${replayGrade}/${targetMarkets.length}`);
console.log(`Summary: ${path.join(outputRoot, "replay_manifest_summary.json")}`);

async function readMarketsFile(filePath) {
  const text = await readFile(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return uniqueStrings(Array.isArray(parsed) ? parsed : Array.isArray(parsed.markets) ? parsed.markets : Array.isArray(parsed.tickers) ? parsed.tickers : []);
  }
  return uniqueStrings(text.split(/\r?\n|,/));
}

async function listFiles(root, extensions) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      return entry.isDirectory() ? listFiles(fullPath, extensions) : extensions.some((ext) => fullPath.endsWith(ext)) ? [fullPath] : [];
    }));
    return nested.flat().sort();
  } catch {
    return [];
  }
}

function readJsonLinesMaybeGzip(filePath) {
  const buffer = readFileSync(filePath);
  const text = filePath.endsWith(".gz") ? gunzipSync(buffer).toString("utf8") : buffer.toString("utf8");
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function compareReplayEvents(left, right) {
  const leftSeq = typeof left.seq === "number" ? left.seq : null;
  const rightSeq = typeof right.seq === "number" ? right.seq : null;
  if (leftSeq !== null && rightSeq !== null && leftSeq !== rightSeq) return leftSeq - rightSeq;
  return Date.parse(left.receiveTs ?? "") - Date.parse(right.receiveTs ?? "");
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "_");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function firstNumber(values) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value)) ?? null;
}

function lastNumber(values) {
  return [...values].reverse().find((value) => typeof value === "number" && Number.isFinite(value)) ?? null;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))].sort();
}

function round(value) {
  return Number(value.toFixed(4));
}

function tsv(columns, rows) {
  return `${columns.join("\t")}\n${rows.map((row) => columns.map((column) => String(row[column] ?? "")).join("\t")).join("\n")}${rows.length ? "\n" : ""}`;
}

async function gitCommitMaybe() {
  try {
    const head = await readFile(path.join(repoRoot, ".git", "HEAD"), "utf8");
    if (head.startsWith("ref:")) {
      const ref = head.slice(5).trim();
      return (await readFile(path.join(repoRoot, ".git", ref), "utf8")).trim();
    }
    return head.trim();
  } catch {
    return "UNAVAILABLE";
  }
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
