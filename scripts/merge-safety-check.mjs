#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const exactAllowed = new Set([
  "README.md",
  "DOGEEDGE_ALGO_FACTORY.md",
  "PC_SETUP.md",
  "scripts/export-eval-snapshot.mjs",
  "scripts/run-eval-loop.mjs",
  "scripts/factory/audit-exports.mjs",
  "scripts/factory/reporting.mjs",
]);

const requireApprovalPrefixes = [
  "src/",
  "api/",
  "src-tauri/",
  "scripts/factory/",
];

const requireApprovalExact = new Set([
  "package.json",
  "package-lock.json",
  "scripts/dogeedge-backtest.mjs",
  "scripts/dogeedge-local-worker.mjs",
]);

const liveSensitiveFragments = [
  "kalshi",
  "live-router",
  "order-router",
  "order-submission",
  "submit-order",
  "live-switch",
];

export function classifyMergeSafety(paths) {
  const reasons = [];
  for (const rawPath of paths) {
    const filePath = normalizePath(rawPath);
    if (!filePath) continue;
    if (isAllowedPath(filePath)) continue;
    if (requireApprovalExact.has(filePath)) {
      reasons.push({ path: filePath, reason: "protected_exact_path" });
      continue;
    }
    if (requireApprovalPrefixes.some((prefix) => filePath.startsWith(prefix))) {
      reasons.push({ path: filePath, reason: "protected_code_area" });
      continue;
    }
    if (liveSensitiveFragments.some((fragment) => filePath.toLowerCase().includes(fragment))) {
      reasons.push({ path: filePath, reason: "live_or_order_sensitive_path" });
      continue;
    }
    reasons.push({ path: filePath, reason: "not_in_auto_merge_allowlist" });
  }
  return {
    verdict: reasons.length ? "REQUIRE_HUMAN_APPROVAL" : "ALLOW",
    reasons,
    changedPathCount: paths.length,
  };
}

function isAllowedPath(filePath) {
  if (exactAllowed.has(filePath)) return true;
  if (filePath.startsWith("artifacts/")) return true;
  if (filePath.startsWith("docs/")) return true;
  if (filePath.endsWith(".md") && filePath.startsWith("docs/")) return true;
  if (/^scripts\/factory\/.*(\.test\.[cm]?[jt]s|\/__tests__\/)/.test(filePath)) return true;
  return false;
}

async function changedPaths(base = "origin/main") {
  const git = await gitBinary();
  const diff = await execFileAsync(git, ["-C", repoRoot, "diff", "--name-only", `${base}...HEAD`], { windowsHide: true });
  const working = await execFileAsync(git, ["-C", repoRoot, "diff", "--name-only"], { windowsHide: true });
  const staged = await execFileAsync(git, ["-C", repoRoot, "diff", "--cached", "--name-only"], { windowsHide: true });
  const untracked = await execFileAsync(git, ["-C", repoRoot, "ls-files", "--others", "--exclude-standard"], { windowsHide: true });
  return [...new Set([
    ...diff.stdout.split(/\r?\n/),
    ...working.stdout.split(/\r?\n/),
    ...staged.stdout.split(/\r?\n/),
    ...untracked.stdout.split(/\r?\n/),
  ].map(normalizePath).filter(Boolean))];
}

async function gitBinary() {
  for (const candidate of process.platform === "win32"
    ? ["git", "C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"]
    : ["git"]) {
    try {
      await execFileAsync(candidate, ["--version"], { windowsHide: true });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error("Git is required for merge-safety checks.");
}

function normalizePath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/");
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = args.paths ? String(args.paths).split(",").map((item) => item.trim()).filter(Boolean) : await changedPaths(args.base ?? "origin/main");
  const result = classifyMergeSafety(paths);
  console.log(result.verdict);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.verdict === "ALLOW" ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
