---
id: TASK-1948
type: task
role: plan
title: "lore start checks drift since approve: prints the anchors' diff, recompiles, refuses a missing falsifier literal (AC-LND-8)"
status: deprecated
priority: high
phase: "P3 Land, dispatch, log, drift"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1955, type: blocks}
---
Covers: AC-LND-8
TDD-Role: green
Approach: before creating anything, startTask diffs the task anchors' files between contract.compiled_at_commit and the base head (the diff-since helper in service/git-diff-since.ts is the existing reader), prints it, recompiles the contract, and refuses with exit 4 naming the AC, path and literal when a falsifier find-literal is missing and not marked new-symbol; no worktree and no claim are created on a refusal. Otherwise a drift entry is appended to the execution log. This replaces freshness-reader dispatches.
Done when: AC-LND-8 passes through the compiled binary; typecheck passes.
