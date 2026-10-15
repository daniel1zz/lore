---
id: TASK-1035
type: task
role: plan
title: "[Skill:implement] claim and release by run in TaskWorkflowService and PhaseWorkflowService"
status: archived
priority: critical
phase: "P2 Runs and claims"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1027, type: blocks}
  - {id: TASK-1024, type: blocks}
---
Estimate: M
Approach: per spec D6 — both `_claimImpl`s and both release paths call core `hasClaimConflict`; claimant run from the invocation identity passed through ClaimOpts/ReleaseOpts by the CLI commands; claim records `harness_run`; legacy holder compared by `by`
Source: spec D6; incident task-phaseworkflowservice-claim-captures-no-session-id-so-every (one-path fix)
Dimensions: D-FUNC
Scope-Alt: none (both paths are the point)
Covers: AC-RID-12, AC-RID-13, AC-RID-14

AC:
- Given `cd packages/lore && bun test tests/integration/cli/claim-conflict-by-run.bun.test.ts`, `... claim-legacy-transition.bun.test.ts` and `... claim-release-by-run.bun.test.ts`, Then each passes.
- Given the landed run rule, When `lore rule set BR-125 --lifecycle deprecated` is run in this task after merge-ready evidence, Then BR-125 shows deprecated and the leaf note names BR-1040 (superseded on landing, not earlier).
- Given invariant I2, When `grep -c hasClaimConflict` on both service files, Then each prints ≥1.
- Given the existing claim suites (`packages/lore/tests/integration/phase-claim-session-parity.bun.test.ts` and claim tests under tests/), Then no previously green test turns red.
