---
id: TASK-1794
type: task
role: plan
title: "[Skill:fix] baseline adopt from a linked worktree writes config then has its audit row refused (half-write)"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem (observed on main 27f487fe, 2026-10-19): `bun run test:file packages/lore/tests/integration/working-tree-write-root.test.ts` fails INT-T10 "baseline adopt from a linked worktree rewrites the worktree .lore/config.yaml and leaves the main checkout identical": exit 4, "Storage failure: config was changed but the audit row was NOT written ... gate:corpus-write:foreign-provenance: this baseline write resolved a corpus OUTSIDE the caller's own working tree". The config file is written and then the audit row is refused, so the write is half-done (config changed, unaudited). Likely introduced when DCL-3/3b routed every write through CorpusService.writeDoc's foreign-corpus refusal; `baseline adopt` writes a worktree-local config, not a foreign corpus doc.
Approach: decide the authority for an adopt run from a linked worktree before writing anything (the config write and its audit row are one unit: both or neither); an adopt that targets the invoking worktree's own config declares its intent so the audit row is accepted; a genuinely foreign target is refused before the config is touched.
AC: INT-T10 passes; a fixture where the audit write is refused leaves config.yaml byte-identical (no half-write). Runner-produced red.
