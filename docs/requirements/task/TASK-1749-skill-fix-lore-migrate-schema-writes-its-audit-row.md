---
id: TASK-1749
type: task
role: plan
title: "[Skill:fix] lore migrate schema writes its audit row around the single write route; two write-path scans are red on main"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (reported by a peer session, 2026-10-19, measured on a branch with main at 79571711 merged): tests/integration/single-write-path.bun.test.ts and tests/integration/write-path-everywhere.bun.test.ts fail, flagging packages/lore/src/adapters/cli/migrate-schema.ts (landed with the explicit schema-upgrade task) as a direct store-write call site: its migrate_schema audit row bypasses the single write route.
Approach: the audit row goes through the shared write port (CorpusService / DocWritePort audit path) once the schema is current; if the row must be written in the same transaction as the migration, the migration path is registered as the one sanctioned store-level writer with the reason in the scan's own allowlist mechanism — whichever matches how other store-open writers are classified there.
AC: both tests pass on main; migrate schema still writes exactly one migrate_schema audit row with actor, from, to, duration. Runner-produced red (the current failure).
