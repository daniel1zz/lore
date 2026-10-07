---
id: TASK-881
type: task
role: plan
title: "[Skill:review] verify AC-STR-1..8 on main + full suite + assess"
status: archived
priority: critical
phase: "Phase 3: Dogfood & verify"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
---
Estimate: S
Owner: orchestrator
Covers: none directly (gate over AC-STR-1..8)

AC:
- `lore verify <plan>` attested pass for AC-STR-1..8.
- `bun run typecheck`, `bun run test:vitest`, `bun run test:bun` all exit 0 on main (no cache).
- `lore assess <plan>` reviewed; spec code anchors declared (`lore anchor add`); `lore status --check-drift` exit 0.
