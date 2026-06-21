import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/factory/ci-summary.mjs [--root artifacts/ci] [--out artifacts/ci/summary]");
    process.exit(0);
  }

  const root = path.resolve(args.root ?? "artifacts/ci");
  const outDir = path.resolve(args.out ?? path.join(root, "summary"));
  const replayCoverage = await readJsonMaybe(path.join(root, "replay", "coverage.json"));
  const datasetManifest = await readJsonMaybe(path.join(root, "research", "dataset", "dataset_manifest.json"));
  const datasetQuality = await readJsonMaybe(path.join(root, "research", "dataset", "dataset_quality_report.json"));
  const calibration = await readJsonMaybe(path.join(root, "research", "dataset", "simulator-calibration", "simulator_calibration.json"));
  const parity = await readJsonMaybe(path.join(root, "research", "dataset", "simulator-calibration", "paper_replay_parity.json"));
  const protocol = await readJsonMaybe(path.join(root, "research", "protocol", "experiment_protocol.json"));
  const protocolAudit = await readJsonMaybe(path.join(root, "research", "protocol", "protocol_audit.json"));
  const readiness = await readJsonMaybe(path.join(root, "usage-readiness.json"));

  const failures = [];
  if (!datasetManifest?.datasetHash) failures.push("dataset_manifest_missing_or_unhashed");
  if (!(Number(datasetManifest?.marketCount ?? 0) >= 1)) failures.push("dataset_market_count_zero");
  if (datasetQuality?.leakageCheckPassed !== true) failures.push("feature_leakage_check_failed");
  if (!calibration?.schemaVersion) failures.push("simulator_calibration_missing");
  if (calibration?.canPlaceOrders !== false) failures.push("calibration_can_place_orders_not_false");
  if (!parity?.schemaVersion) failures.push("paper_replay_parity_missing");
  if (parity?.canPlaceOrders !== false) failures.push("parity_can_place_orders_not_false");
  if (protocol?.locked !== true) failures.push("protocol_not_locked");
  if (protocol?.consumedHoldout === true) failures.push("holdout_consumed_in_ci_fixture");
  if (protocolAudit?.ok !== true) failures.push("protocol_audit_failed");
  if (readiness?.safety?.liveTradingEnabled !== false) failures.push("live_trading_not_false");
  if (readiness?.safety?.dryRun !== true) failures.push("dry_run_not_true");
  if (readiness?.safety?.manualApprovalRequired !== true) failures.push("manual_approval_not_true");
  if (readiness?.safety?.canPlaceOrders !== false) failures.push("usage_readiness_can_place_orders_not_false");

  const summary = {
    schemaVersion: "dogeedge.ci-evidence-summary.v1",
    generatedAt: new Date().toISOString(),
    root,
    ok: failures.length === 0,
    failures,
    replay: {
      targetCoverageRatio: replayCoverage?.targetMarketCoverage?.ratio ?? replayCoverage?.coverage?.ratio ?? null,
      replayGradeMarketCount: replayCoverage?.replayGradeMarketCount ?? replayCoverage?.markets?.filter?.((row) => row.replayGradeAvailable === true).length ?? null,
    },
    dataset: {
      datasetHash: datasetManifest?.datasetHash ?? null,
      marketCount: Number(datasetManifest?.marketCount ?? 0),
      decisionFrameCount: Number(datasetManifest?.decisionFrameCount ?? datasetQuality?.decisionFrameCount ?? 0),
      distinctDayCount: Number(datasetQuality?.distinctDayCount ?? 0),
      leakageCheckPassed: datasetQuality?.leakageCheckPassed === true,
    },
    simulator: {
      schemaVersion: calibration?.schemaVersion ?? null,
      datasetMarketCount: Number(calibration?.datasetMarketCount ?? 0),
      replayEventCount: Number(calibration?.replayEventCount ?? 0),
      scenarios: calibration?.scenarios ? Object.keys(calibration.scenarios) : [],
      makerSimulationEnabled: calibration?.makerSimulationEnabled === true,
      canPlaceOrders: calibration?.canPlaceOrders === true,
    },
    parity: {
      schemaVersion: parity?.schemaVersion ?? null,
      diagnosticReady: parity?.diagnosticReady === true,
      canPlaceOrders: parity?.canPlaceOrders === true,
    },
    protocol: {
      protocolHash: protocol?.protocolHash ?? null,
      locked: protocol?.locked === true,
      consumedHoldout: protocol?.consumedHoldout === true,
      trainMarketCount: protocol?.trainMarketIds?.length ?? 0,
      validationMarketCount: protocol?.validationMarketIds?.length ?? 0,
      holdoutMarketCount: protocol?.lockedHoldoutMarketIds?.length ?? 0,
      auditOk: protocolAudit?.ok === true,
    },
    readiness: {
      currentStage: readiness?.currentStage ?? "unknown",
      pipelineOperational: readiness?.pipelineOperational === true,
      diagnosticEvidenceAvailable: readiness?.diagnosticEvidenceAvailable === true,
      researchSearchEnabled: readiness?.researchSearchEnabled === true,
      paperCandidateAvailable: readiness?.paperCandidateAvailable === true,
      extendedPaperValidated: readiness?.extendedPaperValidated === true,
      tinyLiveEligible: readiness?.tinyLiveEligible === true,
      liveEnabled: readiness?.liveEnabled === true,
      blockers: readiness?.blockers ?? [],
      safety: readiness?.safety ?? null,
    },
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "ci-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "ci-summary.md"), markdownSummary(summary), "utf8");
  console.log(`CI evidence summary: ${summary.ok ? "ok" : "failed"} -> ${path.join(outDir, "ci-summary.json")}`);
  if (!summary.ok) {
    console.error(`CI evidence summary failures: ${summary.failures.join(", ")}`);
    process.exitCode = 1;
  }
}

function markdownSummary(summary) {
  return [
    "# DogeEdge CI Evidence Summary",
    "",
    `Status: ${summary.ok ? "ok" : "failed"}`,
    "",
    "| Area | Value |",
    "|---|---:|",
    `| Dataset markets | ${summary.dataset.marketCount} |`,
    `| Decision frames | ${summary.dataset.decisionFrameCount} |`,
    `| Replay events | ${summary.simulator.replayEventCount} |`,
    `| Protocol locked | ${summary.protocol.locked} |`,
    `| Holdout consumed | ${summary.protocol.consumedHoldout} |`,
    `| Usage stage | ${summary.readiness.currentStage} |`,
    `| Live enabled | ${summary.readiness.liveEnabled} |`,
    "",
    "## Failures",
    "",
    summary.failures.length ? summary.failures.map((failure) => `- ${failure}`).join("\n") : "- None.",
    "",
  ].join("\n");
}

async function readJsonMaybe(filePath) {
  try {
    await access(filePath);
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
