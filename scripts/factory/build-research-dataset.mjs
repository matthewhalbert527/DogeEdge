import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { readOfficialSettlementStore, normalizeOfficialSettlementRow } from "./official-settlement.mjs";
import { hashJson, stableStringify } from "./utils.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/factory/build-research-dataset.mjs [--data-root dir] [--replay-root dir] [--settlements path] [--out dir] [--min-markets n]");
    process.exit(0);
  }
  const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const replayRoot = path.resolve(args["replay-root"] ?? path.join(dataRoot, "replay", "final"));
  const settlementPath = path.resolve(args.settlements ?? process.env.DOGEEDGE_OFFICIAL_SETTLEMENTS ?? path.join(dataRoot, "official_settlements.jsonl"));
  const datasetId = String(args["dataset-id"] ?? `research-dataset-${new Date().toISOString().replaceAll(":", "-")}`);
  const outDir = path.resolve(args.out ?? path.join(dataRoot, "research", "datasets", datasetId));
  const gitCommit = await gitCommitMaybe();
  const settlements = await readOfficialSettlementStore(settlementPath);
  const officialByTicker = new Map();
  for (const row of settlements) {
    const normalized = normalizeOfficialSettlementRow(row, { fetchedAt: row?.fetchedAt ?? new Date(0).toISOString() });
    if (normalized?.marketTicker && normalized.officialResolutionAvailable === true && normalized.finalized === true && normalized.settlementTimestamp) {
      officialByTicker.set(normalized.marketTicker, normalized);
    }
  }

  const replayManifests = await findReplayManifests(replayRoot);
  const markets = [];
  const decisions = [];
  const rejections = [];
  for (const manifestPath of replayManifests) {
    const manifest = await readJsonMaybe(manifestPath);
    if (!manifest?.marketTicker) continue;
    const marketTicker = manifest.marketTicker;
    const official = officialByTicker.get(marketTicker);
    const indexPath = path.join(path.dirname(manifestPath), manifest.indexFile ?? "replay.index.json");
    const index = await readJsonMaybe(indexPath);
    const replayPath = path.join(path.dirname(manifestPath), manifest.replayFile ?? "replay.jsonl.gz");
    const replayBytes = await readFile(replayPath).catch(() => null);
    const replayRows = replayBytes ? readJsonLinesMaybeGzip(replayBytes, replayPath) : [];
    const replayHash = replayBytes ? sha256(replayBytes) : null;
    const rawCaptureHash = hashJson({
      replayHash,
      sourceEventCount: manifest.sourceEventCount,
      deterministicReplayHash: manifest.deterministicReplayHash,
    });
    const rejectReasons = rejectReplayMarket({ manifest, official, replayRows });
    if (rejectReasons.length) {
      rejections.push({ marketTicker, reasonCodes: rejectReasons.join(","), replayManifestPath: manifestPath });
      continue;
    }
    const firstEvent = replayRows[0] ?? null;
    const lastEvent = replayRows.at(-1) ?? null;
    const market = {
      schemaVersion: "dogeedge.research-market.v1",
      marketTicker,
      marketId: firstEvent?.marketId ?? null,
      eventTicker: official.eventTicker ?? null,
      openTimestamp: firstEvent?.receiveTs ?? null,
      closeTimestamp: official.closeTime ?? null,
      determinedTimestamp: official.determinationTimestamp ?? null,
      finalizedTimestamp: official.settlementTimestamp ?? null,
      officialResult: official.outcomeSide,
      officialSettlementTimestamp: official.settlementTimestamp,
      replayManifestHash: sha256(stableStringify(manifest)),
      replayFileHash: replayHash,
      rawCaptureHash,
      firstSequence: index?.firstSeq ?? manifest.firstSeq ?? null,
      lastSequence: index?.lastSeq ?? manifest.lastSeq ?? null,
      sequenceGapStatus: Number(manifest.sequenceGapCount ?? 0) === 0 ? "none" : "unresolved_gap",
      captureStart: manifest.firstReceiveTs ?? firstEvent?.receiveTs ?? null,
      captureEnd: manifest.lastReceiveTs ?? lastEvent?.receiveTs ?? null,
      validCandidateEvaluationWindows: [{
        start: manifest.firstReceiveTs ?? firstEvent?.receiveTs ?? null,
        end: manifest.lastReceiveTs ?? lastEvent?.receiveTs ?? null,
        replayGrade: true,
      }],
      featureSchemaVersion: "dogeedge.research-features.v1",
      marketRegimeTags: regimeTagsFor(manifest, replayRows),
      liquidity: liquidityStats(replayRows),
      spread: spreadStats(replayRows),
      externalSpotSourceProvenance: [],
      dataQualityFlags: [],
      codeCommit: gitCommit,
      datasetVersion: "dogeedge.research-dataset.v1",
    };
    market.marketRowHash = hashJson(market);
    markets.push(market);
    const frame = decisionFrameForMarket({ market, manifest, index, firstEvent, official, gitCommit });
    if (frame) decisions.push(frame);
  }

  markets.sort((left, right) => String(left.closeTimestamp ?? left.captureEnd ?? "").localeCompare(String(right.closeTimestamp ?? right.captureEnd ?? "")) || left.marketTicker.localeCompare(right.marketTicker));
  decisions.sort((left, right) => String(left.decisionTimestamp ?? "").localeCompare(String(right.decisionTimestamp ?? "")) || left.marketTicker.localeCompare(right.marketTicker));
  const datasetPayloadHash = hashJson({ markets, decisions });
  const datasetHash = sha256(datasetPayloadHash);
  const manifest = {
    schemaVersion: "dogeedge.research-dataset-manifest.v1",
    generatedAt: new Date().toISOString(),
    datasetId,
    datasetVersion: "dogeedge.research-dataset.v1",
    gitCommit,
    datasetHash,
    datasetPayloadHash,
    replayRoot,
    settlementPath,
    settlementStoreHash: await fileHashMaybe(settlementPath),
    sourceReplayHashes: markets.map((row) => ({ marketTicker: row.marketTicker, replayManifestHash: row.replayManifestHash, replayFileHash: row.replayFileHash, rawCaptureHash: row.rawCaptureHash })),
    featureSchemaVersion: "dogeedge.research-features.v1",
    simulatorVersion: "dogeedge.simulator.v2",
    costModelVersion: "dogeedge.cost-model.v2",
    includedMarketIds: markets.map((row) => row.marketTicker),
    excludedMarketIds: rejections.map((row) => ({ marketTicker: row.marketTicker, reasonCodes: row.reasonCodes })),
    marketCount: markets.length,
    decisionFrameCount: decisions.length,
    independentStatisticalUnit: "market_contract",
    rowsCapped: false,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "dataset_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "markets.jsonl.gz"), gzipSync(`${markets.map((row) => JSON.stringify(row)).join("\n")}${markets.length ? "\n" : ""}`));
  await writeFile(path.join(outDir, "decision_frames.jsonl.gz"), gzipSync(`${decisions.map((row) => JSON.stringify(row)).join("\n")}${decisions.length ? "\n" : ""}`));
  await writeFile(path.join(outDir, "dataset_rejections.tsv.gz"), gzipSync(tsv(["marketTicker", "reasonCodes", "replayManifestPath"], rejections)));
  await writeFile(path.join(outDir, "feature_availability_audit.tsv.gz"), gzipSync(tsv(["marketTicker", "decisionTimestamp", "latestFeatureSourceTimestamp", "labelTimestamp", "ok", "reasonCode"], decisions.map((row) => ({
    marketTicker: row.marketTicker,
    decisionTimestamp: row.decisionTimestamp,
    latestFeatureSourceTimestamp: row.latestFeatureSourceTimestamp,
    labelTimestamp: row.labelTimestamp,
    ok: row.latestFeatureSourceTimestamp <= row.decisionTimestamp && row.labelTimestamp > row.marketCloseTimestamp,
    reasonCode: row.latestFeatureSourceTimestamp <= row.decisionTimestamp ? "" : "feature_timestamp_leakage",
  })))));
  await writeFile(path.join(outDir, "market_regime_summary.tsv.gz"), gzipSync(tsv(["marketTicker", "day", "timeToCloseBucket", "spreadBucket", "liquidityBucket"], markets.map((row) => ({
    marketTicker: row.marketTicker,
    day: String(row.closeTimestamp ?? row.captureEnd ?? "").slice(0, 10),
    timeToCloseBucket: row.marketRegimeTags.timeToCloseBucket,
    spreadBucket: row.marketRegimeTags.spreadBucket,
    liquidityBucket: row.marketRegimeTags.liquidityBucket,
  })))));
  await writeFile(path.join(outDir, "data_lineage.tsv.gz"), gzipSync(tsv(["marketTicker", "codeCommit", "replayManifestHash", "replayFileHash", "rawCaptureHash", "marketRowHash"], markets)));
  await writeFile(path.join(outDir, "dataset_quality_report.json"), `${JSON.stringify(qualityReport({ manifest, markets, decisions, rejections }), null, 2)}\n`, "utf8");
  console.log(`Research dataset built: ${markets.length} markets, ${decisions.length} decision frames`);
  console.log(`Manifest: ${path.join(outDir, "dataset_manifest.json")}`);
}

function rejectReplayMarket({ manifest, official, replayRows }) {
  const reasons = [];
  if (manifest.replayGradeAvailable !== true && manifest.replayGradeForSegment !== true) reasons.push("replay_not_grade");
  if (manifest.useYesPrice !== true) reasons.push("use_yes_price_missing");
  if (Number(manifest.sequenceGapCount ?? 0) > 0) reasons.push("unresolved_sequence_gap");
  if (!official) reasons.push("official_finalized_settlement_missing");
  if (!official?.settlementTimestamp) reasons.push("settlement_ts_missing");
  if (!replayRows.length) reasons.push("replay_rows_absent");
  return reasons;
}

function decisionFrameForMarket({ market, manifest, index, firstEvent, official, gitCommit }) {
  if (!firstEvent || !market.captureStart || !market.captureEnd || !official?.settlementTimestamp) return null;
  const decisionTimestamp = firstEvent.receiveTs;
  const marketCloseTimestamp = official.closeTime ?? market.captureEnd;
  const labelTimestamp = official.settlementTimestamp;
  if (!(Date.parse(decisionTimestamp) < Date.parse(marketCloseTimestamp))) return null;
  if (!(Date.parse(labelTimestamp) > Date.parse(marketCloseTimestamp))) return null;
  return {
    schemaVersion: "dogeedge.research-decision-frame.v1",
    marketTicker: market.marketTicker,
    marketId: market.marketId,
    featureTimestamp: firstEvent.receiveTs,
    decisionTimestamp,
    earliestSourceTimestamp: firstEvent.providerTs ?? firstEvent.receiveTs,
    latestFeatureSourceTimestamp: firstEvent.receiveTs,
    labelHorizon: "contract_finalized",
    timeToCloseSeconds: Math.max(0, Math.round((Date.parse(marketCloseTimestamp) - Date.parse(decisionTimestamp)) / 1000)),
    bookSnapshotSequence: index?.firstSeq ?? manifest.firstSeq ?? firstEvent.seq ?? null,
    featureAvailabilityProof: hashJson({
      latestFeatureSourceTimestamp: firstEvent.receiveTs,
      decisionTimestamp,
      payloadSha256: firstEvent.payloadSha256,
    }),
    candidateId: null,
    candidateConfigHash: null,
    marketCloseTimestamp,
    labelTimestamp,
    officialSettlementStatus: "finalized",
    noUnresolvedReplayGapInCandidateWindow: true,
    codeCommit: gitCommit,
  };
}

function liquidityStats(rows) {
  const depths = rows.flatMap((row) => [row.bestYesBid, row.bestYesAsk, row.bestNoBid, row.bestNoAsk]).filter((value) => Number.isFinite(value));
  return {
    observedTopOfBookCount: depths.length,
    eventCount: rows.length,
    tradeCount: rows.filter((row) => row.messageType === "trade").length,
  };
}

function spreadStats(rows) {
  const spreads = rows.map((row) => {
    if (Number.isFinite(row.bestYesBid) && Number.isFinite(row.bestYesAsk)) return Math.max(0, row.bestYesAsk - row.bestYesBid);
    return null;
  }).filter((value) => Number.isFinite(value));
  return {
    spreadObservationCount: spreads.length,
    averageSpread: spreads.length ? round(spreads.reduce((sum, value) => sum + value, 0) / spreads.length) : null,
    maxSpread: spreads.length ? round(Math.max(...spreads)) : null,
  };
}

function regimeTagsFor(manifest, rows) {
  const spread = spreadStats(rows);
  const liquidity = liquidityStats(rows);
  return {
    timeToCloseBucket: "captured_window",
    spreadBucket: spread.averageSpread === null ? "unknown" : spread.averageSpread <= 0.03 ? "tight" : spread.averageSpread <= 0.08 ? "normal" : "wide",
    liquidityBucket: liquidity.tradeCount > 10 ? "active" : liquidity.eventCount > 20 ? "normal" : "thin",
    replayGrade: manifest.replayGradeAvailable === true || manifest.replayGradeForSegment === true,
  };
}

function qualityReport({ manifest, markets, decisions, rejections }) {
  const days = new Set(markets.map((row) => String(row.closeTimestamp ?? row.captureEnd ?? "").slice(0, 10)).filter(Boolean));
  return {
    schemaVersion: "dogeedge.research-dataset-quality.v1",
    generatedAt: manifest.generatedAt,
    datasetHash: manifest.datasetHash,
    marketCount: markets.length,
    decisionFrameCount: decisions.length,
    distinctDayCount: days.size,
    rejectedMarketCount: rejections.length,
    independentUnit: "market_contract",
    leakageCheckPassed: decisions.every((row) => row.latestFeatureSourceTimestamp <= row.decisionTimestamp && row.decisionTimestamp < row.marketCloseTimestamp && row.labelTimestamp > row.marketCloseTimestamp),
    replayGradeOnly: rejections.every((row) => !String(row.reasonCodes).includes("accepted_non_replay")),
    officialFinalizedOnly: decisions.length === markets.length,
    reasonCodes: [
      ...(markets.length === 0 ? ["research_dataset_empty"] : []),
      ...(decisions.length !== markets.length ? ["decision_frame_count_mismatch"] : []),
    ],
  };
}

async function findReplayManifests(root) {
  const files = await listFiles(root);
  return files.filter((file) => path.basename(file) === "manifest.json" && !file.endsWith(`raw_market_ticks${path.sep}manifest.json`));
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  }));
  return nested.flat().sort();
}

function readJsonLinesMaybeGzip(buffer, filePath) {
  const text = (filePath.endsWith(".gz") ? gunzipSync(buffer) : buffer).toString("utf8");
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function fileHashMaybe(filePath) {
  try {
    return sha256(await readFile(filePath));
  } catch {
    return null;
  }
}

function tsv(columns, rows) {
  return `${columns.join("\t")}\n${rows.map((row) => columns.map((column) => String(row[column] ?? "")).join("\t")).join("\n")}${rows.length ? "\n" : ""}`;
}

function round(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

async function gitCommitMaybe() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)("git", ["-C", repoRoot, "rev-parse", "HEAD"], { windowsHide: true });
    return stdout.trim();
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
