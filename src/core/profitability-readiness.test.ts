import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareResearchCandidates } from "../../scripts/factory/ranking.mjs";
import { evidenceScaledFamilyTrialCap } from "../../scripts/factory/search-budget.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function runNode(args: string[], cwd = repoRoot) {
  return execFileSync(process.execPath, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("profitability readiness pipeline", () => {
  it("builds a replay-backed research dataset, locks a protocol, calibrates simulator, and reports readiness offline", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-profitability-"));
    const rawRoot = path.join(root, "replay", "raw");
    const finalRoot = path.join(root, "replay", "final");
    const datasetDir = path.join(root, "research", "dataset");
    const protocolDir = path.join(root, "research", "protocol");
    const settlements = path.join(root, "official_settlements.jsonl");
    mkdirSync(root, { recursive: true });

    runNode([
      "scripts/factory/capture-replay.mjs",
      "--mock-input", "test/fixtures/replay-raw/KXDOGE15M-FIXTURE.jsonl",
      "--markets-file", "test/fixtures/target-markets.json",
      "--out", rawRoot,
    ]);
    runNode([
      "scripts/factory/build-replay-dataset.mjs",
      "--input", rawRoot,
      "--markets-file", "test/fixtures/target-markets.json",
      "--out", finalRoot,
    ]);
    runNode([
      "scripts/factory/replay-coverage.mjs",
      "--input", finalRoot,
      "--markets-file", "test/fixtures/target-markets.json",
      "--out", path.join(root, "replay", "coverage.json"),
    ]);
    runNode([
      "scripts/factory/fetch-official-settlements.mjs",
      "--mock-input", "test/fixtures/official-settlements.mock.jsonl",
      "--out", settlements,
    ]);
    runNode([
      "scripts/factory/build-research-dataset.mjs",
      "--replay-root", finalRoot,
      "--settlements", settlements,
      "--out", datasetDir,
    ]);
    runNode([
      "scripts/factory/calibrate-simulator.mjs",
      "--dataset", datasetDir,
      "--replay-root", finalRoot,
      "--out", path.join(datasetDir, "simulator-calibration"),
    ]);
    runNode([
      "scripts/factory/research-protocol.mjs",
      "--create",
      "--dataset", datasetDir,
      "--out", protocolDir,
    ]);
    runNode([
      "scripts/factory/research-protocol.mjs",
      "--lock",
      "--protocol", path.join(protocolDir, "experiment_protocol.json"),
    ]);
    runNode([
      "scripts/factory/research-protocol.mjs",
      "--audit",
      "--protocol", path.join(protocolDir, "experiment_protocol.json"),
      "--out", protocolDir,
    ]);
    runNode([
      "scripts/factory/usage-readiness.mjs",
      "--data-root", path.join(root, "usage-data-root"),
      "--dataset", datasetDir,
      "--protocol", path.join(protocolDir, "experiment_protocol.json"),
      "--calibration", path.join(datasetDir, "simulator-calibration", "simulator_calibration.json"),
      "--out", path.join(root, "usage-readiness.json"),
    ]);
    runNode([
      "scripts/factory/ci-summary.mjs",
      "--root", root,
      "--out", path.join(root, "summary"),
    ]);

    const manifest = JSON.parse(readFileSync(path.join(datasetDir, "dataset_manifest.json"), "utf8"));
    const quality = JSON.parse(readFileSync(path.join(datasetDir, "dataset_quality_report.json"), "utf8"));
    const calibration = JSON.parse(readFileSync(path.join(datasetDir, "simulator-calibration", "simulator_calibration.json"), "utf8"));
    const protocol = JSON.parse(readFileSync(path.join(protocolDir, "experiment_protocol.json"), "utf8"));
    const audit = JSON.parse(readFileSync(path.join(protocolDir, "protocol_audit.json"), "utf8"));
    const readiness = JSON.parse(readFileSync(path.join(root, "usage-readiness.json"), "utf8"));
    const summary = JSON.parse(readFileSync(path.join(root, "summary", "ci-summary.json"), "utf8"));

    expect(manifest.marketCount).toBe(1);
    expect(manifest.datasetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(quality.leakageCheckPassed).toBe(true);
    expect(calibration.scenarios.conservative.adverseTicks).toBe(1);
    expect(calibration.scenarios.stress.adverseTicks).toBe(2);
    expect(protocol.locked).toBe(true);
    expect(audit.ok).toBe(true);
    expect(summary.ok).toBe(true);
    expect(summary.readiness.liveEnabled).toBe(false);
    expect(readiness.tinyLiveEligible).toBe(false);
    expect(readiness.liveEnabled).toBe(false);
  });

  it("derives paper and extended-paper readiness from evidence summaries without enabling live mode", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-usage-ready-"));
    const dataRoot = path.join(root, "data");
    const datasetDir = path.join(root, "dataset");
    const protocolDir = path.join(root, "protocol");
    const calibrationDir = path.join(root, "calibration");
    mkdirSync(path.join(dataRoot, "evidence-registry"), { recursive: true });
    mkdirSync(datasetDir, { recursive: true });
    mkdirSync(protocolDir, { recursive: true });
    mkdirSync(calibrationDir, { recursive: true });
    writeFileSync(path.join(dataRoot, "evidence-registry", "markets.jsonl"), `${JSON.stringify({
      replayGrade: true,
      finalizedSettlementJoined: true,
      exactLinkedPaperDecisionCount: 1,
      sequenceGapCount: 0,
      closeTime: "2026-06-21T00:00:00.000Z",
    })}\n`, "utf8");
    writeFileSync(path.join(datasetDir, "dataset_manifest.json"), JSON.stringify({
      schemaVersion: "dogeedge.research-dataset-manifest.v1",
      datasetHash: "a".repeat(64),
      marketCount: 100,
    }), "utf8");
    writeFileSync(path.join(datasetDir, "dataset_quality_report.json"), JSON.stringify({
      schemaVersion: "dogeedge.research-dataset-quality.v1",
      distinctDayCount: 7,
      leakageCheckPassed: true,
    }), "utf8");
    writeFileSync(path.join(calibrationDir, "simulator_calibration.json"), JSON.stringify({
      schemaVersion: "dogeedge.simulator-calibration.v1",
      canPlaceOrders: false,
    }), "utf8");
    writeFileSync(path.join(protocolDir, "experiment_protocol.json"), JSON.stringify({
      schemaVersion: "dogeedge.experiment-protocol.v1",
      locked: true,
      consumedHoldout: false,
      lockedHoldoutMarketIds: Array.from({ length: 20 }, (_, index) => `HOLDOUT-${index}`),
    }), "utf8");
    const paperSummaryPath = path.join(root, "paper-summary.json");
    writeFileSync(paperSummaryPath, JSON.stringify({
      schemaVersion: "dogeedge.paper-candidate-summary.v1",
      exactLinkedPaperCandidates: 3,
      forwardPaperDays: 14,
      completedMarkets: 200,
      closedPaperTrades: 100,
      candidateConfigFrozen: true,
      realizedPaperExpectancyPositive: true,
      simulatorPaperDriftOk: true,
      stableCalibration: true,
      riskKillSwitchActivationCount: 0,
      regimeCoverageAcceptable: true,
      humanReviewApproved: true,
      manualTinyLiveApprovalRecorded: true,
      candidates: [{
        candidateId: "paper-pass",
        evaluatedMarkets: 100,
        closedTrades: 50,
        distinctDays: 7,
        holdoutMarkets: 20,
        conservativeHoldoutPnl: 1,
        conservativeExpectancy: 0.01,
        expectancyBootstrapLower95: 0.001,
        stressTotalPnl: 0,
        psr: 0.96,
        dsr: 0.96,
        pbo: 0.1,
        maxSingleMarketContribution: 0.05,
        maxSingleDayContribution: 0.2,
        maxSingleRegimeContribution: 0.4,
        maxDrawdownWithinLimit: true,
        unresolvedDataIntegrityWarnings: 0,
        exactExecutableLinkage: true,
        paperOnly: true,
        promotionEligibleForLive: false,
      }],
    }), "utf8");

    runNode([
      "scripts/factory/usage-readiness.mjs",
      "--data-root", dataRoot,
      "--dataset", datasetDir,
      "--protocol", path.join(protocolDir, "experiment_protocol.json"),
      "--calibration", path.join(calibrationDir, "simulator_calibration.json"),
      "--paper-summary", paperSummaryPath,
      "--out", path.join(root, "readiness.json"),
    ]);
    const readiness = JSON.parse(readFileSync(path.join(root, "readiness.json"), "utf8"));
    expect(readiness.paperCandidateAvailable).toBe(true);
    expect(readiness.extendedPaperValidated).toBe(true);
    expect(readiness.tinyLiveEligible).toBe(true);
    expect(readiness.liveEnabled).toBe(false);
    expect(readiness.currentStage).toBe("stage_e_extended_paper_validation");
    expect(readiness.blockers).not.toContain("stage_d_paper_candidate_gate_not_met");
    expect(readiness.blockers).not.toContain("stage_e_extended_paper_validation_not_met");
  });

  it("rejects duplicate collector instances with a lock file", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-collector-lock-"));
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, ".collector.lock"), `${JSON.stringify({ pid: process.pid })}\n`, "utf8");
    expect(() => runNode([
      "scripts/factory/collect-evidence.mjs",
      "--out", root,
      "--data-root", root,
      "--max-markets", "1",
    ])).toThrow(/duplicate_collector_lockout/);
  });

  it("recovers a stale collector lock before reporting no active market", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-collector-stale-lock-"));
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, ".collector.lock"), `${JSON.stringify({ pid: 99999999 })}\n`, "utf8");
    runNode([
      "scripts/factory/collect-evidence.mjs",
      "--out", root,
      "--data-root", root,
      "--max-markets", "1",
    ]);
    const status = JSON.parse(readFileSync(path.join(root, "status.json"), "utf8"));
    expect(status.status).toBe("blocked_or_waiting");
    expect(status.failedMarkets[0].reasonCode).toBe("active_target_market_absent");
  });

  it("scales search budget by independent replay-grade market count", () => {
    expect(evidenceScaledFamilyTrialCap(0)).toMatchObject({ maxRegisteredCandidatesPerFamily: 10, parameterOptimizationAllowed: false });
    expect(evidenceScaledFamilyTrialCap(20).maxRegisteredCandidatesPerFamily).toBe(25);
    expect(evidenceScaledFamilyTrialCap(50).maxRegisteredCandidatesPerFamily).toBe(50);
    expect(evidenceScaledFamilyTrialCap(100).maxRegisteredCandidatesPerFamily).toBe(100);
    expect(evidenceScaledFamilyTrialCap(200).maxRegisteredCandidatesPerFamily).toBe(200);
  });

  it("does not rank negative conservative holdout evidence above positive gate-passing evidence", () => {
    const positive = {
      algoId: "positive",
      promotionVerdict: "paper_only",
      holdoutSummary: { conservativeExpectancy: 0.01 },
      costModels: { stress: { totalPnl: 0.01 } },
      adjustedConfidence: 0.6,
      foldSummary: { positiveFoldRate: 0.8 },
      maxDrawdown: -1,
      independentClosedMarkets: 50,
      totalPnl: 1,
    };
    const negative = {
      algoId: "negative",
      promotionVerdict: "paper_only",
      holdoutSummary: { conservativeExpectancy: -0.01 },
      costModels: { stress: { totalPnl: 10 } },
      adjustedConfidence: 0.99,
      foldSummary: { positiveFoldRate: 1 },
      maxDrawdown: 0,
      independentClosedMarkets: 50,
      totalPnl: 100,
    };
    expect([negative, positive].sort(compareResearchCandidates)[0]).toBe(positive);
  });

  it("keeps evidence, canary, dataset, and protocol commands away from order routing", () => {
    const forbidden = /\b(createOrder|placeOrder|submitOrder|cancelOrder|amendOrder|routeOrder|portfolio\/orders|\/orders)\b/;
    for (const file of [
      "scripts/factory/collect-evidence.mjs",
      "scripts/factory/build-research-dataset.mjs",
      "scripts/factory/calibrate-simulator.mjs",
      "scripts/factory/research-protocol.mjs",
      "scripts/factory/usage-readiness.mjs",
      "scripts/factory/run-e2e-evidence.mjs",
      "scripts/factory/install-execution-canaries.mjs",
    ]) {
      expect(readFileSync(path.join(repoRoot, file), "utf8")).not.toMatch(forbidden);
    }
  });
});
