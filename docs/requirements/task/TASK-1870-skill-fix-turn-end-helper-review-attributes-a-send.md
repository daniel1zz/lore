---
id: TASK-1870
type: task
role: plan
title: "[Skill:fix] Turn-end helper review attributes a SendMessage-resumed helper's edits to the claim its worktree holds"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: S
Problem (observed 2026-10-19): the turn-end helper review reported "Helper a9c10a59bef345179 changed files but claimed no task" for exactly the files of task-skill-implement-hr-t4-running-dashboard-serve-registers (dashboard.ts, serve.ts, live-server-registry.ts, the registry test, the ledger, and human-channel.ts which the helper touched for a reverted red probe). That task was claimed and released by helper a9e0ca47ee63e0a3f; the orchestrator then resumed the same agent with SendMessage, and the resumed turns were attributed to a different helper id with no transcript under the session's subagents dir. The review therefore cannot match the edits to the claim. No other helper ran on those files.
Approach: find how the review (helper-scope-review.ts / assets/hooks/lib/session-trail.mjs) derives the helper id for a resumed agent, and attribute a resumed agent's edits to the same run as its original (or match claims by the worktree the edits happened in, which is already recorded — AU-T22). Reproduce first with a recorded trail.
AC: a unit test feeding a trail where one worktree's edits come from two helper ids (original + resumed) with one claim in that worktree reports no finding; the same trail with no claim in that worktree still reports "claimed no task". Make the first go red once.
