---
id: TASK-1916
type: task
role: plan
title: "lore done and plan close read the stored contract; retire --declare-no-new-tests and lore red-first (AC-DCS1-6..8)"
status: draft
priority: high
phase: "P1 Implementation, tests first"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1925, type: blocks}
---
Covers: AC-DCS1-6, AC-DCS1-7, AC-DCS1-8.
TDD-Role: red then green, tests first in this task
Approach: `TaskWorkflowService` evaluates the floors from one function `evaluateStoredContractFloors(task, evidence)` fed by the stored contract plus `added_oracles`; `checkDoneFloors`, `done()`, the plan-close cascade and `lore archive --apply` all reach it (they already share `checkDoneFloors` through the done-floor port). The `ac:` oracles use the AC's current live command by id. The floor order is the constant `DONE_FLOOR_ORDER = ["no-contract", "finish-stale", "attested-pass", "latest-attested-fail", "red-first", "unfiltered-test-file", "contract-oracles", "not-landed", "missing-oracle-file", "foreign-claim"]`; `DoneFloorId` gains `no-contract`, `finish-stale` (the check itself is built by F; the floor sits second in the order of BR-209), `contract-oracles` and `foreign-claim` and loses `no-new-tests`. Delete `requiresNoNewTestsDeclaration`, `noNewTestsReason`, `readRedFirstDeclared` and `declareRedFirst` (the red requirement is the contract's), the `--declare-no-new-tests` option of `done.ts`, the whole `red-first.ts` command and its registry entry in `adapters/cli/index.ts`; `approve.ts` is anchored here because AC-DCS1-6 mutates it (it must not offer `--declare-no-new-tests`). The generic strict-flag exit 2 and the unknown-command exit 1 follow. `done()` releases the unfinished claim on success. Update the refusal text in `gate-predicates.ts` and `packages/core/src/issue-report.ts` that names the retired flag.
Tests first, in this task and this worktree (D33: no separate red task and no pass row that proves nothing). Under TODAY's rules: (1) write the tests of your owned criteria in `packages/lore/tests/e2e/done-contract-done-floors-compiled.bun.test.ts` (each test name starts with `AC-DCS1-<n>:` with the colon, so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10; each asserts every item of its criterion through the compiled `dist/lore` on a throwaway repo and corpus, `makeCleanTreeRepo`, `patchLoreConfig`, `FIXTURE_HOME_OUTSIDE_REPO`, never this repository's own `.lore/`: exact exit code, refusal name, stored data, and the criterion's own false-green case) and commit them; (2) capture the red of every owned AC command with `lore evidence <task> --oracle test --command "<the AC command>" --result expected-fail --capture` (BR-1077: the runner summary must show failed tests; a run that could not start is not a red); (3) implement; (4) `lore verify` each owned AC; (5) record an attested UNFILTERED whole-file pass of `packages/lore/tests/e2e/done-contract-done-floors-compiled.bun.test.ts` (`lore evidence <task> --oracle test --command "bun run test:file packages/lore/tests/e2e/done-contract-done-floors-compiled.bun.test.ts" --result pass --capture`, no `-t`). The file holds only the tests of the tasks before and including this one, so it passes whole at every task's tip. The MCP server no longer exists: no test may start it. Every stored falsifier literal named below must occur exactly once in its file (the falsifier replaces the first occurrence only).
The code must contain these statements exactly once: in `task-workflow-service.ts` the two adjacent array elements `"red-first", "unfiltered-test-file"` of `DONE_FLOOR_ORDER` and the statement `return this.evaluateStoredContractFloors(task, evidence);` ending `checkDoneFloors`.
Done when: AC-DCS1-6, 7, 8 pass and are attested; its test file `packages/lore/tests/e2e/done-contract-done-floors-compiled.bun.test.ts` passes unfiltered and is recorded; typecheck passes; no file under `packages/lore/src` or `packages/core/src` names `--declare-no-new-tests`, `noNewTestsReason` or `declare_no_new_tests` (a search shows it; the P3 tasks fix the tests).
