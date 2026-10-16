---
id: TASK-1498
type: task
role: plan
title: "[Skill:implement] TG-15 parallel bun run and wall-time measure"
status: draft
priority: high
phase: "Phase 5: cadence"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1497, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: L
Approach: Per the T1 decision, run the bun tests in parallel (bun test --concurrent / --max-concurrency, or file shards across processes). Fix shared-state races at their root (shared temp dirs, ports, env, cwd); no retries, no timeout bumps. New scripts/measure-test-wall.ts --runner bun --max-seconds N runs the full bun suite, prints the measured seconds, exits 1 above the limit.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-11.
