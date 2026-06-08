import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chronologicalSplit, cpcvApproximationFolds, purgedEmbargoFolds } from "./splits.mjs";
import { finalHoldoutSplit } from "./holdout.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function auditReviewExports({ input = "review_exports", outDir = "artifacts/factory-audit", foldCount = 5, embargoMs = 15 * 60_000, debugOnly = false } = {}) {
  const inputRoot = path.resolve(repoRoot, input);
  const outputRoot = path.resolve(repoRoot, outDir);
  await mkdir(outputRoot, { recursive: true });
  await mkdir(path.join(inputRoot, "normalized"), { recursive: true }).catch(() => {});

  const roles = await discoverRoles(inputRoot);
  await writeJson(path.join(inputRoot, "normalized", "manifest.json"), roles);

  const repoSnapshot = roles.repoSnapshot ? parseRepoSnapshot(await readText(roles.repoSnapshot)) : {};
  const fullRun = roles.factoryFullRun ? await readJson(roles.factoryFullRun) : null;
  const registry = roles.experimentRegistry ? await readJson(roles.experimentRegistry) : null;
  const latestSweep = roles.latestSweep ? await readJson(roles.latestSweep) : null;
  const simulatorConfig = roles.simulatorConfig ? await readJson(roles.simulatorConfig) : null;
  const frameRows = roles.decisionFramesSample ? await readNdjson(roles.decisionFramesSample) : [];
  const events = eventsFromDecisionFrameSample(frameRows);
  const recomputed = recomputeFolds(events, { foldCount, embargoMs });
  const foldDiff = diffFolds({ fullRun, registry, recomputed, debugOnly });
  const schema = validateSchemas({ roles, repoSnapshot, fullRun, registry, latestSweep, simulatorConfig, frameRows });
  const metrics = fullRun?.metrics ?? latestSweep?.topMetrics ?? [];
  const metricsCompare = metricsComparison(metrics);
  const promotionSummary = promotionVerdictSummary(metrics);
  const reproducibility = reproducibilityWarnings({ repoSnapshot, fullRun, registry, roles });
  const audit = {
    generatedAtUtc: new Date().toISOString(),
    inputRoot,
    roles,
    schema,
    reproducibility,
    foldDiff,
    metricsSummary: metricsCompare.summary,
    promotionSummary,
    verdict: auditVerdict({ schema, foldDiff, reproducibility }),
  };

  const finalReview = {
    executiveSummary: executiveSummary(audit),
    audit,
    metricsCompare: metricsCompare.rows,
    promotionTimeline: promotionTimelineMermaid(),
  };

  await writeJson(path.join(outputRoot, "audit-report.json"), audit);
  await writeFile(path.join(outputRoot, "audit-report.md"), auditMarkdown(audit));
  await writeJson(path.join(outputRoot, "fold-diff.json"), foldDiff);
  await writeFile(path.join(outputRoot, "fold-diff.md"), foldDiffMarkdown(foldDiff));
  await writeFile(path.join(outputRoot, "metrics-compare.csv"), csv(metricsCompare.rows));
  await writeFile(path.join(outputRoot, "promotion-stages.mmd"), promotionTimelineMermaid());
  await writeJson(path.join(outputRoot, "final-review.json"), finalReview);
  await writeFile(path.join(outputRoot, "final-review.md"), finalReviewMarkdown(finalReview));
  return audit;
}

async function discoverRoles(root) {
  const fileSet = new Set((await listFiles(root)).map((file) => path.normalize(file)));
  const rolePath = (relative) => {
    const full = path.normalize(path.join(root, relative));
    return fileSet.has(full) ? full : null;
  };
  const splitManifests = [...fileSet].filter((file) => file.endsWith(".split-manifest.json"));
  return {
    inputRoot: root,
    repoSnapshot: rolePath("repo-snapshot.txt"),
    factoryFullRun: rolePath("factory/factory-full-run.json"),
    perTradeCsv: rolePath("trades/per-trade.csv"),
    perTradeManifest: rolePath("trades/per-trade-manifest.json"),
    decisionFramesSample: rolePath("frames/decision-frames.sample.ndjson"),
    decisionFrameManifest: rolePath("frames/decision-frame-manifest.json"),
    simulatorConfig: rolePath("simulator/simulator-config.json"),
    experimentRegistry: rolePath("registry/experiment-registry.json"),
    latestJson: rolePath("ui/latest.json"),
    latestSweep: rolePath("ui/latest-sweep.json"),
    candidatesJson: rolePath("ui/candidates.json"),
    metricsJson: rolePath("ui/metrics.json"),
    reportMd: rolePath("ui/report.md"),
    rawSampleManifest: rolePath("raw/one-week-sample/sample-manifest.json"),
    snapshotHistoryJson: rolePath("snapshots/snapshot-history-48h.json"),
    snapshotHistoryMd: rolePath("snapshots/snapshot-history-48h.md"),
    factoryPageScreenshot: rolePath("screens/factory-page.png"),
    screenshotReadme: rolePath("screens/README.txt"),
    splitManifests,
    splitFiles: await splitFileSummary(splitManifests),
  };
}

function validateSchemas({ roles, repoSnapshot, fullRun, registry, latestSweep, simulatorConfig, frameRows }) {
  const warnings = [];
  const errors = [];
  const criticalRoles = ["repoSnapshot", "factoryFullRun", "perTradeCsv", "decisionFramesSample", "simulatorConfig", "experimentRegistry", "latestSweep", "reportMd"];
  for (const role of criticalRoles) {
    if (!roles[role]) errors.push(`missing_role:${role}`);
  }
  if (!roles.latestJson && !roles.splitFiles.some((item) => item.originalFile === "latest.json")) warnings.push("latest_json_is_split_or_missing");
  if (!roles.metricsJson && !roles.splitFiles.some((item) => item.originalFile === "metrics.json")) warnings.push("metrics_json_is_split_or_missing");
  if (!roles.factoryPageScreenshot) warnings.push("missing_factory_page_png");
  if (!repoSnapshot.git_rev_parse_head) warnings.push("repo_snapshot_missing_git_head");
  if (!fullRun?.gitCommit && !fullRun?.codeVersion) errors.push("full_run_missing_git_commit");
  if (!fullRun?.randomSeed) errors.push("full_run_missing_random_seed");
  if (!fullRun?.configHash) errors.push("full_run_missing_config_hash");
  if (!fullRun?.dataHash) errors.push("full_run_missing_data_hash");
  if (!Array.isArray(fullRun?.purgedFolds) || !fullRun.purgedFolds.length) errors.push("full_run_missing_purged_folds");
  if (!Array.isArray(fullRun?.cpcvFolds) || !fullRun.cpcvFolds.length) errors.push("full_run_missing_cpcv_folds");
  if (!fullRun?.holdoutDefinition) errors.push("full_run_missing_holdout_definition");
  if (!registry?.inputManifestHash) errors.push("registry_missing_input_manifest_hash");
  if (!Array.isArray(registry?.inputFiles) || !registry.inputFiles.length) errors.push("registry_missing_input_file_hashes");
  if (!registry?.randomSeed) errors.push("registry_missing_random_seed");
  if (!Array.isArray(registry?.foldDefinitions) || !registry.foldDefinitions.length) errors.push("registry_missing_fold_definitions");
  if (!Array.isArray(registry?.cpcvFoldDefinitions) || !registry.cpcvFoldDefinitions.length) errors.push("registry_missing_cpcv_fold_definitions");
  if (!registry?.holdoutDefinition) errors.push("registry_missing_holdout_definition");
  if (!Array.isArray(simulatorConfig?.costModels) || simulatorConfig.costModels.length < 2) warnings.push("simulator_config_missing_multiple_cost_models");
  if (!Array.isArray(fullRun?.metrics) || !fullRun.metrics.length) errors.push("full_run_missing_metrics");
  for (const field of ["promotionVerdict", "reasonCodes", "robustScore", "adjustedConfidence", "holdoutPass", "cpcvSummary", "foldMetrics"]) {
    if (fullRun?.metrics?.length && !Object.prototype.hasOwnProperty.call(fullRun.metrics[0], field)) errors.push(`metric_missing_field:${field}`);
  }
  if (!frameRows.length) errors.push("decision_frame_sample_empty");
  if (latestSweep && !Array.isArray(latestSweep.topMetrics)) warnings.push("latest_sweep_missing_top_metrics");
  return { warnings, errors, warningCount: warnings.length, errorCount: errors.length };
}

function recomputeFolds(events, options) {
  const holdout = finalHoldoutSplit(events, { holdoutRatio: 0.2, minHoldoutEvents: 1 });
  const researchEvents = holdout.researchEvents;
  const split = chronologicalSplit(researchEvents, { validationRatio: 0.2, testRatio: 0.3 });
  const purgedFolds = purgedEmbargoFolds(researchEvents, options);
  const cpcvFolds = cpcvApproximationFolds(researchEvents, { ...options, maxCombinations: 10 });
  return {
    eventCount: events.length,
    eventIds: events.map((event) => event.id),
    split: {
      trainEventIds: split.train.map((event) => event.id),
      validationEventIds: split.validation.map((event) => event.id),
      testEventIds: split.test.map((event) => event.id),
      holdoutEventIds: holdout.holdoutEventIds,
    },
    purgedFolds: foldPublic(purgedFolds),
    cpcvFolds: foldPublic(cpcvFolds),
    holdoutDefinition: {
      immutable: holdout.immutable,
      strictlyLater: holdout.strictlyLater,
      reason: holdout.reason,
      latestResearchEnd: holdout.latestResearchEnd,
      earliestHoldoutStart: holdout.earliestHoldoutStart,
      holdoutEventIds: holdout.holdoutEventIds,
    },
    events,
  };
}

function diffFolds({ fullRun, registry, recomputed, debugOnly }) {
  const exportedPurged = fullRun?.purgedFolds ?? registry?.foldDefinitions ?? [];
  const exportedCpcv = fullRun?.cpcvFolds ?? registry?.cpcvFoldDefinitions ?? [];
  const exportedHoldout = fullRun?.holdoutDefinition ?? registry?.holdoutDefinition ?? null;
  const leakage = [
    ...foldLeakageProblems(exportedPurged, recomputed.events, "purged"),
    ...foldLeakageProblems(exportedCpcv, recomputed.events, "cpcv"),
  ];
  const tables = {
    splitCounts: {
      exportedTrain: fullRun?.split?.trainEventIds?.length ?? null,
      recomputedTrain: recomputed.split.trainEventIds.length,
      exportedValidation: fullRun?.split?.validationEventIds?.length ?? null,
      recomputedValidation: recomputed.split.validationEventIds.length,
      exportedTest: fullRun?.split?.testEventIds?.length ?? null,
      recomputedTest: recomputed.split.testEventIds.length,
      exportedHoldout: fullRun?.split?.holdoutEventIds?.length ?? exportedHoldout?.holdoutEventIds?.length ?? null,
      recomputedHoldout: recomputed.split.holdoutEventIds.length,
    },
    foldCounts: {
      exportedPurged: exportedPurged.length,
      recomputedPurged: recomputed.purgedFolds.length,
      exportedCpcv: exportedCpcv.length,
      recomputedCpcv: recomputed.cpcvFolds.length,
    },
  };
  const warnings = [];
  if (tables.foldCounts.exportedPurged !== tables.foldCounts.recomputedPurged) warnings.push("purged_fold_count_changed");
  if (tables.foldCounts.exportedCpcv !== tables.foldCounts.recomputedCpcv) warnings.push("cpcv_fold_count_changed");
  if (exportedHoldout?.strictlyLater === false || recomputed.holdoutDefinition.strictlyLater === false) warnings.push("holdout_not_strictly_later");
  const errors = leakage.length && !debugOnly ? ["fold_overlap_or_embargo_leakage"] : [];
  return {
    generatedAtUtc: new Date().toISOString(),
    tables,
    leakage,
    exportedHoldout,
    recomputedHoldout: recomputed.holdoutDefinition,
    exportedPurged: exportedPurged.map(foldCountSummary),
    recomputedPurged: recomputed.purgedFolds.map(foldCountSummary),
    exportedCpcv: exportedCpcv.map(foldCountSummary),
    recomputedCpcv: recomputed.cpcvFolds.map(foldCountSummary),
    warnings,
    errors,
    failClosed: errors.length > 0,
  };
}

function metricsComparison(metrics) {
  const rows = metrics.slice(0, 200).map((metric, index) => ({
    rank: index + 1,
    algoId: metric.algoId,
    family: metric.family,
    promotionVerdict: metric.promotionVerdict,
    robustScore: metric.robustScore,
    adjustedConfidence: metric.adjustedConfidence,
    psr: metric.psr,
    dsrApprox: metric.dsrApprox,
    pboApprox: metric.pboApprox,
    familyAdjustedPValue: metric.familyAdjustedPValue,
    globalAdjustedPValue: metric.globalAdjustedPValue,
    falseDiscoveryRisk: metric.falseDiscoveryRisk,
    holdoutPass: metric.holdoutPass,
    cpcvPositiveFoldRate: metric.cpcvSummary?.positiveFoldRate ?? null,
    avgSlippageCents: metric.executionTelemetry?.conservative?.averageSlippageCents ?? metric.averageSlippageCents ?? null,
    telemetryPresent: Boolean(metric.executionTelemetry || metric.averageSlippageCents !== undefined),
    hasApproxSuffixes: Object.prototype.hasOwnProperty.call(metric, "dsrApprox") && Object.prototype.hasOwnProperty.call(metric, "pboApprox") && !Object.prototype.hasOwnProperty.call(metric, "dsr") && !Object.prototype.hasOwnProperty.call(metric, "pbo"),
  }));
  return {
    rows,
    summary: {
      metricCount: metrics.length,
      nonPromotableCount: metrics.filter((metric) => metric.nonPromotable).length,
      holdoutPassCount: metrics.filter((metric) => metric.holdoutPass).length,
      telemetryPresentCount: rows.filter((row) => row.telemetryPresent).length,
      approximateNamingOk: rows.every((row) => row.hasApproxSuffixes),
    },
  };
}

function reproducibilityWarnings({ repoSnapshot, fullRun, registry, roles }) {
  const warnings = [];
  if (repoSnapshot.git_rev_parse_head && fullRun?.gitCommit && repoSnapshot.git_rev_parse_head !== fullRun.gitCommit) warnings.push("repo_snapshot_commit_differs_from_full_run");
  if (registry?.gitCommit && fullRun?.gitCommit && registry.gitCommit !== fullRun.gitCommit) warnings.push("registry_commit_differs_from_full_run");
  if (!registry?.inputManifestHash || !registry?.dataHash) warnings.push("missing_exact_data_hashes");
  if (!registry?.inputFiles?.every((file) => file.sha256 && file.byteSize)) warnings.push("input_file_hash_details_incomplete");
  if (!fullRun?.randomSeed || !registry?.randomSeed) warnings.push("seed_not_recorded_everywhere");
  if (roles.splitFiles.some((file) => file.partCount === 0)) warnings.push("split_file_manifest_without_parts");
  return {
    warnings,
    partial: warnings.length > 0,
    repoSnapshotCommit: repoSnapshot.git_rev_parse_head ?? null,
    fullRunCommit: fullRun?.gitCommit ?? null,
    registryCommit: registry?.gitCommit ?? null,
    inputManifestHash: registry?.inputManifestHash ?? fullRun?.dataHash ?? null,
  };
}

function auditVerdict({ schema, foldDiff, reproducibility }) {
  if (schema.errors.length || foldDiff.errors.length) return "fail_closed";
  if (schema.warnings.length || foldDiff.warnings.length || reproducibility.warnings.length) return "usable_with_warnings";
  return "clean";
}

function executiveSummary(audit) {
  const parts = [`Export audit verdict: ${audit.verdict}.`];
  parts.push(`${audit.schema.errorCount} schema errors and ${audit.schema.warningCount} schema warnings.`);
  parts.push(`Recomputed ${audit.foldDiff.tables.foldCounts.recomputedPurged} purged folds and ${audit.foldDiff.tables.foldCounts.recomputedCpcv} CPCV folds from the frame sample.`);
  if (audit.reproducibility.warnings.length) parts.push(`Reproducibility warnings: ${audit.reproducibility.warnings.join(", ")}.`);
  return parts.join(" ");
}

function promotionVerdictSummary(metrics) {
  const counts = {};
  for (const metric of metrics) {
    const key = metric.promotionVerdict ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function eventsFromDecisionFrameSample(rows) {
  const byMarket = new Map();
  for (const row of rows) {
    const id = row.market_id ?? row.marketTicker ?? row.market_id;
    const featureMs = Date.parse(row.frame_timestamp_utc ?? row.featureTimestamp ?? row.observedAt ?? "");
    const closeMs = Date.parse(row.market_close_timestamp_utc ?? row.marketCloseTimestamp ?? row.marketCloseTime ?? "");
    if (!id || !Number.isFinite(featureMs)) continue;
    const current = byMarket.get(id) ?? {
      id,
      marketTicker: id,
      labelWindowStartMs: featureMs,
      labelWindowEndMs: Number.isFinite(closeMs) ? closeMs : featureMs,
    };
    current.labelWindowStartMs = Math.min(current.labelWindowStartMs, featureMs);
    current.labelWindowEndMs = Math.max(current.labelWindowEndMs, Number.isFinite(closeMs) ? closeMs : featureMs);
    byMarket.set(id, current);
  }
  return [...byMarket.values()].sort((left, right) => left.labelWindowEndMs - right.labelWindowEndMs || left.id.localeCompare(right.id));
}

function foldLeakageProblems(folds, events, kind) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const problems = [];
  for (const fold of folds ?? []) {
    const validation = (fold.validationEventIds ?? []).map((id) => byId.get(id)).filter(Boolean);
    if (!validation.length) continue;
    const validationStart = Math.min(...validation.map((event) => event.labelWindowStartMs));
    const validationEnd = Math.max(...validation.map((event) => event.labelWindowEndMs));
    for (const id of fold.trainEventIds ?? []) {
      const event = byId.get(id);
      if (!event) continue;
      const overlaps = event.labelWindowStartMs <= validationEnd && event.labelWindowEndMs >= validationStart;
      const embargoed = event.labelWindowStartMs > validationEnd && event.labelWindowStartMs <= validationEnd + Number(fold.embargoMs ?? 0);
      if (overlaps || embargoed) {
        problems.push({ kind, foldId: fold.id, trainEventId: id, problem: overlaps ? "overlap" : "embargo" });
      }
    }
  }
  return problems;
}

function foldPublic(folds) {
  return folds.map((fold) => ({
    id: fold.id,
    trainEventIds: fold.trainEventIds,
    validationEventIds: fold.validationEventIds,
    purgedEventIds: fold.purgedEventIds,
    embargoedEventIds: fold.embargoedEventIds,
    embargoMs: fold.embargoMs,
  }));
}

function foldCountSummary(fold) {
  return {
    id: fold.id,
    train: fold.trainEventIds?.length ?? fold.trainEventCount ?? 0,
    validation: fold.validationEventIds?.length ?? fold.validationEventCount ?? 0,
    purged: fold.purgedEventIds?.length ?? fold.purgedEventCount ?? 0,
    embargoed: fold.embargoedEventIds?.length ?? fold.embargoedEventCount ?? 0,
    embargoMs: fold.embargoMs ?? null,
  };
}

function auditMarkdown(audit) {
  return [
    "# DogeEdge Factory Export Audit",
    "",
    "## Executive Summary",
    "",
    executiveSummary(audit),
    "",
    "## Schema Checks",
    "",
    audit.schema.errors.length ? audit.schema.errors.map((item) => `- ERROR ${item}`).join("\n") : "- No schema errors.",
    audit.schema.warnings.length ? audit.schema.warnings.map((item) => `- WARN ${item}`).join("\n") : "- No schema warnings.",
    "",
    "## Reproducibility",
    "",
    audit.reproducibility.warnings.length ? audit.reproducibility.warnings.map((item) => `- ${item}`).join("\n") : "- No reproducibility warnings.",
    "",
    "## Fold Diff",
    "",
    foldDiffMarkdown(audit.foldDiff),
  ].join("\n");
}

function foldDiffMarkdown(diff) {
  return [
    "# Fold Diff",
    "",
    "## Counts",
    "",
    "| Item | Exported | Recomputed |",
    "|---|---:|---:|",
    `| Train events | ${diff.tables.splitCounts.exportedTrain ?? "-"} | ${diff.tables.splitCounts.recomputedTrain} |`,
    `| Validation events | ${diff.tables.splitCounts.exportedValidation ?? "-"} | ${diff.tables.splitCounts.recomputedValidation} |`,
    `| Test events | ${diff.tables.splitCounts.exportedTest ?? "-"} | ${diff.tables.splitCounts.recomputedTest} |`,
    `| Holdout events | ${diff.tables.splitCounts.exportedHoldout ?? "-"} | ${diff.tables.splitCounts.recomputedHoldout} |`,
    `| Purged folds | ${diff.tables.foldCounts.exportedPurged} | ${diff.tables.foldCounts.recomputedPurged} |`,
    `| CPCV folds | ${diff.tables.foldCounts.exportedCpcv} | ${diff.tables.foldCounts.recomputedCpcv} |`,
    "",
    "## Leakage",
    "",
    diff.leakage.length ? diff.leakage.slice(0, 50).map((item) => `- ${item.kind} ${item.foldId}: ${item.trainEventId} ${item.problem}`).join("\n") : "- No overlap or embargo leakage detected from available frame sample.",
    "",
    "## Warnings",
    "",
    diff.warnings.length ? diff.warnings.map((item) => `- ${item}`).join("\n") : "- No fold warnings.",
  ].join("\n");
}

function finalReviewMarkdown(finalReview) {
  return [
    "# DogeEdge Factory Final Review",
    "",
    "## Executive Summary",
    "",
    finalReview.executiveSummary,
    "",
    "## Promotion Verdict Summary",
    "",
    Object.entries(finalReview.audit.promotionSummary).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- No metrics.",
    "",
    "## UI Compatibility",
    "",
    "- UI-compatible fields checked: promotionVerdict, reasonCodes, robustScore, adjustedConfidence, holdoutPass, cpcvSummary.",
    "- Split `latest.json` and `metrics.json` are accepted when split manifests are present.",
    "",
    "## Promotion Timeline",
    "",
    "```mermaid",
    finalReview.promotionTimeline.trim(),
    "```",
  ].join("\n");
}

function promotionTimelineMermaid() {
  return [
    "timeline",
    "  title DogeEdge Promotion Stages",
    "  Research candidate : deterministic backtest config : no live authority",
    "  Validation candidate : purged CV plus CPCV plus walk-forward plus holdout : conservative costs pass",
    "  Paper candidate : live paper evidence : drift and fill-quality checks",
    "  Tiny-live eligible : manual approval required : backend live gates remain",
    "  Retired or demoted : drift, drawdown, stale data, or regime mismatch",
    "",
  ].join("\n");
}

function csv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ].join("\n");
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function splitFileSummary(manifestPaths) {
  const rows = [];
  for (const manifestPath of manifestPaths) {
    const manifest = await readJson(manifestPath).catch(() => null);
    rows.push({
      manifestPath,
      originalFile: manifest?.originalFile ?? path.basename(manifestPath).replace(".split-manifest.json", ""),
      originalByteSize: manifest?.originalByteSize ?? null,
      partCount: manifest?.partCount ?? manifest?.parts?.length ?? 0,
      parts: manifest?.parts ?? [],
    });
  }
  return rows;
}

async function listFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    }));
    return nested.flat();
  } catch {
    return [];
  }
}

async function readJson(file) {
  return JSON.parse(await readText(file));
}

async function readText(file) {
  return readFile(file, "utf8");
}

async function readNdjson(file) {
  const text = await readText(file);
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseRepoSnapshot(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf("=");
    return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
  }));
}

const args = parseArgs(process.argv.slice(2));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const audit = await auditReviewExports({
    input: args.input ?? "review_exports",
    outDir: args.out ?? "artifacts/factory-audit",
    foldCount: Number(args.folds ?? 5),
    embargoMs: Number(args["embargo-ms"] ?? 15 * 60_000),
    debugOnly: Boolean(args["debug-only"]),
  });
  console.log(`DogeEdge export audit: ${audit.verdict}`);
  console.log(`Report: ${path.resolve(repoRoot, args.out ?? "artifacts/factory-audit", "final-review.md")}`);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}
