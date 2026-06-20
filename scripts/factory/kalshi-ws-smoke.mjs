import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadKalshiWsCredentials, redactedCredentialReport } from "./kalshi-ws-auth.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const exitCodes = {
  invalidCli: 2,
  missingCredentials: 3,
  providerAuthenticationFailure: 4,
  subscriptionFailure: 5,
  captureIncomplete: 6,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/factory/kalshi-ws-smoke.mjs --online [--markets-file file|--auto-select-market] [--out dir] [--data-root dir] [--duration-seconds n]");
    process.exit(0);
  }
  const outDir = path.resolve(args.out ?? "artifacts/replay-e2e/ws-smoke");
  const dataRoot = path.resolve(args["data-root"] ?? process.env.DOGEEDGE_DATA_ROOT ?? await defaultDataRoot());
  await mkdir(outDir, { recursive: true });
  const credentials = await loadKalshiWsCredentials(process.env);
  if (!credentials.ok) {
    const report = await writeReport(outDir, {
      status: "missing_credentials",
      ok: false,
      credentials: redactedCredentialReport(credentials),
      reasonCodes: [credentials.reason],
      canPlaceOrders: false,
    });
    console.log(`Kalshi WS smoke blocked: ${credentials.reason}`);
    console.log(`Report: ${report}`);
    process.exit(exitCodes.missingCredentials);
  }

  const marketsFile = args["markets-file"]
    ? path.resolve(String(args["markets-file"]))
    : args["auto-select-market"]
      ? await selectActiveMarketFile({ outDir, dataRoot, args })
      : null;
  if (!marketsFile) {
    const report = await writeReport(outDir, {
      status: "invalid_cli",
      ok: false,
      credentials: redactedCredentialReport(credentials),
      reasonCodes: ["markets_file_or_auto_select_market_required"],
      canPlaceOrders: false,
    });
    console.log(`Kalshi WS smoke blocked: markets file absent`);
    console.log(`Report: ${report}`);
    process.exit(exitCodes.invalidCli);
  }

  const captureOut = path.join(outDir, "capture");
  const durationSeconds = Math.max(3, Math.min(120, Number(args["duration-seconds"] ?? 15)));
  const capture = await runNode([
    "scripts/factory/capture-replay.mjs",
    "--data-root", dataRoot,
    "--markets-file", marketsFile,
    "--mode", "websocket",
    "--out", captureOut,
    "--duration-seconds", String(durationSeconds),
    "--use-yes-price", "true",
  ]);
  const health = await readJsonMaybe(path.join(captureOut, "subscription_health.json"));
  const manifest = await readJsonMaybe(path.join(captureOut, "capture-run-manifest.json"));
  const ok = health?.captureComplete === true;
  const reasonCodes = ok ? [] : uniqueStrings([
    ...(Array.isArray(health?.reasonCodes) ? health.reasonCodes : []),
    ...(manifest?.unavailableReason ? [manifest.unavailableReason] : []),
    ...(capture.exitCode === 0 ? [] : ["capture_command_failed"]),
  ]);
  const report = await writeReport(outDir, {
    status: ok ? "ok" : "capture_incomplete",
    ok,
    dataRoot,
    marketsFile,
    captureOut,
    durationSeconds,
    credentials: redactedCredentialReport(credentials),
    captureStdout: tail(capture.stdout),
    captureStderr: tail(capture.stderr),
    health,
    manifest,
    reasonCodes,
    channelsImplemented: ["orderbook_delta", "trade", "market_lifecycle_v2"],
    useYesPrice: true,
    canPlaceOrders: false,
  });
  console.log(`Kalshi WS smoke: ${ok ? "ok" : "blocked"}`);
  console.log(`Report: ${report}`);
  process.exit(ok ? 0 : exitCodes.captureIncomplete);
}

async function selectActiveMarketFile({ outDir, dataRoot, args }) {
  const targetOut = path.join(outDir, "target-markets");
  await runNode([
    "scripts/factory/target-markets.mjs",
    "--data-root", dataRoot,
    "--out", targetOut,
    "--provider-active",
    "--max-closed", "0",
    "--max-active", String(args["max-markets"] ?? 1),
    "--active-min-lead-minutes", String(args["active-min-lead-minutes"] ?? 1),
    "--provider-active-horizon-minutes", String(args["provider-active-horizon-minutes"] ?? 180),
  ]);
  return path.join(targetOut, "active-targets.json");
}

async function runNode(commandArgs) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, commandArgs, {
      cwd: repoRoot,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    return {
      exitCode: Number(error?.code ?? 1),
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? error?.message ?? error),
    };
  }
}

async function writeReport(outDir, report) {
  const reportPath = path.join(outDir, "online_smoke_report.json");
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: "dogeedge.kalshi-ws-smoke.v1",
    generatedAt: new Date().toISOString(),
    networkRequired: true,
    dryRunOnly: true,
    ...report,
  }, null, 2)}\n`, "utf8");
  return reportPath;
}

async function readJsonMaybe(filePath) {
  try {
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

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function tail(value, max = 6000) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(-max) : text;
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
