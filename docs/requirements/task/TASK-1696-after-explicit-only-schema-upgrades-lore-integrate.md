---
id: TASK-1696
type: task
role: plan
title: "After explicit-only schema upgrades, lore integrate cannot land a branch that adds a migration: the floor's corpus snapshot stays at the old schema"
status: archived
priority: critical
created: 2026-10-19
updated: 2026-10-20
tags: []
parent: PRD-001
---
Regression from 5f0259a1 (2026-10-19 20:12, 'corpus upgrades run only through lore migrate schema; every other open refuses (exit 4)'). integrate-service.ts (INT-T12, lines ~54-56) relies on the branch binary migrating the VACUUM INTO snapshot when it opens it; since 5f0259a1, the open refuses instead. Migration 026 landed at 19:43, before 5f0259a1, so it never hit this. The first migration after it (lore-6c, branch worktree-agent-a8fb1b35f8a344774, migration 027) fails check:baseline-coverage, check:memory-files and check:ac-oracle-ownership in the floor. Second gap: after such a landing, nothing upgrades the shared .lore/lore.db, so every session's rebuilt dist/lore refuses it until someone runs lore migrate schema by hand, and the order (rebuild, then migrate) is not defined. End state to design: (1) corpus.take runs the branch binary's lore migrate schema on the snapshot, never the live corpus, before the floor; (2) after the CAS and the post_refresh rebuild, integrate runs lore migrate schema on the live corpus once, under its lease, and reports the from and to versions; a failure is loud and names the corpus. Oracle: a throwaway repo whose branch adds migration N+1 lands through lore integrate, and afterwards the live corpus is at N+1 with exactly one migrate_schema audit row.
