---
id: TASK-1919
type: task
role: plan
title: "Integration tests create tasks with a kind and drop the retired flag, floor names and red-first declaration"
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
---
Covers: no criterion of this spec; keeps the tests of approved criteria of other specs true (AC-ND-1..4, 9, 10, AC-UC-1, AC-LB-5, AC-DC2-21, AC-DCL-1, AC-LRD-1, AC-HID-3, AC-RV-10, AC-ROI-4, AC-097-2, AC-AP-6, 7, 8, 10).
TDD-Role: fixture
Approach: a mechanical correction of `packages/lore/tests/integration/` (directory anchor), same rules as the unit task J1: `--kind` on every CLI task creation (about fifty files); `--declare-no-new-tests` becomes `lore approve <task> --red-waiver "<reason>"` at approve time in `cli/landing-from-git-facts.bun.test.ts`, `cli/landing-unrecoverable-claims.bun.test.ts`, `cli/write-attribution-matrix.bun.test.ts`, `cli/issue-adopt-work-task.bun.test.ts`, `cli/issue-close-on-archive-carrier.bun.test.ts`, `cli/issue-resolve-github-owned.bun.test.ts`, `cli/issues-sync-push-only.bun.test.ts`, `cli/verify-missing-oracle-file.test.ts`, `cli/done-worktree-cleanup.bun.test.ts`, `cli/lore-actor-deprecation.bun.test.ts`, `decision-detail-producers.bun.test.ts`; the fixture config of every test that approves a task sets the three `workflow.done_contract` keys (through `patchLoreConfig`); the no-branch-claim half of `cli/landing-from-git-facts.bun.test.ts` (AC-ND-9) is removed (covered by AC-DCS1-19 and 21); `lb-definition-of-done.bun.test.ts` (AC-LB-5) asserts the stored contract; `dc2-tdd-red-pairing.bun.test.ts` (AC-DC2-21) captures the red as expected-fail and never calls `lore red-first`. The statements of the approved criteria are corrected by J4 in the same wording.
Under TODAY's rules (the done walk of `lore integrate` archives this task, so it must meet the floors itself, with no declaration): the task declares an empty ac_scope and therefore needs a runner-produced red row, and it has a GENUINE red. Your branch already holds tasks A to I, so `lore create task` without `--kind` and the removed flag fail the tests you are about to correct. First run the test files you will change (`bun run test:file <files>`) and record that failing run: `lore evidence <task> --oracle test --command "bun run test:file <files>" --result expected-fail --capture` (the runner summary shows the failed tests). Then correct the fixtures, and for every test file you changed capture an UNFILTERED whole-file pass (`lore evidence <task> --oracle test --command "bun run test:file <file>" --result pass --capture`, no `-t`) before `lore release`. Run only the changed files and `vitest --changed <merge-base>`; the orchestrator runs the full suite once after the landing.
Done when: `bun run typecheck` passes; every integration test file touched passes and has its unfiltered run recorded; a search of `packages/lore/tests/integration/` finds no `declare-no-new-tests`, `lore red-first` call or `no-new-tests` floor id, and no `create task` without `--kind`.
