---
id: TASK-2082
type: task
role: plan
title: "Close plan 420: verify, apply rule changes, anchors"
status: draft
priority: medium
phase: "P5 Close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-254
plan: PLAN-254
---
Covers: none (orchestrator close; AC-MI-1..5 attested by lore verify)
Steps: bun run build; lore verify plan-defect-reports-state-their-mechanism-or-are-marked-symptom; lore rule apply spec-a-defect-report-states-its-mechanism-or-is-marked-symptom (BR-1427, BR-1428 live; BR-491, BR-494 rewritten); lore anchor add the spec issue-diagnosis-vocab.ts#readDiagnosis and issue-diagnosis-service.ts; file every later issue of this initiative with the new flags; lore assess.
Also, before lore assess: run lore issue diagnose <n> --mechanism --end-state on each still-open issue of this initiative whose body already carries Mechanism and End-state sections (#409, #416, #418, #420, #457, #304, #422, #329, #356, #408, #414), so their fix carriers read mechanism; report any issue whose body has no traced mechanism instead of inventing one.
