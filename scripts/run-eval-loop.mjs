#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { buildReviewBundle, exportEvaluationSnapshot } from "./export-eval-snapshot.mjs";

const defaultSnapshotMinutes = 30;
const defaultBundleHours = 2;

export function nextEvalAction({ nowMs, lastBundleMs, bundleEveryMs }) {
  if (!Number.isFinite(lastBundleMs)) return "bundle";
  return nowMs - lastBundleMs >= bundleEveryMs ? "bundle" : "snapshot";
}

export async function runEvalLoop(options = {}) {
  const snapshotMinutes = numberOption(options.snapshotMinutes, defaultSnapshotMinutes);
  const bundleHours = numberOption(options.bundleHours, defaultBundleHours);
  const snapshotEveryMs = snapshotMinutes * 60_000;
  const bundleEveryMs = bundleHours * 60 * 60_000;
  let lastBundleMs = options.startWithSnapshot ? Date.now() : Number.NaN;

  while (true) {
    const action = nextEvalAction({ nowMs: Date.now(), lastBundleMs, bundleEveryMs });
    if (action === "bundle") {
      const result = await buildReviewBundle({
        ...options,
        windowMinutes: snapshotMinutes,
        bundleHours,
      });
      lastBundleMs = Date.now();
      logResult("bundle", result);
    } else {
      const result = await exportEvaluationSnapshot({
        ...options,
        windowMinutes: snapshotMinutes,
      });
      logResult("snapshot", result);
    }
    if (options.once) return;
    await sleep(snapshotEveryMs);
  }
}

function logResult(action, result) {
  console.log(JSON.stringify({
    action,
    snapshotId: result.snapshot.snapshotId,
    snapshotPath: result.snapshotPath,
    bundlePath: result.bundlePath ?? null,
    alerts: result.snapshot.alerts,
    liveSafety: result.snapshot.appState.liveSafety,
    nextCheck: action === "bundle" ? "snapshot interval" : "bundle interval",
  }, null, 2));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return {
    dataRoot: parsed["data-root"],
    storageDir: parsed["storage-dir"],
    backtestsDir: parsed["backtests-dir"],
    outDir: parsed.out,
    snapshotMinutes: parsed["snapshot-minutes"],
    bundleHours: parsed["bundle-hours"],
    includeRows: parsed["no-rows"] ? false : true,
    maxRowLines: parsed["max-row-lines"],
    maxMetrics: parsed["max-metrics"],
    startWithSnapshot: Boolean(parsed["start-with-snapshot"]),
    once: Boolean(parsed.once),
  };
}

function numberOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEvalLoop(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
