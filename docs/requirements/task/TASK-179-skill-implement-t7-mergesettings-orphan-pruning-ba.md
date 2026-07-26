---
id: TASK-179
type: task
role: plan
title: "[Skill:implement] T7 mergeSettings orphan pruning + backup prune keep-5"
status: archived
priority: critical
phase: "Phase 3: Peripherals"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-175, type: blocks}
---
Estimate: M
Approach: merge-settings.ts (core, pure): prune pass keyed by lore-ownership detection = command string contains the `{{CLAUDE_DIR}}`-substituted `/hooks/` path prefix (same identity convention mergeSettings already uses); prune count in merge result (additive field). setup-service.ts: pruneBackups(keep=5) called during install after successful writes — sorts run dirs by written_at name, removes oldest beyond keep, skips non-conforming names (safety), never fails the install (warning only).
Source: SPEC-076 §C5; RED tests from paired test task
Dimensions: D-FUNC, D-CODE
Scope-Alt: prune warning channel = stderr line (no receipt section) if receipt plumbing bites
Covers: AC-076-5, AC-076-8

AC:
- Paired RED files GREEN: bunx vitest run packages/lore/tests/unit/core/merge-settings-prune.test.ts exits 0 (≥4 passed asserted); cd packages/lore && bun test tests/integration/setup-backup-prune.bun.test.ts exits 0 (≥3 passed)
- Given 7 converge runs each with differing content (AC-076-8 oracle), Then ≤5 run dirs remain, removed = oldest
- Existing mergeSettings idempotency tests stay green (regression)
- tsc clean
