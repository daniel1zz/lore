---
id: TASK-1925
type: task
role: plan
title: "A claim declares its write set; overlap, oracle additions and edit-time declares use it (AC-DCS1-10..12)"
status: draft
priority: high
phase: "P1 Implementation, tests first"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1915, type: blocks}
  - {id: TASK-1953, type: supersedes}
---
Covers: AC-DCS1-10, AC-DCS1-11, AC-DCS1-12.
TDD-Role: red then green, tests first in this task
Approach: the claim record in `packages/core/src/task-workflow.ts` gains `write_set` and exports `effectiveWriteSet(task)` (the claim's write set, else the approved anchors). Both overlap computations call it: the sibling-claim context of the claim gate (`SiblingClaimInfo.anchors` is filled from it in `checkpoint-registry.ts`/`gate-predicates.ts`) and the ready report's anchor-conflict computation in `TaskWorkflowService` (the loop around `anchorsOverlap(taskAnchors, otherAnchors)`); BR-130's ad-hoc clause stays. `lore claim` takes `--write-set` (repeatable) and writes it on the claim. The oracle additions are the test files of the write set (a file entry, or a file under a directory entry) that the claim's branch changed since its start commit and the contract does not run; `mergeAddedOracles` in `done-contract-service.ts` merges them (union only, never removes) and `release()` and `endRunClaims()` write them in the same corpus write as the release; `done()` derives them again while the claim exists. `declareEditPath` in `edit-scope.ts` appends to the claim's write set through a new `deps.addToWriteSet` (not to the task's `file_anchors`, so the 50-anchor cap is untouched); `EditScopeDeps` keeps `addAnchors` (the stored falsifier of AC-DCS1-12 redirects the call to it); `readEditScope` and `lore anchor scope --json` report the write set.
Tests first, in this task and this worktree (D33: no separate red task and no pass row that proves nothing). Under TODAY's rules: (1) write the tests of your owned criteria in `packages/lore/tests/e2e/done-contract-write-set-compiled.bun.test.ts` (each test name starts with `AC-DCS1-<n>:` with the colon, so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10; each asserts every item of its criterion through the compiled `dist/lore` on a throwaway repo and corpus, `makeCleanTreeRepo`, `patchLoreConfig`, `FIXTURE_HOME_OUTSIDE_REPO`, never this repository's own `.lore/`: exact exit code, refusal name, stored data, and the criterion's own false-green case) and commit them; (2) capture the red of every owned AC command with `lore evidence <task> --oracle test --command "<the AC command>" --result expected-fail --capture` (BR-1077: the runner summary must show failed tests; a run that could not start is not a red); (3) implement; (4) `lore verify` each owned AC; (5) record an attested UNFILTERED whole-file pass of `packages/lore/tests/e2e/done-contract-write-set-compiled.bun.test.ts` (`lore evidence <task> --oracle test --command "bun run test:file packages/lore/tests/e2e/done-contract-write-set-compiled.bun.test.ts" --result pass --capture`, no `-t`). The file holds only the tests of the tasks before and including this one, so it passes whole at every task's tip. The MCP server no longer exists: no test may start it. Every stored falsifier literal named below must occur exactly once in its file (the falsifier replaces the first occurrence only).
The code must contain these statements exactly once: in `core/src/task-workflow.ts` `return claim.write_set ?? extractFileAnchors(task);`; in `done-contract-service.ts` `added_oracles: mergeAddedOracles(contract.added_oracles, additions),`; in `edit-scope.ts` `const written = await deps.addToWriteSet(input.task, [rel], {`.
Done when: AC-DCS1-10, 11, 12 pass and are attested; its test file `packages/lore/tests/e2e/done-contract-write-set-compiled.bun.test.ts` passes unfiltered and is recorded; typecheck passes; `lore anchor declare` of 60 paths leaves `file_anchors` unchanged.
