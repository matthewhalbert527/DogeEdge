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
    "labelSource",
    "settlementSource",
    "officialResolutionAvailable",
    "officialSettlementCoverage",
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
    "avgSlippageCents",
    "avgPartialFillRatio",
    "avgFillProbability",
    "avgFillDepthUtilization",
    "brierScore",
    "logLoss",
    "expectedCalibrationError",
    "probabilityCalibrationReady",
    "probabilityLabelKnownCount",
    "staleQuoteRejections",
    "queueMisses",
    "depthRejections",
    "psr",
    "dsrApprox",
    "pboApprox",
    "realityCheckApproxPValue",
    "spaApproxPValue",
    "familyAdjustedPValue",
    "globalAdjustedPValue",
    "familyQValue",
    "globalQValue",
    "falseDiscoveryRisk",
    "effectiveFamilyTrials",
    "effectiveTotalTrials",
    "pboPathCount",
    "pboDegradedPathRate",
    "conservativeCostPass",
    "stressCostPass",
    "sampleSufficiencyOk",
    "sampleReasonCodes",
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

export function markdownReport({ runId, startedAt, finishedAt, dataRoot, framesDir, frameCount, eventCount, algoCount, sweepMode, dataQuality, metrics, candidates, searchBudget = null }) {
  const viableCandidates = candidates.filter(promotionCandidateIsViable);
  const top = viableCandidates[0] ?? null;
  const exploratoryTop = candidates[0] ?? metrics[0] ?? null;
  const noViableSummary = exploratoryTop
    ? `No viable candidate. The top exploratory row is ${exploratoryTop.algoName}, but it is ${exploratoryTop.promotionVerdict ?? "not validated"} and cannot be treated as a trusted ranked winner. ${trustExplanation(exploratoryTop)}`
    : "No viable candidate. No strategies produced usable closed trades.";
  return [
    "# DogeEdge Algo Factory Report",
    "",
    "## Executive Summary",
    "",
    top
      ? `${top.algoName}: ${top.promotionVerdict ?? "unknown"} with robust score ${formatNumber(top.robustScore)}. ${trustExplanation(top)}`
      : noViableSummary,
    "",
    `- Run: ${runId}`,
    `- Mode: ${sweepMode ? "sweep" : "backtest"}`,
    `- Started: ${startedAt}`,
    `- Finished: ${finishedAt}`,
    `- Data root: ${dataRoot}`,
    `- Frames: ${frameCount}`,
    `- Market events: ${eventCount}`,
    `- Algos: ${algoCount}`,
    searchBudget ? `- Search budget: ${searchBudget.limited ? `limited (${(searchBudget.reasonCodes ?? []).join(", ")}) ${searchBudget.maxGeneratedAlgos}/${searchBudget.requestedSweepAlgos} sweep algos` : "unlimited"}` : "",
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
      `- Settlement source: ${dataQuality.settlementEvidence?.settlementSource ?? "unknown"}`,
      `- Official settlement coverage: ${percent(dataQuality.settlementEvidence?.officialSettlementCoverage ?? 0)}`,
    ].join("\n") : "- No data quality summary.",
    "",
    "## Summary Verdict",
    "",
    top
      ? `${top.algoName}: ${top.promotionVerdict ?? "unknown"} with robust score ${formatNumber(top.robustScore)}. ${trustExplanation(top)}`
      : noViableSummary,
    "",
    "## Promotion Candidates",
    "",
    viableCandidates.length
      ? "| Algo | Family | Verdict | Closed Markets | Conservative P/L | WF | CPCV + | Holdout | Drift | DSR Approx | PBO Approx | FDR | q | Robust | Reasons |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n"
        + viableCandidates.slice(0, 50).map((metric) => `| ${metric.algoName} | ${metric.family} | ${metric.promotionVerdict} | ${metric.independentClosedMarkets} | ${money(metric.costModels?.conservative?.totalPnl ?? 0)} | ${metric.walkForwardPass ? "pass" : "fail"} | ${percent(metric.cpcvSummary?.positiveFoldRate ?? 0)} | ${metric.holdoutPass ? "pass" : "fail"} ${money(metric.holdoutConservativeTotalPnl ?? 0)} | ${paperEvidenceLabel(metric)} | ${percent(metric.dsrApprox ?? 0)} | ${percent(metric.pboApprox ?? 0)} | ${percent(metric.falseDiscoveryRisk ?? 1)} | ${percent(metric.globalQValue ?? 1)} | ${formatNumber(metric.robustScore)} | ${(metric.reasonCodes ?? []).join(" ")} |`).join("\n")
      : "No viable candidate passed official-settlement, exact validation, holdout, CPCV, conservative-cost, stress-cost, and adjusted-confidence gates.",
    "",
    "## Exploratory Rows",
    "",
    exploratoryTop
      ? "Raw exploratory rows remain available below for diagnosis only; they are not trusted ranked winners."
      : "No exploratory rows were emitted.",
    "",
    "## Settlement Evidence Gate",
    "",
    "| Algo | Label Source | Settlement Source | Official Coverage | Verdict | Reasons |",
    "|---|---:|---:|---:|---:|---|",
    ...metrics.slice(0, 50).map((metric) => `| ${metric.algoName} | ${metric.labelSource ?? metric.settlementEvidence?.labelSource ?? "unknown"} | ${metric.settlementSource ?? metric.settlementEvidence?.settlementSource ?? "unknown"} | ${percent(metric.officialSettlementCoverage ?? 0)} | ${metric.promotionVerdict ?? "unknown"} | ${(metric.reasonCodes ?? []).join(" ")} |`),
    "",
    "## Rejection Reasons",
    "",
    rejectionReasonRows(metrics).length
      ? rejectionReasonRows(metrics).map((row) => `- ${row.reason}: ${row.count}`).join("\n")
      : "- No rejection reasons.",
    "",
    "## All Metrics",
    "",
    "| Algo | Family | Verdict | Closed | Markets | Days | P/L | ROI | Conservative | Stress | WF | CPCV + | Holdout | Paper/Drift | DSR Approx | PBO Approx | q | Eff Trials | Robust | Warnings |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...metrics.slice(0, 100).map((metric) => `| ${metric.algoName} | ${metric.family} | ${metric.promotionVerdict} | ${metric.closed} | ${metric.independentClosedMarkets} | ${metric.daysRepresented} | ${money(metric.totalPnl)} | ${percent(metric.roi)} | ${passLabel(metric.costModels?.conservative?.totalPnl > 0)} ${money(metric.costModels?.conservative?.totalPnl ?? 0)} | ${passLabel(metric.costModels?.stress?.totalPnl > 0)} ${money(metric.costModels?.stress?.totalPnl ?? 0)} | ${metric.walkForwardPass ? "pass" : "fail"} | ${percent(metric.cpcvSummary?.positiveFoldRate ?? 0)} | ${metric.holdoutPass ? "pass" : "fail"} ${money(metric.holdoutConservativeTotalPnl ?? 0)} | ${paperEvidenceLabel(metric)} | ${percent(metric.dsrApprox ?? 0)} | ${percent(metric.pboApprox ?? 0)} | ${percent(metric.globalQValue ?? 1)} | ${formatNumber(metric.effectiveTotalTrials)} | ${formatNumber(metric.robustScore)} | ${(metric.warnings ?? []).join(" ")} |`),
    "",
    "## CPCV Path Degradation",
    "",
    "| Algo | Paths | Eligible | Degraded | Rate | Median Delta | Method |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...metrics.slice(0, 50).map((metric) => {
      const summary = metric.pboPathSummary ?? {};
      return `| ${metric.algoName} | ${summary.pathCount ?? 0} | ${summary.eligiblePathCount ?? 0} | ${summary.degradedPathCount ?? 0} | ${percent(summary.degradationRate ?? metric.pboApprox ?? 1)} | ${formatNumber(summary.medianPercentileDelta)} | ${summary.method ?? "fallback"} |`;
    }),
    "",
    "## Simulator Telemetry",
    "",
    "| Algo | Fill Rate | Avg Slippage | Partial Fill | Fill Prob | Queue Miss | Stale | Depth Reject |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...metrics.slice(0, 50).map((metric) => {
      const telemetry = metric.executionTelemetry?.conservative ?? metric.executionTelemetry?.base ?? {};
      return `| ${metric.algoName} | ${percent(telemetry.fillRate ?? 1)} | ${formatNumber(telemetry.averageSlippageCents ?? 0)}c | ${percent(telemetry.averagePartialFillRatio ?? 0)} | ${percent(telemetry.averageFillProbability ?? 0)} | ${telemetry.queueMisses ?? 0} | ${telemetry.staleQuoteRejections ?? 0} | ${telemetry.depthRejections ?? 0} |`;
    }),
    "",
    "## Promotion Timeline",
    "",
    "```mermaid",
    "timeline",
    "  title DogeEdge Promotion Stages",
    "  Research candidate : Backtest output only : deterministic config and ID",
    "  Validation candidate : purged/CPCV/walk-forward/holdout evidence : conservative costs pass",
    "  Paper candidate : live paper shadow evidence : drift checks pass",
    "  Tiny-live eligible : manual approval only : backend gates still required",
    "  Retired or demoted : drawdown, drift, stale data, or regime mismatch",
    "```",
    "",
    "## Approximation Notes",
    "",
    "- `psr` uses the Bailey/Lopez de Prado-style Probabilistic Sharpe Ratio denominator with observed sample length, skew, and kurtosis.",
    "- `dsrApprox` deflates PSR using an expected maximum Sharpe threshold from the tested strategy count; it is not a full canonical DSR implementation.",
    "- `pboApprox` uses CPCV train-vs-validation rank degradation when CPCV train metrics are available, with fold-failure fallback.",
    "- `familyAdjustedPValue` and `globalAdjustedPValue` use market-block strategy-menu bootstrap distributions inspired by White Reality Check and Hansen SPA.",
    "- `familyQValue` uses Benjamini-Hochberg within family; `globalQValue` uses the more conservative Benjamini-Yekutieli adjustment globally.",
    "- `effectiveFamilyTrials` and `effectiveTotalTrials` estimate correlated strategy-menu size from market-level P/L vectors.",
    "- `brierScore`, `logLoss`, and `expectedCalibrationError` summarize binary forecast calibration on label-known closed trades; they are diagnostics, not promotion substitutes.",
    "",
    "Review-only. These results replay local paper market frames and do not place real orders.",
  ].flat().join("\n");
}

function csvMetricValue(metric, key) {
  if (key === "conservativeTotalPnl") return metric.costModels?.conservative?.totalPnl ?? 0;
  if (key === "stressTotalPnl") return metric.costModels?.stress?.totalPnl ?? 0;
  if (key === "labelSource") return metric.labelSource ?? metric.settlementEvidence?.labelSource ?? "unknown";
  if (key === "settlementSource") return metric.settlementSource ?? metric.settlementEvidence?.settlementSource ?? "unknown";
  if (key === "officialResolutionAvailable") return metric.officialResolutionAvailable === true || metric.settlementEvidence?.officialResolutionAvailable === true;
  if (key === "officialSettlementCoverage") return metric.officialSettlementCoverage ?? metric.settlementEvidence?.officialSettlementCoverage ?? 0;
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
  if (key === "avgSlippageCents") return metric.executionTelemetry?.conservative?.averageSlippageCents ?? metric.averageSlippageCents ?? 0;
  if (key === "avgPartialFillRatio") return metric.executionTelemetry?.conservative?.averagePartialFillRatio ?? metric.averagePartialFillRatio ?? 0;
  if (key === "avgFillProbability") return metric.executionTelemetry?.conservative?.averageFillProbability ?? metric.averageFillProbability ?? 0;
  if (key === "avgFillDepthUtilization") return metric.executionTelemetry?.conservative?.averageFillDepthUtilization ?? metric.averageFillDepthUtilization ?? 0;
  if (key === "brierScore") return metric.brierScore ?? metric.binaryForecastQuality?.brierScore ?? "";
  if (key === "logLoss") return metric.logLoss ?? metric.binaryForecastQuality?.logLoss ?? "";
  if (key === "expectedCalibrationError") return metric.expectedCalibrationError ?? metric.binaryForecastQuality?.expectedCalibrationError ?? "";
  if (key === "probabilityCalibrationReady") return metric.probabilityCalibrationReady ?? metric.binaryForecastQuality?.calibrationReady ?? false;
  if (key === "probabilityLabelKnownCount") return metric.probabilityLabelKnownCount ?? metric.binaryForecastQuality?.labelKnownCount ?? 0;
  if (key === "staleQuoteRejections") return metric.executionTelemetry?.conservative?.staleQuoteRejections ?? 0;
  if (key === "queueMisses") return metric.executionTelemetry?.conservative?.queueMisses ?? 0;
  if (key === "depthRejections") return metric.executionTelemetry?.conservative?.depthRejections ?? 0;
  if (key === "familyQValue") return metric.familyQValue ?? 1;
  if (key === "globalQValue") return metric.globalQValue ?? 1;
  if (key === "effectiveFamilyTrials") return metric.effectiveFamilyTrials ?? "";
  if (key === "effectiveTotalTrials") return metric.effectiveTotalTrials ?? "";
  if (key === "pboPathCount") return metric.pboPathSummary?.pathCount ?? 0;
  if (key === "pboDegradedPathRate") return metric.pboPathSummary?.degradationRate ?? metric.pboApprox ?? 1;
  if (key === "conservativeCostPass") return (metric.costModels?.conservative?.totalPnl ?? 0) > 0;
  if (key === "stressCostPass") return (metric.costModels?.stress?.totalPnl ?? 0) > 0;
  if (key === "sampleSufficiencyOk") return metric.sampleSufficiency?.ok ?? true;
  if (key === "sampleReasonCodes") return (metric.sampleSufficiency?.reasonCodes ?? []).join(" ");
  if (key === "reasonCodes") return (metric.reasonCodes ?? []).join(" ");
  return metric[key];
}

function promotionCandidateIsViable(metric) {
  if (!metric || metric.nonPromotable) return false;
  if (metric.promotionVerdict !== "paper_only" && metric.promotionVerdict !== "tiny_live_eligible") return false;
  if ((metric.labelSource ?? metric.settlementEvidence?.labelSource) !== "official_resolution") return false;
  if ((metric.settlementSource ?? metric.settlementEvidence?.settlementSource) !== "official_resolution") return false;
  if ((metric.officialSettlementCoverage ?? metric.settlementEvidence?.officialSettlementCoverage ?? 0) < 0.95) return false;
  if (metric.holdoutPass !== true || metric.holdoutStrictlyLater === false) return false;
  if (metric.walkForwardPass !== true) return false;
  if ((metric.cpcvSummary?.positiveFoldRate ?? 0) < 0.7) return false;
  if ((metric.costModels?.conservative?.totalPnl ?? metric.conservativeTotalPnl ?? 0) <= 0) return false;
  if ((metric.costModels?.stress?.totalPnl ?? metric.stressTotalPnl ?? 0) <= 0) return false;
  if ((metric.adjustedConfidence ?? 0) <= 0) return false;
  return true;
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

function passLabel(value) {
  return value ? "pass" : "fail";
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
