---
id: TASK-927
type: task
role: plan
title: "[Skill:implement] falsify path records discovery refusal and exit 126/127 as inconclusive (#53)"
status: archived
priority: high
phase: "red-proof"
created: 2026-10-12
updated: 2026-10-25
tags: []
parent: PLAN-153
plan: PLAN-153
links:
  - {id: TASK-960, type: blocks}
---
Estimate: S
Approach: verify-runner-service.ts `_runFalsifier`: after the mutated run and BEFORE comparing its exit code with the declared one, run `findDiscoveryRefusal` (attestation-completeness.ts:1257) on its output and check for exit 126/127; either hit records `inconclusive`, `capture_source: "runner-unattested"`, no attestation, outcome code 3, even when the code equals the declared one (D11, BR-1075). The genuine-red path (a runner summary with a failure and a matching code) is unchanged. Run scoped: falsify-discovery-refusal.test.ts, attested-red.test.ts, falsify-stored-exit-range.test.ts, `bun run typecheck`.
Source: spec-evidence-labels-and-reds-are-honest D11; issue #53; facts verify-runner-service.ts:1157/:1766+/:1965.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-EH-10, AC-EH-11

AC:
- AC-EH-10's command prints its PASS line; AC-EH-1 and AC-EH-5 commands still pass.
- `bun run typecheck` exits 0. Commit before attesting; stop at `lore release`.
