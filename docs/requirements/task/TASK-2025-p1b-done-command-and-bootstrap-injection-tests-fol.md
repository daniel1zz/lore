---
id: TASK-2025
type: task
role: plan
title: "P1b done-command and bootstrap-injection tests follow BR-1379"
status: archived
priority: medium
phase: "P"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
---
Two tests on main (cf2b5a49) went red with P1 (BR-1379: a task transition writes its plan's extra.progress in the same transaction; archived plans refuse new or reopened tasks). P1's scoped run did not cover tests/e2e or tests/unit/cli.

- packages/lore/tests/unit/cli/done-command.test.ts, "STATE: ... done never writes the plan": expected plan version 4, got 5. Under BR-1379 done writes the plan's progress. The assertion becomes: the plan's status is unchanged and the only plan change is extra.progress (state, open, total match the task rows).
- packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, AC-097-4 archive_candidates injection: a lore command exits 4 (expected 0). Find which fixture step BR-1379 now refuses (likely a task created or moved under an already-archived plan) and fix the fixture to follow BR-1379 (create tasks before archiving the plan), keeping what the test proves.

Repro: bun run test:file packages/lore/tests/unit/cli/done-command.test.ts packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts → 2 files failed.
