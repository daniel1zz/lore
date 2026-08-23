---
id: TASK-754
type: task
role: plan
title: "Serve both runners from one materialized worktree, and make cleanup unable to delete through a symlink"
status: archived
priority: medium
phase: "P2-runner-coverage-and-cleanup"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-135
plan: PLAN-135
---
Two criteria, both about the layout consequences rather than the layout itself.

AC-SD-5 (describe "both runners"): one materialized scratch worktree must serve BOTH runners — a vitest target and a .bun.test.ts target each exit EXACTLY 0, checked by exit code AND each runner own summary line. The criterion requires a falsifying direction PER RUNNER: omit the dotted entries (notably .bin) and the vitest half must fail; run the same bun command with materialization SKIPPED and it must exit nonzero. ⛔ Neither half may be green-only — the bun half without its control is exactly the defect class this spec exists to close.

AC-SD-8 (describe "cleanup cannot escape"): this is the most destructive failure mode the hybrid layout introduces. removeFalsifierScratchWorktree now walks a tree containing 400+ symlinks pointing INTO the developer real node_modules, so a follow-symlinks recursive delete destroys the actual dependency tree. Write a sentinel file inside the MAIN checkout node_modules before the cycle and assert it still exists with identical content afterwards, AND that the scratch parent directory is gone. Both halves required: the second stops the test being satisfied by simply never deleting anything.

Touch verify-runner-service.ts ONLY for the cleanup path. Wiring materialization into _runFalsifier belongs to the P3 task and its anchor; do not do it here. Read both criteria verbatim via lore get on the spec first, and record each RED direction with lore evidence --result expected-fail at the moment it is red, from this worktree.
