import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { familyResearchSupported } from "./family-registry.mjs";
import { hashJson } from "./utils.mjs";

export const evidenceProbeLaneSchemaVersion = "dogeedge.evidence-probe-lane.v1";
export const evidenceProbeLaneKind = "exact_linked_evidence_probe";
export const executionCanaryLaneKind = "exact_linked_execution_canary";
export const supportedExecutionCanaryFamilies = Object.freeze(["sweep-scalp", "sweep-liquidity-imbalance"]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function selectEvidenceProbes(rows = [], { maxProbes = 5, allowInsufficientDataProbe = false, executableOnly = false } = {}) {
  const selected = [];
  const rejected = [];
  for (const row of rows) {
    const check = evidenceProbeEligibility(row, { allowInsufficientDataProbe, executableOnly });
    if (!check.ok) {
      rejected.push({ algoId: row?.algoId ?? row?.id ?? "unknown", family: row?.family ?? "unknown", reasonCodes: check.reasonCodes });
      continue;
    }
    selected.push(evidenceProbeFromCandidate(row, executableOnly ? { laneKind: executionCanaryLaneKind } : {}));
    if (selected.length >= maxProbes) break;
  }
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
  const evidenceCount = Math.max(numberOrDefault(row.closed, 0), numberOrDefault(row.independentClosedMarkets, 0), numberOrDefault(row.walkForwardClosed, 0));
  if (evidenceCount <= 0) reasonCodes.push("minimal_event_or_trade_evidence_required");
  if (row.labelSource === "official_resolution" && row.settlementSource !== "official_resolution") reasonCodes.push("inconsistent_official_label_settlement");
  return { ok: reasonCodes.length === 0, reasonCodes };
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
    sourceMetrics: {
      closed: numberOrDefault(candidate.closed, 0),
      wins: numberOrDefault(candidate.wins, 0),
      losses: numberOrDefault(candidate.losses, 0),
      totalPnl: numberOrDefault(candidate.totalPnl, 0),
      totalCost: numberOrDefault(candidate.totalCost, 0),
      roi: numberOrDefault(candidate.roi, 0),
      maxDrawdown: numberOrDefault(candidate.maxDrawdown, 0),
    },
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
    console.log("Usage: node scripts/factory/evidence-lane.mjs [--from latest-sweep|file] [--run-id id] [--max-probes n] [--data-root dir] [--storage-dir dir] [--allow-insufficient-data-probe] [--executable-only]");
    return;
  }
  const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const storageDir = path.resolve(args["storage-dir"] ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
  const source = await loadSourceSweep(args, dataRoot);
  const maxProbes = Math.max(0, Number(args["max-probes"] ?? 5));
  const executableOnly = Boolean(args["executable-only"] ?? args["execution-canary"] ?? args["execution-canaries"]);
  const rows = [...(Array.isArray(source?.candidates) ? source.candidates : []), ...(Array.isArray(source?.topMetrics) ? source.topMetrics : [])];
  const sorted = rows.sort((left, right) => numberOrDefault(right.robustScore, 0) - numberOrDefault(left.robustScore, 0));
  const result = selectEvidenceProbes(sorted, {
    maxProbes,
    allowInsufficientDataProbe: Boolean(args["allow-insufficient-data-probe"]),
    executableOnly,
  });
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
    probes: result.selected,
    rejected: result.rejected,
    summary: {
      installedProbeCount: result.selected.length,
      rejectedCandidateCount: result.rejected.length,
      exactLinkedProbeCount: result.selected.filter((probe) => probe.exactLinked).length,
      supportedFamilyProbeCount: result.selected.filter((probe) => familyResearchSupported(probe.family)).length,
      supportedExecutionCanaryCount: result.selected.filter((probe) => supportedExecutionCanaryFamilies.includes(probe.family)).length,
      researchValidatedRosterImpact: 0,
      reasonCodes: result.selected.length === 0 && executableOnly ? ["no_supported_execution_canary_candidates"] : [],
    },
  };
  const laneFile = executableOnly ? "execution-canaries.json" : "evidence-probes.json";
  const reportFile = executableOnly ? "execution-canary-report.json" : "evidence-probe-report.json";
  await writeFile(path.join(storageDir, laneFile), `${JSON.stringify(lane, null, 2)}\n`, "utf8");
  await writeFile(path.join(storageDir, reportFile), `${JSON.stringify(lane.summary, null, 2)}\n`, "utf8");
  console.log(`${executableOnly ? "Execution canary" : "Evidence probe"} lane reseed complete: ${lane.summary.installedProbeCount}/${maxProbes} probes`);
  console.log(`Output: ${path.join(storageDir, laneFile)}`);
}

async function loadSourceSweep(args, dataRoot) {
  if (args["run-id"]) {
    const runId = String(args["run-id"]);
    return readJson(path.join(dataRoot, "backtests", "sweeps", runId, "config.json"));
  }
  const from = String(args.from ?? "latest-sweep");
  if (from === "latest-sweep") return readJson(path.join(dataRoot, "backtests", "latest-sweep.json"));
  return readJson(path.resolve(from));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
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
