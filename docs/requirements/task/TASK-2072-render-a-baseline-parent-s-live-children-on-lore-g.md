---
id: TASK-2072
type: task
role: plan
title: "Render a baseline parent's live children on lore get (text and json)"
status: draft
priority: medium
phase: "P2 Rendering"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-263
plan: PLAN-263
links:
  - {id: TASK-2111, type: blocks}
---
Covers: AC-CL-1
Approach: the ONE shared baseline-rendering module, packages/lore/src/service/baseline-generated-parts.ts (review finding design-11: #409 adds renderCurrentValues and planGeneratedPartsEntry to it). renderBaselineChildren(parent, children) is pure, per the spec's Rendering section; live children only (literal '.filter((child) => child.deleted_at === null)'); renders unconditionally (no transitional mode); tree order = ordinal then title. lore get text appends the section after the body; --json adds rendered_children. get-render.ts's structured-extra notice must not announce rendered_children as unseen.

Ordering (user decision D18): blocked by plan 409's migration task, so this rendering lands only after the single batch removing every written list is approved; before approval readers see the old text, after it the generated list.
