---
id: TASK-616
type: task
role: plan
title: "[Skill:implement] lintMemoryFiles pure service + fs discovery probe"
status: archived
priority: critical
phase: "Phase 2: Parallel Implementation"
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
plan: PLAN-116
links:
  - {id: TASK-615, type: blocks}
---
Estimate: M
Approach: per spec D7 — pure `lintMemoryFiles(files, budgets)` in packages/lore/src/service/claude-md-check.ts mirroring prd-budget-check.ts (store-free, caller-injected). Input `{path, role, content}`; lint computes lines + Buffer.byteLength itself (single measurement point). Finding `{path, role, kind, measured, ceiling, message}` flat/serializable. Discovery probe adapters/real-memory-file-probe.ts: root file + `**/<filename>` walk, excludes .git/node_modules/linked-worktrees, mirrors drift-check FsProbe injection shape.
Source: spec §Module Boundary, §D2/D7; prd-budget-check.ts pattern
Dimensions: D-CODE, D-FUNC
Scope-Alt: probe worktree-exclusion can start as .git-presence heuristic; refine if false positives
Covers: AC-CMC-1

AC:
- Given the RED suite from the paired test task, When implementation lands, Then `bunx vitest run packages/lore/tests/unit/service/claude-md-check.test.ts` is GREEN with all cases matched (assert Test Files 1, no zero-match)
- Given a probe fixture tree with node_modules/CLAUDE.md and .git/CLAUDE.md, When discovered, Then both excluded, root+module files included with correct role
- Integration: `bun run typecheck` green; claude-md-check.ts imports from @lore/core only (no store imports — Invariant 2 supports)
