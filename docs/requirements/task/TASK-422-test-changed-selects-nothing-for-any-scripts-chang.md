---
id: TASK-422
type: task
role: plan
title: "test:changed selects nothing for any scripts/ change and still exits 0 — the prescribed worktree oracle measured a 350-line slice zero times"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: TASK-437, type: relates-to}
---
## Defect

`bun run test:changed` cannot select ANY test under `scripts/tests/`, no matter what
changed there. A worktree agent whose entire slice lives in `scripts/` runs the
prescribed oracle, gets **exit 0 with zero files selected**, and has measured nothing.

Measured 2026-08-01 while landing `task-check-ac-ref-integrity-prints-an-exemption-count-not-its`
(commit f2b86f4, 350 insertions across three `scripts/` files):

```
bun run test:changed   →  selected 0 files, exit 0
```

Root cause, from `scripts/changed-tests.ts:45-46` — the import-graph tracing is scoped to
`packages/lore/src/**` and `packages/core/src/**`. `scripts/` is not in the traced set, so
`scripts/tests/*.test.ts` is unreachable by any selection path.

## Why this is worse than the sibling blind spot it resembles

This is NOT the `tests/integration/cli/*` gap (that one was widened at commit 58a4cc9 and
its residual is documented). This is a distinct, previously-undocumented hole, and it is
more dangerous in one specific way: **the integration-CLI gap under-selected, this one
selects nothing at all while still exiting 0.**

CLAUDE.md's standing lesson names the shape exactly — "no match + exit 0 is
indistinguishable from passed". An agent following the prescribed worktree oracle
faithfully receives a green result that measured its change zero times. The discipline was
obeyed; the oracle was hollow.

`test:changed` is prescribed in CLAUDE.md as THE deterministic worktree oracle and is
dispatched in every implementer bundle. Its silence about an un-traceable directory is a
false green in the tool the whole dispatch protocol rests on.

## Requirement

1. Either extend tracing to cover `scripts/` (so a change there selects
   `scripts/tests/*.test.ts`), or make a zero-selection run that had CHANGED FILES fail
   loud instead of exiting 0.
2. ⛔ Requirement 2 is not optional even if 1 is implemented: a selection of zero across a
   non-empty changed-file set must never again be reported as success. Extending the
   traced set fixes today's known hole; the loud-zero rule is what catches the NEXT
   directory nobody thought to trace. Fixing only the traced set leaves the failure mode
   intact.
3. `--list` must make the distinction visible: "0 files selected because nothing changed"
   and "0 files selected although N files changed" are different states and must not
   render alike.

## Oracle

- A change confined to `scripts/` selects at least the matching `scripts/tests/*.test.ts`,
  OR the run exits non-zero naming the unselected changed paths.
- CONTROL, so the assertion cannot pass vacuously: a run with genuinely NO changed files
  still exits 0 and selects nothing, silently. That is the one legitimate zero.
- REGRESSION: an ordinary `packages/lore/src/**` change still selects its existing
  transitive set — assert an unchanged selection for a known file, so widening the traced
  set cannot silently alter established selection.
- BOUNDARY: a changed file in a directory traced by NEITHER rule (pick one that exists,
  e.g. a top-level config) produces the loud-zero outcome rather than a green run.
- ⛔ Assert on the exit code measured UNPIPED (`cmd > out 2>&1; echo $?`) and on the
  selected-file list, never on a phrase of the human-readable summary.
