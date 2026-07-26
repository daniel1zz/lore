---
id: TASK-154
type: task
role: plan
title: "Stabilize deleted-corpus-liveness.bun.test.ts (2 recorded load-dependent failures) or adopt dispatch watchdog"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Estimate: S

SPEC-078 assess gap: tests/unit/mount/deleted-corpus-liveness.bun.test.ts is the sole empirical basis for the no-watchdog decision (T8/D8) but failed twice under concurrent load (T7 evidence [6], T8 evidence [3]) and passed 5+ other runs. Either make it deterministic (isolate from suite-parallel load, e.g. serial marker or dedicated invocation) proving N=10 consecutive green, or adopt the plan risk-register contingency: per-request timeout wrapper at the multi-project dispatch boundary.

AC:
- Given 10 consecutive runs of the file under full-suite load, Then 10/10 green — or the dispatch watchdog lands with its own bun test and the spike test is re-scoped to document-only.
- Given the chosen path, Then the T8 no-watchdog decision comment in adapters/http/index.ts is updated to cite the new basis.
