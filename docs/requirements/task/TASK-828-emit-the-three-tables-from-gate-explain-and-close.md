---
id: TASK-828
type: task
role: plan
title: "Emit the three tables from gate --explain and close falsifier coverage for both specs"
status: deprecated
priority: medium
phase: "P6 ship the rules as executables"
created: 2026-08-24
updated: 2026-10-10
tags: []
parent: PLAN-147
plan: PLAN-147
---
## Objective

Ship the three tables as executable output and close falsifier coverage for BOTH specs.
Claims AC-GRADE-8 and AC-GRADE-9.

## The change

1. `lore gate --explain` gains the three tables, emitting the EXACT literal tokens
   `LAYER TABLE`, `GRADE TABLE`, `CLASS-II WAIVERS`, each followed within 20 lines by at
   least one pipe-delimited data row.
2. Root `CLAUDE.md` gains AT MOST 3 lines — pointer-only, naming the two spec slugs. ⛔ The
   rules themselves do NOT go into CLAUDE.md: it measured 198/220 lines and 23110/24576
   bytes on 2026-08-24, and per the North Star a rule that exists only as prose does not
   bind. The pointer pattern to copy is the existing `lore gate plan-close --explain` line.
3. `packages/lore/tests/integration/falsifier-coverage.test.ts` — ⛔ PARAMETERIZED by spec
   slug, because the SIBLING read-side plan's AC-CONV-9 points at this same file. Write it
   to take a spec slug and assert over that spec's script-mode AC records. This is a
   deliberate cross-plan shared artifact; the sibling plan's P4 task consumes it and must
   not need to edit it.

## ⛔ The traps

- AC-GRADE-8 clause (2) is a FOOTPRINT measure — count CLAUDE.md lines containing either
  spec slug, bound 3. ⛔ It is NOT an absolute file-length bound: that would redden whenever
  an unrelated commit legitimately spent the sanctioned remaining budget, i.e. it would be
  measuring "nothing else grew".
- AC-GRADE-9's set is bounded BOTH ways: assert the verified set EQUALS this spec's
  script-mode AC records minus AC-GRADE-9 (cardinality AND ids). ⛔ A non-emptiness check
  cannot distinguish verifying all 10 from verifying 1 and short-circuiting.
- Every recorded falsifier exit code must be EXACTLY 1 (vitest assertion-failure). Assert it
  is never 2+ — a mutation that makes the tool DIE proves the rule never ran.
- This task runs LAST in the plan: AC-GRADE-9 quantifies over the other ACs' falsifier
  fields, which earlier tasks report and the orchestrator records.

## Baseline check FIRST

⛔ Worktree is built from `origin/main`, 8 commits BEHIND local main. `git rebase main`,
then confirm `git log --oneline -1` matches the orchestrator baseline.

## RED first

`lore evidence --result expected-fail` with real failing output WHILE RED, then the pass.
