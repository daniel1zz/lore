---
id: TASK-1225
type: task
role: plan
title: "[Skill:implement] RuleReadService + ImpactService + lore rule show/find/impact"
status: archived
priority: critical
phase: "Phase 4: Rule read path"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1221, type: blocks}
  - {id: TASK-1215, type: blocks}
---
Estimate: M
Approach: read ac_cites/rule_depends/rule_registry; impact = one WITH RECURSIVE query with a visited set; cycles reported with member ids
Source: spec C6; perf review
Covers: AC-BLS2-6
AC:
- Before editing: record expected-fail of AC-BLS2-6's command on THIS task
- bunx vitest run packages/lore/tests/unit/service/rule-read-impact.test.ts passes
- MCP parity: lore_rule_show, lore_rule_find and lore_rule_impact tools registered; packages/lore/tests/unit/adapters/mcp-tools*.test.ts green (bunx vitest run packages/lore/tests/unit/adapters -t mcp shows Tests N passed)
