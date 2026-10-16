---
id: TASK-1494
type: task
role: plan
title: "[Skill:implement] TG-9 check:ac-oracle-ownership"
status: archived
priority: high
phase: "Phase 3: guards"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: Extend scripts/check-unclaimed-oracle.ts (it already maps test names to ACs) into check:ac-oracle-ownership: the owning file of a script AC is the first test file of its verify.command; fail with exit 1 naming spec, AC id and path when that file does not exist, and when a test file references an AC id in describe/it/@spec_ref that it does not own without a spec-qualified reference (<spec-slug>#AC-ID) or an @layer <surface> tag for a different entry point. AC ids are unique only within a spec (packages/core/src/acceptance.ts superRefine), so every reference is resolved per spec. Checker and fixtures only; T11 wires it into the chain once main passes.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-5.
