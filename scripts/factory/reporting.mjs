export function metricsCsv(metrics) {
  const headers = [
    "algoId",
    "algoName",
    "family",
    "closed",
    "independentClosedMarkets",
    "daysRepresented",
    "wins",
    "losses",
    "winRate",
    "totalPnl",
    "totalCost",
    "roi",
    "conservativeTotalPnl",
    "stressTotalPnl",
    "maxDrawdown",
    "foldConsistency",
    "psr",
    "dsr",
    "pbo",
    "adjustedConfidence",
    "robustScore",
    "promotionVerdict",
    "reasonCodes",
  ];
  return [
    headers.join(","),
    ...metrics.map((metric) => headers.map((key) => csvValue(csvMetricValue(metric, key))).join(",")),
  ].join("\n");
}

export function markdownReport({ runId, startedAt, finishedAt, dataRoot, framesDir, frameCount, eventCount, algoCount, sweepMode, dataQuality, metrics, candidates }) {
  const top = candidates[0] ?? metrics[0] ?? null;
  return [
    "# DogeEdge Algo Factory Report",
    "",
    `- Run: ${runId}`,
    `- Mode: ${sweepMode ? "sweep" : "backtest"}`,
    `- Started: ${startedAt}`,
    `- Finished: ${finishedAt}`,
    `- Data root: ${dataRoot}`,
    `- Frames: ${frameCount}`,
    `- Market events: ${eventCount}`,
    `- Algos: ${algoCount}`,
    "",
    "## Data Quality",
    "",
    dataQuality ? [
      `- Raw frames: ${dataQuality.rawFrames}`,
      `- Usable frames: ${dataQuality.usableFrames}`,
      `- Duplicate frames removed: ${dataQuality.duplicateFramesRemoved}`,
      `- Overlapping frames downsampled: ${dataQuality.overlappingFramesDownsampled}`,
      `- Warnings: ${dataQuality.warningCount}`,
      `- Errors: ${dataQuality.errorCount}`,
    ].join("\n") : "- No data quality summary.",
    "",
    "## Summary Verdict",
    "",
    top
      ? `${top.algoName}: ${top.promotionVerdict ?? "unknown"} with robust score ${formatNumber(top.robustScore)}. ${trustExplanation(top)}`
      : "No strategies produced usable closed trades.",
    "",
    "## Promotion Candidates",
    "",
    candidates.length
      ? "| Algo | Family | Verdict | Closed Markets | P/L | Conservative P/L | Fold + | PSR | DSR | PBO | Robust | Reasons |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n"
        + candidates.slice(0, 50).map((metric) => `| ${metric.algoName} | ${metric.family} | ${metric.promotionVerdict} | ${metric.independentClosedMarkets} | ${money(metric.totalPnl)} | ${money(metric.costModels?.conservative?.totalPnl ?? 0)} | ${percent(metric.foldSummary?.positiveFoldRate ?? 0)} | ${percent(metric.psr ?? 0)} | ${percent(metric.dsr ?? 0)} | ${percent(metric.pbo ?? 0)} | ${formatNumber(metric.robustScore)} | ${(metric.reasonCodes ?? []).join(" ")} |`).join("\n")
      : "No candidates passed robust promotion gates.",
    "",
    "## All Metrics",
    "",
    "| Algo | Family | Verdict | Closed | Markets | Days | P/L | ROI | Conservative P/L | Stress P/L | Max DD | Robust | Warnings |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...metrics.slice(0, 100).map((metric) => `| ${metric.algoName} | ${metric.family} | ${metric.promotionVerdict} | ${metric.closed} | ${metric.independentClosedMarkets} | ${metric.daysRepresented} | ${money(metric.totalPnl)} | ${percent(metric.roi)} | ${money(metric.costModels?.conservative?.totalPnl ?? 0)} | ${money(metric.costModels?.stress?.totalPnl ?? 0)} | ${money(metric.maxDrawdown)} | ${formatNumber(metric.robustScore)} | ${(metric.warnings ?? []).join(" ")} |`),
    "",
    "Review-only. These results replay local paper market frames and do not place real orders.",
  ].flat().join("\n");
}

function csvMetricValue(metric, key) {
  if (key === "conservativeTotalPnl") return metric.costModels?.conservative?.totalPnl ?? 0;
  if (key === "stressTotalPnl") return metric.costModels?.stress?.totalPnl ?? 0;
  if (key === "foldConsistency") return metric.foldSummary?.foldConsistency ?? 0;
  if (key === "reasonCodes") return (metric.reasonCodes ?? []).join(" ");
  return metric[key];
}

function trustExplanation(metric) {
  if (metric.promotionVerdict === "insufficient_data") return "It is not trustworthy yet because sample size is below the independent-market threshold.";
  if (metric.promotionVerdict === "reject") return `It is blocked by: ${(metric.reasonCodes ?? []).join(", ") || "robust validation gates"}.`;
  if (metric.promotionVerdict === "paper_only") return "It passed validation gates but still needs live paper evidence before any tiny-live eligibility.";
  return "It still requires manual approval and backend live safety gates.";
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function money(value) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "-";
}

function percent(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

function formatNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "-";
}

