---
id: TASK-1273
type: task
role: plan
title: "[C9] [Skill:implement] sync-push remote fixture follows migration-013"
status: archived
priority: critical
phase: "Phase C: services and surfaces"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
links:
  - {id: TASK-1272, type: blocks}
---
Estimate: S
Approach: the sync-push test's remote fixture replays its own migration chain and asserts it matches SQLiteStore's (`sync-push fixture drift: … local PRAGMA user_version=13, remote PRAGMA user_version=12. Add the missing MIGRATION_0…`). [B2] added migration-013 (docs.type CHECK admits baseline + rule_registry) and bumped LATEST_SCHEMA_VERSION to 13 without extending this fixture chain. Extend the fixture chain the same way earlier migrations were added there.
Source: full bun suite on main after the slice-1 merges (E1): 1 regression in packages/lore/tests/unit/adapters/sync-push.bun.test.ts. Root cause of the miss: [B2]'s scoped oracle covered tests/unit/store only, not the downstream consumers of the migration chain.
Covers: supports AC-BLS1-1 (registry on synced replicas)

AC:
- Record the current red on this task first: `lore evidence <task> --result expected-fail --oracle test --capture --command "bun test packages/lore/tests/unit/adapters/sync-push.bun.test.ts"`.
- `bun test packages/lore/tests/unit/adapters/sync-push.bun.test.ts` exit 0, 0 fail.
- grep for every OTHER test or script that replays the migration chain or pins the schema version (e.g. `grep -rln "user_version\|MIGRATION_0\|LATEST_SCHEMA_VERSION" packages/lore/tests scripts`) and run each — list them; all exit 0.
- `bun run typecheck` exit 0.
