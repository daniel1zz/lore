---
id: TASK-824
type: task
role: plan
title: "Regression-lock the measured M2 labelling failure and confirm falsifier coverage"
status: draft
priority: medium
phase: "P4 M2 regression and falsifier completeness"
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-146
plan: PLAN-146
---
## Objective

Regression-lock the measured M2 failure and confirm falsifier coverage for this spec.
Claims AC-CONV-4, AC-CONV-9.

## The measured defect you are locking

Query `capture attested evidence provenance` on 2026-08-24 returned
`task-lore-done-s-attestation-refusal-calls-a-capture-source` (2026-08-03, archived) at
rank 1, score -6.96, and `knowledge-lore-evidence-capture-now-clears-the-attested-floor`
(2026-08-23, which OVERTURNED it) at rank 3, score -6.63 — with NO edge between them in the
`links` table. Seed both real bodies into a throwaway corpus, declare the supersedes edge,
and assert the older hit comes back CARRYING the superseded signal.

## ⛔ Scope — read T4 of the spec before writing the test

This does NOT assert the ordering is fixed. AC-CONV-2 freezes default bm25 order and N1
refuses to auto-rule which conflicting conclusion is right, so the superseded doc may STILL
outrank its replacement. The label is the whole assertion. ⛔ Do not add a rank assertion
and do not report this as an ordering fix.

## AC-CONV-9 — consume, do not build

`packages/lore/tests/integration/falsifier-coverage.test.ts` is created PARAMETERIZED by
spec slug by the SIBLING grading plan's P6 task. ⛔ You do not own that file and must not
edit it — invoke it against this spec's slug. If it does not exist yet, that plan's P6 has
not landed: STOP and report rather than writing a second copy.

## Baseline check FIRST

⛔ Worktree is built from `origin/main`, 8 commits BEHIND local main. `git rebase main`,
then confirm `git log --oneline -1` matches the orchestrator baseline.

## RED first, at the moment of red

`lore evidence --result expected-fail` with real failing output WHILE RED, then the pass.

## Falsifier

Report the four measured values. Exit code must be vitest assertion-failure **1**, never 2+.
