---
id: TASK-892
type: task
role: plan
title: "[Skill:implement] select — outlet routing, when/disable filters, cross-file override refusal"
status: archived
priority: critical
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
Estimate: M
Approach: per spec routing table + D2/D11/D14 — pure `selectFragments(all, {outlet, agentType?, config})` plus pure `checkOverrides(all, configs)` returning Result err naming offending ids (used by `lore fragments check` and `lore context refresh`). Order = id ascending. Audience match: 'subagent:*' or exact 'subagent:<type>'; when via WHEN_MATCHERS.
Source: spec §Fragment format, routing table, D2, D11, D14
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CF-2, AC-CF-14, AC-CF-19, AC-CF-20, AC-CF-21

AC:
- `bunx vitest run packages/lore/tests/unit/context-fragments/select.test.ts` → Tests N passed, 0 failed.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
