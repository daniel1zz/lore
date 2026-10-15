---
id: TASK-831
type: task
role: plan
title: "Make the predicate class map total and prove class-I predicates are grade-invariant"
status: deprecated
priority: medium
phase: "P3 the total class map"
created: 2026-08-24
updated: 2026-10-10
tags: []
parent: PLAN-147
plan: PLAN-147
---
## Objective

Make the predicate class map TOTAL and prove class-I is grade-invariant. Claims
AC-GRADE-3 and AC-GRADE-4.

## The change

1. `packages/lore/src/service/predicate-contracts.ts` — a `Record<PredicateField,
   PredicateClass>` TOTAL map. Copy the completeness shape from the existing
   `PREDICATE_CONTRACTS: Record<PlanCloseField, PredicateContract>` in the same file: a
   missing key must fail `tsc`, not a runtime check.
2. Class I (size-invariant): `noAnchorOverlap`, `actorIdentityGuard`, `stampCurrency`,
   `parentLegal`, `specKindValid`, `upstreamApproved`. Class II: `hasSkeleton`,
   `upstreamHasAcceptanceCriteria`, `acQuantifiable`, `oracleCoverage`, `requiresUat`,
   `attestationFloor`.
3. `packages/lore/tests/fixtures/gate-violating-inputs.ts` — export `VIOLATING_FIXTURES`,
   ONE declared violating input per predicate. P4's task draws from this SAME table, so it
   is a shared contract, not a local helper.

## ⛔ The traps

- AC-GRADE-4's control must live INSIDE the checked tree. This repo has measured a control
  placed outside the linted tree causing the tool to exit fatal so the rule never ran —
  zero discriminating power. Write the unassigned predicate into the tree, spawn typecheck,
  assert exit EXACTLY 2 with the predicate named, restore the tree.
- Assert exit **exactly 2**, never "non-zero".
- AC-GRADE-3's swept set must be asserted EQUAL (cardinality AND members) to the class map's
  class-I set — ⛔ not merely non-empty, or a shrunken set passes.

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
