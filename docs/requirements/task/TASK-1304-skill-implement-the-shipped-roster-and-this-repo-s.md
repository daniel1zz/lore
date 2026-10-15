---
id: TASK-1304
type: task
role: plan
title: "[Skill:implement] the shipped roster and this repo's settings swap the retired per-call and stop hooks for stop-turn-review"
status: draft
priority: high
phase: "Phase 3: Roster swap"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-181
plan: PLAN-181
links:
  - {id: TASK-1303, type: blocks}
---
Estimate: S
Approach: distribution-hooks.ts: register stop-turn-review on Stop; drop stop-doc-sync.mjs, claude-md-guard.sh; delete those asset files and assets/hooks/pre-subagent-gate.mjs; remove pre-subagent-gate from this repo's .claude/settings.json; regenerate manifest; converge proof per AC-TE-5.
Source: spec AC-TE-5; BR-823, BR-1092
Covers: AC-TE-5
AC:
- AC-TE-5 green via its declared command (lore ac list <spec>), red recorded first

Red first (Invariant I3): write the AC test file(s) first, run the AC command, record `lore evidence <this task> --oracle test --result expected-fail --output-tail-file <log>` yourself, then implement to green and record the pass. Commit before attesting. Scoped oracles only in the worktree (I4).
