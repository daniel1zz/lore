---
id: TASK-649
type: task
role: plan
title: "Wire the anchor-coverage checker into both byte-identical pre-push copies"
status: archived
priority: medium
phase: "anchor-ratchet"
created: 2026-08-11
updated: 2026-08-17
tags: []
parent: PLAN-121
plan: PLAN-121
---
Implements AC-BFI-9 of spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor.

## Objective

Wire `check-anchor-coverage` into the pre-push gate, in BOTH byte-identical copies.

This task exists because capability and production wiring MUST be the same acceptance unit.
AC-BFI-5/6/7 all invoke the checker directly and would go green on a checker that no pipeline ever
calls — a fully attested, entirely inert mechanism. That failure mode is recorded four times over in
this repo; the fix is a wiring AC whose oracle asserts a live call site.

## AC-BFI-9, measured RED by segment on 2026-08-11 before implementation

    diff hooks/pre-push assets/project/pre-push    -> exit 0   (parity currently holds)
    grep -q check-anchor-coverage hooks/pre-push   -> exit 1   (not wired)
    full command                                    -> exit 1

## Constraints

- Regenerate `packages/lore/src/generated/assets-manifest.ts` after editing `assets/`.
- Preserve pre-push's fail-open contract when `lore`/`.lore/` are absent.
- ⛔ BLOCKED on T2 (`task-wire-the-binary-provenance-check-...`): both tasks anchor `hooks/pre-push`
  and `assets/project/pre-push`. Claim only after T2 merges, or the anchor-overlap gate refuses.
