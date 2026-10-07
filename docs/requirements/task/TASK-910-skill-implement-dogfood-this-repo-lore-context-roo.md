---
id: TASK-910
type: task
role: plan
title: "[Skill:implement] dogfood — this repo .lore/context, root CLAUDE.md refresh, owner user-layer migration"
status: archived
priority: high
phase: "Phase 4: Dogfood & verify"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-909, type: blocks}
---
Estimate: M
Approach: run `lore setup` + `lore context refresh` on this repo with the merged binary; add project-layer fragments only where the repo needs subagent rules (test-runner split, never write .lore/); verify `lore fragments check` exit 0. Owner user-layer migration (~/.config/lore/context/ from ~/.claude/CLAUDE.md per spec migration table) is performed by the ORCHESTRATOR on main after merge (personal machine state, not shipped, not in a worktree).
Source: spec §Migration table
Dimensions: D-FUNC
Scope-Alt: owner user-layer migration may be split to a follow-up if `check` refuses budgets.
Covers: (dogfood — supports AC-CF-4, AC-CF-8 on the real repo)

AC:
- `lore fragments check` exits 0 in this repo; root CLAUDE.md contains the Z1 fragments section; `lore status --check-claude-md` exits 0.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
