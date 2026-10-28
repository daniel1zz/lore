---
id: TASK-2055
type: task
role: plan
title: "[implement] Compaction lease, vacuum outcome and sync refusal"
status: approved
priority: high
phase: "Phase 1: Compaction"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-257
plan: PLAN-257
links:
  - {id: TASK-2053, type: blocks}
---
Estimate: M
Approach: per spec Scope 3 (lease, vacuum, sync refusal) and D2.
Source: spec Scope 3; SQLite VACUUM / wal_checkpoint result row semantics (spec correction v25).
Covers: AC-CP-4

## Work
- Concurrency test hook: inject a write between archive verification and the first delete batch.
- `--vacuum`: VACUUM then wal_checkpoint(TRUNCATE), outcome read from SQLite's result; the two exit-5 messages.
- `sync.enabled` refusal before any write.

## AC
- AC-CP-4 command passes, red first. Unfiltered attested run naming every modified test file.
