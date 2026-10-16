---
id: TASK-1484
type: task
role: plan
title: "[Skill:refactor] TG-12 store tests share one suite across three adapters"
status: archived
priority: medium
phase: "Phase 2: clear offenders"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: L
Approach: The store suites copy the same cases three times (in-memory-store.test.ts:1056, sqlite-store.bun.test.ts:1516, turso-store.bun.test.ts:1566; 78/104/86 cases; in-memory already lacks 005.09 and 005.11-.14). Move each shared behaviour into *.shared.ts suites called by all three adapters, as packages/lore/tests/unit/store/batch-methods.shared.ts does. Adapter-specific cases stay in their file. Report the case count per adapter before and after; a case missing from an adapter must be added or named as not applicable with the reason.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-9 (part).
