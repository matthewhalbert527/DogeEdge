import { createHash } from "node:crypto";
import { isRecord, numberOrNull, stringOrNull } from "./utils.mjs";

export const rawTickReplaySchemaVersion = "dogeedge.raw-market-ticks.schema.v1";

export function compactReplayTickRow(raw, sourceLine, context = {}) {
  const input = isRecord(raw?.paperInput) ? raw.paperInput : {};
  const feed = isRecord(raw?.runtimeSnapshot?.feed) ? raw.runtimeSnapshot.feed : {};
  const action = String(input.action ?? raw?.action ?? "");
  return {
    ts_event: input.observedAt ?? raw?.observedAt ?? raw?.capturedAt ?? null,
    ts_receive: raw?.capturedAt ?? raw?.runtimeSnapshot?.generatedAt ?? null,
    market_ticker: raw?.marketTicker ?? input.ticker ?? raw?.market_ticker ?? null,
    channel: raw?.channel ?? "local_raw_snapshot",
    event_type: raw?.event_type ?? raw?.eventType ?? "orderbook_snapshot",
    side: action.includes("no") ? "NO" : action.includes("yes") ? "YES" : "",
    book_side: raw?.book_side ?? "top",
    price: numberOrNull(input.selectedAsk ?? input.yesAsk ?? input.noAsk ?? raw?.price),
    size: numberOrNull(input.sizeContracts ?? raw?.size),
    level: numberOrNull(raw?.level) ?? 0,
    sequence_number: numberOrNull(raw?.sequence_number ?? raw?.sequenceNumber),
    best_yes_bid: numberOrNull(input.yesBid ?? raw?.best_yes_bid),
    best_yes_ask: numberOrNull(input.yesAsk ?? raw?.best_yes_ask),
    best_no_bid: numberOrNull(input.noBid ?? raw?.best_no_bid),
    best_no_ask: numberOrNull(input.noAsk ?? raw?.best_no_ask),
    market_status: input.marketLive === true ? "open" : stringOrNull(raw?.market_status) ?? "unknown",
    source: raw?.source ?? "local_raw_snapshot",
    source_message_hash: sha256(String(sourceLine ?? "")),
    snapshot_id: context.snapshotId ?? null,
    git_commit: context.gitCommit ?? "UNAVAILABLE",
    spot_price: numberOrNull(input.spotPrice ?? feed.price ?? raw?.spot_price),
    target_price: numberOrNull(input.targetPrice ?? raw?.target_price),
    seconds_to_close: numberOrNull(input.secondsToClose ?? raw?.seconds_to_close),
  };
}

export function rawTickReplayManifest({
  snapshotId,
  generatedAt,
  gitCommit = "UNAVAILABLE",
  requestedFormat = "jsonl",
  targetMarkets = [],
  jsonlFiles = [],
  sourceSnapshotFiles = [],
}) {
  const coveredTargetMarkets = uniqueStrings(jsonlFiles.map((file) => file.marketTicker));
  const coveredSet = new Set(coveredTargetMarkets);
  const uncoveredTargetMarkets = uniqueStrings(targetMarkets).filter((marketTicker) => !coveredSet.has(marketTicker));
  const sequenceGapCheckAvailable = jsonlFiles.some((file) => file.sequenceGapCheckAvailable === true);
  const replayGradeFormat = requestedFormat === "parquet" ? "parquet" : "jsonl_indexed";
  const replayGradeAvailable = jsonlFiles.length > 0
    && uncoveredTargetMarkets.length === 0
    && sequenceGapCheckAvailable
    && requestedFormat === "parquet";
  return {
    schemaVersion: "dogeedge.raw-market-ticks.manifest.v1",
    snapshotId,
    generatedAt,
    available: jsonlFiles.length > 0,
    format: jsonlFiles.length > 0 ? "jsonl" : null,
    requestedFormat,
    exportedFormat: jsonlFiles.length > 0 ? "jsonl" : null,
    replayGradeFormat,
    replayGradeAvailable,
    promotionGradeReplayAvailable: replayGradeAvailable,
    parquetAvailable: requestedFormat === "parquet" && jsonlFiles.length > 0,
    jsonlAvailable: jsonlFiles.length > 0,
    executionSensitivePromotionAllowed: replayGradeAvailable,
    promotionGateRequirement: "replay_grade_target_market_ticks_required_for_execution_sensitive_promotion",
    gitCommit,
    expectedDirectory: "raw_market_ticks/<market_ticker>.parquet",
    jsonlDirectory: "raw_market_ticks/jsonl/<market_ticker>.jsonl",
    targetMarkets: uniqueStrings(targetMarkets),
    targetMarketCount: uniqueStrings(targetMarkets).length,
    coveredTargetMarkets,
    uncoveredTargetMarkets,
    coveredTargetMarketCount: coveredTargetMarkets.length,
    uncoveredTargetMarketCount: uncoveredTargetMarkets.length,
    jsonlFiles,
    sourceSnapshotFiles,
    sourceSnapshotFileCount: sourceSnapshotFiles.length,
    sequenceGapCheckAvailable,
    warningCodes: [
      ...(!replayGradeAvailable ? ["replay_grade_target_market_ticks_absent"] : []),
      ...(requestedFormat !== "parquet" ? ["raw_market_tick_parquet_absent"] : []),
      ...(jsonlFiles.length > 0 ? ["raw_market_tick_jsonl_sample"] : ["raw_market_tick_jsonl_absent"]),
      ...(uncoveredTargetMarkets.length > 0 ? ["raw_market_tick_target_coverage_gap"] : []),
      ...(!sequenceGapCheckAvailable ? ["sequence_gap_check_absent"] : []),
      ...(sourceSnapshotFiles.length === 0 ? ["raw_snapshot_source_absent"] : []),
    ],
  };
}

export function rawTickReplayCoverageRows({ snapshotId, targetMarkets = [], jsonlFiles = [], requestedFormat = "jsonl" }) {
  const byMarket = new Map(jsonlFiles.map((file) => [file.marketTicker, file]));
  return uniqueStrings(targetMarkets).map((marketTicker) => {
    const file = byMarket.get(marketTicker);
    return {
      snapshotId,
      marketTicker,
      available: Boolean(file),
      replayGrade: file?.replayGrade === true,
      format: file ? requestedFormat : "",
      jsonlRows: file?.rows ?? 0,
      relativePath: file?.relativePath ?? "",
      uncoveredReason: file ? "" : "target_market_raw_tick_sample_absent",
    };
  });
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
