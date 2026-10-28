---
id: TASK-2050
type: task
role: plan
title: "[implement] Main write path writes no snapshot for working-state-only writes and records the delta in audit"
status: archived
priority: critical
phase: "Phase 2: Write paths"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-258
plan: PLAN-258
links:
  - {id: TASK-2052, type: blocks}
  - {id: TASK-2068, type: blocks}
---
Estimate: L
Approach: per spec Scope 3 for the main path: CorpusService.writeDoc and set call isContentChange and pass `snapshot` to the store flag added by the store task; buildStateChange fills details.state_change.
Source: spec Scope 3-4; ADR D1, D4; writeDoc's existing unchanged-patch check (patchedFieldsUnchanged) stays first.
Covers: AC-HC-1, AC-HC-10

## Work
- writeDoc / set: unchanged patch → nothing written (existing). Otherwise isContentChange → snapshot true (as today) or false (no versions row, audit details.state_change).
- Claim, release, steal, forced release, evidence (task-workflow-service.ts) and phase track (phase-workflow-service.ts) all reach writeDoc; verify each produces its delta (AC-HC-10: previous.claim on steal; removed on release).
- Closest-earlier-row resolution helper in version-service.ts (used for a stored version number with no row, e.g. a review judgment's doc_version); AC-HC-1 asserts it.
- Fix the existing tests whose expectation the spec changed (a working-state write no longer adds a versions row), and only that expectation. Known candidates (grep, not complete): tests/unit/service/{cite-gate,version-slug,check-done-floors,phase-checklist-service,record-reopen,review-approve-toctou,drift-check-service,task-workflow-service}.test.ts. Run the full `bun run test:vitest` in the worktree before release, since the integrate floor runs no tests.

## AC
- AC-HC-1 and AC-HC-10 commands pass on SQLite, Turso (local file) and InMemory, each observed red first.
- Full `bun run test:vitest` exits 0 in the worktree; every STALE_VERSION test stays green (Invariant I1).
