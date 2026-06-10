import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chronologicalSplit, cpcvApproximationFolds, purgedEmbargoFolds } from "./splits.mjs";
import { finalHoldoutSplit } from "./holdout.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function auditReviewExports({
  input = "review_exports",
  outDir = "artifacts/factory-audit",
  foldCount = 5,
  embargoMs = 15 * 60_000,
  debugOnly = false,
  strict = false,
  promotionReview = false,
  requireRawTicks = false,
  gateReport = false,
  reconcileTopRoster = false,
} = {}) {
  const inputRoot = path.resolve(repoRoot, input);
  const outputRoot = path.resolve(repoRoot, outDir);
  await mkdir(outputRoot, { recursive: true });
  await mkdir(path.join(inputRoot, "normalized"), { recursive: true }).catch(() => {});

  const roles = await discoverRoles(inputRoot);
  await writeJson(path.join(inputRoot, "normalized", "manifest.json"), roles);

  const repoSnapshot = roles.repoSnapshot ? parseRepoSnapshot(await readText(roles.repoSnapshot)) : {};
  const bundleManifest = roles.bundleManifest ? await readJson(roles.bundleManifest) : null;
  const fullRun = roles.factoryFullRun ? await readJson(roles.factoryFullRun) : null;
  const registry = roles.experimentRegistry ? await readJson(roles.experimentRegistry) : null;
  const latestSweep = roles.latestSweep ? await readJson(roles.latestSweep) : null;
  const rawTicksManifest = roles.rawTicksManifest ? await readJson(roles.rawTicksManifest) : null;
  const topTradersExecutable = roles.topTradersExecutable ? await readJson(roles.topTradersExecutable) : null;
  const leakageAudit = roles.leakageAudit ? await readJson(roles.leakageAudit) : null;
  const researchLiveAlignment = roles.researchLiveAlignment ? await readJson(roles.researchLiveAlignment) : null;
  const topRosterDefaultSortAudit = roles.topRosterDefaultSortAudit ? await readJson(roles.topRosterDefaultSortAudit) : null;
  const simulatorConfig = roles.simulatorConfig ? await readJson(roles.simulatorConfig) : null;
  const frameRows = roles.decisionFramesSample ? await readNdjson(roles.decisionFramesSample) : [];
  const events = eventsFromDecisionFrameSample(frameRows);
  const recomputed = recomputeFolds(events, { foldCount, embargoMs });
  const foldDiff = diffFolds({ fullRun, registry, recomputed, debugOnly });
  const bundleEvidence = bundleEvidenceSummary({ bundleManifest, rawTicksManifest });
  const schema = validateSchemas({ roles, repoSnapshot, bundleManifest, fullRun, registry, latestSweep, simulatorConfig, frameRows, rawTicksManifest, leakageAudit, researchLiveAlignment, topRosterDefaultSortAudit, strict, promotionReview, requireRawTicks });
  const metrics = fullRun?.metrics ?? latestSweep?.topMetrics ?? [];
  const metricsCompare = metricsComparison(metrics);
  const promotionSummary = promotionVerdictSummary(metrics);
  const gate = gateReport ? gateReportSummary(metrics) : null;
  const topRosterReconciliation = reconcileTopRoster ? await reconcileTopRosterSummary({ roles, topTradersExecutable }) : null;
  const reproducibility = reproducibilityWarnings({ repoSnapshot, fullRun, registry, roles });
  const audit = {
    generatedAtUtc: new Date().toISOString(),
    inputRoot,
    roles,
    schema,
    bundleEvidence,
    reproducibility,
    foldDiff,
    leakageAudit,
    researchLiveAlignment,
    topRosterDefaultSortAudit,
    metricsSummary: metricsCompare.summary,
    promotionSummary,
    gate,
    topRosterReconciliation,
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
    decisionFramesSample: rolePath("frames/decision-frames.sample.ndjson") ?? rolePath("snapshots/decision_frames.jsonl"),
    decisionFrameManifest: rolePath("frames/decision-frame-manifest.json"),
    simulatorConfig: rolePath("simulator/simulator-config.json"),
    experimentRegistry: rolePath("registry/experiment-registry.json"),
    latestJson: rolePath("ui/latest.json") ?? rolePath("repo/local-worker-latest.json"),
    latestSweep: rolePath("ui/latest-sweep.json") ?? rolePath("repo/latest-sweep.json"),
    bundleManifest: rolePath("manifest.json"),
    bundleLatestSweep: rolePath("repo/latest-sweep.json"),
    topTradersExecutable: rolePath("repo/top-traders-executable.json"),
    rawTicksManifest: rolePath("snapshots/raw_market_ticks/manifest.json"),
    leakageAudit: rolePath("snapshots/leakage_audit.json") ?? rolePath("leakage_audit.json"),
    researchLiveAlignment: rolePath("snapshots/research_live_alignment.json") ?? rolePath("research_live_alignment.json"),
    rosterAlignment: rolePath("snapshots/roster_alignment.tsv.gz"),
    researchCoverageByFamily: rolePath("snapshots/research_coverage_by_family.tsv.gz"),
    liveCoverageByFamily: rolePath("snapshots/live_coverage_by_family.tsv.gz"),
    unsupportedLiveFamilies: rolePath("snapshots/unsupported_live_families.tsv.gz"),
    promotionGateResults: rolePath("snapshots/promotion_gate_results.tsv.gz"),
    postCloseFrameAudit: rolePath("snapshots/post_close_frame_audit.tsv.gz"),
    familyAllocationReport: rolePath("snapshots/family_allocation_report.json"),
    topRosterDefaultSortAudit: rolePath("snapshots/top_roster_default_sort_audit.json"),
    snapshotDecisionFrames: rolePath("snapshots/decision_frames.jsonl"),
    snapshotTradesCsv: rolePath("snapshots/trades.csv"),
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

function validateSchemas({ roles, repoSnapshot, bundleManifest, fullRun, registry, latestSweep, simulatorConfig, frameRows, rawTicksManifest, leakageAudit, researchLiveAlignment, topRosterDefaultSortAudit, strict, promotionReview, requireRawTicks }) {
  const warnings = [];
  const errors = [];
  const bundleMode = Boolean(bundleManifest);
  const factorySource = fullRun ?? latestSweep ?? {};
  const registrySource = registry ?? factorySource.registry ?? {};
  const metricsSource = Array.isArray(fullRun?.metrics) && fullRun.metrics.length
    ? fullRun.metrics
    : Array.isArray(latestSweep?.topMetrics) ? latestSweep.topMetrics : [];
  const criticalRoles = bundleMode
    ? ["bundleManifest", "decisionFramesSample", "snapshotTradesCsv", "experimentRegistry", "latestSweep", "rawTicksManifest"]
    : ["repoSnapshot", "factoryFullRun", "perTradeCsv", "decisionFramesSample", "simulatorConfig", "experimentRegistry", "latestSweep", "reportMd"];
  for (const role of criticalRoles) {
    if (!roles[role]) errors.push(`missing_role:${role}`);
  }
  if (!roles.latestJson && !roles.splitFiles.some((item) => item.originalFile === "latest.json")) warnings.push("latest_json_is_split_or_missing");
  if (!roles.metricsJson && !roles.splitFiles.some((item) => item.originalFile === "metrics.json")) warnings.push("metrics_json_is_split_or_missing");
  if (!roles.factoryPageScreenshot) warnings.push("missing_factory_page_png");
  if (!repoSnapshot.git_rev_parse_head) warnings.push("repo_snapshot_missing_git_head");
  if (!factorySource?.gitCommit && !factorySource?.codeVersion && !registrySource?.gitCommit && !registrySource?.codeVersion) errors.push("factory_output_missing_git_commit");
  if (!factorySource?.randomSeed && !registrySource?.randomSeed) errors.push("factory_output_missing_random_seed");
  if (!factorySource?.configHash && !registrySource?.configHash) errors.push("factory_output_missing_config_hash");
  if (!factorySource?.dataHash && !registrySource?.dataHash && !registrySource?.inputManifestHash) errors.push("factory_output_missing_data_hash");
  if (!Array.isArray(factorySource?.purgedFolds) && !Array.isArray(registrySource?.foldDefinitions)) errors.push("factory_output_missing_purged_folds");
  if (!Array.isArray(factorySource?.cpcvFolds) && !Array.isArray(registrySource?.cpcvFoldDefinitions)) errors.push("factory_output_missing_cpcv_folds");
  if (!factorySource?.holdoutDefinition && !registrySource?.holdoutDefinition) errors.push("factory_output_missing_holdout_definition");
  if (!registrySource?.inputManifestHash) errors.push("registry_missing_input_manifest_hash");
  if (!bundleMode && (!Array.isArray(registrySource?.inputFiles) || !registrySource.inputFiles.length)) errors.push("registry_missing_input_file_hashes");
  if (!registrySource?.randomSeed) errors.push("registry_missing_random_seed");
  if (!Array.isArray(registrySource?.foldDefinitions) || !registrySource.foldDefinitions.length) errors.push("registry_missing_fold_definitions");
  if (!Array.isArray(registrySource?.cpcvFoldDefinitions) || !registrySource.cpcvFoldDefinitions.length) errors.push("registry_missing_cpcv_fold_definitions");
  if (!registrySource?.holdoutDefinition) errors.push("registry_missing_holdout_definition");
  if (!Array.isArray(simulatorConfig?.costModels) || simulatorConfig.costModels.length < 2) warnings.push("simulator_config_missing_multiple_cost_models");
  if (!metricsSource.length) errors.push("factory_output_missing_metrics");
  for (const field of ["promotionVerdict", "reasonCodes", "robustScore", "adjustedConfidence", "holdoutPass", "cpcvSummary", "foldMetrics"]) {
    if (metricsSource.length && !Object.prototype.hasOwnProperty.call(metricsSource[0], field)) errors.push(`metric_missing_field:${field}`);
  }
  if (!frameRows.length) errors.push("decision_frame_sample_empty");
  if (latestSweep && !Array.isArray(latestSweep.topMetrics)) warnings.push("latest_sweep_missing_top_metrics");
  if (bundleMode && !leakageAudit) errors.push("missing_leakage_audit");
  if (bundleMode && !researchLiveAlignment) errors.push("missing_research_live_alignment");
  if (bundleMode && !roles.rosterAlignment) errors.push("missing_roster_alignment_tsv");
  if (bundleMode && !roles.promotionGateResults) errors.push("missing_promotion_gate_results_tsv");
  if (bundleMode && !roles.postCloseFrameAudit) errors.push("missing_post_close_frame_audit_tsv");
  if (researchLiveAlignment?.unsupportedLiveAlgoCount > 0) warnings.push("unsupported_live_families_present");
  if (
    researchLiveAlignment
    && Number(researchLiveAlignment.researchAlgoCount ?? 0) > 0
    && Number(researchLiveAlignment.liveAlgoCount ?? 0) > 0
    && Number(researchLiveAlignment.overlapByFamilyCount ?? 0) === 0
  ) {
    errors.push("research_live_family_overlap_zero");
  }
  if (topRosterDefaultSortAudit?.unsafeRankOne === true) errors.push("unsafe_default_top_roster_rank_one");
  if (strict) {
    const temporal = temporalViolations(frameRows);
    if (temporal.postCloseDecisionCount > 0) errors.push("post_close_decision_rows");
    if (temporal.impossibleOrderCount > 0) errors.push("temporal_order_violations");
  }
  if (promotionReview && (bundleManifest?.rowExport?.rowsCapped === true || bundleManifest?.limitations?.includes?.("rows_capped"))) {
    errors.push("promotion_review_requires_full_rows");
  }
  if (requireRawTicks && rawTicksManifest?.available !== true) errors.push("raw_ticks_required_missing");
  return { warnings, errors, warningCount: warnings.length, errorCount: errors.length };
}

function bundleEvidenceSummary({ bundleManifest, rawTicksManifest }) {
  if (!bundleManifest && !rawTicksManifest) return null;
  const rowExport = objectOrEmpty(bundleManifest?.rowExport);
  const rawExport = objectOrEmpty(bundleManifest?.rawMarketTickExport);
  const rawCoverage = objectOrEmpty(rawExport.targetMarketCoverage);
  const rawTargetSamples = objectOrEmpty(rawExport.targetMarketSamples);
  const sourceHash = objectOrEmpty(rawExport.sourceHash);
  const rawSourceFiles = Array.isArray(rawTicksManifest?.sourceSnapshotFiles) ? rawTicksManifest.sourceSnapshotFiles : [];
  const rawSourceHashPolicy = objectOrEmpty(rawTicksManifest?.sourceHashPolicy);
  const covered = numberOrDefault(rawCoverage.covered, numberOrDefault(rawTicksManifest?.coveredTargetMarketCount, 0));
  const uncovered = numberOrDefault(rawCoverage.uncovered, numberOrDefault(rawTicksManifest?.uncoveredTargetMarketCount, 0));
  const targetMarketCount = numberOrDefault(
    rawExport.targetMarketCount,
    numberOrDefault(rawTicksManifest?.targetMarketCount, covered + uncovered),
  );
  const coverageRatio = numberOrDefault(
    rawCoverage.ratio,
    targetMarketCount > 0 ? roundRatio(covered / targetMarketCount) : null,
  );
  const warningCodes = uniqueStrings([
    ...arrayOfStrings(rawExport.warningCodes),
    ...arrayOfStrings(rawTicksManifest?.warningCodes),
  ]);
  const coveredTargetSample = Array.isArray(rawTargetSamples.covered)
    ? arrayOfStrings(rawTargetSamples.covered)
    : arrayOfStrings(rawTicksManifest?.coveredTargetMarkets).slice(0, 10);
  const uncoveredTargetSample = Array.isArray(rawTargetSamples.uncovered)
    ? arrayOfStrings(rawTargetSamples.uncovered)
    : arrayOfStrings(rawTicksManifest?.uncoveredTargetMarkets).slice(0, 10);
  const skippedLargeFileSample = Array.isArray(sourceHash.skippedLargeFileSample)
    ? sourceHash.skippedLargeFileSample.map(sourceFileSample).filter(Boolean)
    : Array.isArray(rawTicksManifest?.sourceSnapshotFiles)
      ? rawTicksManifest.sourceSnapshotFiles.filter((source) => source?.hashSkipped).slice(0, 5).map(sourceFileSample).filter(Boolean)
      : [];
  const totalSourceBytes = numberOrDefault(
    sourceHash.totalSourceBytes,
    numberOrDefault(rawSourceHashPolicy.totalSourceBytes, sumSourceBytes(rawSourceFiles)),
  );
  const hashedSourceBytes = numberOrDefault(
    sourceHash.hashedSourceBytes,
    numberOrDefault(rawSourceHashPolicy.hashedSourceBytes, sumSourceBytes(rawSourceFiles.filter((source) => source?.sha256))),
  );
  const hashSkippedSourceBytes = numberOrDefault(
    sourceHash.hashSkippedSourceBytes,
    numberOrDefault(rawSourceHashPolicy.hashSkippedSourceBytes, sumSourceBytes(rawSourceFiles.filter((source) => source?.hashSkipped))),
  );
  const hashSkippedByteRatio = numberOrDefault(
    sourceHash.hashSkippedByteRatio,
    numberOrDefault(rawSourceHashPolicy.hashSkippedByteRatio, totalSourceBytes > 0 ? roundRatio(hashSkippedSourceBytes / totalSourceBytes) : null),
  );

  return {
    rowExport: {
      mode: stringOrNull(rowExport.mode),
      includeRows: rowExport.includeRows === true,
      rowsCapped: rowExport.rowsCapped === true,
      rowCap: numberOrDefault(rowExport.rowCap, null),
      promotionReviewComplete: rowExport.promotionReviewComplete === true,
    },
    rawTicks: {
      manifestPresent: typeof rawExport.manifestPresent === "boolean" ? rawExport.manifestPresent : Boolean(rawTicksManifest),
      parseOk: typeof rawExport.parseOk === "boolean" ? rawExport.parseOk : Boolean(rawTicksManifest),
      available: typeof rawExport.available === "boolean" ? rawExport.available : rawTicksManifest?.available === true,
      availabilityStatus: stringOrNull(rawExport.availabilityStatus ?? rawTicksManifest?.availabilityStatus),
      reason: stringOrNull(rawExport.reason ?? rawTicksManifest?.reason),
      requestedFormat: stringOrNull(rawExport.requestedFormat ?? rawTicksManifest?.requestedFormat),
      exportedFormat: stringOrNull(rawExport.exportedFormat ?? rawTicksManifest?.exportedFormat ?? rawTicksManifest?.format),
      targetMarketCount,
      jsonlFileCount: numberOrDefault(rawExport.jsonlFileCount, Array.isArray(rawTicksManifest?.jsonlFiles) ? rawTicksManifest.jsonlFiles.length : 0),
      sourceSnapshotFileCount: numberOrDefault(rawExport.sourceSnapshotFileCount, numberOrDefault(rawTicksManifest?.sourceSnapshotFileCount, 0)),
      coverage: {
        covered,
        uncovered,
        ratio: coverageRatio,
      },
      targetMarketSamples: {
        covered: coveredTargetSample,
        uncovered: uncoveredTargetSample,
        omittedCoveredCount: numberOrDefault(rawTargetSamples.omittedCoveredCount, Math.max(0, covered - coveredTargetSample.length)),
        omittedUncoveredCount: numberOrDefault(rawTargetSamples.omittedUncoveredCount, Math.max(0, uncovered - uncoveredTargetSample.length)),
      },
      sourceHash: {
        hashedFileCount: numberOrDefault(sourceHash.hashedFileCount, numberOrDefault(rawTicksManifest?.hashedSourceSnapshotFileCount, 0)),
        skippedLargeFileCount: numberOrDefault(sourceHash.skippedLargeFileCount, numberOrDefault(rawTicksManifest?.hashSkippedSourceSnapshotFileCount, 0)),
        sha256MaxBytes: numberOrDefault(sourceHash.sha256MaxBytes, numberOrDefault(rawTicksManifest?.sourceHashPolicy?.sha256MaxBytes, null)),
        totalSourceBytes,
        hashedSourceBytes,
        hashSkippedSourceBytes,
        hashSkippedByteRatio,
        skippedLargeFileSample,
        omittedSkippedLargeFileCount: numberOrDefault(
          sourceHash.omittedSkippedLargeFileCount,
          Math.max(0, numberOrDefault(sourceHash.skippedLargeFileCount, numberOrDefault(rawTicksManifest?.hashSkippedSourceSnapshotFileCount, 0)) - skippedLargeFileSample.length),
        ),
      },
      warningCodes,
    },
    limitations: uniqueStrings(arrayOfStrings(bundleManifest?.limitations)),
  };
}

function sourceFileSample(source) {
  const record = objectOrEmpty(source);
  const relativePath = stringOrNull(record.relativePath);
  if (!relativePath) return null;
  return {
    relativePath,
    bytes: numberOrDefault(record.bytes, 0),
    hashSkipped: record.hashSkipped === true,
  };
}

function sumSourceBytes(sources) {
  return sources.reduce((total, source) => total + numberOrDefault(source?.bytes, 0), 0);
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

function gateReportSummary(metrics) {
  const reasonCounts = {};
  const rows = [];
  let validCount = 0;
  for (const metric of metrics ?? []) {
    const gate = metricPassesResearchGate(metric);
    if (gate.ok) validCount += 1;
    for (const reason of gate.reasonCodes) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    rows.push({
      algoId: metric.algoId ?? metric.id ?? "unknown",
      promotionVerdict: metric.promotionVerdict ?? "unknown",
      ok: gate.ok,
      reasonCodes: gate.reasonCodes,
      robustScore: metric.robustScore ?? null,
      adjustedConfidence: metric.adjustedConfidence ?? null,
      holdoutPass: metric.holdoutPass ?? null,
      conservativeTotalPnl: metric.conservativeTotalPnl ?? null,
      stressTotalPnl: metric.stressTotalPnl ?? null,
    });
  }
  return {
    checkedCount: metrics?.length ?? 0,
    validCount,
    allowedToLoadArenaBatch: validCount > 0,
    state: validCount > 0 ? "research_validated" : "hold_gather_evidence",
    reasonCounts,
    topBlocked: rows.filter((row) => !row.ok).slice(0, 25),
  };
}

function metricPassesResearchGate(metric) {
  if (!metric) return { ok: false, reasonCodes: ["missing_metric"] };
  const reasonCodes = [];
  if (metric.nonPromotable) reasonCodes.push("non_promotable");
  if (metric.promotionVerdict !== "paper_only" && metric.promotionVerdict !== "tiny_live_eligible") {
    reasonCodes.push(metric.promotionVerdict === "insufficient_data" ? "insufficient_data" : "promotion_verdict_not_validated");
  }
  if (metric.labelSource !== "official_resolution") reasonCodes.push("official_label_required");
  if (metric.settlementSource !== "official_resolution") reasonCodes.push("official_settlement_required");
  if (numberOrDefault(metric.officialSettlementCoverage, 0) < 0.95) reasonCodes.push("official_settlement_coverage_low");
  if (metric.holdoutPass !== true || metric.holdoutStrictlyLater === false) reasonCodes.push("holdout_failed");
  if (numberOrDefault(metric.holdoutConservativeTotalPnl, Number.NEGATIVE_INFINITY) <= 0) reasonCodes.push("holdout_conservative_pnl_not_positive");
  if (!Number.isFinite(Number(metric.holdoutLowerCi)) || Number(metric.holdoutLowerCi) < 0) reasonCodes.push("holdout_lower_ci_below_zero");
  if (metric.walkForwardPass !== true) reasonCodes.push("walk_forward_failed");
  if (numberOrDefault(metric.cpcvSummary?.positiveFoldRate ?? metric.cpcvPositivePathRate ?? metric.cpcvPositiveRate, 0) < 0.7) reasonCodes.push("poor_cpcv_consistency");
  if (numberOrDefault(metric.conservativeTotalPnl, Number.NEGATIVE_INFINITY) <= 0) reasonCodes.push("conservative_pnl_not_positive");
  if (numberOrDefault(metric.stressTotalPnl, Number.NEGATIVE_INFINITY) <= 0) reasonCodes.push("stress_pnl_not_positive");
  if (numberOrDefault(metric.adjustedConfidence, 0) < 0.7) reasonCodes.push("adjusted_confidence_low");
  if (numberOrDefault(metric.dsrApprox, 0) < 0.8) reasonCodes.push("dsr_approx_low");
  if (numberOrDefault(metric.pboApprox, 1) > 0.2) reasonCodes.push("pbo_approx_high");
  if (numberOrDefault(metric.familyAdjustedPValue, 1) > 0.1) reasonCodes.push("family_adjusted_p_value_high");
  if (numberOrDefault(metric.globalAdjustedPValue, 1) > 0.1) reasonCodes.push("global_adjusted_p_value_high");
  if (numberOrDefault(metric.falseDiscoveryRisk, 1) > 0.2) reasonCodes.push("false_discovery_risk_high");
  if (metric.paperEvidence?.available && metric.paperEvidence.driftOk === false) reasonCodes.push("paper_drift_detected");
  return { ok: reasonCodes.length === 0, reasonCodes };
}

function temporalViolations(rows) {
  const examples = [];
  let postCloseDecisionCount = 0;
  let impossibleOrderCount = 0;
  for (const row of rows ?? []) {
    const id = row.row_id ?? row.frame_id ?? row.id ?? row.market_id ?? row.marketTicker ?? "unknown";
    const featureMs = timestampMs(row.feature_timestamp ?? row.featureTimestamp ?? row.frame_timestamp_utc ?? row.observedAt);
    const decisionMs = timestampMs(row.decision_timestamp ?? row.decisionTimestamp ?? row.frame_timestamp_utc ?? row.featureTimestamp ?? row.observedAt);
    const closeMs = timestampMs(row.market_close_timestamp ?? row.marketCloseTimestamp ?? row.market_close_timestamp_utc ?? row.marketCloseTime);
    const labelMs = timestampMs(row.label_timestamp ?? row.labelTimestamp ?? row.label_timestamp_utc);
    const settlementMs = timestampMs(row.settlement_timestamp ?? row.settlementTimestamp ?? row.settlement_timestamp_utc);
    if (Number.isFinite(decisionMs) && Number.isFinite(closeMs) && decisionMs > closeMs) {
      postCloseDecisionCount += 1;
      if (examples.length < 20) examples.push({ id, problem: "post_close_decision", decisionTimestamp: new Date(decisionMs).toISOString(), marketCloseTimestamp: new Date(closeMs).toISOString() });
    }
    const impossible =
      (Number.isFinite(featureMs) && Number.isFinite(decisionMs) && featureMs > decisionMs) ||
      (Number.isFinite(closeMs) && Number.isFinite(labelMs) && labelMs < closeMs) ||
      (Number.isFinite(closeMs) && Number.isFinite(settlementMs) && settlementMs < closeMs);
    if (impossible) {
      impossibleOrderCount += 1;
      if (examples.length < 20) examples.push({ id, problem: "temporal_order" });
    }
  }
  return { postCloseDecisionCount, impossibleOrderCount, examples };
}

async function reconcileTopRosterSummary({ roles, topTradersExecutable }) {
  const stats = topTradersExecutable?.stats ?? topTradersExecutable?.topTradersExecutable?.stats ?? {};
  const statRows = Object.values(stats).filter((row) => row && typeof row === "object");
  const tradePath = roles.snapshotTradesCsv ?? roles.perTradeCsv;
  if (!statRows.length) {
    return { available: false, compared: 0, unmatchedStats: 0, mismatchedPnl: 0, warnings: ["top_traders_stats_missing"] };
  }
  if (!tradePath) {
    return { available: false, compared: 0, unmatchedStats: statRows.length, mismatchedPnl: 0, warnings: ["trade_rows_missing_for_top_roster_reconciliation"] };
  }
  const tradeRows = await readCsvRows(tradePath).catch(() => []);
  const pnlByAlgo = new Map();
  for (const row of tradeRows) {
    const id = row.algoId ?? row.algo_id ?? row.strategy_id ?? row.strategyId;
    if (!id) continue;
    pnlByAlgo.set(id, (pnlByAlgo.get(id) ?? 0) + numberOrDefault(row.pnl, 0));
  }
  let compared = 0;
  let unmatchedStats = 0;
  let mismatchedPnl = 0;
  const examples = [];
  for (const stat of statRows) {
    const id = stat.sourceAlgoId ?? stat.algoId ?? stat.id ?? stat.strategyId;
    if (!id) continue;
    const expected = numberOrDefault(stat.totalPnl, null);
    const actual = pnlByAlgo.get(id);
    if (actual === undefined) {
      unmatchedStats += 1;
      if (examples.length < 20) examples.push({ algoId: id, problem: "missing_trade_rows" });
      continue;
    }
    compared += 1;
    if (expected !== null && Math.abs(expected - actual) > 0.01) {
      mismatchedPnl += 1;
      if (examples.length < 20) examples.push({ algoId: id, problem: "pnl_mismatch", statsPnl: expected, rowPnl: actual });
    }
  }
  return {
    available: true,
    compared,
    unmatchedStats,
    mismatchedPnl,
    warnings: [
      ...(unmatchedStats ? ["top_roster_stats_without_trade_rows"] : []),
      ...(mismatchedPnl ? ["top_roster_pnl_mismatch"] : []),
    ],
    examples,
  };
}

function eventsFromDecisionFrameSample(rows) {
  const byMarket = new Map();
  for (const row of rows) {
    const id = row.market_id ?? row.marketTicker ?? row.market_ticker;
    const featureMs = timestampMs(row.frame_timestamp_utc ?? row.feature_timestamp ?? row.featureTimestamp ?? row.observed_at ?? row.observedAt);
    const closeMs = timestampMs(row.market_close_timestamp_utc ?? row.market_close_timestamp ?? row.marketCloseTimestamp ?? row.marketCloseTime);
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
    "## Bundle Evidence",
    "",
    bundleEvidenceMarkdown(audit.bundleEvidence),
    "",
    "## Research Gate",
    "",
    audit.gate
      ? [
        `- State: ${audit.gate.state}`,
        `- Valid research candidates: ${audit.gate.validCount}/${audit.gate.checkedCount}`,
        `- Arena batch loading allowed: ${audit.gate.allowedToLoadArenaBatch ? "yes" : "no"}`,
        `- Block reasons: ${Object.entries(audit.gate.reasonCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
      ].join("\n")
      : "- Gate report was not requested.",
    "",
    "## Top Roster Reconciliation",
    "",
    audit.topRosterReconciliation
      ? [
        `- Available: ${audit.topRosterReconciliation.available ? "yes" : "no"}`,
        `- Compared rows: ${audit.topRosterReconciliation.compared}`,
        `- Unmatched stats: ${audit.topRosterReconciliation.unmatchedStats}`,
        `- P/L mismatches: ${audit.topRosterReconciliation.mismatchedPnl}`,
        `- Warnings: ${audit.topRosterReconciliation.warnings.join(", ") || "none"}`,
      ].join("\n")
      : "- Top roster reconciliation was not requested.",
    "",
    "## Leakage Audit",
    "",
    audit.leakageAudit
      ? [
        `- Post-close rows detected: ${audit.leakageAudit.postCloseRowsDetected ?? 0}`,
        `- Post-close rows excluded: ${audit.leakageAudit.postCloseRowsExcluded ?? 0}`,
        `- Duplicate frames removed: ${audit.leakageAudit.duplicateFramesRemoved ?? 0}`,
        `- Overlapping frames downsampled: ${audit.leakageAudit.overlappingFramesDownsampled ?? 0}`,
      ].join("\n")
      : "- Leakage audit artifact was not present.",
    "",
    "## Research/Live Alignment",
    "",
    audit.researchLiveAlignment
      ? [
        `- Research algos: ${audit.researchLiveAlignment.researchAlgoCount}`,
        `- Live algos: ${audit.researchLiveAlignment.liveAlgoCount}`,
        `- ID overlap: ${audit.researchLiveAlignment.overlapByIdCount}`,
        `- Family overlap: ${audit.researchLiveAlignment.overlapByFamilyCount}`,
        `- Unsupported live algos: ${audit.researchLiveAlignment.unsupportedLiveAlgoCount}`,
      ].join("\n")
      : "- Research/live alignment artifact was not present.",
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
    "## Bundle Evidence",
    "",
    bundleEvidenceMarkdown(finalReview.audit.bundleEvidence),
    "",
    "## Research Gate",
    "",
    finalReview.audit.gate
      ? `State: ${finalReview.audit.gate.state}; valid candidates: ${finalReview.audit.gate.validCount}/${finalReview.audit.gate.checkedCount}; arena load allowed: ${finalReview.audit.gate.allowedToLoadArenaBatch ? "yes" : "no"}.`
      : "Gate report was not requested.",
    "",
    "## Top Roster Reconciliation",
    "",
    finalReview.audit.topRosterReconciliation
      ? `Compared ${finalReview.audit.topRosterReconciliation.compared} rows; unmatched stats ${finalReview.audit.topRosterReconciliation.unmatchedStats}; P/L mismatches ${finalReview.audit.topRosterReconciliation.mismatchedPnl}.`
      : "Top roster reconciliation was not requested.",
    "",
    "## Leakage And Alignment",
    "",
    finalReview.audit.leakageAudit
      ? `Post-close detected/excluded: ${finalReview.audit.leakageAudit.postCloseRowsDetected ?? 0}/${finalReview.audit.leakageAudit.postCloseRowsExcluded ?? 0}.`
      : "Leakage audit artifact was not present.",
    finalReview.audit.researchLiveAlignment
      ? `Research/live overlap: ${finalReview.audit.researchLiveAlignment.overlapByIdCount} IDs, ${finalReview.audit.researchLiveAlignment.overlapByFamilyCount} families; unsupported live algos: ${finalReview.audit.researchLiveAlignment.unsupportedLiveAlgoCount}.`
      : "Research/live alignment artifact was not present.",
    "",
    "## Promotion Timeline",
    "",
    "```mermaid",
    finalReview.promotionTimeline.trim(),
    "```",
  ].join("\n");
}

function bundleEvidenceMarkdown(summary) {
  if (!summary) {
    return "- No bundle manifest was present; raw-tick and row-export readiness were not summarized.";
  }
  const raw = summary.rawTicks ?? {};
  const coverage = raw.coverage ?? {};
  const targetSamples = raw.targetMarketSamples ?? {};
  const sourceHash = raw.sourceHash ?? {};
  const extractionPolicy = raw.extractionPolicy ?? {};
  const totalTargets = raw.targetMarketCount || numberOrDefault(coverage.covered, 0) + numberOrDefault(coverage.uncovered, 0);
  const coveragePercent = typeof coverage.ratio === "number" ? `${Math.round(coverage.ratio * 1000) / 10}%` : "n/a";
  const sourceScanBudget = [
    numberOrDefault(extractionPolicy.sourceFileDiscoveryLimit, null),
    numberOrDefault(extractionPolicy.sourceLineLimit, null),
    numberOrDefault(extractionPolicy.sourceScanBytes, null),
    numberOrDefault(extractionPolicy.sourceHeadScanBytes, null),
  ];
  const supplementalScanPasses = numberOrDefault(extractionPolicy.supplementalScanPasses, null);
  const supplementalScanBytes = numberOrDefault(extractionPolicy.supplementalScanBytes, null);
  const hasExtractionPolicy = [extractionPolicy.maxTargetMarkets, extractionPolicy.maxRowsPerMarket, extractionPolicy.sourceFileDiscoveryLimit].every((value) => Number.isFinite(value));
  const rowText = summary.rowExport?.rowsCapped
    ? `Rows: capped at ${summary.rowExport.rowCap ?? "configured limit"} (${summary.rowExport.mode ?? "unknown"} mode).`
    : summary.rowExport?.includeRows === false
      ? "Rows: disabled."
      : summary.rowExport?.promotionReviewComplete
        ? "Rows: full extracts exported."
        : `Rows: ${summary.rowExport?.mode ?? "unknown"} mode.`;
  const rawState = raw.availabilityStatus ?? (raw.available ? "available" : "unavailable");
  const uncoveredSample = Array.isArray(targetSamples.uncovered) ? targetSamples.uncovered : [];
  const skippedSourceSample = Array.isArray(sourceHash.skippedLargeFileSample) ? sourceHash.skippedLargeFileSample : [];
  const skippedByteRatio = typeof sourceHash.hashSkippedByteRatio === "number" ? `${Math.round(sourceHash.hashSkippedByteRatio * 1000) / 10}%` : "n/a";
  const lines = [
    `- ${rowText}`,
    `- Raw ticks: ${rawState} (${raw.available ? "available" : "unavailable"}).`,
    `- Coverage: ${coverage.covered ?? 0}/${totalTargets} target markets (${coveragePercent}); jsonl files: ${raw.jsonlFileCount ?? 0}; source files: ${raw.sourceSnapshotFileCount ?? 0}.`,
    hasExtractionPolicy
      ? `- Raw tick extraction policy: max ${extractionPolicy.maxTargetMarkets} target markets, ${extractionPolicy.maxRowsPerMarket} rows/market; scan budget ${extractionPolicy.sourceFileDiscoveryLimit ?? "n/a"} files, ${sourceScanBudget[1] ?? "n/a"} lines per file with ${sourceScanBudget[2] ?? "n/a"}/${sourceScanBudget[3] ?? "n/a"} bytes (tail/head).`
      : "- Raw tick extraction policy: not recorded.",
    `- Supplemental raw-tick recovery: ${supplementalScanPasses ?? "n/a"} additional passes, ${supplementalScanBytes ?? "n/a"} bytes per pass.`,
    `- Source hashes: ${sourceHash.hashedFileCount ?? 0} hashed, ${sourceHash.skippedLargeFileCount ?? 0} skipped as large; skipped bytes: ${sourceHash.hashSkippedSourceBytes ?? 0}/${sourceHash.totalSourceBytes ?? 0} (${skippedByteRatio}).`,
    `- Limitations: ${summary.limitations?.join(", ") || "none"}.`,
    `- Raw tick warnings: ${raw.warningCodes?.join(", ") || "none"}.`,
  ];
  if (uncoveredSample.length) {
    const omitted = numberOrDefault(targetSamples.omittedUncoveredCount, 0);
    lines.push(`- Uncovered target sample: ${uncoveredSample.join(", ")}${omitted > 0 ? ` (+${omitted} more)` : ""}.`);
  }
  if (skippedSourceSample.length) {
    const omitted = numberOrDefault(sourceHash.omittedSkippedLargeFileCount, 0);
    const files = skippedSourceSample.map((source) => `${source.relativePath} (${source.bytes ?? 0} bytes)`);
    lines.push(`- Hash-skipped source sample: ${files.join(", ")}${omitted > 0 ? ` (+${omitted} more)` : ""}.`);
  }
  return lines.join("\n");
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

async function readCsvRows(file) {
  const text = await readText(file);
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.length === 0) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.length > 0) : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function roundRatio(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    strict: Boolean(args.strict),
    promotionReview: Boolean(args["promotion-review"]),
    requireRawTicks: Boolean(args["require-raw-ticks"]),
    gateReport: Boolean(args["gate-report"]),
    reconcileTopRoster: Boolean(args["reconcile-top-roster"]),
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
