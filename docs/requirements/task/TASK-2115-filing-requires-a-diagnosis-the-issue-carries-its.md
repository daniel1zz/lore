---
id: TASK-2115
type: task
role: plan
title: "Filing requires a diagnosis; the issue carries its label and sections"
status: draft
priority: high
phase: "P2 Filing and listing"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-254
plan: PLAN-254
links:
  - {id: TASK-2114, type: blocks}
  - {id: TASK-2113, type: blocks}
  - {id: TASK-1977, type: blocks}
---
Covers: AC-MI-1, AC-MI-2
Approach: the spec's Filing table. issue-diagnosis-vocab.ts is import-free (browser-safe leaf like issue-resolution-vocab.ts) and holds the label prefix, the values and readDiagnosis(labels). Falsifier literals verbatim once: DIAGNOSIS_LABEL_PREFIX, the unstated line, the report-issue usage throw. The label is created on first use through the same port that sets resolution labels. issueFrontMatterFieldsSchema is NOT changed (invariant I2).
