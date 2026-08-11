---
id: TASK-318
type: task
role: plan
title: "Derive lore feed's checkpoint set from the registry, make an unregistered name exit 2 instead of 0, and emit an enforcer-side evaluation trace for every checkpoint"
status: draft
priority: medium
phase: "gate-reachability"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-076
plan: PLAN-076
---
Make every deterministic gate checkpoint both FEEDABLE and TRACEABLE. Two ACs, one task, because
both land on `checkpointRegistry` / `gate-enforcer.ts` and splitting them would collide on anchors.

## Part 1 — AC-FR-1: `lore feed`'s checkpoint set derives from the registry, and unknown names FAIL

⛔ Measured 2026-08-10 on the merged tree, exit codes captured without a pipe:

```
spec-create      exit=0   [source: knowledge-write-spec-rules-gate-feeding-source, trust: team-authored]
spec-promote     exit=0   unknown checkpoint: spec-promote
plan-promote     exit=0   unknown checkpoint: plan-promote
task-claim       exit=0   unknown checkpoint: task-claim
phase-start      exit=2   Error: requires a phase document ID or slug
task-start       exit=2   Error: requires a task document ID or slug
```

Two defects, and the SECOND is the sharper one:

1. Three of the four deterministic gates are not feedable at all, so the standing discipline
   ("pull the pack BEFORE producing, never wait to be denied") is unreachable for 75% of them.
2. ⛔ An unknown checkpoint **exits 0**. `lore feed spec-promote && <next step>` proceeds exactly as
   though a pack had been delivered. The same binary already exits 2 for a missing argument — so it
   knows how to refuse; only this branch returns success for a request it did not fulfil. That is a
   silent fallback in the governance layer.

⛔ Fixing only (1) leaves every FUTURE unregistered name silently successful. Both halves or neither.

Derive `feed`'s accepted set FROM `checkpointRegistry` so a newly registered checkpoint is feedable
by construction. ⛔ Never a second hand-maintained list — that dual-write is what produced this.

## Part 2 — AC-FR-8: a passing gate leaves a queryable trace

⛔ Measured 2026-08-10: promoting a spec to `approved` printed ZERO gate output and left ZERO gate
entries in `lore audit <doc> --json` (11 entries, all create/update). The only way to establish that
`spec-promote` had evaluated at all was reading `corpus-service.ts`. A passing gate, a vacuously
passing gate, and an absent gate are indistinguishable at every surface a user or auditor can reach.

`spec-governance-visibility` fixed exactly this for `plan-close` — and for that checkpoint only.

⛔ D7: emit the trace where the VERDICT IS PRODUCED (the enforcer), not at each call site.
Per-call-site tracing is precisely how `plan-close` became the only traced checkpoint. Same
derivation principle as Part 1: a newly registered checkpoint must be traced by construction.

## Notes

- The two parts share `checkpoint-registry.ts`; do Part 1 first, since Part 2's trace should cover
  whatever set Part 1 makes authoritative.
- ⛔ AC-FR-8's second RED matters: assert the trace is ABSENT for a doc whose gate was DISABLED via
  config. Without it the test cannot tell "evaluated and passed" from "never ran" — which is the
  entire defect.
