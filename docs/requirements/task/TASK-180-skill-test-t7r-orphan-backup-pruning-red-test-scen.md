---
id: TASK-180
type: task
role: plan
title: "[Skill:test] T7r orphan + backup pruning — RED test scenarios"
status: archived
priority: high
phase: "Phase 3: Peripherals"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-179, type: blocks}
---
Estimate: S
Source: AC of task T7 (orphan + backup pruning) — SPEC-076 §C5
TDD-Role: red | Paired-Impl: T7 (prune implementation)

Scenarios:
- Given settings.json containing a lore-owned hook registration (command path prefix `<claude-dir>/hooks/`) whose file is absent from the new payload, When mergeSettings runs, Then that entry is removed and the result reports prune count = 1
- Given a non-lore entry (foreign command string), Then it is byte-identical in output regardless of payload
- Given a lore-owned entry whose file IS in the payload, Then it is preserved (no false prune)
- Given payload renames hook A→B, Then output contains B's registration and not A's (rename = prune old + insert new)
- Given .lore-backups with 7 run directories, When prune(keep=5) runs, Then exactly the 2 oldest (by dir-name timestamp order) are removed
- Given 5 or fewer run dirs, Then prune removes nothing (boundary)
- Given a non-timestamp-named foreign dir inside .lore-backups, Then prune never deletes it (NEGATIVE/safety)

AC:
- All scenarios as executable vitest tests in packages/lore/tests/unit/core/merge-settings-prune.test.ts (mergeSettings cases) + a bun.test stub for fs-touching prune cases at packages/lore/tests/integration/setup-backup-prune.bun.test.ts
- Both files run RED with failure reason = missing implementation (`cmd > out 2>&1; echo $?` recorded); vitest file ≥4 cases, bun file ≥3
