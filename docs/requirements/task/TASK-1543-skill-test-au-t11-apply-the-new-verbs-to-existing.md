---
id: TASK-1543
type: task
role: plan
title: "[Skill:test] AU-T11 apply the new verbs to existing debris on main and verify AC-AU-1..11"
status: draft
priority: high
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: M
Approach: Orchestrator on main, no merges in flight: lore stash prune --apply (expect 28 archived+dropped, or escalations named), lore run reap --apply and ending of dead unended runs, lore worktree sweep --apply for registered lore-attested-red-* worktrees, removal of unregistered lore-attested-red-* temp dirs through the same class; then lore verify AC-AU-1..11 and bun run test.
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function
AC: plan exit criteria.
