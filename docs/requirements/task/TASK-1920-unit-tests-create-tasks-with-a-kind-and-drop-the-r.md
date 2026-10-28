---
id: TASK-1920
type: task
role: plan
title: "Unit tests create tasks with a kind and drop the retired flag, floor names and red-first declaration"
status: draft
priority: high
phase: "P2 Migration and foreign-criteria corrections"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1923, type: blocks}
  - {id: TASK-1917, type: blocks}
---
Covers: no criterion of this spec; keeps the tests of approved criteria of other specs true (AC-AP-4, AC-AP-5, AC-AP-9, AC-S3-2, AC-S3-3, AC-P-3 and every unit test that creates a task through the CLI).
TDD-Role: fixture
Approach: a mechanical correction of `packages/lore/tests/unit/` (directory anchor; K's file `shipped-done-contract-text.test.ts` is not touched): (1) every `create task` run through the CLI states `--kind code` (or `check`/`corpus` where the fixture has no file anchors); (2) tests of the retired surfaces are deleted or rewritten: `cli-red-first-writer.bun.test.ts`, the `--declare-no-new-tests` cases of `cli-done-attestation-escape-hatch.bun.test.ts`, `cli-done-attestation-cite-escape-hatch.bun.test.ts`, `no-new-tests-floor-empty-scope.test.ts`, `done-attestation-refusal-wording.test.ts`; (3) the floor-id fixtures of `check-done-floors.test.ts` and `plan-close-cascade-plan-membership.test.ts` use `no-contract` and `contract-oracles` instead of `no-new-tests` and a red-first declaration (AC-AP-4, 5, 9 as corrected by J4); (4) the claim-gate tests (`claim-anchor-gate.test.ts`, `phase-claim-gate.test.ts`) keep their cases and gain one case for a write set; (5) tests that approve a task through a wired `ReviewService` give it a kind and the three config keys; (6) a search of the tree for MCP tool tests that the removal of the server left behind finds none to touch.
Under TODAY's rules (the done walk of `lore integrate` archives this task, so it must meet the floors itself, with no declaration): the task declares an empty ac_scope and therefore needs a runner-produced red row, and it has a GENUINE red. Your branch already holds tasks A to I, so `lore create task` without `--kind` and the removed flag fail the tests you are about to correct. First run the test files you will change (`bun run test:file <files>`) and record that failing run: `lore evidence <task> --oracle test --command "bun run test:file <files>" --result expected-fail --capture` (the runner summary shows the failed tests). Then correct the fixtures, and for every test file you changed capture an UNFILTERED whole-file pass (`lore evidence <task> --oracle test --command "bun run test:file <file>" --result pass --capture`, no `-t`) before `lore release`. Run only the changed files and `vitest --changed <merge-base>`; the orchestrator runs the full suite once after the landing.
Done when: `bun run typecheck` passes; every unit test file touched passes and has its unfiltered run recorded; a search of `packages/lore/tests/unit/` finds no `declare-no-new-tests`, `red-first` command call or `no-new-tests` floor id, and no `create task` without `--kind`.
