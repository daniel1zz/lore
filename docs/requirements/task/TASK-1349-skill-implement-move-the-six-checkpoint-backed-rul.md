---
id: TASK-1349
type: task
role: plan
title: "[Skill:implement] move the six checkpoint-backed rules verbatim from assets/context into their skill and agent homes"
status: archived
priority: medium
phase: "Phase 1: Move rules"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-186
plan: PLAN-186
links:
  - {id: TASK-1346, type: blocks}
  - {id: TASK-1350, type: resolves}
---
Estimate: S
Approach: per spec spec-always-loaded-rules-keep-only-what-no-checkpoint-enforces table: cut each of the six bullets from assets/context/corpus-workflow-1-feed.md, corpus-workflow-2-produce.md, corpus-workflow-3-execute.md, worktree-dispatch.md and paste it unshortened into its target (lore-plan resume mode, lore-design SKILL.md, lore-autopilot SKILL.md, assets/agents/lore-implementer.md); regenerate the assets manifest.
Source: spec table; knowledge-delivery-tier-audit-of-every-always-loaded-lore-rule
Covers: AC-RT-1, AC-RT-2
AC:
- AC-RT-1 green via its declared command, red recorded first
- AC-RT-2 green via its declared command, red recorded first

Red first (Invariant I3): run both AC commands before editing, record `lore evidence <this task> --result expected-fail --output-tail-file <log>`, then move, commit, record the pass.
