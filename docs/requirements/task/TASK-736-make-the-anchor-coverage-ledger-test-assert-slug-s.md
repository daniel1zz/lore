---
id: TASK-736
type: task
role: plan
title: "Make the anchor-coverage ledger test assert slug-set equality computed independently of the checker"
status: archived
priority: high
phase: "follow-ups"
created: 2026-08-18
updated: 2026-08-18
tags: []
parent: PLAN-131
plan: PLAN-131
---
Implements AC-BFI-10 of spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor.

## Objective

`packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts` line 219 asserts
`expect(shipped.entries.length).toBe(unanchored)`, where `unanchored` is parsed out of
the CHECKER's own verdict line. The comment above it states that the checker's exit 0
supplies the membership half of set equality. That is circular — the checker is the
subject under test.

Add a `describe` block titled exactly:

    AC-BFI-10: ledger membership is asserted as a slug set, independently of the checker

It must compute the set of unanchored live-spec slugs WITHOUT reading the checker's
stdout or exit code, compare it as a SET against the slug set in
`scripts/anchor-coverage-ledger.json`, and on mismatch fail with the differing slugs
NAMED in the message. Keep the existing cardinality assertion; it just stops being the
only one.

## Red first

Before writing the assertion, run the declared falsifier by hand and record it:
swap `spec-075-dashboard-adjudication-workbench-route-telemetry-prd` for
`spec-077-dashboard-execution-read-surface-prd-21-f3` in the ledger (both rows already
exist, so the row count does not move), run the AC's command, and confirm it is GREEN
under today's test — that is the false green being closed. Then write the set assertion
and confirm the same mutation turns it RED naming the omitted slug. Record the red with
`lore evidence <task> --oracle test --command "<cmd>" --result expected-fail` AT THE
MOMENT IT IS RED, from inside your own worktree. Restore the ledger before finishing.

## Out of scope

`scripts/check-anchor-coverage.ts`. If independent measurement turns out to need a
checker change, stop and report instead of widening the task.
