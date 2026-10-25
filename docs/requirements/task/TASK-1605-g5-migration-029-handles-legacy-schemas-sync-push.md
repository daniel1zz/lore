---
id: TASK-1605
type: task
role: plan
title: "G5 migration-029 handles legacy schemas; sync-push remote fixture at current schema"
status: archived
priority: medium
phase: "G"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Main green, cluster C, migrations and store. These were red before today.

- C5: migration 29 fails on the legacy fixture with "no such column: deleted_at", in migration-023 (2 tests) and decision-detail-chain (1). Make migration-029 handle a pre-deleted_at schema.
- C6: sync-push errors out as a whole file: local PRAGMA user_version=34, remote 23. Bring the remote fixture to the current schema with the same migrations.
- C11: baseline-effective-reads flags migration-029.ts:138 reading extra["rules"]. Allowlist the migration file, since migrations read raw legacy shapes on purpose.

Oracle: migration-023, decision-detail-chain, sync-push and baseline-effective-reads pass, unfiltered.
