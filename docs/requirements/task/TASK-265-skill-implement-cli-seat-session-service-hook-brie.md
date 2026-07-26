---
id: TASK-265
type: task
role: plan
title: "[Skill:implement] CLI seat + session-service + hook + briefing"
status: archived
priority: critical
phase: "Phase 1: Seat slice"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-069
plan: PLAN-069
links:
  - {id: TASK-263, type: blocks}
---
Estimate: M
Approach: CLI seat verbs + bootstrap seat-signal flags + deriveResumeHint call in SessionService + hook --seat-branch passing (both copies + SSOT) + briefing commit-cadence line + handoff dirty-boolean via CLI adapter
Source: spec-spec-057 D2/D3/D6
Dimensions: D-FUNC, D-UX
Scope-Alt: seat resume can alias enter in v1 if worktree exists
Covers: AC-S-3, AC-S-4, AC-S-7
AC:
- Given U1 RED suites, When implemented, Then AC-S-3/AC-S-4/AC-S-7 commands exit 0
Integration:
- Real seat entry in a throwaway repo: lore seat <plan> creates worktree, session hook injects seat block, bootstrap resume points at seat plan (commands in evidence)
