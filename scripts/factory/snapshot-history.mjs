import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { roundMoney, roundRatio } from "./utils.mjs";

export async function loadSnapshotHistory({ snapshotsRoot, hours = 48, now = Date.now() } = {}) {
  const cutoffMs = toNowMs(now) - hours * 60 * 60_000;
  const snapshots = [];
  for (const dir of await readdir(snapshotsRoot).catch(() => [])) {
    const fullDir = path.join(snapshotsRoot, dir);
    const file = path.join(fullDir, `${dir}.json.gz`);
    const snapshot = await readSnapshot(file);
    if (!snapshot) continue;
    const generatedMs = Date.parse(snapshot.generatedAt ?? "");
    if (Number.isFinite(generatedMs) && generatedMs >= cutoffMs) snapshots.push(compactSnapshot(snapshot));
  }
  return snapshots.sort((left, right) => Date.parse(left.generatedAt) - Date.parse(right.generatedAt));
}

export async function writeSnapshotHistory({ snapshotsRoot, outRoot, hours = 48, now = Date.now() } = {}) {
  const snapshotNowMs = toNowMs(now);
  const snapshots = await loadSnapshotHistory({ snapshotsRoot, hours, now: snapshotNowMs });
  const latest = snapshots.at(-1) ?? null;
  const previous = snapshots.at(-2) ?? null;
  const baseline = snapshots[0] ?? null;
  const history = {
    schemaVersion: "dogeedge.eval.snapshot-history.v1",
    generatedAt: new Date(snapshotNowMs).toISOString(),
    hours,
    snapshotCount: snapshots.length,
    latestSnapshotId: latest?.snapshotId ?? null,
    previousSnapshotId: previous?.snapshotId ?? null,
    baselineSnapshotId: baseline?.snapshotId ?? null,
    latest,
    previousDelta: latest && previous ? snapshotDelta(latest, previous) : null,
    baselineDelta: latest && baseline && latest.snapshotId !== baseline.snapshotId ? snapshotDelta(latest, baseline) : null,
    trendVerdict: trendVerdict(latest, previous, baseline),
    snapshots,
  };
  await mkdir(outRoot, { recursive: true });
  await writeFile(path.join(outRoot, "snapshot-history-48h.json"), `${JSON.stringify(history, null, 2)}\n`, "utf8");
  await writeFile(path.join(outRoot, "snapshot-history-48h.md"), snapshotHistoryMarkdown(history), "utf8");
  return history;
}

export function snapshotDelta(latest, baseline) {
  return {
    snapshotId: latest.snapshotId,
    comparedToSnapshotId: baseline.snapshotId,
    generatedAtDeltaMinutes: roundRatio((Date.parse(latest.generatedAt) - Date.parse(baseline.generatedAt)) / 60_000),
    topRobustScoreDelta: delta(latest.topRobustScore, baseline.topRobustScore),
    topConservativePnlDelta: delta(latest.topConservativePnl, baseline.topConservativePnl),
    promotableCountDelta: latest.promotableCount - baseline.promotableCount,
    insufficientDataCountDelta: latest.insufficientDataCount - baseline.insufficientDataCount,
    rejectCountDelta: latest.rejectCount - baseline.rejectCount,
    driftAlertCountDelta: latest.driftAlertCount - baseline.driftAlertCount,
    safetyAlertCountDelta: latest.safetyAlertCount - baseline.safetyAlertCount,
    warningCountDelta: latest.warningCount - baseline.warningCount,
  };
}

function compactSnapshot(snapshot) {
  const rows = Array.isArray(snapshot.algoRollup) ? snapshot.algoRollup : [];
  const top = rows
    .slice()
    .sort((left, right) => Number(right.performance?.robustScore ?? right.robustScore ?? -999) - Number(left.performance?.robustScore ?? left.robustScore ?? -999))[0] ?? null;
  return {
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    windowStartAt: snapshot.window?.startAt ?? null,
    windowEndAt: snapshot.window?.endAt ?? null,
    topAlgoId: top?.algoId ?? null,
    topPromotionVerdict: top?.promotionVerdict ?? null,
    topRobustScore: numberOrZero(top?.performance?.robustScore ?? top?.robustScore),
    topConservativePnl: numberOrZero(top?.performance?.conservativeTotalPnl ?? top?.conservativeTotalPnl),
    promotableCount: rows.filter((row) => ["paper_only", "tiny_live_eligible"].includes(row.promotionVerdict)).length,
    insufficientDataCount: rows.filter((row) => row.promotionVerdict === "insufficient_data").length,
    rejectCount: rows.filter((row) => row.promotionVerdict === "reject").length,
    driftAlertCount: rows.filter((row) => row.drift?.driftOk === false).length,
    safetyAlertCount: (snapshot.alerts ?? []).filter((alert) => alert.severity === "critical").length,
    warningCount: (snapshot.warnings ?? []).length,
    dataQualityErrorCount: snapshot.dataQuality?.errorCount ?? 0,
  };
}

function trendVerdict(latest, previous, baseline) {
  if (!latest) return "no_snapshots";
  if (latest.safetyAlertCount > 0 || latest.dataQualityErrorCount > 0) return "blocked_by_safety_or_data_quality";
  if (!previous) return "baseline_started";
  const previousDelta = snapshotDelta(latest, previous);
  const baselineDelta = baseline && latest.snapshotId !== baseline.snapshotId ? snapshotDelta(latest, baseline) : previousDelta;
  if (previousDelta.topRobustScoreDelta > 0 && baselineDelta.topRobustScoreDelta >= 0 && latest.driftAlertCount <= previous.driftAlertCount) return "improving";
  if (previousDelta.topRobustScoreDelta < 0 || latest.driftAlertCount > previous.driftAlertCount) return "degrading";
  return "flat";
}

function snapshotHistoryMarkdown(history) {
  return [
    "# DogeEdge Eval Snapshot History",
    "",
    "## Executive Summary",
    "",
    `Trend verdict: ${history.trendVerdict}. Snapshots in window: ${history.snapshotCount}.`,
    "",
    "## Latest",
    "",
    history.latest ? [
      `- Snapshot: ${history.latest.snapshotId}`,
      `- Top algo: ${history.latest.topAlgoId ?? "-"}`,
      `- Top verdict: ${history.latest.topPromotionVerdict ?? "-"}`,
      `- Top robust score: ${history.latest.topRobustScore}`,
      `- Promotable count: ${history.latest.promotableCount}`,
      `- Insufficient-data count: ${history.latest.insufficientDataCount}`,
      `- Drift alerts: ${history.latest.driftAlertCount}`,
    ].join("\n") : "- No snapshots.",
    "",
    "## Deltas",
    "",
    "| Compare | Robust | Conservative P/L | Promotable | Insufficient | Drift Alerts | Safety Alerts |",
    "|---|---:|---:|---:|---:|---:|---:|",
    deltaRow("Previous", history.previousDelta),
    deltaRow("48h baseline", history.baselineDelta),
    "",
    "## Cadence",
    "",
    "```mermaid",
    "timeline",
    "  title DogeEdge Improvement Loop Cadence",
    "  Every 30 minutes : eval:snapshot : local evidence packet",
    "  Every 2 hours : eval:bundle : review ZIP and history index",
    "  Sandbox patch : GPT CLI branch : tests, lint, build",
    "  Human gate : merge-safety review : approve or reject",
    "  Merge decision : push main or keep sandbox",
    "```",
    "",
  ].join("\n");
}

function deltaRow(label, value) {
  if (!value) return `| ${label} | - | - | - | - | - | - |`;
  return `| ${label} | ${value.topRobustScoreDelta} | ${money(value.topConservativePnlDelta)} | ${value.promotableCountDelta} | ${value.insufficientDataCountDelta} | ${value.driftAlertCountDelta} | ${value.safetyAlertCountDelta} |`;
}

function delta(left, right) {
  return roundRatio(numberOrZero(left) - numberOrZero(right));
}

function money(value) {
  return typeof value === "number" && Number.isFinite(value) ? `$${roundMoney(value).toFixed(2)}` : "-";
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function readSnapshot(file) {
  try {
    return JSON.parse(gunzipSync(await readFile(file)).toString("utf8"));
  } catch {
    return null;
  }
}

function toNowMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}
