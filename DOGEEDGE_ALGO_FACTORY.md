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

Each run writes:

```text
D:\DogeEdge\data\backtests\runs\<run-id>\config.json
D:\DogeEdge\data\backtests\runs\<run-id>\metrics.json
D:\DogeEdge\data\backtests\runs\<run-id>\metrics.csv
D:\DogeEdge\data\backtests\runs\<run-id>\trades.jsonl
D:\DogeEdge\data\backtests\runs\<run-id>\report.md
```

Sweep runs write to `D:\DogeEdge\data\backtests\sweeps\<run-id>` with the same files plus `candidates.json` and `candidates.csv`. `D:\DogeEdge\data\backtests\latest.json` points to the latest run, and `latest-sweep.json` points to the latest broad sweep.

## In-App Promotion

Open the `Factory` page in the app to see the latest broad sweep visual, best candidate by family, promoted generated paper algos, automation status, and past activation results.

Sweep winners that include replayable parameters can be promoted from the `Latest Broad Sweep` panel. `Promote` installs the selected generated algo as its own paper-only strategy, and `Enable` / `Disable` controls whether it can open future paper trades. Generated paper algos are exported as `generatedPaperAlgos` in the local worker files.

## Promotion Path

1. Capture live decision frames.
2. Backtest built-in and candidate algos against those frames.
3. Promote promising sweep winners as generated paper algos.
4. Keep generated algos active only after enough closed live paper samples.
5. Keep real trading disabled until live trading has separate risk limits, backend credentials, and manual approval.

Backtests are review-only and do not place real Kalshi orders.
