---
id: TASK-1918
type: task
role: plan
title: "End-to-end, dashboard, http and script tests create tasks with a kind and drop the retired flag"
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
Covers: no criterion of this spec; keeps the compiled tests (worktree cleanup, plan close, run identity, rule change set, baseline rollback, ac correction, evidence guards), the http route tests, the dashboard end-to-end seed and the repository scripts true.
TDD-Role: fixture
Approach: same rules as J1 for the directories and files anchored here: `--kind` on every CLI task creation (examples: `plan-close-invariants-compiled.bun.test.ts:311`, `evidence-completeness-guard-compiled`, `ac-set-correction-compiled`, `rule-change-set-compiled`, `run-identity-e2e`, `baseline-rollback`, `packages/dashboard/tests/e2e/seed-execution-fixture.ts:106` and the scripts above), `--red-waiver` at approve instead of `--declare-no-new-tests`, the three config keys in fixture configs, no MCP client. The eight new red files of P1 in `tests/e2e/` and `tests/unit/` are NOT touched, and `helpers/done-contract-fixture.ts` is only changed if a signature moved.
Under TODAY's rules (the done walk of `lore integrate` archives this task, so it must meet the floors itself, with no declaration): the task declares an empty ac_scope and therefore needs a runner-produced red row, and it has a GENUINE red. Your branch already holds tasks A to I, so `lore create task` without `--kind` and the removed flag fail the tests you are about to correct. First run the test files you will change (`bun run test:file <files>`) and record that failing run: `lore evidence <task> --oracle test --command "bun run test:file <files>" --result expected-fail --capture` (the runner summary shows the failed tests). Then correct the fixtures, and for every test file you changed capture an UNFILTERED whole-file pass (`lore evidence <task> --oracle test --command "bun run test:file <file>" --result pass --capture`, no `-t`) before `lore release`. Run only the changed files and `vitest --changed <merge-base>`; the orchestrator runs the full suite once after the landing.
Done when: `bun run typecheck` passes; each touched file passes and has its unfiltered run recorded; a search of the repository (`packages`, `scripts`) for `create task` or `"create", "task"` without `--kind`, and for `declare-no-new-tests`, finds nothing outside the files that name them as removed and the eight new P1 test files (`done-contract-*-compiled.bun.test.ts`, `shipped-done-contract-text.test.ts`), which omit `--kind` on purpose to test the refusal.
