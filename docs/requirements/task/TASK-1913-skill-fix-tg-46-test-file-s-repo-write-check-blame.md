---
id: TASK-1913
type: task
role: plan
title: "[Skill:fix] TG-46 test:file's repo-write check blames the test run for a concurrent session's edit (fails a 35/35 green run) — attribute writes to the run's own processes"
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
Approach: bun run test:file fails a green run with "a test run created or modified 1 file(s) in the repository tree: packages/lore/tests/fixtures/design-necessity/end-state-spec.md" (main 2026-10-18, after TG-45 merge: 35/35 tests passed, exit 1). No test references that file (grep finds no reader); another session was editing it in the shared checkout (mtime 17 s before the check). The tree-write detector compares the tree before/after the run, so any concurrent session's edit is attributed to the tests — a check that holds only with one session per checkout, which the North Star refuses ("an answer relying on exclusivity is a refusal of the target state"). End state: a write is attributed to the test run only when the run's own processes made it (e.g. run the tests with the repo tree mounted/copied read-only or with a per-run write tracer, or attribute by the writing process tree), so a concurrent session's edit never fails a run and a real test write still does. Design-necessity: no allowlist of "peer files", no retry.
Red-first: a test run during which a separate process (not a child of the run) edits a tracked file -> today exit 1 naming it (red); after: exit 0. Control: a test that writes a repo file still fails exit 1 naming it.
Source: TG-45 merge verification 2026-10-18
AC: both halves green; scripts/test-file.ts and run-chain consumers green.
