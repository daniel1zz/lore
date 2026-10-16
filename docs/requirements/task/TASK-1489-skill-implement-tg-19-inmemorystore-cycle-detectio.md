---
id: TASK-1489
type: task
role: plan
title: "[Skill:implement] TG-19 InMemoryStore cycle detection follows parent_id"
status: archived
priority: medium
phase: "Phase 2: clear offenders"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: S
Approach: Found by T12 (main 9bd49072). InMemoryStore.detectParentCycle walks only `links` rows and ignores docs.parent_id, so shared store cases 005.11, 005.12 and 005.14 fail on in-memory; they are skipped there via parentIdOnlyCycleDetection: false in packages/lore/tests/unit/store/in-memory-store.test.ts. Make the in-memory cycle check follow parent_id exactly as SQLiteStore does, then remove the skip option so the three cases run on all three adapters.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (AC-TG-9: store suites shared across adapters)
AC: the three cases pass on in-memory with no skip; sqlite and turso suites stay green.
