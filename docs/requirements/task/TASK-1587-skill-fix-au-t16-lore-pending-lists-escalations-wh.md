---
id: TASK-1587
type: task
role: plan
title: "[Skill:fix] AU-T16 lore pending lists escalations whose subject is gone or was decided on a newer version"
status: draft
priority: high
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: 2026-10-18 lore pending shows decisions 6, 7, 8 (worktree-remove) for worktrees that lore removed afterwards on a NEW subject version (AU-T13 changed the ignored-path set hash, so a fresh auto decision removed them). The old version's escalate stays 'pending' forever, so the human is asked about objects that no longer exist — noise that trains the human to ignore the list. Rule: a pending decision is closed (status superseded, recorded as a machine record, never deleted) when its subject no longer exists (class-specific existence probe: worktree path, stash sha, process pid+start) or a later decision for the same subject id on a newer version exists. Red-first: escalate v1, auto-remove under v2 -> pending no longer lists v1; control: escalate with the subject still present and no newer version -> still listed.
Source: live lore pending output 2026-10-18; spec AC-AU-3 (pending lists open decisions)
AC: red-first + control; AC-AU-2 and AC-AU-3 oracles pass.
