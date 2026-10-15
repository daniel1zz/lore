---
id: TASK-1083
type: task
role: plan
title: "Fix 128 audit entries record the write surface"
status: archived
priority: medium
phase: "fixes"
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-165
plan: PLAN-165
links:
  - {id: TASK-1081, type: blocks}
---
Estimate: M
Source: spec-baseline-close-out-fixes-audit-surface-node-validation AC-BLC-1
Approach: red-first test at the AC's named path (record expected-fail on pre-fix code), fix, green; scoped tests incl. direct consumers.
AC: AC-BLC-1 pass via its declared command.
