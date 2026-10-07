---
id: TASK-895
type: task
role: plan
title: "[Skill:implement] render + section — outlet rendering with caps and the Z1 fragments section"
status: archived
priority: high
phase: "Phase 2: Pure services"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
links:
  - {id: TASK-893, type: blocks}
  - {id: TASK-905, type: blocks}
---
Estimate: S
Approach: per spec §Module Boundary render.ts/section.ts — pure `renderOutlet(sel, outlet)` (hook outlets enforce SESSION_FRAGMENT_CAP / SUBAGENT_FRAGMENT_CAP, err BUDGET_EXCEEDED with per-fragment sizes); pure `buildFragmentsSection(rendered, scope): ManagedSection` — sole owner of Z1 section id 'fragments', shape compatible with service/context-projection.ts spliceManagedSections.
Source: spec D6, D13; packages/lore/src/service/context-projection.ts
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CF-3

AC:
- `bunx vitest run packages/lore/tests/unit/context-fragments/render.test.ts` → Tests N passed.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
