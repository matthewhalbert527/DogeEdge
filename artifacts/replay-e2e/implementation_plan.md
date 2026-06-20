# Replay E2E Implementation Plan

1. Preserve the newest local evidence-plane branch and implement on a side branch.
2. Reuse the existing raw TLS Kalshi WebSocket transport; add shared credential loading and redacted auth reporting.
3. Require subscription acknowledgement, initial snapshot, and real target-market events before capture is complete.
4. Add deterministic order-book reconstruction and sequence audit outputs to replay build artifacts.
5. Add read-only CLI commands: factory:ws-smoke, factory:install-execution-canaries, factory:e2e-evidence.
6. Generate immutable artifacts/e2e-evidence/<runId>/ directories tying candidate lineage, replay, settlement, paper rows, and parity.
7. Verify with focused tests, lint/build/full tests as feasible, offline fixture, and online smoke when credentials are available.
8. Push the branch; do not merge and do not enable live trading.
