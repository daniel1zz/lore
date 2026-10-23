---
id: TASK-1734
type: task
role: plan
title: "Root CLAUDE.md architecture pointer names BASE-095, which lore get cannot resolve"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Regression from task-root-claude-md-names-the-architecture-tree-base-095-as-the (landed ab50cd0f, 2026-10-19): the root CLAUDE.md Architecture line tells readers to run `lore get BASE-095` (and names BASE-079 / BASE-094). `lore get BASE-095` exits with "Document not found: BASE-095": BASE-n numbers exist only in the docs/requirements mirror (.lore/export-index.json human_id), lore does not resolve them.

Expected: the line addresses the tree by identifiers lore resolves: `baseline-lore-architecture` (root, 01M4J6XNB5SKEC48MB0T3NRTAQ), `baseline-architecture-current-state`, `baseline-architecture-standards`. Oracle: every `lore get <x>` named on that line exits 0 (run each), and `bun run check:memory-files` exits 0.
