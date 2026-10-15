---
id: TASK-1327
type: task
role: plan
title: "[Skill:verify] Full suite, lore verify and spec anchors on main"
status: archived
priority: critical
phase: "Phase 4: Verification"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
---
Estimate: S
Source: plan Exit Criteria
Covers: AC-CV-1, AC-CV-2, AC-CV-3, AC-CV-4, AC-CV-5, AC-CV-6, AC-CV-7, AC-CV-8

AC:
- On main after all merges: `bun run build` exit 0; `bun run test:vitest` and `bun run test:bun` each exit 0 (measured without a pipe).
- `lore verify <plan>` attests all 8 AC-CV criteria pass.
- Spec code anchors declared (`lore anchor add <spec> packages/core/src/context-variables.ts#expandTemplate`, the registry, RealAssetSource, expandFragments) and `lore status --check-drift` exit 0.
