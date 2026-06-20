# DogeEdge Replay E2E Repo Audit

Generated: 
2026-06-20T13:36:32.7709346-05:00

Starting branch selected: fix/replay-capture-evidence-20260613T182501Z
Implementation branch: 
fix/replay-e2e-evidence-20260620T182153Z
HEAD: 
1ff62b8536b6b6175d9f66007a0a794dc54f33da

This branch is a newer descendant of fix/evidence-next-20260612T154127Z and preserves the evidence-plane work.

## Branches

```text
  audit/loop-hardening-20260607-184011                        94e528e Harden factory improvement loop gates
  auto/codex-auto-20260608T032632Z                            014c25d Fix Codex auto loop Git path
  auto/codex-auto-20260608T033001Z                            5aa8109 Use current Codex exec unattended flag
  auto/codex-auto-20260610T234952Z                            a4a55ee Auto improve DogeEdge loop (codex-auto-20260610T214952Z)
  auto/codex-auto-20260611T054952Z                            c5134fd Auto improve DogeEdge loop (codex-auto-20260611T034952Z)
  fix/evidence-next-20260612T154127Z                          62eb4eb Route Kalshi settlement evidence live-first
  fix/evidence-plane-unblock-20260611                         06e5f38 Add evidence plane bootstrap
  fix/generator-v3-recovery-20260609                          99fc986 Add generator v3 evidence readiness layer
  fix/generator-v3-unblock-next                               12b04cd Unblock evidence bundle diagnostics
  fix/pathway-reset-20260609T000000                           134f8da Reset generator evidence pathway
+ fix/replay-capture-evidence-20260613T182501Z                1ff62b8 Reseed stalled canary warmups
* fix/replay-e2e-evidence-20260620T182153Z                    1ff62b8 Reseed stalled canary warmups
  fix/research-execution-convergence-20260608T155439          cd8aae6 Auto improve DogeEdge loop (codex-auto-20260608T201603Z)
  fix/research-execution-convergence-20260608T173742          cd8aae6 Auto improve DogeEdge loop (codex-auto-20260608T201603Z)
+ main                                                        1abea9c Widen review bundle raw tick search
  remotes/origin/HEAD                                         -> origin/main
  remotes/origin/audit/loop-hardening-20260607-184011         94e528e Harden factory improvement loop gates
  remotes/origin/fix/evidence-next-20260612T154127Z           62eb4eb Route Kalshi settlement evidence live-first
  remotes/origin/fix/evidence-plane-unblock-20260611          06e5f38 Add evidence plane bootstrap
  remotes/origin/fix/generator-v3-recovery-20260609           99fc986 Add generator v3 evidence readiness layer
  remotes/origin/fix/generator-v3-unblock-next                12b04cd Unblock evidence bundle diagnostics
  remotes/origin/fix/pathway-reset-20260609T000000            134f8da Reset generator evidence pathway
  remotes/origin/fix/replay-capture-evidence-20260613T182501Z 1ff62b8 Reseed stalled canary warmups
  remotes/origin/main                                         1abea9c Widen review bundle raw tick search

```

## Recent commits

```text
1ff62b8 (HEAD -> fix/replay-e2e-evidence-20260620T182153Z, origin/fix/replay-capture-evidence-20260613T182501Z, fix/replay-capture-evidence-20260613T182501Z) Reseed stalled canary warmups
546cd1a Report canary warmup state explicitly
ccd2aa0 Handle overlapping replay capture segments
99b1049 Stabilize evidence supervisor scheduling
671c79d Improve evidence loop replay cadence
455dad5 Keep evidence bundle refresh on runtime data
f03c1ba Stabilize evidence readiness reporting
5a9179e Use gate coverage in readiness percent
ef2a33f Flush replay capture progress
ab8f9e6 Avoid near-expiry replay targets
70f76fe Clarify evidence readiness blockers
04adce7 Write replay capture rows durably
f3a0797 Stream replay capture artifacts per run
339a986 Widen evidence loop promote check safely
ed7644c Run execution canaries as active paper evidence
967493d Fill execution canaries from recent safe sweeps
bc3d92a Separate canonical replay from raw tick audit coverage
63b5549 Count exact-linked executable paper evidence in calibration
1fc65ea Mirror current target markets into evidence status
76c5c4f Resolve latest review bundle for export audits

```
