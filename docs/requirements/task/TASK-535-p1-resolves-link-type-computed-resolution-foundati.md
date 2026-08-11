---
id: TASK-535
type: task
role: plan
title: "P1 — resolves link type + computed resolution (foundation)"
status: archived
priority: medium
phase: "P1 foundation"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
plan: PLAN-103
links:
  - {id: TASK-529, type: blocks}
  - {id: TASK-534, type: blocks}
  - {id: TASK-533, type: blocks}
  - {id: TASK-531, type: blocks}
---
## Objective

Add the `resolves` link type and the pure computed-resolution function — the foundation every P2 surface reads.

## Deliverables

- **D1a** — `linkTypeSchema` (`packages/core/src/schemas.ts`) gains `"resolves"` as an eighth member.
- **D1b** — write-time validation: a `resolves` edge whose `to` doc is not a task carrying `extra.issue_report` is rejected with a named `VALIDATION_ERROR`. Enforce in the shared link write path (`CorpusService.link`) so CLI, MCP and HTTP are covered by one implementation — not per-adapter.
- **D2** — new `packages/lore/src/service/issue-resolution.ts` exporting a PURE `computeIssueResolution(issue, resolvesInEdges, sourceDocs)` → `"open" | "resolving" | "fixed" | "rejected" | "wontfix"`:
  - explicit terminal state in `extra.issue_report.resolution` wins over any edge computation
  - `fixed` iff ≥1 resolves-source doc is `active` or `archived`
  - `resolving` iff ≥1 resolves in-edge exists but no source is terminal
  - `open` otherwise

## Acceptance Criteria

AC-ICL-1, AC-ICL-2 of `spec-issue-closure-loop-computed-resolution-agent-reachable`.
Oracle: `bunx vitest run packages/lore/tests/unit/service/issue-resolution.test.ts -t AC-ICL-1` (and `-t AC-ICL-2`).

## Constraints

- Keep `computeIssueResolution` store-free (caller supplies docs) so it stays vitest-testable without `bun:sqlite`.
- Six-dimension coverage (HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/REGRESSION). Red before green.
- `@lore/core` must stay browser-safe — no Node builtins in the schema change.
