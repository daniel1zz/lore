---
id: TASK-826
type: task
role: plan
title: "Extend the anchor ratchet to conclusion-bearing knowledge and build the anchor-owing predicate"
status: draft
priority: medium
phase: "P2 the knowledge anchor ratchet"
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-146
plan: PLAN-146
---
## Objective

Extend the anchor ratchet to conclusion-bearing knowledge and build the anchor-owing
predicate. Claims AC-CONV-5, AC-CONV-6.

## Why this exists

`lore anchor add` has accepted knowledge `code_anchors` since 2026-08-12 and
`DriftCheckService` already scans by type. Live usage measured 2026-08-24: **spec 97,
knowledge 1** (the 1 was added by hand this session as the first instance). The capability
was never the gap — the OBLIGATION was. You are building the obligation.

## The change

1. `scripts/check-anchor-coverage.ts` — EXTEND it to the conclusion-bearing knowledge
   sub-types. ⛔ Do NOT create a second ratchet script; the AC asserts exactly ONE
   tree-wide, recognized as a file under `scripts/` referencing `LEDGER_RELATIVE_PATH`.
   Its exit contract is 0 clean / 1 repo-invariant failure / 2 scan failure.
2. `packages/lore/src/service/conclusion-convergence.ts` — the anchor-owing predicate:
   OWES = retro, reference, research, skill; EXEMPT = handoff, assessment, uat, ideation,
   prompt. Iterate `KNOWLEDGE_SUB_TYPES` itself so a tenth value fails until classified.
3. The three body recognizers exactly as the AC declares them (two regexes plus an
   export-declaration resolver over the enumerated glob).

## ⛔ The traps

- The ratchet must hold in BOTH directions: a new anchor-owing retro with no anchors is
  refused (exit exactly 1, never 2), AND invalidating that retro does NOT remove it from the
  ratchet set. The second is the escape this repo already closed on the spec side.
- ⛔ Do NOT backfill anchors onto the 154 existing retros (spec N4). Arming handles them.
- The glob-vs-import-graph equality assertion is a HARD FAILURE, never a warning.

## Baseline check FIRST

⛔ Worktree is built from `origin/main`, 8 commits BEHIND local main. `git rebase main`,
then confirm `git log --oneline -1` matches the orchestrator baseline before trusting any
measurement.

## RED first, at the moment of red

`lore evidence --result expected-fail` with the real failing output WHILE RED, then the
pass. Transcription afterwards does not count.

## Falsifier

Report the four measured values in your return message. Exit code must be the vitest
assertion-failure code **1**, never 2+ — a crash proves the rule never ran.
