---
id: TASK-1469
type: task
role: plan
title: "[Skill:test] R0-3 test-budget ledger and missing timeouts (#170)"
status: archived
priority: medium
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
Resolves: task-gh-1343388703-170
Approach: run scripts/check-test-budgets (via scripts/tests/check-test-budgets.test.ts) on main after T1 merges; delete ledger rows for deleted/renamed tests (e.g. gate-hooks.bun.test.ts) and give every flagged case an explicit per-test timeout. Ledger and the flagged test files only.
Covers: AC-R0-1
AC:
- scripts/tests/check-test-budgets.test.ts passes; the checker reports 0 violations
