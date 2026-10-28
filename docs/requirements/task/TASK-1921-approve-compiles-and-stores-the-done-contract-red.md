---
id: TASK-1921
type: task
role: plan
title: "Approve compiles and stores the done-contract; --red-waiver; a contract-less approved task is completed by approve (AC-DCS1-1, 2, 5)"
status: draft
priority: high
phase: "P1 Implementation, tests first"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1916, type: blocks}
  - {id: TASK-1956, type: supersedes}
---
Covers: AC-DCS1-1, AC-DCS1-2, AC-DCS1-5. Writes the tests of its criteria in `done-contract-approve-compiled.bun.test.ts` (created by A, extended by B) and records the whole-file pass.
TDD-Role: red then green, tests first in this task
Approach: `done-contract-compile.ts` is pure: `compileDoneContract(input): Result<DoneContract, DoneContractRefusal>` collects every cause (`no-kind`, `no-typecheck`, `no-install`, `no-test-command`, `base-branch-absent`, `no-oracle` for a check task only, `kind-anchor`, `ac-unresolved`, `falsifier-literal-absent`) before returning, adds the oracle `corpus:files-unchanged` to every corpus contract, and reuses `definitionOfDone` and the anchored-test predicate from `task-workflow-service.ts` by import (invariant I1: no second copy). `ac-unresolved` resolves an ac_scope id against every spec the plan is parented to or implements. `done-contract-service.ts` gathers the inputs (plan, specs, config, the tip of the base branch and whether it exists, the falsifier file at that commit) through ports, is the sole writer of `extra.done_contract`, and implements both the approve hook and the contract-less approve of AC-DCS1-5. `ReviewService.approve` calls it for a task after the transition and override checks and before the write, so a refusal writes nothing; `app.ts` constructs it and passes it in at every composition site (the AC runs through the compiled command). `lore approve` gains `--red-waiver` (blank reason: usage exit 2; the value is stored verbatim as `red_waiver_reason`). `lore claim` prints the stored contract (BR-1357) instead of the recomputed definition of done.
Tests first, in this task and this worktree (D33: no separate red task and no pass row that proves nothing). Under TODAY's rules: (1) write the tests of your owned criteria in `packages/lore/tests/e2e/done-contract-approve-compiled.bun.test.ts` (each test name starts with `AC-DCS1-<n>:` with the colon, so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10; each asserts every item of its criterion through the compiled `dist/lore` on a throwaway repo and corpus, `makeCleanTreeRepo`, `patchLoreConfig`, `FIXTURE_HOME_OUTSIDE_REPO`, never this repository's own `.lore/`: exact exit code, refusal name, stored data, and the criterion's own false-green case) and commit them; (2) capture the red of every owned AC command with `lore evidence <task> --oracle test --command "<the AC command>" --result expected-fail --capture` (BR-1077: the runner summary must show failed tests; a run that could not start is not a red); (3) implement; (4) `lore verify` each owned AC; (5) record an attested UNFILTERED whole-file pass of `packages/lore/tests/e2e/done-contract-approve-compiled.bun.test.ts` (`lore evidence <task> --oracle test --command "bun run test:file packages/lore/tests/e2e/done-contract-approve-compiled.bun.test.ts" --result pass --capture`, no `-t`). The file holds only the tests of the tasks before and including this one, so it passes whole at every task's tip. The MCP server no longer exists: no test may start it. Every stored falsifier literal named below must occur exactly once in its file (the falsifier replaces the first occurrence only).
The code must contain these statements exactly once: in `done-contract-compile.ts` `red_required: kind === "code" && redWaiverReason === undefined,` and `if (causes.length > 0) return err(uncompilable(causes));`; in `done-contract-service.ts` `if (contractExists) return err(contractAlreadyStored(task));`; in `approve.ts` the option key `"red-waiver": {`.
Done when: AC-DCS1-1, 2, 5 pass and are attested; its test file passes unfiltered and is recorded; typecheck passes; the anchored files contain no second copy of a done predicate.
