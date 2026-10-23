---
id: TASK-1886
type: task
role: plan
title: "[Skill:investigate] TG-49 fts-query failed once at the isolation probe in a full run (child env lacked LORE_TEST_SANDBOX) — find the main-process env mutation"
status: archived
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: M
Approach: In the clean full `bun run test` at 8f5ac21a (2026-10-19, log scratchpad/full-suite-8f5ac21a.log) packages/lore/tests/unit/store/fts-query.test.ts failed at the per-file isolation probe (scripts/test-isolation-setup.ts -> assertChildrenInheritSandbox): "a child spawned with no explicit env saw LORE_TEST_SANDBOX=\"\" and LORE_TEST_SANDBOX_REPO=null". A peer session re-ran the file alone 3x in a fresh worktree: 40/40 each time — non-deterministic. With isolate on (fork per file) another file cannot leak env into it, so the fork's STARTUP env lacked the sandbox vars: suspect the main vitest process's env being mutated mid-run (globalSetup, a reporter, scripts/run-tests.ts, or a setup that deletes/overrides process.env). Find the mutation (grep for writes to process.env / delete process.env in scripts/ and vitest config/globalSetup; reproduce by running the full bun-runtime project, or a subset that includes the mutating file before fts-query) and fix at root. Three green runs do not clear a flaky oracle (AS-17): prove the cause by making it fail deterministically first.
Source: full suite 2026-10-19 + peer reproduction
AC: a deterministic red reproduction recorded, the root cause named (file:line), fixed; the reproduction green.
