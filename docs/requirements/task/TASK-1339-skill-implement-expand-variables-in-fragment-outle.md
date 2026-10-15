---
id: TASK-1339
type: task
role: plan
title: "[Skill:implement] Expand variables in fragment outlets before fingerprinting"
status: archived
priority: critical
phase: "Phase 1: Core expander and fragment outlets"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
links:
  - {id: TASK-1330, type: blocks}
  - {id: TASK-1332, type: blocks}
---
Estimate: M
Approach: one helper expandFragments(fragments, outlet, ctx, registry) (plan branch B1 path B) invoked per outlet by every fragment path: runContextRefresh (context-flow.ts ~544, ~621), fragments-flow.ts render/check/drift (~201, ~261, ~316) and findDuplicateLines (~550); VarContext.lineOffset = frontmatter line count of the fragment file.
Source: spec D4, D5, D10; packages/lore/src/service/context-fragments/{section,render}.ts
Covers: AC-CV-2, AC-CV-3

AC:
- AC-CV-2 and AC-CV-3 commands exit 0; every existing test importing context-fragments/*, context-flow, fragments-flow stays green (scoped oracle).
- grep shows expandFragments is the only call into expandTemplate under packages/lore/src/service/context-fragments and packages/lore/src/flows.
