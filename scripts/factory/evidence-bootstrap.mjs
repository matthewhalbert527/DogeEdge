import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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

  await runStep("select-target-markets", [
    "scripts/factory/target-markets.mjs",
    "--data-root", dataRoot,
    "--storage-dir", storageDir,
    "--out", path.join(outDir, "target-markets"),
    "--max-closed", String(args["max-closed"] ?? 250),
    "--max-active", String(args["max-active"] ?? 25),
  ]);

  const closedTargetsFile = targetMarketsFile ?? path.join(outDir, "target-markets", "closed-targets.json");
  const activeTargetsFile = targetMarketsFile ?? path.join(outDir, "target-markets", "active-targets.json");
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
  const captureArgs = [
    "scripts/factory/capture-replay.mjs",
    "--data-root", dataRoot,
    "--markets-file", activeTargetsFile,
    "--mode", args.mode ? String(args.mode) : "websocket",
    "--out", rawRoot,
  ];
  if (mockReplayRaw) captureArgs.push("--mock-input", mockReplayRaw);
  await runStep("capture-replay", captureArgs, { optional: !mockReplayRaw && !args.online });

  const replayFinal = path.join(dataRoot, "replay", "final");
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
    "--out", path.join(evidenceDir, "replay_coverage_report.json"),
  ]);

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
      "--max-probes", String(args["max-probes"] ?? 5),
    ];
    if (probeSource) reseedArgs.push("--from", probeSource);
    else reseedArgs.push("--from", "latest-sweep");
    await runStep("reseed-evidence-lane", reseedArgs, { optional: true });
  }

  if (args["run-backtest"]) {
    await runStep("backtest", ["scripts/dogeedge-backtest.mjs", "--data-root", dataRoot], { optional: true });
    await runStep("promote-check", ["scripts/dogeedge-backtest.mjs", "--sweep", "--promote-check", "--data-root", dataRoot], { optional: true });
  }

  if (args["refresh-bundle"]) {
    await runStep("eval-bundle", ["scripts/export-eval-snapshot.mjs", "--bundle", "--window-minutes", "30", "--bundle-hours", "2", "--out", "review_exports", "--full-rows"], { optional: true });
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
    canPlaceOrders: false,
    steps,
  };
  await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "report.md"), bootstrapMarkdown(report), "utf8");
  await writeEvidenceStatus(report);
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
  const probes = await readJsonMaybe(path.join(report.storageDir, "evidence-probes.json"));
  const status = {
    schemaVersion: "dogeedge.evidence-status.v1",
    generatedAt: report.finishedAt,
    status: report.status,
    lastBootstrapRunId: report.runId,
    lastSuccessfulSettlementFetchAt: settlement?.generatedAt ?? null,
    officialSettlementCoverage: settlement?.coverage?.officialSettlementCoverage ?? null,
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
