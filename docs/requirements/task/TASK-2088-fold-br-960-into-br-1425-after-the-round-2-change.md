---
id: TASK-2088
type: task
role: plan
title: "Fold BR-960 into BR-1425 after the round-2 change set lands"
status: draft
priority: medium
phase: "P4 Close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-264
plan: PLAN-264
links:
  - {id: TASK-2087, type: blocks}
---
Covers: none (rule-set fold; closes the open overlap between BR-960 and BR-1425)
Blocked by: the open tasks of plan-defect-clusters-round-2-part-b (that plan's close applies its modification of BR-960).
Steps: after lore rule changes spec-defect-clusters-round-2-part-b-review-pending-queue-corpus shows its change set applied, run lore rule propose spec-each-document-type-declares-which-structured-fields-the retire BR-960 --note 'folded into BR-1425: every type declares judge-visible content'; amend BR-1425's examples with BR-960's baseline and plan examples. This demotes the spec to draft: a person re-reviews and re-approves it (lore review + lore approve are human steps here). Re-point every criterion citing BR-960 (lore rule impact BR-960) to BR-1425 with lore ac cite. This task sits in this plan so the plan cannot close (and close #414) while the fold is open.
