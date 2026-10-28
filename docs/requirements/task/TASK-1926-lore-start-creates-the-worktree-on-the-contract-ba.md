---
id: TASK-1926
type: task
role: plan
title: "lore start creates the worktree on the contract base, installs, claims and prints the contract (AC-DCS1-13, 14)"
status: draft
priority: high
phase: "P1 Implementation, tests first"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1927, type: blocks}
  - {id: TASK-1942, type: supersedes}
---
Covers: AC-DCS1-13, AC-DCS1-14.
TDD-Role: red then green, tests first in this task
Approach: `task-start-service.ts` (new): check the lease first (BR-1040, through the claim service's conflict check, exit 5), then `not-approved`, `no-contract`, `use-finish`, `worktree-exists` (the default path or branch exists; nothing is removed) and `worktree-path-not-ignored` (`git check-ignore` on the path); then `git worktree add -b task/<task-slug> <repo>/.claude/worktrees/<task-slug> <contract.base_branch>`, run the contract `install` command inside it, claim through `TaskWorkflowService.claim` with the worktree and branch (and any repeatable `--write-set`), print the contract with the additions already persisted. Any failure after the worktree exists calls `removeStartWorktree(worktreePath, branch)` (plain `git worktree remove` and `git branch -d`, never forced; only what this run created) and stores nothing. `refuseFirstClaimOffMain` (BR-1353 as modified) counts only the commits that are neither on main nor on the integration branch the task's plan declares (`git rev-list --count HEAD ^main ^<plan integration branch>`), because a worktree cut at that branch's tip carries the earlier tasks' commits and today's rule refuses it; `claim()` also refuses a code claim on the plan's integration branch or on a branch another live claim records (`shared-branch`, exit 4), a code task claimed without a branch (`work-needs-branch`, exit 4), a check or corpus task (`kind-has-no-claim`, exit 4, naming `lore finish`) and an approved task with no contract (`no-contract`, exit 4, naming `lore migrate done-contract` and `lore approve`). `commands/start.ts` registers the verb in `adapters/cli/index.ts`; `app.ts` constructs the service; the base tip is read through `plan-integration-branch-service.ts`.
Tests first, in this task and this worktree (D33: no separate red task and no pass row that proves nothing). Under TODAY's rules: (1) write the tests of your owned criteria in `packages/lore/tests/e2e/done-contract-start-compiled.bun.test.ts` (each test name starts with `AC-DCS1-<n>:` with the colon, so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10; each asserts every item of its criterion through the compiled `dist/lore` on a throwaway repo and corpus, `makeCleanTreeRepo`, `patchLoreConfig`, `FIXTURE_HOME_OUTSIDE_REPO`, never this repository's own `.lore/`: exact exit code, refusal name, stored data, and the criterion's own false-green case) and commit them; (2) capture the red of every owned AC command with `lore evidence <task> --oracle test --command "<the AC command>" --result expected-fail --capture` (BR-1077: the runner summary must show failed tests; a run that could not start is not a red); (3) implement; (4) `lore verify` each owned AC; (5) record an attested UNFILTERED whole-file pass of `packages/lore/tests/e2e/done-contract-start-compiled.bun.test.ts` (`lore evidence <task> --oracle test --command "bun run test:file packages/lore/tests/e2e/done-contract-start-compiled.bun.test.ts" --result pass --capture`, no `-t`). The file holds only the tests of the tasks before and including this one, so it passes whole at every task's tip. The MCP server no longer exists: no test may start it. Every stored falsifier literal named below must occur exactly once in its file (the falsifier replaces the first occurrence only).
The code must contain these statements exactly once: in `task-start-service.ts` `["worktree", "add", "-b", branch, worktreePath, contract.base_branch]` and `await removeStartWorktree(worktreePath, branch);`.
Done when: AC-DCS1-13 and AC-DCS1-14 pass and are attested; its test file `packages/lore/tests/e2e/done-contract-start-compiled.bun.test.ts` passes unfiltered and is recorded; typecheck passes.
