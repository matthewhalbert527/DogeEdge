# DogeEdge PC Setup

This folder is intended to run on a Windows PC.

## Fastest Run

1. Install Node.js LTS from `https://nodejs.org/`.
2. Double-click `Install DogeEdge Dependencies.bat`.
3. Double-click `Run DogeEdge PC Preview.bat`.
4. Leave the black terminal window open. The app opens at `http://127.0.0.1:1420/` after the local server is ready.

This preview mode does not require Rust and is the fastest way to use the operator dashboard on the PC. Local preview uses the live DogeEdge backend for `/api` data, so Coinbase/Kalshi account data and the backend order router can work without exposing credentials in the browser. New API changes must be deployed to the hosted backend before the PC preview sees them.

The preview also starts a local worker on `http://127.0.0.1:8787`. That worker writes paper trades, current rules, generated paper algos, and candidate algorithm data into:

```text
D:\DogeEdge\data
```

If `D:` is not available, it falls back to `data\local-worker` inside this project folder. Codex CLI on the PC can inspect those files directly. See `DOGEEDGE_ALGO_FACTORY.md` for the full data layout and backtest commands.

If the page does not open, check the terminal window:

- If it says port `1420` is already in use, close the other DogeEdge window or stop the old terminal with `Ctrl+C`, then run the preview again.
- If it says Node.js or npm is missing, reinstall Node.js LTS and rerun `Install DogeEdge Dependencies.bat`.
- If the browser opens too early, refresh `http://127.0.0.1:1420/` after the terminal says Vite is ready.

## Native Desktop App

To run or build the Tauri desktop shell on Windows:

1. Install Node.js LTS.
2. Install Rust from `https://rustup.rs/`.
3. Install Microsoft C++ Build Tools with the Desktop C++ workload.
4. Double-click `Run DogeEdge Desktop.bat` for development.
5. Double-click `Build DogeEdge Windows Desktop.bat` to build an installer.

`Run DogeEdge Desktop.bat` also starts the local worker so the native app can keep writing factory data to `D:\DogeEdge\data`.

The Windows installer will be written under:

```text
src-tauri\target\release\bundle
```

## Safety State

DogeEdge currently starts in a non-trading or dry-run state:

- Paper-only mode is active.
- The live-trading backend gate is closed unless `DOGEEDGE_LIVE_TRADING_ENABLED=1`.
- The order router defaults to dry run unless `DOGEEDGE_LIVE_DRY_RUN=0`.
- The backend caps each order at `$10`; there is no separate max-spent allocation cap.
- Real Kalshi orders require backend credentials, Play pressed on the Live page, and a selected generated algo that decides when to buy.
- DOGE settlement is labeled as an exchange estimate until CF Benchmarks RTI access is configured.

## Current Implementation Boundary

The app is PC-runnable now as a dashboard and deterministic strategy/risk prototype. The next engineering layer is deeper live execution accounting:

- Binance/Coinbase/Kraken exchange feeds
- Kalshi market discovery and order book feeds
- SQLite tick and decision journal
- Kalshi WebSocket user fills/order updates
- Cancel/reduce-only sell handling after tiny buy/fill tests pass
