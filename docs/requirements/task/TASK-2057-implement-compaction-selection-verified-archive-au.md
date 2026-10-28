---
id: TASK-2057
type: task
role: plan
title: "[implement] Compaction selection, verified archive, audit rows and the compact command"
status: approved
priority: critical
phase: "Phase 1: Compaction"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-257
plan: PLAN-257
links:
  - {id: TASK-2056, type: blocks}
---
Estimate: L
Approach: per spec Scope 1-5 (selection, archive, audit) and Design Decisions D1-D3.
Source: spec-compact-document-history-archive-then-delete-snapshots; working-state.ts (landed); existing review-lease table (`acquireLease`, review-batch-lease.ts renewal pattern).
Covers: AC-CP-1, AC-CP-3

## Work
- core: RETIRED_KEYS and isCompactable in packages/core/src/working-state.ts (+ unit cases).
- store: composite `compactVersionsWithAudit(batch)` in store-interface + SQLite/Turso/InMemory: per row re-check eligibility and archive membership, delete, append the history-compact audit row (Scope 5), one transaction per ≤500 rows.
- service + CLI: `lore history compact [--apply] [--json]` dry run and apply; archive writer/verifier beside the resolved lore.db (Scope 4); lease acquire + renewal.
- lore log: count history-compact deltas whose version has no versions row.

## AC
- AC-CP-1 and AC-CP-3 commands pass, red first. Full `bun run test:vitest` in the worktree; record one unfiltered attested run naming every test file you modify.
