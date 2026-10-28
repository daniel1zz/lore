---
id: TASK-2064
type: task
role: plan
title: "lore baseline value add and rm; lore get renders the value in effect"
status: draft
priority: medium
phase: "P2 Registry and binding"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-261
plan: PLAN-261
links:
  - {id: TASK-2109, type: blocks}
  - {id: TASK-2108, type: blocks}
  - {id: TASK-2062, type: blocks}
---
Covers: AC-CV-1
Approach: bindings in extra.current_values; lore baseline value add|rm write one binding through the baseline per-item review path (values bound after the migration). renderCurrentValues lives in the shared packages/lore/src/service/baseline-generated-parts.ts (#416's module) with the literals 'value: readBoundValue(binding.source, effectiveConfig)' and 'if ((node.extra.current_values ?? []).length === 0) return null;' (falsifier): end-state meaning, a node with no bindings has no Current values section; an absent field and an empty list render the same. lore get text section and --json rendered_current_values; the get-render structured-extra notice treats current_values as surfaced.
Classification: add current_values to the baseline row of judge-visible-fields.ts as content [entries] (the #414 spec requires the spec that adds a key to classify it; AC-JV-1 fails otherwise).
