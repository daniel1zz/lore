---
id: TASK-732
type: task
role: plan
title: "Make both new falsifiers discriminate: share one assertion path, assert the anchor's stored value, and refresh the comment my ledger fix invalidated"
status: archived
priority: high
phase: "follow-ups"
created: 2026-08-18
updated: 2026-08-20
tags: []
parent: PLAN-131
plan: PLAN-131
---
Implements AC-BFI-12 of spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor.

Found by `lore assess` AFTER both AC-BFI-10 and AC-BFI-11 were already attested and
their tasks archived — which is the point worth noticing: attestation certified an
oracle whose falsifier does not discriminate.

## Three items, ONE acceptance unit

1. **The AC-BFI-10 falsifier tests the helper, not the assertion.** Its `RED PAIRED`
   case mutates an in-memory ledger copy and asserts only
   `diffSlugSets(...).missingFromLedger`. Delete or weaken the HAPPY case's set
   expectations and BOTH that case AND the externally declared ledger-mutation
   falsifier stay green — nothing reddens. Extract ONE shared assertion function that
   the happy path and the falsifier path both call, so no single mutation can satisfy
   one without the other.

2. **AC-BFI-11 case (d) proves less than it claims.** `lore status --check-drift`
   exiting 0 is consistent with the spec's `code_anchor` having been repointed to ANY
   existing file. Add an assertion that the stored anchor value NAMES
   `pre-push-trip.bun.test.ts`.

3. **A stale comment my own fix created.** The comment around
   `packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts:592` says
   `spec-corpus-truthfulness-a-verdict-must-carry-the-state-it` "landed with no anchor
   and no ledger row on 2026-08-17". It was dispositioned 2026-08-18 in commit
   `2c606027`, so that sentence is now false. Rewrite it to name the disposition and
   the commit, in grep-checkable form. ⛔ Keep its rationale — not coupling the causal
   test to full-corpus cleanliness is still correct and must survive the edit.

## Why (3) is in the same task as (1) and (2)

A comment that truthfully recorded a gap becomes a stale assertion at the moment the
gap is fixed. That is why the fix and every record of it are one acceptance unit.
