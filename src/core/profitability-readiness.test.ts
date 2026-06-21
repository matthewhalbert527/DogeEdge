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
      "--dataset", datasetDir,
      "--protocol", path.join(protocolDir, "experiment_protocol.json"),
      "--out", path.join(root, "readiness.json"),
    ]);

    const manifest = JSON.parse(readFileSync(path.join(datasetDir, "dataset_manifest.json"), "utf8"));
    const quality = JSON.parse(readFileSync(path.join(datasetDir, "dataset_quality_report.json"), "utf8"));
    const calibration = JSON.parse(readFileSync(path.join(datasetDir, "simulator-calibration", "simulator_calibration.json"), "utf8"));
    const protocol = JSON.parse(readFileSync(path.join(protocolDir, "experiment_protocol.json"), "utf8"));
    const audit = JSON.parse(readFileSync(path.join(protocolDir, "protocol_audit.json"), "utf8"));
    const readiness = JSON.parse(readFileSync(path.join(root, "readiness.json"), "utf8"));

    expect(manifest.marketCount).toBe(1);
    expect(manifest.datasetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(quality.leakageCheckPassed).toBe(true);
    expect(calibration.scenarios.conservative.adverseTicks).toBe(1);
    expect(calibration.scenarios.stress.adverseTicks).toBe(2);
    expect(protocol.locked).toBe(true);
    expect(audit.ok).toBe(true);
    expect(readiness.tinyLiveEligible).toBe(false);
    expect(readiness.liveEnabled).toBe(false);
  });

  it("rejects duplicate collector instances with a lock file", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dogeedge-collector-lock-"));
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, ".collector.lock"), "{\"pid\":1}\n", "utf8");
    expect(() => runNode([
      "scripts/factory/collect-evidence.mjs",
      "--out", root,
      "--data-root", root,
      "--max-markets", "1",
    ])).toThrow(/duplicate_collector_lockout/);
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
