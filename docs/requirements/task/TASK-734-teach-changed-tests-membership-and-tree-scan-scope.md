---
id: TASK-734
type: task
role: plan
title: "Teach changed-tests membership and tree-scan scope about extensionless hook and asset paths, asserted through the shipped CLI"
status: archived
priority: high
phase: "selection"
created: 2026-08-18
updated: 2026-08-19
tags: []
parent: PLAN-130
plan: PLAN-130
---
Implements AC-TC-4 of spec-two-runner-changed-test-selection-deterministic-test.

## Objective

Make `bun scripts/changed-tests.ts --list` select BOTH pre-push guard tests —
`packages/lore/tests/unit/assets/pre-push-parity.test.ts` and
`packages/lore/tests/integration/pre-push-trip.bun.test.ts` — for a change set that
touches `hooks/**`, and likewise for one touching `assets/**`, in both the pure case
and the mixed-with-other-files case.

## The two code sites

Both must change; neither alone is sufficient, and this is already measured:

1. **Membership** — the candidate predicate requires a bare `main()`, so an
   extensionless hook script such as `hooks/pre-push` is never even a candidate.
2. **Tree-scan scope** — the scope predicate rejects extensionless paths outright.

Start by reading `classifyBinaryConsumer` / `isBinaryConsumerCandidate` and
`classifyTreeScanningOracle` / `isChangedFileInTreeScanScope` in
`scripts/changed-tests.ts`, and confirm both failure modes yourself before changing
anything.

## ⛔ Do not retry the literal-path-marker approach

It was implemented and MEASURED INERT, for exactly the two reasons above. See
`knowledge-bun-run-test-changed-full-selection-contract-and-its`. If you find
yourself adding a marker comment for the selector to grep, stop — that is the
approach that already failed.

## Why the mixed case is the dangerous one

A hook-ONLY change set is already handled correctly: it is refused with loud-zero,
exit 1. The failure is hook + ANY matched file — and editing `assets/` forces you to
regenerate the assets manifest, which IS a matched file. That selects non-empty,
silences loud-zero, and still omits both guards. So the selector reports success
having skipped precisely the tests that guard the surface being edited. Your mixed
case must assert selection, not merely a non-empty result.

## Out of scope

- `vitest --changed`'s structural blindness to `.bun.test.ts` files.
- `packages/core/src/attestation-completeness.ts`.
- `hooks/pre-push` and `assets/project/pre-push` themselves — they are byte-identity
  parity-pinned and this task does not edit them. You may use them as CHANGED-FILE
  INPUTS to the selector, which is different from editing them.
