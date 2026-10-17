---
id: TASK-1498
type: task
role: plan
title: "[Skill:implement] TG-15 parallel bun run and wall-time measure"
status: draft
priority: high
phase: "Phase 5: cadence"
created: 2026-10-16
updated: 2026-10-17
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
Observation from T7 (2026-10-16): with source rules removed and dist/lore rebuilt, ONE combined `bun test` run over 9 bun files reported 84 pass, while each file run alone went red (9/9). Unexplained (module cache, binary path, or shared state across files in one bun process). Before relying on combined or parallel bun runs as oracles, reproduce and explain this: a combined run that stays green under a mutation that turns each file red is a blind oracle (AS-17).

Runner decision (ADR adr-tg-1-test-runner-decision-measured-comparison-of-bun-only, accepted 2026-10-17): option (b), one runner = vitest on the Bun runtime, migrated by T23 (blocks this task). This task now: parallelise the single runner (vitest pool/maxWorkers under --bun) and write scripts/measure-test-wall.ts measuring the full one-runner run; bun test --concurrent (aborted at 887 s) and bun 1.4.2 --parallel (hung) are out. T24 (build once) and T26 (in-process tests) land first.
