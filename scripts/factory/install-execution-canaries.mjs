import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node scripts/factory/install-execution-canaries.mjs [--from source] [--run-id id] [--max-candidates n] [--data-root dir] [--storage-dir dir]");
  process.exit(0);
}

const translated = ["scripts/factory/evidence-lane.mjs", "--executable-only"];
for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === "--max-candidates") {
    translated.push("--max-probes", args[index + 1] ?? "3");
    index += 1;
  } else {
    translated.push(value);
  }
}
if (!translated.includes("--max-probes")) translated.push("--max-probes", "3");

try {
  const { stdout, stderr } = await execFileAsync(process.execPath, translated, {
    cwd: repoRoot,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} catch (error) {
  process.stdout.write(String(error?.stdout ?? ""));
  process.stderr.write(String(error?.stderr ?? error?.message ?? error));
  process.exit(Number(error?.code ?? 1));
}
