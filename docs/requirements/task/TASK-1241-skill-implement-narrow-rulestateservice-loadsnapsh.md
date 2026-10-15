---
id: TASK-1241
type: task
role: plan
title: "[Skill:implement] Narrow RuleStateService.loadSnapshot to 4 doc types"
status: archived
priority: medium
phase: "Phase 4: Rule read path"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1212, type: blocks}
---
Estimate: S
Approach: replace findMany({}) with type-filtered queries for baseline, spec, plan, task
Source: perf review (lore status --json measured 19.2 s)
Covers: AC-BLS2-9
AC:
- Before editing: record expected-fail of AC-BLS2-9's command on THIS task
- bunx vitest run packages/lore/tests/unit/service/rule-state-snapshot-scope.test.ts passes
- rule-state-service.test.ts and rule-state-vacuous.test.ts green
- AC-BLS2-9's test asserts 0 knowledge-doc parses; lore status --json wall time on this repo recorded before/after for the assessment (informational, not a pass condition)
