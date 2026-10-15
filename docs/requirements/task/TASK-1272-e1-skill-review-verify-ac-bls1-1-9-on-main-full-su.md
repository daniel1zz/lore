---
id: TASK-1272
type: task
role: plan
title: "[E1] [Skill:review] verify AC-BLS1-1..9 on main, full suite, assess, anchors, handoff"
status: archived
priority: critical
phase: "Phase E: verification"
created: 2026-10-07
updated: 2026-10-08
tags: []
parent: PLAN-172
plan: PLAN-172
---
Estimate: M
Source: plan Exit Criteria
Covers: AC-BLS1-1..9 (attestation), AC-BLS1-11 (judgment)

AC:
- `lore verify plan-baseline-slice-1-rules-citations-rule-state-specification` attests AC-BLS1-1..9 pass on main.
- `bun run test:vitest`, `bun run test:bun`, `bun run typecheck` exit 0 on main.
- `lore assess plan-baseline-slice-1-rules-citations-rule-state-specification` run; findings triaged.
- Spec code anchors declared for landed files; `lore status --check-drift` and `--check-baseline` exit 0.
- Handoff written with slice-2 entry criteria.
