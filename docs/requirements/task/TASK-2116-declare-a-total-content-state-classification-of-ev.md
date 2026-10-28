---
id: TASK-2116
type: task
role: plan
title: "Declare a total content/state classification of every document type's extra keys"
status: draft
priority: high
phase: "P2 Classification"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-264
plan: PLAN-264
links:
  - {id: TASK-2112, type: blocks}
---
Covers: AC-JV-1
Approach: the spec's classification table, completed for phase docs by the same rule; render shapes entries | list | scalar | object; judgeContentFields(type) returns the content entries in declaration order. Pure and browser-safe (no Node import; barrel-isolation.test.ts is in the scoped floor). The task entry literal 'file_anchors: { kind: "content", heading: "File anchors", shape: "list" }' appears verbatim once (falsifier). Build packages/core before verifying dependents.
