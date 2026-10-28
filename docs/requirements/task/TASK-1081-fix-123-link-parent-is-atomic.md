---
id: TASK-1081
type: task
role: plan
title: "Fix 123 link parent is atomic"
status: archived
priority: medium
phase: "fixes"
created: 2026-10-10
updated: 2026-10-25
tags: []
parent: PLAN-165
plan: PLAN-165
links:
  - {id: TASK-1064, type: blocks}
---
Estimate: M
Source: spec-baseline-close-out-fixes-audit-surface-node-validation AC-BLC-7
Approach: red-first test at the AC's named path (record expected-fail on pre-fix code), fix, green; scoped tests incl. direct consumers.
AC: AC-BLC-7 pass via its declared command.
