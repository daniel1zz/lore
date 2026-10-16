---
id: TASK-1470
type: task
role: plan
title: "[Skill:refactor] R0-4 evict store/CLAUDE.md below its floor (#10)"
status: draft
priority: medium
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-200
plan: PLAN-200
links:
  - {id: TASK-1477, type: blocks}
---
Estimate: S
Resolves: task-gh-1343388703-10
Approach: packages/lore/src/store/CLAUDE.md is over its eviction floor (14980 vs 14746 bytes). Follow `lore governance claude-md` (How to evict): move a block the contract assigns to the corpus into a knowledge doc (lore create knowledge) and leave a one-line pointer. Keep runway, not just the floor.
Covers: AC-R0-1
AC:
- packages/lore/tests/unit/service/claude-md-eviction-floor.test.ts passes; lore status --check-claude-md reports the file below the eviction floor
