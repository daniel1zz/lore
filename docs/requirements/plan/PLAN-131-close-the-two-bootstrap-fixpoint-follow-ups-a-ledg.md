---
id: PLAN-131
type: plan
role: plan
title: "Close the two bootstrap-fixpoint follow-ups: a ledger test that stops delegating membership to the checker, and a rename that carries its four records with it"
status: approved
priority: high
created: 2026-08-18
updated: 2026-08-18
tags: []
parent: SPEC-134
phases:
  - {name: "follow-ups", description: "AC-BFI-10 and AC-BFI-11. Disjoint file anchors, so both tasks are concurrently claimable."}
---
Closes the two follow-ups that `lore assess` raised against
plan-land-bootstrap-fixpoint-integrity-binary-provenance-the after it was
archived (handoff 107, NS3 and NS5). Both are addressability/truthfulness
defects in already-landed work, not new capability.

## Objective

1. Break the circular oracle under AC-BFI-5. The ledger test asserts row COUNT
   and its own comment delegates the membership half to the checker's exit code
   — but the checker IS the thing under test, so a regression from set equality
   to a pure count leaves the test green AND AC-BFI-5's oracle green. AC-BFI-10
   requires the test to compute the unanchored slug set independently.

2. Rename the pre-push trip test, whose name asserts a narrower scope than its
   contents (it holds both the AC-BFI-3 and the AC-BFI-9 suite), and converge
   every tracked record of the old name in the SAME task. AC-BFI-11 enumerates
   the four record sites; a rename that moves the file and leaves them behind
   manufactures four stale assertions at the moment it lands.

## Phases

Single phase. The two tasks share no file, so they run concurrently.

## Out of Scope

- The checker `scripts/check-anchor-coverage.ts` itself. AC-BFI-10 is about the
  TEST's independence, not about changing checker behaviour. If the checker
  needs a change to make independent measurement possible, stop and report
  rather than widening the task.
- Historical knowledge docs under `docs/requirements/` that name the old
  basename. They record a past measurement and are deliberately left verbatim;
  AC-BFI-11's git-grep clause excludes that directory for this reason.
- `scripts/changed-tests.ts` selection behaviour — that is AC-TC-4 under
  SPEC-101, a separate plan, though its expected filename depends on this
  plan's rename landing first.
