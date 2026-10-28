---
id: TASK-1950
type: task
role: plan
title: "Check and corpus kinds finish without a worktree; --declare-no-new-tests and the no-branch claim are retired (AC-DCT-4, AC-DCT-9)"
status: deprecated
priority: high
phase: "P2 Contract, kinds and implementer verbs"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1942, type: blocks}
---
Covers: AC-DCT-4, AC-DCT-9
TDD-Role: green
Approach: finishTask branches on contract.kind: for check and corpus it runs the oracles at main's head from the shared checkout, records rows stamped with main's head, and walks the task to archived without creating a worktree (landing_route none; the main's-head clause of BR-199 is the existing no-branch-claim measure). commands/done.ts turns --declare-no-new-tests into a usage error (exit 2) naming the kind; the declaration branch and the escape in requiresNoNewTestsDeclaration in task-workflow-service.ts are removed, not left dormant. A code task claimed with no branch is refused (exit 4) by commands/claim.ts and the service; a check or corpus task with a file anchor is already refused at approve (previous task).
Done when: AC-DCT-4 and AC-DCT-9 commands pass; a search for declare-no-new-tests in packages/lore/src returns only the retirement message and its test; typecheck passes.
