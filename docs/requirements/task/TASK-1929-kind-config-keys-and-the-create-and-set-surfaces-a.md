---
id: TASK-1929
type: task
role: plan
title: "Task kind, config keys and the create and set surfaces (AC-DCS1-4, 9)"
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
  - {id: TASK-1930, type: blocks}
---
Covers: AC-DCS1-4, AC-DCS1-9
TDD-Role: red then green, tests first in this task
This task also creates the shared fixture `packages/lore/tests/helpers/done-contract-fixture.ts` used by every later task (throwaway repo, corpus, spec, plans with and without an integration branch, tasks of each kind, the three config keys, and `seedApprovedTaskWithoutContract`: an approved task with no contract, written in-process without an approval port; the other half of every contract-less case of AC-DCS1-2, 5, 7, 14, 22; it is a helper, not a test file, so it carries no whole-file floor). Its tests also seed a passing milestone review where a plan is closed (AC-DCS1-8, task D).
Approach: new `packages/core/src/done-contract.ts` exports `TASK_KINDS = ["code", "check", "corpus"] as const`, the `TaskKind` type and `doneContractSchema` (zod; fields in the spec Design section); `taskExtraSchema` gains an optional `kind`. `lore create task` gets `--kind` (required for a task, usage exit 2 through `checkTaskCreateRequiredFlags`, which names all missing flags in one message); the existing spec-only `--kind` keeps its meaning for specs. `lore set <task> --kind` is accepted on a draft task. `DEDICATED_EXTRA_KEYS` gains a `task` entry for `done_contract` and one for `kind` that applies unless the task is a draft (new optional field `unlessStatus`), so `CorpusService.set` (the CLI and the HTTP edit route both reach it) refuses a wholesale change with refusal `kind-locked` / `done-contract-locked` (exit 4) naming the writer verb. Other creation paths (`lore issue adopt`, the HTTP create route) stay kind-less on purpose: approve refuses them with `no-kind` (task C). `config.ts` gains `workflow.done_contract.{install,typecheck,test_file}` (non-empty strings; `test_file` must contain `{file}`); `assets/project/lore-config-template.yaml` and this repository's `.lore/config.yaml` set the three keys (values in AC-DCS1-9). `red_first` stays in the schema as a legacy key that nothing reads (task D stops reading it).
Tests first, in this task and this worktree (D33: no separate red task and no pass row that proves nothing). Under TODAY's rules: (1) write the tests of your owned criteria in `packages/lore/tests/e2e/done-contract-approve-compiled.bun.test.ts` (each test name starts with `AC-DCS1-<n>:` with the colon, so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10; each asserts every item of its criterion through the compiled `dist/lore` on a throwaway repo and corpus, `makeCleanTreeRepo`, `patchLoreConfig`, `FIXTURE_HOME_OUTSIDE_REPO`, never this repository's own `.lore/`: exact exit code, refusal name, stored data, and the criterion's own false-green case) and commit them; (2) capture the red of every owned AC command with `lore evidence <task> --oracle test --command "<the AC command>" --result expected-fail --capture` (BR-1077: the runner summary must show failed tests; a run that could not start is not a red); (3) implement; (4) `lore verify` each owned AC; (5) record an attested UNFILTERED whole-file pass of `packages/lore/tests/e2e/done-contract-approve-compiled.bun.test.ts` (`lore evidence <task> --oracle test --command "bun run test:file packages/lore/tests/e2e/done-contract-approve-compiled.bun.test.ts" --result pass --capture`, no `-t`). The file holds only the tests of the tasks before and including this one, so it passes whole at every task's tip. The MCP server no longer exists: no test may start it. Every stored falsifier literal named below must occur exactly once in its file (the falsifier replaces the first occurrence only).
The code must contain these statements exactly once: in `create-task-validation.ts` the line `if (kind === undefined || kind === "") missing.push("kind");` inside `checkTaskCreateRequiredFlags`; in `config.ts` the line `typecheck: z.string().min(1).optional(),`.
Done when: AC-DCS1-4 and AC-DCS1-9 commands pass and `lore verify` attests each; typecheck passes; a search of `packages/lore/src` and `packages/core/src` finds no other task-creating call that the CLI reaches without a kind.
