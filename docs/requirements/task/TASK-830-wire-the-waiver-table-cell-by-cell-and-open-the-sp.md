---
id: TASK-830
type: task
role: plan
title: "Wire the waiver table cell by cell and open the spec-parents-task middle tier"
status: deprecated
priority: medium
phase: "P4 wire the waivers and the middle tier"
created: 2026-08-24
updated: 2026-10-10
tags: []
parent: PLAN-147
plan: PLAN-147
---
## Objective

Wire the D8 waiver table into the gate and open the middle tier. Claims AC-GRADE-10 and
AC-GRADE-5.

## The change

1. `checkpoint-registry.ts` — each class-II predicate consults the grade before running.
   Class I is untouched: ⛔ no grade may reach a class-I predicate's applicability.
2. `attestationFloor` takes its ratio from the grade: R0 0.0, R1 0.5 (today's default),
   R2 0.75, R3 1.0.
3. Middle tier: a task whose parent is a spec (no plan) can claim, record evidence, and be
   resolved by `lore verify --task` through `--ac-scope`. The reverse-lookup path ALREADY
   EXISTS for `--adhoc` tasks — reuse it, do not build a second one.

## ⛔ The traps

- AC-GRADE-10 is the anti-false-green AC of this whole plan. A waived cell means the
  predicate field is ABSENT from the returned `ApplicablePredicateResult[]`; a required
  cell means PRESENT and refusing. ⛔ Asserting only that `gradeOf` returns the right grade
  is the capability-implemented-wiring-absent false green this repo has measured FOUR times.
- Violating inputs come from P3's `VIOLATING_FIXTURES`. ⛔ Do not construct your own per
  cell — implementer-chosen fixtures are exactly the latitude the AC removes.
- Assert visited cell count EQUALS rows x columns, so a truncated sweep fails.
- AC-GRADE-5(c): assert the resolved spec's id EQUALS the task's `parent_id`. ⛔ "Resolution
  succeeded" alone would pass on a lookup that found the WRONG spec.
- ⛔ Use a throwaway corpus (`mkdtemp` + `lore init`, cwd inside it). Never write to this
  repo's `.lore/`. Canonical pattern: `packages/dashboard/tests/e2e/global-setup.ts`.

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
