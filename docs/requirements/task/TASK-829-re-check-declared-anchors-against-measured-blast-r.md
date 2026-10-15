---
id: TASK-829
type: task
role: plan
title: "Re-check declared anchors against measured blast radius and arm the shared cutoff"
status: deprecated
priority: medium
phase: "P5 two-axis recheck and arming"
created: 2026-08-24
updated: 2026-10-10
tags: []
parent: PLAN-147
plan: PLAN-147
---
## Objective

Re-check the declared grade against the MEASURED blast radius, and arm the cutoff without
invalidating anything. Claims AC-GRADE-6 and AC-GRADE-7.

## The change

1. At evidence time, re-derive the radius from `blastRadiusChanged`
   (`packages/lore/src/adapters/real-git-port.ts`, built by `spec-corpus-truthfulness`)
   over claim-commit..HEAD. Under-declared anchors are REFUSED, the refusal naming the
   undeclared paths.
2. `arming_rev` — ONE definition, `MAX(audit.id)` captured once in the arming commit, per
   `adr-a-record-with-no-state-stamp-is-acceptable-but-never-green`. Pre-arming tasks
   classify `legacy_ungraded` and are ACCEPTED.

## ⛔ The traps

- N's SOURCE is pinned by the AC: `blastRadiusChanged` over claim-commit..HEAD — ⛔ not the
  working tree, not the staged index, not the evidence rows. Different sources give
  different N for the same task.
- AC-GRADE-6 needs a paired GREEN control in the same run (complete anchors pass). A refusal
  path with no green control cannot distinguish "the check works" from "it refuses
  everything".
- AC-GRADE-7 compares WHOLE RESULT SETS over every live task, ⛔ not a sample. 822 live
  tasks today. If a task appears mid-run it must not hide in an unsampled remainder.
- ⛔ ONE cutoff only. The sibling read-side plan asserts the same exactly-one-definition
  invariant over the same tree, so a second cutoff reddens BOTH plans.

## Baseline check FIRST

⛔ Worktree is built from `origin/main`, 8 commits BEHIND local main. `git rebase main`,
then confirm `git log --oneline -1` matches the orchestrator baseline before trusting any
measurement.

## RED first, recorded at the moment of red

`lore evidence --result expected-fail` with the real failing output WHILE RED, then
implement and record the pass. Transcription afterwards does not count.

## Falsifier

Report the four measured values in your return message. Exit code must be vitest
assertion-failure **1**, never 2+.
