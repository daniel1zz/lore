---
id: TASK-2056
type: task
role: plan
title: "[implement] restore-archive and the history-archive status check"
status: approved
priority: high
phase: "Phase 1: Compaction"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-257
plan: PLAN-257
links:
  - {id: TASK-2055, type: blocks}
---
Estimate: M
Approach: per spec Scope 7-8 and D4.
Source: spec Scope 7 (restore by column name, no overwrite, byte-equality check) and Scope 8 (status check).
Covers: AC-CP-2, AC-CP-7

## Work
- `lore history restore-archive <file>`: header/columns/sha checks (exit 4), INSERT OR IGNORE by column name, post-check presence + byte-equality (exit 1), history-restore audit row, same lease.
- `lore status --check-history-archives`.
- Archive write-failure path test (unwritable directory).

## AC
- AC-CP-2 and AC-CP-7 commands pass, red first. Unfiltered attested run naming every modified test file.
