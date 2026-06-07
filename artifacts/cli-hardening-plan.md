# DogeEdge Loop Hardening Plan

## Executive Summary

This patch hardens the local continuous-improvement loop without changing DogeEdge's paper-safe defaults. The current repo already has event-level validation, purged/embargoed folds, CPCV train/validation rank-degradation approximation, holdout checks, review-packet export, and a local audit tool. The remaining work is to fail closed earlier on trivially small research samples, expose stronger multiple-testing and PBO path evidence, make simulator fills more state-conditional, add drift sample-size guards, add 48-hour snapshot-history trend output, and add a local merge-safety guard for future GPT-CLI patch passes.

## Remaining Weaknesses Found

- `finalHoldoutSplit` still defaults to `minHoldoutEvents: 1`; this is too permissive for review-loop automation.
- `runFactoryResearchPipeline` still simulates and ranks all algos even when the research event sample is too small to support promotion evidence.
- Schema validation blocks explicit future/outcome fields, but post-close live feature rows are not guarded as strictly as they should be for research use.
- CPCV/PBO is already materially stronger than the external audit assumed, but path-level degradation evidence is not exposed in public metrics.
- Multiple-testing output has p-value approximations but not explicit q-values or correlated effective-trial estimates.
- Simulator fills still use static `minFillProbability`/`depthShare` as the main knobs, though telemetry is already exported.
- Drift detection has Page-Hinkley, regime, and fill-quality checks, but no paper sample-size guard before promotion-relevant drift decisions.
- The eval exporter writes current packets, but there is no 48-hour local history index or trend delta report.
- There is no local merge-safety guard that classifies a GPT-CLI patch as auto-mergeable vs requiring human approval.

## Changed Files

Planned:

- `scripts/factory/pipeline.mjs`
- `scripts/factory/holdout.mjs`
- `scripts/factory/schema.mjs`
- `scripts/factory/simulator.mjs`
- `scripts/factory/drift.mjs`
- `scripts/factory/multiple-testing.mjs`
- `scripts/factory/ranking.mjs`
- `scripts/factory/reporting.mjs`
- `scripts/factory/audit-exports.mjs`
- `scripts/export-eval-snapshot.mjs`
- `DOGEEDGE_ALGO_FACTORY.md`
- `package.json`
- `src/core/factory-research.test.ts`
- `src/core/eval-snapshot.test.ts`

## New Files

Planned:

- `scripts/factory/sample-gates.mjs`
- `scripts/factory/snapshot-history.mjs`
- `scripts/merge-safety-check.mjs`
- `src/core/merge-safety.test.ts`
- `artifacts/patch-summary.md`

## Tests To Add

- Insufficient research sample hard-fails before promotion candidates are generated.
- Holdout default requires a meaningful number of events unless explicitly configured.
- Post-close live decision frames fail closed in research mode.
- CPCV path degradation rows are deterministic and public.
- Multiple-testing q-values and effective-trial estimates are deterministic and worsen with larger menus.
- State-conditional simulator fills reduce fill probability and fillable depth under worse latency/spread/liquidity/time-to-close regimes.
- Drift detection is warning-only below the paper evidence sample threshold.
- Snapshot-history trend logic computes latest-vs-previous and latest-vs-baseline deltas.
- Merge-safety guard allows doc/export/audit/report-only diffs and requires human approval for app, live, factory kernel, dependency, or package changes.

## Commands To Run

- `npm test`
- `npm run lint`
- `npm run build`
- `npm run factory:validate`
- `npm run factory:promote-check`
- `npm run eval:bundle -- --out artifacts/eval-smoke --bundle-hours 2 --window-minutes 30 --max-row-lines 100 --max-metrics 50`
- `npm run merge:safety`

## Risks / Rollback Notes

- Earlier sample-size hard-fail will intentionally produce fewer ranked/rejected rows on tiny datasets. This is desired for false-positive control, but UI reports may look sparser on fresh installs.
- State-conditional fill heuristics should make dry/backtest fills more conservative in wide/thin/late/stale regimes. This may lower apparent strategy quality.
- Merge-safety guard is advisory/local. It does not merge or push anything by itself.
- Rollback is safe by reverting the sandbox branch; no live order defaults or backend router settings are changed.

## UI Compatibility Notes

- Existing UI-consumed fields such as `promotionVerdict`, `reasonCodes`, `robustScore`, `adjustedConfidence`, `holdoutPass`, `cpcvSummary`, `dsrApprox`, and `pboApprox` will remain.
- New fields will be additive: q-values, effective trial estimates, CPCV path degradation rows, sufficiency status, conservative/stress pass flags, drift sample status, and snapshot trend summaries.
- No `src/App.tsx` changes are planned unless test output shows the UI cannot read the additive fields.

## Auto-Merge Policy

The new guard will print `ALLOW` only when all changed paths are inside the allowed documentation/export/audit/report/test artifact set. It will print `REQUIRE_HUMAN_APPROVAL` for app code, package/dependency files, factory kernel code, local worker/backtest entry points, Tauri/API files, and any live/Kalshi/order-submission path. The guard is intentionally conservative.

## Acceptance Criteria

- Tests, lint, and build pass or failures are explicitly documented.
- Live trading remains disabled by default.
- No heavy dependencies are added.
- Under-sampled runs fail closed as `insufficient_data` and produce no promotion candidates.
- CPCV/PBO path evidence is more visible and deterministic.
- Multiple-testing output includes q-values and effective trial estimates.
- Simulator execution realism is materially more state-conditional.
- Drift detection has sample-size safeguards.
- Snapshot-history trend output exists for the 48-hour review loop.
- Merge-safety guard exists and is tested.
- Docs match the actual implementation.
