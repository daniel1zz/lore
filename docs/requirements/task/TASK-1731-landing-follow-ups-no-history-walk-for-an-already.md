---
id: TASK-1731
type: task
role: plan
title: "Landing follow-ups: no history walk for an already-integrated branch, assess reports an unlanded task as not measured, independent same-actor and same-session cases"
status: archived
priority: high
phase: "P2"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-220
plan: PLAN-220
---
From the assessment of plan-land-recorded-archival-and-one-unlanded-task-per-working (knowledge-assessment-land-recorded-archival-and-one-unlanded, 2026-10-19). (1) locateExistingLanding in integrate-service.ts walks main's first-parent history (rev-list --ancestry-path) to rebuild a landing for an already-integrated branch; the spec's end state says nothing reconstructs landings from history. End state: an already-integrated branch records a landing whose landed commit is the branch head itself (already on main), with no main_before/merge lookup; the commit range then comes from the claim's recorded base to that head. Delete locateExistingLanding. (2) The not_measured range variant was removed, so assess now attributes a task with no landing by slug match; that is a silent fallback. End state: assess reports a task with no recorded landing as not measured (named, counted), never guessed by slug; delete the slug-match path for tasks if nothing else needs it. (3) claim-one-unlanded-task-per-worktree.bun.test.ts pins one CLAUDE_CODE_SESSION_ID for every call, so case (1) same actor and case (2) same session no longer test different things: give case (1) the same actor under a different session and case (2) the same session, each explicit; keep env independence (passes with identity vars stripped). Red-first captures for (1) and (2); tests and typecheck green; run AC-LRD-2/3/4 commands from your worktree.
