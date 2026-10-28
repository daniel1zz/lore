---
id: TASK-1927
type: task
role: plan
title: "Check and corpus kinds finish in the shared checkout and are archived on contract rows (AC-DCS1-19..21)"
status: draft
priority: high
phase: "P1 Implementation, tests first"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1928, type: blocks}
  - {id: TASK-1950, type: supersedes}
---
Covers: AC-DCS1-19, AC-DCS1-20, AC-DCS1-21.
TDD-Role: red then green, tests first in this task
Approach: `task-finish-service.ts` gains the check/corpus branch. The shared checkout is the main working copy (git dir equals common dir), detached at main's tip (BR-1342): refuse `not-shared-checkout` from a linked worktree, `head-not-main-tip` when HEAD is not the tip of `main` (the message names `git checkout --detach main`, which BR-1342 does not refuse), and `shared-checkout-dirty` when `git status --porcelain` (ignored paths excluded) is not empty, all before running anything; read the task and its `version` once; run the contract's AC oracles at that commit; compare `git status --porcelain` again and refuse `kind-wrote-files` naming only the paths changed during the run; for a corpus task record the row of `corpus:files-unchanged` once that comparison passes; write all rows in one corpus write with `expectedVersion: task.version` (a stale write is exit 5 and records nothing). `TaskWorkflowService` counts, for a task whose contract kind is check or corpus, a runner pass at a main commit that contains `contract.compiled_at_commit` toward the attested-pass and contract-oracles floors (`landing-evidence.ts` holds the shared measure), ignores a legacy no-branch claim, and `done()` releases it.
Tests first, in this task and this worktree (D33: no separate red task and no pass row that proves nothing). Under TODAY's rules: (1) write the tests of your owned criteria in `packages/lore/tests/e2e/done-contract-check-corpus-compiled.bun.test.ts` (each test name starts with `AC-DCS1-<n>:` with the colon, so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10; each asserts every item of its criterion through the compiled `dist/lore` on a throwaway repo and corpus, `makeCleanTreeRepo`, `patchLoreConfig`, `FIXTURE_HOME_OUTSIDE_REPO`, never this repository's own `.lore/`: exact exit code, refusal name, stored data, and the criterion's own false-green case) and commit them; (2) capture the red of every owned AC command with `lore evidence <task> --oracle test --command "<the AC command>" --result expected-fail --capture` (BR-1077: the runner summary must show failed tests; a run that could not start is not a red); (3) implement; (4) `lore verify` each owned AC; (5) record an attested UNFILTERED whole-file pass of `packages/lore/tests/e2e/done-contract-check-corpus-compiled.bun.test.ts` (`lore evidence <task> --oracle test --command "bun run test:file packages/lore/tests/e2e/done-contract-check-corpus-compiled.bun.test.ts" --result pass --capture`, no `-t`). The file holds only the tests of the tasks before and including this one, so it passes whole at every task's tip. The MCP server no longer exists: no test may start it. Every stored falsifier literal named below must occur exactly once in its file (the falsifier replaces the first occurrence only).
The code must contain these statements exactly once: in `task-workflow-service.ts` `containsCommit(row.head_sha, contract.compiled_at_commit)`; in `task-finish-service.ts` `expectedVersion: task.version` and `if (changedFiles.length > 0) return err(kindWroteFiles(changedFiles));`.
Done when: AC-DCS1-19, 20, 21 pass and are attested; its test file `packages/lore/tests/e2e/done-contract-check-corpus-compiled.bun.test.ts` passes unfiltered and is recorded; typecheck passes; no worktree is created by any check or corpus path.
