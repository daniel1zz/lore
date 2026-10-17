---
id: TASK-1509
type: task
role: plan
title: "[Skill:implement] TG-24 build dist/lore once per run; no test rebuilds it"
status: draft
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1498, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: 8 test files run `bun run build` in beforeAll, which trips the stale-binary check of other compiled tests in any parallel run (5 failures measured in the ADR). Build dist/lore once in the runner's globalSetup (or as the first step of `bun run test`), fail loud if the build fails, and remove the in-test rebuilds; tests that need a variant binary build it into their own mkdtemp dir, never dist/.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared; decision: adr-tg-1-test-runner-decision-measured-comparison-of-bun-only (option b, accepted 2026-10-17)
AC: no test writes dist/lore during a run (assert via the T5 tree snapshot or a dedicated check); the 8 files pass in a parallel full run.
