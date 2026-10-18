---
id: TASK-1580
type: task
role: plan
title: "[Skill:fix] TG-36 AC-TG-11: verify evidence tail loses the final summary; diagnose wall-time variance; @layer the three T15 test files"
status: archived
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: (a) DEFECT: two lore verify runs of AC-TG-11 on main (exit 1, 652 s and 825 s) recorded an output_tail (~4089 chars) that ends mid-test-output, without measure-test-wall's final summary line; a direct run of the same command printed the summary as its last lines (scratchpad measure-direct.log). The evidence rule requires the tail to keep the runner's final summary. Find why (capture of a long merged stream? child processes holding the pipe? tail taken before the process ends? stdout/stderr interleave) and fix it at the root in the capture path, red-first with a fixture command that prints >1 MB then a summary line. (b) Wall-time: measured 538-615 s (T15, loaded), 652.8 s (loaded, 1 test failure caused by a concurrent build), 825 s (lore verify, lighter load). Using the vitest JSON reports run-tests.ts writes, find where the time goes and why it varies (per-file durations, worker idle time, build step, the 2 binary-only pre-push tests, serial Node project); propose and implement root-cause reductions (no retries, no timeout bumps, no deleted tests). Do NOT take the final AC-TG-11 measurement yourself — the orchestrator measures on an idle machine. (c) check:ac-oracle-ownership is red on main: unowned-ac-reference for AC-TG-10 in scripts/tests/run-chain.test.ts and AC-TG-11 in scripts/tests/test-yield-setup.test.ts and scripts/tests/measure-test-wall.test.ts (T15) — add @layer tags or repoint honestly.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-11, AC-TG-5; lore-evidence-attestation rule (tail keeps the final summary)
AC: (a) red-first fixture green; (b) a written per-file time breakdown with the changes made; (c) bun run check:ac-oracle-ownership exits 0.
