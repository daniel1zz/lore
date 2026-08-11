---
id: TASK-477
type: task
role: plan
title: "Land the baseline+ledger policy for check:test-budgets (55 pre-existing violations currently gate nothing)"
status: archived
priority: high
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: ADR-019, type: relates-to}
---
## Task

Implement `adr-a-newly-armed-structural-oracle-enforces-from-a-baseline` for
`check:test-budgets`, which currently exits 2 with **55 pre-existing violations
across 28 files** and therefore gates nothing.

## Current state (measured on main this session)

- 55 violations / 28 files; spawn counts 3-9; **31 of the 55 merely touch the
  3-spawn threshold**.
- Baseline named by the ADR: **`48d3dbc`**, the merge that landed the oracle.
- AC-TB-1 of `spec-a-test-case-s-timeout-budget-must-be-declared-when-its` asserts
  tree-wide exit 0. That premise was false when written (it assumed one
  violation). The ADR replaces it; this task lands the replacement.
- Worst single file: `packages/lore/tests/integration/archive-sweep-cli.bun.test.ts`
  at 9 spawns — the same file carrying the silently-inert gate-disable defect in
  `task-archive-sweep-gate-disable-is-silently-inert-a-wholesale`. Coordinate:
  whichever lands second must retire the other's ledger row if it fixes the case.

## Mechanism required (the ADR's three criteria, verbatim obligations)

1. **Baseline-scoped enforcement** — exit 0 over files changed after `48d3dbc`.
2. **An auditable exemption ledger** — every pre-existing violation recorded with
   path, line, measured spawn count, and reason. **Data the oracle reads, not an
   `--exclude` glob inside the script.**
3. **Ledger completeness asserted** — an exempt entry that no longer matches a
   real violation FAILS LOUD, so the ledger cannot outlive the debt it describes
   and quietly become a suppression list.

⛔ Do NOT declare the 55 timeout values. The ADR rejects that explicitly: 55
numbers nobody measured are afterwards indistinguishable from measured ones.

⛔ Do NOT raise the 3-spawn threshold to shrink the count. The threshold is the
contract; tuning it to fit the back-catalogue inverts the direction of evidence.

Also update AC-TB-1 on the governing spec to the ADR's criteria (the spec is
approved, so the content edit demotes it to draft and it must be re-promoted
through `spec-promote`).

## Oracle

- The oracle exits 0 on the tree at HEAD with the ledger in place.
- A NEW violation introduced after the baseline exits non-zero (prove enforcement
  is live, not merely quiet).
- A ledger row whose violation has been fixed exits non-zero naming that row
  (criterion 3's fail-loud — the control that stops suppression).
- A ledger row pointing at a nonexistent path exits non-zero naming the path.
