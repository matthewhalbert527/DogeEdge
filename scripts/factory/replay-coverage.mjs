import { roundRatio } from "./utils.mjs";

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
