---
id: TASK-1303
type: task
role: plan
title: "[Skill:verify] land spec-interception: rule apply, restate BR-1089/BR-1090, anchors, lore verify, full suite on main"
status: draft
priority: medium
phase: "Phase 4: Land and verify"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-181
plan: PLAN-181
---
Estimate: S
Approach: Main agent after B1-B5 merge: bun run build; full suite + typecheck on main; lore verify <plan>; plan close applies the change set; then lore rule set BR-1089 / BR-1090 to the spec's authoritative Scope 4(a)/(b) wording (#198); lore anchor add for landed files; enable workflow.turn_end.main_session_source_edits: block in this repo's .lore/config.yaml (local file, #25).
Source: all AC-TE-*
Covers: landing (no AC of its own)
AC:
- lore verify <plan> exit 0 with every script AC of the spec attested; bun run test:vitest, bun run test:bun, bun run typecheck exit 0 on main
