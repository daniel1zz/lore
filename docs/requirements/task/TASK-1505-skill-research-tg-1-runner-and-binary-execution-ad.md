---
id: TASK-1505
type: task
role: plan
title: "[Skill:research] TG-1 runner and binary-execution ADR, measured"
status: draft
priority: critical
phase: "Phase 1: decide"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1495, type: blocks}
  - {id: TASK-1498, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: L
Approach: Measure, do not estimate. In a scratch worktree (never the repo's .lore/), for each option record: test files failing unchanged, full-suite wall time on this machine, test files that must change. (a) bun test only: run every vitest file under bun test (bun test <file>) and count failures by cause (vi.* APIs, jsdom/dashboard, config). (b) vitest under the Bun runtime: bunx --bun vitest run, check bun:sqlite loads, count failures. (c) storage seam: count .bun.test.ts files whose only Bun dependency is SQLiteStore construction and could use InMemoryStore. Also classify the 134 tests that spawn dist/lore: which assert binary-only behaviour (compiled assets, exit codes through the real process) vs command logic callable in-process; measure the time of 10 of each. Record the result with lore create adr (options, numbers, recommendation); the user decides.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-1 — ADR with the three measured options and the binary-execution classification; approved after the user picks.
Files: none in the repo (ADR only).
