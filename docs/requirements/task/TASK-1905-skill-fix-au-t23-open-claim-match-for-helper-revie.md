---
id: TASK-1905
type: task
role: plan
title: "[Skill:fix] AU-T23 open-claim match for helper review resolves branch-name claims through resolveClaimWorktree (AU-T22 matched paths only)"
status: archived
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: AU-T22 (merged) matches open claims to a working copy with claimNamesWorktree(..., branch: undefined), so a claim whose recorded worktree is a BRANCH NAME never matches — and lore's dispatch protocol records the branch name (observed 2026-10-18: TG-47 claim extra.claim.worktree = "worktree-agent-accb2c7c5b10af25a"; its zero-duration helper ac21aaebab6f264d3 in that worktree was still reported as no-claimed-task). Resolve each open claim's recorded value with the ONE branch->directory resolver resolveClaimWorktree (packages/lore/src/service/worktree-cleanup.ts:364) and compare realpaths; not-measured resolution is reported in not_measured, never silently dropped.
Red-first: open claim recording a branch name whose worktree is W + zero-duration helper in W -> today no-claimed-task (red); after: none. Control: a branch name that resolves to a different worktree still yields no-claimed-task.
Source: turn-end review 2026-10-18
AC: both halves green; AU-T19/AU-T22 unit tests and AC-ST-8 oracle pass.
