---
id: TASK-654
type: task
role: plan
title: "Embed build provenance into the binary and add the three-state --check-binary-provenance"
status: draft
priority: medium
phase: "binary-provenance"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-121
plan: PLAN-121
---
Implements AC-BFI-1 and AC-BFI-2 of spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor.

## Objective

Make the binary declare the commit it was built from, and add a check that compares that commit
against the source tree — so "was this verdict issued by a binary built from this source?" becomes
answerable. Today it is not: the global `lore` is a symlink into this checkout's `dist/lore`, and
knowledge-eight-findings-from-building-and-closing-the-plan section 4 records a co-resident session
re-branching that checkout so `lore` silently became a build without the slice under test.

## Two ACs, two layers

- **AC-BFI-1** — `bun run build` embeds the build commit; `lore status --json` exposes
  `binary_provenance{build_commit, build_dirty, built_at}`.
  The test MUST assert `build_commit` EQUALS the real HEAD sha read independently via
  `git rev-parse HEAD` at test time. A hardcoded 40-hex placeholder satisfies a shape regex, so
  shape assertions alone are worthless here. Declared RED (b) is exactly that case: swap the
  injection for a well-formed constant sha and the equality assertion must still fail.
- **AC-BFI-2** — `lore status --check-binary-provenance`, three states, exact exits:
  `dev-synced` 0 / `dev-stale` 3 (naming BOTH shas) / `not-a-dev-checkout` 0 with the literal token
  `skipped`. 3 is the measured code of the existing `--check-*` drift family, not a new convention.

⛔ State 3 is the distribution-first requirement: a consumer who ran `npm i -g lore` has a binary
whose build commit is unknown to their repo and MUST NOT be told it is stale. Collapsing 3 into 2
breaks every consumer; collapsing 3 into 1 makes the check vacuous.

## Constraints

- `commands/status.ts` is a thin adapter — no business logic. Derivation belongs in the service
  layer, per the module CLAUDE.md.
- The `--check-*` family has composable exit precedence; do not break it.
- Record the `expected-fail` evidence row YOURSELF, at the moment the test is red, before implementing.
