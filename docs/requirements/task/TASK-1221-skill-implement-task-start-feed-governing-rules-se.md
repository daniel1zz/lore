---
id: TASK-1221
type: task
role: plan
title: "[Skill:implement] Task-start feed governing-rules section"
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
Approach: consume RuleReadService.find by spec cites then by the task's file anchors; render id + statement only; hard cap 40 with overflow count
Source: spec C6 feed integration; BL-15
Covers: AC-BLS2-7
AC:
- Before editing: record expected-fail of AC-BLS2-7's command on THIS task
- bunx vitest run packages/lore/tests/unit/service/feed-governing-rules.test.ts passes
- bun run test:changed passes and every test file importing task-feed-wiring.ts or task-feed-render.ts is green (list printed in evidence)
