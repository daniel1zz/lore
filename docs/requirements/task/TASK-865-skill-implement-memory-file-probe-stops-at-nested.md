---
id: TASK-865
type: task
role: plan
title: "[Skill:implement] memory-file probe stops at nested git repositories"
status: archived
priority: critical
phase: "Phase 3: Dogfood & verify"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
links:
  - {id: TASK-880, type: blocks}
---
Estimate: S
Approach: in adapters/real-memory-file-probe.ts, during the root/module walk (and the .claude/rules walk if it can reach one), do not descend into any NON-ROOT directory that contains an entry named `.git` (directory or file) — same mechanism and doc style as the existing `.claude/worktrees` exclusion (N8). Update the module @invariant header to name the new exclusion (grep-checkable).
Source: issue #24; spec AC-STR-10
Dimensions: D-FUNC
Scope-Alt: reporting skipped nested roots is optional.
Covers: AC-STR-10

AC:
- `bunx vitest run packages/lore/tests/integration/claude-md-nested-repo-discovery.test.ts` passes; by hand: `claude-md-rules-discovery.test.ts`, `claude-md-reference-grammar.test.ts`, `status-claude-md.test.ts`, and `cd packages/lore && bun test tests/integration/bootstrap-memory-file-health.bun.test.ts`; `bun run typecheck` exit 0.
