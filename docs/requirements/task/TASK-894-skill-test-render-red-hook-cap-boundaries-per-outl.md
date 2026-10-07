---
id: TASK-894
type: task
role: plan
title: "[Skill:test] render RED — hook cap boundaries per outlet"
status: archived
priority: high
phase: "Phase 2: Pure services"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
plan: PLAN-150
---
Estimate: S
Source: AC-CF-3; impl task: render
TDD-Role: red
Scenarios (describe 'AC-CF-3'):
- hook:session-start block exactly 9,600 chars → ok; 9,601 → err BUDGET_EXCEEDED listing each id + chars.
- hook:subagent-start block exactly 9,400 → ok; 9,401 → err.
- buildFragmentsSection returns a ManagedSection with id 'fragments' containing every selected body.
AC:
- Run → RED (missing module); record expected-fail evidence at that moment.

Governing spec: spec-context-fragments-config-driven-layered-rule-injection (read it in full: `lore get spec-context-fragments-config-driven-layered-rule-injection`; ACs: `lore ac list spec-context-fragments-config-driven-layered-rule-injection`).
Test conventions: vitest for non-bun:sqlite (`*.test.ts`), bun for `*.bun.test.ts`; never write the repo's `.lore/` or real `$HOME` (mkdtemp HOME + XDG_CONFIG_HOME + `lore init` throwaway corpus; pattern: packages/dashboard/tests/e2e/global-setup.ts).
