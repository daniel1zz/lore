---
id: TASK-2077
type: task
role: plan
title: "Close plan 416: verify and apply rules (this corpus migrates in plan 409's shared batch)"
status: draft
priority: medium
phase: "P4 Close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-263
plan: PLAN-263
---
Covers: AC-CL-5 (attested here by lore verify; it is a fixture-corpus criterion)
Steps: bun run build; lore verify plan-baseline-children-lists-rendered-from-the-tree-416; lore rule apply spec-a-baseline-parent-s-children-list-is-rendered-from-the (BR-1429, BR-1463, BR-1464 live); lore anchor add the spec baseline-generated-parts.ts#renderBaselineChildren and change-batch-service.ts; lore assess.
This corpus's own 20 parent bodies are NOT migrated here: the single shared batch (user decision D18) that removes written children lists AND current-values tables is staged by the last task of plan-baseline-current-values-bound-to-their-source-409, approved once by a person, and its end state is checked there.
