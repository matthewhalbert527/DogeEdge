import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { runCodexAutoImproveCycle } from "./codex-auto-improve.mjs";

const defaultIntervalHours = 2;

export function nextCodexAutoDelayMs({ intervalMs, lastStartedMs, nowMs }) {
  if (!Number.isFinite(lastStartedMs)) return 0;
  return Math.max(0, intervalMs - (nowMs - lastStartedMs));
}

export async function runCodexAutoLoop(options = {}) {
  const intervalHours = positiveNumber(options.intervalHours, defaultIntervalHours);
  const intervalMs = intervalHours * 60 * 60_000;
  let lastStartedMs = Number.NaN;
  while (true) {
    const delayMs = nextCodexAutoDelayMs({ intervalMs, lastStartedMs, nowMs: Date.now() });
    if (delayMs > 0) await sleep(delayMs);
    lastStartedMs = Date.now();
    const report = await runCodexAutoImproveCycle(options);
    console.log(JSON.stringify({
      action: "codex-auto-cycle",
      cycleId: report.cycleId,
      status: report.status,
      commit: report.commit,
      pushedMain: report.pushedMain,
      nextRunAt: new Date(lastStartedMs + intervalMs).toISOString(),
    }, null, 2));
    if (options.once) return report;
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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
    intervalHours: parsed["interval-hours"],
    automationRoot: parsed.out ? `${parsed.out}\\codex-automation` : undefined,
    once: Boolean(parsed.once),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCodexAutoLoop(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
