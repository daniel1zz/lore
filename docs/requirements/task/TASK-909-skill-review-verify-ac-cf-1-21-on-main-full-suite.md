---
id: TASK-909
type: task
role: plan
title: "[Skill:review] verify AC-CF-1..21 on main, full suite, assess, anchors"
status: draft
priority: high
phase: "Phase 4: Dogfood & verify"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
---
Estimate: M
Approach: on main after all merges: `bun run build`, `bun run typecheck`, `bun run test:vitest`, `bun run test:bun`, `LORE_ACTOR=agent:main-orchestrator lore verify plan-context-fragments-config-driven-layered-rule-injection`, `lore assess <plan>`, then `lore anchor add <spec> <impl-path>` for landed files.
Source: plan Exit Criteria
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-CF-1..21 (verification only)

AC:
- lore verify reports attested pass for all 21 ACs; full suites exit 0; `lore status --check-drift` exit 0.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
