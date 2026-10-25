---
id: TASK-1907
type: task
role: plan
title: "[Skill:fix] AU-T22 helper review judges a working-copy group under open claims whose recorded worktree is that copy (a running implementer has no end record yet)"
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
Approach: After AU-T19 (helpers sharing a working copy are judged as one group under the claims of members that have a helper record), a turn-end review while an implementer is STILL RUNNING reports its nested zero-duration helpers as "changed files but claimed no task": the implementer itself has no helper end record yet, so the group has no claiming member (observed 2026-10-18: helper a8945f58cd6218331 in agent-ae43055f3f335e638 while MI-T2 was claimed by that run). The claim already records its worktree (extra.claim.worktree / the run registration). Fix: a group is judged under every OPEN claim whose recorded worktree is the group's working copy, in addition to members' claims; no path-name inference.
Red-first: fixture with a claimed task recording worktree W, a zero-duration helper in W, and no end record for the claiming run -> today no-claimed-task (red); after: no finding. Control: a helper in a working copy no open claim names still yields no-claimed-task.
Source: turn-end review 2026-10-18
AC: both halves green; AU-T19 unit tests and AC-ST-8 oracle pass.
