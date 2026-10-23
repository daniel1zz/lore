---
id: TASK-1911
type: task
role: plan
title: "[Skill:fix] AU-T19 turn-end helper review charges a harness-internal zero-duration helper with its parent implementer's worktree diff, and flags scratchpad writes"
status: archived
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: M
Approach: Turn-end review 2026-10-18 raised 14 findings against this session after merging AU-T7 and AU-T17. Measured: ~/.claude/session-state/sessions/<session>/helpers/ holds 30 helper records; 10 of them (e.g. a1714a6b39d9bf16e, a8bb13b6131a6d465 in agent-a3228ca78b139e7e6's worktree; a6fdda7456294b0f6 and 5 more in agent-a8bf4a4ad79fb4011's) have started_at == ended_at, never appear in any subagent transcript, and the two implementers made no Agent tool call — they are harness-internal SubagentStart/Stop events inside the implementer runs. helper-scope-review.ts attributes to each the worktree's whole measured diff vs its base (`changes.value.files[].source.run` = the helper), so each reports "changed files but claimed no task" for files the claiming implementer changed. Also: writes into the session scratchpad (the sanctioned temp dir agents are told to use) are reported as "outside its working copy". Root-cause fixes: (1) a helper's changes are what changed between its own start and end (start snapshot), so a helper sharing a working copy with its parent run is charged only with its own edits — or, if the harness cannot give a start snapshot, a helper nested in a claiming run's working copy is judged under that run's claims (state which, with the measured evidence); (2) the session scratchpad directory is not "outside the working copy" for findings (it is never repository content), while any other path outside stays a finding. No allowlist of agent ids.
Red-first: fixture trail with a parent implementer that claimed a task + a zero-duration helper in the same working copy -> today a no-claimed-task finding naming the parent's files (red); after: none. Control: a helper that edits a file outside its claimed anchors still yields outside-anchors; a write to a path outside both the working copy and the scratchpad still yields outside-working-copy.
Source: turn-end review 2026-10-18 (14 findings); spec-session-trail-a-session-local-record-of-what-each-run-4 AC-ST-8
AC: both halves green; AC-ST-8's oracle still passes; the shipped hook verified from a fresh consumer install.
