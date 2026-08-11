---
id: TASK-533
type: task
role: plan
title: "P2 — consumer report-issue --list reports computed resolution"
status: archived
priority: medium
phase: "P2 surfaces"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
plan: PLAN-103
links:
  - {id: TASK-532, type: blocks}
---
## Objective

Stop the consumer-facing lie: `lore report-issue --list` must report the DEFECT's state, not the upstream doc's raw status.

## Deliverables

- **D6** — `IssueReportService.list` joins each receipt against the **computed resolution** instead of the upstream doc status. The rejection / wontfix reason is echoed so the reporting agent learns why. Doc status is demoted to a debugging detail.
- Preserve, byte-for-byte, the existing `unreachable` degradation (SPEC-072 AC-072-10): an upstream that cannot be validated/opened, and a receipt whose doc no longer exists upstream, both still degrade to `status: "unreachable"` rather than crashing.
- Preserve, byte-for-byte, the unconfigured-consumer output (the §20 regression pin).

## Acceptance Criteria

AC-ICL-7. Oracle: `cd packages/lore && bun test tests/e2e/issue-consumer-list.bun.test.ts -t AC-ICL-7`.

The decisive case: twin corpora where the upstream fix shipped as a SEPARATE archived spec carrying a `resolves` edge — `--list` must print `fixed`, never `draft`. That is the exact shape that misreported for 9 days.

## Constraints

- Consumes `computeIssueResolution` from P1 — do NOT reimplement.
- Twin throwaway corpora (`mkdtemp` + `lore init` × 2). NEVER write to this repo's `.lore/`.
- `bun run build` before the oracle. Six-dimension coverage. Red before green.

## Unblocked 2026-07-29 (orchestrator)

Both blockers you reported are addressed:

1. **SQLite CHECK constraint** — FIXED and merged: `packages/lore/src/store/migrations/migration-012.ts` widens `links.link_type` to accept `"resolves"` (landed via the dashboard task, verified on the merged main: `migration-012.bun.test.ts` + `issue-closure.bun.test.ts` + `issue-check.bun.test.ts` = 34 pass / 0 fail). Real `SQLiteStore` writes of a `resolves` edge now succeed. The CLI-layer `VALID_LINK_TYPES` gap is also fixed (it now derives from `linkTypeSchema.options`).
2. **`UpstreamPort` cannot see resolves-edges** — this is now YOURS to fix. `packages/lore/src/flows/upstream-context-flow.ts` is added to your anchors. Extend the port with the minimal read op the computation needs (resolves in-edges + their source docs' statuses), following the precedent set by `getDocStatus`'s own JSDoc, which documents exactly why a new op was preferable to deriving it from the existing four.

Keep the port surface minimal and keep every existing degradation intact.
