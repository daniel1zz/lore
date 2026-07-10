---
id: TASK-107
type: task
role: plan
title: "T1-test: gate-predicates unit tests (RED)"
status: archived
priority: high
phase: Phase 1 — gate kernel
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-024
plan: PLAN-024
links:
  - {id: TASK-099, type: blocks}
---
Approach: vitest unit tests for pure predicate fns, written before impl (TDD RED).
Source: spec §4.1, §9 AC1.
AC: tests exist for parentLegal / specKindValid / hasSkeleton; run RED (fail because module absent). Cases: parent-missing→PARENT_REQUIRED, spec_kind="x"→invalid, missing skeleton→invalid, compliant→ok.
Estimate: S
