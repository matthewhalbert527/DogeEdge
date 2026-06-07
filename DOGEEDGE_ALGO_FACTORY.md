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

`factory:compare` is read-only and compares saved result files. The other commands write normal local backtest outputs and never place orders.

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
- simulates fills with ask-side entries, bid-side exits, visible-depth limits, partial fills, stale-quote rejection, queue/fill probability, fees, slippage, and adverse-selection stress;
- evaluates base, conservative, and stress cost models.

No code can guarantee consistent profitability. The goal is to reduce false positives and keep promoted algos statistically honest, cost-aware, and conservative.

## Ranking And Promotion

Candidates are no longer ranked by ROI alone. Each strategy receives a `robustScore` that includes:

- out-of-sample and purged-fold consistency;
- conservative/stress cost P/L;
- drawdown and downside risk;
- sample size and independent market count;
- bootstrap confidence intervals;
- PSR/DSR-style confidence approximations;
- PBO-style fold degradation approximation;
- multiple-testing and parameter-complexity penalties;
- concentration penalties for one market, day, side, or narrow regime.

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
- positive conservative-cost P/L;
- non-negative lower confidence bound for conservative expectancy;
- concentration warnings/rejections for excessive one-day, one-market, or one-regime P/L;
- multiple-testing-adjusted confidence required before paper candidacy.

## Reproducibility

Each run writes an `experiment-registry.json` with:

- git commit when available;
- data root and frame path;
- config hash;
- strategy family and parameter hashes;
- trial count;
- fold definitions;
- cost/risk model;
- metrics version;
- random seed.

Use a saved `config.json` plus the local decision-frame files to rerun the same experiment. Use `npm run factory:compare -- --left <path> --right <path>` to compare two saved JSON outputs and explain major ranking changes.

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
