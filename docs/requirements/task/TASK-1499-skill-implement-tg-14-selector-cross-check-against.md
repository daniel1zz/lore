---
id: TASK-1499
type: task
role: plan
title: "[Skill:implement] TG-14 selector cross-check against a full-suite result"
status: archived
priority: medium
phase: "Phase 4: selector"
created: 2026-10-16
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1497, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: A cross-check script takes the full-suite json results (vitest --reporter=json and the bun equivalent) and a commit range, runs the selector for that range, and exits 1 naming each failing test the selector would not have picked. It runs after each full run on main (T16 documents when).
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-8.
