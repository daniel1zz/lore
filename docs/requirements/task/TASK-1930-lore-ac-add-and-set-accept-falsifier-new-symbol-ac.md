---
id: TASK-1930
type: task
role: plan
title: "lore ac add and set accept --falsifier-new-symbol (AC-DCS1-3)"
status: draft
priority: high
phase: "P1 Implementation, tests first"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1921, type: blocks}
---
Covers: AC-DCS1-3
TDD-Role: red then green, tests first in this task
Approach: `verify.falsifier` gains an optional boolean `new_symbol` in `acceptance.ts`; `lore ac add` and `lore ac set` get `--falsifier-new-symbol`, valid only together with the four `--falsifier-*` flags (usage exit 2 naming them otherwise); `ac-service.ts` stores it only when passed (`lore ac set` replaces the whole falsifier object, so a set without the flag clears it) and `lore ac list` prints it.
Tests first, in this task and this worktree (D33: no separate red task and no pass row that proves nothing). Under TODAY's rules: (1) write the tests of your owned criteria in `packages/lore/tests/e2e/done-contract-approve-compiled.bun.test.ts` (each test name starts with `AC-DCS1-<n>:` with the colon, so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10; each asserts every item of its criterion through the compiled `dist/lore` on a throwaway repo and corpus, `makeCleanTreeRepo`, `patchLoreConfig`, `FIXTURE_HOME_OUTSIDE_REPO`, never this repository's own `.lore/`: exact exit code, refusal name, stored data, and the criterion's own false-green case) and commit them; (2) capture the red of every owned AC command with `lore evidence <task> --oracle test --command "<the AC command>" --result expected-fail --capture` (BR-1077: the runner summary must show failed tests; a run that could not start is not a red); (3) implement; (4) `lore verify` each owned AC; (5) record an attested UNFILTERED whole-file pass of `packages/lore/tests/e2e/done-contract-approve-compiled.bun.test.ts` (`lore evidence <task> --oracle test --command "bun run test:file packages/lore/tests/e2e/done-contract-approve-compiled.bun.test.ts" --result pass --capture`, no `-t`). The file holds only the tests of the tasks before and including this one, so it passes whole at every task's tip. The MCP server no longer exists: no test may start it. Every stored falsifier literal named below must occur exactly once in its file (the falsifier replaces the first occurrence only).
The code must contain the exact text `? { new_symbol: true } : {}` once in `ac-service.ts`.
Done when: AC-DCS1-3 passes and is attested; typecheck passes.
