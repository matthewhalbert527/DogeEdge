# DogeEdge Algo Factory

DogeEdge can store replayable paper-market data on the `D:` drive and run local backtests against that data.

## Data Location

On Windows, the local worker now defaults to:

```text
D:\DogeEdge\data
```

Primary folders:

```text
D:\DogeEdge\data\local-worker
D:\DogeEdge\data\events
D:\DogeEdge\data\features\decision-frames
D:\DogeEdge\data\raw\snapshots
D:\DogeEdge\data\backtests
D:\DogeEdge\algos
```

`local-worker` keeps the existing files used by the app and Codex:

- `paper-events.jsonl`
- `paper-trades.jsonl`
- `shadow-events.jsonl` legacy filename for background test events
- `shadow-trades.jsonl` legacy filename for background test trades
- `latest.json`
- `summary.md`

`features\decision-frames` is the backtest input. It records one normalized decision frame per local worker ingest, including target, estimate, DOGE spot, one-minute move, top-of-book YES/NO prices, spreads, model action, edge, confidence, and seconds to close.

`raw\snapshots` stores fuller runtime snapshots for later feature engineering.

## Running Data Capture

The Windows launchers set `DOGEEDGE_DATA_DIR` automatically when `D:` exists.

```text
Run DogeEdge Desktop.bat
```

or:

```text
Run DogeEdge PC Preview.bat
```

Manual worker command:

```powershell
$env:DOGEEDGE_DATA_DIR = "D:\DogeEdge\data\local-worker"
npm run factory:worker
```

The app posts local worker snapshots once per second when running on `localhost` or `127.0.0.1`.

## Running Backtests

Default:

```powershell
npm run factory:backtest
```

With filters:

```powershell
npm run factory:backtest -- --since 2026-05-31 --algo spread-scalp-2c,momentum-max-6c
```

Broad sweep:

```powershell
npm run factory:sweep
```

The sweep mode generates a broad grid of model-window, distance, spread-scalp, momentum, weak-model fade, momentum-fade, target-reversion, managed scalp, cheap longshot, late favorite, liquidity-imbalance, and paired YES+NO variants. It is designed to test many approaches against the captured decision frames without slowing the live app loop.

Additional research commands:

```powershell
npm run factory:validate
npm run factory:replay-run
npm run factory:compare
npm run factory:promote-check
npm run factory:audit-exports -- --input review_exports
npm run factory:gate-report -- --input review_exports
npm run factory:reconcile-top-roster -- --input review_exports
npm run eval:snapshot
npm run eval:bundle
npm run eval:loop
npm run codex:auto-cycle
npm run codex:auto-loop
npm run merge:safety
```

`factory:validate` runs the full integrity, split, holdout, and reporting pipeline without installing sweep output. `factory:replay-run -- --config <run>\config.json` reruns the saved deterministic config and fails if the decision-frame input manifest no longer matches, unless `--permissive-debug` is explicitly used. `factory:promote-check` emits promotion-ready and non-promotable sets in the saved config and terminal output. `factory:compare` is read-only and compares saved result files. These commands write only local research outputs and never place orders.

`factory:audit-exports` validates a local review packet such as `review_exports/`, accepts split `latest.json`/`metrics.json` manifests, recomputes split/fold/holdout evidence from the frame sample, and writes:

```text
artifacts\factory-audit\audit-report.json
artifacts\factory-audit\audit-report.md
artifacts\factory-audit\fold-diff.json
artifacts\factory-audit\fold-diff.md
artifacts\factory-audit\final-review.json
artifacts\factory-audit\final-review.md
artifacts\factory-audit\metrics-compare.csv
artifacts\factory-audit\promotion-stages.mmd
```

`eval:snapshot` writes a local `dogeedge.eval.snapshot.v1` packet for the most recent 30-minute review window. `eval:bundle` writes a two-hour review bundle containing the latest half-hour snapshot JSON files, TSV evidence, a repo artifact bundle, and an experiment-registry tarball. Both commands are local-only, deterministic, and review-oriented. They do not upload files, install strategies, change live-routing settings, or place orders.

`eval:loop` leaves a foreground terminal process running. It writes a bundle immediately, then keeps writing snapshots every 30 minutes and bundles every 2 hours. Use `Ctrl+C` to stop it. For a Windows restart-proof setup, run this command from Task Scheduler at logon; the command itself stays local-only and paper-safe.

`codex:auto-loop` is the unattended two-hour Codex improvement runner. It writes a fresh review bundle, creates a temporary `auto/codex-*` branch, runs `codex exec` with a local-only hardening prompt, verifies the patch with tests/lint/build/factory checks, and fast-forwards `main` only if the hard safety scan passes. It blocks auto-merge for live-sensitive paths, dependency changes, live-trading defaults, dry-run disabling, or manual-approval removal. Failed or blocked attempts are preserved under `review_exports\codex-automation\<cycle>\` with reports and diffs instead of being merged.

Default Windows output:

```text
D:\DogeEdge\data\gpt-review-packets\snapshots\snap-YYYYMMDDTHHMMSSZ\
D:\DogeEdge\data\gpt-review-packets\bundles\dogeedge-review-bundle-YYYYMMDDTHHMMSSZ\
D:\DogeEdge\data\gpt-review-packets\bundles\dogeedge-review-bundle-YYYYMMDDTHHMMSSZ.zip
```

Useful exporter options:

```powershell
npm run eval:snapshot -- --max-row-lines 1000
npm run eval:bundle -- --max-row-lines 1000
npm run eval:loop -- --max-row-lines 1000
npm run eval:bundle -- --full-rows
npm run eval:bundle -- --raw-tick-format jsonl --max-raw-tick-markets 20
npm run eval:bundle -- --no-rows
npm run eval:bundle -- --out D:\DogeEdge\data\gpt-review-packets
```

The row-level decision/trade extracts are capped by `--max-row-lines` so the packet does not accidentally include the full paper-trade log. Routine two-hour reviews should stay capped. Promotion-review audits should use `--full-rows`, which marks `rowExport.promotionReviewComplete = true` in the snapshot and bundle manifest. `factory:audit-exports -- --promotion-review` fails closed when it sees capped rows.

`--raw-tick-format jsonl` writes compact per-market raw-tick samples from `raw\snapshots` under `snapshots\raw_market_ticks\jsonl\`. This is the current lightweight replay-calibration export. The manifest still emits `raw_market_tick_parquet_absent` until true per-market parquet replay files exist, so execution-realism scoring remains explicitly limited.

`factory:gate-report` runs the export audit with the research gate report enabled. It says whether arena batch loading is allowed or whether DogeEdge should stay in `hold_gather_evidence`. `factory:reconcile-top-roster` compares Top Traders aggregate P/L with exported trade rows and flags unreconciled telemetry.

## Continuous Improvement Review Loop

The recommended loop keeps DogeEdge's normal app and local-worker cadence intact and layers review packets on top:

- every 30 minutes: run `npm run eval:snapshot`;
- every 2 hours: run `npm run eval:bundle`;
- after each two-hour bundle: review the machine-readable snapshot, TSVs, repo bundle, registry tarball, and safety alerts;
- apply only safe local-file improvements to exporter reliability, evidence quality, validation coverage, alerting, reports, tests, and UI visibility;
- run `npm test`, `npm run lint`, and `npm run build` before committing changes;
- keep live trading disabled by default and require manual approval for any live-router or real-order-related change.

The review bundle includes:

- `manifest.json` with SHA-256 hashes, byte counts, safety status, alerts, and snapshot IDs;
- `snapshots/snap-*.json.gz` using schema `dogeedge.eval.snapshot.v1`;
- `snapshots/algoMetrics.tsv.gz`;
- `snapshots/foldMetrics.tsv.gz`;
- `snapshots/decisionAggregates.tsv.gz`;
- `snapshots/tradeAggregates.tsv.gz`;
- `snapshots/warnings.tsv.gz`;
- capped `decisionRows.tsv.gz` and `tradeRows.tsv.gz` unless `--no-rows` is used;
- exact review files `snapshots/decision_frames.jsonl`, `snapshots/trades.csv`, and `snapshots/paper_decision_ledger.csv`;
- leakage and roster-alignment artifacts: `snapshots/leakage_audit.json`, `snapshots/post_close_frame_audit.tsv.gz`, `snapshots/research_live_alignment.json`, `snapshots/roster_alignment.tsv.gz`, `snapshots/research_coverage_by_family.tsv.gz`, `snapshots/live_coverage_by_family.tsv.gz`, `snapshots/unsupported_live_families.tsv.gz`, `snapshots/promotion_gate_results.tsv.gz`, `snapshots/family_allocation_report.json`, and `snapshots/top_roster_default_sort_audit.json`;
- `snapshots/raw_market_ticks/manifest.json` and `snapshots/raw_market_ticks/schema.json`. When replayable per-market parquet ticks are unavailable, the manifest must say so explicitly with `raw_market_tick_parquet_absent`;
- `snapshots/snapshot-history-48h.json` and `snapshots/snapshot-history-48h.md` with latest-vs-previous and latest-vs-baseline trend deltas;
- `repo/` files needed to interpret the packet against the exact local code snapshot;
- `registry/experiment-registry.tar.gz`.

The exporter redacts absolute metadata paths in packet JSON to `_REPO_ROOT_` and `_DATA_ROOT_`. Market tickers, algo IDs, timestamps, prices, sizes, hashes, and git commits remain plain because they are needed for replay and audit.

## Official Settlement And Search Budget Gates

Decision frames and backtest metrics now carry:

- `labelSource`: `official_resolution`, `pre_close_frame_proxy`, or `unknown`;
- `settlementSource`: `official_resolution`, `estimated`, or `unknown`;
- `officialResolutionAvailable`;
- `officialSettlementCoverage`.

Estimated/proxy labels remain useful for paper research and UI evidence collection, but they are not promotion-grade labels. A candidate can never become `tiny_live_eligible` unless `labelSource === "official_resolution"`, `settlementSource === "official_resolution"`, and official-settlement coverage clears the configured threshold. If official settlement is missing, the best possible verdict is `paper_only`, with reason codes such as `official_settlement_required`, `official_label_required`, and `official_settlement_coverage_low`.

Sweep breadth is also governed by the available evidence. If the event count is too low or official-settlement coverage is below the configured threshold, the factory caps generated sweep algos and blocks deep-sweep expansion. The output includes a `searchBudget` object with `limited`, `deepSweepAllowed`, `requestedSweepAlgos`, `maxGeneratedAlgos`, `officialSettlementCoverage`, and reason codes such as `search_budget_limited_by_sample_size` or `deep_sweep_blocked_low_official_coverage`.

Post-close feature rows are fail-closed by default. If `featureTimestamp >= marketCloseTimestamp`, `readFactoryDecisionFrames` excludes the frame unless the caller explicitly enables a debug-only post-close mode. The loader and data-quality summaries publish `excludedFrames` and `postCloseFramesExcluded`, and review bundles repeat those counts in the leakage audit artifacts.

The app now keeps Top Traders in two explicit lanes:

- `Research Validated Roster`: only rows whose executable family is research-supported and whose latest research evidence passes `researchPromotionGate`. This is the only lane that can supply Champion, Prospect, or active ranked roster rows.
- `Telemetry Watchlist`: unsupported families, missing-evidence rows, rejected rows, and insufficient-data rows. These rows remain visible for hypothesis generation and dry-run evidence collection, but they cannot become the default ranked winner surface.

Dry-run executable stats remain visible as operational telemetry, but large arena batch churn is held when the latest research sweep has no candidate passing official settlement, holdout, walk-forward, CPCV, conservative/stress cost, and multiple-testing gates. In that state DogeEdge shows "No research-validated algos yet" instead of backfilling the ranked roster with telemetry winners. Executable families must be listed in the family registry before they can become Champion or Prospect rows; unsupported families remain Watch-only and are exported through the research/live alignment artifacts until a research adapter exists.

`merge:safety` is a local advisory guard for GPT-CLI patch passes. It prints `ALLOW` only for documentation/export/audit/report/test-artifact diffs. It prints `REQUIRE_HUMAN_APPROVAL` for app code, dependencies, factory kernel files, local worker/backtest entry points, Tauri/API files, and live/Kalshi/order-sensitive paths. It does not merge, push, or change runtime behavior.

Each run writes:

```text
D:\DogeEdge\data\backtests\runs\<run-id>\config.json
D:\DogeEdge\data\backtests\runs\<run-id>\metrics.json
D:\DogeEdge\data\backtests\runs\<run-id>\metrics.csv
D:\DogeEdge\data\backtests\runs\<run-id>\trades.jsonl
D:\DogeEdge\data\backtests\runs\<run-id>\report.md
```

Sweep runs write to `D:\DogeEdge\data\backtests\sweeps\<run-id>` with the same files plus `candidates.json` and `candidates.csv`. `D:\DogeEdge\data\backtests\latest.json` points to the latest run, and `latest-sweep.json` points to the latest broad sweep.

## Research-Grade Validation

The factory now treats each 15-minute market ticker as an event with a label horizon. Decision frames are not treated as independent IID rows. A candidate must survive event-level validation before it can appear as a paper candidate.

The validation pipeline:

- fails closed before expensive ranking/promotion when the event sample is too small for research evidence;
- validates decision-frame schemas and fails closed on malformed, stale, temporally impossible, or future/outcome-bearing rows unless `--permissive-debug` is used;
- adds explicit `featureTimestamp`, `labelTimestamp`, `marketCloseTimestamp`, and `settlementTimestamp` fields;
- deduplicates exact frames and downsamples highly overlapping near-identical frames;
- splits chronologically by contract/market, not raw frame index;
- runs purged and embargoed folds so training evidence cannot overlap validation label windows;
- runs a practical CPCV-style fold approximation for rank-degradation checks;
- reserves an immutable final holdout made from the latest market events, strictly later than all research, walk-forward, purged, and CPCV windows;
- simulates fills with ask-side entries, bid-side exits, visible-depth limits, partial fills, stale-quote rejection, queue/fill probability, fees, slippage, and adverse-selection stress;
- evaluates base, conservative, and stress cost models.

The sample gate is intentionally conservative. By default the research loop requires at least 60 market events, 12 final-holdout events, 30 closed trades, 50 independent closed markets, 7 represented days, and 5 closed trades per tested fold before treating ranking/promotion evidence as meaningful. If the sample is below the event/fold/holdout gate, the output is `insufficient_data`, no candidates are generated, and the report shows the reason codes instead of flooding the run with noisy rejection rows.

No code can guarantee consistent profitability. The goal is to reduce false positives and keep promoted algos statistically honest, cost-aware, and conservative.

## Final Holdout

The final holdout is not used to choose parameters, build CPCV folds, or compute the walk-forward slice. It is the last event-based slice of the local decision-frame history. Promotion above `research_candidate` requires positive conservative-cost holdout evidence:

- `holdoutPass` must be true;
- the split must be `strictlyLater`;
- `holdoutConservativeTotalPnl` must be positive;
- `holdoutLowerCi` must clear the configured lower-bound threshold;
- holdout closed trades and independent markets must meet `minHoldoutClosed` and `minHoldoutMarkets`.

If the local dataset is too small, the correct output is `insufficient_data` or `reject`, not a profitable-looking promotion.

## Ranking And Promotion

Candidates are no longer ranked by ROI alone. Each strategy receives a `robustScore` that includes:

- out-of-sample and purged-fold consistency;
- walk-forward pass/fail and P/L;
- CPCV positive-path rate and median out-of-sample P/L;
- immutable final holdout pass/fail and conservative holdout P/L;
- conservative/stress cost P/L;
- drawdown and downside risk;
- sample size and independent market count;
- bootstrap confidence intervals;
- `psr`, `dsrApprox`, and `pboApprox` confidence/degradation fields;
- family-level and global bootstrap multiple-testing p-value approximations;
- concentration penalties for one market, day, side, or narrow regime.

The statistical fields are inspectable, deterministic approximations of published methods:

- `psr` follows the Bailey/Lopez de Prado Probabilistic Sharpe Ratio shape using sample length, observed skewness, and kurtosis.
- `dsrApprox` deflates PSR against an expected maximum Sharpe threshold from the effective trial count. It is closer to the Bailey/Lopez de Prado Deflated Sharpe Ratio than a simple penalty, but remains approximate because DogeEdge uses short event-level trade samples rather than full return series.
- `pboApprox` uses CPCV train-vs-validation rank degradation when CPCV train metrics are present, with fold-failure fallback when older outputs lack CPCV train rows.
- `familyAdjustedPValue` and `globalAdjustedPValue` use market-block strategy-menu bootstrap distributions inspired by White's Reality Check and Hansen's Superior Predictive Ability test. The SPA approximation is studentized and the bootstrap resamples 15-minute market/event blocks, not pooled individual trades.

The `Approx` suffix is intentional for DSR/PBO/RC/SPA-style fields because these are practical local implementations, not canonical academic test packages.

Multiple-testing outputs are:

- `familyAdjustedPValue`: family-level market-block menu bootstrap p-value;
- `globalAdjustedPValue`: global market-block menu bootstrap p-value;
- `familyQValue`: Benjamini-Hochberg q-value within the strategy family;
- `globalQValue`: Benjamini-Yekutieli q-value across the full tested menu;
- `effectiveFamilyTrials` and `effectiveTotalTrials`: correlated effective strategy-menu size estimated from market-level P/L vectors;
- `realityCheckApproxPValue`: White Reality Check-style global menu p-value approximation;
- `spaApproxPValue`: Hansen SPA-style studentized global menu p-value approximation;
- `falseDiscoveryRisk`: simple combined risk from adjusted p-values, q-values, and Reality Check approximation.

These approximations are designed to penalize sweep-heavy research. They are conservative controls, not proof of profitability.

Promotion verdicts are:

- `insufficient_data`: too few independent markets/days/trades.
- `reject`: failed cost, confidence, fold consistency, drawdown, or concentration gates.
- `paper_only`: passed validation but still needs live paper evidence.
- `tiny_live_eligible`: only possible with separate paper evidence and still disabled by default.

Backtests can install only paper-only generated algos. Real live trading remains guarded by the existing backend live switch, dry-run default, credential checks, hard caps, kill switches, and explicit environment configuration.

Suggested conservative defaults currently implemented:

- at least 60 market events before ranking/promotion evidence is considered meaningful;
- at least 50 independent closed markets for research validation;
- at least 30 closed trades per strategy;
- at least 12 final-holdout events in the research dataset;
- at least 7 represented days when available;
- at least 70% positive conservative expectancy folds;
- at least 70% positive CPCV paths;
- positive walk-forward evidence;
- positive conservative-cost final holdout evidence;
- positive conservative-cost P/L;
- non-negative lower confidence bound for conservative expectancy;
- concentration warnings/rejections for excessive one-day, one-market, or one-regime P/L;
- multiple-testing-adjusted confidence required before paper candidacy.

## Simulator Telemetry, Paper Evidence, And Drift Detection

Simulation trades now carry execution telemetry into `metrics.json`, `metrics.csv`, drift checks, and reports:

- modeled slippage in cents;
- queue result and queue miss reason;
- requested, fillable, and filled contracts;
- partial fill ratio;
- fill probability used and deterministic fill roll where relevant;
- fill-depth utilization;
- stale-quote rejects;
- latency bucket;
- compact book context/hash.

This prevents reports from silently showing `avgSlippage=0` when conservative or stress cost models actually applied slippage.

Fill probability and visible-depth consumption are state-conditional. The simulator starts from each cost model's `minFillProbability` and `depthShare`, then degrades them by latency bucket, spread bucket, visible depth/liquidity bucket, time-to-close bucket, side, and entry/exit action. These are transparent heuristics, not a calibrated exchange queue model, but they prevent late/thin/wide/stale regimes from looking as executable as early/deep/tight regimes.

Holdout evidence and paper evidence are separate. The final holdout proves that a candidate survived a strictly later replay slice. Paper evidence comes from `local-worker\paper-trades.jsonl` after a generated algo runs in the app's paper or dry-live paths. Missing paper evidence keeps the candidate at `paper_only`/validation status and prevents tiny-live eligibility.

Paper/live-paper evidence now has real drift checks. The factory matches generated strategy IDs back to factory algo IDs and compares validation evidence with later paper-style evidence using:

- Page-Hinkley style drift on the P/L stream;
- regime-share drift, such as a strategy validated mostly in one time-to-close bucket but running in another;
- fill-quality drift, including closed/open trade rate and slippage-like fields when the paper rows contain them.

The output fields are `paperEvidence`, `driftOk`, `driftReasons`, `driftScore`, and drift `components`. Drift decisions are warning-only until at least 20 paper closes are available, because tiny paper samples can over-trigger. Material drift blocks or demotes promotion evidence once the sample threshold is met. The current paper trade log does not contain a full reject stream, so fill-quality drift is intentionally conservative and documents that limitation in run output.

## Reproducibility

Each run writes an `experiment-registry.json` with:

- git commit when available;
- data root and frame path;
- exact input manifest hash;
- every input decision-frame file path, byte size, and SHA-256 hash;
- config hash;
- strategy family and parameter hashes;
- trial count;
- fold definitions;
- CPCV fold definitions;
- immutable holdout event IDs;
- cost/risk model;
- metrics version;
- root random seed and child seed plan.

Use a saved `config.json` plus the same local decision-frame files to rerun the same experiment. If any input file bytes change, `factory:replay-run` reports an input manifest mismatch and stops by default. Use `npm run factory:compare -- --left <path> --right <path>` to compare two saved JSON outputs and explain major ranking changes.

All bootstrap, multiple-testing, simulator, and fold-comparison streams derive from the recorded root seed. If Git is unavailable, the registry records `codeVersion: "UNAVAILABLE"` and marks reproducibility as partial rather than pretending the run is exact.

## Reports And UI

`metrics.json`, `metrics.csv`, `candidates.json`, `candidates.csv`, and `report.md` include the major research evidence:

- walk-forward summary;
- purged fold summary;
- CPCV summary;
- final holdout summary;
- conservative and stress cost P/L;
- bootstrap confidence intervals;
- adjusted p-values and false-discovery risk;
- family/global q-values;
- effective family/global trial counts;
- `dsrApprox` and `pboApprox`;
- CPCV path degradation summary;
- paper evidence and drift status;
- rejection reasons and warnings.

The Factory page shows a `Factory Research Evidence` table with top family rows sorted by robust score. Unsafe candidates remain programmatically non-promotable.

## In-App Promotion

Open the `Factory` page in the app to see the latest broad sweep visual, best candidate by family, promoted generated paper algos, automation status, and past activation results.

Sweep winners that include replayable parameters can be promoted only if the robust factory output does not mark them `nonPromotable`. `Promote` installs the selected generated algo as its own paper-only strategy, and `Enable` / `Disable` controls whether it can open future paper trades. Generated paper algos are exported as `generatedPaperAlgos` in the local worker files.

## Promotion Path

1. Capture live decision frames.
2. Backtest built-in and candidate algos against those frames.
3. Promote promising sweep winners as generated paper algos.
4. Keep generated algos active only after enough closed live paper samples.
5. Keep real trading disabled until live trading has separate risk limits, backend credentials, and manual approval.

Backtests are review-only and do not place real Kalshi orders.

## Statistical References

The factory uses lightweight local approximations inspired by these primary methods:

- Bailey and Lopez de Prado, "The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest Overfitting and Non-Normality" (Journal of Portfolio Management, 2014): https://ssrn.com/abstract=2460551
- Bailey, Borwein, Lopez de Prado, and Zhu, "The Probability of Backtest Overfitting" (Journal of Computational Finance, 2016): https://ssrn.com/abstract=2326253
- White, "A Reality Check for Data Snooping" (Econometrica, 2000): https://doi.org/10.1111/1468-0262.00152
- Hansen, "A Test for Superior Predictive Ability" (Journal of Business & Economic Statistics, 2005): https://ssrn.com/abstract=264569

These references motivate the safeguards. DogeEdge does not claim canonical, publication-grade implementations of DSR, PBO, Reality Check, or SPA.
