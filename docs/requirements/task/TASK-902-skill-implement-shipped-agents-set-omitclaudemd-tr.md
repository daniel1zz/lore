---
id: TASK-902
type: task
role: plan
title: "[Skill:implement] shipped agents set omitClaudeMd true"
status: archived
priority: medium
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
Approach: per spec D5 — add `omitClaudeMd: true` to every assets/agents/lore-*.md frontmatter; move any rule the body relied on from CLAUDE.md into either the agent body (role-generic only) or a shipped `subagent:<type>` fragment under assets/context/ (coordinate: governance task owns assets/context/ — if a new fragment is needed, put it in assets/context/agent-rules.md (your declared anchor; governance task has landed before you)). Regenerate assets manifest.
Source: spec D5; sub-agents docs omitClaudeMd (Claude Code ≥ v2.1.271)
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-CF-9

AC:
- `cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts -t 'AC-CF-9'` → ≥1 pass, 0 fail.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
