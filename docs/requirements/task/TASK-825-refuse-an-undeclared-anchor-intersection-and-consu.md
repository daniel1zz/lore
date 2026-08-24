---
id: TASK-825
type: task
role: plan
title: "Refuse an undeclared anchor intersection and consume the shared arming cutoff"
status: draft
priority: medium
phase: "P3 the convergence obligation"
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-146
plan: PLAN-146
---
## Objective

Make an undeclared anchor intersection between two conclusions refuse, and consume the
shared arming cutoff. Claims AC-CONV-7, AC-CONV-8.

## Depends on P2

⛔ This task edits `conclusion-convergence.ts`, which P2 also anchors — the claim gate will
refuse you while P2 holds a fresh claim. That serialization is intentional: D2 (the
obligation) is meaningless until D3 (anchors exist) has landed.

## The change

1. When a new conclusion-bearing doc's `code_anchors` INTERSECT a live conclusion-bearing
   doc's, the write requires a declared relationship — `supersedes` or `relates-to`. An
   undeclared intersection refuses, naming BOTH slugs and the compared anchor count.
2. Consume `arming_rev` — INTRODUCED by the sibling grading plan's P5, not here.
   `packages/lore/src/service/conclusion-convergence.ts` is the named consumer.
3. `packages/lore/tests/fixtures/arming-cutoff-fixture.json` — one pre-cutoff record that
   reads `legacy` before the falsifier mutation and `armed` after.

## ⛔ The traps

- BOTH paths must emit `compared_anchor_count` in the `--json` payload — the refusal AND the
  pass. A zero-anchor doc intersects nothing and passes, but it must report 0, so
  "compared nothing" never renders identically to "compared and found nothing".
- ⛔ Do NOT define a second `arming_rev`. Both plans assert exactly-one-definition over the
  same tree; a second cutoff reddens both.
- `falsifier_path` MUST equal the file holding the single `arming_rev` definition.

## Baseline check FIRST

⛔ Worktree is built from `origin/main`, 8 commits BEHIND local main. `git rebase main`,
then confirm `git log --oneline -1` matches the orchestrator baseline.

## RED first, at the moment of red

`lore evidence --result expected-fail` with real failing output WHILE RED, then the pass.

## Falsifier

Report the four measured values. Exit code must be vitest assertion-failure **1**, never 2+.
