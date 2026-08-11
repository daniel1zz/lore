---
id: TASK-501
type: task
role: plan
title: "T1 RED oracles for lazy libsql load and TMPDIR diagnostic"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-094
plan: PLAN-094
links:
  - {id: TASK-499, type: blocks}
---
## Objective

Author both oracle files declared by the governing spec, and prove each is LIVE against the CURRENT (unfixed) binary before any implementation exists.

## Covers

AC-LL-1, AC-LL-2, AC-LL-3, AC-LL-4 (vitest file) and AC-LL-5, AC-LL-7 (bun test file). AC-LL-6 needs no test file.

## Required RED/GREEN state at hand-off

Run `bun run build` first — these tests spawn `dist/lore`, and a stale binary measures old code.

- AC-LL-1, AC-LL-2, AC-LL-4 MUST FAIL against the current binary. That failure IS the defect; a version that passes today is a broken oracle.
- AC-LL-3 MUST PASS today — it is the no-regression control, not probe evidence.
- AC-LL-5, AC-LL-7 state expected post-fix behaviour; record their observed current state explicitly rather than assuming.

Report the per-AC red/green matrix as measured, with the matched test-file/case counts (a path or `-t` filter that matches nothing exits 0 and is indistinguishable from a pass).

## Constraints

- Test names MUST contain the literal AC id (`AC-LL-1`, …) — the declared AC commands select by `-t "AC-LL-n"`.
- Runner split is mandatory: subprocess ACs in the vitest file, in-process `createApp` ACs in the `.bun.test.ts` file. Merging them breaks `bun:sqlite` resolution one way and `vitest --changed` selection the other.
- Never write to this repo's own `.lore/` corpus: build fixtures with `mkdtemp` + `lore init`.
- Do not modify `src/` — implementation belongs to the blocked sibling task.
