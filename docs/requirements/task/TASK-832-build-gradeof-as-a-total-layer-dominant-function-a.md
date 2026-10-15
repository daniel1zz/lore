---
id: TASK-832
type: task
role: plan
title: "Build gradeOf as a total layer-dominant function and prove no override path"
status: deprecated
priority: medium
phase: "P2 the derived grade"
created: 2026-08-24
updated: 2026-10-10
tags: []
parent: PLAN-147
plan: PLAN-147
---
## Objective

Build the derived grade function and prove no declared-override path exists. Claims
AC-GRADE-1 and AC-GRADE-11.

## The change

1. `packages/lore/src/service/requirement-grade.ts` — `gradeOf` per spec D1/D8/D9.
   Layer-dominant, barrel-excluded `adjustedFanIn` (import the P1 core, do not re-derive),
   grades R0-R3, `R1` as the unconditional tail, `count(anchors) == 0` short-circuiting
   to R3 BEFORE any layer lookup.
2. Thresholds live in ONE exported constant whose doc comment carries the measurement date
   (2026-08-24) and the producing command. ⛔ No scattered literals at comparison sites.
3. An anchor matching no declared layer returns an error. ⛔ No silent PERIPHERAL default.

## ⛔ The traps

- `count(anchors) == 0` is NOT the same condition as "anchor matches no layer". The first
  grades R3 (D9); the second errors (T3). Two branches, two tests.
- The totality sweep is a real product: 5 layers x anchor counts 1,2,3,4,11,12,13 x
  adjustedFanIn 2,3,4,9,10,11,84,85,86, with count=0 asserted SEPARATELY and excluded from
  the cross product (those cells have no layer and no fan-in — unrealizable inputs).
- Barrel exclusion is asserted as the RULE, file by file against the mechanical predicate
  — ⛔ NOT as "exactly 4 files". A legitimate fifth barrel must keep it green.
- AC-GRADE-11(b) is BEHAVIOURAL: run one fixture task through the full gate path four
  times, once per `priority` value, and assert all four verdicts deep-equal. ⛔ A grep for
  `priority` is explicitly not an accepted recognizer (spec D2b) — and a text scan would
  also miss an aliased read. Green control in the same run: varying an anchor layer DOES
  change the verdict.

## Baseline check FIRST

⛔ Your worktree is built from `origin/main`, 8 commits BEHIND local main. Run
`git rebase main`, then confirm `git log --oneline -1` matches the orchestrator baseline
BEFORE trusting any measurement. A worktree agent has previously burned 600s debugging a
stale baseline.

## RED first, recorded at the moment of red

Record `lore evidence --result expected-fail` with the real failing output WHILE IT IS
RED, then implement and record the pass. Transcription afterwards does not count.

## Falsifier

The AC has no `--falsifier-*` values yet (the spec is approved; you cannot add them).
Report the four you measured in your return message: `falsifier_path` must be a file this
task creates or edits, and the exit code must be vitest assertion-failure **1**, never 2+
(a crash proves the rule never ran).
