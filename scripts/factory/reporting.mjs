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
    "walkForwardPass",
    "walkForwardTotalPnl",
    "walkForwardRoi",
    "cpcvPositivePathRate",
    "cpcvMedianOosPnl",
    "holdoutPass",
    "holdoutConservativeTotalPnl",
    "holdoutLowerCi",
    "bootstrapMeanLower",
    "bootstrapMeanMedian",
    "bootstrapMeanUpper",
    "driftOk",
    "driftScore",
    "driftReasons",
    "paperEvidenceStatus",
    "paperEvidenceClosedMarkets",
    "paperEvidencePnl",
    "psr",
    "dsrApprox",
    "pboApprox",
    "familyAdjustedPValue",
    "globalAdjustedPValue",
    "falseDiscoveryRisk",
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
      ? "| Algo | Family | Verdict | Closed Markets | Conservative P/L | WF | CPCV + | Holdout | Drift | DSR Approx | PBO Approx | FDR | Robust | Reasons |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n"
        + candidates.slice(0, 50).map((metric) => `| ${metric.algoName} | ${metric.family} | ${metric.promotionVerdict} | ${metric.independentClosedMarkets} | ${money(metric.costModels?.conservative?.totalPnl ?? 0)} | ${metric.walkForwardPass ? "pass" : "fail"} | ${percent(metric.cpcvSummary?.positiveFoldRate ?? 0)} | ${metric.holdoutPass ? "pass" : "fail"} ${money(metric.holdoutConservativeTotalPnl ?? 0)} | ${paperEvidenceLabel(metric)} | ${percent(metric.dsrApprox ?? 0)} | ${percent(metric.pboApprox ?? 0)} | ${percent(metric.falseDiscoveryRisk ?? 1)} | ${formatNumber(metric.robustScore)} | ${(metric.reasonCodes ?? []).join(" ")} |`).join("\n")
      : "No candidates passed robust promotion gates.",
    "",
    "## Rejection Reasons",
    "",
    rejectionReasonRows(metrics).length
      ? rejectionReasonRows(metrics).map((row) => `- ${row.reason}: ${row.count}`).join("\n")
      : "- No rejection reasons.",
    "",
    "## All Metrics",
    "",
    "| Algo | Family | Verdict | Closed | Markets | Days | P/L | ROI | Conservative P/L | Stress P/L | WF | CPCV + | Holdout | Holdout P/L | Holdout CI | Paper/Drift | DSR Approx | PBO Approx | FDR | Adj P | Max DD | Robust | Warnings |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...metrics.slice(0, 100).map((metric) => `| ${metric.algoName} | ${metric.family} | ${metric.promotionVerdict} | ${metric.closed} | ${metric.independentClosedMarkets} | ${metric.daysRepresented} | ${money(metric.totalPnl)} | ${percent(metric.roi)} | ${money(metric.costModels?.conservative?.totalPnl ?? 0)} | ${money(metric.costModels?.stress?.totalPnl ?? 0)} | ${metric.walkForwardPass ? "pass" : "fail"} | ${percent(metric.cpcvSummary?.positiveFoldRate ?? 0)} | ${metric.holdoutPass ? "pass" : "fail"} | ${money(metric.holdoutConservativeTotalPnl ?? 0)} | ${money(metric.holdoutLowerCi)} | ${paperEvidenceLabel(metric)} | ${percent(metric.dsrApprox ?? 0)} | ${percent(metric.pboApprox ?? 0)} | ${percent(metric.falseDiscoveryRisk ?? 1)} | ${percent(metric.globalAdjustedPValue ?? 1)} | ${money(metric.maxDrawdown)} | ${formatNumber(metric.robustScore)} | ${(metric.warnings ?? []).join(" ")} |`),
    "",
    "## Approximation Notes",
    "",
    "- `dsrApprox` is PSR minus a transparent multiple-testing/complexity penalty, not a canonical Deflated Sharpe Ratio.",
    "- `pboApprox` is the share of purged validation folds with non-positive OOS P/L/ROI, not a full CPCV logit-rank PBO implementation.",
    "- `familyAdjustedPValue` and `globalAdjustedPValue` use centered trade-P/L bootstrap null distributions inspired by Reality Check / SPA logic.",
    "",
    "Review-only. These results replay local paper market frames and do not place real orders.",
  ].flat().join("\n");
}

function csvMetricValue(metric, key) {
  if (key === "conservativeTotalPnl") return metric.costModels?.conservative?.totalPnl ?? 0;
  if (key === "stressTotalPnl") return metric.costModels?.stress?.totalPnl ?? 0;
  if (key === "foldConsistency") return metric.foldSummary?.foldConsistency ?? 0;
  if (key === "cpcvPositivePathRate") return metric.cpcvSummary?.positiveFoldRate ?? 0;
  if (key === "cpcvMedianOosPnl") return metric.cpcvSummary?.medianFoldPnl ?? 0;
  if (key === "bootstrapMeanLower") return metric.bootstrap?.meanPnl?.lower ?? "";
  if (key === "bootstrapMeanMedian") return metric.bootstrap?.meanPnl?.median ?? "";
  if (key === "bootstrapMeanUpper") return metric.bootstrap?.meanPnl?.upper ?? "";
  if (key === "driftOk") return metric.drift?.driftOk ?? true;
  if (key === "driftScore") return metric.drift?.driftScore ?? 0;
  if (key === "driftReasons") return metric.drift?.driftReasons?.join(" ") ?? "";
  if (key === "paperEvidenceStatus") return metric.paperEvidence?.status ?? "missing";
  if (key === "paperEvidenceClosedMarkets") return metric.paperEvidence?.closedMarkets ?? 0;
  if (key === "paperEvidencePnl") return metric.paperEvidence?.totalPnl ?? "";
  if (key === "reasonCodes") return (metric.reasonCodes ?? []).join(" ");
  return metric[key];
}

function trustExplanation(metric) {
  if (metric.promotionVerdict === "insufficient_data") return "It is not trustworthy yet because sample size is below the independent-market threshold.";
  if (metric.promotionVerdict === "reject") return `It is blocked by: ${(metric.reasonCodes ?? []).join(", ") || "robust validation gates"}.`;
  if (metric.promotionVerdict === "paper_only") return "It passed validation gates but still needs live paper evidence before any tiny-live eligibility.";
  return "It still requires manual approval and backend live safety gates.";
}

function paperEvidenceLabel(metric) {
  const evidence = metric.paperEvidence ?? {};
  if (!evidence.available) return "missing";
  return `${evidence.driftOk ? "ok" : "drift"} ${evidence.closedMarkets ?? 0}m ${money(evidence.totalPnl)}`;
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

function rejectionReasonRows(metrics) {
  const counts = {};
  for (const metric of metrics) {
    for (const reason of metric.reasonCodes ?? []) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}
