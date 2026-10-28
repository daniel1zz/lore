---
id: TASK-1942
type: task
role: plan
title: "lore start creates the worktree on the contract base, installs dependencies, claims and prints the contract (AC-DCT-5)"
status: deprecated
priority: high
phase: "P2 Contract, kinds and implementer verbs"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1943, type: blocks}
  - {id: TASK-1953, type: blocks}
---
Covers: AC-DCT-5
TDD-Role: green
Approach: startTask(task) in done-contract-service.ts reads the stored contract (refuses exit 4 when absent or the task is not approved), creates the worktree through the existing worktree port (worktreeAdd in SeatService's port) on contract.base_branch, creating an absent integration branch at main's head first, runs the project's dependency install, then claims through TaskWorkflowService.claim with the new worktree and branch, and prints the contract. commands/start.ts is registered in index.ts in the same task. main is never checked out (BR-1342): the worktree is created on a new task branch off the base.
Done when: AC-DCT-5 passes through the compiled binary, including the integration-branch base case; typecheck passes.
