---
id: TASK-1874
type: task
role: plan
title: "[Skill:fix] INT-T12 lore integrate runs the floor against a snapshot of the corpus so a migration branch can land"
status: archived
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PRD-001
---
Estimate: M
Problem (measured 2026-10-19): `lore integrate worktree-agent-a8038d23f6d884443` (HR-T1, adds migration 024) exits 1: the floor step `check:ac-oracle-ownership` spawns the BRANCH's source (`bun run packages/lore/src/index.ts`) against the shared checkout's corpus, which is at schema 23; the foreign-schema guard (packages/lore/src/store/foreign-schema-guard.ts) refuses ("a linked worktree never migrates the main checkout's corpus"). Every branch that adds a migration can therefore never pass the floor; the only way through would be migrating the live corpus before landing, which breaks the installed main binary and every peer.
Approach: before running the floor, `lore integrate` gives the integration worktree its own corpus: a consistent snapshot of the shared checkout's `.lore/lore.db` (SQLite backup API / VACUUM INTO, never a raw copy of a WAL-mode file) written to `<integration worktree>/.lore/lore.db` (plus the config files the corpus needs). The foreign-schema guard already allows a worktree with its own `.lore/`, so the branch binary migrates the snapshot, never the live corpus. The snapshot is removed with the integration worktree; it is never written back. Report in integrate's output that the floor ran against a snapshot taken at <ts>.
AC (oracle tests in packages/lore/tests/integration, throwaway repos only):
1. A branch that bumps LATEST_SCHEMA_VERSION and adds a migration lands (exit 0) through `lore integrate` when the floor reads the corpus with the branch binary; the shared checkout's corpus schema version is unchanged right after the landing.
2. The floor's corpus reads see the shared corpus's content (a doc created in the shared corpus before integrate is visible to the floor command).
3. Nothing the floor writes to the snapshot reaches the shared corpus (row count / a marker write asserted absent).
4. Make it go red once: without the snapshot, case 1 exits 1 naming the schema mismatch.
