import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const args = parseArgs(process.argv.slice(2));
const intervalMinutes = Math.max(1, Number(args["interval-minutes"] ?? 30));
const once = args.once === true;
const outDir = path.resolve(args.out ?? "artifacts/evidence-loop");
await mkdir(outDir, { recursive: true });

async function runOnce() {
  const startedAt = new Date().toISOString();
  const bootstrapArgs = ["scripts/factory/evidence-bootstrap.mjs"];
  for (const [key, value] of Object.entries(args)) {
    if (key === "interval-minutes" || key === "once" || key === "out") continue;
    bootstrapArgs.push(`--${key}`);
    if (value !== true) bootstrapArgs.push(String(value));
  }
  const record = { startedAt, command: ["node", ...bootstrapArgs], canPlaceOrders: false };
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, bootstrapArgs, {
      cwd: repoRoot,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    Object.assign(record, { status: "ok", stdout: tail(stdout), stderr: tail(stderr) });
  } catch (error) {
    Object.assign(record, { status: "failed", stdout: tail(error?.stdout ?? ""), stderr: tail(error?.stderr ?? error?.message ?? String(error)) });
  }
  record.finishedAt = new Date().toISOString();
  record.nextRunAt = once ? null : new Date(Date.now() + intervalMinutes * 60_000).toISOString();
  await writeFile(path.join(outDir, "latest.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`Evidence loop iteration ${record.status}; next=${record.nextRunAt ?? "none"}`);
  return record;
}

await runOnce();
if (!once) {
  setInterval(() => {
    runOnce().catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    });
  }, intervalMinutes * 60_000);
}

function tail(value, max = 4000) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(-max) : text;
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
