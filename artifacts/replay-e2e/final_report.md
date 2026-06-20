# DogeEdge replay e2e final report

## Summary

Implemented the authenticated Kalshi WebSocket replay path and completed one real diagnostic e2e candidate evaluation. The run has a real authenticated WS session, an initial orderbook snapshot, contiguous deltas, trades, a replay-grade candidate window, one exact-linked paper canary decision inside that window, one finalized official settlement join, and a paper/replay parity artifact.

This proves the evidence pipeline is operational at infrastructure scale. It does not prove statistical edge and does not make any candidate promotion eligible.

## Final online run

- Run dir: artifacts\replay-e2e\online-e2e-4\e2e-evidence-2026-06-20T19-07-55.547Z
- Target market: KXDOGE15M-26JUN201515-15
- Replay-grade markets: 1
- Finalized settlement joins: 1
- Exact-linked paper decisions: 1
- Label-known count: 1
- Sequence gaps in eval window: 0
- Candidate evaluation complete: true
- Statistically validated: false
- Promotion eligible: false

## WebSocket evidence

- Authenticated connection: true
- Subscription acknowledged: true
- Initial orderbook snapshot: true
- Raw events: 4272
- Orderbook deltas: 4161
- Trades: 110
- Lifecycle events for target: 0
- useYesPrice persisted: true

## Verification

- npm test: pass, 173 tests
- lint: pass with two existing React hook dependency warnings
- build: pass
- factory:backtest: pass
- factory:sweep: completed after shell wrapper timeout; run 2026-06-20T19-24-30Z, 0 ready
- factory:promote-check: pass, 0 ready
- eval:bundle: pass, review_exports\bundles\dogeedge-review-bundle-20260620T194419Z.zip
- gate-report: pass, usable_with_warnings
- reconcile-top-roster: pass, usable_with_warnings
- merge:safety: REQUIRE_HUMAN_APPROVAL, expected for protected paths

## Safety

Live trading remains disabled, dry-run remains enabled, manual approval remains required, no exchange order-routing command is called by the evidence commands, and no merge to main was performed.
