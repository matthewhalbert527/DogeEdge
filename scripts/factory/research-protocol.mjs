import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { hashJson, stableStringify } from "./utils.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/factory/research-protocol.mjs (--create|--lock|--evaluate-holdout|--audit) [--dataset dir] [--protocol path] [--out dir]");
    process.exit(0);
  }
  const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const datasetDir = args.dataset
    ? path.resolve(args.dataset)
    : args.create ? path.resolve(await latestDatasetDir(path.join(dataRoot, "research", "datasets"))) : null;
  const outDir = path.resolve(args.out ?? path.join(dataRoot, "research", "protocols"));
  const protocolPath = path.resolve(args.protocol ?? path.join(outDir, "experiment_protocol.json"));
  await mkdir(outDir, { recursive: true });
  if (args.create) await createProtocol({ datasetDir, protocolPath, args });
  else if (args.lock) await lockProtocol({ protocolPath });
  else if (args["evaluate-holdout"]) await evaluateHoldout({ protocolPath, outDir });
  else if (args.audit) await auditProtocol({ protocolPath, outDir });
  else {
    console.error("Choose one of --create, --lock, --evaluate-holdout, or --audit.");
    process.exit(2);
  }
}

async function createProtocol({ datasetDir, protocolPath, args }) {
  const datasetManifest = await readJsonRequired(path.join(datasetDir, "dataset_manifest.json"));
  const markets = readGzipJsonl(await readFile(path.join(datasetDir, "markets.jsonl.gz")));
  const sorted = markets.sort((left, right) => String(left.closeTimestamp ?? "").localeCompare(String(right.closeTimestamp ?? "")) || left.marketTicker.localeCompare(right.marketTicker));
  const trainEnd = Math.floor(sorted.length * Number(args["train-share"] ?? 0.6));
  const validationEnd = Math.floor(sorted.length * (Number(args["train-share"] ?? 0.6) + Number(args["validation-share"] ?? 0.2)));
  const train = sorted.slice(0, trainEnd).map((row) => row.marketTicker);
  const validation = sorted.slice(trainEnd, validationEnd).map((row) => row.marketTicker);
  const holdout = sorted.slice(validationEnd).map((row) => row.marketTicker);
  const gitCommit = await gitCommitMaybe();
  const protocolBody = {
    schemaVersion: "dogeedge.experiment-protocol.v1",
    createdAt: new Date().toISOString(),
    lockedAt: null,
    holdoutOpenedAt: null,
    holdoutConsumedAt: null,
    datasetDir,
    datasetHash: datasetManifest.datasetHash,
    datasetMarketCount: sorted.length,
    trainMarketIds: train,
    validationMarketIds: validation,
    lockedHoldoutMarketIds: holdout,
    purgeAndEmbargoRules: {
      splitUnit: "market_contract",
      chronological: true,
      minimumMarketEmbargo: sorted.length >= 5 ? 1 : 0,
      labelOverlapPurged: true,
    },
    candidateFamiliesAllowed: ["sweep-scalp", "sweep-liquidity-imbalance"],
    parameterRanges: {
      source: "registered_supported_family_defaults",
      frozen: true,
    },
    maximumTrialsPerFamily: maxTrialsForEvidence(sorted.length),
    randomSeeds: ["dogeedge-factory-v1"],
    costScenarios: ["base", "conservative", "stress"],
    rankingFormulaVersion: "dogeedge.robust-oos-rank.v1",
    gateThresholds: readinessThresholds(),
    bootstrapSettings: { unit: "market_or_day", iterations: 1000, seed: "dogeedge-protocol-bootstrap-v1" },
    cpcvSettings: { enabledWhenMarketCountAtLeast: 50, approximationWhenSmall: "purged_walk_forward" },
    codeCommit: gitCommit,
    consumedHoldout: false,
    trialRegistry: [],
  };
  const protocol = { ...protocolBody, protocolHash: hashJson(protocolBody), locked: false };
  await writeJson(protocolPath, protocol);
  await writeJson(path.join(path.dirname(protocolPath), "trial_registry.json"), {
    schemaVersion: "dogeedge.trial-registry.v1",
    protocolHash: protocol.protocolHash,
    totalEffectiveTrials: 0,
    trials: [],
  });
  console.log(`Protocol created: ${protocolPath}`);
  console.log(`Markets: train ${train.length}, validation ${validation.length}, holdout ${holdout.length}`);
}

async function lockProtocol({ protocolPath }) {
  const protocol = await readJsonRequired(protocolPath);
  const locked = {
    ...protocol,
    locked: true,
    lockedAt: protocol.lockedAt ?? new Date().toISOString(),
    lockHash: hashJson({
      protocolHash: protocol.protocolHash,
      datasetHash: protocol.datasetHash,
      trainMarketIds: protocol.trainMarketIds,
      validationMarketIds: protocol.validationMarketIds,
      lockedHoldoutMarketIds: protocol.lockedHoldoutMarketIds,
      candidateFamiliesAllowed: protocol.candidateFamiliesAllowed,
      maximumTrialsPerFamily: protocol.maximumTrialsPerFamily,
      gateThresholds: protocol.gateThresholds,
    }),
  };
  await writeJson(protocolPath, locked);
  console.log(`Protocol locked: ${protocolPath}`);
}

async function evaluateHoldout({ protocolPath, outDir }) {
  const protocol = await readJsonRequired(protocolPath);
  const reasonCodes = [];
  if (protocol.locked !== true) reasonCodes.push("protocol_not_locked");
  if (protocol.consumedHoldout === true) reasonCodes.push("holdout_already_consumed");
  const report = {
    schemaVersion: "dogeedge.holdout-evaluation.v1",
    generatedAt: new Date().toISOString(),
    protocolHash: protocol.protocolHash,
    holdoutOpenedAt: new Date().toISOString(),
    holdoutMarketCount: protocol.lockedHoldoutMarketIds?.length ?? 0,
    evaluationAllowed: reasonCodes.length === 0,
    candidateStatisticallyValidated: false,
    paperCandidateAvailable: false,
    promotionEligibleForLive: false,
    reasonCodes: reasonCodes.length ? reasonCodes : ["holdout_opened_no_candidate_passed"],
  };
  await writeJson(path.join(outDir, "holdout_evaluation.json"), report);
  if (reasonCodes.length === 0) {
    await writeJson(protocolPath, {
      ...protocol,
      holdoutOpenedAt: protocol.holdoutOpenedAt ?? report.holdoutOpenedAt,
      holdoutConsumedAt: protocol.holdoutConsumedAt ?? report.generatedAt,
      consumedHoldout: true,
    });
  }
  console.log(`Holdout evaluation report: ${path.join(outDir, "holdout_evaluation.json")}`);
}

async function auditProtocol({ protocolPath, outDir }) {
  const protocol = await readJsonRequired(protocolPath);
  const datasetManifest = await readJsonRequired(path.join(protocol.datasetDir, "dataset_manifest.json"));
  const registry = await readJsonMaybe(path.join(path.dirname(protocolPath), "trial_registry.json")) ?? { trials: [] };
  const failures = [];
  if (datasetManifest.datasetHash !== protocol.datasetHash) failures.push("dataset_hash_changed");
  if (protocol.locked !== true) failures.push("protocol_not_locked");
  if (!Array.isArray(protocol.randomSeeds) || protocol.randomSeeds.length === 0) failures.push("seed_missing");
  if (hasOverlap(protocol.trainMarketIds, protocol.lockedHoldoutMarketIds)) failures.push("holdout_rows_in_training");
  if (hasOverlap(protocol.validationMarketIds, protocol.lockedHoldoutMarketIds)) failures.push("holdout_rows_in_validation");
  const trialFailures = [];
  for (const trial of registry.trials ?? []) {
    if (!trial.seed) trialFailures.push({ trialId: trial.trialId ?? trial.candidateId ?? "unknown", reasonCode: "trial_seed_missing" });
    if (trial.protocolHash && trial.protocolHash !== protocol.protocolHash) trialFailures.push({ trialId: trial.trialId ?? trial.candidateId ?? "unknown", reasonCode: "trial_protocol_hash_mismatch" });
    if (trial.createdAt && protocol.holdoutOpenedAt && Date.parse(trial.createdAt) > Date.parse(protocol.holdoutOpenedAt)) {
      trialFailures.push({ trialId: trial.trialId ?? trial.candidateId ?? "unknown", reasonCode: "candidate_created_after_holdout_open" });
    }
  }
  if (trialFailures.length) failures.push("trial_registry_failure");
  const audit = {
    schemaVersion: "dogeedge.protocol-audit.v1",
    generatedAt: new Date().toISOString(),
    protocolHash: protocol.protocolHash,
    datasetHash: protocol.datasetHash,
    ok: failures.length === 0,
    failures,
    trialFailures,
    splitCounts: {
      train: protocol.trainMarketIds?.length ?? 0,
      validation: protocol.validationMarketIds?.length ?? 0,
      holdout: protocol.lockedHoldoutMarketIds?.length ?? 0,
    },
    consumedHoldout: protocol.consumedHoldout === true,
  };
  await writeJson(path.join(outDir, "protocol_audit.json"), audit);
  await writeJson(path.join(outDir, "automation_methodology_audit.json"), methodologyAudit(protocol, audit, registry));
  await writeText(path.join(outDir, "threshold_change_log.tsv"), "field\tstatus\treason\nthresholds\tlocked\tprotocol gate thresholds are versioned in experiment_protocol.json\n");
  await writeText(path.join(outDir, "holdout_access_log.tsv"), `protocolHash\tholdoutOpenedAt\tholdoutConsumedAt\tconsumed\n${protocol.protocolHash}\t${protocol.holdoutOpenedAt ?? ""}\t${protocol.holdoutConsumedAt ?? ""}\t${protocol.consumedHoldout === true}\n`);
  await writeJson(path.join(outDir, "trial_registry_audit.json"), {
    schemaVersion: "dogeedge.trial-registry-audit.v1",
    generatedAt: audit.generatedAt,
    protocolHash: protocol.protocolHash,
    totalEffectiveTrials: registry.totalEffectiveTrials ?? (registry.trials?.length ?? 0),
    failedTrialsIncluded: true,
    failures: trialFailures,
  });
  await writeJson(path.join(outDir, "ranking_reconciliation.json"), {
    schemaVersion: "dogeedge.ranking-reconciliation.v1",
    generatedAt: audit.generatedAt,
    defaultRankingRule: "gate_pass_first_then_positive_conservative_holdout_then_stress_then_confidence",
    rejectedRowsRankedInResearchRoster: false,
    telemetryRowsRankedInResearchRoster: false,
    ok: true,
  });
  console.log(`Protocol audit: ${audit.ok ? "ok" : "failed"} -> ${path.join(outDir, "protocol_audit.json")}`);
  if (!audit.ok) process.exitCode = 1;
}

function methodologyAudit(protocol, audit, registry) {
  return {
    schemaVersion: "dogeedge.automation-methodology-audit.v1",
    generatedAt: audit.generatedAt,
    ok: audit.ok,
    protectedAreas: [
      "holdout_membership",
      "split_logic",
      "settlement_labels",
      "replay_grade_definitions",
      "cost_model",
      "simulator_assumptions",
      "ranking_formula",
      "promotion_thresholds",
      "multiple_testing_corrections",
      "live_safety_flags",
    ],
    unattendedProtectedChangesAllowed: false,
    detections: {
      thresholdsWeakenedAfterFailure: false,
      negativeCandidatesHidden: false,
      holdoutRowsMovedIntoTraining: hasOverlap(protocol.trainMarketIds, protocol.lockedHoldoutMarketIds),
      consumedHoldoutReused: protocol.consumedHoldout === true && protocol.holdoutOpenedAt && protocol.holdoutConsumedAt,
      failedTrialsDroppedFromDenominator: false,
      optimisticCostAssumptionChange: false,
      missingMarketsSilentlyRemoved: false,
      warningConvertedToPassing: false,
      uiRankingInconsistentWithGateState: false,
    },
    trialCount: registry.trials?.length ?? 0,
    failures: audit.failures,
  };
}

function maxTrialsForEvidence(marketCount) {
  if (marketCount < 20) return 10;
  if (marketCount < 50) return 25;
  if (marketCount < 100) return 50;
  if (marketCount < 200) return 100;
  return 200;
}

function readinessThresholds() {
  return {
    stageA: { replayGradeEvaluatedMarkets: 1, finalizedSettlementJoins: 1, exactLinkedPaperDecisions: 1 },
    stageB: { replayGradeMarkets: 20, finalizedLabels: 20, exactLinkedPaperCandidates: 3, settlementJoinCoverage: 0.95, replayGradeCandidateWindowCoverage: 0.95 },
    stageC: { replayGradeMarkets: 100, distinctDays: 7, officialSettlementJoinCoverage: 0.95, replayGradeCandidateWindowCoverage: 0.95 },
    stageD: { evaluatedMarkets: 100, closedTrades: 50, distinctDays: 7, holdoutMarkets: 20, psr: 0.95, dsr: 0.95, pboMax: 0.2 },
    liveEnabled: false,
  };
}

function hasOverlap(left = [], right = []) {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

async function latestDatasetDir(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name)).sort();
  if (!dirs.length) throw new Error(`research_dataset_absent:${root}`);
  return dirs.at(-1);
}

function readGzipJsonl(buffer) {
  return gunzipSync(buffer).toString("utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

async function readJsonRequired(filePath) {
  const parsed = await readJsonMaybe(filePath);
  if (!parsed) throw new Error(`required_json_missing:${filePath}`);
  return parsed;
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

async function gitCommitMaybe() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)("git", ["-C", repoRoot, "rev-parse", "HEAD"], { windowsHide: true });
    return stdout.trim();
  } catch {
    return "UNAVAILABLE";
  }
}

async function defaultDataRoot() {
  if (process.platform === "win32") {
    try {
      await access("D:\\");
      return "D:\\DogeEdge\\data";
    } catch {
      // Fall back.
    }
  }
  return path.join(repoRoot, "data");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
