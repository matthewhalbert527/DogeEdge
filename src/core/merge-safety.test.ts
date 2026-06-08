import { describe, expect, it } from "vitest";
import { classifyMergeSafety } from "../../scripts/merge-safety-check.mjs";

describe("merge safety guard", () => {
  it("allows documentation and review-export-only changes", () => {
    const result = classifyMergeSafety([
      "README.md",
      "DOGEEDGE_ALGO_FACTORY.md",
      "scripts/export-eval-snapshot.mjs",
      "scripts/factory/audit-exports.mjs",
      "artifacts/cli-hardening-plan.md",
      "docs/review-loop.md",
    ]);

    expect(result.verdict).toBe("ALLOW");
    expect(result.reasons).toHaveLength(0);
  });

  it("requires human approval for app, dependency, factory kernel, and live-sensitive changes", () => {
    const result = classifyMergeSafety([
      "src/App.tsx",
      "package.json",
      "scripts/factory/pipeline.mjs",
      "scripts/dogeedge-local-worker.mjs",
      "src/core/kalshi.ts",
    ]);

    expect(result.verdict).toBe("REQUIRE_HUMAN_APPROVAL");
    expect(result.reasons.map((reason) => reason.path)).toEqual(expect.arrayContaining([
      "src/App.tsx",
      "package.json",
      "scripts/factory/pipeline.mjs",
      "scripts/dogeedge-local-worker.mjs",
      "src/core/kalshi.ts",
    ]));
  });
});
