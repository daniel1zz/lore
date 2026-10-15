---
id: TASK-1233
type: task
role: plan
title: "[Skill:implement] migration-014: registry lifecycle/version, ac_cites, rule_depends, ac_exemptions + same-tx writers"
status: archived
priority: critical
phase: "Phase 2: Indexes and census"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1229, type: blocks}
  - {id: TASK-1215, type: blocks}
  - {id: TASK-1225, type: blocks}
  - {id: TASK-1231, type: blocks}
---
Estimate: L
Approach: additive migration-014 on all three stores (sqlite, turso, in-memory) with backfill from documents; schema version 14; rule-service writes registry lifecycle/version and rule_depends in the leaf write tx; the chokepoint writes ac_cites in the spec write tx; baseline status gains index_mismatch count, rendered in lore status (packages/lore/src/adapters/cli/commands/status.ts, next to registry_mismatch); the store interface gains read methods for ac_cites and rule_depends used by later tasks
Source: spec C5; slice-1 migration-013 pattern (packages/lore/src/store/migrations/migration-013.ts)
Covers: AC-BLS2-4
AC:
- Before editing: record expected-fail of AC-BLS2-4's command on THIS task
- cd packages/lore && bun test tests/unit/store/migration-014.bun.test.ts passes
- Invariant 5: sync-push.bun.test.ts, every migration-*.bun.test.ts, schema-version pins and scripts/check-ordinal-write-sites.mjs green (update the sync-push remote fixture and allowlist in the SAME task)
- Turso and in-memory stores pass the same contract tests
