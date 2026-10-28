---
id: TASK-1219
type: task
role: plan
title: "[Skill:implement] Census: typed-error sites, field-distinct keys, workspace resolution (fixes #59 #60)"
status: archived
priority: critical
phase: "Phase 2: Indexes and census"
created: 2026-10-08
updated: 2026-10-25
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1217, type: blocks}
  - {id: TASK-1216, type: blocks}
---
Estimate: M
Approach: site-census.ts — (1) site = any expression whose contextual type (TypeChecker.getContextualType / getTypeAtLocation) is assignable to the product LoreError type, plus err()/gateFailure() calls; (2) key = file#symbol#code#field when field is a literal, else #<ordinal-in-function>; (3) resolve @lore/* imports through the analysed repo's package.json workspaces + tsconfig paths (custom module resolution host), never through node_modules symlink targets; reached files outside the root are reported, not dropped
Source: issues #59 #60; AC-BLS2-15; R4c scenarios
Covers: AC-BLS2-15, AC-BLS2-5
AC:
- Before editing: record expected-fail of AC-BLS2-15 on THIS task
- AC-BLS2-15 and AC-BLS2-5 commands both pass; baseline-coverage.bun.test.ts and rule-service-site-map.test.ts green
- `bun run packages/lore/src/index.ts baseline sites "scope add"` lists the scope refusals (blank id, 50-id cap, evidenced-id removal) — pasted in evidence
- the same `baseline sites "ac add" --json` output is byte-identical from main and from a worktree with per-entry node_modules symlinks (diff pasted in evidence)
- bun run typecheck exit 0
