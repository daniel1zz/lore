---
id: TASK-816
type: task
role: plan
title: "Author the phase-write audit-pairing oracle and prove it can fail"
status: archived
priority: medium
phase: "audit pairing oracle"
created: 2026-08-24
updated: 2026-08-25
tags: []
parent: PLAN-144
plan: PLAN-144
---
## Objective

Author `packages/lore/tests/integration/phase-write-audit-pairing.test.ts`, the oracle for
AC-PHASEVER-4, and PROVE it can fail.

## What the suite must assert

In a throwaway corpus (`mkdtemp` + `lore init`, cwd inside it, ⛔ NEVER this repo's `.lore/`),
against an APPROVED plan, after EACH of `lore phase add`, `lore phase rename`, `lore phase rm`,
read `lore audit --verify --json` and assert:

- `data.clean === true`
- `data.misses.length === 0`
- `data.chain.clean === true`
- `data.chain.checked` STRICTLY INCREASES across the three writes

⛔ The reader is pinned to `--json`. Measured 2026-08-24: those exact fields exist. Do NOT
parse `Chain integrity: clean (N entries checked).` — AC-PHASEVER-1(b) already rejected printed
output for this reason, and an earlier draft of AC-4 was corrected for exactly that
inconsistency.

⛔ Invocation shape, same as the sibling suite: reach the CLI through this worktree's own
source (`bun <repo>/packages/lore/src/index.ts`), NEVER a prebuilt `dist/lore`, and assert the
resolved entry path is inside the repo under test. vitest is the runner, so no top-level
`bun:sqlite` import.

## ⛔ THE ACTUAL DELIVERABLE — the suite will be GREEN ON ARRIVAL, and that is the problem

`writePhases` already makes one CAS-guarded `store.updateWithProvenance` call, so the pairing
is already correct and your new suite will pass on the first run. **A green-on-arrival oracle
has no demonstrated discriminating power.** This plan exists because the previous plan shipped
three criteria that passed 41/41 against a severed audit trail.

So you must ALSO produce a recorded red:

1. In a SCRATCH COPY of `phase-service.ts` (⛔ outside the tracked tree — e.g. a temp dir, or a
   local-only edit you revert; never a commit), sever the pairing: replace the single
   `updateWithProvenance` call with a bare `store.update` plus `insertVersion`, i.e. the shape
   the previous plan's bundle originally prescribed.
2. Run your new suite against that shape and confirm it goes RED, and that the failure names
   the audit miss rather than something incidental.
3. Record that red IMMEDIATELY: `lore evidence <this task> --oracle test --command "<cmd>"
   --result expected-fail`. ⛔ A red you describe in prose but do not record does not count.
4. Restore the correct implementation. Confirm `git diff` shows your ONLY tracked change is the
   new test file.
5. Then record the green: `--result pass`.

Expected magnitude from the previous measurement: the severed shape produces `clean: false`,
exit 4, and one miss per phase write (3 misses).

## File Anchors — hard boundary

You may create exactly one tracked file:
`packages/lore/tests/integration/phase-write-audit-pairing.test.ts`

⛔ Do NOT leave any change to `packages/lore/src/service/phase-service.ts` in the tree. It is
not your anchor; touching it is only allowed as the transient, reverted probe in step 1, and
step 4 exists to verify you reverted it.

⛔ Do NOT edit `packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts`.

## Finish

`lore evidence` (both rows, recorded by you at the moment observed) → commit with this task's
slug in the message → `lore release`. ⛔ Do NOT run `lore done`, `bun run build`, or
`mirror:export`.
