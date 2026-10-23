---
id: TASK-1743
type: task
role: plan
title: "Root CLAUDE.md names the architecture tree (BASE-095) as the current-state architecture authority"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Found 2026-10-19: a session asked "where is the technical architecture" answered from module CLAUDE.md files and frozen KN snapshots, missing the architecture tree (BASE-095 Lore architecture: current state BASE-079 with 9 module cards, target state BASE-078, standards BASE-094 / AS-n, ADR index BASE-093, debt BASE-092 / AD-n). Cause: the root CLAUDE.md Architecture section routes "tier 2" readers only to module CLAUDE.md files and knowledge-root-claude-md-tier-2-..., never to the architecture tree; no memory file names BASE-095 (grep: 0 hits).

Expected: the root CLAUDE.md Architecture section names the architecture tree (root BASE-095) as the current-state architecture authority, within the content contract of `lore governance claude-md`; `bun run check:memory-files` exits 0.
