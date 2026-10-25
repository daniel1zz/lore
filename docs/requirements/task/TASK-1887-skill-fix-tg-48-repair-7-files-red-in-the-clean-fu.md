---
id: TASK-1887
type: task
role: plan
title: "[Skill:fix] TG-48 repair 7 files red in the clean full run at 8f5ac21a (golden, memory-file size, status key pin, nul-bytes inputs, setup marker, two wall-clock asserts)"
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
Approach: Full `bun run test` at main 8f5ac21a in an isolated worktree (2026-10-19, no concurrent merges): 8 files / 16 tests red, 1300 s wall. Full log: /private/tmp/claude-501/-Users-apple-Projects-zz-lore/c1ffea04-89c5-46f4-8bb9-0d10906f3f65/scratchpad/full-suite-8f5ac21a.log. Fix at root, one per file:
(1) packages/lore/tests/unit/context-fragments/fragment-variables.test.ts — golden packages/lore/tests/fixtures/context-variables/pre-change-rules/worktree-dispatch.md was not updated when INT-T3 changed assets/context/worktree-dispatch.md; regenerate it through the real renderer (the golden pins "expansion with no variables == plain render", so it follows fragment text).
(2) packages/lore/tests/unit/service/claude-md-eviction-floor.test.ts — packages/lore/src/service/CLAUDE.md (14802 B) and packages/lore/src/store/CLAUDE.md (14800 B) exceed the advisory 14746 after MI-T2 lengthened their Purpose first sentences; shorten without losing a rule (index scope keywords must stay in the first sentence).
(3) packages/lore/tests/e2e/baseline-slice2-rollback.bun.test.ts — status key list has 28 vs pinned 27: find which key was added (TG-44 exemptions_satisfied was already added; find the new one by diffing) and whether the pin or the addition is wrong.
(4) scripts/tests/check-no-nul-bytes.test.ts — UndeclaredTestInputError on the real-tree case: a newly tracked path (likely hooks/reference-transaction from INT-T4) is read but not declared; fix the declaration at its root (the test reads every tracked file — its @reads must cover the tracked tree by rule, not a list).
(5) packages/lore/tests/integration/setup-user-once-marker.bun.test.ts — expected true got false (x2); find the cause.
(6) packages/lore/tests/integration/prd-budget-check.bun.test.ts asserts elapsedMs < 1000 (got 1305) and packages/dashboard/tests/unit/typecheck-scope.test.ts timed out at 30 s: wall-clock assertions under a full parallel run — report whether they measure the product or the machine; do not bump limits; if the assertion is about machine speed, propose the right oracle (TG-40 owns suite time).
Not yours: packages/lore/tests/unit/store/fts-query.test.ts (test-isolation env, another session's ES work) — skip.
Source: full suite 2026-10-19
AC: files (1)-(5) green; (6) reported with a decision; bun run test:file over the 7 files.
