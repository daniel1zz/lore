---
id: TASK-2063
type: task
role: plan
title: "Mirror export and review judge show current values in effect"
status: draft
priority: medium
phase: "P3 Refusal, integrity, export and judge"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-261
plan: PLAN-261
links:
  - {id: TASK-2062, type: blocks}
---
Covers: AC-CV-5
Approach: export-docs-service.ts uses the literal 'const currentValuesSection = renderCurrentValues(doc, effectiveConfig);' (falsifier), with the export time stated in the heading; CorpusService.getReviewBundle adds a derived part 'Current values (in effect now)' (v9 derived_parts from the #414 plan; the v9 template is not edited).
