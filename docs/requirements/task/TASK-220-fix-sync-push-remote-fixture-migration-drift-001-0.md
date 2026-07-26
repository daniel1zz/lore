---
id: TASK-220
type: task
role: plan
title: "Fix sync-push remote fixture migration drift (001/002 hand-copy vs full chain) + user_version parity guard"
status: archived
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-047
plan: PLAN-047
---
sync-push.bun.test.ts applyMigrationsToClient applies only MIGRATION_001/002 (self-labeled MOCK RISK) — migration-007's versions.slug broke all happy-path pushes (local has column, remote fixture lacks it). Fix: apply full 001..007 chain in order; then assert PRAGMA user_version parity between local SQLiteStore db and remote client so the NEXT migration divergence fails loudly at fixture setup instead of silently. Test file only.
