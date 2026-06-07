# DogeEdge Local Worker Data

When `Run DogeEdge PC Preview.bat` or `npm run local-worker` is running, the browser app posts paper-trade and learning-lab snapshots to the local worker.

Generated files in this folder:

- `latest.json`: latest full browser snapshot.
- `paper-trades.jsonl`: paper trade records, including open and closed updates.
- `paper-events.jsonl`: paper buy/sell events.
- `shadow-trades.jsonl`: shadow variant records.
- `shadow-events.jsonl`: shadow buy/sell events.
- `algorithm-candidates.json`: review-only list of paper strategies or shadow variants that look promising.
- `rules-active.json`: active rule configuration used by the paper runner.
- `summary.md`: compact human-readable summary for Codex CLI.
- `snapshots/`: periodic full snapshots.

These files are local-only working data and are not required for real orders. DogeEdge remains paper-only unless a separate reviewed trading backend is added later.
