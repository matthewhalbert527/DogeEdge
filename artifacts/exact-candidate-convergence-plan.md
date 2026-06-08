# Exact Candidate Convergence Plan

## Executive Summary

The latest full-row bundle shows family-level research/live overlap but zero exact candidate ID overlap. This patch makes exact identity and provenance visible in every review packet, then adds evidence-budget reports that distinguish exact-linked supported candidates from family-only or unsupported telemetry.

## Scope

- Add deterministic research candidate identity fields and config hashes.
- Export exact-link, lineage, provenance, and scheduler budget artifacts.
- Keep unsupported and unlinked rows non-promotable and out of normal evidence budget.
- Keep live trading disabled and promotion gates unchanged.

## Changed Areas

- Evaluation snapshot/export bundle contract.
- Research/live alignment and roster provenance artifacts.
- Tests for exact identity propagation, unlinked telemetry, and scheduler budget reports.

## Not In This Patch

- Official settlement backfill implementation.
- Real target-market tick capture.
- Simulator calibration from realized fills.

Those remain the next blockers after exact candidate lineage is measurable.
