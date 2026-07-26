---
id: TASK-122
type: task
role: plan
title: "T5 — sync-push fixture migration chain catches up to migration-009"
status: archived
priority: medium
phase: "Wave 2 — verify + anchor + adversarial"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-030
plan: PLAN-030
---
Full-suite regression surfaced the designed fixture-drift guard: sync-push.bun.test.ts applyMigrationsToClient stops at migration-008 while SQLiteStore is now at user_version 9. Mirror turso-store.ts's migration-009 handling (three-phase: ADD_COLUMNS -> JS audit-chain backfill -> FINALIZE) in the fixture, matching how the 008 three-phase block is mirrored. Oracle: cd packages/lore && bun test tests/unit/adapters/sync-push.bun.test.ts fully green.
