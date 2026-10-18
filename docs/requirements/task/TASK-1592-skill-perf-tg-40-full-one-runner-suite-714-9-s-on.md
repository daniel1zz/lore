---
id: TASK-1592
type: task
role: plan
title: "[Skill:perf] TG-40 full one-runner suite 714.9 s on a quiet machine (limit 600 s): cut the measured hotspots"
status: draft
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
Estimate: L
Approach: lore verify AC-TG-11 on main 188638ca with both peer sessions holding (load ~3.4 at start, 8 workers): measure-test-wall 714.9 s, 1094 files, suite exit 1 (one Node-project failure owned by the ambient-state plan). TG-36's breakdown (scratchpad measure-direct.log): per-file overhead ~72 s wall over 8 workers; 15 files >=30 s = 875 s CPU, led by baseline-coverage.bun.test.ts 122 s, compiled-census.bun.test.ts 108 s (130 `lore baseline map --site` calls at 0.5-1 s each), verify.test.ts 81 s, e2e/cli.bun.test.ts 68 s, tree-consistency 66 s, site-census-fidelity 52 s. Root-cause reductions, measured before/after per file: batch the census site lookups (one process computes all sites — a product change: lore baseline map --sites-from / a JSON batch mode, owned by the baseline spec — coordinate with the session working baseline completeness), move remaining spawn-heavy command-logic tests in-process, shard the heaviest files. No retries, no timeout bumps, no deleted tests. Then the orchestrator re-measures on a quiet machine.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-11; measurement 2026-10-18
AC: lore verify AC-TG-11 passes on a quiet machine (<= 600 s, suite exit 0).
