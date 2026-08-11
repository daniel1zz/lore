---
id: TASK-335
type: task
role: plan
title: "Add the recorded_at field to two stale exact-toEqual assertions in ac-service.test.ts that escaped AC-FALS-12's frozen file enumeration"
status: archived
priority: medium
phase: "derivation"
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: PLAN-080
plan: PLAN-080
---
# Objective

Two exact-`toEqual` assertions in `packages/lore/tests/unit/service/ac-service.test.ts` do not
expect the `recorded_at` field that `EvidenceRefLite` now carries, so they fail on merged `main`.
Add the field to both expectations.

# Why this task exists — read this, it is the point

⛔ This is NOT the implementer's failure. The phase-`derivation` implementer FOUND these two
failures with a full cross-runner sweep, correctly refused to touch a file outside its declared
anchors, and reported the gap instead. The defect is in the ORCHESTRATOR's anchor set and in
AC-FALS-12's frozen file enumeration — the file was in neither.

⛔ It is also a MEASURED instance of a residual the review judge flagged twice and the plan
accepted in writing: *"a command-declared population still passes green if the enumeration was
under-inclusive at authoring time."* It escaped exactly that way. AC-FALS-12's command has now
been widened to include this file so the enumeration covers it going forward.

# Reproduce first

```
bunx vitest run packages/lore/tests/unit/service/ac-service.test.ts > out.log 2>&1; echo $?
```
Measured on merged `main` @ `003d42cf`: exit **1**, `Tests 2 failed | 23 passed (25)`. The two
failures are:
- `STATE — expected-fail evidence never counted as passing by AC-coverage aggregation (AC-WH-1) > an AC referenced ONLY by expected-fail evidence has pass:0, fail:0, with the raw ref preserved verbatim in refs[]` (≈:535)
- `HAPPY — an ad-hoc task's evidence flips coverage from null to non-null with NO child plan (AC-2) > a spec with zero plans but one governed ad-hoc task shows real pass/fail counts` (≈:604)

Both diffs show a single unexpected key: `+ "recorded_at": "<ISO timestamp>"`.

# Required change

Add `recorded_at` to both expected `refs[]` objects.

⛔ The timestamps are DYNAMIC (they come from the evidence rows the test itself creates), so a
hard-coded literal will pass once and rot. Use whatever this file's existing convention is for
dynamic fields — read the surrounding tests first and match them. If the file has no such
convention, `expect.any(String)` for that one key is acceptable, but ⛔ do NOT relax the
assertion from `toEqual` to `toMatchObject` or drop the exactness: exact-`toEqual` on `refs[]` is
what makes these tests catch an unannounced field addition, which is precisely the value they
just delivered.

⛔ Do NOT edit the production code. `recorded_at` is intended and already verified by
AC-FALS-14/15/16. If you believe the field should not be there, STOP and report — do not act.

# Oracles

- `bunx vitest run packages/lore/tests/unit/service/ac-service.test.ts` → exit exactly 0, and the
  summary line reports 25 passed / 0 failed.
- **AC-FALS-12** (in scope) — its command now enumerates this file; the whole invocation must exit
  exactly 0.

⛔ Record the red FIRST, from your worktree, at the moment you observe it:
`lore evidence <task> --oracle test --command "<cmd>" --result expected-fail --ac AC-FALS-12 --capture`
Then the pass. ⛔ `output_tail` must carry the runner summary line. ⛔ Measure exit codes without a
pipe (`cmd > out 2>&1; echo $?`); `set -e` is inert here.
