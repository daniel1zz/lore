---
id: TASK-1882
type: task
role: plan
title: "[Skill:fix] TG-51 other test probes read Bun spawnSync stdout for their verdict and can flake like TG-49 (empty stdout, status 0)"
status: archived
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: TG-49 (2026-10-19) proved Bun spawnSync can return status 0 with EMPTY stdout (~1 in 6000 calls under 12 concurrent loops; repro scratchpad/stress.ts) and fixed scripts/test-isolation-env.ts by reading the verdict from the exit status. Other probes read stdout the same way and can flake identically: packages/lore/tests/integration/test-sandbox-guard.test.ts:69, packages/lore/tests/unit/test-sandbox-preload.bun.test.ts:26 (find exact paths), and any other test-infrastructure probe whose verdict is parsed from a child's stdout (grep spawnSync in scripts/ and tests/ helpers). Make each verdict come from the exit status (or another channel that cannot be silently empty); a probe that truly needs stdout must treat empty stdout as not-measured and fail loud, never as a negative verdict.
Source: TG-49 report
AC: each listed site converted, with an injected-empty-stdout test per site.
