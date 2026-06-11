import { roundRatio } from "./utils.mjs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function replayParityReportFromManifest({ snapshotId, generatedAt, rawTickManifest }) {
  const manifest = rawTickManifest && typeof rawTickManifest === "object" ? rawTickManifest : {};
  const targetMarketCount = numeric(manifest.targetMarketCount);
  const coveredTargetMarketCount = numeric(manifest.coveredTargetMarketCount);
  const uncoveredTargetMarketCount = numeric(manifest.uncoveredTargetMarketCount ?? Math.max(0, targetMarketCount - coveredTargetMarketCount));
  const parquetAvailable = manifest.parquetAvailable === true;
  const jsonlAvailable = manifest.jsonlAvailable === true;
  const sequenceGapCheckAvailable = manifest.sequenceGapCheckAvailable === true;
  const replayGrade = manifest.replayGradeAvailable === true
    || (parquetAvailable && targetMarketCount > 0 && uncoveredTargetMarketCount === 0 && sequenceGapCheckAvailable);
  const sampleParity = (jsonlAvailable || parquetAvailable) && targetMarketCount > 0 && uncoveredTargetMarketCount === 0;
  return {
    schemaVersion: "dogeedge.replay-parity-report.v1",
    snapshotId,
    generatedAt,
    targetMarketCount,
    coveredTargetMarketCount,
    uncoveredTargetMarketCount,
    coverageRate: targetMarketCount > 0 ? roundRatio(coveredTargetMarketCount / targetMarketCount) : 0,
    parquetAvailable,
    jsonlAvailable,
    replayGrade,
    sampleParity,
    executionSensitivePromotionAllowed: replayGrade,
    fallbackKind: sampleParity && !replayGrade ? "jsonl_or_candlestick_diagnostic_only" : replayGrade ? "replay_grade" : "absent",
    sourceSnapshotFileCount: numeric(manifest.sourceSnapshotFileCount),
    hashedSourceSnapshotFileCount: numeric(manifest.hashedSourceSnapshotFileCount),
    sequenceGapCheckAvailable,
    failClosed: !replayGrade,
    reasonCodes: [
      ...(!parquetAvailable ? ["raw_market_tick_parquet_absent"] : []),
      ...(targetMarketCount === 0 ? ["target_market_set_absent"] : []),
      ...(uncoveredTargetMarketCount > 0 ? ["raw_market_tick_target_coverage_gap"] : []),
      ...(!sequenceGapCheckAvailable ? ["sequence_gap_check_absent"] : []),
      ...(!replayGrade ? ["replay_grade_target_market_ticks_absent"] : []),
    ],
  };
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function replayCoverageCli() {
  const args = parseArgs(process.argv.slice(2));
  const inputRoot = path.resolve(args.input ?? args["replay-root"] ?? "data/replay/final");
  const manifests = await readReplayMarketManifests(inputRoot);
  const targetMarkets = args["markets-file"] ? await readMarketsFile(path.resolve(String(args["markets-file"]))) : manifests.map((row) => row.marketTicker);
  const byMarket = new Map(manifests.map((manifest) => [manifest.marketTicker, manifest]));
  const rows = targetMarkets.map((marketTicker) => {
    const manifest = byMarket.get(marketTicker);
    return {
      marketTicker,
      rowCount: numeric(manifest?.rowCount),
      replayGradeAvailable: manifest?.replayGradeAvailable === true,
      fallbackKind: manifest?.fallbackKind ?? "absent",
      executionSensitivePromotionAllowed: manifest?.executionSensitivePromotionAllowed === true,
    };
  });
  const covered = rows.filter((row) => row.rowCount > 0).length;
  const replayGrade = rows.filter((row) => row.replayGradeAvailable).length;
  const report = {
    schemaVersion: "dogeedge.replay-coverage-report.v1",
    generatedAt: new Date().toISOString(),
    inputRoot,
    targetMarketCount: targetMarkets.length,
    coveredTargetMarketCount: covered,
    replayGradeTargetMarketCount: replayGrade,
    replayGradeTargetMarketCoverage: targetMarkets.length ? roundRatio(replayGrade / targetMarkets.length) : 0,
    replayGradeAvailable: targetMarkets.length > 0 && replayGrade === targetMarkets.length,
    executionSensitivePromotionAllowed: targetMarkets.length > 0 && replayGrade === targetMarkets.length,
    fallbackKind: targetMarkets.length > 0 && replayGrade === targetMarkets.length
      ? "replay_grade"
      : rows.some((row) => row.fallbackKind === "polling_diagnostic_only")
        ? "polling_diagnostic_only"
        : rows.some((row) => row.fallbackKind === "candlestick_diagnostic_only")
          ? "candlestick_diagnostic_only"
          : "absent",
    reasonCodes: [
      ...(targetMarkets.length === 0 ? ["target_market_set_absent"] : []),
      ...(covered < targetMarkets.length ? ["replay_target_market_coverage_gap"] : []),
      ...(replayGrade < targetMarkets.length ? ["replay_grade_target_market_coverage_incomplete"] : []),
    ],
    rows,
  };
  const outPath = path.resolve(args.out ?? path.join(inputRoot, "replay_coverage_report.json"));
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(path.dirname(outPath), "replay_coverage.tsv"), tsv(["marketTicker", "rowCount", "replayGradeAvailable", "fallbackKind", "executionSensitivePromotionAllowed"], rows), "utf8");
  console.log(`Replay coverage: ${replayGrade}/${targetMarkets.length} replay-grade, ${covered}/${targetMarkets.length} covered`);
  console.log(`Report: ${outPath}`);
}

async function readReplayMarketManifests(root) {
  const files = await listFiles(root, "manifest.json");
  const rows = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      if (parsed?.schemaVersion === "dogeedge.replay-market-manifest.v1") rows.push(parsed);
    } catch {
      // Skip malformed manifests; coverage remains fail-closed.
    }
  }
  return rows.sort((left, right) => String(left.marketTicker).localeCompare(String(right.marketTicker)));
}

async function listFiles(root, name) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      return entry.isDirectory() ? listFiles(fullPath, name) : entry.name === name ? [fullPath] : [];
    }));
    return nested.flat();
  } catch {
    return [];
  }
}

async function readMarketsFile(filePath) {
  const text = await readFile(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return uniqueStrings(Array.isArray(parsed) ? parsed : Array.isArray(parsed.markets) ? parsed.markets : Array.isArray(parsed.tickers) ? parsed.tickers : []);
  }
  return uniqueStrings(text.split(/\r?\n|,/));
}

function tsv(columns, rows) {
  return `${columns.join("\t")}\n${rows.map((row) => columns.map((column) => String(row[column] ?? "")).join("\t")).join("\n")}${rows.length ? "\n" : ""}`;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))].sort();
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  replayCoverageCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
