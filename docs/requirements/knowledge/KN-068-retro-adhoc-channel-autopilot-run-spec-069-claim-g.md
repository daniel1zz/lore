---
id: KN-068
type: knowledge
role: knowledge
title: "Retro — adhoc-channel autopilot run: SPEC-069 claim gap + SPEC-061 zero-match + NewDocModal decision (2026-07-24)"
status: draft
priority: medium
created: 2026-07-24
updated: 2026-07-25
tags: []
parent: PLAN-055
links:
  - {id: TASK-194, type: relates-to}
  - {id: TASK-193, type: relates-to}
  - {id: TASK-192, type: relates-to}
---
# Retro — adhoc-channel autopilot run (3 tasks, 2026-07-24)

First autopilot run driven entirely over the SPEC-069 ad-hoc channel (no governing plan). All three open adhoc tasks completed, merged, archived; full suite green on main (tsc 0, vitest 321 files / 5713 pass, bun test 1044 pass / 79 files).

## What landed

1. **SPEC-069 adhoc-claim gap fixed** (`task-fix-spec-069-...`, commit 99206a4): `isNonPlanParentError` (checkpoint-registry) routes tasks whose resolved parent is not a plan through the same vacuous-pass as `parent_id === null`, in ALL THREE call sites — `enforceClaimGate`, `runTaskClaimGate` (CLI pre-flight), and `buildTaskBundle` (feed task-start; discovered broken during dispatch, same root cause). `noAnchorOverlap` stays unconditionally live via `findAdhocSiblingTasks()`. Live proof chain: pre-fix claim attempts exit 4 (captured by g4 hook); post-merge `lore feed task-start` exit 0 and T-061's claim succeeded first try.
2. **SPEC-061 zero-match miss fixed** (`task-fix-spec-061-...`, commit d45aaf2): vitest reports a zero-match `-t` run as all-`skipped (N)` — the trailing parenthesised number is TOTAL LOADED tests, not matched cases. Old parser read it as matched → `completeness: complete` on a run that verified nothing (SPEC-075 T1 incident). Fix: `countMatchedVitestCases` sums `passed`+`failed` Tests-line segments, excludes `skipped`/`todo`. Grounded on three real vitest output shapes; `bun test -t <nomatch>` already exits 1 loud, vector was vitest-only.
3. **NewDocModal decision (b)** (`task-decide-implement-newdocmodal-...`, commit ff4b5e6, ADR `adr-newdocmodal-spec-create-cli-skill-only-authoring-disable`): spec authoring is CLI/skill-only by design — the gate's feeding-source rules demand oracle-verifiable ACs added via separate `lore ac add`, which no create-time modal payload can satisfy; a template skeleton would pass `hasSkeleton` mechanically while producing hollow specs. Modal blocks Create for `spec` with a visible notice (generalizes the existing hidden-`assessment` precedent, upgraded to visible).

## Process findings

- **Bootstrap `ready:1` counts on old plans were stale**: `lore ready` on all four (SPEC-053/054/055/059 plans) returned zero ready records. Bootstrap task_counts and `lore ready` disagree — worth a look if it recurs.
- **Orchestrator under-match near-miss (standing lesson re-confirmed)**: passed 3 test paths to `bun test`, output said "across 2 files" — one path was wrong (`tests/integration/` vs actual `tests/unit/adapters/`) and bun test silently ignored it. Matched-count assertion caught it; the file passed at its real path.
- **Self-referential fix protocol worked**: the task fixing "adhoc unclaimable" is itself adhoc — implementer captured the exit-4 denial as reproduction, worked unclaimed (advisory lease, disjoint anchors), and the NEXT task's successful claim served as the post-merge live proof. Reusable pattern for gate-fixes gated by themselves.
- **Adhoc closure has no plan-close/verify channel**: `lore verify` and `lore assess` are plan-scoped; adhoc tasks close on evidence + orchestrator full-suite + manual archive (draft→approved→active→archived). Acceptable for 3 tasks; if the adhoc channel grows, an adhoc-scoped attestation path may be worth a spec.
