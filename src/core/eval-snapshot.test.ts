import { gunzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReviewBundle, exportEvaluationSnapshot, validateEvaluationSnapshot } from "../../scripts/export-eval-snapshot.mjs";
import { nextEvalAction } from "../../scripts/run-eval-loop.mjs";

describe("continuous evaluation snapshot exporter", () => {
  it("writes a schema-valid local review snapshot with manifest hashes and row extracts", async () => {
    const fixture = writeEvalFixture();
    const result = await exportEvaluationSnapshot({
      dataRoot: fixture.dataRoot,
      storageDir: fixture.storageDir,
      backtestsDir: fixture.backtestsDir,
      outDir: fixture.outDir,
      now: "2026-06-07T20:30:00.000Z",
      maxRowLines: 5,
      maxMetrics: 10,
    });
    const snapshot = readGzipJson(result.snapshotPath);

    expect(validateEvaluationSnapshot(snapshot).ok).toBe(true);
    expect(snapshot.schemaVersion).toBe("dogeedge.eval.snapshot.v1");
    expect(snapshot.appState.liveSafety).toMatchObject({
      dryRun: true,
      liveTradingEnabled: false,
      manualApprovalRequired: true,
    });
    expect(snapshot.algoRollup[0]).toMatchObject({
      algoId: "factory-batch-batch-z-test-0001",
      displayId: "Z-0001",
      promotionVerdict: "paper_only",
      settlementSource: "estimated",
    });
    expect(snapshot.timestampSemantics.settlementSource).toBe("estimated");
    expect(result.manifest).toMatchObject({
      gitCommit: expect.any(String),
      dataHash: "input-hash",
      configHash: "config-hash",
      timestampSemantics: expect.objectContaining({ settlementSource: "estimated" }),
    });
    expect(snapshot.filesManifest.map((file: { logicalName: string }) => file.logicalName)).toEqual(expect.arrayContaining([
      "algoMetrics.tsv.gz",
      "decisionAggregates.tsv.gz",
      "decisionRows.tsv.gz",
      "tradeRows.tsv.gz",
      "decision_frames.jsonl",
      "trades.csv",
      "paper_decision_ledger.csv",
      "raw_market_ticks/manifest.json",
    ]));
    expect(snapshot.filesManifest.every((file: { sha256: string; bytes: number }) => file.sha256 && file.bytes > 0)).toBe(true);
    const ledger = readFileSync(path.join(result.snapshotDir, "paper_decision_ledger.csv"), "utf8");
    expect(ledger).toContain("top_traders_reject_summary");
    expect(ledger).toContain("edge_reject");
    const rawTickManifest = JSON.parse(readFileSync(path.join(result.snapshotDir, "raw_market_ticks", "manifest.json"), "utf8"));
    expect(rawTickManifest).toMatchObject({
      schemaVersion: "dogeedge.raw-market-ticks.manifest.v1",
      available: false,
      warningCodes: ["raw_market_tick_parquet_absent"],
    });
    const history = JSON.parse(readFileSync(path.join(fixture.outDir, "snapshot-history-48h.json"), "utf8"));
    expect(history.schemaVersion).toBe("dogeedge.eval.snapshot-history.v1");
    expect(history.latestSnapshotId).toBe(snapshot.snapshotId);
  });

  it("emits a critical alert if exported safety flags are not paper-only", async () => {
    const fixture = writeEvalFixture({ liveSwitch: { enabled: true, dryRun: false, updatedAt: "2026-06-07T20:00:00.000Z" } });
    const result = await exportEvaluationSnapshot({
      dataRoot: fixture.dataRoot,
      storageDir: fixture.storageDir,
      backtestsDir: fixture.backtestsDir,
      outDir: fixture.outDir,
      now: "2026-06-07T20:30:00.000Z",
      maxRowLines: 1,
      maxMetrics: 1,
    });
    const snapshot = readGzipJson(result.snapshotPath);

    expect(snapshot.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "live_safety_flip", severity: "critical" }),
    ]));
    expect(validateEvaluationSnapshot(snapshot).ok).toBe(false);
  });

  it("builds a two-hour bundle folder with repo and registry artifacts", async () => {
    const fixture = writeEvalFixture();
    const result = await buildReviewBundle({
      dataRoot: fixture.dataRoot,
      storageDir: fixture.storageDir,
      backtestsDir: fixture.backtestsDir,
      outDir: fixture.outDir,
      now: "2026-06-07T20:30:00.000Z",
      maxRowLines: 2,
      maxMetrics: 1,
    });
    const manifest = JSON.parse(readFileSync(path.join(result.bundleRoot, "manifest.json"), "utf8"));

    expect(manifest.schemaVersion).toBe("dogeedge.eval.review.bundle.v1");
    expect(manifest.files.map((file: { relativePath: string }) => file.relativePath)).toEqual(expect.arrayContaining([
      "repo/COMMIT_HASH.txt",
      "repo/package.json",
      "registry/experiment-registry.tar.gz",
      "snapshots/snapshot-history-48h.json",
      "snapshots/decision_frames.jsonl",
      "snapshots/trades.csv",
      "snapshots/paper_decision_ledger.csv",
      "snapshots/raw_market_ticks/manifest.json",
    ]));
    expect(manifest.safetyStatus.liveTradingEnabled).toBe(false);
  });

  it("chooses bundle work only at the configured two-hour cadence", () => {
    const bundleEveryMs = 2 * 60 * 60_000;

    expect(nextEvalAction({ nowMs: 1000, lastBundleMs: Number.NaN, bundleEveryMs })).toBe("bundle");
    expect(nextEvalAction({ nowMs: bundleEveryMs - 1, lastBundleMs: 0, bundleEveryMs })).toBe("snapshot");
    expect(nextEvalAction({ nowMs: bundleEveryMs, lastBundleMs: 0, bundleEveryMs })).toBe("bundle");
  });
});

function readGzipJson(filePath: string) {
  return JSON.parse(gunzipSync(readFileSync(filePath)).toString("utf8"));
}

function writeEvalFixture(options: { liveSwitch?: unknown } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "dogeedge-eval-snapshot-"));
  const dataRoot = path.join(root, "data");
  const storageDir = path.join(dataRoot, "local-worker");
  const backtestsDir = path.join(dataRoot, "backtests");
  const runDir = path.join(backtestsDir, "sweeps", "fixture-run");
  const framesDir = path.join(dataRoot, "features", "decision-frames");
  const outDir = path.join(root, "review-packets");
  for (const dir of [storageDir, backtestsDir, runDir, framesDir, outDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const algoId = "factory-batch-batch-z-test-0001";
  const metric = {
    algoId,
    algoName: "Fixture Algo",
    displayId: "Z-0001",
    family: "fixture",
    closed: 75,
    open: 0,
    independentClosedMarkets: 75,
    daysRepresented: 8,
    wins: 45,
    losses: 30,
    winRate: 0.6,
    averagePnl: 0.04,
    totalPnl: 3,
    totalCost: 20,
    roi: 0.15,
    conservativeTotalPnl: 2,
    stressTotalPnl: 0.5,
    maxDrawdown: -0.5,
    downsideDeviation: 0.1,
    profitFactor: 1.4,
    psr: 0.8,
    dsrApprox: 0.7,
    pboApprox: 0.2,
    familyAdjustedPValue: 0.1,
    globalAdjustedPValue: 0.12,
    falseDiscoveryRisk: 0.15,
    adjustedConfidence: 0.7,
    robustScore: 12.3,
    foldSummary: { positiveFoldRate: 0.8 },
    cpcvSummary: { positiveFoldRate: 0.8, medianFoldPnl: 0.3 },
    walkForwardPass: true,
    walkForwardClosed: 20,
    walkForwardTotalPnl: 1,
    walkForwardRoi: 0.1,
    holdoutPass: true,
    holdoutClosed: 20,
    holdoutConservativeTotalPnl: 1,
    holdoutLowerCi: 0.01,
    holdoutSummary: { holdoutConservativeMarkets: 20, holdoutMarkets: 20, strictlyLater: true },
    paperEvidence: { available: true, closedMarkets: 10, closedTrades: 12, totalPnl: 0.8, roi: 0.05 },
    drift: { driftOk: true, driftScore: 0.1, driftReasons: [] },
    executionTelemetry: {
      conservative: {
        averageSlippageCents: 1,
        averagePartialFillRatio: 0.9,
        averageFillProbability: 0.85,
        averageFillDepthUtilization: 0.25,
        staleQuoteRejections: 2,
        queueMisses: 1,
        depthRejections: 3,
      },
    },
    promotionStage: "validation_candidate",
    promotionVerdict: "paper_only",
    labelSource: "pre_close_frame_proxy",
    settlementSource: "estimated",
    officialResolutionAvailable: false,
    officialSettlementCoverage: 0,
    reasonCodes: ["paper_evidence_required"],
    warnings: [],
    nonPromotable: false,
    foldMetrics: [{ foldId: "purged-1", closed: 10, totalPnl: 0.5, roi: 0.1 }],
    cpcvMetrics: [{ foldId: "cpcv-1", closed: 10, totalPnl: 0.5, roi: 0.1 }],
  };
  const registry = {
    gitCommit: "fixture-git",
    codeVersion: "fixture-git",
    inputManifestHash: "input-hash",
    dataHash: "input-hash",
    configHash: "config-hash",
    trialCount: 1,
    metricsVersion: "robust-v1",
    randomSeed: "fixture-seed",
    families: { fixture: 1 },
    foldDefinitions: [{ id: "purged-1", trainEventIds: ["m-1"], validationEventIds: ["m-2"], purgedEventIds: [], embargoedEventIds: [], embargoMs: 900000 }],
    cpcvFoldDefinitions: [{ id: "cpcv-1", trainEventIds: ["m-1"], validationEventIds: ["m-2"], purgedEventIds: [], embargoedEventIds: [], embargoMs: 900000 }],
    holdoutDefinition: { immutable: true, strictlyLater: true, reason: "ok", holdoutEventIds: ["m-3"] },
    costModel: [{ id: "base", label: "Base" }, { id: "conservative", label: "Conservative", slippageCents: 1 }],
    seedPlan: { rootSeed: "fixture-seed", deterministic: true },
  };
  const latestSweep = {
    runId: "fixture-run",
    mode: "sweep",
    runDir,
    finishedAt: "2026-06-07T20:00:00.000Z",
    dataQuality: {
      rawFrames: 10,
      usableFrames: 10,
      duplicateFramesRemoved: 0,
      overlappingFramesDownsampled: 0,
      marketEvents: 3,
      warningCount: 0,
      errorCount: 0,
      settlementEvidence: { totalEvents: 3, officialEvents: 0, officialSettlementCoverage: 0, settlementSource: "estimated", labelSource: "pre_close_frame_proxy", officialResolutionAvailable: false },
    },
    eventCount: 3,
    frameCount: 10,
    algoCount: 1,
    randomSeed: "fixture-seed",
    registry,
    candidates: [],
    topMetrics: [metric],
  };
  const topTradersExecutable = {
    storedAt: "2026-06-07T20:15:00.000Z",
    topTradersExecutable: {
      stats: {
        [algoId]: {
          sourceAlgoId: algoId,
          algoId: `generated:${algoId}`,
          displayId: "Z-0001",
          family: "fixture",
          startedAt: "2026-06-07T19:30:00.000Z",
          lastSignalAt: "2026-06-07T20:20:00.000Z",
          lastAttemptAt: "2026-06-07T20:20:00.000Z",
          signals: 10,
          attempts: 8,
          acceptedBuys: 4,
          rejected: 4,
          staleRejects: 1,
          depthRejects: 1,
          gateRejects: 1,
          edgeRejects: 1,
          priceRejects: 0,
          otherRejects: 0,
          buys: 4,
          sells: 3,
          open: 1,
          wins: 2,
          losses: 1,
          totalPnl: 0.8,
          totalCost: 5,
        },
      },
      positions: [],
    },
  };

  writeFileSync(path.join(storageDir, "latest.json"), `${JSON.stringify({
    storedAt: "2026-06-07T20:20:00.000Z",
    factoryAutomation: { enabled: true },
    topTradersExecutable: topTradersExecutable.topTradersExecutable,
  })}\n`);
  writeFileSync(path.join(storageDir, "live-switch.json"), `${JSON.stringify(options.liveSwitch ?? { enabled: true, dryRun: true, updatedAt: "2026-06-07T20:00:00.000Z" })}\n`);
  writeFileSync(path.join(storageDir, "summary.md"), "# Local worker fixture\n");
  writeFileSync(path.join(storageDir, "algorithm-candidates.json"), "[]\n");
  writeFileSync(path.join(storageDir, "rules-active.json"), "{}\n");
  writeFileSync(path.join(storageDir, "top-traders-executable.json"), `${JSON.stringify(topTradersExecutable)}\n`);
  writeFileSync(path.join(storageDir, "paper-trades.jsonl"), `${JSON.stringify({
    id: "trade-1",
    strategyId: `generated:${algoId}`,
    marketTicker: "KXDOGE15M-FIXTURE",
    status: "closed",
    side: "YES",
    contracts: 2,
    entryPrice: 0.4,
    exitPrice: 0.45,
    openedAt: "2026-06-07T20:10:00.000Z",
    closedAt: "2026-06-07T20:12:00.000Z",
    pnl: 0.1,
    entryContext: { fillProbability: 0.85, partialFillRatio: 1, slippageCents: 1, fillDepthUtilization: 0.2 },
  })}\n`);
  writeFileSync(path.join(framesDir, "records.jsonl"), `${JSON.stringify({
    id: "frame-1",
    marketTicker: "KXDOGE15M-FIXTURE",
    observedAt: "2026-06-07T20:10:00.000Z",
    capturedAt: "2026-06-07T20:10:00.000Z",
    featureTimestamp: "2026-06-07T20:10:00.000Z",
    labelTimestamp: "2026-06-07T20:15:00.000Z",
    settlementTimestamp: "2026-06-07T20:15:00.000Z",
    labelSource: "pre_close_frame_proxy",
    settlementSource: "estimated",
    officialResolutionAvailable: false,
    marketCloseTimestamp: "2026-06-07T20:15:00.000Z",
    secondsToClose: 300,
    targetPrice: 0.25,
    estimate: 0.251,
    spotPrice: 0.251,
    modelAction: "buy_yes",
    yesBid: 0.4,
    yesAsk: 0.41,
    noBid: 0.58,
    noAsk: 0.59,
  })}\n`);
  writeFileSync(path.join(backtestsDir, "latest-sweep.json"), `${JSON.stringify(latestSweep)}\n`);
  writeFileSync(path.join(backtestsDir, "latest.json"), `${JSON.stringify({ ...latestSweep, mode: "backtest", metrics: [metric], topMetrics: undefined })}\n`);
  writeFileSync(path.join(runDir, "experiment-registry.json"), `${JSON.stringify(registry)}\n`);
  writeFileSync(path.join(runDir, "candidates.json"), "[]\n");
  writeFileSync(path.join(runDir, "metrics.csv"), "algoId,totalPnl\nfixture,1\n");
  writeFileSync(path.join(runDir, "report.md"), "# Fixture report\n");

  return { dataRoot, storageDir, backtestsDir, outDir };
}
