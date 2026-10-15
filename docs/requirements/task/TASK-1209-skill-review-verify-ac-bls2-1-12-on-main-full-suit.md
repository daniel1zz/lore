---
id: TASK-1209
type: task
role: plan
title: "[Skill:review] Verify AC-BLS2-1..12 on main, full suite, assess"
status: archived
priority: critical
phase: "Phase 5: Backfill and acceptance"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: KN-640, type: informs}
---
Estimate: M
Source: plan Exit Criteria
Covers: AC-BLS2-1..12
AC:
- lore verify <plan> attests AC-BLS2-1..12 pass on main after bun run build
- full suite (test:vitest + test:bun) on main: no new reds vs the pre-plan list (Invariant 6)
- lore assess run and saved (its slug cited in evidence); findings triaged in the plan's Decisions Log
- spec code anchors declared for landed files; lore status --check-drift exits 0
- module docs updated where they describe the changed commands (packages/lore/src/service/CLAUDE.md, adapters/cli/CLAUDE.md, adapters/mcp/CLAUDE.md) or a one-line reason why not
- handoff written; lore feed session-resume --handoff <slug> renders it
