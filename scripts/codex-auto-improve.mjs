import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const automationRootDefault = path.join(repoRoot, "review_exports", "codex-automation");
const cycleTimeoutMs = 90 * 60_000;

export function hardSafetyScan({ files = [], diffText = "" } = {}) {
  const reasons = [];
  const deniedPathPatterns = [
    /^api[\\/]/i,
    /^src-tauri[\\/]/i,
    /^package(?:-lock)?\.json$/i,
    /^scripts[\\/]dogeedge-local-worker\.mjs$/i,
    /^src[\\/]core[\\/]kalshi\.ts$/i,
    /^src[\\/]core[\\/]order-router/i,
    /(^|[\\/])(live-router|order-submission|credentials|secrets?)([\\/]|$)/i,
  ];
  for (const file of files) {
    if (deniedPathPatterns.some((pattern) => pattern.test(file))) {
      reasons.push({ type: "blocked_path", file, detail: "Auto-merge cannot touch live-sensitive, dependency, or backend routing files." });
    }
  }
  const deniedDiffPatterns = [
    { pattern: /DOGEEDGE_LIVE_TRADING_ENABLED\s*=\s*["']?1/i, detail: "Would enable live trading by default." },
    { pattern: /DOGEEDGE_LIVE_DRY_RUN\s*=\s*["']?0/i, detail: "Would disable dry-run mode by default." },
    { pattern: /manualApprovalRequired\s*:\s*false/i, detail: "Would remove manual approval semantics." },
    { pattern: /liveTradingEnabled\s*:\s*true/i, detail: "Would set live trading enabled in code." },
    { pattern: /live_disabled_by_default["']?\s*[,}]\s*-\s*/i, detail: "Appears to remove live-disabled-by-default evidence." },
  ];
  for (const check of deniedDiffPatterns) {
    if (check.pattern.test(diffText)) reasons.push({ type: "blocked_diff", detail: check.detail });
  }
  return {
    ok: reasons.length === 0,
    verdict: reasons.length === 0 ? "ALLOW_AUTO_MERGE" : "BLOCK_AUTO_MERGE",
    reasons,
  };
}

export async function runCodexAutoImproveCycle(options = {}) {
  const automationRoot = path.resolve(options.automationRoot ?? automationRootDefault);
  await mkdir(automationRoot, { recursive: true });
  const lockPath = path.join(automationRoot, "auto-improve.lock");
  const cycleId = `codex-auto-${compactIso(new Date())}`;
  const cycleDir = path.join(automationRoot, cycleId);
  await mkdir(cycleDir, { recursive: true });
  const report = {
    schemaVersion: "dogeedge.codex-auto-improve.v1",
    cycleId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    branch: `auto/${cycleId}`,
    bundlePath: null,
    commands: [],
    safety: null,
    changedFiles: [],
    commit: null,
    pushedMain: false,
    notes: [],
  };

  if (!await acquireLock(lockPath, cycleId)) {
    report.status = "skipped_locked";
    report.notes.push("Another Codex automation cycle is already running.");
    report.finishedAt = new Date().toISOString();
    await writeReport(cycleDir, report);
    return report;
  }

  try {
    await command(["git", "checkout", "main"], { cwd: repoRoot, report });
    await command(["git", "pull", "--ff-only", "origin", "main"], { cwd: repoRoot, report });
    const startStatus = await command(["git", "status", "--porcelain"], { cwd: repoRoot, report, capture: true });
    if (startStatus.stdout.trim()) {
      report.status = "skipped_dirty_worktree";
      report.notes.push("Main worktree was not clean at cycle start.");
      report.notes.push(startStatus.stdout.trim());
      return report;
    }

    await command(["npm", "run", "eval:bundle", "--", "--out", "review_exports"], { cwd: repoRoot, report, timeoutMs: 180_000 });
    report.bundlePath = await latestBundlePath(path.join(repoRoot, "review_exports", "bundles"));
    const promptPath = path.join(cycleDir, "prompt.txt");
    await writeFile(promptPath, automationPrompt({ cycleId, bundlePath: report.bundlePath }), "utf8");

    await command(["git", "checkout", "-B", report.branch, "main"], { cwd: repoRoot, report });
    const codexResult = await command([
      "codex",
      "exec",
      "-C",
      repoRoot,
      "-a",
      "never",
      "--sandbox",
      "danger-full-access",
      "--output-last-message",
      path.join(cycleDir, "codex-final.md"),
      "-",
    ], {
      cwd: repoRoot,
      report,
      stdinPath: promptPath,
      timeoutMs: cycleTimeoutMs,
      allowFailure: true,
    });
    await writeFile(path.join(cycleDir, "codex-stdout.log"), codexResult.stdout, "utf8");
    await writeFile(path.join(cycleDir, "codex-stderr.log"), codexResult.stderr, "utf8");
    if (codexResult.code !== 0) {
      report.status = "codex_failed";
      report.notes.push(`Codex exited with code ${codexResult.code}.`);
      await preserveFailedChanges(report, cycleDir);
      return report;
    }

    report.changedFiles = (await command(["git", "diff", "--name-only"], { cwd: repoRoot, report, capture: true })).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (report.changedFiles.length === 0) {
      report.status = "no_changes";
      return report;
    }

    const diffText = (await command(["git", "diff"], { cwd: repoRoot, report, capture: true, maxBuffer: 20 * 1024 * 1024 })).stdout;
    await writeFile(path.join(cycleDir, "candidate.diff"), diffText, "utf8");
    report.safety = hardSafetyScan({ files: report.changedFiles, diffText });
    if (!report.safety.ok) {
      report.status = "blocked_by_safety_scan";
      await preserveFailedChanges(report, cycleDir);
      return report;
    }

    await command(["npm", "test"], { cwd: repoRoot, report, timeoutMs: 180_000 });
    await command(["npm", "run", "lint"], { cwd: repoRoot, report, timeoutMs: 180_000 });
    await command(["npm", "run", "build"], { cwd: repoRoot, report, timeoutMs: 180_000 });
    await command(["npm", "run", "factory:validate"], { cwd: repoRoot, report, timeoutMs: 180_000 });
    await command(["npm", "run", "factory:promote-check"], { cwd: repoRoot, report, timeoutMs: 240_000 });
    await command(["npm", "run", "eval:bundle", "--", "--out", "review_exports"], { cwd: repoRoot, report, timeoutMs: 180_000 });

    await command(["git", "add", "-A"], { cwd: repoRoot, report });
    const staged = await command(["git", "diff", "--cached", "--name-only"], { cwd: repoRoot, report, capture: true });
    if (!staged.stdout.trim()) {
      report.status = "no_staged_changes";
      return report;
    }
    await command(["git", "commit", "-m", `Auto improve DogeEdge loop (${cycleId})`], { cwd: repoRoot, report });
    report.commit = (await command(["git", "rev-parse", "HEAD"], { cwd: repoRoot, report, capture: true })).stdout.trim();
    await command(["git", "push", "origin", report.branch], { cwd: repoRoot, report });
    await command(["git", "checkout", "main"], { cwd: repoRoot, report });
    await command(["git", "pull", "--ff-only", "origin", "main"], { cwd: repoRoot, report });
    await command(["git", "merge", "--ff-only", report.branch], { cwd: repoRoot, report });
    await command(["git", "push", "origin", "main"], { cwd: repoRoot, report });
    report.pushedMain = true;
    report.status = "merged_and_pushed";
    await command(["git", "branch", "-D", report.branch], { cwd: repoRoot, report, allowFailure: true });
    await command(["git", "push", "origin", "--delete", report.branch], { cwd: repoRoot, report, allowFailure: true });
    return report;
  } catch (error) {
    report.status = "failed";
    report.notes.push(error instanceof Error ? error.message : String(error));
    await preserveFailedChanges(report, cycleDir);
    return report;
  } finally {
    await command(["git", "checkout", "main"], { cwd: repoRoot, report, allowFailure: true }).catch(() => null);
    report.finishedAt = new Date().toISOString();
    await writeReport(cycleDir, report);
    await rm(lockPath, { force: true }).catch(() => null);
  }
}

async function preserveFailedChanges(report, cycleDir) {
  const diff = await command(["git", "diff"], { cwd: repoRoot, report, capture: true, allowFailure: true, maxBuffer: 20 * 1024 * 1024 });
  if (diff.stdout.trim()) await writeFile(path.join(cycleDir, "failed.diff"), diff.stdout, "utf8");
  await command(["git", "stash", "push", "-u", "-m", `failed ${report.cycleId}`], { cwd: repoRoot, report, allowFailure: true });
}

function automationPrompt({ cycleId, bundlePath }) {
  return `You are Codex running unattended inside the DogeEdge repository.

Cycle ID: ${cycleId}
Snapshot bundle: ${bundlePath ?? "missing"}

Objective:
Assess the latest two-hour DogeEdge review bundle and implement the safest highest-value local improvement to the research/export/test/UI loop.

Hard constraints:
- Do not enable live trading.
- Do not disable dry-run defaults.
- Do not touch live router, order submission, Kalshi credential, src-tauri, api, or dependency files.
- Do not loosen promotion, holdout, sample-size, official-settlement, or manual-approval gates.
- Do not add heavy dependencies or call external services.
- Do not commit or push; the automation runner handles verification and Git.

Priority order:
1. Export reliability and schema clarity.
2. Evidence/reporting quality.
3. Deterministic tests for review-loop behavior.
4. UI visibility for research evidence without changing live-routing behavior.
5. Documentation alignment with actual code.

Required workflow:
1. Inspect the latest bundle and repo state.
2. If evidence is insufficient, improve the exporter/audit/report/test loop rather than loosening strategy gates.
3. Make a small coherent patch only.
4. Run targeted tests if useful.
5. Leave a concise final summary naming changed files, tests run, and remaining risks.

If the best change would touch a blocked live-sensitive area, write a report-only recommendation and make no code changes.`;
}

async function command(args, options = {}) {
  const startedAt = new Date().toISOString();
  const entry = { args, startedAt, finishedAt: null, code: null };
  options.report?.commands?.push(entry);
  const result = await spawnCommand(args, options);
  entry.finishedAt = new Date().toISOString();
  entry.code = result.code;
  if (result.code !== 0 && !options.allowFailure) {
    throw new Error(`${args.join(" ")} failed with code ${result.code}\n${result.stderr}`);
  }
  return result;
}

function spawnCommand(args, options = {}) {
  return new Promise((resolve) => {
    const [commandName, ...commandArgs] = args;
    const child = spawn(commandName, commandArgs, {
      cwd: options.cwd ?? repoRoot,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const maxBuffer = options.maxBuffer ?? 8 * 1024 * 1024;
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxBuffer) stdout = stdout.slice(-maxBuffer);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > maxBuffer) stderr = stderr.slice(-maxBuffer);
    });
    if (options.stdinPath) {
      readFile(options.stdinPath, "utf8")
        .then((text) => child.stdin.end(text))
        .catch(() => child.stdin.end());
    } else {
      child.stdin.end();
    }
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function acquireLock(lockPath, cycleId) {
  try {
    await writeFile(lockPath, `${cycleId}\n${process.pid}\n${new Date().toISOString()}\n`, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

async function latestBundlePath(bundleDir) {
  const entries = await readdir(bundleDir).catch(() => []);
  const files = [];
  for (const name of entries) {
    if (!name.endsWith(".zip")) continue;
    const fullPath = path.join(bundleDir, name);
    const info = await stat(fullPath).catch(() => null);
    if (info) files.push({ fullPath, time: info.mtimeMs });
  }
  return files.sort((left, right) => right.time - left.time)[0]?.fullPath ?? null;
}

async function writeReport(cycleDir, report) {
  await mkdir(cycleDir, { recursive: true });
  await writeFile(path.join(cycleDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(cycleDir, "report.md"), markdownReport(report), "utf8");
}

function markdownReport(report) {
  return [
    "# Codex Auto Improve Cycle",
    "",
    `- Cycle: ${report.cycleId}`,
    `- Status: ${report.status}`,
    `- Branch: ${report.branch}`,
    `- Bundle: ${report.bundlePath ?? "-"}`,
    `- Commit: ${report.commit ?? "-"}`,
    `- Pushed main: ${report.pushedMain ? "yes" : "no"}`,
    "",
    "## Safety",
    report.safety ? `Verdict: ${report.safety.verdict}` : "Not evaluated.",
    ...(report.safety?.reasons ?? []).map((reason) => `- ${reason.type}: ${reason.file ?? ""} ${reason.detail ?? ""}`),
    "",
    "## Changed Files",
    ...(report.changedFiles.length ? report.changedFiles.map((file) => `- ${file}`) : ["- none"]),
    "",
    "## Notes",
    ...(report.notes.length ? report.notes.map((note) => `- ${note}`) : ["- none"]),
  ].join("\n") + "\n";
}

function compactIso(date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return {
    automationRoot: options.out ? path.resolve(options.out, "codex-automation") : undefined,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCodexAutoImproveCycle(parseArgs(process.argv.slice(2))).then((report) => {
    console.log(JSON.stringify({
      cycleId: report.cycleId,
      status: report.status,
      bundlePath: report.bundlePath,
      commit: report.commit,
      pushedMain: report.pushedMain,
    }, null, 2));
    process.exitCode = report.status === "failed" ? 1 : 0;
  });
}
