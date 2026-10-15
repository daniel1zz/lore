---
id: TASK-827
type: task
role: plan
title: "Add updated_at and a supersedes projection to the search hit, one query, default order frozen"
status: deprecated
priority: medium
phase: "P1 the currency projection"
created: 2026-08-24
updated: 2026-10-10
tags: []
parent: PLAN-146
plan: PLAN-146
---
## Objective

Give every search hit a currency signal, without an N+1 and without changing default
order. Claims AC-CONV-1, AC-CONV-2, AC-CONV-3.

## The change

1. `SearchHit` (`packages/core/src/types.ts`) gains `updated_at`, and a supersedes
   projection. It ALREADY carries `validity?` and `created_at` (SPEC-043 D3) — read that
   JSDoc first; `created_at` exists specifically so `isInvalidated` needs no per-hit fetch.
2. All three stores populate the new fields from the SAME query. ⛔ The supersedes edge must
   ride the hit SQL via a join — a per-hit round trip is exactly the N+1 SPEC-043 D3 avoided.
3. `lore search` gains an opt-in recency axis (`updated_at` DESC, ties by `id` ASC).
   Default stays bm25, byte-for-byte.
4. `scripts/record-search-baseline.ts` — a SEPARATE entrypoint that writes
   `packages/lore/tests/fixtures/search-bm25-baseline.json` (5 fixed queries, ordered slugs).
   ⛔ Generate it BEFORE your changes land, from the merge-base state.

## ⛔ The traps

- "Not superseded" must be an EXPLICIT absence, not a missing key — otherwise it is
  indistinguishable from "not measured" (North Star property 2).
- AC-CONV-1/-3 count QUERIES, not time: same count for 1 hit as for 50.
- AC-CONV-2 asserts the fixture's SHA-256 is identical before and after the run, AND that
  the recorder is absent from the suite's import graph. A suite that regenerates its own
  baseline must fail.

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
