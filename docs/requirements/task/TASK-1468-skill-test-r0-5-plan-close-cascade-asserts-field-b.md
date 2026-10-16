---
id: TASK-1468
type: task
role: plan
title: "[Skill:test] R0-5 plan-close-cascade asserts field by field (#201)"
status: archived
priority: low
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-200
plan: PLAN-200
links:
  - {id: TASK-1477, type: blocks}
---
Estimate: S
Resolves: task-gh-1343388703-201
Approach: plan-close-cascade.bun.test.ts:267 deep-equals a cascade result that gained `issueClose: []` (9f6ceb46). First confirm the plan IS archived (the report title claims it is not); if so, assert field by field like lines 249-251. If the plan is really not archived, stop and report: that is a product defect, not a test fix.
Covers: AC-R0-2
AC:
- AC-097-2 passes; evidence states whether the plan was archived before the change
