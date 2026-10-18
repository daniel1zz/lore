---
id: TASK-1574
type: task
role: plan
title: "[Skill:fix] AU-T12 stash-drop subject version includes the attribution state, so an escalation made while the owner was live is re-decided once it ends"
status: archived
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1543, type: blocks}
---
Estimate: S
Approach: AU-T4 keys the decision on {id: sha, version: sha}. By AC-AU-2 (worst-of per version) a stash escalated while its run was live stays escalated forever, even after the run ends — only a human accept clears it. ADR D5: new facts start a new subject version. Use version = sha + the attribution facts that changed (owner run ids + their ended state), so a stash whose owner has since ended gets a fresh decision; facts that did not change keep the version (no re-roll). Red-first: escalate while live, end the run, re-run prune --apply -> auto and dropped; control: re-run while still live -> still escalated, no new auto.
Source: AU-T4 report 2026-10-18 concern 1; spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-2, AC-AU-4
AC: both halves green; AC-AU-2 and AC-AU-4 oracles still pass.
