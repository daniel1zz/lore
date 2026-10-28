---
id: TASK-2087
type: task
role: plan
title: "Close plan 414: verify, apply BR-1425, anchors"
status: draft
priority: medium
phase: "P4 Close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-264
plan: PLAN-264
links:
  - {id: TASK-2081, type: blocks}
---
Covers: none (orchestrator close; AC-JV-1..5 attested by lore verify)
Steps: bun run build; lore verify plan-judge-visible-structured-fields-declared-per-document-type; lore rule apply spec-each-document-type-declares-which-structured-fields-the (BR-1425 live, BR-261 rewritten); lore anchor add the spec judge-visible-fields.ts#judgeContentFields and review-template.ts#buildReviewPromptV9; lore assess. The BR-960 fold is its own task in this plan and blocks this close.
