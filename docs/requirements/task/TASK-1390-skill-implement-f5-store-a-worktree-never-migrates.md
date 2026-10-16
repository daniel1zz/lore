---
id: TASK-1390
type: task
role: plan
title: "[Skill:implement] F5 store: a worktree never migrates the main checkout's corpus"
status: archived
priority: critical
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-189
plan: PLAN-189
links:
  - {id: TASK-1381, type: blocks}
---
Estimate: L
Approach: per spec F5 — leave the SQLiteStore constructor unchanged. Add packages/lore/src/store/foreign-schema-guard.ts: given a db path and cwd, it is FOREIGN when cwd is in a linked worktree (git rev-parse --git-dir differs from --git-common-dir) and the path is the common-dir checkout's .lore/lore.db; when foreign, read user_version via a read-only bun:sqlite handle and compare with LATEST_SCHEMA_VERSION (store/schema-version.ts). Call it before every new SQLiteStore on an open path: (1) adapters/cli/loader.ts after findLoreDbPath() at :312 and :382 -> VALIDATION_ERROR, exit 4; (2) app.ts createApp/createAppUnscoped before :1653 -> throw a named error (composition root; covers scripts and tests calling createApp(findLoreDbPath()) directly, e.g. scripts/tests/spec-mirror-export.test.ts). corpus-resolution.ts stays sqlite-free (adapters/cli/CLAUDE.md). gate.ts:263 (findLoreDbPathQuiet, must never exit): on a behind foreign db skip the audit write, print one warning line, exit 0. Record in evidence, per site, how each of the 15 direct new SQLiteStore sites gets its path (baseline-adopt.ts:73 own .lore at init; mount-registry.ts:105,146 registered paths).
Source: spec F5; packages/lore/src/adapters/cli/loader.ts:218,226,312,382; packages/lore/src/app.ts:1480-1491,1653; packages/lore/src/store/schema-version.ts; packages/lore/src/adapters/cli/commands/gate.ts:263; corpus-resolution.ts:227-233 and sqlite-store.ts:256 (reference only)
Resolves: task-gh-1343388703-189
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CRIT-7
AC:
- Given a temp repo whose .lore/lore.db is one schema version behind and a linked worktree without .lore, When the corpus is opened from the worktree, Then exit is exactly 4 with VALIDATION_ERROR naming the schema mismatch and main's user_version is unchanged; opened from the main checkout it migrates (AC-CRIT-7)
- Given the same setup, When a script calls createApp(findLoreDbPath()) from the worktree, Then it throws the named error before construction and main's user_version is unchanged (AC-CRIT-7)
- Given the same setup, When 'lore gate spec-create' runs from the worktree, Then it exits exactly 0, prints one warning naming the schema mismatch, and main's user_version is unchanged.
- Evidence lists the 15 direct SQLiteStore sites and the resolution path each uses.
Integration: the test spawns the real CLI from source (bun run packages/lore/src/index.ts or the repo's existing source-spawn helper; no dist/lore dependency) from the worktree; set a per-test timeout in the file.
