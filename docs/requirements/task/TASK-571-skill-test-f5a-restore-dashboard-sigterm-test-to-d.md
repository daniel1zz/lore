---
id: TASK-571
type: task
role: plan
title: "[Skill:test] F5a restore dashboard-sigterm test to --dev topology"
status: archived
priority: high
phase: "Phase 4: E2E & docs"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-578, type: blocks}
---
Estimate: S
Approach: `packages/lore/tests/integration/cli/dashboard-sigterm.bun.test.ts` spawns `lore dashboard --no-open` WITHOUT `--dev` and asserts a Vite child descendant appears and is torn down on SIGTERM/SIGINT. DD-5 makes packaged mode (zero descendant processes) the default, so that assertion is structurally invalidated by design, not by a defect. Fix: pass `--dev` to the test's `spawnDashboard` args so it keeps testing the vite-topology teardown it was written for. Then ALSO add (or explicitly note as out of scope) a packaged-mode counterpart assertion: SIGTERM on packaged mode exits cleanly with no orphan listener on the api port.
Source: T3 completion finding (task-skill-implement-f5a-lore-dashboard-packaged-mode-default evidence entry, oracle test / result fail, verbose log attached); spec DD-5.
Dimensions: D-FUNC, D-REGRESSION
Scope-Alt: the packaged-mode counterpart assertion may be deferred; restoring `--dev` on the existing assertions is the non-negotiable part.
Covers: (regression guard supporting AC-F5A-5; no new spec AC)

Known flakiness caveat (verify before trusting a green): the T3 implementer observed this same file intermittently reporting "2 pass 0 fail" in ~2s — too fast to have executed its 15s descendant-polling logic. A sub-3s pass is NOT evidence of correctness. Assert the run actually exercised the polling path (elapsed time or an explicit descendant-count assertion), and report the observed wall time in evidence.

AC:
- Given the merged packaged-mode default, When `cd packages/lore && bun test tests/integration/cli/dashboard-sigterm.bun.test.ts` runs, Then exit 0 with matched-count > 0 AND the run's wall time is consistent with the polling logic actually executing (report it in evidence; a sub-3s "pass" must be investigated, not accepted).
- Given the fix, When the test file is read, Then every `spawnDashboard` invocation asserting vite-child behavior passes `--dev` explicitly — no assertion depends on packaged mode spawning descendants.
