import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadSourceSweep } from "./evidence-lane.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function evidenceBootstrapCli() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const runId = `evidence-bootstrap-${startedAt.replaceAll(":", "-")}`;
  const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  const storageDir = path.resolve(args["storage-dir"] ?? process.env.DOGEEDGE_DATA_DIR ?? path.join(dataRoot, "local-worker"));
  const outDir = path.resolve(args.out ?? path.join("artifacts", "evidence-bootstrap", runId));
  const evidenceDir = path.resolve(args["evidence-out"] ?? "artifacts/evidence");
  const targetMarketsFile = args["target-markets-file"] ? path.resolve(String(args["target-markets-file"])) : null;
  const mockSettlements = args["mock-settlements"] ? path.resolve(String(args["mock-settlements"])) : null;
  const mockReplayRaw = args["mock-replay-raw"] ? path.resolve(String(args["mock-replay-raw"])) : null;
  const probeSource = args["probe-source"] ? path.resolve(String(args["probe-source"])) : null;
  const probeSourceMode = String(args["probe-source-mode"] ?? "best-supported-research");
  const maxProbes = Math.max(0, Number(args["max-probes"] ?? 5));
  const promoteCheckMaxSweepAlgos = Math.max(1, Math.floor(Number(args["promote-check-max-sweep-algos"] ?? args["research-sweep-max-algos"] ?? 500)));
  await mkdir(outDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });

  const steps = [];
  const runStep = async (name, commandArgs, { optional = false } = {}) => {
    const started = new Date().toISOString();
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, commandArgs, {
        cwd: repoRoot,
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      });
      const row = { name, status: "ok", startedAt: started, finishedAt: new Date().toISOString(), command: ["node", ...commandArgs], stdout: tail(stdout), stderr: tail(stderr), optional };
      steps.push(row);
      return row;
    } catch (error) {
      const row = {
        name,
        status: optional ? "blocked_optional" : "failed",
        startedAt: started,
        finishedAt: new Date().toISOString(),
        command: ["node", ...commandArgs],
        stdout: tail(error?.stdout ?? ""),
        stderr: tail(error?.stderr ?? errorMessage(error)),
        optional,
      };
      steps.push(row);
      if (!optional) throw new Error(`${name} failed: ${row.stderr || row.stdout}`);
      return row;
    }
  };
  const recordBlockedOptionalStep = (name, reasonCodes, message) => {
    const now = new Date().toISOString();
    const row = {
      name,
      status: "blocked_optional",
      startedAt: now,
      finishedAt: now,
      command: [],
      stdout: message,
      stderr: "",
      optional: true,
      reasonCodes,
    };
    steps.push(row);
    return row;
  };
  let lastExecutionCanaryHealth = null;

  const maybeReseedExecutionCanaries = async (phase) => {
    const executionCanaries = await readJsonMaybe(path.join(storageDir, "execution-canaries.json"));
    const executableFile = await readJsonMaybe(path.join(storageDir, "top-traders-executable.json"));
    const sourceRunId = await evidenceLaneSourceRunId({ dataRoot, probeSource, probeSourceMode });
    const maxExecutionCanaries = Math.min(3, maxProbes);
    const canaryHealth = executionCanaryHealth(executableFile?.topTradersExecutable, {
      minAttempts: Number(args["min-canary-health-attempts"] ?? 30),
      minSells: Number(args["min-canary-health-sells"] ?? 10),
      maxLossDollars: Number(args["max-canary-loss-dollars"] ?? 25),
      minRowAttempts: Number(args["min-canary-row-health-attempts"] ?? 8),
      minRowSells: Number(args["min-canary-row-health-sells"] ?? 5),
      maxRowLossDollars: Number(args["max-canary-row-loss-dollars"] ?? 15),
      maxRejectRate: Number(args["max-canary-reject-rate"] ?? 0.7),
      minRejectRateAttempts: Number(args["min-canary-reject-rate-attempts"] ?? 25),
      maxIdleMinutes: Number(args["max-canary-idle-minutes"] ?? 120),
    });
    lastExecutionCanaryHealth = { ...canaryHealth, phase };
    await writeFile(path.join(evidenceDir, "execution_canary_health.json"), `${JSON.stringify(lastExecutionCanaryHealth, null, 2)}\n`, "utf8");
    const canariesStale = executionCanariesNeedReseed({
      executionCanaries,
      sourceRunId,
      maxExecutionCanaries,
      maxSourceAgeHours: Number(args["max-canary-source-age-hours"] ?? 72),
      force: Boolean(args["force-reseed-probes"]),
      canaryHealth,
    });
    if (args["skip-execution-canaries"] === true || maxExecutionCanaries <= 0 || !canariesStale) {
      return canaryHealth;
    }
    const canaryArgs = [
      "scripts/factory/evidence-lane.mjs",
      "--data-root", dataRoot,
      "--storage-dir", storageDir,
      "--max-probes", String(maxExecutionCanaries),
      "--executable-only",
    ];
    const excludedSourceAlgoIds = mergedCanaryExclusions(executionCanaries, canaryHealth);
    if (canaryHealth.status === "fail" && excludedSourceAlgoIds.length > 0) {
      canaryArgs.push("--exclude-source-algos", excludedSourceAlgoIds.join(","));
    }
    if (probeSource) canaryArgs.push("--from", probeSource);
    else canaryArgs.push("--from", probeSourceMode);
    await runStep(`${phase}-reseed-execution-canaries`, canaryArgs, { optional: true });
    return canaryHealth;
  };

  const preflightArgs = [
    "scripts/factory/evidence-preflight.mjs",
    "--data-root", dataRoot,
    "--storage-dir", storageDir,
    "--out", path.join(outDir, "preflight"),
    "--evidence-out", evidenceDir,
  ];
  if (args.online) preflightArgs.push("--online");
  if (mockSettlements || mockReplayRaw || args.mock) preflightArgs.push("--mock");
  if (mockSettlements) preflightArgs.push("--mock-settlements", mockSettlements);
  if (mockReplayRaw) preflightArgs.push("--mock-replay-raw", mockReplayRaw);
  if (targetMarketsFile) preflightArgs.push("--target-markets-file", targetMarketsFile);
  if (probeSource) preflightArgs.push("--probe-source", probeSource);
  await runStep("evidence-preflight", preflightArgs);

  const targetMarketArgs = [
    "scripts/factory/target-markets.mjs",
    "--data-root", dataRoot,
    "--storage-dir", storageDir,
    "--out", path.join(outDir, "target-markets"),
    "--max-closed", String(args["max-closed"] ?? 250),
    "--max-active", String(args["max-active"] ?? 25),
  ];
  if (args.online || args["provider-active"]) targetMarketArgs.push("--provider-active");
  if (args["series-ticker"]) targetMarketArgs.push("--series-ticker", String(args["series-ticker"]));
  if (args["base-url"]) targetMarketArgs.push("--base-url", String(args["base-url"]));
  if (args["provider-active-horizon-minutes"]) targetMarketArgs.push("--provider-active-horizon-minutes", String(args["provider-active-horizon-minutes"]));
  if (args["active-min-lead-minutes"]) targetMarketArgs.push("--active-min-lead-minutes", String(args["active-min-lead-minutes"]));
  await runStep("select-target-markets", targetMarketArgs);
  await mirrorTargetMarketSelectionArtifacts(path.join(outDir, "target-markets"), path.join(evidenceDir, "target-markets"));
  await maybeReseedExecutionCanaries("pre-capture");

  const closedTargetsFile = targetMarketsFile ?? path.join(outDir, "target-markets", "closed-targets.json");
  const activeTargetsFile = targetMarketsFile ?? path.join(outDir, "target-markets", "active-targets.json");
  const activeReplayTargetCount = countTargetMarkets(await readJsonMaybe(activeTargetsFile));
  const officialStore = path.join(dataRoot, "official_settlements.jsonl");
  const settlementArgs = [
    "scripts/factory/fetch-official-settlements.mjs",
    "--data-root", dataRoot,
    "--tickers-file", closedTargetsFile,
    "--out", officialStore,
    "--report-out", path.join(evidenceDir, "settlement_fetch_report.json"),
    "--missing-only",
  ];
  if (mockSettlements) settlementArgs.push("--mock-input", mockSettlements);
  await runStep("fetch-settlements", settlementArgs, { optional: !mockSettlements && !args.online });

  const rawRoot = path.join(dataRoot, "replay", "raw", "bootstrap", startedAt.slice(0, 10));
  const replayFinal = path.join(dataRoot, "replay", "final");
  if (activeReplayTargetCount > 0 || mockReplayRaw) {
    const captureArgs = [
      "scripts/factory/capture-replay.mjs",
      "--data-root", dataRoot,
      "--markets-file", activeTargetsFile,
      "--mode", args.mode ? String(args.mode) : "websocket",
      "--out", rawRoot,
    ];
    if (args["duration-seconds"]) captureArgs.push("--duration-seconds", String(args["duration-seconds"]));
    if (args.channels) captureArgs.push("--channels", String(args.channels));
    if (args["use-yes-price"] !== undefined) captureArgs.push("--use-yes-price", String(args["use-yes-price"]));
    if (mockReplayRaw) captureArgs.push("--mock-input", mockReplayRaw);
    await runStep("capture-replay", captureArgs, { optional: !mockReplayRaw && !args.online });

    await runStep("build-replay", [
      "scripts/factory/build-replay-dataset.mjs",
      "--data-root", dataRoot,
      "--input", rawRoot,
      "--markets-file", activeTargetsFile,
      "--out", replayFinal,
    ]);

    await runStep("replay-coverage", [
      "scripts/factory/replay-coverage.mjs",
      "--input", replayFinal,
      "--markets-file", activeTargetsFile,
      "--out", path.join(evidenceDir, "replay_coverage_report.json"),
    ]);
  } else {
    const reasonCodes = ["active_target_markets_absent"];
    recordBlockedOptionalStep("capture-replay", reasonCodes, "No active target markets were selected; preserved the previous replay coverage report.");
    recordBlockedOptionalStep("build-replay", reasonCodes, "No new replay raw input was captured in this cycle.");
    recordBlockedOptionalStep("replay-coverage", reasonCodes, "Skipped replay coverage overwrite because the current active target set is empty.");
  }

  await runStep("linkage-audit", [
    "scripts/factory/backfill-linkage.mjs",
    "--audit-only",
    "--input", args["review-input"] ? path.resolve(String(args["review-input"])) : "review_exports",
    "--out", path.join(evidenceDir, "linkage-audit"),
  ], { optional: true });

  if (args["archive-legacy-telemetry"]) {
    const archiveArgs = [
      "scripts/factory/archive-legacy-telemetry.mjs",
      "--storage-dir", storageDir,
      "--out", path.join(evidenceDir, "legacy-telemetry-archive"),
    ];
    if (args["reset-unlinked-supported"]) archiveArgs.push("--reset-unlinked-supported");
    await runStep("archive-legacy-telemetry", archiveArgs, { optional: true });
  }

  const evidenceProbes = await readJsonMaybe(path.join(storageDir, "evidence-probes.json"));
  const probeCount = Array.isArray(evidenceProbes?.probes) ? evidenceProbes.probes.length : 0;
  if (probeCount === 0 || args["force-reseed-probes"]) {
    const reseedArgs = [
      "scripts/factory/evidence-lane.mjs",
      "--data-root", dataRoot,
      "--storage-dir", storageDir,
      "--max-probes", String(maxProbes),
    ];
    if (probeSource) reseedArgs.push("--from", probeSource);
    else reseedArgs.push("--from", probeSourceMode);
    await runStep("reseed-evidence-lane", reseedArgs, { optional: true });
  }

  if (args["run-backtest"]) {
    await runStep("backtest", ["scripts/dogeedge-backtest.mjs", "--data-root", dataRoot], { optional: true });
    await runStep("promote-check", [
      "scripts/dogeedge-backtest.mjs",
      "--sweep",
      "--promote-check",
      "--promote-check-max-sweep-algos", String(promoteCheckMaxSweepAlgos),
      "--data-root", dataRoot,
    ], { optional: true });
  }

  await maybeReseedExecutionCanaries("post-backtest");

  if (args["refresh-bundle"]) {
    await runStep("eval-bundle", [
      "scripts/export-eval-snapshot.mjs",
      "--bundle",
      "--window-minutes", "30",
      "--bundle-hours", "2",
      "--out", "review_exports",
      "--full-rows",
      "--evidence-dir", evidenceDir,
    ], { optional: true });
  }

  const finishedAt = new Date().toISOString();
  const failed = steps.filter((step) => step.status === "failed");
  const report = {
    schemaVersion: "dogeedge.evidence-bootstrap.v1",
    runId,
    startedAt,
    finishedAt,
    dataRoot,
    storageDir,
    outDir,
    evidenceDir,
    status: failed.length ? "failed" : "completed",
    failClosed: failed.length > 0,
    mockSettlements,
    mockReplayRaw,
    targetMarketsFile,
    executionCanaryHealth: lastExecutionCanaryHealth,
    canPlaceOrders: false,
    steps,
  };
  await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "report.md"), bootstrapMarkdown(report), "utf8");
  await writeEvidenceStatus(report);
  await writeReadinessPercent(report);
  console.log(`Evidence bootstrap ${report.status}: ${steps.length} steps`);
  console.log(`Report: ${path.join(outDir, "report.json")}`);
}

function bootstrapMarkdown(report) {
  return [
    "# DogeEdge Evidence Bootstrap",
    "",
    `Run: ${report.runId}`,
    `Status: ${report.status}`,
    `Fail closed: ${report.failClosed}`,
    "",
    "## Steps",
    "",
    "| Step | Status |",
    "|---|---|",
    ...report.steps.map((step) => `| ${step.name} | ${step.status} |`),
    "",
  ].join("\n");
}

async function writeEvidenceStatus(report) {
  const evidenceDir = path.resolve(report.evidenceDir ?? "artifacts/evidence");
  await mkdir(evidenceDir, { recursive: true });
  const settlement = await readJsonMaybe(path.join(evidenceDir, "settlement_fetch_report.json"));
  const replay = await readJsonMaybe(path.join(evidenceDir, "replay_coverage_report.json"));
  const targetMarkets = await readJsonMaybe(path.join(evidenceDir, "target-markets", "target_markets.json"))
    ?? await readJsonMaybe(path.join(report.outDir, "target-markets", "target_markets.json"));
  const probes = await readJsonMaybe(path.join(report.storageDir, "evidence-probes.json"));
  const status = {
    schemaVersion: "dogeedge.evidence-status.v1",
    generatedAt: report.finishedAt,
    status: report.status,
    lastBootstrapRunId: report.runId,
    lastSuccessfulSettlementFetchAt: settlement?.generatedAt ?? null,
    officialSettlementCoverage: settlement?.coverage?.officialSettlementCoverage ?? null,
    targetMarketsGeneratedAt: targetMarkets?.generatedAt ?? null,
    closedTargetCount: targetMarkets?.closedTargetCount ?? 0,
    activeTargetCount: targetMarkets?.activeTargetCount ?? 0,
    activeTickers: Array.isArray(targetMarkets?.activeTickers) ? targetMarkets.activeTickers : [],
    replayGradeMarketCount: replay?.replayGradeTargetMarketCount ?? replay?.replayGradeMarketCount ?? 0,
    replayCoveredMarketCount: replay?.coveredTargetMarketCount ?? replay?.coveredMarketCount ?? 0,
    exactLinkedProbeCount: Array.isArray(probes?.probes) ? probes.probes.filter((probe) => probe.exactLinked).length : 0,
    nextBootstrapStep: report.failClosed ? "inspect_evidence_bootstrap_report" : "continue_evidence_loop",
    blockedOn: [
      ...(!settlement?.coverage?.officialSettlementCoverage ? ["official_settlements"] : []),
      ...(!(replay?.replayGradeTargetMarketCount ?? replay?.replayGradeMarketCount) ? ["replay_grade_capture"] : []),
      ...(!(Array.isArray(probes?.probes) && probes.probes.some((probe) => probe.exactLinked)) ? ["exact_linked_probes"] : []),
    ],
    canPlaceOrders: false,
  };
  await writeFile(path.join(evidenceDir, "evidence_status.json"), `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function mirrorTargetMarketSelectionArtifacts(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const copied = [];
  for (const name of [
    "target_markets.json",
    "closed-targets.json",
    "active-targets.json",
    "closed-targets.txt",
    "active-targets.txt",
  ]) {
    const source = path.join(sourceDir, name);
    const target = path.join(targetDir, name);
    try {
      const text = await readFile(source, "utf8");
      await writeFile(target, text, "utf8");
      copied.push(target);
    } catch {
      // Some caller-provided target files only have a combined JSON document.
    }
  }
  await writeFile(path.join(targetDir, "mirror_manifest.json"), `${JSON.stringify({
    schemaVersion: "dogeedge.target-markets-mirror.v1",
    generatedAt: new Date().toISOString(),
    sourceDir: path.resolve(sourceDir),
    targetDir: path.resolve(targetDir),
    copiedFiles: copied.map((file) => path.basename(file)),
  }, null, 2)}\n`, "utf8");
  return copied;
}

export async function writeReadinessPercent(report) {
  const evidenceDir = path.resolve(report.evidenceDir ?? "artifacts/evidence");
  await mkdir(evidenceDir, { recursive: true });
  const settlement = await readJsonMaybe(path.join(evidenceDir, "settlement_fetch_report.json"));
  const replay = await readJsonMaybe(path.join(evidenceDir, "replay_coverage_report.json"));
  const probes = await readJsonMaybe(path.join(report.storageDir, "evidence-probes.json"));
  const latest = await readJsonMaybe(path.join(report.storageDir, "latest.json"));
  const appState = await readJsonMaybe(path.join(report.storageDir, "app-state.json"));
  const factoryBatches = await readJsonMaybe(path.join(report.storageDir, "factory-batches.json"));
  const targetMarkets = await readJsonMaybe(path.join(report.outDir, "target-markets", "target_markets.json"));
  const executableGate = await readJsonMaybe(path.join(evidenceDir, "executable_readiness_gate.json"))
    ?? await latestReviewSnapshotJson(report.reviewRoot, "executable_readiness_gate.json")
    ?? await latestBundleExecutableGate(report.reviewRoot);
  const researchRosterBlockers = await readJsonMaybe(path.join(evidenceDir, "research_roster_blockers.json"))
    ?? await latestReviewSnapshotJson(report.reviewRoot, "research_roster_blockers.json");
  const officialSettlementCoverage = Number(executableGate?.officialSettlementCoverage ?? settlement?.coverage?.officialSettlementCoverage ?? 0);
  const replayGradeTargetMarketCoverage = Number(executableGate?.replayGradeTargetMarketCoverage ?? replay?.replayGradeTargetMarketCoverage ?? 0);
  const exactLinkedProbeCount = Array.isArray(probes?.probes) ? probes.probes.filter((probe) => probe?.exactLinked).length : 0;
  const executionRows = latest?.topTradersExecutable?.stats && typeof latest.topTradersExecutable.stats === "object"
    ? Object.values(latest.topTradersExecutable.stats)
    : [];
  const exactLinkedExecutionStats = executionRows.filter((row) => row?.researchCandidateId && row?.candidateConfigHash).length;
  const exactLinkedExecutionCanaries = exactLinkedExecutionCanaryCount([appState, factoryBatches]);
  const selectedExecutionRows = Math.max(0, Math.floor(Number(latest?.topTradersArena?.selectedAlgoCount ?? 0)));
  const exactLinkedExecutionRows = Math.max(exactLinkedExecutionStats, Math.min(selectedExecutionRows, exactLinkedExecutionCanaries));
  const activeTargetCount = Number(targetMarkets?.activeTargetCount ?? 0);
  const activeReplayTargetComponent = readinessComponent("active replay targets available", activeTargetCount, 1, "count");
  if (activeTargetCount <= 0 && replayGradeTargetMarketCoverage >= 1) {
    activeReplayTargetComponent.status = "waiting";
    activeReplayTargetComponent.progress = 1;
    activeReplayTargetComponent.note = "No active target market is available right now; previous replay-grade evidence is preserved and the loop will try again next cycle.";
  }
  const components = [
    readinessComponent("official settlement coverage", officialSettlementCoverage, 0.95, "coverage"),
    readinessComponent("replay-grade target coverage", replayGradeTargetMarketCoverage, 1, "coverage"),
    readinessComponent("exact-linked evidence probes", exactLinkedProbeCount, 3, "count"),
    activeReplayTargetComponent,
    readinessComponent("exact-linked execution rows", exactLinkedExecutionRows, 3, "count"),
  ];
  const evidenceCollectionReady = components.every((component) => component.status === "pass" || component.status === "waiting");
  const promotionReady = executableGate?.allowedToLoadArenaBatch === true;
  const evidenceProgress = components.length
    ? components.reduce((sum, component) => sum + component.progress, 0) / components.length
    : 0;
  const readiness = {
    schemaVersion: "dogeedge.readiness-percent.v1",
    generatedAt: report.finishedAt ?? new Date().toISOString(),
    headline: promotionReady
      ? "promotion_ready"
      : evidenceCollectionReady && activeReplayTargetComponent.status === "waiting"
        ? "evidence_collection_ready_waiting_for_active_target_hold_promotion_gates"
        : evidenceCollectionReady ? "evidence_collection_ready_hold_promotion_gates" : "hold_gather_evidence",
    promotionReady,
    promotionReadinessPercent: promotionReady ? 100 : 0,
    evidenceCollectionProgressPercent: roundPercent(evidenceProgress),
    evidenceCollectionReady,
    promotionGateSource: executableGate ? "executable_readiness_gate" : "absent_fail_closed",
    promotionGateReasonCodes: executableGate?.reasonCodes ?? ["executable_readiness_gate_absent"],
    promotionBlockerDetail: readinessPromotionBlockerDetail(researchRosterBlockers),
    components,
    canPlaceOrders: false,
    note: "Promotion readiness is controlled by the executable readiness gate. Evidence collection progress is a monitoring score, not permission to trade.",
  };
  await writeFile(path.join(evidenceDir, "readiness_percent.json"), `${JSON.stringify(readiness, null, 2)}\n`, "utf8");
  await writeFile(path.join(evidenceDir, "readiness_percent.md"), readinessMarkdown(readiness), "utf8");
}

export function readinessComponent(kpi, value, target, kind) {
  const numericValue = Number.isFinite(value) ? value : 0;
  const numericTarget = Number.isFinite(target) && target > 0 ? target : 1;
  const displayValue = kind === "coverage" ? roundPercent(numericValue) : numericValue;
  const displayTarget = kind === "coverage" ? roundPercent(numericTarget) : numericTarget;
  const progress = Math.max(0, Math.min(1, displayValue / displayTarget));
  return {
    kpi,
    value: displayValue,
    target: displayTarget,
    unit: kind === "coverage" ? "percent" : "count",
    progress,
    status: progress >= 1 ? "pass" : "blocked",
  };
}

export function countTargetMarkets(document) {
  if (Array.isArray(document)) return uniqueTargetCount(document);
  if (!document || typeof document !== "object") return 0;
  const activeTargets = Array.isArray(document.activeTargets) ? document.activeTargets : [];
  if (activeTargets.length) return uniqueTargetCount(activeTargets);
  const markets = Array.isArray(document.markets) ? document.markets : [];
  if (markets.length) return uniqueTargetCount(markets);
  const tickers = Array.isArray(document.tickers) ? document.tickers : [];
  if (tickers.length) return uniqueTargetCount(tickers);
  return 0;
}

function uniqueTargetCount(values) {
  return new Set(values.map((value) => {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object") return "";
    return String(value.marketTicker ?? value.ticker ?? value.id ?? "").trim();
  }).filter(Boolean)).size;
}

export function executionCanariesNeedReseed({
  executionCanaries = {},
  maxExecutionCanaries = 3,
  sourceRunId = null,
  maxSourceAgeHours = 72,
  force = false,
  canaryHealth = null,
} = {}) {
  const targetCount = Math.max(0, Math.floor(Number(maxExecutionCanaries ?? 0)));
  const canaryCount = Array.isArray(executionCanaries?.probes) ? executionCanaries.probes.length : 0;
  const healthyCanaries = canaryCount >= targetCount
    && executionCanaries?.paperOnly === true
    && executionCanaries?.executableOnly === true
    && executionCanaries?.lane === "exact_linked_execution_canary"
    && executionCanaries.probes.every((probe) => (
      probe?.exactLinked === true
      && probe?.paperOnly === true
      && probe?.enabled === true
      && probe?.lane === "exact_linked_execution_canary"
      && typeof probe?.researchCandidateId === "string"
      && probe.researchCandidateId.length > 0
      && typeof probe?.candidateConfigHash === "string"
      && probe.candidateConfigHash.length > 0
    ));
  if (targetCount <= 0) return Boolean(force);
  const staleSource = executionCanarySourceIsStale(executionCanaries?.sourceRunId, sourceRunId, maxSourceAgeHours);
  return Boolean(
    force
    || canaryCount === 0
    || canaryCount < targetCount
    || staleSource
    || canaryHealth?.status === "fail"
    || !healthyCanaries
  );
}

export function executionCanaryHealth(executable, {
  minAttempts = 30,
  minSells = 10,
  maxLossDollars = 25,
  minRowAttempts = 8,
  minRowSells = 5,
  maxRowLossDollars = 15,
  maxRejectRate = 0.7,
  minRejectRateAttempts = 25,
  maxIdleMinutes = 120,
  now = new Date().toISOString(),
} = {}) {
  const rows = executionCanaryStatsRows(executable);
  const totals = rows.reduce((summary, row) => {
    summary.attempts += numberOrZero(row.attempts);
    summary.acceptedBuys += numberOrZero(row.acceptedBuys);
    summary.rejected += numberOrZero(row.rejected);
    summary.sells += numberOrZero(row.sells);
    summary.open += numberOrZero(row.open);
    summary.totalPnl += numberOrZero(row.totalPnl);
    const lastAttemptAt = typeof row.lastAttemptAt === "string" ? row.lastAttemptAt : null;
    if (lastAttemptAt && (!summary.lastAttemptAt || lastAttemptAt > summary.lastAttemptAt)) summary.lastAttemptAt = lastAttemptAt;
    const startedAt = typeof row.startedAt === "string" ? row.startedAt : null;
    if (startedAt && (!summary.startedAt || startedAt < summary.startedAt)) summary.startedAt = startedAt;
    return summary;
  }, {
    rows: rows.length,
    attempts: 0,
    acceptedBuys: 0,
    rejected: 0,
    sells: 0,
    open: 0,
    totalPnl: 0,
    startedAt: null,
    lastAttemptAt: null,
  });
  totals.totalPnl = roundMoney(totals.totalPnl);
  const reasonCodes = [];
  if (rows.length === 0) reasonCodes.push("no_execution_canary_stats");
  const enoughLossEvidence = totals.attempts >= Math.max(1, Number(minAttempts ?? 30))
    && totals.sells >= Math.max(1, Number(minSells ?? 10));
  if (enoughLossEvidence && totals.totalPnl <= -Math.max(0, Number(maxLossDollars ?? 25))) {
    reasonCodes.push("canary_loss_limit_exceeded");
  }
  const unhealthyByRowLoss = rows
    .filter((row) => {
      const hasEnoughRowLossEvidence = numberOrZero(row.attempts) >= Math.max(1, Number(minRowAttempts ?? 8))
        || numberOrZero(row.sells) >= Math.max(1, Number(minRowSells ?? 5));
      return hasEnoughRowLossEvidence
        && numberOrZero(row.totalPnl) <= -Math.max(0, Number(maxRowLossDollars ?? 15));
    })
    .map((row) => String(row.sourceAlgoId ?? ""))
    .filter((value) => value.length > 0);
  if (unhealthyByRowLoss.length > 0) reasonCodes.push("canary_row_loss_limit_exceeded");
  const rejectRate = totals.attempts > 0 ? totals.rejected / totals.attempts : 0;
  if (
    totals.attempts >= Math.max(1, Number(minRejectRateAttempts ?? 25))
    && rejectRate >= Math.max(0, Number(maxRejectRate ?? 0.7))
  ) {
    reasonCodes.push("canary_reject_rate_exceeded");
  }
  const idleLimitMs = Math.max(1, Number(maxIdleMinutes ?? 120)) * 60 * 1000;
  const startedMs = Date.parse(totals.startedAt ?? "");
  const lastAttemptMs = Date.parse(totals.lastAttemptAt ?? "");
  const nowMs = Date.parse(now);
  if (
    Number.isFinite(nowMs)
    && Number.isFinite(startedMs)
    && totals.attempts === 0
    && nowMs - startedMs >= idleLimitMs
  ) {
    reasonCodes.push("canary_idle_without_attempts");
  }
  const unhealthySourceAlgoIds = rows
    .filter((row) => rowHasUnhealthyCanaryEvidence(row, reasonCodes, unhealthyByRowLoss))
    .map((row) => String(row.sourceAlgoId ?? ""))
    .filter((value) => value.length > 0);
  const blockingReasons = reasonCodes.filter((code) => code !== "no_execution_canary_stats");
  return {
    schemaVersion: "dogeedge.execution-canary-health.v1",
    generatedAt: now,
    status: blockingReasons.length > 0 ? "fail" : rows.length === 0 ? "unknown" : "pass",
    reasonCodes,
    unhealthySourceAlgoIds: [...new Set(unhealthySourceAlgoIds)],
    rejectRate: Math.round(rejectRate * 10_000) / 10_000,
    thresholds: {
      minAttempts,
      minSells,
      maxLossDollars,
      minRowAttempts,
      minRowSells,
      maxRowLossDollars,
      maxRejectRate,
      minRejectRateAttempts,
      maxIdleMinutes,
    },
    ...totals,
  };
}

function rowHasUnhealthyCanaryEvidence(row, reasonCodes, unhealthyByRowLoss = []) {
  if (!reasonCodes.some((code) => (
    code === "canary_loss_limit_exceeded"
    || code === "canary_row_loss_limit_exceeded"
    || code === "canary_reject_rate_exceeded"
  ))) return false;
  if (unhealthyByRowLoss.includes(String(row?.sourceAlgoId ?? ""))) return true;
  const attempts = numberOrZero(row.attempts);
  if (reasonCodes.includes("canary_loss_limit_exceeded") && numberOrZero(row.totalPnl) < 0) return true;
  if (reasonCodes.includes("canary_reject_rate_exceeded") && attempts > 0 && numberOrZero(row.rejected) / attempts >= 0.5) return true;
  return false;
}

function executionCanaryStatsRows(executable) {
  const stats = executable?.stats && typeof executable.stats === "object" ? executable.stats : {};
  return Object.values(stats).filter((row) => (
    row?.lane === "exact_linked_execution_canary"
    || row?.evidenceStatus === "execution_canary_only"
  ));
}

export function mergedCanaryExclusions(executionCanaries, canaryHealth) {
  return [
    ...new Set([
      ...arrayOfStrings(executionCanaries?.excludedSourceAlgoIds),
      ...arrayOfStrings(canaryHealth?.unhealthySourceAlgoIds),
    ]),
  ];
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

async function latestReviewSnapshotJson(reviewRoot = path.join(repoRoot, "review_exports"), fileName) {
  if (!fileName) return null;
  const snapshotsDir = path.join(reviewRoot, "snapshots");
  let entries = [];
  try {
    entries = await readdir(snapshotsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(snapshotsDir, entry.name, fileName);
    const info = await stat(filePath).catch(() => null);
    if (!info) continue;
    candidates.push({ filePath, mtimeMs: info.mtimeMs });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates.length > 0 ? readJsonMaybe(candidates[0].filePath) : null;
}

async function latestBundleExecutableGate(reviewRoot = path.join(repoRoot, "review_exports")) {
  const bundlesDir = path.join(reviewRoot, "bundles");
  let entries = [];
  try {
    entries = await readdir(bundlesDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const gatePath = path.join(bundlesDir, entry.name, "snapshots", "executable_readiness_gate.json");
    const info = await stat(gatePath).catch(() => null);
    if (!info) continue;
    candidates.push({ gatePath, mtimeMs: info.mtimeMs });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates.length > 0 ? readJsonMaybe(candidates[0].gatePath) : null;
}

function readinessPromotionBlockerDetail(blockers) {
  if (!blockers || typeof blockers !== "object") return null;
  return {
    currentBottleneck: blockers.currentBottleneck ?? null,
    validationStatus: blockers.validationStatus ?? null,
    nextEvidenceNeed: blockers.nextEvidenceNeed ?? null,
    supportedExecutableSweepCoverage: blockers.supportedExecutableSweepCoverage ?? null,
    topReasons: Array.isArray(blockers.topReasons) ? blockers.topReasons.slice(0, 5) : [],
  };
}

function readinessMarkdown(readiness) {
  return [
    "# DogeEdge Readiness Percent",
    "",
    `Generated: ${readiness.generatedAt}`,
    `Promotion readiness: ${readiness.promotionReadinessPercent}%`,
    `Evidence collection progress: ${readiness.evidenceCollectionProgressPercent}%`,
    `Headline: ${readiness.headline}`,
    "",
    "| KPI | Current | Target | Status |",
    "|---|---:|---:|---|",
    ...readiness.components.map((component) => {
      const suffix = component.unit === "percent" ? "%" : "";
      return `| ${component.kpi} | ${component.value}${suffix} | ${component.target}${suffix} | ${component.status} |`;
    }),
    "",
    readiness.promotionBlockerDetail?.nextEvidenceNeed ? `Promotion blocker: ${readiness.promotionBlockerDetail.nextEvidenceNeed}` : "",
    readiness.promotionBlockerDetail?.currentBottleneck ? `Current bottleneck: ${readiness.promotionBlockerDetail.currentBottleneck}` : "",
    "",
    readiness.note,
    "",
  ].join("\n");
}

function roundPercent(value) {
  return Math.round(Number(value ?? 0) * 1000) / 10;
}

async function evidenceLaneSourceRunId({ dataRoot, probeSource, probeSourceMode = "best-supported-research" }) {
  const source = await loadSourceSweep(probeSource ? { from: probeSource } : { from: probeSourceMode }, dataRoot).catch(() => null);
  return source?.runId ?? source?.sourceSelection?.selectedRunId ?? null;
}

function executionCanarySourceIsStale(currentSourceRunId, nextSourceRunId, maxSourceAgeHours) {
  if (!currentSourceRunId || !nextSourceRunId || currentSourceRunId === nextSourceRunId) return false;
  const currentMs = runIdTimestampMs(currentSourceRunId);
  const nextMs = runIdTimestampMs(nextSourceRunId);
  if (!Number.isFinite(currentMs) || !Number.isFinite(nextMs) || nextMs <= currentMs) return false;
  const maxAgeMs = Math.max(1, Number(maxSourceAgeHours ?? 72)) * 60 * 60 * 1000;
  return Date.now() - currentMs >= maxAgeMs;
}

function runIdTimestampMs(value) {
  const raw = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return Number.NaN;
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;
  const normalized = raw.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, "T$1:$2:$3Z");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function exactLinkedExecutionCanaryCount(sources) {
  const seen = new Set();
  for (const source of sources) {
    const batches = Array.isArray(source?.factoryAlgoBatches) ? source.factoryAlgoBatches : [];
    for (const batch of batches) {
      const algos = Array.isArray(batch?.algos) ? batch.algos : [];
      for (const algo of algos) {
        if (!isExactLinkedExecutionCanary(algo)) continue;
        const key = algo.id ?? algo.sourceAlgoId ?? algo.researchCandidateId ?? JSON.stringify(algo);
        seen.add(String(key));
      }
    }
  }
  return seen.size;
}

function isExactLinkedExecutionCanary(algo) {
  return Boolean(
    algo
    && algo.researchCandidateId
    && algo.candidateConfigHash
    && algo.paperOnly === true
    && algo.promotionEligibility === "not_promotion_eligible"
    && (
      algo.evidenceStatus === "execution_canary_only"
      || algo.lane === "exact_linked_execution_canary"
    ),
  );
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function tail(value, max = 6000) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(-max) : text;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round(numberOrZero(value) * 100) / 100;
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
  evidenceBootstrapCli().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
