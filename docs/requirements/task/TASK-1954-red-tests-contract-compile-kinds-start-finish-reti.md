---
id: TASK-1954
type: task
role: plan
title: "Red tests: contract compile, kinds, start, finish, retired flag, contract migration (AC-DCT-1..10)"
status: deprecated
priority: high
phase: "P1 Red"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1956, type: blocks}
  - {id: TASK-1953, type: blocks}
---
Covers: AC-DCT-1..AC-DCT-10
TDD-Role: red
Approach: one test per AC, named with its AC id so the AC command's -t filter matches. Unit tests (done-contract-compile) call the compile function over a fake store and a fake file reader; integration tests run the compiled lore binary in a throwaway corpus (mkdtemp plus lore init, never the repo corpus). AC-DCT-2's fixture carries all three causes (missing anchor, absent falsifier literal, test file another task deletes) and asserts all three named in one refusal. AC-DCT-4 and AC-DCT-5 compare the worktree listing before and after. AC-DCT-9 asserts exit 2 and the stderr text of the retired flag. AC-DCT-10 compares store versions before and after the preview.
Done when: each AC command runs red for the right reason (a failed assertion, never a missing runner); lore evidence --result expected-fail --capture per AC, recorded by the agent that ran the red. These test files are anchored here and pass only after the P2 tasks land together; the landing runs verify and done for all tasks of the branch.
