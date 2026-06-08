# DogeEdge Loop Hardening Patch Summary

## Executive Summary

This sandbox branch hardens the local improvement loop without enabling live trading or changing real-order defaults. The patch adds fail-closed research sample gating, stricter post-close feature exclusion, stronger multiple-testing outputs, more visible CPCV/PBO path evidence, state-conditional simulator fill heuristics, drift sample-size guards, 48-hour eval snapshot history, and a local merge-safety guard.

## Changed Files

- `.gitignore`
- `DOGEEDGE_ALGO_FACTORY.md`
- `package.json`
- `public/version.json`
- `scripts/dogeedge-backtest.mjs`
- `scripts/export-eval-snapshot.mjs`
- `scripts/factory/audit-exports.mjs`
- `scripts/factory/data.mjs`
- `scripts/factory/drift.mjs`
- `scripts/factory/holdout.mjs`
- `scripts/factory/multiple-testing.mjs`
- `scripts/factory/pipeline.mjs`
- `scripts/factory/promotion.mjs`
- `scripts/factory/ranking.mjs`
- `scripts/factory/registry.mjs`
- `scripts/factory/reporting.mjs`
- `scripts/factory/schema.mjs`
- `scripts/factory/simulator.mjs`
- `src/core/eval-snapshot.test.ts`
- `src/core/factory-research.test.ts`

## New Files

- `artifacts/cli-hardening-plan.md`
- `artifacts/patch-summary.md`
- `scripts/factory/sample-gates.mjs`
- `scripts/factory/snapshot-history.mjs`
- `scripts/merge-safety-check.mjs`
- `src/core/merge-safety.test.ts`

## High-Priority Fixes Implemented

- Added `sampleSufficiency` gates with conservative defaults and early `insufficient_data` output on under-sampled research runs.
- Changed final holdout default from 1 event to 12 events.
- Kept direct schema validation strict for post-close feature rows, while ingestion now excludes those rows from feature generation with warnings.
- Changed event label timestamps to close-or-later while preserving the pre-close frame as the estimated label source.
- Added family/global q-values and correlated effective-trial estimates to multiple-testing outputs.
- Added CPCV path degradation rows and summary fields alongside existing `pboApprox`.
- Added state-conditional fill probability and depth-share heuristics using latency, spread, liquidity, time-to-close, side, and action.
- Added drift warning-only behavior below 20 paper closes.
- Added exact registry fields for schema version, cost model hash, and risk model hash.
- Added 48-hour snapshot-history JSON/Markdown generation and included it in eval bundles.
- Added `npm run merge:safety` local guard with allow/approval classification.

## Commands Run

- `npx vitest run src\core\factory-research.test.ts src\core\eval-snapshot.test.ts src\core\merge-safety.test.ts`: pass, 31 tests.
- `npm test`: pass, 88 tests.
- `npm run lint`: pass with 2 existing React hook warnings in `src/App.tsx`.
- `npm run build`: pass with existing Vite chunk-size warning.
- `npm run factory:validate -- --bootstrap-iterations 100 --run-id loop-hardening-validate`: pass.
- `npm run factory:promote-check -- --bootstrap-iterations 100 --run-id loop-hardening-promote-check`: timed out after 304 seconds on the full sweep menu.
- `npm run factory:promote-check -- --bootstrap-iterations 100 --run-id loop-hardening-promote-check-smoke --algo final60-lock-v1`: pass, 0 ready and 1 non-promotable.
- `npm run eval:bundle -- --out artifacts\eval-smoke --bundle-hours 2 --window-minutes 30 --max-row-lines 100 --max-metrics 50`: pass.
- `npm run factory:audit-exports -- --input review_exports --out artifacts/factory-audit`: pass, verdict `usable_with_warnings`.
- `npm run merge:safety`: expected `REQUIRE_HUMAN_APPROVAL` because this branch touches protected factory kernel, package, and test files.

## Remaining Risks

- State-conditional fill heuristics are transparent but not exchange-calibrated; they should reduce over-optimistic fills but are not a full queue model.
- The full unfiltered sweep promote-check can still exceed a practical CLI timeout. The smoke promote-check validates the code path, but a full overnight run may still be needed for complete sweep evidence.
- The review packet history is local and file-based; it is not a durable database.
- Merge-safety is advisory. It prints a decision but does not enforce GitHub branch protection by itself.

## Merge Recommendation

`REQUIRE_HUMAN_APPROVAL`.

The patch intentionally touches protected factory kernel files, `package.json`, and test files. It should be reviewed before merging to `main`. No live trading defaults were enabled or weakened.
