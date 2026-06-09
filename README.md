# DogeEdge

DogeEdge is a Windows PC-first, standalone Tauri-ready desktop workstation for DOGE 15-minute prediction-market research. It starts in paper/dry-run mode with the live-trading gate closed. The current implementation includes the operator UI, deterministic settlement/strategy/risk modules, tests, Tauri shell, Windows `.bat` launchers, and a backend-gated Kalshi order router for armed algo-controlled DOGE orders.

## Current Capabilities

- Live DOGE 15-minute dashboard using Coinbase spot data and Kalshi public market/orderbook data where available.
- Final-minute settlement estimator for the 60 one-second average window.
- Strategy decision module for YES/NO/skip evaluation after fee and spread penalties.
- Risk gate with paper-only, dry-run, live enablement, spread, latency, confidence, edge, expiration, and per-trade cap checks.
- Strategy promotion helper with backtest, walk-forward, paper, and tiny-live states.
- Review-bundle exports for exact research/live linkage, official-settlement coverage, raw target-market tick coverage, and simulator calibration from paper evidence.
- AI Observer UI for proposed parameter/code changes, evidence, risk note, and paper/backtest actions.
- Backend-only Kalshi order router that keeps private keys out of the browser and enforces selected-algo, DOGE-series, max-order, account-balance, and same-ticker position/order checks.
- Tauri v2 shell files for the desktop app.

## Safety Defaults

- `DOGEEDGE_LIVE_DRY_RUN` defaults to on.
- `DOGEEDGE_LIVE_TRADING_ENABLED` defaults to off.
- `DOGEEDGE_LIVE_MAX_ORDER_DOLLARS` defaults to `$10`.
- There is no separate max-spent allocation cap; Kalshi account balance is the remaining spend limit.
- Live order submission requires backend Kalshi credentials, the live enable flag, dry-run disabled, Play pressed on the Live page, and a selected generated algo that decides when to buy.

The UI must not display settlement as official until a CF Benchmarks RTI adapter is configured. Exchange feeds are only an estimate.

Promotion and roster surfaces fail closed when official settlement coverage, exact research identity, target-market replay coverage, or review-bundle completeness is missing. Scheduled arena loading records `hold_gather_evidence` instead of rotating new research batches under those conditions. Telemetry-only rows remain visible for diagnosis, but they are separated from the Research Validated Roster.

Generator v2 keeps low-evidence unattended executable minting at zero. Weak-evidence sweeps may still run a tiny lab-only research lane, but lab output cannot populate the Research Validated Roster or executable arena.

## Development

On Windows, use the batch files first:

```text
Install DogeEdge Dependencies.bat
Run DogeEdge PC Preview.bat
Run DogeEdge Tests.bat
Run DogeEdge Desktop.bat
Build DogeEdge Windows Desktop.bat
```

See `PC_SETUP.md` for the PC-specific setup path. See `DOGEEDGE_ALGO_FACTORY.md` for D-drive data capture and local replay backtests.

```bash
npm install
npm run dev
npm run local-worker
npm test
npm run lint
npm run build
```

The Vite app runs on `http://127.0.0.1:1420`. Local development proxies `/api` requests to `https://dogeedge.vercel.app` so the browser can use the same backend data path as production. Newly added API routes require a Vercel redeploy before the local preview can see them through that proxy.

Kalshi backend environment variables:

```text
KALSHI_API_KEY_ID=...
KALSHI_PRIVATE_KEY_PEM=...
KALSHI_BASE_URL=https://external-api.kalshi.com
DOGEEDGE_LIVE_DRY_RUN=1
DOGEEDGE_LIVE_TRADING_ENABLED=0
DOGEEDGE_LIVE_MAX_ORDER_DOLLARS=10
```

For actual live orders, set `DOGEEDGE_LIVE_TRADING_ENABLED=1` and `DOGEEDGE_LIVE_DRY_RUN=0` on the backend, then redeploy.

For local learning data files, run `npm run local-worker`. On Windows with a `D:` drive, the worker writes analysis-ready JSON/JSONL files under `D:\DogeEdge\data`; otherwise it falls back to `data/local-worker`.

## Tauri

The Tauri source lives under `src-tauri/`.

```bash
npm run tauri dev
```

This requires Rust/Cargo on PATH. If Rust is missing, install Rust first, then rerun the command.

On Windows, `Build DogeEdge Windows Desktop.bat` is the intended installer build entrypoint.

## Next Implementation Steps

1. Add durable official-settlement backfill from exchange/historical settlement sources.
2. Add replay-grade Kalshi target-market orderbook/trade recording with sequence-gap checks.
3. Add Kalshi WebSocket user fills/order updates and cancel/reduce-only sell handling.
4. Add SQLite journaling from the Rust core instead of in-memory UI snapshots.
5. Add paid/imported tick-data replay formats in the Backtest Lab.
6. Expand live execution only after exact linkage, settlement, replay, fills, exits, and P/L accounting are verified.
