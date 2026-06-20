import { access, appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { researchCandidateIdentity, researchCandidateIdentityContext } from "./candidate-identity.mjs";
import { familyResearchSupported } from "./family-registry.mjs";
import { hashJson } from "./utils.mjs";

export const evidenceProbeLaneSchemaVersion = "dogeedge.evidence-probe-lane.v1";
export const evidenceProbeLaneKind = "exact_linked_evidence_probe";
export const executionCanaryLaneKind = "exact_linked_execution_canary";
export const supportedExecutionCanaryFamilies = Object.freeze(["sweep-scalp", "sweep-liquidity-imbalance"]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function selectEvidenceProbes(rows = [], { maxProbes = 5, allowInsufficientDataProbe = false, executableOnly = false } = {}) {
  const eligible = [];
  const rejected = [];
  for (const row of rows) {
    const check = evidenceProbeEligibility(row, { allowInsufficientDataProbe, executableOnly });
    if (!check.ok) {
      rejected.push({ algoId: row?.algoId ?? row?.id ?? "unknown", family: row?.family ?? "unknown", reasonCodes: check.reasonCodes });
      continue;
    }
    eligible.push(row);
  }
  const selectedRows = executableOnly
    ? selectDiverseExecutionCanaryRows(eligible, maxProbes)
    : eligible.slice(0, maxProbes);
  const selected = selectedRows.map((row) => evidenceProbeFromCandidate(row, executableOnly ? { laneKind: executionCanaryLaneKind } : {}));
  return { selected, rejected };
}

export function evidenceProbeEligibility(row = {}, { allowInsufficientDataProbe = false, executableOnly = false } = {}) {
  const reasonCodes = [];
  if (!row.researchCandidateId) reasonCodes.push("research_candidate_id_required");
  if (!row.candidateConfigHash) reasonCodes.push("candidate_config_hash_required");
  if (!familyResearchSupported(row.family)) reasonCodes.push("unsupported_family");
  if (executableOnly && !supportedExecutionCanaryFamilies.includes(row.family)) reasonCodes.push("not_supported_execution_canary_family");
  if (!isRecord(row.params)) reasonCodes.push("deterministic_params_required");
  const warnings = [...(Array.isArray(row.warnings) ? row.warnings : []), ...(Array.isArray(row.reasonCodes) ? row.reasonCodes : [])];
  if (warnings.some((code) => String(code).includes("leak") || String(code).includes("post_close") || String(code).includes("permissive_debug"))) {
    reasonCodes.push("leakage_or_temporal_warning");
  }
  const conservativePnl = numberOrDefault(row.conservativeTotalPnl, numberOrDefault(row.costModels?.conservative?.totalPnl, 0));
  if (conservativePnl < 0 && !(allowInsufficientDataProbe && row.promotionVerdict === "insufficient_data")) reasonCodes.push("negative_conservative_cost_pnl");
  if (executableOnly && numberOrDefault(row.params?.minEdge, 0) < 0) reasonCodes.push("negative_min_edge_execution_canary");
  const evidenceCount = Math.max(numberOrDefault(row.closed, 0), numberOrDefault(row.independentClosedMarkets, 0), numberOrDefault(row.walkForwardClosed, 0));
  if (evidenceCount <= 0) reasonCodes.push("minimal_event_or_trade_evidence_required");
  if (row.labelSource === "official_resolution" && row.settlementSource !== "official_resolution") reasonCodes.push("inconsistent_official_label_settlement");
  return { ok: reasonCodes.length === 0, reasonCodes };
}

function selectDiverseExecutionCanaryRows(rows, maxProbes) {
  if (maxProbes <= 0) return [];
  const sorted = [...rows].sort(compareExecutionCanaryCandidates);
  const selected = [];
  const selectedIds = new Set();
  const selectedSourceAlgoIds = new Set();
  const selectedFamilies = new Set();
  const selectedBuckets = new Set();
  for (const row of sorted) {
    if (selected.length >= maxProbes) break;
    if (!supportedExecutionCanaryFamilies.includes(row.family) || selectedFamilies.has(row.family) || selectedSourceAlgoIds.has(sourceAlgoKey(row))) continue;
    addSelected(row);
  }
  for (const bucket of ["yes", "no", "flex"]) {
    if (selected.length >= maxProbes) break;
    if (selectedBuckets.has(bucket)) continue;
    const row = sorted.find((candidate) => executionSideBucket(candidate) === bucket && !selectedIds.has(candidateKey(candidate)) && !selectedSourceAlgoIds.has(sourceAlgoKey(candidate)));
    if (!row) continue;
    addSelected(row);
  }
  for (const row of sorted) {
    if (selected.length >= maxProbes) break;
    const key = candidateKey(row);
    if (selectedIds.has(key)) continue;
    if (selectedSourceAlgoIds.has(sourceAlgoKey(row))) continue;
    addSelected(row);
  }
  return selected;

  function addSelected(row) {
    selected.push(row);
    selectedIds.add(candidateKey(row));
    selectedSourceAlgoIds.add(sourceAlgoKey(row));
    selectedFamilies.add(row.family);
    selectedBuckets.add(executionSideBucket(row));
  }
}

function executionSideBucket(row) {
  const rawSideMode = row?.params?.sideMode;
  const sideMode = String(rawSideMode ?? (row?.family === "sweep-scalp" ? "best" : "")).toLowerCase();
  if (sideMode === "yes-only") return "yes";
  if (sideMode === "no-only") return "no";
  if (["best", "hybrid", "pressure", "edge", "fair"].includes(sideMode)) return "flex";
  if (row?.family === "sweep-liquidity-imbalance") return "flex";
  return "unknown";
}

function compareExecutionCanaryCandidates(left, right) {
  return compareNumber(executionCanaryResearchScore(right), executionCanaryResearchScore(left))
    || compareNumber(executionReachScore(right), executionReachScore(left))
    || compareNumber(right.robustScore, left.robustScore)
    || compareNumber(conservativePnl(right), conservativePnl(left))
    || compareNumber(evidenceCount(right), evidenceCount(left))
    || String(left.algoId ?? left.id ?? "").localeCompare(String(right.algoId ?? right.id ?? ""));
}

function executionCanaryResearchScore(row) {
  const holdout = isRecord(row?.holdoutSummary) ? row.holdoutSummary : {};
  return (row?.walkForwardPass ? 1000 : 0)
    + (numberOrDefault(row?.totalPnl, 0) > 0 ? 300 : 0)
    + (numberOrDefault(holdout.holdoutConservativeTotalPnl, numberOrDefault(row?.holdoutConservativeTotalPnl, 0)) > 0 ? 100 : 0)
    + Math.max(-50, Math.min(50, conservativePnl(row))) * 10
    + Math.max(-100, Math.min(100, numberOrDefault(row?.robustScore, 0))) * 2
    + Math.min(100, evidenceCount(row)) * 0.2;
}

function executionReachScore(row) {
  const params = isRecord(row?.params) ? row.params : {};
  const maxSpread = Math.max(0, Math.min(0.05, numberOrDefault(params.maxSpread, row?.family === "sweep-liquidity-imbalance" ? 0.04 : 0.01)));
  const minEdge = Math.max(0, numberOrDefault(params.minEdge, 0));
  const minBidDepth = Math.max(1, numberOrDefault(params.minBidDepth, 1));
  return (maxSpread * 100)
    - (minEdge * 10)
    - Math.log10(minBidDepth) * 0.05;
}

function conservativePnl(row) {
  return numberOrDefault(row?.conservativeTotalPnl, numberOrDefault(row?.costModels?.conservative?.totalPnl, 0));
}

function evidenceCount(row) {
  return Math.max(numberOrDefault(row?.closed, 0), numberOrDefault(row?.independentClosedMarkets, 0), numberOrDefault(row?.walkForwardClosed, 0));
}

function compareNumber(left, right) {
  return numberOrDefault(left, -Infinity) - numberOrDefault(right, -Infinity);
}

function candidateKey(row) {
  return String(row?.researchCandidateId ?? row?.candidateConfigHash ?? row?.algoId ?? row?.id ?? JSON.stringify(row));
}

function sourceAlgoKey(row) {
  return String(row?.sourceAlgoId ?? row?.algoId ?? row?.id ?? "");
}

function dedupeCandidateRows(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = [
      row?.researchCandidateId ?? "",
      row?.candidateConfigHash ?? "",
      row?.sourceRunId ?? "",
      row?.algoId ?? row?.id ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

async function recentSupportedExecutionCanaryFallbackRows({
  dataRoot,
  primarySource = {},
  excludedSourceAlgoIds = new Set(),
  maxRuns = 24,
} = {}) {
  const sweepsDir = path.join(dataRoot, "backtests", "sweeps");
  let entries = [];
  try {
    entries = await readdir(sweepsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const primaryRunId = String(primarySource?.runId ?? "");
  const primaryRunDir = primarySource?.runDir ? path.resolve(String(primarySource.runDir)) : "";
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runDir = path.join(sweepsDir, entry.name);
    const info = await stat(runDir).catch(() => null);
    if (!info) continue;
    dirs.push({ runDir, mtimeMs: info.mtimeMs });
  }
  dirs.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const rows = [];
  for (const dir of dirs.slice(0, Math.max(0, Math.floor(maxRuns)))) {
    const runDir = path.resolve(dir.runDir);
    const source = await readRunDirectory(runDir).catch(() => null);
    if (!source) continue;
    if (primaryRunId && source.runId === primaryRunId) continue;
    if (primaryRunDir && path.resolve(source.runDir ?? "") === primaryRunDir) continue;
    for (const row of materializeExactLinkageForSource(source)) {
      const sourceAlgoId = String(row?.algoId ?? row?.id ?? row?.sourceAlgoId ?? "");
      if (excludedSourceAlgoIds.has(sourceAlgoId)) continue;
      if (!evidenceProbeEligibility(row, { executableOnly: true }).ok) continue;
      rows.push(row);
    }
  }
  return rows;
}

export function evidenceProbeFromCandidate(candidate, { laneKind = evidenceProbeLaneKind } = {}) {
  const sourceAlgoId = String(candidate.algoId ?? candidate.id);
  const promotedAt = new Date().toISOString();
  const executionCanary = laneKind === executionCanaryLaneKind;
  return {
    schemaVersion: evidenceProbeLaneSchemaVersion,
    lane: laneKind,
    evidenceStatus: executionCanary ? "execution_canary_only" : "evidence_probe_only",
    promotionEligibility: "not_promotion_eligible",
    paperOnly: true,
    exactLinked: true,
    enabled: true,
    id: `generated:${sourceAlgoId}`,
    displayId: candidate.displayId ?? sourceAlgoId,
    sourceAlgoId,
    researchCandidateId: candidate.researchCandidateId,
    candidateConfigHash: candidate.candidateConfigHash,
    sourceResearchAlgoId: candidate.sourceResearchAlgoId ?? sourceAlgoId,
    sourceRunId: candidate.sourceRunId ?? null,
    sourceSnapshotHash: candidate.sourceSnapshotHash ?? null,
    promotionVerdictAtInstall: candidate.promotionVerdict ?? null,
    seed: candidate.seed ?? null,
    metricsVersion: candidate.metricsVersion ?? "dogeedge.factory.metrics.v1",
    executionVersion: candidate.executionModelVersion ?? "dogeedge.simulator.v1",
    name: candidate.algoName ?? candidate.name ?? sourceAlgoId,
    family: candidate.family,
    params: candidate.params ?? {},
    promotedAt,
    sourceMetrics: sourceMetricsFromCandidate(candidate),
    lineageHash: hashJson({
      researchCandidateId: candidate.researchCandidateId,
      candidateConfigHash: candidate.candidateConfigHash,
      sourceRunId: candidate.sourceRunId ?? null,
      sourceSnapshotHash: candidate.sourceSnapshotHash ?? null,
      sourceAlgoId,
    }),
  };
}

async function evidenceLaneCli() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/factory/evidence-lane.mjs [--from latest-sweep|best-supported-research|file] [--run-id id] [--max-probes n] [--data-root dir] [--storage-dir dir] [--allow-insufficient-data-probe] [--executable-only]");
    return;
  }
  const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const storageDir = path.resolve(args["storage-dir"] ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
  const source = await loadSourceSweep(args, dataRoot);
  const maxProbes = Math.max(0, Number(args["max-probes"] ?? 5));
  const executableOnly = Boolean(args["executable-only"] ?? args["execution-canary"] ?? args["execution-canaries"]);
  const excludedSourceAlgoIds = new Set(splitList(args["exclude-source-algos"]));
  const primaryRows = materializeExactLinkageForSource(source);
  const fallbackRows = executableOnly
    ? await recentSupportedExecutionCanaryFallbackRows({
      dataRoot,
      primarySource: source,
      excludedSourceAlgoIds,
      maxRuns: Number(args["fallback-run-count"] ?? 24),
    })
    : [];
  const rows = dedupeCandidateRows([...primaryRows, ...fallbackRows]);
  const candidateRows = excludedSourceAlgoIds.size > 0
    ? rows.filter((row) => !excludedSourceAlgoIds.has(String(row.algoId ?? row.id ?? row.sourceAlgoId ?? "")))
    : rows;
  const excludedRows = excludedSourceAlgoIds.size > 0
    ? rows
      .filter((row) => excludedSourceAlgoIds.has(String(row.algoId ?? row.id ?? row.sourceAlgoId ?? "")))
      .map((row) => ({
        algoId: row?.algoId ?? row?.id ?? row?.sourceAlgoId ?? "unknown",
        family: row?.family ?? "unknown",
        reasonCodes: ["excluded_unhealthy_execution_canary"],
      }))
    : [];
  const sorted = candidateRows.sort((left, right) => numberOrDefault(right.robustScore, 0) - numberOrDefault(left.robustScore, 0));
  const result = selectEvidenceProbes(sorted, {
    maxProbes,
    allowInsufficientDataProbe: Boolean(args["allow-insufficient-data-probe"]),
    executableOnly,
  });
  result.rejected = [...excludedRows, ...result.rejected];
  await mkdir(storageDir, { recursive: true });
  const laneKind = executableOnly ? executionCanaryLaneKind : evidenceProbeLaneKind;
  const lane = {
    schemaVersion: evidenceProbeLaneSchemaVersion,
    generatedAt: new Date().toISOString(),
    sourceRunId: source?.runId ?? null,
    maxProbes,
    paperOnly: true,
    canPlaceOrders: false,
    lane: laneKind,
    executableOnly,
    supportedExecutionCanaryFamilies: executableOnly ? supportedExecutionCanaryFamilies : [],
    sourceRunIds: uniqueStrings(result.selected.map((probe) => probe.sourceRunId).filter(Boolean)),
    fallbackCandidateRows: fallbackRows.length,
    excludedSourceAlgoIds: [...excludedSourceAlgoIds],
    probes: result.selected,
    rejected: result.rejected,
    summary: {
      installedProbeCount: result.selected.length,
      rejectedCandidateCount: result.rejected.length,
      exactLinkedProbeCount: result.selected.filter((probe) => probe.exactLinked).length,
      supportedFamilyProbeCount: result.selected.filter((probe) => familyResearchSupported(probe.family)).length,
      supportedExecutionCanaryCount: result.selected.filter((probe) => supportedExecutionCanaryFamilies.includes(probe.family)).length,
      fallbackCandidateRows: fallbackRows.length,
      researchValidatedRosterImpact: 0,
      reasonCodes: [
        ...(result.selected.length === 0 && executableOnly ? ["no_supported_execution_canary_candidates"] : []),
        ...(executableOnly && result.selected.length > 0 && result.selected.length < maxProbes ? ["insufficient_supported_execution_canary_candidates"] : []),
      ],
    },
  };
  const laneFile = executableOnly ? "execution-canaries.json" : "evidence-probes.json";
  const reportFile = executableOnly ? "execution-canary-report.json" : "evidence-probe-report.json";
  await writeFile(path.join(storageDir, laneFile), `${JSON.stringify(lane, null, 2)}\n`, "utf8");
  await writeFile(path.join(storageDir, reportFile), `${JSON.stringify(lane.summary, null, 2)}\n`, "utf8");
  if (executableOnly && lane.probes.length > 0 && args["skip-worker-install"] !== true) {
    await installExecutionCanariesForWorker(lane, storageDir);
  }
  console.log(`${executableOnly ? "Execution canary" : "Evidence probe"} lane reseed complete: ${lane.summary.installedProbeCount}/${maxProbes} probes`);
  console.log(`Output: ${path.join(storageDir, laneFile)}`);
}

export async function loadSourceSweep(args = {}, dataRoot = null) {
  const root = dataRoot ?? await defaultDataRoot();
  if (args["from-run-dir"]) return readRunDirectory(path.resolve(String(args["from-run-dir"])));
  if (args["run-id"]) {
    const runId = String(args["run-id"]);
    return readRunDirectory(path.join(root, "backtests", "sweeps", runId));
  }
  const from = String(args.from ?? "latest-sweep");
  if (from === "best-supported-research" || from === "latest-supported-research" || from === "latest-rich-sweep") {
    return loadBestSupportedResearchSweep(root);
  }
  if (from === "latest-sweep") return readJson(path.join(root, "backtests", "latest-sweep.json"));
  const resolved = path.resolve(from);
  try {
    const info = await stat(resolved);
    if (info.isDirectory()) return readRunDirectory(resolved);
  } catch {
    // Fall through to JSON-file input.
  }
  return readJson(resolved);
}

async function loadBestSupportedResearchSweep(dataRoot) {
  const sweepsDir = path.join(dataRoot, "backtests", "sweeps");
  let entries = [];
  try {
    entries = await readdir(sweepsDir, { withFileTypes: true });
  } catch {
    return readJson(path.join(dataRoot, "backtests", "latest-sweep.json"));
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runDir = path.join(sweepsDir, entry.name);
    const info = await stat(runDir).catch(() => null);
    if (info) dirs.push({ runDir, mtimeMs: info.mtimeMs });
  }
  dirs.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const candidates = [];
  for (const dir of dirs.slice(0, 24)) {
    const source = await readRunDirectory(dir.runDir).catch(() => null);
    if (!source) continue;
    const rows = materializeExactLinkageForSource(source);
    const eligibleRows = rows.filter((row) => evidenceProbeEligibility(row, { executableOnly: true }).ok);
    if (!eligibleRows.length) continue;
    const rowCount = rows.length;
    const richResearchRun = source.mode !== "promote-check"
      && (
        source.deepSweepMode === true
        || source.requestedDeepSweepMode === true
        || Number(source.algoCount ?? 0) > 150
        || rowCount > 150
      );
    candidates.push({
      source,
      mtimeMs: dir.mtimeMs,
      richResearchRun,
      eligibleCount: eligibleRows.length,
      rowCount,
    });
  }
  candidates.sort((left, right) => Number(right.richResearchRun) - Number(left.richResearchRun)
    || right.mtimeMs - left.mtimeMs
    || right.eligibleCount - left.eligibleCount);
  if (!candidates.length) return readJson(path.join(dataRoot, "backtests", "latest-sweep.json"));
  const selected = candidates[0];
  return {
    ...selected.source,
    sourceSelection: {
      mode: "best_supported_research",
      selectedRunId: selected.source.runId ?? null,
      selectedRunDir: selected.source.runDir ?? null,
      richResearchRun: selected.richResearchRun,
      eligibleExecutionCanaryCandidates: selected.eligibleCount,
      rowCount: selected.rowCount,
      fallbackUsed: false,
    },
  };
}

async function readRunDirectory(runDir) {
  const [config, candidates, metrics] = await Promise.all([
    readJson(path.join(runDir, "config.json")),
    readJsonMaybe(path.join(runDir, "candidates.json")),
    readJsonMaybe(path.join(runDir, "metrics.json")),
  ]);
  return {
    ...config,
    runDir,
    runId: config.runId ?? path.basename(runDir),
    candidates: Array.isArray(candidates) ? candidates : [],
    topMetrics: Array.isArray(metrics) ? metrics : [],
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function materializeExactLinkageForSource(source = {}) {
  const rows = [
    ...(Array.isArray(source?.candidates) ? source.candidates : []),
    ...(Array.isArray(source?.topMetrics) ? source.topMetrics : []),
  ];
  const context = researchCandidateIdentityContext({
    primaryRun: {
      runId: source?.runId ?? "",
      randomSeed: source?.randomSeed ?? source?.seed ?? source?.registry?.randomSeed ?? "",
      configHash: source?.registry?.configHash ?? "",
      sourceSnapshotHash: source?.registry?.inputManifestHash ?? source?.registry?.dataHash ?? "",
    },
    registry: source?.registry ?? {},
    costModels: source?.costModels ?? source?.registry?.costModels ?? source?.registry?.costModel ?? [],
    riskModel: source?.riskModel ?? source?.registry?.riskModel ?? {},
  });
  const sourceRunId = source?.runId ?? context.sourceRunId ?? null;
  const sourceSnapshotHash = source?.registry?.inputManifestHash ?? source?.registry?.dataHash ?? context.sourceSnapshotHash ?? null;
  const seed = source?.randomSeed ?? source?.seed ?? context.seed ?? null;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const identity = row.researchCandidateId && row.candidateConfigHash
      ? null
      : researchCandidateIdentity(row, context);
    return {
      ...row,
      researchCandidateId: row.researchCandidateId ?? identity?.researchCandidateId ?? null,
      candidateConfigHash: row.candidateConfigHash ?? identity?.candidateConfigHash ?? null,
      sourceResearchAlgoId: row.sourceResearchAlgoId ?? identity?.sourceResearchAlgoId ?? row.algoId ?? row.id ?? null,
      sourceRunId: row.sourceRunId ?? sourceRunId,
      sourceSnapshotHash: row.sourceSnapshotHash ?? sourceSnapshotHash,
      seed: row.seed ?? seed,
      metricsVersion: row.metricsVersion ?? context.metricsVersion ?? "dogeedge.factory.metrics.v1",
      executionVersion: row.executionVersion ?? context.executionModelVersion ?? "dogeedge.simulator.v1",
    };
  });
}

async function installExecutionCanariesForWorker(lane, storageDir) {
  const installedAt = lane.generatedAt ?? new Date().toISOString();
  const batch = executionCanaryFactoryBatch(lane.probes, installedAt);
  const appStatePath = path.join(storageDir, "app-state.json");
  const factoryBatchesPath = path.join(storageDir, "factory-batches.json");
  const executablePath = path.join(storageDir, "top-traders-executable.json");
  const latestPath = path.join(storageDir, "latest.json");
  const existingAppState = await readJsonMaybe(appStatePath) ?? {};
  const existingBatches = Array.isArray(existingAppState.factoryAlgoBatches) ? existingAppState.factoryAlgoBatches : [];
  const existingExecutableFile = await readJsonMaybe(executablePath);
  await archiveExecutionCanaryState(storageDir, existingBatches, existingExecutableFile?.topTradersExecutable, installedAt);
  const factoryAlgoBatches = mergeFactoryBatches([batch, ...existingBatches.filter((item) => !isExecutionCanaryFactoryBatch(item))]);
  const executable = mergeTopTradersExecutable(existingExecutableFile, lane.probes, installedAt);
  const appState = {
    ...existingAppState,
    storedAt: installedAt,
    factoryAlgoBatches,
    topTradersExecutable: executable,
  };
  const latest = {
    ...(await readJsonMaybe(latestPath) ?? {}),
    storedAt: installedAt,
    generatedPaperAlgoCount: Math.max(
      Number((await readJsonMaybe(latestPath))?.generatedPaperAlgoCount ?? 0),
      batch.algos.length,
    ),
    topTradersExecutable: executable,
    topTradersExecutableSummary: topTradersExecutableSummary(executable),
  };
  await writeFile(appStatePath, `${JSON.stringify(appState, null, 2)}\n`, "utf8");
  await writeFile(factoryBatchesPath, `${JSON.stringify({ storedAt: installedAt, factoryAlgoBatches }, null, 2)}\n`, "utf8");
  await writeFile(executablePath, `${JSON.stringify({ storedAt: installedAt, topTradersExecutable: executable }, null, 2)}\n`, "utf8");
  await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
}

function executionCanaryFactoryBatch(probes, installedAt) {
  const batchLetter = "E";
  const batchId = `factory-batch-batch-${batchLetter.toLowerCase()}-${Date.parse(installedAt).toString(36)}`;
  return {
    id: batchId,
    name: `Batch ${batchLetter}`,
    createdAt: installedAt,
    source: "Exact-linked execution canaries; paper-only and not promotion eligible",
    generation: 1,
    parentBatchIds: [],
    summary: {
      generation: 1,
      eliteCount: 0,
      mutationCount: 0,
      crossoverCount: 0,
      explorationCount: probes.length,
      avoidedFailureZones: 0,
      trainingSampleCount: probes.length,
      quarantinedSampleCount: 0,
      winnerCount: 0,
      failureCount: 0,
      parentBatchIds: [],
    },
    algos: probes.map((probe, index) => generatedAlgoFromProbe(probe, installedAt, batchLetter, index)),
  };
}

function generatedAlgoFromProbe(probe, installedAt, batchLetter, index) {
  return {
    id: probe.id,
    displayId: `${batchLetter}-${String(index + 1).padStart(4, "0")}`,
    sourceAlgoId: probe.sourceAlgoId,
    researchCandidateId: probe.researchCandidateId,
    candidateConfigHash: probe.candidateConfigHash,
    sourceResearchAlgoId: probe.sourceResearchAlgoId ?? probe.sourceAlgoId,
    sourceSnapshotHash: probe.sourceSnapshotHash ?? null,
    promotionVerdictAtInstall: probe.promotionVerdictAtInstall ?? null,
    lane: executionCanaryLaneKind,
    evidenceStatus: "execution_canary_only",
    promotionEligibility: "not_promotion_eligible",
    paperOnly: true,
    exactLinked: true,
    seed: probe.seed ?? null,
    metricsVersion: probe.metricsVersion ?? null,
    executionVersion: probe.executionVersion ?? null,
    lineageHash: probe.lineageHash ?? null,
    name: probe.name,
    family: probe.family,
    params: probe.params ?? {},
    enabled: true,
    promotedAt: probe.promotedAt ?? installedAt,
    sourceRunId: probe.sourceRunId ?? null,
    sourceMetrics: probe.sourceMetrics ?? emptySourceMetrics(),
  };
}

function mergeFactoryBatches(batches) {
  const byId = new Map();
  for (const batch of batches.filter(Boolean)) {
    if (!batch.id) continue;
    byId.set(batch.id, batch);
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""))
    .slice(0, 12);
}

export function mergeTopTradersExecutable(existingFile, probes, installedAt) {
  const current = existingFile?.topTradersExecutable && typeof existingFile.topTradersExecutable === "object"
    ? existingFile.topTradersExecutable
    : {};
  const nextProbeSourceIds = new Set(probes.map((probe) => probe.sourceAlgoId));
  const currentStats = current.stats && typeof current.stats === "object" ? current.stats : {};
  const stats = {};
  for (const [sourceAlgoId, row] of Object.entries(currentStats)) {
    if (isExecutionCanaryStats(row) && !nextProbeSourceIds.has(sourceAlgoId)) continue;
    stats[sourceAlgoId] = row;
  }
  for (const probe of probes) {
    const existingStats = stats[probe.sourceAlgoId] ?? {};
    const carriedStats = isSameExecutionCanaryIdentity(existingStats, probe) ? existingStats : {};
    stats[probe.sourceAlgoId] = {
      ...canaryExecutableStats(probe, installedAt),
      ...carriedStats,
      researchCandidateId: probe.researchCandidateId,
      candidateConfigHash: probe.candidateConfigHash,
      sourceRunId: probe.sourceRunId ?? null,
      sourceSnapshotHash: probe.sourceSnapshotHash ?? null,
      sourceMetrics: probe.sourceMetrics ?? emptySourceMetrics(),
      lane: executionCanaryLaneKind,
      evidenceStatus: "execution_canary_only",
      promotionEligibility: "not_promotion_eligible",
      paperOnly: true,
      exactLinked: true,
    };
  }
  return {
    startedAt: current.startedAt ?? installedAt,
    stoppedAt: current.stoppedAt ?? null,
    stats,
    positions: Array.isArray(current.positions) ? current.positions : [],
  };
}

function isSameExecutionCanaryIdentity(row, probe) {
  return Boolean(
    row
    && probe
    && row.candidateConfigHash
    && probe.candidateConfigHash
    && row.candidateConfigHash === probe.candidateConfigHash
    && String(row.sourceRunId ?? "") === String(probe.sourceRunId ?? "")
  );
}

async function archiveExecutionCanaryState(storageDir, batches, executable, archivedAt) {
  const canaryBatches = batches.filter(isExecutionCanaryFactoryBatch);
  const canaryStats = Object.fromEntries(Object.entries(executable?.stats ?? {}).filter(([, row]) => isExecutionCanaryStats(row)));
  if (canaryBatches.length === 0 && Object.keys(canaryStats).length === 0) return;
  const archiveRow = {
    schemaVersion: "dogeedge.execution-canary-archive.v1",
    archivedAt,
    canaryBatches,
    canaryStats,
  };
  await appendFile(path.join(storageDir, "execution-canary-archive.jsonl"), `${JSON.stringify(archiveRow)}\n`, "utf8");
}

function isExecutionCanaryFactoryBatch(batch) {
  return Boolean(
    batch
    && (
      String(batch.source ?? "").includes("Exact-linked execution canaries")
      || (Array.isArray(batch.algos) && batch.algos.some((algo) => algo?.lane === executionCanaryLaneKind || algo?.evidenceStatus === "execution_canary_only"))
    ),
  );
}

function isExecutionCanaryStats(row) {
  return Boolean(row?.lane === executionCanaryLaneKind || row?.evidenceStatus === "execution_canary_only");
}

function canaryExecutableStats(probe, installedAt) {
  return {
    sourceAlgoId: probe.sourceAlgoId,
    algoId: probe.id,
    displayId: probe.displayId,
    family: probe.family,
    researchCandidateId: probe.researchCandidateId,
    candidateConfigHash: probe.candidateConfigHash,
    sourceResearchAlgoId: probe.sourceResearchAlgoId ?? probe.sourceAlgoId,
    sourceRunId: probe.sourceRunId ?? null,
    sourceSnapshotHash: probe.sourceSnapshotHash ?? null,
    promotionVerdictAtInstall: probe.promotionVerdictAtInstall ?? null,
    sourceMetrics: probe.sourceMetrics ?? emptySourceMetrics(),
    startedAt: installedAt,
    lastSignalAt: null,
    lastAttemptAt: null,
    lastAcceptedAt: null,
    lastRejectedAt: null,
    lastRejectedMessage: null,
    lastRejectedCategory: null,
    signals: 0,
    attempts: 0,
    acceptedBuys: 0,
    rejected: 0,
    staleRejects: 0,
    depthRejects: 0,
    gateRejects: 0,
    edgeRejects: 0,
    priceRejects: 0,
    otherRejects: 0,
    buys: 0,
    sells: 0,
    open: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    totalCost: 0,
  };
}

function topTradersExecutableSummary(executable) {
  const stats = executable?.stats && typeof executable.stats === "object" ? Object.values(executable.stats) : [];
  return {
    startedAt: executable?.startedAt ?? null,
    stoppedAt: executable?.stoppedAt ?? null,
    strategyStats: stats.length,
    positions: Array.isArray(executable?.positions) ? executable.positions.length : 0,
    exactLinkedExecutionRows: stats.filter((row) => row?.researchCandidateId && row?.candidateConfigHash).length,
    signals: sumStats(stats, "signals"),
    attempts: sumStats(stats, "attempts"),
    acceptedBuys: sumStats(stats, "acceptedBuys"),
    rejected: sumStats(stats, "rejected"),
    buys: sumStats(stats, "buys"),
    sells: sumStats(stats, "sells"),
    open: sumStats(stats, "open"),
    wins: sumStats(stats, "wins"),
    losses: sumStats(stats, "losses"),
  };
}

function sumStats(stats, key) {
  return stats.reduce((sum, row) => sum + numberOrDefault(row?.[key], 0), 0);
}

function emptySourceMetrics() {
  return {
    closed: 0,
    independentClosedMarkets: 0,
    daysRepresented: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    conservativeTotalPnl: 0,
    totalCost: 0,
    roi: 0,
    maxDrawdown: 0,
    robustScore: 0,
    officialSettlementCoverage: 0,
    walkForwardPass: false,
    walkForwardClosed: 0,
    holdoutPass: false,
    holdoutClosed: 0,
    holdoutMarkets: 0,
    holdoutConservativeClosed: 0,
    holdoutConservativeMarkets: 0,
    holdoutConservativeTotalPnl: 0,
    holdoutLowerCi: 0,
  };
}

function sourceMetricsFromCandidate(candidate = {}) {
  const holdoutSummary = isRecord(candidate.holdoutSummary) ? candidate.holdoutSummary : {};
  return {
    closed: numberOrDefault(candidate.closed, 0),
    independentClosedMarkets: numberOrDefault(candidate.independentClosedMarkets, 0),
    daysRepresented: numberOrDefault(candidate.daysRepresented, 0),
    wins: numberOrDefault(candidate.wins, 0),
    losses: numberOrDefault(candidate.losses, 0),
    totalPnl: numberOrDefault(candidate.totalPnl, 0),
    conservativeTotalPnl: conservativePnl(candidate),
    totalCost: numberOrDefault(candidate.totalCost, 0),
    roi: numberOrDefault(candidate.roi, 0),
    maxDrawdown: numberOrDefault(candidate.maxDrawdown, 0),
    robustScore: numberOrDefault(candidate.robustScore, 0),
    officialSettlementCoverage: numberOrDefault(candidate.officialSettlementCoverage, 0),
    walkForwardPass: Boolean(candidate.walkForwardPass),
    walkForwardClosed: numberOrDefault(candidate.walkForwardClosed, 0),
    holdoutPass: Boolean(candidate.holdoutPass ?? holdoutSummary.holdoutPass),
    holdoutClosed: numberOrDefault(candidate.holdoutClosed, numberOrDefault(holdoutSummary.holdoutClosed, 0)),
    holdoutMarkets: numberOrDefault(candidate.holdoutMarkets, numberOrDefault(holdoutSummary.holdoutMarkets, 0)),
    holdoutConservativeClosed: numberOrDefault(holdoutSummary.holdoutConservativeClosed, 0),
    holdoutConservativeMarkets: numberOrDefault(holdoutSummary.holdoutConservativeMarkets, 0),
    holdoutConservativeTotalPnl: numberOrDefault(
      candidate.holdoutConservativeTotalPnl,
      numberOrDefault(holdoutSummary.holdoutConservativeTotalPnl, 0),
    ),
    holdoutLowerCi: numberOrDefault(candidate.holdoutLowerCi, numberOrDefault(holdoutSummary.holdoutLowerCi, 0)),
  };
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function splitList(value) {
  if (Array.isArray(value)) return value.flatMap(splitList);
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))];
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  evidenceLaneCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
