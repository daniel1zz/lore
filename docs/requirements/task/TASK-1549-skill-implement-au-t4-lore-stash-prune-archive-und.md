---
id: TASK-1549
type: task
role: plan
title: "[Skill:implement] AU-T4 lore stash prune: archive under refs/lore/archive/stash, attribute, decide(stash-drop)"
status: archived
priority: high
phase: "Phase 1b: human channel and verbs"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1543, type: blocks}
---
Estimate: M
Approach: list stashes with facts (On <branch> -> run via claims/runs; contained-in-main by blob equality incl. ^3 untracked); --apply writes refs/lore/archive/stash/<sha>, verifies it resolves, then git stash drop for that exact stash ref (lore executes; the hook still blocks agent-typed drop); prints archive ref per dropped stash; counts dropped/kept/escalated. Red-first halves (1)-(5).
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function
AC: AC-AU-4.
