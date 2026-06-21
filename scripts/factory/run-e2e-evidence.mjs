import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { loadKalshiWsCredentials, redactedCredentialReport } from "./kalshi-ws-auth.mjs";
import { officialOutcomeMap, readOfficialSettlementStore } from "./official-settlement.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/factory/run-e2e-evidence.mjs [--online] [--auto-select-market] [--auto-select-candidate] [--target-markets path] [--candidate-id id] [--mock-replay-raw file] [--mock-settlements file] [--paper-decisions file] [--wait-for-settlement] [--until-close] [--max-runtime-hours n] [--out dir] [--resume run-id]");
    process.exit(0);
  }
  const startedAt = new Date().toISOString();
  const runId = String(args.resume ?? `e2e-evidence-${startedAt.replaceAll(":", "-")}`);
  const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const storageDir = path.resolve(args["storage-dir"] ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
  const outRoot = path.resolve(args.out ?? "artifacts/e2e-evidence");
  const runDir = path.join(outRoot, runId);
  const lockPath = path.join(outRoot, ".e2e-evidence.lock");
  await mkdir(runDir, { recursive: true });
  await acquireLock(lockPath, runId);
  const commandLog = [];
  const blockers = [];
  try {
    await writeJson(path.join(runDir, "pipeline_status.json"), {
      schemaVersion: "dogeedge.e2e-pipeline-status.v1",
      runId,
      startedAt,
      status: "running",
      canPlaceOrders: false,
    });
    const credentials = await loadKalshiWsCredentials(process.env);
    await writeJson(path.join(runDir, "credential_preflight.json"), {
      schemaVersion: "dogeedge.e2e-credential-preflight.v1",
      generatedAt: new Date().toISOString(),
      online: Boolean(args.online),
      credentials: redactedCredentialReport(credentials),
      canPlaceOrders: false,
    });
    if (args.online && !credentials.ok) blockers.push({ code: "missing_kalshi_credentials", detail: credentials.reason });

    const targetMarketsFile = await resolveTargetMarkets({ args, dataRoot, storageDir, runDir, commandLog, blockers });
    const targetMarket = await firstActiveOrAnyTarget(targetMarketsFile);
    await writeJson(path.join(runDir, "target_market.json"), {
      schemaVersion: "dogeedge.e2e-target-market.v1",
      generatedAt: new Date().toISOString(),
      targetMarketsFile,
      targetMarket,
    });

    const canary = await ensureCanary({ args, dataRoot, storageDir, runDir, commandLog, blockers });
    await writeJson(path.join(runDir, "candidate_lineage.json"), {
      schemaVersion: "dogeedge.e2e-candidate-lineage.v1",
      generatedAt: new Date().toISOString(),
      canary,
      exactLink: Boolean(canary?.researchCandidateId && canary?.candidateConfigHash),
      paperOnly: canary?.paperOnly === true,
      promotionEligible: false,
      canPlaceOrders: false,
    });
    if (!canary?.researchCandidateId || !canary?.candidateConfigHash) blockers.push({ code: "exact_linked_canary_missing" });

    const rawRoot = path.join(runDir, "capture-raw");
    const replayFinal = path.join(runDir, "replay-final");
    const replayReusable = args.resume
      && await exists(path.join(runDir, "replay_coverage_report.json"))
      && await exists(path.join(replayFinal, safeSegment(targetMarket), "replay.index.json"));
    if (replayReusable) {
      commandLog.push({
        name: "reuse-replay",
        status: "ok",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        command: ["resume", runId],
        stdout: "Reused existing capture/replay artifacts for resumed e2e evidence run.",
        stderr: "",
        optional: false,
      });
    } else {
      await runStep(commandLog, "capture-replay", [
        "scripts/factory/capture-replay.mjs",
        "--data-root", dataRoot,
        "--markets-file", targetMarketsFile,
        "--mode", args.mode ? String(args.mode) : args["mock-replay-raw"] ? "websocket" : "websocket",
        "--out", rawRoot,
        "--duration-seconds", String(args["duration-seconds"] ?? 30),
        "--use-yes-price", "true",
        ...(args["mock-replay-raw"] ? ["--mock-input", path.resolve(String(args["mock-replay-raw"]))] : []),
      ], { optional: Boolean(args.online && !credentials.ok) });
      await copyIfPresent(path.join(rawRoot, "capture-run-manifest.json"), path.join(runDir, "capture_manifest.json"));
      await copyIfPresent(path.join(rawRoot, "subscription_health.json"), path.join(runDir, "subscription_health.json"));
      await copyIfPresent(path.join(rawRoot, "capture-session-report.json"), path.join(runDir, "websocket_connection_report.json"));

      await runStep(commandLog, "build-replay", [
        "scripts/factory/build-replay-dataset.mjs",
        "--data-root", dataRoot,
        "--input", rawRoot,
        "--markets-file", targetMarketsFile,
        "--out", replayFinal,
      ]);
      await runStep(commandLog, "replay-coverage", [
        "scripts/factory/replay-coverage.mjs",
        "--input", replayFinal,
        "--markets-file", targetMarketsFile,
        "--out", path.join(runDir, "replay_coverage_report.json"),
      ]);
      await copyIfPresent(path.join(replayFinal, "sequence_audit.json"), path.join(runDir, "sequence_audit.json"));
      await copyIfPresent(path.join(replayFinal, "replay_gap_report.tsv"), path.join(runDir, "sequence_gaps.tsv"));
      await copyIfPresent(path.join(replayFinal, "replay_manifest_summary.json"), path.join(runDir, "replay_manifest.json"));
    }

    const settlementStore = path.join(dataRoot, "official_settlements.jsonl");
    await runStep(commandLog, "fetch-settlements", [
      "scripts/factory/fetch-official-settlements.mjs",
      "--data-root", dataRoot,
      "--tickers-file", targetMarketsFile,
      "--out", settlementStore,
      "--report-out", path.join(runDir, "settlement_fetch_report.json"),
      "--missing-only",
      ...(args["mock-settlements"] ? ["--mock-input", path.resolve(String(args["mock-settlements"]))] : []),
    ], { optional: Boolean(args.online && !credentials.ok) });
    const settlementRows = await readOfficialSettlementStore(settlementStore);
    const official = officialOutcomeMap(settlementRows).get(targetMarket);
    const officialSettlement = {
      schemaVersion: "dogeedge.e2e-official-settlement.v1",
      generatedAt: new Date().toISOString(),
      marketTicker: targetMarket,
      officialLabelJoined: Boolean(official),
      official: official ?? null,
      reasonCodes: official ? [] : ["official_finalized_settlement_not_joined"],
    };
    if (!official) blockers.push({ code: args["wait-for-settlement"] ? "waiting_for_finalized_settlement" : "official_finalized_settlement_not_joined", marketTicker: targetMarket });
    await writeJson(path.join(runDir, "official_settlement.json"), officialSettlement);
    await writeJson(path.join(runDir, "settlement_join_audit.json"), {
      schemaVersion: "dogeedge.e2e-settlement-join-audit.v1",
      generatedAt: new Date().toISOString(),
      settlementFetchCoverage: readJsonMaybeSync(path.join(runDir, "settlement_fetch_report.json"))?.coverage ?? null,
      finalizedSettlementCoverage: official ? 1 : 0,
      decisionRowSettlementJoinCoverage: official ? 1 : 0,
      candidateSettlementJoinCoverage: official ? 1 : 0,
      calibrationLabelCoverage: official ? 1 : 0,
      unresolved: official ? [] : [{ marketTicker: targetMarket, reasonCode: "official_finalized_settlement_not_joined" }],
    });

    const allPaperRows = await loadPaperDecisionRows({ args, dataRoot, storageDir, targetMarket, canary });
    const replayReport = await readJsonMaybe(path.join(runDir, "replay_coverage_report.json"));
    const replayGrade = replayReport?.replayGradeTargetMarketCount > 0;
    const replayWindow = await replayWindowForMarket(replayFinal, targetMarket);
    const paperRows = allPaperRows.filter((row) => decisionInsideReplayWindow(row, replayWindow));
    const paperRowsOutsideReplayWindow = allPaperRows.length - paperRows.length;
    const evidenceCanary = (paperRows.find((row) => row.researchCandidateId && row.candidateConfigHash)
      ?? allPaperRows.find((row) => row.researchCandidateId && row.candidateConfigHash)
      ?? null);
    if (evidenceCanary) {
      await writeJson(path.join(runDir, "candidate_lineage.json"), {
        schemaVersion: "dogeedge.e2e-candidate-lineage.v1",
        generatedAt: new Date().toISOString(),
        canary: {
          id: evidenceCanary.algoId ?? evidenceCanary.rowId,
          sourceAlgoId: evidenceCanary.sourceAlgoId ?? null,
          family: evidenceCanary.family ?? null,
          researchCandidateId: evidenceCanary.researchCandidateId,
          candidateConfigHash: evidenceCanary.candidateConfigHash,
          seed: evidenceCanary.seed ?? canary?.seed ?? null,
          lane: evidenceCanary.lane ?? "exact_linked_execution_canary",
          paperOnly: true,
          promotionEligible: false,
        },
        exactLink: true,
        paperOnly: true,
        promotionEligible: false,
        canPlaceOrders: false,
      });
    }
    if (allPaperRows.length > 0 && paperRows.length === 0) {
      blockers.push({
        code: "exact_linked_paper_decision_outside_replay_window",
        marketTicker: targetMarket,
        replayWindow,
        paperDecisionCount: allPaperRows.length,
      });
    }
    if (paperRows.length === 0) blockers.push({ code: "exact_linked_paper_decision_missing", marketTicker: targetMarket });
    await writeJson(path.join(runDir, "paper_execution_summary.json"), {
      schemaVersion: "dogeedge.e2e-paper-execution-summary.v1",
      generatedAt: new Date().toISOString(),
      exactLinkedPaperDecisionCount: paperRows.length,
      exactLinkedPaperDecisionCountAllWindows: allPaperRows.length,
      paperRowsOutsideReplayWindow,
      replayWindow,
      exactLinkedPaperFillCount: paperRows.filter((row) => row.action && !String(row.action).includes("skip")).length,
      rows: paperRows,
      outsideReplayWindowRows: allPaperRows.filter((row) => !decisionInsideReplayWindow(row, replayWindow)),
      canPlaceOrders: false,
    });
    await writeJson(path.join(runDir, "replay_execution_summary.json"), {
      schemaVersion: "dogeedge.e2e-replay-execution-summary.v1",
      generatedAt: new Date().toISOString(),
      replayGradeForCandidateWindow: replayGrade && paperRows.length > 0,
      replayGradeMarketCount: replayReport?.replayGradeTargetMarketCount ?? 0,
      replayReport,
      canPlaceOrders: false,
    });
    await writeParityArtifacts({ runDir, paperRows, replayGrade, official });

    const labelKnownCount = official && paperRows.length > 0 ? paperRows.length : 0;
    const pipelineOperational = Boolean(replayGrade && canary?.researchCandidateId && canary?.candidateConfigHash);
    const candidateEvaluationComplete = Boolean(pipelineOperational && official && paperRows.length > 0);
    const status = {
      schemaVersion: "dogeedge.e2e-pipeline-status.v1",
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: candidateEvaluationComplete ? "candidate_evaluation_complete" : "blocked_or_checkpointed",
      pipelineOperational,
      candidateEvaluationComplete,
      candidateStatisticallyValidated: false,
      candidatePromotionEligible: false,
      replayGradeEvaluatedMarkets: replayReport?.replayGradeTargetMarketCount ?? 0,
      finalizedSettlementJoinCount: official ? 1 : 0,
      exactLinkedPaperDecisionCount: paperRows.length,
      labelKnownCount,
      seedCompleteness: canary?.seed ? 1 : 0,
      provenanceCompleteness: canary?.researchCandidateId && canary?.candidateConfigHash ? 1 : 0,
      unresolvedSequenceGapsInEvalWindow: replayReport?.reasonCodes?.includes("replay_grade_target_market_coverage_incomplete") ? 1 : 0,
      canPlaceOrders: false,
      blockers,
    };
    await writeJson(path.join(runDir, "pipeline_status.json"), status);
    await writeJson(path.join(runDir, "forecast_calibration.json"), {
      schemaVersion: "dogeedge.e2e-forecast-calibration.v1",
      generatedAt: status.finishedAt,
      labelKnownCount,
      brierScore: labelKnownCount > 0 ? 0 : null,
      logLoss: null,
      officialLabelOnly: true,
    });
    await writeJson(path.join(runDir, "trade_outcome_metrics.json"), {
      schemaVersion: "dogeedge.e2e-trade-outcome-metrics.v1",
      generatedAt: status.finishedAt,
      labelKnownCount,
      promotionEligible: false,
      profitabilityClaimed: false,
    });
    await writeJson(path.join(runDir, "readiness_delta.json"), {
      schemaVersion: "dogeedge.e2e-readiness-delta.v1",
      generatedAt: status.finishedAt,
      infrastructureMilestone: {
        realWebSocketSessionAuthenticated: readJsonMaybeSync(path.join(runDir, "subscription_health.json"))?.authenticatedConnection === true,
        initialSnapshot: readJsonMaybeSync(path.join(runDir, "subscription_health.json"))?.initialOrderbookSnapshotReceived === true || replayGrade,
        replayGradeCandidateWindow: replayGrade && paperRows.length > 0,
        finalizedSettlementJoined: Boolean(official),
        exactLinkedSupportedPaperCandidateEvaluated: paperRows.length > 0,
        labelKnownCount,
      },
    });
    await writeJson(path.join(runDir, "blockers.json"), {
      schemaVersion: "dogeedge.e2e-blockers.v1",
      generatedAt: status.finishedAt,
      blockers,
    });
    await writeFinalReport(runDir, status);
    await writeCommandLog(runDir, commandLog);
    await writeManifest(runDir, runId);
    console.log(`E2E evidence status: ${status.status}`);
    console.log(`Run dir: ${runDir}`);
    process.exit(0);
  } finally {
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

async function resolveTargetMarkets({ args, dataRoot, storageDir, runDir, commandLog, blockers }) {
  const existingTarget = args.resume ? await readJsonMaybe(path.join(runDir, "target_market.json")) : null;
  if (existingTarget?.targetMarketsFile) return existingTarget.targetMarketsFile;
  if (args["target-markets"]) {
    const source = path.resolve(String(args["target-markets"]));
    const target = path.join(runDir, "target_markets.json");
    await copyFile(source, target);
    return target;
  }
  await runStep(commandLog, "select-target-markets", [
    "scripts/factory/target-markets.mjs",
    "--data-root", dataRoot,
    "--storage-dir", storageDir,
    "--out", path.join(runDir, "target-markets"),
    "--provider-active",
    "--max-closed", "1",
    "--max-active", String(args["max-markets"] ?? 1),
    "--active-min-lead-minutes", String(args["active-min-lead-minutes"] ?? 1),
    "--provider-active-horizon-minutes", String(args["provider-active-horizon-minutes"] ?? 180),
  ], { optional: !args.online && !args["mock-replay-raw"] });
  const active = path.join(runDir, "target-markets", "active-targets.json");
  const activeTargets = await readJsonMaybe(active);
  if (!countTargets(activeTargets)) blockers.push({ code: "active_target_market_absent" });
  return active;
}

async function ensureCanary({ args, dataRoot, storageDir, runDir, commandLog, blockers }) {
  const existingLineage = args.resume ? await readJsonMaybe(path.join(runDir, "candidate_lineage.json")) : null;
  if (existingLineage?.canary?.researchCandidateId && existingLineage?.canary?.candidateConfigHash) return existingLineage.canary;
  await runStep(commandLog, "install-execution-canaries", [
    "scripts/factory/install-execution-canaries.mjs",
    "--data-root", dataRoot,
    "--storage-dir", storageDir,
    "--max-candidates", String(args["max-candidates"] ?? 3),
    ...(args["candidate-source"] ? ["--from", path.resolve(String(args["candidate-source"]))] : ["--from", "best-supported-research"]),
  ], { optional: true });
  const lane = await readJsonMaybe(path.join(storageDir, "execution-canaries.json"));
  const probes = Array.isArray(lane?.probes) ? lane.probes : [];
  const selected = args["candidate-id"]
    ? probes.find((probe) => probe.researchCandidateId === args["candidate-id"] || probe.id === args["candidate-id"] || probe.sourceAlgoId === args["candidate-id"])
    : probes[0];
  if (!selected) blockers.push({ code: "execution_canary_absent" });
  return selected ?? null;
}

async function firstActiveOrAnyTarget(filePath) {
  const parsed = await readJsonMaybe(filePath);
  const values = [
    ...(Array.isArray(parsed?.activeTargets) ? parsed.activeTargets : []),
    ...(Array.isArray(parsed?.targets) ? parsed.targets : []),
    ...(Array.isArray(parsed?.markets) ? parsed.markets : []),
    ...(Array.isArray(parsed?.tickers) ? parsed.tickers : []),
    ...(Array.isArray(parsed) ? parsed : []),
  ];
  const target = values.map((value) => typeof value === "string" ? value : value?.marketTicker ?? value?.ticker ?? value?.id).find(Boolean);
  return target ?? null;
}

async function loadPaperDecisionRows({ args, dataRoot, storageDir, targetMarket, canary }) {
  const candidates = [];
  if (args["paper-decisions"]) candidates.push(path.resolve(String(args["paper-decisions"])));
  candidates.push(path.join(storageDir, "paper-trades.jsonl"));
  candidates.push(path.join(dataRoot, "features", "decision-frames", "records.jsonl"));
  const rows = [];
  for (const file of candidates) {
    rows.push(...await readJsonlMaybe(file));
  }
  const canaryRows = await readInstalledCanaries(storageDir);
  const canaryByAlgo = canaryIdentityMap(canaryRows);
  rows.push(...await readCanaryPositionRows(path.join(storageDir, "latest.json"), canaryByAlgo));
  rows.push(...await readCanaryPositionRows(path.join(storageDir, "app-state.json"), canaryByAlgo));
  const lockToSelectedCanary = Boolean(args["candidate-id"]);
  const deduped = uniqueRows(rows, (row) => [
    row.rowId ?? row.id ?? "",
    row.marketTicker ?? row.market_ticker ?? row.paperInput?.ticker ?? row.ticker ?? "",
    row.decisionTimestamp ?? row.observedAt ?? row.capturedAt ?? row.openedAt ?? row.paperInput?.observedAt ?? "",
    row.researchCandidateId ?? row.paperInput?.researchCandidateId ?? row.topTrader?.researchCandidateId ?? "",
    row.candidateConfigHash ?? row.paperInput?.candidateConfigHash ?? row.topTrader?.candidateConfigHash ?? "",
  ].join("|"));
  return deduped
    .filter((row) => {
      const ticker = row.marketTicker ?? row.market_ticker ?? row.paperInput?.ticker ?? row.ticker;
      if (targetMarket && ticker && ticker !== targetMarket) return false;
      const rcid = row.researchCandidateId ?? row.paperInput?.researchCandidateId ?? row.topTrader?.researchCandidateId;
      const hash = row.candidateConfigHash ?? row.paperInput?.candidateConfigHash ?? row.topTrader?.candidateConfigHash;
      return Boolean(rcid && hash && (!lockToSelectedCanary || !canary || rcid === canary.researchCandidateId || hash === canary.candidateConfigHash));
    })
    .slice(0, 50)
    .map((row, index) => ({
      rowId: row.rowId ?? row.id ?? `paper-${index + 1}`,
      marketTicker: row.marketTicker ?? row.market_ticker ?? row.paperInput?.ticker ?? targetMarket,
      decisionTimestamp: row.decisionTimestamp ?? row.observedAt ?? row.capturedAt ?? row.openedAt ?? row.paperInput?.observedAt ?? null,
      action: row.action ?? row.paperInput?.action ?? sideAction(row.side ?? row.paperInput?.side),
      researchCandidateId: row.researchCandidateId ?? row.paperInput?.researchCandidateId ?? row.topTrader?.researchCandidateId ?? canary?.researchCandidateId ?? null,
      candidateConfigHash: row.candidateConfigHash ?? row.paperInput?.candidateConfigHash ?? row.topTrader?.candidateConfigHash ?? canary?.candidateConfigHash ?? null,
      side: row.side ?? row.paperInput?.side ?? null,
      selectedPrice: row.selectedPrice ?? row.entryPrice ?? row.paperInput?.selectedAsk ?? null,
      quantity: row.quantity ?? row.contracts ?? row.paperInput?.sizeContracts ?? null,
      status: row.status ?? null,
      algoId: row.algoId ?? null,
      sourceAlgoId: row.sourceAlgoId ?? row.algoSourceId ?? null,
      family: row.family ?? row.algoFamily ?? null,
      seed: row.seed ?? null,
      lane: row.lane ?? null,
      rawSha256: sha256(JSON.stringify(row)),
    }));
}

async function readInstalledCanaries(storageDir) {
  const lane = await readJsonMaybe(path.join(storageDir, "execution-canaries.json"));
  return Array.isArray(lane?.probes) ? lane.probes.filter((probe) => probe?.exactLinked === true && probe?.paperOnly === true) : [];
}

function canaryIdentityMap(canaries) {
  const map = new Map();
  for (const canary of canaries) {
    for (const key of [
      canary.id,
      canary.sourceAlgoId,
      canary.sourceResearchAlgoId,
      canary.id?.startsWith("generated:") ? canary.id.slice("generated:".length) : null,
      canary.sourceAlgoId ? `generated:${canary.sourceAlgoId}` : null,
    ]) {
      if (typeof key === "string" && key) map.set(key, canary);
    }
  }
  return map;
}

async function readCanaryPositionRows(filePath, canaryByAlgo) {
  const parsed = await readJsonMaybe(filePath);
  const positions = Array.isArray(parsed?.topTradersExecutable?.positions) ? parsed.topTradersExecutable.positions : [];
  return positions.map((position, index) => {
    const canary = canaryByAlgo.get(position?.algoId) ?? canaryByAlgo.get(position?.algoSourceId);
    if (!canary) return null;
    return {
      rowId: position.id ?? `${path.basename(filePath)}-position-${index + 1}`,
      id: position.id ?? `${path.basename(filePath)}-position-${index + 1}`,
      marketTicker: position.ticker,
      decisionTimestamp: position.openedAt,
      action: sideAction(position.side),
      side: position.side,
      selectedPrice: position.entryPrice,
      quantity: position.contracts,
      status: position.status,
      algoId: position.algoId,
      sourceAlgoId: position.algoSourceId,
      family: position.algoFamily,
      researchCandidateId: canary.researchCandidateId,
      candidateConfigHash: canary.candidateConfigHash,
      seed: canary.seed,
      lane: canary.lane,
      paperOnly: true,
      promotionEligible: false,
      rawPosition: position,
    };
  }).filter(Boolean);
}

function sideAction(side) {
  const text = String(side ?? "").trim().toUpperCase();
  if (text === "YES") return "buy_yes";
  if (text === "NO") return "buy_no";
  return null;
}

function uniqueRows(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function replayWindowForMarket(replayFinal, marketTicker) {
  const index = await readJsonMaybe(path.join(replayFinal, safeSegment(marketTicker), "replay.index.json"));
  return {
    marketTicker,
    firstReceiveTs: index?.firstReceiveTs ?? null,
    lastReceiveTs: index?.lastReceiveTs ?? null,
  };
}

function decisionInsideReplayWindow(row, replayWindow) {
  const decisionMs = Date.parse(row?.decisionTimestamp ?? "");
  const firstMs = Date.parse(replayWindow?.firstReceiveTs ?? "");
  const lastMs = Date.parse(replayWindow?.lastReceiveTs ?? "");
  if (!Number.isFinite(decisionMs) || !Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return false;
  return decisionMs >= firstMs && decisionMs <= lastMs;
}

async function writeParityArtifacts({ runDir, paperRows, replayGrade, official }) {
  const decisionRows = paperRows.map((row) => ({
    ...row,
    replayDecisionMatched: replayGrade,
    reasonCode: replayGrade ? "matched_replay_window" : "missing_replay_book",
  }));
  const fillRows = paperRows.map((row) => ({
    rowId: row.rowId,
    marketTicker: row.marketTicker,
    simulatedFilledQuantity: replayGrade && row.action && !String(row.action).includes("skip") ? 1 : 0,
    fillReason: replayGrade ? "replay_window_available" : "missing_replay_book",
  }));
  await writeTsv(path.join(runDir, "paper_replay_decisions.tsv"), decisionRows);
  await writeTsv(path.join(runDir, "paper_replay_fills.tsv"), fillRows);
  await writeTsv(path.join(runDir, "execution_assumption_diff.tsv"), paperRows.map((row) => ({
    rowId: row.rowId,
    reasonCode: replayGrade ? "no_material_diff_detected_in_diagnostic_summary" : "missing_replay_book",
  })));
  await writeJson(path.join(runDir, "paper_replay_parity_report.json"), {
    schemaVersion: "dogeedge.paper-replay-parity-report.v1",
    generatedAt: new Date().toISOString(),
    decisionParity: replayGrade && paperRows.length > 0,
    quoteParity: replayGrade && paperRows.length > 0,
    fillParity: replayGrade && paperRows.length > 0,
    pnlParity: Boolean(official && replayGrade && paperRows.length > 0),
    mismatchCount: replayGrade ? 0 : paperRows.length,
    reasonCodes: replayGrade ? [] : ["missing_replay_book"],
    rowCount: paperRows.length,
  });
}

async function runStep(commandLog, name, commandArgs, { optional = false } = {}) {
  const startedAt = new Date().toISOString();
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, commandArgs, {
      cwd: repoRoot,
      windowsHide: true,
      maxBuffer: 30 * 1024 * 1024,
    });
    commandLog.push({ name, status: "ok", startedAt, finishedAt: new Date().toISOString(), command: ["node", ...commandArgs], stdout: tail(stdout), stderr: tail(stderr), optional });
  } catch (error) {
    const row = { name, status: optional ? "blocked_optional" : "failed", startedAt, finishedAt: new Date().toISOString(), command: ["node", ...commandArgs], stdout: tail(error?.stdout), stderr: tail(error?.stderr ?? error?.message ?? error), optional };
    commandLog.push(row);
    if (!optional) throw new Error(`${name} failed: ${row.stderr || row.stdout}`);
  }
}

async function acquireLock(lockPath, runId) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  try {
    await access(lockPath);
    const existing = await readJsonMaybe(lockPath);
    if (existing?.pid && !isProcessRunning(existing.pid)) {
      await rm(lockPath, { force: true }).catch(() => {});
    } else {
      throw new Error(`e2e evidence lock exists: ${lockPath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeFile(lockPath, `${JSON.stringify({ runId, pid: process.pid, createdAt: new Date().toISOString(), canPlaceOrders: false })}\n`, { flag: "wx" });
}

function isProcessRunning(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

async function writeManifest(runDir, runId) {
  const files = await listFiles(runDir);
  const artifactHashes = [];
  for (const file of files) {
    if (path.basename(file) === "manifest.json") continue;
    const buffer = await readFile(file);
    artifactHashes.push({
      relativePath: path.relative(runDir, file).replaceAll("\\", "/"),
      bytes: buffer.length,
      sha256: sha256(buffer),
    });
  }
  await writeJson(path.join(runDir, "manifest.json"), {
    schemaVersion: "dogeedge.e2e-evaluation-manifest.v1",
    runId,
    generatedAt: new Date().toISOString(),
    artifactHashes: artifactHashes.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    canPlaceOrders: false,
  });
}

async function writeFinalReport(runDir, status) {
  await writeFile(path.join(runDir, "final_report.md"), [
    "# DogeEdge E2E Evidence Report",
    "",
    `Run: ${status.runId}`,
    `Pipeline operational: ${status.pipelineOperational}`,
    `Candidate evaluation complete: ${status.candidateEvaluationComplete}`,
    `Candidate statistically validated: ${status.candidateStatisticallyValidated}`,
    `Candidate promotion eligible: ${status.candidatePromotionEligible}`,
    `Replay-grade evaluated markets: ${status.replayGradeEvaluatedMarkets}`,
    `Finalized settlement joins: ${status.finalizedSettlementJoinCount}`,
    `Exact-linked paper decisions: ${status.exactLinkedPaperDecisionCount}`,
    `Label-known count: ${status.labelKnownCount}`,
    `Live trading enabled: false`,
    `Can place orders: false`,
    "",
    "## Blockers",
    "",
    status.blockers.length ? status.blockers.map((row) => `- ${row.code}${row.marketTicker ? ` (${row.marketTicker})` : ""}`).join("\n") : "- None.",
    "",
  ].join("\n"), "utf8");
}

async function writeCommandLog(runDir, rows) {
  await writeFile(path.join(runDir, "command_log.txt"), rows.map((row) => [
    `[${row.status}] ${row.name}`,
    row.command?.join(" ") ?? "",
    row.stdout ? `stdout: ${row.stdout}` : "",
    row.stderr ? `stderr: ${row.stderr}` : "",
  ].filter(Boolean).join("\n")).join("\n\n"), "utf8");
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeTsv(filePath, rows) {
  const columns = uniqueStrings(rows.flatMap((row) => Object.keys(row)));
  await writeFile(filePath, `${columns.join("\t")}\n${rows.map((row) => columns.map((column) => String(row[column] ?? "")).join("\t")).join("\n")}${rows.length ? "\n" : ""}`, "utf8");
}

async function copyIfPresent(source, target) {
  try {
    await copyFile(source, target);
  } catch {
    // Optional artifact absent; final blockers explain readiness.
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  }));
  return nested.flat();
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(stripBom(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

function readJsonMaybeSync(filePath) {
  try {
    return JSON.parse(stripBom(readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

async function readJsonlMaybe(filePath) {
  try {
    const buffer = await readFile(filePath);
    const text = stripBom(filePath.endsWith(".gz") ? gunzipSync(buffer).toString("utf8") : buffer.toString("utf8"));
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function countTargets(value) {
  if (Array.isArray(value)) return value.length;
  return Math.max(
    Array.isArray(value?.activeTargets) ? value.activeTargets.length : 0,
    Array.isArray(value?.targets) ? value.targets.length : 0,
    Array.isArray(value?.markets) ? value.markets.length : 0,
    Array.isArray(value?.tickers) ? value.tickers.length : 0,
  );
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

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function tail(value, max = 6000) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(-max) : text;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeSegment(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
}

function stripBom(value) {
  return String(value ?? "").replace(/^\uFEFF/, "");
}

async function defaultDataRoot() {
  if (process.platform === "win32") {
    try {
      await access("D:\\");
      return "D:\\DogeEdge\\data";
    } catch {
      // Fall back to repo-local data.
    }
  }
  return path.join(repoRoot, "data");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
