---
id: TASK-591
type: task
role: plan
title: "T1 changed-tests selector script + package script + CLAUDE.md delivery surfaces + tests"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-113
plan: PLAN-113
---
Implement spec-two-runner-changed-test-selection-deterministic-test in full (read the spec first — SSOT; the 3 script ACs' test-file paths are contractual). scripts/changed-tests.ts: changed-set (git diff base...HEAD + porcelain), regex import graph over packages/*/{src,tests} with @lore/core(/node) alias resolution, reverse-dependency BFS, binary-consumer marker (dist/lore|LORE_BIN in .bun.test.ts) included on any src change with bun run build first, per-runner execution, mandatory counts+reason accounting, --list mode, loud 0-selected warning, fail-loud on git/graph errors. package.json test:changed. CLAUDE.md: Commands section one-liner + worktree-oracle wording swap (anchor-matched bun test -> bun run test:changed <base>). Design decisions D1-D3 in spec are binding.
