---
id: TASK-2029
type: task
role: plan
title: "P7 main suite red files after the plan-progress landings"
status: archived
priority: medium
phase: "P"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
---
Resolves #339, #341.

The first automatic batch's full suite on main db548061 failed these files:
packages/lore/tests/e2e/issue-check.bun.test.ts, packages/lore/tests/integration/autonomy-human-set.test.ts, packages/lore/tests/integration/write-path-everywhere.bun.test.ts, packages/lore/tests/unit/core/issue-report.test.ts.
Reproduce each on main, find the cause (suspects: hard-coded schema version 35 after P2's migration 036; BR-1379 archived-terminal fixtures; issue-check's known fixture), and fix at the root. If a test pins behaviour an approved spec removed, follow the spec.
