---
id: TASK-903
type: task
role: plan
title: "[Skill:implement] hooks-subagent — subagent-context becomes a thin caller of lore fragments"
status: archived
priority: critical
phase: "Phase 3: Surfaces & wiring"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-910, type: blocks}
---
Estimate: S
Approach: per spec D5, D12 — assets/hooks/subagent-context.mjs: spawn `lore fragments render --outlet hook:subagent-start --agent-type <payload.agent_type> --cwd <payload.cwd>` and `lore fragments pointers --cwd <payload.cwd>`, concatenate (fragment block first), emit `{hookSpecificOutput:{hookEventName:'SubagentStart', additionalContext}}`; delete the hard-coded per-type text and buildProjectContext; never block (failure → banner from render, never empty). Regenerate assets manifest.
Source: spec D5, D12; current assets/hooks/subagent-context.mjs
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CF-7, AC-CF-10

AC:
- `cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts -t 'AC-CF-7'` and `-t 'AC-CF-10'` → ≥1 pass, 0 fail each.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
