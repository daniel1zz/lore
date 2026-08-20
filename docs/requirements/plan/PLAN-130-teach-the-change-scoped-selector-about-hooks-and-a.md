---
id: PLAN-130
type: plan
role: plan
title: "Teach the change-scoped selector about hooks/ and assets/, so a hook edit can no longer silence the two tests that prove pre-push is wired"
status: approved
priority: high
created: 2026-08-18
updated: 2026-08-19
tags: []
parent: SPEC-101
phases:
  - {name: "selection", description: "AC-TC-4: membership + tree-scan scope both taught about extensionless hook/asset paths, asserted through the shipped CLI."}
  - {name: "additivity", description: "AC-TC-5: the hook/asset scope must be additive rather than pre-emptive, and the marker must be pinned in the two REAL guard files."}
---
Closes NS2 of `knowledge-handoff-agent-main-orchestrator-107`: the change-scoped
test selector is blind to `hooks/**` and `assets/**`, so the two tests that prove
pre-push is wired never run for the change sets most likely to break that wiring.

## Objective

AC-TC-4. `bun run test:changed` correctly refuses a hook-ONLY change set with a
loud-zero exit 1. The dangerous case is the everyday one: a hook edit plus ANY
matched file — and editing `assets/` FORCES you to regenerate the assets manifest,
which is a matched file — selects non-empty, silences loud-zero, and still omits
both pre-push guards. The selector reports success while having skipped exactly the
tests that guard the surface being changed.

Two code sites must change and neither alone is sufficient, both already measured:
membership requires a bare `main()`, so an extensionless hook script is never a
candidate; and the tree-scan scope predicate rejects extensionless paths outright.

## Out of Scope

- The literal-path-marker approach. It was implemented and MEASURED INERT for those
  two reasons — see `knowledge-bun-run-test-changed-full-selection-contract-and-its`.
  ⛔ Do not retry it.
- `vitest --changed`'s structural blindness to `.bun.test.ts` files. A separate,
  larger gap; this plan does not touch it.
- `packages/core/src/attestation-completeness.ts`. Its `countExplicitPathArgs`
  under-match on compound commands is a real defect recorded in
  `knowledge-four-governance-gaps-measured-while-resuming-handoff` §5, and it is not
  this plan's work.

## Why the oracle drives the CLI

A selector function that selects correctly while the shipped CLI still omits the
guards is the exact false green this plan exists to exclude. AC-TC-4 therefore
requires the assertion to be made through `bun scripts/changed-tests.ts --list`,
the same entry `bun run test:changed` invokes, never through `selectAffectedTests`
directly. Capability and production wiring are ONE acceptance unit.
