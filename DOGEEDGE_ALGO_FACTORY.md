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
```

`factory:validate` runs the full integrity, split, holdout, and reporting pipeline without installing sweep output. `factory:replay-run -- --config <run>\config.json` reruns the saved deterministic config and fails if the decision-frame input manifest no longer matches, unless `--permissive-debug` is explicitly used. `factory:promote-check` emits promotion-ready and non-promotable sets in the saved config and terminal output. `factory:compare` is read-only and compares saved result files. These commands write only local research outputs and never place orders.

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

- validates decision-frame schemas and fails closed on malformed, stale, temporally impossible, or future/outcome-bearing rows unless `--permissive-debug` is used;
- adds explicit `featureTimestamp`, `labelTimestamp`, `marketCloseTimestamp`, and `settlementTimestamp` fields;
- deduplicates exact frames and downsamples highly overlapping near-identical frames;
- splits chronologically by contract/market, not raw frame index;
- runs purged and embargoed folds so training evidence cannot overlap validation label windows;
- runs a practical CPCV-style fold approximation for rank-degradation checks;
- reserves an immutable final holdout made from the latest market events, strictly later than all research, walk-forward, purged, and CPCV windows;
- simulates fills with ask-side entries, bid-side exits, visible-depth limits, partial fills, stale-quote rejection, queue/fill probability, fees, slippage, and adverse-selection stress;
- evaluates base, conservative, and stress cost models.

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

`dsrApprox` is PSR minus transparent complexity and multiple-testing penalties. It is not a canonical Deflated Sharpe Ratio. `pboApprox` is the share of validation folds with non-positive out-of-sample P/L/ROI. It is not a full CPCV logit-rank PBO. The names include `Approx` intentionally so reports do not imply exact academic implementations.

Multiple-testing outputs are:

- `familyAdjustedPValue`: centered trade-P/L bootstrap null for the strategy family;
- `globalAdjustedPValue`: centered trade-P/L bootstrap null across all tested strategies;
- `falseDiscoveryRisk`: simple combined risk from family/global adjusted p-values.

These approximations are designed to penalize sweep-heavy research. They are conservative controls, not proof of profitability.

Promotion verdicts are:

- `insufficient_data`: too few independent markets/days/trades.
- `reject`: failed cost, confidence, fold consistency, drawdown, or concentration gates.
- `paper_only`: passed validation but still needs live paper evidence.
- `tiny_live_eligible`: only possible with separate paper evidence and still disabled by default.

Backtests can install only paper-only generated algos. Real live trading remains guarded by the existing backend live switch, dry-run default, credential checks, hard caps, kill switches, and explicit environment configuration.

Suggested conservative defaults currently implemented:

- at least 50 independent closed markets for research validation;
- at least 7 represented days when available;
- at least 70% positive conservative expectancy folds;
- at least 70% positive CPCV paths;
- positive walk-forward evidence;
- positive conservative-cost final holdout evidence;
- positive conservative-cost P/L;
- non-negative lower confidence bound for conservative expectancy;
- concentration warnings/rejections for excessive one-day, one-market, or one-regime P/L;
- multiple-testing-adjusted confidence required before paper candidacy.

## Paper Evidence And Drift Detection

Holdout evidence and paper evidence are separate. The final holdout proves that a candidate survived a strictly later replay slice. Paper evidence comes from `local-worker\paper-trades.jsonl` after a generated algo runs in the app's paper or dry-live paths. Missing paper evidence keeps the candidate at `paper_only`/validation status and prevents tiny-live eligibility.

Paper/live-paper evidence now has real drift checks. The factory matches generated strategy IDs back to factory algo IDs and compares validation evidence with later paper-style evidence using:

- Page-Hinkley style drift on the P/L stream;
- regime-share drift, such as a strategy validated mostly in one time-to-close bucket but running in another;
- fill-quality drift, including closed/open trade rate and slippage-like fields when the paper rows contain them.

The output fields are `paperEvidence`, `driftOk`, `driftReasons`, and `driftScore`. Material drift blocks or demotes promotion evidence. The current paper trade log does not contain a full reject stream, so fill-quality drift is intentionally conservative and documents that limitation in run output.

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
- random seed.

Use a saved `config.json` plus the same local decision-frame files to rerun the same experiment. If any input file bytes change, `factory:replay-run` reports an input manifest mismatch and stops by default. Use `npm run factory:compare -- --left <path> --right <path>` to compare two saved JSON outputs and explain major ranking changes.

## Reports And UI

`metrics.json`, `metrics.csv`, `candidates.json`, `candidates.csv`, and `report.md` include the major research evidence:

- walk-forward summary;
- purged fold summary;
- CPCV summary;
- final holdout summary;
- conservative and stress cost P/L;
- bootstrap confidence intervals;
- adjusted p-values and false-discovery risk;
- `dsrApprox` and `pboApprox`;
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
