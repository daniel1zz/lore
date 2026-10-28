---
id: TASK-1928
type: task
role: plan
title: "lore migrate done-contract compiles contracts for in-flight tasks, preview first (AC-DCS1-22, 23)"
status: draft
priority: high
phase: "P1 Implementation, tests first"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1920, type: blocks}
  - {id: TASK-1919, type: blocks}
  - {id: TASK-1918, type: blocks}
  - {id: TASK-1943, type: supersedes}
  - {id: TASK-1917, type: blocks}
---
Covers: AC-DCS1-22, AC-DCS1-23.
TDD-Role: red then green, tests first in this task
Approach: `done-contract-migration-service.ts` (new) lists approved and active tasks without a stored contract, infers the kind (file anchors or any claim that named a branch give code; otherwise check when `ac_scope` holds a script-mode AC, else corpus) and calls the SAME `compileDoneContract` as approve (through `done-contract-service.ts`, which stores it with the inferred kind in one write per task). A code task with a claim or evidence row and no runner-produced red row is listed `needs-red-waiver` with the command `lore approve <slug> --red-waiver "<reason>"` and not stored. `migrate.ts` gains the `done-contract` action (`--apply`, preview default, exit 0 or 4 as AC-DCS1-22 and 23 say); `app.ts` constructs the service.
Tests first, in this task and this worktree (D33: no separate red task and no pass row that proves nothing). Under TODAY's rules: (1) write the tests of your owned criteria in `packages/lore/tests/e2e/done-contract-migrate-compiled.bun.test.ts` (each test name starts with `AC-DCS1-<n>:` with the colon, so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10; each asserts every item of its criterion through the compiled `dist/lore` on a throwaway repo and corpus, `makeCleanTreeRepo`, `patchLoreConfig`, `FIXTURE_HOME_OUTSIDE_REPO`, never this repository's own `.lore/`: exact exit code, refusal name, stored data, and the criterion's own false-green case) and commit them; (2) capture the red of every owned AC command with `lore evidence <task> --oracle test --command "<the AC command>" --result expected-fail --capture` (BR-1077: the runner summary must show failed tests; a run that could not start is not a red); (3) implement; (4) `lore verify` each owned AC; (5) record an attested UNFILTERED whole-file pass of `packages/lore/tests/e2e/done-contract-migrate-compiled.bun.test.ts` (`lore evidence <task> --oracle test --command "bun run test:file packages/lore/tests/e2e/done-contract-migrate-compiled.bun.test.ts" --result pass --capture`, no `-t`). The file holds only the tests of the tasks before and including this one, so it passes whole at every task's tip. The MCP server no longer exists: no test may start it. Every stored falsifier literal named below must occur exactly once in its file (the falsifier replaces the first occurrence only).
The code must contain these statements exactly once: in `done-contract-migration-service.ts` `hasScriptAc ? "check" : "corpus"` and `if (uncompilableWithLiveClaim.length > 0) return err(liveClaimUncompilable(uncompilableWithLiveClaim));`.
Done when: AC-DCS1-22 and AC-DCS1-23 pass and are attested; its test file `packages/lore/tests/e2e/done-contract-migrate-compiled.bun.test.ts` passes unfiltered and is recorded; typecheck passes.
