import { describe, expect, it } from "vitest";
import { hardSafetyScan } from "../../scripts/codex-auto-improve.mjs";
import { nextCodexAutoDelayMs } from "../../scripts/codex-auto-loop.mjs";

describe("codex unattended automation guardrails", () => {
  it("allows exporter and documentation patches through the hard safety scan", () => {
    const scan = hardSafetyScan({
      files: [
        "DOGEEDGE_ALGO_FACTORY.md",
        "scripts/export-eval-snapshot.mjs",
        "src/core/eval-snapshot.test.ts",
      ],
      diffText: "+export const safe = true;\n",
    });

    expect(scan.verdict).toBe("ALLOW_AUTO_MERGE");
    expect(scan.reasons).toHaveLength(0);
  });

  it("blocks live-sensitive paths and live-enabling defaults", () => {
    const scan = hardSafetyScan({
      files: [
        "src/core/kalshi.ts",
        "api/order-submit.ts",
        "package.json",
      ],
      diffText: [
        "+DOGEEDGE_LIVE_TRADING_ENABLED=1",
        "+manualApprovalRequired: false",
      ].join("\n"),
    });

    expect(scan.verdict).toBe("BLOCK_AUTO_MERGE");
    expect(scan.reasons.map((reason) => reason.type)).toEqual(expect.arrayContaining(["blocked_path", "blocked_diff"]));
  });

  it("starts immediately, then waits for the configured two-hour cadence", () => {
    const intervalMs = 2 * 60 * 60_000;

    expect(nextCodexAutoDelayMs({ intervalMs, lastStartedMs: Number.NaN, nowMs: 10_000 })).toBe(0);
    expect(nextCodexAutoDelayMs({ intervalMs, lastStartedMs: 0, nowMs: intervalMs - 1_000 })).toBe(1_000);
    expect(nextCodexAutoDelayMs({ intervalMs, lastStartedMs: 0, nowMs: intervalMs })).toBe(0);
  });
});
