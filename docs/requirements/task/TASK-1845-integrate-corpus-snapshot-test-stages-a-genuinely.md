---
id: TASK-1845
type: task
role: plan
title: "integrate corpus-snapshot test stages a genuinely older schema instead of rewinding user_version"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Baseline-red on main (measured 2026-10-19 on a clean detached main f1e80ee3, `bun run test:file packages/lore/tests/integration/lore-integrate-corpus-snapshot.test.ts`: 2 failed | 2 passed): "a branch needing a newer schema lands" and "the floor reads the shared corpus's content" fail with `Storage failure: duplicate column name: detail`.

Cause: the test stages "a corpus one schema version behind" by only setting `PRAGMA user_version = LATEST - 1` on a database that already has the LATEST schema (test file lines 10, 33, 79). That staging silently assumed the newest migration is re-runnable. Migration 024 (commit a3d7fc19, decision detail column) is a plain ADD COLUMN in sqlite-store.ts / turso-store.ts, so re-running it fails. Shipped migrations must not be edited in place (store module CLAUDE.md), and a real corpus never has a schema newer than its user_version, so the fixture is what is wrong.

End state: the test stages a genuinely older corpus — one whose schema is exactly what migration LATEST-1 produces (for example created by running the store's migrations only up to LATEST-1, through an exported migration-step entry if one exists, or by building it with the binary of the previous schema version) — so it holds whatever the newest migration does. No migration is changed.

AC: the snapshot test file passes on main with migration 024 unchanged; falsifier: replace the staging with today's user_version-only rewrite and the two named tests fail with "duplicate column name".
