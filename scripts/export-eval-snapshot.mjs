import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashJson, isRecord, stableStringify } from "./factory/utils.mjs";
import { loadSnapshotHistory, writeSnapshotHistory } from "./factory/snapshot-history.mjs";

const execFileAsync = promisify(execFile);
const schemaVersion = "dogeedge.eval.snapshot.v1";
const defaultRootSeed = "dogeedge-factory-v2";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const algoMetricsColumns = [
  "snapshotId",
  "windowStartAt",
  "windowEndAt",
  "algoId",
  "displayId",
  "algoName",
  "family",
  "batchId",
  "lineageGeneration",
  "lineageParentIdsJson",
  "status",
  "enabled",
  "slot",
  "promotionStage",
  "promotionVerdict",
  "labelSource",
  "settlementSource",
  "officialResolutionAvailable",
  "officialSettlementCoverage",
  "warningCodesJson",
  "reasonCodesJson",
  "closed",
  "independentClosedMarkets",
  "daysRepresented",
  "wins",
  "losses",
  "winRate",
  "averagePnl",
  "totalPnl",
  "totalCost",
  "roi",
  "conservativeTotalPnl",
  "stressTotalPnl",
  "maxDrawdown",
  "downsideDeviation",
  "profitFactor",
  "psr",
  "dsrApprox",
  "pboApprox",
  "familyAdjustedPValue",
  "globalAdjustedPValue",
  "falseDiscoveryRisk",
  "adjustedConfidence",
  "robustScore",
  "foldPositiveRate",
  "cpcvPositiveRate",
  "walkForwardPass",
  "walkForwardClosed",
  "walkForwardTotalPnl",
  "walkForwardRoi",
  "holdoutPass",
  "holdoutClosed",
  "holdoutConservativeMarkets",
  "holdoutConservativeTotalPnl",
  "holdoutLowerCi",
  "paperEvidenceAvailable",
  "paperClosedMarkets",
  "paperClosedTrades",
  "paperTotalPnl",
  "paperRoi",
  "driftOk",
  "driftScore",
  "driftReasonsJson",
  "avgSlippageCents",
  "avgPartialFillRatio",
  "avgFillProbability",
  "avgFillDepthUtilization",
  "sourceRunId",
  "sourceSnapshotHash",
];

const foldMetricsColumns = [
  "snapshotId",
  "algoId",
  "foldKind",
  "foldId",
  "trainEventIdsHash",
  "validationEventIdsHash",
  "purgedEventIdsHash",
  "embargoedEventIdsHash",
  "embargoMs",
  "strictlyLater",
  "trainEventCount",
  "validationEventCount",
  "purgedEventCount",
  "embargoedEventCount",
  "closed",
  "independentClosedMarkets",
  "wins",
  "losses",
  "winRate",
  "averagePnl",
  "totalPnl",
  "totalCost",
  "roi",
  "maxDrawdown",
  "lowerCi",
  "upperCi",
  "pass",
];

const decisionAggregateColumns = [
  "snapshotId",
  "windowStartAt",
  "windowEndAt",
  "algoId",
  "displayId",
  "family",
  "promotionStage",
  "promotionVerdict",
  "marketCount",
  "independentMarketCount",
  "decisionCount",
  "signalCount",
  "attemptCount",
  "acceptedBuys",
  "acceptRate",
  "buySignals",
  "exitSignals",
  "skipSignals",
  "rejectCount",
  "staleRejects",
  "edgeRejects",
  "depthRejects",
  "gateRejects",
  "priceRejects",
  "otherRejects",
  "featureTimestampMin",
  "featureTimestampMax",
  "decisionTimestampMin",
  "decisionTimestampMax",
  "regimeTimeToClose",
  "regimeSpread",
  "regimeLiquidity",
  "regimeVolatility",
  "regimeMomentum",
  "regimeDistance",
  "warningCodesJson",
];

const tradeAggregateColumns = [
  "snapshotId",
  "windowStartAt",
  "windowEndAt",
  "algoId",
  "displayId",
  "family",
  "promotionStage",
  "promotionVerdict",
  "openedCount",
  "closedCount",
  "openCount",
  "independentClosedMarkets",
  "wins",
  "losses",
  "totalContracts",
  "totalFees",
  "totalCost",
  "totalPnl",
  "roi",
  "averagePnl",
  "maxDrawdown",
  "averageHoldingSeconds",
  "averageEntryPrice",
  "averageExitPrice",
  "averageSlippageCents",
  "averageFillProbability",
  "averagePartialFillRatio",
  "staleQuoteRejections",
  "queueMisses",
  "depthRejections",
  "regimeTimeToClose",
  "regimeSpread",
  "regimeLiquidity",
  "regimeVolatility",
  "regimeMomentum",
  "regimeDistance",
  "warningCodesJson",
];

const decisionRowsColumns = [
  "snapshotId",
  "rowId",
  "marketTicker",
  "algoId",
  "displayId",
  "family",
  "featureTimestamp",
  "decisionTimestamp",
  "labelTimestamp",
  "settlementTimestamp",
  "labelSource",
  "settlementSource",
  "officialResolutionAvailable",
  "marketCloseTimestamp",
  "side",
  "decisionAction",
  "attempted",
  "accepted",
  "rejectCode",
  "rejectMessage",
  "observedAt",
  "capturedAt",
  "secondsToClose",
  "targetPrice",
  "estimate",
  "spotPrice",
  "oneMinuteChange",
  "oneMinuteMovePercent",
  "distanceFromTarget",
  "fairProbability",
  "modelAction",
  "modelConfidence",
  "modelEdgeAfterFees",
  "yesBid",
  "yesAsk",
  "noBid",
  "noAsk",
  "yesSpread",
  "noSpread",
  "yesBidDepth",
  "yesAskDepth",
  "noBidDepth",
  "noAskDepth",
  "regimeTimeToClose",
  "regimeSpread",
  "regimeLiquidity",
  "regimeVolatility",
  "regimeMomentum",
  "regimeDistance",
  "regimePhase",
  "independentKey",
  "overlapCount",
  "sourceFileHash",
  "sourceLine",
];

const tradeRowsColumns = [
  "snapshotId",
  "tradeId",
  "marketTicker",
  "algoId",
  "displayId",
  "family",
  "promotionStage",
  "promotionVerdict",
  "openedAt",
  "closedAt",
  "decisionTimestamp",
  "featureTimestamp",
  "labelTimestamp",
  "settlementTimestamp",
  "labelSource",
  "settlementSource",
  "officialResolutionAvailable",
  "status",
  "side",
  "contracts",
  "entryPrice",
  "exitPrice",
  "bestExitPrice",
  "feesPaid",
  "pnl",
  "roiPerTrade",
  "holdingSeconds",
  "fillProbability",
  "partialFillRatio",
  "slippageCents",
  "depthUtilization",
  "queueMiss",
  "rejectCode",
  "entryReason",
  "exitReason",
  "entryRegimeTimeToClose",
  "entryRegimeSpread",
  "entryRegimeLiquidity",
  "entryRegimeVolatility",
  "entryRegimeMomentum",
  "entryRegimeDistance",
  "sourceRunId",
  "sourceSnapshotHash",
];

const warningsColumns = [
  "snapshotId",
  "scope",
  "objectType",
  "objectId",
  "code",
  "severity",
  "firstSeenAt",
  "lastSeenAt",
  "count",
  "message",
  "remediationHint",
];

const paperDecisionLedgerColumns = [
  "snapshotId",
  "eventId",
  "eventType",
  "marketTicker",
  "algoId",
  "displayId",
  "family",
  "promotionStage",
  "promotionVerdict",
  "decisionTimestamp",
  "featureTimestamp",
  "marketCloseTimestamp",
  "labelTimestamp",
  "settlementTimestamp",
  "labelSource",
  "settlementSource",
  "officialResolutionAvailable",
  "side",
  "expectedEdgeAfterFees",
  "yesBid",
  "yesAsk",
  "noBid",
  "noAsk",
  "yesBidDepth",
  "yesAskDepth",
  "noBidDepth",
  "noAskDepth",
  "regimeTimeToClose",
  "regimeSpread",
  "regimeLiquidity",
  "regimeVolatility",
  "regimeMomentum",
  "regimeDistance",
  "attempted",
  "accepted",
  "rejected",
  "rejectCode",
  "rejectMessage",
  "fillProbability",
  "partialFillRatio",
  "depthUtilization",
  "queueMiss",
  "slippageCents",
  "sourceRunId",
  "gitCommit",
  "dataHash",
  "configHash",
];

export async function exportEvaluationSnapshot(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const generatedAt = now.toISOString();
  const snapshotId = options.snapshotId ?? `snap-${compactIso(now)}`;
  const windowMinutes = numberOption(options.windowMinutes, 30);
  const windowEndAt = generatedAt;
  const windowStartAt = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const dataRoot = path.resolve(options.dataRoot ?? defaultDataRoot());
  const storageDir = path.resolve(options.storageDir ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
  const backtestsDir = path.resolve(options.backtestsDir ?? path.join(dataRoot, "backtests"));
  const outRoot = path.resolve(options.outDir ?? path.join(dataRoot, "gpt-review-packets"));
  const snapshotsRoot = path.join(outRoot, "snapshots");
  const priorHistory = await loadSnapshotHistory({ snapshotsRoot, hours: 48 });
  const snapshotDir = path.join(outRoot, "snapshots", snapshotId);
  const includeRows = options.includeRows !== false;
  const maxRowLines = numberOption(options.maxRowLines, 1_000);
  const maxMetrics = numberOption(options.maxMetrics, 600);
  await mkdir(snapshotDir, { recursive: true });

  const localLatestPath = path.join(storageDir, "latest.json");
  const localSummaryPath = path.join(storageDir, "summary.md");
  const liveSwitchPath = path.join(storageDir, "live-switch.json");
  const factoryAutomationPath = path.join(storageDir, "factory-automation.json");
  const topTradersPath = path.join(storageDir, "top-traders-executable.json");
  const latestBacktestPath = path.join(backtestsDir, "latest.json");
  const latestSweepPath = path.join(backtestsDir, "latest-sweep.json");

  const [
    localLatest,
    liveSwitch,
    factoryAutomationFile,
    topTradersFile,
    latestBacktest,
    latestSweep,
    gitInfo,
  ] = await Promise.all([
    readJsonMaybe(localLatestPath),
    readJsonMaybe(liveSwitchPath),
    readJsonMaybe(factoryAutomationPath),
    readJsonMaybe(topTradersPath),
    readJsonMaybe(latestBacktestPath),
    readJsonMaybe(latestSweepPath),
    repoInfo(),
  ]);

  const primaryRun = choosePrimaryRun(latestSweep, latestBacktest);
  const runDir = stringOrNull(primaryRun?.runDir);
  const registry = primaryRun?.registry ?? await readJsonMaybe(runDir ? path.join(runDir, "experiment-registry.json") : null) ?? {};
  const metrics = selectMetrics(primaryRun, maxMetrics);
  const metricByAlgoId = new Map(metrics.map((metric) => [metric.algoId, metric]));
  const topExecutable = topTradersFile?.topTradersExecutable ?? localLatest?.topTradersExecutable ?? null;
  const topStats = isRecord(topExecutable?.stats) ? topExecutable.stats : {};
  const sourceSnapshotHash = await hashFileMaybe(localLatestPath);
  const localStoredAt = parseTime(localLatest?.storedAt);
  const dataQuality = dataQualitySummary(primaryRun, metrics);
  const safety = liveSafetyState(liveSwitch);

  const algoRollup = metrics.map((metric) => algoRollupRow(metric, {
    snapshotId,
    windowStartAt,
    windowEndAt,
    sourceRunId: primaryRun?.runId ?? null,
    sourceSnapshotHash,
    topStats,
  }));
  const decisionAggregates = decisionAggregateRows({ snapshotId, windowStartAt, windowEndAt, topStats, metricByAlgoId });
  const tradeAggregates = tradeAggregateRows({ snapshotId, windowStartAt, windowEndAt, metrics, topStats });
  const foldDefinitions = foldDefinitionRows(registry, primaryRun);
  const foldMetrics = foldMetricRows({ snapshotId, metrics, registry, primaryRun });
  let decisionRows = [];
  let tradeRows = [];
  const warnings = warningRows({
    snapshotId,
    generatedAt,
    safety,
    localStoredAt,
    dataQuality,
    gitInfo,
    registry,
    topStats,
    includeRows,
  });

  const filesToWrite = [
    { logicalName: "algoMetrics.tsv.gz", relativePath: "algoMetrics.tsv.gz", content: tsv(algoMetricsColumns, algoRollup.map((row) => flattenAlgoMetrics(row))) },
    { logicalName: "foldMetrics.tsv.gz", relativePath: "foldMetrics.tsv.gz", content: tsv(foldMetricsColumns, foldMetrics) },
    { logicalName: "decisionAggregates.tsv.gz", relativePath: "decisionAggregates.tsv.gz", content: tsv(decisionAggregateColumns, decisionAggregates) },
    { logicalName: "tradeAggregates.tsv.gz", relativePath: "tradeAggregates.tsv.gz", content: tsv(tradeAggregateColumns, tradeAggregates) },
    { logicalName: "warnings.tsv.gz", relativePath: "warnings.tsv.gz", content: tsv(warningsColumns, warnings.map(flattenWarning)) },
  ];

  if (includeRows) {
    decisionRows = await readDecisionRows({ dataRoot, snapshotId, maxRowLines });
    tradeRows = await readTradeRows({
      filePath: path.join(storageDir, "paper-trades.jsonl"),
      snapshotId,
      maxRowLines,
      metricByAlgoId,
      sourceRunId: primaryRun?.runId ?? null,
      sourceSnapshotHash,
    });
    filesToWrite.push(
      { logicalName: "decisionRows.tsv.gz", relativePath: "decisionRows.tsv.gz", content: tsv(decisionRowsColumns, decisionRows) },
      { logicalName: "tradeRows.tsv.gz", relativePath: "tradeRows.tsv.gz", content: tsv(tradeRowsColumns, tradeRows) },
    );
  }

  const fileManifest = [];
  for (const file of filesToWrite) {
    const absolutePath = path.join(snapshotDir, file.relativePath);
    await writeGzipText(absolutePath, file.content);
    const info = await fileInfo(absolutePath, file.logicalName, file.relativePath, rowCountFromTsv(file.content));
    fileManifest.push(info);
  }

  const exactExportFiles = await writeExactReviewFiles({
    snapshotDir,
    snapshotId,
    dataRoot,
    decisionRows,
    tradeRows,
    topStats,
    metricByAlgoId,
    primaryRun,
    registry,
    gitInfo,
    sourceRunId: primaryRun?.runId ?? null,
    sourceSnapshotHash,
  });
  fileManifest.push(...exactExportFiles);

  const snapshot = {
    schemaVersion,
    snapshotId,
    generatedAt,
    sourceTimezone: options.sourceTimezone ?? process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    window: {
      startAt: windowStartAt,
      endAt: windowEndAt,
      durationMinutes: windowMinutes,
      isDelta: true,
      baselineSnapshotId: priorHistory.at(-1)?.snapshotId ?? null,
      evaluationWindowKind: windowKind(windowMinutes),
    },
    snapshotLineage: {
      previousSnapshotId: priorHistory.at(-1)?.snapshotId ?? null,
      baseline48hSnapshotId: priorHistory[0]?.snapshotId ?? null,
      priorSnapshotCount48h: priorHistory.length,
    },
    repo: {
      commitHash: gitInfo.commitHash ?? "UNAVAILABLE",
      branch: gitInfo.branch ?? "UNAVAILABLE",
      dirty: gitInfo.dirty,
      repoPathHint: "_REPO_ROOT_",
      packageJsonSha256: await hashFileMaybe(path.join(repoRoot, "package.json")),
      algoFactoryDocSha256: await hashFileMaybe(path.join(repoRoot, "DOGEEDGE_ALGO_FACTORY.md")),
    },
    timestampSemantics: {
      allTimestampsUtc: true,
      featureTimestampDefinition: "when the input feature was first observable in a local market/feed snapshot",
      decisionTimestampDefinition: "when the app or algo made a buy, skip, or exit decision",
      labelTimestampDefinition: "when the research label becomes knowable for the event",
      settlementTimestampDefinition: "time used by the local evaluation pipeline to settle the event",
      settlementSource: snapshotSettlementSource(metrics),
    },
    appState: {
      liveSafety: safety,
      factoryAutomation: localLatest?.factoryAutomation ?? factoryAutomationFile?.factoryAutomation ?? factoryAutomationFile ?? {},
      topRosterSummary: localLatest?.topTradersExecutableSummary ?? summarizeTopStats(topStats),
      latestStoredAt: localLatest?.storedAt ?? null,
      localWorkerSummarySha256: await hashFileMaybe(localSummaryPath),
    },
    dataQuality,
    experimentRegistry: {
      gitCommit: registry.gitCommit ?? primaryRun?.gitCommit ?? null,
      codeVersion: registry.codeVersion ?? primaryRun?.codeVersion ?? registry.gitCommit ?? null,
      configHash: registry.configHash ?? primaryRun?.configHash ?? "UNAVAILABLE",
      dataHash: registry.dataHash ?? registry.inputManifestHash ?? primaryRun?.dataHash ?? "UNAVAILABLE",
      inputManifestHash: registry.inputManifestHash ?? null,
      trialCount: numberOrZero(registry.trialCount ?? primaryRun?.algoCount),
      metricsVersion: registry.metricsVersion ?? "robust-v1",
      randomSeed: registry.randomSeed ?? primaryRun?.randomSeed ?? defaultRootSeed,
      families: registry.families ?? {},
      seedPlan: registry.seedPlan ?? { rootSeed: registry.randomSeed ?? primaryRun?.randomSeed ?? defaultRootSeed, deterministic: true },
    },
    costModels: costModelsForSnapshot(registry, primaryRun),
    simulatorAssumptions: {
      askSideEntries: true,
      bidSideExits: true,
      visibleDepthOnly: true,
      staleQuoteRuleEnabled: true,
      partialFillsModeled: true,
      simulatorTelemetryFields: [
        "averageSlippageCents",
        "averagePartialFillRatio",
        "averageFillProbability",
        "averageFillDepthUtilization",
        "queueResults",
        "staleQuoteRejections",
        "depthRejections",
      ],
    },
    foldDefinitions,
    algoRollup,
    decisionAggregates,
    tradeAggregates,
    warnings: warnings.map((warning) => ({
      scope: warning.scope,
      objectType: warning.objectType,
      objectId: warning.objectId,
      code: warning.code,
      severity: warning.severity,
      firstSeenAt: warning.firstSeenAt,
      lastSeenAt: warning.lastSeenAt,
      count: warning.count,
      message: warning.message,
      remediationHint: warning.remediationHint,
    })),
    alerts: warnings
      .filter((warning) => ["high", "critical"].includes(warning.severity))
      .map((warning) => ({ code: warning.code, severity: warning.severity, objectId: warning.objectId, message: warning.message })),
    filesManifest: fileManifest,
  };

  const validation = validateEvaluationSnapshot(snapshot);
  if (!validation.ok) {
    snapshot.warnings.push({
      scope: "snapshot",
      objectType: "snapshot",
      objectId: snapshotId,
      code: "snapshot_schema_warning",
      severity: "high",
      message: validation.errors.join("; "),
      remediationHint: "Fix exporter inputs before relying on this review packet.",
    });
  }

  const snapshotPath = path.join(snapshotDir, `${snapshotId}.json.gz`);
  await writeGzipText(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  const snapshotInfo = await fileInfo(snapshotPath, `${snapshotId}.json.gz`, `${snapshotId}.json.gz`, null);
  const manifest = {
    schemaVersion: "dogeedge.eval.export.manifest.v1",
    snapshotId,
    generatedAt,
    snapshotPath,
    gitCommit: snapshot.repo.commitHash,
    dataHash: snapshot.experimentRegistry.dataHash,
    configHash: snapshot.experimentRegistry.configHash,
    costModelHash: registry.costModelHash ?? hashJson(snapshot.costModels),
    riskModelHash: registry.riskModelHash ?? hashJson(registry.riskModel ?? {}),
    timestampSemantics: snapshot.timestampSemantics,
    dataRoot: "_DATA_ROOT_",
    storageDir: "_DATA_ROOT_/local-worker",
    backtestsDir: "_DATA_ROOT_/backtests",
    primaryRunId: primaryRun?.runId ?? null,
    primaryRunDir: runDir ? "_DATA_ROOT_/backtests/" + path.basename(path.dirname(runDir)) + "/" + path.basename(runDir) : null,
    safetyStatus: safety,
    files: [snapshotInfo, ...fileManifest],
    warnings: snapshot.warnings,
    validation,
  };
  const manifestPath = path.join(snapshotDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const history = await writeSnapshotHistory({ snapshotsRoot, outRoot, hours: 48 });

  return {
    snapshot,
    snapshotDir,
    snapshotPath,
    manifestPath,
    manifest,
    history,
  };
}

export async function buildReviewBundle(options = {}) {
  const snapshotResult = await exportEvaluationSnapshot(options);
  const outRoot = path.resolve(options.outDir ?? path.join(path.resolve(options.dataRoot ?? defaultDataRoot()), "gpt-review-packets"));
  const generatedAt = snapshotResult.snapshot.generatedAt;
  const bundleId = `dogeedge-review-bundle-${compactIso(new Date(generatedAt))}`;
  const bundleRoot = path.join(outRoot, "bundles", bundleId);
  const bundlePath = `${bundleRoot}.zip`;
  const bundleHours = numberOption(options.bundleHours, 2);
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(path.join(bundleRoot, "snapshots"), { recursive: true });
  await mkdir(path.join(bundleRoot, "repo"), { recursive: true });
  await mkdir(path.join(bundleRoot, "registry"), { recursive: true });

  const latestSnapshotDirs = await latestNamedDirs(path.join(outRoot, "snapshots"), Math.max(1, Math.ceil((bundleHours * 60) / numberOption(options.windowMinutes, 30))));
  const bundleFiles = [];
  for (const dir of latestSnapshotDirs) {
    const files = await readdir(dir).catch(() => []);
    for (const name of files) {
      if (name.endsWith(".json.gz")) {
        const target = path.join(bundleRoot, "snapshots", name);
        await copyFile(path.join(dir, name), target);
        bundleFiles.push(await fileInfo(target, name, path.relative(bundleRoot, target), null));
      }
    }
  }
  for (const name of [
    "algoMetrics.tsv.gz",
    "foldMetrics.tsv.gz",
    "decisionAggregates.tsv.gz",
    "tradeAggregates.tsv.gz",
    "warnings.tsv.gz",
    "decisionRows.tsv.gz",
    "tradeRows.tsv.gz",
    "decision_frames.jsonl",
    "trades.csv",
    "paper_decision_ledger.csv",
  ]) {
    const source = path.join(snapshotResult.snapshotDir, name);
    if (await exists(source)) {
      const target = path.join(bundleRoot, "snapshots", name);
      await copyFile(source, target);
      bundleFiles.push(await fileInfo(target, name, path.relative(bundleRoot, target), null));
    }
  }
  const rawTicksManifest = path.join(snapshotResult.snapshotDir, "raw_market_ticks", "manifest.json");
  if (await exists(rawTicksManifest)) {
    const target = path.join(bundleRoot, "snapshots", "raw_market_ticks", "manifest.json");
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(rawTicksManifest, target);
    bundleFiles.push(await fileInfo(target, "raw_market_ticks/manifest.json", path.relative(bundleRoot, target), null));
  }
  const rawTicksSchema = path.join(snapshotResult.snapshotDir, "raw_market_ticks", "schema.json");
  if (await exists(rawTicksSchema)) {
    const target = path.join(bundleRoot, "snapshots", "raw_market_ticks", "schema.json");
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(rawTicksSchema, target);
    bundleFiles.push(await fileInfo(target, "raw_market_ticks/schema.json", path.relative(bundleRoot, target), null));
  }
  for (const name of ["snapshot-history-48h.json", "snapshot-history-48h.md"]) {
    const source = path.join(outRoot, name);
    if (await exists(source)) {
      const target = path.join(bundleRoot, "snapshots", name);
      await copyFile(source, target);
      bundleFiles.push(await fileInfo(target, name, path.relative(bundleRoot, target), null));
    }
  }

  const repoFiles = await copyRepoBundle({ bundleRoot, options });
  bundleFiles.push(...repoFiles);
  const registryFile = await writeRegistryTarball({ bundleRoot, options, snapshot: snapshotResult.snapshot });
  if (registryFile) bundleFiles.push(registryFile);

  const manifest = {
    schemaVersion: "dogeedge.eval.review.bundle.v1",
    bundleId,
    generatedAt,
    snapshotId: snapshotResult.snapshot.snapshotId,
    snapshotCount: latestSnapshotDirs.length,
    bundleHours,
    safetyStatus: snapshotResult.snapshot.appState.liveSafety,
    alerts: snapshotResult.snapshot.alerts,
    files: bundleFiles,
    notes: [
      "Local-only review bundle. No external uploads were performed by DogeEdge.",
      "Absolute paths are replaced by _REPO_ROOT_ and _DATA_ROOT_ in JSON metadata.",
      "Row-level extracts are capped by --max-row-lines unless explicitly increased.",
    ],
  };
  await writeFile(path.join(bundleRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const zipped = await zipDirectory(bundleRoot, bundlePath);
  return {
    ...snapshotResult,
    bundleRoot,
    bundlePath: zipped ? bundlePath : null,
    bundleManifest: manifest,
  };
}

export function validateEvaluationSnapshot(snapshot) {
  const errors = [];
  for (const key of [
    "schemaVersion",
    "snapshotId",
    "generatedAt",
    "sourceTimezone",
    "window",
    "repo",
    "timestampSemantics",
    "appState",
    "dataQuality",
    "experimentRegistry",
    "costModels",
    "simulatorAssumptions",
    "foldDefinitions",
    "algoRollup",
    "decisionAggregates",
    "tradeAggregates",
    "warnings",
    "filesManifest",
  ]) {
    if (snapshot?.[key] === undefined) errors.push(`missing ${key}`);
  }
  if (snapshot?.schemaVersion !== schemaVersion) errors.push("wrong schemaVersion");
  if (snapshot?.timestampSemantics?.allTimestampsUtc !== true) errors.push("timestamps must be UTC");
  if (snapshot?.appState?.liveSafety?.liveTradingEnabled !== false) errors.push("live trading must remain disabled in review snapshot");
  if (snapshot?.appState?.liveSafety?.manualApprovalRequired !== true) errors.push("manual approval flag must be true");
  if (!Array.isArray(snapshot?.algoRollup)) errors.push("algoRollup must be an array");
  if (!Array.isArray(snapshot?.filesManifest) || snapshot.filesManifest.length === 0) errors.push("filesManifest must not be empty");
  if (!snapshot?.experimentRegistry?.randomSeed) errors.push("random seed is required");
  if (!snapshot?.experimentRegistry?.configHash) errors.push("config hash is required");
  return { ok: errors.length === 0, errors };
}

function choosePrimaryRun(latestSweep, latestBacktest) {
  if (latestSweep?.runId) return latestSweep;
  return latestBacktest?.runId ? latestBacktest : {};
}

function selectMetrics(primaryRun, maxMetrics) {
  const metrics = Array.isArray(primaryRun?.topMetrics)
    ? primaryRun.topMetrics
    : Array.isArray(primaryRun?.metrics) ? primaryRun.metrics : [];
  return metrics.slice(0, maxMetrics);
}

function algoRollupRow(metric, context) {
  const topStat = topStatForMetric(context.topStats, metric);
  const paperEvidence = metric.paperEvidence ?? {};
  const drift = metric.drift ?? paperEvidence;
  const telemetry = metric.executionTelemetry?.conservative ?? metric.executionTelemetry?.base ?? {};
  const displayId = displayIdFromMetric(metric, topStat);
  return {
    algoId: metric.algoId,
    displayId,
    algoName: metric.algoName ?? metric.name ?? metric.algoId,
    family: metric.family ?? topStat?.family ?? "unknown",
    batchId: batchIdFromAlgo(metric.algoId ?? topStat?.sourceAlgoId),
    lineageGeneration: metric.params?.generation ?? "",
    lineageParentIdsJson: jsonCell(metric.params?.parentIds ?? []),
    status: topStat ? "active_or_tracked" : metric.nonPromotable ? "research_only" : "factory_metric",
    enabled: Boolean(topStat),
    slot: slotFromMetric(metric, topStat),
    promotionStage: metric.promotionStage ?? "research_candidate",
    promotionVerdict: metric.promotionVerdict ?? "insufficient_data",
    labelSource: metric.labelSource ?? metric.settlementEvidence?.labelSource ?? "unknown",
    settlementSource: metric.settlementSource ?? metric.settlementEvidence?.settlementSource ?? "unknown",
    officialResolutionAvailable: metric.officialResolutionAvailable === true || metric.settlementEvidence?.officialResolutionAvailable === true,
    officialSettlementCoverage: numberOrNull(metric.officialSettlementCoverage ?? metric.settlementEvidence?.officialSettlementCoverage) ?? 0,
    warningCodes: metric.warnings ?? metric.warningCodes ?? [],
    reasonCodes: metric.reasonCodes ?? [],
    sampleSize: {
      closedTrades: numberOrZero(metric.closed),
      independentClosedMarkets: numberOrZero(metric.independentClosedMarkets),
      daysRepresented: numberOrZero(metric.daysRepresented),
      decisionCount: numberOrZero(topStat?.signals),
      attemptCount: numberOrZero(topStat?.attempts),
    },
    performance: {
      wins: numberOrZero(metric.wins),
      losses: numberOrZero(metric.losses),
      winRate: numberOrNull(metric.winRate),
      averagePnl: numberOrNull(metric.averagePnl),
      totalPnl: numberOrNull(metric.totalPnl),
      totalCost: numberOrNull(metric.totalCost),
      roi: numberOrNull(metric.roi),
      conservativeTotalPnl: numberOrNull(metric.conservativeTotalPnl ?? metric.costModels?.conservative?.totalPnl),
      stressTotalPnl: numberOrNull(metric.stressTotalPnl ?? metric.costModels?.stress?.totalPnl),
      maxDrawdown: numberOrNull(metric.maxDrawdown),
      downsideDeviation: numberOrNull(metric.downsideDeviation),
      profitFactor: numberOrNull(metric.profitFactor),
      robustScore: numberOrNull(metric.robustScore),
    },
    validation: {
      psr: numberOrNull(metric.psr),
      dsrApprox: numberOrNull(metric.dsrApprox),
      pboApprox: numberOrNull(metric.pboApprox),
      familyAdjustedPValue: numberOrNull(metric.familyAdjustedPValue),
      globalAdjustedPValue: numberOrNull(metric.globalAdjustedPValue),
      falseDiscoveryRisk: numberOrNull(metric.falseDiscoveryRisk),
      adjustedConfidence: numberOrNull(metric.adjustedConfidence),
      foldPositiveRate: numberOrNull(metric.foldSummary?.positiveFoldRate ?? metric.foldSummary?.foldConsistency),
      cpcvPositiveRate: numberOrNull(metric.cpcvSummary?.positiveFoldRate),
      walkForwardPass: Boolean(metric.walkForwardPass),
      walkForwardClosed: numberOrZero(metric.walkForwardClosed),
      walkForwardTotalPnl: numberOrNull(metric.walkForwardTotalPnl),
      walkForwardRoi: numberOrNull(metric.walkForwardRoi),
      holdoutPass: Boolean(metric.holdoutPass),
      holdoutClosed: numberOrZero(metric.holdoutClosed ?? metric.holdoutSummary?.holdoutClosed),
      holdoutConservativeMarkets: numberOrZero(metric.holdoutSummary?.holdoutConservativeMarkets ?? metric.holdoutSummary?.holdoutMarkets),
      holdoutConservativeTotalPnl: numberOrNull(metric.holdoutConservativeTotalPnl ?? metric.holdoutSummary?.holdoutConservativeTotalPnl),
      holdoutLowerCi: numberOrNull(metric.holdoutLowerCi ?? metric.holdoutSummary?.holdoutLowerCi),
    },
    paperEvidence: {
      available: Boolean(paperEvidence.available),
      closedMarkets: numberOrZero(paperEvidence.closedMarkets),
      closedTrades: numberOrZero(paperEvidence.closedTrades),
      totalPnl: numberOrNull(paperEvidence.totalPnl),
      roi: numberOrNull(paperEvidence.roi),
    },
    drift: {
      driftOk: drift.driftOk !== false,
      driftScore: numberOrNull(drift.driftScore) ?? 0,
      driftReasons: Array.isArray(drift.driftReasons) ? drift.driftReasons : [],
    },
    execution: {
      avgSlippageCents: numberOrNull(telemetry.averageSlippageCents ?? metric.averageSlippageCents) ?? 0,
      avgPartialFillRatio: numberOrNull(telemetry.averagePartialFillRatio ?? metric.averagePartialFillRatio) ?? 0,
      avgFillProbability: numberOrNull(telemetry.averageFillProbability ?? metric.averageFillProbability) ?? 0,
      avgFillDepthUtilization: numberOrNull(telemetry.averageFillDepthUtilization ?? metric.averageFillDepthUtilization) ?? 0,
      staleQuoteRejections: numberOrZero(telemetry.staleQuoteRejections),
      queueMisses: numberOrZero(telemetry.queueMisses),
      depthRejections: numberOrZero(telemetry.depthRejections),
    },
    warningCodes: metric.warnings ?? metric.warningCodes ?? [],
    reasonCodes: metric.reasonCodes ?? [],
    nonPromotable: Boolean(metric.nonPromotable),
    sourceRunId: context.sourceRunId,
    sourceSnapshotHash: context.sourceSnapshotHash,
  };
}

function flattenAlgoMetrics(row) {
  return {
    snapshotId: row.snapshotId,
    windowStartAt: row.windowStartAt,
    windowEndAt: row.windowEndAt,
    algoId: row.algoId,
    displayId: row.displayId,
    algoName: row.algoName,
    family: row.family,
    batchId: row.batchId,
    lineageGeneration: row.lineageGeneration,
    lineageParentIdsJson: row.lineageParentIdsJson,
    status: row.status,
    enabled: row.enabled,
    slot: row.slot,
    promotionStage: row.promotionStage,
    promotionVerdict: row.promotionVerdict,
    labelSource: row.labelSource,
    settlementSource: row.settlementSource,
    officialResolutionAvailable: row.officialResolutionAvailable,
    officialSettlementCoverage: row.officialSettlementCoverage,
    warningCodesJson: jsonCell(row.warningCodes),
    reasonCodesJson: jsonCell(row.reasonCodes),
    closed: row.sampleSize.closedTrades,
    independentClosedMarkets: row.sampleSize.independentClosedMarkets,
    daysRepresented: row.sampleSize.daysRepresented,
    wins: row.performance.wins,
    losses: row.performance.losses,
    winRate: row.performance.winRate,
    averagePnl: row.performance.averagePnl,
    totalPnl: row.performance.totalPnl,
    totalCost: row.performance.totalCost,
    roi: row.performance.roi,
    conservativeTotalPnl: row.performance.conservativeTotalPnl,
    stressTotalPnl: row.performance.stressTotalPnl,
    maxDrawdown: row.performance.maxDrawdown,
    downsideDeviation: row.performance.downsideDeviation,
    profitFactor: row.performance.profitFactor,
    psr: row.validation.psr,
    dsrApprox: row.validation.dsrApprox,
    pboApprox: row.validation.pboApprox,
    familyAdjustedPValue: row.validation.familyAdjustedPValue,
    globalAdjustedPValue: row.validation.globalAdjustedPValue,
    falseDiscoveryRisk: row.validation.falseDiscoveryRisk,
    adjustedConfidence: row.validation.adjustedConfidence,
    robustScore: row.performance.robustScore,
    foldPositiveRate: row.validation.foldPositiveRate,
    cpcvPositiveRate: row.validation.cpcvPositiveRate,
    walkForwardPass: row.validation.walkForwardPass,
    walkForwardClosed: row.validation.walkForwardClosed,
    walkForwardTotalPnl: row.validation.walkForwardTotalPnl,
    walkForwardRoi: row.validation.walkForwardRoi,
    holdoutPass: row.validation.holdoutPass,
    holdoutClosed: row.validation.holdoutClosed,
    holdoutConservativeMarkets: row.validation.holdoutConservativeMarkets,
    holdoutConservativeTotalPnl: row.validation.holdoutConservativeTotalPnl,
    holdoutLowerCi: row.validation.holdoutLowerCi,
    paperEvidenceAvailable: row.paperEvidence.available,
    paperClosedMarkets: row.paperEvidence.closedMarkets,
    paperClosedTrades: row.paperEvidence.closedTrades,
    paperTotalPnl: row.paperEvidence.totalPnl,
    paperRoi: row.paperEvidence.roi,
    driftOk: row.drift.driftOk,
    driftScore: row.drift.driftScore,
    driftReasonsJson: jsonCell(row.drift.driftReasons),
    avgSlippageCents: row.execution.avgSlippageCents,
    avgPartialFillRatio: row.execution.avgPartialFillRatio,
    avgFillProbability: row.execution.avgFillProbability,
    avgFillDepthUtilization: row.execution.avgFillDepthUtilization,
    sourceRunId: row.sourceRunId,
    sourceSnapshotHash: row.sourceSnapshotHash,
  };
}

function decisionAggregateRows({ snapshotId, windowStartAt, windowEndAt, topStats, metricByAlgoId }) {
  return Object.values(topStats).map((stat) => {
    const metric = metricByAlgoId.get(stat.sourceAlgoId) ?? metricByAlgoId.get(stat.algoId) ?? {};
    const attempts = numberOrZero(stat.attempts);
    return {
      snapshotId,
      windowStartAt,
      windowEndAt,
      algoId: stat.sourceAlgoId ?? stat.algoId ?? "",
      displayId: stat.displayId ?? displayIdFromMetric(metric, stat),
      family: stat.family ?? metric.family ?? "",
      promotionStage: metric.promotionStage ?? "dry_run_evidence",
      promotionVerdict: metric.promotionVerdict ?? "dry_run_evidence_only",
      marketCount: numberOrZero(metric.independentClosedMarkets),
      independentMarketCount: numberOrZero(metric.independentClosedMarkets),
      decisionCount: numberOrZero(stat.signals),
      signalCount: numberOrZero(stat.signals),
      attemptCount: attempts,
      acceptedBuys: numberOrZero(stat.acceptedBuys),
      acceptRate: attempts ? numberOrZero(stat.acceptedBuys) / attempts : 0,
      buySignals: numberOrZero(stat.buys),
      exitSignals: numberOrZero(stat.sells),
      skipSignals: Math.max(0, numberOrZero(stat.signals) - attempts),
      rejectCount: numberOrZero(stat.rejected),
      staleRejects: numberOrZero(stat.staleRejects),
      edgeRejects: numberOrZero(stat.edgeRejects),
      depthRejects: numberOrZero(stat.depthRejects),
      gateRejects: numberOrZero(stat.gateRejects),
      priceRejects: numberOrZero(stat.priceRejects),
      otherRejects: numberOrZero(stat.otherRejects),
      featureTimestampMin: stat.startedAt ?? "",
      featureTimestampMax: stat.lastSignalAt ?? "",
      decisionTimestampMin: stat.startedAt ?? "",
      decisionTimestampMax: stat.lastAttemptAt ?? stat.lastSignalAt ?? "",
      regimeTimeToClose: "",
      regimeSpread: "",
      regimeLiquidity: "",
      regimeVolatility: "",
      regimeMomentum: "",
      regimeDistance: "",
      warningCodesJson: jsonCell(metric.warnings ?? []),
    };
  });
}

function tradeAggregateRows({ snapshotId, windowStartAt, windowEndAt, metrics, topStats }) {
  return metrics.map((metric) => {
    const stat = topStatForMetric(topStats, metric);
    return {
      snapshotId,
      windowStartAt,
      windowEndAt,
      algoId: metric.algoId,
      displayId: displayIdFromMetric(metric, stat),
      family: metric.family ?? stat?.family ?? "",
      promotionStage: metric.promotionStage ?? "research_candidate",
      promotionVerdict: metric.promotionVerdict ?? "insufficient_data",
      openedCount: numberOrZero(metric.closed) + numberOrZero(metric.open),
      closedCount: numberOrZero(metric.closed),
      openCount: numberOrZero(metric.open),
      independentClosedMarkets: numberOrZero(metric.independentClosedMarkets),
      wins: numberOrZero(metric.wins),
      losses: numberOrZero(metric.losses),
      totalContracts: numberOrZero(metric.turnover),
      totalFees: numberOrZero(metric.totalFees ?? metric.feesPaid),
      totalCost: numberOrZero(metric.totalCost),
      totalPnl: numberOrNull(metric.totalPnl) ?? 0,
      roi: numberOrNull(metric.roi) ?? 0,
      averagePnl: numberOrNull(metric.averagePnl) ?? 0,
      maxDrawdown: numberOrNull(metric.maxDrawdown) ?? 0,
      averageHoldingSeconds: numberOrNull(metric.exposureSeconds) ?? "",
      averageEntryPrice: numberOrNull(metric.averageEntryPrice) ?? "",
      averageExitPrice: numberOrNull(metric.averageExitPrice) ?? "",
      averageSlippageCents: numberOrNull(metric.averageSlippageCents ?? metric.executionTelemetry?.conservative?.averageSlippageCents) ?? 0,
      averageFillProbability: numberOrNull(metric.averageFillProbability ?? metric.executionTelemetry?.conservative?.averageFillProbability) ?? 0,
      averagePartialFillRatio: numberOrNull(metric.averagePartialFillRatio ?? metric.executionTelemetry?.conservative?.averagePartialFillRatio) ?? 0,
      staleQuoteRejections: numberOrZero(metric.executionTelemetry?.conservative?.staleQuoteRejections),
      queueMisses: numberOrZero(metric.executionTelemetry?.conservative?.queueMisses),
      depthRejections: numberOrZero(metric.executionTelemetry?.conservative?.depthRejections),
      regimeTimeToClose: jsonCell(metric.regimeBreakdown?.timeToClose ?? {}),
      regimeSpread: jsonCell(metric.regimeBreakdown?.spread ?? {}),
      regimeLiquidity: jsonCell(metric.regimeBreakdown?.liquidity ?? {}),
      regimeVolatility: jsonCell(metric.regimeBreakdown?.volatility ?? {}),
      regimeMomentum: jsonCell(metric.regimeBreakdown?.momentum ?? {}),
      regimeDistance: jsonCell(metric.regimeBreakdown?.distance ?? {}),
      warningCodesJson: jsonCell(metric.warnings ?? []),
    };
  });
}

function foldDefinitionRows(registry, primaryRun) {
  const rows = [];
  for (const fold of registry.foldDefinitions ?? primaryRun?.purgedFolds ?? []) {
    rows.push(foldDefinitionRow(fold, "purged"));
  }
  for (const fold of registry.cpcvFoldDefinitions ?? primaryRun?.cpcvFolds ?? []) {
    rows.push(foldDefinitionRow(fold, "cpcv"));
  }
  const holdout = registry.holdoutDefinition ?? primaryRun?.holdoutDefinition;
  if (holdout) {
    rows.push({
      id: "holdout",
      kind: "holdout",
      trainEventIdsHash: null,
      validationEventIdsHash: hashEventIds(holdout.holdoutEventIds),
      purgedEventIdsHash: null,
      embargoedEventIdsHash: null,
      embargoMs: null,
      strictlyLater: holdout.strictlyLater === true,
      holdoutEventIdsHash: hashEventIds(holdout.holdoutEventIds),
      reason: holdout.reason ?? null,
    });
  }
  if (primaryRun?.walkForwardFrameCount) {
    rows.push({
      id: "walk-forward",
      kind: "walkForward",
      trainEventIdsHash: null,
      validationEventIdsHash: null,
      purgedEventIdsHash: null,
      embargoedEventIdsHash: null,
      embargoMs: null,
      strictlyLater: true,
    });
  }
  return rows;
}

function foldDefinitionRow(fold, kind) {
  return {
    id: fold.id,
    kind,
    trainEventIdsHash: hashEventIds(fold.trainEventIds),
    validationEventIdsHash: hashEventIds(fold.validationEventIds),
    purgedEventIdsHash: hashEventIds(fold.purgedEventIds),
    embargoedEventIdsHash: hashEventIds(fold.embargoedEventIds),
    embargoMs: numberOrNull(fold.embargoMs),
    strictlyLater: kind === "holdout" ? fold.strictlyLater === true : null,
    trainEventCount: Array.isArray(fold.trainEventIds) ? fold.trainEventIds.length : 0,
    validationEventCount: Array.isArray(fold.validationEventIds) ? fold.validationEventIds.length : 0,
    purgedEventCount: Array.isArray(fold.purgedEventIds) ? fold.purgedEventIds.length : 0,
    embargoedEventCount: Array.isArray(fold.embargoedEventIds) ? fold.embargoedEventIds.length : 0,
  };
}

function foldMetricRows({ snapshotId, metrics, registry, primaryRun }) {
  const definitionById = new Map(foldDefinitionRows(registry, primaryRun).map((fold) => [fold.id, fold]));
  const rows = [];
  for (const metric of metrics) {
    for (const fold of metric.foldMetrics ?? []) {
      rows.push(foldMetricRow(snapshotId, metric.algoId, "purged", fold, definitionById.get(fold.foldId ?? fold.id)));
    }
    for (const fold of metric.cpcvMetrics ?? metric.cpcvPathMetrics ?? []) {
      rows.push(foldMetricRow(snapshotId, metric.algoId, "cpcv", fold, definitionById.get(fold.foldId ?? fold.id)));
    }
    if (metric.walkForwardClosed !== undefined) {
      rows.push({
        snapshotId,
        algoId: metric.algoId,
        foldKind: "walkForward",
        foldId: "walk-forward",
        trainEventIdsHash: "",
        validationEventIdsHash: "",
        purgedEventIdsHash: "",
        embargoedEventIdsHash: "",
        embargoMs: "",
        strictlyLater: true,
        trainEventCount: "",
        validationEventCount: "",
        purgedEventCount: "",
        embargoedEventCount: "",
        closed: numberOrZero(metric.walkForwardClosed),
        independentClosedMarkets: numberOrZero(metric.walkForwardClosed),
        wins: numberOrZero(metric.walkForwardWins),
        losses: numberOrZero(metric.walkForwardLosses),
        winRate: numberOrNull(metric.walkForwardWinRate),
        averagePnl: "",
        totalPnl: numberOrNull(metric.walkForwardTotalPnl),
        totalCost: numberOrNull(metric.walkForwardTotalCost),
        roi: numberOrNull(metric.walkForwardRoi),
        maxDrawdown: numberOrNull(metric.walkForwardMaxDrawdown),
        lowerCi: "",
        upperCi: "",
        pass: Boolean(metric.walkForwardPass),
      });
    }
    if (metric.holdoutSummary || metric.holdoutClosed !== undefined) {
      rows.push({
        snapshotId,
        algoId: metric.algoId,
        foldKind: "holdout",
        foldId: "holdout",
        trainEventIdsHash: "",
        validationEventIdsHash: definitionById.get("holdout")?.holdoutEventIdsHash ?? "",
        purgedEventIdsHash: "",
        embargoedEventIdsHash: "",
        embargoMs: "",
        strictlyLater: metric.holdoutStrictlyLater ?? metric.holdoutSummary?.strictlyLater ?? true,
        trainEventCount: "",
        validationEventCount: metric.holdoutSummary?.holdoutMarkets ?? "",
        purgedEventCount: "",
        embargoedEventCount: "",
        closed: numberOrZero(metric.holdoutClosed ?? metric.holdoutSummary?.holdoutClosed),
        independentClosedMarkets: numberOrZero(metric.holdoutSummary?.holdoutMarkets ?? metric.holdoutClosed),
        wins: "",
        losses: "",
        winRate: "",
        averagePnl: "",
        totalPnl: numberOrNull(metric.holdoutConservativeTotalPnl ?? metric.holdoutSummary?.holdoutConservativeTotalPnl),
        totalCost: "",
        roi: numberOrNull(metric.holdoutSummary?.holdoutConservativeRoi ?? metric.holdoutRoi),
        maxDrawdown: numberOrNull(metric.holdoutMaxDrawdown),
        lowerCi: numberOrNull(metric.holdoutLowerCi ?? metric.holdoutSummary?.holdoutLowerCi),
        upperCi: "",
        pass: Boolean(metric.holdoutPass),
      });
    }
  }
  return rows;
}

function foldMetricRow(snapshotId, algoId, kind, fold, definition = {}) {
  return {
    snapshotId,
    algoId,
    foldKind: kind,
    foldId: fold.foldId ?? fold.id,
    trainEventIdsHash: definition.trainEventIdsHash ?? "",
    validationEventIdsHash: definition.validationEventIdsHash ?? "",
    purgedEventIdsHash: definition.purgedEventIdsHash ?? "",
    embargoedEventIdsHash: definition.embargoedEventIdsHash ?? "",
    embargoMs: definition.embargoMs ?? "",
    strictlyLater: definition.strictlyLater ?? "",
    trainEventCount: definition.trainEventCount ?? "",
    validationEventCount: definition.validationEventCount ?? "",
    purgedEventCount: definition.purgedEventCount ?? "",
    embargoedEventCount: definition.embargoedEventCount ?? "",
    closed: numberOrZero(fold.closed),
    independentClosedMarkets: numberOrZero(fold.independentClosedMarkets ?? fold.closed),
    wins: numberOrZero(fold.wins),
    losses: numberOrZero(fold.losses),
    winRate: numberOrNull(fold.winRate),
    averagePnl: numberOrNull(fold.averagePnl),
    totalPnl: numberOrNull(fold.totalPnl),
    totalCost: numberOrNull(fold.totalCost),
    roi: numberOrNull(fold.roi),
    maxDrawdown: numberOrNull(fold.maxDrawdown),
    lowerCi: numberOrNull(fold.lowerCi ?? fold.bootstrap?.meanPnl?.lower),
    upperCi: numberOrNull(fold.upperCi ?? fold.bootstrap?.meanPnl?.upper),
    pass: (fold.totalPnl ?? 0) > 0,
  };
}

async function readDecisionRows({ dataRoot, snapshotId, maxRowLines }) {
  const framesDir = path.join(dataRoot, "features", "decision-frames");
  const files = await latestFilesRecursive(framesDir, [".jsonl", ".ndjson"], 3);
  const rows = [];
  for (const file of files) {
    const hash = await hashFileMaybe(file);
    const lines = await readTailLines(file, Math.max(1, Math.ceil(maxRowLines / Math.max(1, files.length))));
    lines.forEach((line, index) => {
      const parsed = parseJsonLine(line);
      if (!parsed) return;
      rows.push(decisionRowFromFrame(parsed, { snapshotId, sourceFileHash: hash, sourceLine: index + 1 }));
    });
  }
  return rows.slice(-maxRowLines);
}

function decisionRowFromFrame(frame, context) {
  const marketTicker = frame.marketTicker ?? frame.market_id ?? frame.marketId ?? "";
  const observedAt = frame.observedAt ?? frame.frame_timestamp_utc ?? frame.featureTimestamp ?? "";
  const capturedAt = frame.capturedAt ?? observedAt;
  const marketClose = frame.marketCloseTimestamp ?? frame.marketCloseTime ?? frame.market_close_timestamp_utc ?? "";
  return {
    snapshotId: context.snapshotId,
    rowId: frame.id ?? frame.frame_id ?? `${marketTicker}:${observedAt}`,
    marketTicker,
    algoId: frame.strategyId ?? frame.strategy_id ?? "",
    displayId: displayIdFromAlgo(frame.strategyId ?? frame.strategy_id ?? ""),
    family: frame.family ?? "",
    featureTimestamp: frame.featureTimestamp ?? frame.feature_timestamps?.estimate ?? observedAt,
    decisionTimestamp: frame.decisionTimestamp ?? observedAt,
    labelTimestamp: frame.labelTimestamp ?? frame.label_timestamp_utc ?? marketClose,
    settlementTimestamp: frame.settlementTimestamp ?? frame.label_timestamp_utc ?? marketClose,
    labelSource: frame.labelSource ?? frame.label_source ?? "unknown",
    settlementSource: frame.settlementSource ?? "estimated",
    officialResolutionAvailable: frame.officialResolutionAvailable === true || frame.settlementSource === "official_resolution",
    marketCloseTimestamp: marketClose,
    side: sideFromAction(frame.modelAction ?? frame.decisionAction),
    decisionAction: frame.modelAction ?? frame.decisionAction ?? "",
    attempted: Boolean(frame.attempted ?? false),
    accepted: Boolean(frame.accepted ?? false),
    rejectCode: frame.rejectCode ?? "",
    rejectMessage: frame.rejectMessage ?? "",
    observedAt,
    capturedAt,
    secondsToClose: numberOrNull(frame.secondsToClose ?? frame.feature_map?.secondsToClose),
    targetPrice: numberOrNull(frame.targetPrice ?? frame.feature_map?.targetPrice),
    estimate: numberOrNull(frame.estimate ?? frame.feature_map?.estimate),
    spotPrice: numberOrNull(frame.spotPrice ?? frame.feature_map?.spotPrice),
    oneMinuteChange: numberOrNull(frame.oneMinuteChange),
    oneMinuteMovePercent: numberOrNull(frame.oneMinuteMovePercent),
    distanceFromTarget: numberOrNull(frame.distanceFromTarget),
    fairProbability: numberOrNull(frame.fairProbability),
    modelAction: frame.modelAction ?? "",
    modelConfidence: numberOrNull(frame.modelConfidence),
    modelEdgeAfterFees: numberOrNull(frame.modelEdgeAfterFees),
    yesBid: numberOrNull(frame.yesBid ?? frame.feature_map?.yesBid),
    yesAsk: numberOrNull(frame.yesAsk ?? frame.feature_map?.yesAsk),
    noBid: numberOrNull(frame.noBid ?? frame.feature_map?.noBid),
    noAsk: numberOrNull(frame.noAsk ?? frame.feature_map?.noAsk),
    yesSpread: numberOrNull(frame.yesSpread),
    noSpread: numberOrNull(frame.noSpread),
    yesBidDepth: numberOrNull(frame.yesTopDepth?.bidSize ?? frame.yesBidDepth),
    yesAskDepth: numberOrNull(frame.yesTopDepth?.askSize ?? frame.yesAskDepth),
    noBidDepth: numberOrNull(frame.noTopDepth?.bidSize ?? frame.noBidDepth),
    noAskDepth: numberOrNull(frame.noTopDepth?.askSize ?? frame.noAskDepth),
    regimeTimeToClose: frame.regime?.timeToClose ?? frame.regime_tags?.timeToClose ?? "",
    regimeSpread: frame.regime?.spread ?? frame.regime_tags?.spread ?? "",
    regimeLiquidity: frame.regime?.liquidity ?? frame.regime_tags?.liquidity ?? "",
    regimeVolatility: frame.regime?.volatility ?? frame.regime_tags?.volatility ?? "",
    regimeMomentum: frame.regime?.momentum ?? frame.regime_tags?.momentum ?? "",
    regimeDistance: frame.regime?.distance ?? frame.regime_tags?.distance ?? "",
    regimePhase: frame.regime?.phase ?? frame.regime_tags?.phase ?? "",
    independentKey: marketTicker,
    overlapCount: numberOrZero(frame.overlapCount),
    sourceFileHash: context.sourceFileHash,
    sourceLine: context.sourceLine,
  };
}

async function readTradeRows({ filePath, snapshotId, maxRowLines, metricByAlgoId, sourceRunId, sourceSnapshotHash }) {
  const lines = await readTailLines(filePath, maxRowLines);
  return lines.map((line) => parseJsonLine(line))
    .filter(Boolean)
    .map((trade) => tradeRowFromPaperTrade(trade, { snapshotId, metricByAlgoId, sourceRunId, sourceSnapshotHash }));
}

function tradeRowFromPaperTrade(trade, context) {
  const rawAlgoId = trade.strategyId ?? trade.algoId ?? "";
  const algoId = rawAlgoId.startsWith("generated:") ? rawAlgoId.slice("generated:".length) : rawAlgoId;
  const metric = context.metricByAlgoId.get(algoId) ?? context.metricByAlgoId.get(rawAlgoId) ?? {};
  return {
    snapshotId: context.snapshotId,
    tradeId: trade.id ?? trade.tradeId ?? "",
    marketTicker: trade.marketTicker ?? trade.market_id ?? "",
    algoId,
    displayId: displayIdFromAlgo(algoId),
    family: trade.family ?? metric.family ?? "",
    promotionStage: metric.promotionStage ?? "paper_evidence",
    promotionVerdict: metric.promotionVerdict ?? "dry_run_evidence_only",
    openedAt: trade.openedAt ?? trade.timestamp ?? "",
    closedAt: trade.closedAt ?? "",
    decisionTimestamp: trade.decisionTimestamp ?? trade.openedAt ?? trade.timestamp ?? "",
    featureTimestamp: trade.featureTimestamp ?? trade.openedAt ?? trade.timestamp ?? "",
    labelTimestamp: trade.labelTimestamp ?? trade.closedAt ?? "",
    settlementTimestamp: trade.settlementTimestamp ?? trade.closedAt ?? "",
    labelSource: trade.labelSource ?? trade.entryContext?.labelSource ?? "unknown",
    settlementSource: trade.settlementSource ?? "estimated",
    officialResolutionAvailable: trade.officialResolutionAvailable === true || trade.settlementSource === "official_resolution",
    status: trade.status ?? "",
    side: trade.side ?? "",
    contracts: numberOrZero(trade.contracts ?? trade.size),
    entryPrice: numberOrNull(trade.entryPrice ?? trade.price),
    exitPrice: numberOrNull(trade.exitPrice),
    bestExitPrice: numberOrNull(trade.bestExitPrice),
    feesPaid: numberOrNull(trade.feesPaid),
    pnl: numberOrNull(trade.pnl),
    roiPerTrade: numberOrNull(trade.roi ?? trade.roiPerTrade),
    holdingSeconds: holdingSeconds(trade),
    fillProbability: numberOrNull(trade.fillProbability ?? trade.entryContext?.fillProbability),
    partialFillRatio: numberOrNull(trade.partialFillRatio ?? trade.entryContext?.partialFillRatio),
    slippageCents: numberOrNull(trade.slippageCents ?? trade.entryContext?.slippageCents),
    depthUtilization: numberOrNull(trade.depthUtilization ?? trade.entryContext?.fillDepthUtilization),
    queueMiss: Boolean(trade.queueMiss ?? trade.entryContext?.queueMiss),
    rejectCode: trade.rejectCode ?? "",
    entryReason: trade.entryReason ?? trade.reason ?? "",
    exitReason: trade.exitReason ?? "",
    entryRegimeTimeToClose: trade.entryContext?.regime?.timeToClose ?? "",
    entryRegimeSpread: trade.entryContext?.regime?.spread ?? "",
    entryRegimeLiquidity: trade.entryContext?.regime?.liquidity ?? "",
    entryRegimeVolatility: trade.entryContext?.regime?.volatility ?? "",
    entryRegimeMomentum: trade.entryContext?.regime?.momentum ?? "",
    entryRegimeDistance: trade.entryContext?.regime?.distance ?? "",
    sourceRunId: context.sourceRunId,
    sourceSnapshotHash: context.sourceSnapshotHash,
  };
}

async function writeExactReviewFiles({
  snapshotDir,
  snapshotId,
  dataRoot,
  decisionRows,
  tradeRows,
  topStats,
  metricByAlgoId,
  primaryRun,
  registry,
  gitInfo,
  sourceRunId,
  sourceSnapshotHash,
}) {
  const files = [];
  const decisionFramesPath = path.join(snapshotDir, "decision_frames.jsonl");
  const tradeCsvPath = path.join(snapshotDir, "trades.csv");
  const ledgerCsvPath = path.join(snapshotDir, "paper_decision_ledger.csv");

  await writeFile(
    decisionFramesPath,
    decisionRows.map(decisionFrameJsonLine).join("\n") + (decisionRows.length ? "\n" : ""),
    "utf8",
  );
  files.push(await fileInfo(decisionFramesPath, "decision_frames.jsonl", "decision_frames.jsonl", decisionRows.length));

  await writeFile(tradeCsvPath, csv(tradeRowsColumns, tradeRows), "utf8");
  files.push(await fileInfo(tradeCsvPath, "trades.csv", "trades.csv", tradeRows.length));

  const ledgerRows = paperDecisionLedgerRows({
    snapshotId,
    decisionRows,
    tradeRows,
    topStats,
    metricByAlgoId,
    sourceRunId,
    sourceSnapshotHash,
    gitCommit: gitInfo.commitHash ?? primaryRun?.gitCommit ?? registry?.gitCommit ?? "UNAVAILABLE",
    dataHash: registry?.dataHash ?? registry?.inputManifestHash ?? primaryRun?.dataHash ?? "UNAVAILABLE",
    configHash: registry?.configHash ?? primaryRun?.configHash ?? "UNAVAILABLE",
  });
  await writeFile(ledgerCsvPath, csv(paperDecisionLedgerColumns, ledgerRows), "utf8");
  files.push(await fileInfo(ledgerCsvPath, "paper_decision_ledger.csv", "paper_decision_ledger.csv", ledgerRows.length));

  files.push(...await writeRawMarketTicksManifest({ snapshotDir, dataRoot, snapshotId, gitInfo }));
  return files;
}

function snapshotSettlementSource(metrics) {
  if (!Array.isArray(metrics) || metrics.length === 0) return "estimated";
  const sources = new Set(metrics.map((metric) => metric.settlementSource ?? metric.settlementEvidence?.settlementSource ?? "unknown"));
  if (sources.size === 1) return [...sources][0];
  if (sources.has("official_resolution")) return "mixed";
  if (sources.has("estimated")) return "estimated";
  return "unknown";
}

function decisionFrameJsonLine(row) {
  return JSON.stringify({
    snapshot_id: row.snapshotId,
    row_id: row.rowId,
    source_file_hash: row.sourceFileHash,
    source_line: row.sourceLine,
    captured_at: row.capturedAt,
    observed_at: row.observedAt,
    feature_timestamp: row.featureTimestamp,
    decision_timestamp: row.decisionTimestamp,
    label_timestamp: row.labelTimestamp,
    settlement_timestamp: row.settlementTimestamp,
    label_source: row.labelSource,
    settlement_source: row.settlementSource,
    official_resolution_available: row.officialResolutionAvailable,
    market_close_timestamp: row.marketCloseTimestamp,
    market_ticker: row.marketTicker,
    target_price: row.targetPrice,
    estimate: row.estimate,
    spot_price: row.spotPrice,
    distance_from_target: row.distanceFromTarget,
    one_minute_change: row.oneMinuteChange,
    seconds_to_close: row.secondsToClose,
    yes_bid: row.yesBid,
    yes_ask: row.yesAsk,
    no_bid: row.noBid,
    no_ask: row.noAsk,
    yes_bid_depth: row.yesBidDepth,
    yes_ask_depth: row.yesAskDepth,
    no_bid_depth: row.noBidDepth,
    no_ask_depth: row.noAskDepth,
    decision_action: row.decisionAction,
    side: row.side,
    attempted: row.attempted,
    accepted: row.accepted,
    reject_code: row.rejectCode,
    reject_message: row.rejectMessage,
    model_edge_after_fees: row.modelEdgeAfterFees,
    regime: {
      time_to_close: row.regimeTimeToClose,
      spread: row.regimeSpread,
      liquidity: row.regimeLiquidity,
      volatility: row.regimeVolatility,
      momentum: row.regimeMomentum,
      distance: row.regimeDistance,
      phase: row.regimePhase,
    },
    independent_key: row.independentKey,
    overlap_count: row.overlapCount,
  });
}

function paperDecisionLedgerRows(context) {
  return [
    ...ledgerRowsFromDecisionRows(context),
    ...ledgerRowsFromTradeRows(context),
    ...ledgerRowsFromTopStats(context),
  ].sort((left, right) => String(left.decisionTimestamp).localeCompare(String(right.decisionTimestamp))
    || String(left.algoId).localeCompare(String(right.algoId))
    || String(left.eventId).localeCompare(String(right.eventId)));
}

function ledgerRowsFromDecisionRows(context) {
  return context.decisionRows.map((row) => ({
    snapshotId: context.snapshotId,
    eventId: row.rowId,
    eventType: row.accepted ? "decision_accept" : row.rejected || row.rejectCode ? "decision_reject" : row.attempted ? "decision_attempt" : "decision_observed",
    marketTicker: row.marketTicker,
    algoId: row.algoId,
    displayId: row.displayId,
    family: row.family,
    promotionStage: metricForLedger(context, row.algoId).promotionStage ?? "paper_decision_ledger",
    promotionVerdict: metricForLedger(context, row.algoId).promotionVerdict ?? "dry_run_evidence_only",
    decisionTimestamp: row.decisionTimestamp,
    featureTimestamp: row.featureTimestamp,
    marketCloseTimestamp: row.marketCloseTimestamp,
    labelTimestamp: row.labelTimestamp,
    settlementTimestamp: row.settlementTimestamp,
    labelSource: row.labelSource,
    settlementSource: row.settlementSource,
    officialResolutionAvailable: row.officialResolutionAvailable,
    side: row.side,
    expectedEdgeAfterFees: row.modelEdgeAfterFees,
    yesBid: row.yesBid,
    yesAsk: row.yesAsk,
    noBid: row.noBid,
    noAsk: row.noAsk,
    yesBidDepth: row.yesBidDepth,
    yesAskDepth: row.yesAskDepth,
    noBidDepth: row.noBidDepth,
    noAskDepth: row.noAskDepth,
    regimeTimeToClose: row.regimeTimeToClose,
    regimeSpread: row.regimeSpread,
    regimeLiquidity: row.regimeLiquidity,
    regimeVolatility: row.regimeVolatility,
    regimeMomentum: row.regimeMomentum,
    regimeDistance: row.regimeDistance,
    attempted: row.attempted,
    accepted: row.accepted,
    rejected: Boolean(row.rejectCode),
    rejectCode: row.rejectCode,
    rejectMessage: row.rejectMessage,
    fillProbability: "",
    partialFillRatio: "",
    depthUtilization: "",
    queueMiss: "",
    slippageCents: "",
    sourceRunId: context.sourceRunId,
    gitCommit: context.gitCommit,
    dataHash: context.dataHash,
    configHash: context.configHash,
  }));
}

function ledgerRowsFromTradeRows(context) {
  return context.tradeRows.map((row) => ({
    snapshotId: context.snapshotId,
    eventId: row.tradeId,
    eventType: row.status === "rejected" || row.rejectCode ? "paper_trade_reject" : row.status === "closed" ? "paper_trade_close" : "paper_trade_open",
    marketTicker: row.marketTicker,
    algoId: row.algoId,
    displayId: row.displayId,
    family: row.family,
    promotionStage: row.promotionStage,
    promotionVerdict: row.promotionVerdict,
    decisionTimestamp: row.decisionTimestamp,
    featureTimestamp: row.featureTimestamp,
    marketCloseTimestamp: "",
    labelTimestamp: row.labelTimestamp,
    settlementTimestamp: row.settlementTimestamp,
    labelSource: row.labelSource,
    settlementSource: row.settlementSource,
    officialResolutionAvailable: row.officialResolutionAvailable,
    side: row.side,
    expectedEdgeAfterFees: "",
    yesBid: "",
    yesAsk: "",
    noBid: "",
    noAsk: "",
    yesBidDepth: "",
    yesAskDepth: "",
    noBidDepth: "",
    noAskDepth: "",
    regimeTimeToClose: row.entryRegimeTimeToClose,
    regimeSpread: row.entryRegimeSpread,
    regimeLiquidity: row.entryRegimeLiquidity,
    regimeVolatility: row.entryRegimeVolatility,
    regimeMomentum: row.entryRegimeMomentum,
    regimeDistance: row.entryRegimeDistance,
    attempted: true,
    accepted: !row.rejectCode,
    rejected: Boolean(row.rejectCode),
    rejectCode: row.rejectCode,
    rejectMessage: "",
    fillProbability: row.fillProbability,
    partialFillRatio: row.partialFillRatio,
    depthUtilization: row.depthUtilization,
    queueMiss: row.queueMiss,
    slippageCents: row.slippageCents,
    sourceRunId: row.sourceRunId,
    gitCommit: context.gitCommit,
    dataHash: context.dataHash,
    configHash: context.configHash,
  }));
}

function ledgerRowsFromTopStats(context) {
  const rows = [];
  for (const [key, stat] of Object.entries(context.topStats)) {
    const sourceAlgoId = stat.sourceAlgoId ?? key;
    const metric = metricForLedger(context, sourceAlgoId);
    const rejected = numberOrZero(stat.rejected);
    const attempts = numberOrZero(stat.attempts);
    if (attempts > 0) {
      rows.push(topStatLedgerRow(context, stat, metric, {
        eventId: `${sourceAlgoId}:attempts`,
        eventType: "top_traders_attempt_summary",
        attempted: true,
        accepted: numberOrZero(stat.acceptedBuys) > 0,
        rejected: false,
        rejectCode: "",
        rejectMessage: "",
      }));
    }
    if (rejected > 0) {
      for (const reason of topStatRejectReasons(stat)) {
        rows.push(topStatLedgerRow(context, stat, metric, {
          eventId: `${sourceAlgoId}:reject:${reason.code}`,
          eventType: "top_traders_reject_summary",
          attempted: true,
          accepted: false,
          rejected: true,
          rejectCode: reason.code,
          rejectMessage: `${reason.count} ${reason.label} reject(s) captured by executable dry-run stats.`,
        }));
      }
    }
  }
  return rows;
}

function topStatLedgerRow(context, stat, metric, fields) {
  const timestamp = stat.lastAttemptAt ?? stat.lastSignalAt ?? stat.startedAt ?? "";
  return {
    snapshotId: context.snapshotId,
    eventId: fields.eventId,
    eventType: fields.eventType,
    marketTicker: stat.marketTicker ?? stat.lastMarketTicker ?? "",
    algoId: stat.sourceAlgoId ?? stat.algoId ?? "",
    displayId: stat.displayId ?? displayIdFromAlgo(stat.sourceAlgoId ?? stat.algoId),
    family: stat.family ?? metric.family ?? "",
    promotionStage: metric.promotionStage ?? "dry_run_evidence",
    promotionVerdict: metric.promotionVerdict ?? "dry_run_evidence_only",
    decisionTimestamp: timestamp,
    featureTimestamp: timestamp,
    marketCloseTimestamp: "",
    labelTimestamp: "",
    settlementTimestamp: "",
    labelSource: metric.labelSource ?? "unknown",
    settlementSource: metric.settlementSource ?? "unknown",
    officialResolutionAvailable: metric.officialResolutionAvailable === true,
    side: "",
    expectedEdgeAfterFees: "",
    yesBid: "",
    yesAsk: "",
    noBid: "",
    noAsk: "",
    yesBidDepth: "",
    yesAskDepth: "",
    noBidDepth: "",
    noAskDepth: "",
    regimeTimeToClose: "",
    regimeSpread: "",
    regimeLiquidity: "",
    regimeVolatility: "",
    regimeMomentum: "",
    regimeDistance: "",
    attempted: fields.attempted,
    accepted: fields.accepted,
    rejected: fields.rejected,
    rejectCode: fields.rejectCode,
    rejectMessage: fields.rejectMessage,
    fillProbability: "",
    partialFillRatio: "",
    depthUtilization: "",
    queueMiss: "",
    slippageCents: "",
    sourceRunId: context.sourceRunId,
    gitCommit: context.gitCommit,
    dataHash: context.dataHash,
    configHash: context.configHash,
  };
}

function topStatRejectReasons(stat) {
  const reasons = [
    ["stale_reject", "stale", stat.staleRejects],
    ["edge_reject", "edge", stat.edgeRejects],
    ["depth_reject", "depth", stat.depthRejects],
    ["gate_reject", "gate", stat.gateRejects],
    ["price_reject", "price", stat.priceRejects],
    ["other_reject", "other", stat.otherRejects],
  ].map(([code, label, count]) => ({ code, label, count: numberOrZero(count) }))
    .filter((reason) => reason.count > 0);
  const known = reasons.reduce((total, reason) => total + reason.count, 0);
  const remaining = Math.max(0, numberOrZero(stat.rejected) - known);
  if (remaining > 0) reasons.push({ code: "reject_unspecified", label: "unspecified", count: remaining });
  return reasons;
}

function metricForLedger(context, algoId) {
  return context.metricByAlgoId.get(algoId)
    ?? context.metricByAlgoId.get(String(algoId ?? "").replace(/^generated:/, ""))
    ?? {};
}

async function writeRawMarketTicksManifest({ snapshotDir, dataRoot, snapshotId, gitInfo }) {
  const dir = path.join(snapshotDir, "raw_market_ticks");
  await mkdir(dir, { recursive: true });
  const schema = {
    schemaVersion: "dogeedge.raw-market-ticks.schema.v1",
    format: "parquet",
    fields: [
      "ts_event",
      "ts_receive",
      "market_ticker",
      "channel",
      "event_type",
      "side",
      "book_side",
      "price",
      "size",
      "level",
      "sequence_number",
      "best_yes_bid",
      "best_yes_ask",
      "best_no_bid",
      "best_no_ask",
      "market_status",
      "source",
      "source_message_hash",
      "snapshot_id",
      "git_commit",
    ],
  };
  const rawSnapshotFiles = await latestFilesRecursive(path.join(dataRoot, "raw", "snapshots"), [".jsonl", ".ndjson", ".json", ".csv"], 10);
  const sources = [];
  for (const file of rawSnapshotFiles) {
    const info = await stat(file).catch(() => null);
    sources.push({
      relativePath: slashPath(path.relative(dataRoot, file)),
      bytes: info?.size ?? 0,
      sha256: info && info.size <= 50 * 1024 * 1024 ? await hashFileMaybe(file) : null,
      hashSkipped: info ? info.size > 50 * 1024 * 1024 : true,
    });
  }
  const manifest = {
    schemaVersion: "dogeedge.raw-market-ticks.manifest.v1",
    snapshotId,
    generatedAt: new Date().toISOString(),
    available: false,
    format: "parquet",
    reason: "Replayable per-market parquet tick export is not present in current local artifacts; schema and source manifest are exported so calibration gaps remain explicit.",
    gitCommit: gitInfo.commitHash ?? "UNAVAILABLE",
    expectedDirectory: "raw_market_ticks/<market_ticker>.parquet",
    sourceSnapshotFiles: sources,
    warningCodes: [
      "raw_market_tick_parquet_absent",
      ...(sources.some((source) => source.hashSkipped) ? ["raw_snapshot_hash_skipped_large_file"] : []),
    ],
  };
  const schemaPath = path.join(dir, "schema.json");
  const manifestPath = path.join(dir, "manifest.json");
  await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return [
    await fileInfo(schemaPath, "raw_market_ticks/schema.json", "raw_market_ticks/schema.json", null),
    await fileInfo(manifestPath, "raw_market_ticks/manifest.json", "raw_market_ticks/manifest.json", null),
  ];
}

function warningRows({ snapshotId, generatedAt, safety, localStoredAt, dataQuality, gitInfo, registry, topStats, includeRows }) {
  const warnings = [];
  const add = (code, severity, message, remediationHint, fields = {}) => {
    warnings.push({
      snapshotId,
      scope: fields.scope ?? "system",
      objectType: fields.objectType ?? "snapshot",
      objectId: fields.objectId ?? snapshotId,
      code,
      severity,
      firstSeenAt: generatedAt,
      lastSeenAt: generatedAt,
      count: fields.count ?? 1,
      message,
      remediationHint,
    });
  };
  if (safety.liveTradingEnabled || !safety.dryRun) {
    add("live_safety_flip", "critical", "Live safety flags are not in the default paper-only state.", "Stop review automation and inspect live-switch settings before any further patching.");
  }
  if (!Number.isFinite(localStoredAt)) {
    add("missing_local_worker_snapshot", "high", "No local-worker latest snapshot timestamp was found.", "Start the local worker and app, then rerun the exporter.");
  } else if (Date.now() - localStoredAt > 45 * 60_000) {
    add("snapshot_stale", "high", "The newest local-worker snapshot is older than 45 minutes.", "Confirm the app and local worker are still running.");
  }
  if (dataQuality.errorCount > 0) {
    add("data_quality_errors", "critical", "Factory output reports data-quality errors.", "Inspect latest factory report and do not promote affected algos.");
  }
  if (!gitInfo.commitHash) {
    add("missing_git_commit", "high", "Git commit could not be recorded.", "Install/repair Git or run inside a Git worktree for exact reproducibility.");
  }
  if (!registry?.inputManifestHash) {
    add("missing_input_manifest_hash", "high", "Experiment registry does not include an exact input manifest hash.", "Rerun factory validation so exact file hashes are recorded.");
  }
  if (Object.keys(topStats).length === 0) {
    add("missing_top_traders_executable", "warn", "No top-traders executable roster stats were found.", "Keep the app/local worker running until executable roster stats are persisted.");
  }
  if (!includeRows) {
    add("row_exports_disabled", "warn", "Decision/trade row extracts were not included in this packet.", "Run with --include-rows for first upload or when reject/drift alerts fire.");
  }
  const rejectTotals = Object.values(topStats).reduce((total, stat) => total + numberOrZero(stat.rejected), 0);
  if (rejectTotals === 0) {
    add("missing_reject_stream", "warn", "No reject counts are present in the top-traders stats.", "Exporter can only audit fill/reject realism when rejection evidence is present.");
  }
  return warnings;
}

function flattenWarning(warning) {
  return warning;
}

function dataQualitySummary(primaryRun, metrics) {
  const source = primaryRun?.dataQuality ?? {};
  return {
    rawFrames: numberOrZero(source.rawFrames ?? primaryRun?.frameCount),
    usableFrames: numberOrZero(source.usableFrames ?? primaryRun?.frameCount),
    duplicateFramesRemoved: numberOrZero(source.duplicateFramesRemoved),
    overlappingFramesDownsampled: numberOrZero(source.overlappingFramesDownsampled),
    marketEvents: numberOrZero(source.marketEvents ?? primaryRun?.eventCount),
    warningCount: numberOrZero(source.warningCount) + metrics.reduce((total, metric) => total + (metric.warnings?.length ?? 0), 0),
    errorCount: numberOrZero(source.errorCount),
  };
}

function liveSafetyState(liveSwitch) {
  const dryRun = liveSwitch?.dryRun !== false;
  const liveTradingEnabled = liveSwitch?.enabled === true && dryRun === false;
  return {
    dryRun,
    liveTradingEnabled,
    manualApprovalRequired: true,
    switchEnabled: liveSwitch?.enabled === true,
    updatedAt: liveSwitch?.updatedAt ?? null,
  };
}

function costModelsForSnapshot(registry, primaryRun) {
  const models = Array.isArray(registry.costModel) ? registry.costModel : Array.isArray(primaryRun?.costModels) ? primaryRun.costModels : [];
  return models.map((model) => ({
    id: model.id ?? "",
    label: model.label ?? model.id ?? "",
    fees: numberOrNull(model.feeRate ?? model.fees),
    slippage: numberOrNull(model.slippageCents ?? model.slippage),
    stress: model.id === "stress" || model.stress === true,
    feeRate: numberOrNull(model.feeRate),
    feePerContract: numberOrNull(model.feePerContract),
    slippageCents: numberOrNull(model.slippageCents),
    spreadPenaltyCents: numberOrNull(model.spreadPenaltyCents),
    stressSlippageCents: numberOrNull(model.stressSlippageCents),
    maxLatencyMs: numberOrNull(model.maxLatencyMs),
    depthShare: numberOrNull(model.depthShare),
    minFillProbability: numberOrNull(model.minFillProbability),
    allowPartialFills: model.allowPartialFills !== false,
  }));
}

async function copyRepoBundle({ bundleRoot, options }) {
  const dataRoot = path.resolve(options.dataRoot ?? defaultDataRoot());
  const storageDir = path.resolve(options.storageDir ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
  const backtestsDir = path.resolve(options.backtestsDir ?? path.join(dataRoot, "backtests"));
  const latestSweep = await readJsonMaybe(path.join(backtestsDir, "latest-sweep.json"));
  const runDir = stringOrNull(latestSweep?.runDir);
  const files = [];
  const writeTextTarget = async (relativePath, text) => {
    const target = path.join(bundleRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
    files.push(await fileInfo(target, path.basename(relativePath), relativePath, null));
  };
  const gitInfo = await repoInfo();
  await writeTextTarget("repo/COMMIT_HASH.txt", `${gitInfo.commitHash ?? "UNAVAILABLE"}\n`);
  for (const item of [
    { source: path.join(repoRoot, "package.json"), target: "repo/package.json" },
    { source: path.join(repoRoot, "DOGEEDGE_ALGO_FACTORY.md"), target: "repo/DOGEEDGE_ALGO_FACTORY.md" },
    { source: path.join(storageDir, "latest.json"), target: "repo/local-worker-latest.json" },
    { source: path.join(storageDir, "summary.md"), target: "repo/local-worker-summary.md" },
    { source: path.join(storageDir, "algorithm-candidates.json"), target: "repo/algorithm-candidates.json" },
    { source: path.join(storageDir, "rules-active.json"), target: "repo/rules-active.json" },
    { source: path.join(storageDir, "top-traders-executable.json"), target: "repo/top-traders-executable.json" },
    { source: path.join(backtestsDir, "latest.json"), target: "repo/backtests-latest.json" },
    { source: path.join(backtestsDir, "latest-sweep.json"), target: "repo/latest-sweep.json" },
    { source: runDir ? path.join(runDir, "candidates.json") : "", target: "repo/candidates.json" },
    { source: runDir ? path.join(runDir, "metrics.csv") : "", target: "repo/latest-sweep-metrics.csv" },
    { source: runDir ? path.join(runDir, "report.md") : "", target: "repo/latest-sweep-report.md" },
  ]) {
    if (!item.source || !(await exists(item.source))) continue;
    const target = path.join(bundleRoot, item.target);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(item.source, target);
    files.push(await fileInfo(target, path.basename(item.target), item.target, null));
  }
  return files;
}

async function writeRegistryTarball({ bundleRoot, options, snapshot }) {
  const dataRoot = path.resolve(options.dataRoot ?? defaultDataRoot());
  const backtestsDir = path.resolve(options.backtestsDir ?? path.join(dataRoot, "backtests"));
  const latestSweep = await readJsonMaybe(path.join(backtestsDir, "latest-sweep.json"));
  const runDir = stringOrNull(latestSweep?.runDir);
  const registrySource = runDir ? path.join(runDir, "experiment-registry.json") : "";
  const registryDir = path.join(bundleRoot, "registry");
  await mkdir(registryDir, { recursive: true });
  const registryJson = path.join(registryDir, "experiment-registry.json");
  if (registrySource && await exists(registrySource)) {
    await copyFile(registrySource, registryJson);
  } else {
    await writeFile(registryJson, `${JSON.stringify(snapshot.experimentRegistry, null, 2)}\n`, "utf8");
  }
  const tarPath = path.join(registryDir, "experiment-registry.tar.gz");
  try {
    await execFileAsync("tar", ["-czf", tarPath, "-C", registryDir, "experiment-registry.json"], { windowsHide: true });
    return fileInfo(tarPath, "experiment-registry.tar.gz", "registry/experiment-registry.tar.gz", null);
  } catch {
    const gzPath = path.join(registryDir, "experiment-registry.json.gz");
    await writeGzipText(gzPath, await readFile(registryJson, "utf8"));
    return fileInfo(gzPath, "experiment-registry.json.gz", "registry/experiment-registry.json.gz", null);
  }
}

async function zipDirectory(sourceDir, destinationZip) {
  await rm(destinationZip, { force: true });
  if (process.platform === "win32") {
    try {
      const command = [
        `$items = Get-ChildItem -LiteralPath ${powerShellString(sourceDir)}`,
        `Compress-Archive -LiteralPath $items.FullName -DestinationPath ${powerShellString(destinationZip)} -Force`,
      ].join("; ");
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ], { windowsHide: true, timeout: 120_000 });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await execFileAsync("zip", ["-qr", destinationZip, "."], { cwd: sourceDir, timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

async function repoInfo() {
  const git = await gitBinary();
  if (!git) return { commitHash: null, branch: null, dirty: true };
  try {
    const [commit, branch, status] = await Promise.all([
      execFileAsync(git, ["-C", repoRoot, "rev-parse", "HEAD"], { windowsHide: true }),
      execFileAsync(git, ["-C", repoRoot, "branch", "--show-current"], { windowsHide: true }),
      execFileAsync(git, ["-C", repoRoot, "status", "--porcelain"], { windowsHide: true }),
    ]);
    return {
      commitHash: commit.stdout.trim() || null,
      branch: branch.stdout.trim() || null,
      dirty: status.stdout.trim().length > 0,
    };
  } catch {
    return { commitHash: null, branch: null, dirty: true };
  }
}

async function gitBinary() {
  for (const candidate of process.platform === "win32"
    ? ["git", "C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"]
    : ["git"]) {
    try {
      await execFileAsync(candidate, ["--version"], { windowsHide: true });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function latestNamedDirs(root, limit) {
  try {
    const names = await readdir(root);
    const entries = [];
    for (const name of names) {
      const absolutePath = path.join(root, name);
      const info = await stat(absolutePath).catch(() => null);
      if (info?.isDirectory()) entries.push({ absolutePath, time: info.mtimeMs });
    }
    return entries.sort((left, right) => right.time - left.time).slice(0, limit).map((entry) => entry.absolutePath);
  } catch {
    return [];
  }
}

async function latestFilesRecursive(root, extensions, limit) {
  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
        const info = await stat(absolutePath).catch(() => null);
        if (info) found.push({ absolutePath, time: info.mtimeMs });
      }
    }
  }
  await walk(root);
  return found.sort((left, right) => right.time - left.time).slice(0, limit).map((entry) => entry.absolutePath);
}

async function readTailLines(filePath, maxLines) {
  if (!filePath || !(await exists(filePath))) return [];
  const info = await stat(filePath);
  const chunkSize = 256 * 1024;
  const chunks = [];
  let position = info.size;
  let text = "";
  while (position > 0 && countLines(text) <= maxLines + 1) {
    const readSize = Math.min(chunkSize, position);
    position -= readSize;
    const buffer = Buffer.alloc(readSize);
    const handle = await import("node:fs/promises").then((mod) => mod.open(filePath, "r"));
    try {
      await handle.read(buffer, 0, readSize, position);
    } finally {
      await handle.close();
    }
    chunks.unshift(buffer);
    text = Buffer.concat(chunks).toString("utf8");
  }
  return text.split(/\r?\n/).filter(Boolean).slice(-maxLines);
}

function countLines(text) {
  return (text.match(/\n/g) ?? []).length;
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readJsonMaybe(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileInfo(filePath, logicalName, relativePath, rows) {
  const [info, sha256] = await Promise.all([stat(filePath), hashFileMaybe(filePath)]);
  return {
    logicalName,
    relativePath: slashPath(relativePath),
    sha256,
    bytes: info.size,
    rows,
  };
}

async function hashFileMaybe(filePath) {
  if (!filePath || !(await exists(filePath))) return null;
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function writeGzipText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, gzipSync(text));
}

function tsv(columns, rows) {
  return [
    columns.join("\t"),
    ...rows.map((row) => columns.map((column) => tsvValue(row[column])).join("\t")),
  ].join("\n") + "\n";
}

function tsvValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = typeof value === "object" ? stableStringify(value) : String(value);
  return text.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
}

function csv(columns, rows) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
  ].join("\n") + "\n";
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = typeof value === "object" ? stableStringify(value) : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function rowCountFromTsv(text) {
  return Math.max(0, text.split(/\r?\n/).filter(Boolean).length - 1);
}

function topStatForMetric(topStats, metric) {
  return topStats[metric.algoId]
    ?? Object.values(topStats).find((stat) => stat?.sourceAlgoId === metric.algoId || stat?.algoId === metric.algoId)
    ?? null;
}

function summarizeTopStats(topStats) {
  return Object.values(topStats).reduce((summary, stat) => {
    summary.strategyStats += 1;
    summary.signals += numberOrZero(stat.signals);
    summary.attempts += numberOrZero(stat.attempts);
    summary.acceptedBuys += numberOrZero(stat.acceptedBuys);
    summary.rejected += numberOrZero(stat.rejected);
    summary.open += numberOrZero(stat.open);
    summary.wins += numberOrZero(stat.wins);
    summary.losses += numberOrZero(stat.losses);
    return summary;
  }, { strategyStats: 0, signals: 0, attempts: 0, acceptedBuys: 0, rejected: 0, open: 0, wins: 0, losses: 0 });
}

function hashEventIds(values) {
  return Array.isArray(values) ? hashJson(values) : null;
}

function displayIdFromMetric(metric, stat) {
  return metric.displayId ?? stat?.displayId ?? displayIdFromAlgo(metric.algoId) ?? null;
}

function displayIdFromAlgo(algoId) {
  const match = String(algoId ?? "").match(/(?:batch-)?([a-z])-([a-z0-9]+)?-?(\d{4})$/i)
    ?? String(algoId ?? "").match(/([A-Z])-(\d{4})$/i);
  if (!match) return null;
  const batch = match[1].toUpperCase();
  const serial = match[3] ?? match[2];
  return serial ? `${batch}-${serial.slice(-4).toUpperCase()}` : null;
}

function batchIdFromAlgo(algoId) {
  const match = String(algoId ?? "").match(/batch-([a-z])/i);
  return match ? match[1].toUpperCase() : "";
}

function slotFromMetric(metric, stat) {
  if (metric.promotionVerdict === "tiny_live_eligible") return "manual_review";
  if (metric.promotionVerdict === "paper_only") return "paper_only";
  if (stat) return "dry_run_evidence";
  return "research";
}

function sideFromAction(action) {
  if (String(action ?? "").toLowerCase().includes("yes")) return "YES";
  if (String(action ?? "").toLowerCase().includes("no")) return "NO";
  return "";
}

function holdingSeconds(trade) {
  const opened = parseTime(trade.openedAt);
  const closed = parseTime(trade.closedAt);
  return Number.isFinite(opened) && Number.isFinite(closed) ? Math.max(0, (closed - opened) / 1000) : "";
}

function parseTime(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : null;
}

function defaultDataRoot() {
  if (process.env.DOGEEDGE_DATA_ROOT) return process.env.DOGEEDGE_DATA_ROOT;
  if (process.platform === "win32") return "D:\\DogeEdge\\data";
  return path.join(repoRoot, "data");
}

function windowKind(minutes) {
  if (minutes === 30) return "30m";
  if (minutes === 120) return "2h";
  if (minutes === 1440) return "24h";
  return `${minutes}m`;
}

function compactIso(date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

function numberOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function jsonCell(value) {
  return JSON.stringify(value ?? null);
}

function slashPath(value) {
  return String(value).replaceAll(path.sep, "/");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return {
    dataRoot: result["data-root"],
    storageDir: result["storage-dir"],
    backtestsDir: result["backtests-dir"],
    outDir: result.out,
    windowMinutes: result["window-minutes"],
    bundleHours: result["bundle-hours"],
    bundle: Boolean(result.bundle),
    includeRows: result["no-rows"] ? false : true,
    maxRowLines: result["max-row-lines"],
    maxMetrics: result["max-metrics"],
    sourceTimezone: result.timezone,
  };
}

function powerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = options.bundle
    ? await buildReviewBundle(options)
    : await exportEvaluationSnapshot(options);
  const summary = {
    snapshotId: result.snapshot.snapshotId,
    snapshotPath: result.snapshotPath,
    manifestPath: result.manifestPath,
    bundlePath: result.bundlePath ?? null,
    bundleRoot: result.bundleRoot ?? null,
    alerts: result.snapshot.alerts,
    liveSafety: result.snapshot.appState.liveSafety,
  };
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
