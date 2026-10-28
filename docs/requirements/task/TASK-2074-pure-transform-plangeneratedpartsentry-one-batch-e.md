---
id: TASK-2074
type: task
role: plan
title: "Pure transform planGeneratedPartsEntry: one batch entry per node for both generated parts"
status: deprecated
priority: medium
phase: "P4 Retired drafts (deprecated, no work)"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-261
plan: PLAN-261
---
Covers: AC-CV-5
Approach: planGeneratedPartsEntry(node, mapping) is pure and shipped (it is the tested part of the migration): it returns one entry per node with the body minus its written children list / count sentences (parents) and minus its Current values table (any node), plus patch.current_values from the mapping; a row the mapping does not account for is returned as an error, never dropped. The repo-specific mapping and the run live only in the throwaway script of the migration task. Uses #416's change batch (applyPatch(node, entry.patch)).
