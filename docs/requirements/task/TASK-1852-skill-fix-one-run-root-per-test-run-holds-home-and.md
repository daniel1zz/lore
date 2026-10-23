---
id: TASK-1852
type: task
role: plan
title: "[Skill:fix] One run root per test run holds HOME and TMPDIR; removed by its run, or by the next run once its pid is gone"
status: archived
priority: medium
phase: "P1"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-234
plan: PLAN-234
---
Implements plan-test-runs-own-their-temp-dir-one-run-root-holds-home-and — read the plan (`lore get plan-test-runs-own-their-temp-dir-one-run-root-holds-home-and`): cause with file:line, design D1-D3, what was not chosen, acceptance. Governing spec: spec-process-state-end-state-one-invocation-per-entry-returned Goal 5.

Key code: vitest.shared.ts (armSandboxEnv :15, armThrowawayHome :35-48, the process.once("exit") removal), scripts/run-tests.ts:51-55 (two vitest invocations: Bun runtime and vitest.node.config.ts), vitest.node.config.ts, scripts/test-global-setup.ts (leave its tree checks alone).

Review note to honour: only the run that CREATED the root registers the exit handler that removes it; a nested run that reuses the parent's root via LORE_TEST_THROWAWAY_HOME must never remove it. Root path: realpath(original tmpdir)/lore-test-runs/<pid>-<random>/ with home/ and tmp/. Set TMPDIR, TMP and TEMP. Do not add rm calls to individual tests and do not remove existing ones.

Oracle (red first on current code, then green): scripts/tests/test-run-root.test.ts (or similar) that spawns vitest runs (both runtimes) over a small selection including packages/lore/tests/unit/core/global-config.test.ts, packages/lore/tests/unit/adapters/http/auth-routes.bun.test.ts and one hook-harness test, with TMPDIR of the OUTER test pointed at a fresh mkdtemp so the count is measured there, asserting: no new lore-*/turn-* entries, lore-test-runs/ empty afterwards; SIGKILL case: a killed run's root is removed by the next run; a root whose pid is alive is kept. Record with `lore evidence <task> --oracle test --result pass --capture --command "<exact command>"` and tsc via `--oracle tsc --capture --result pass --command "bun run typecheck"`.
