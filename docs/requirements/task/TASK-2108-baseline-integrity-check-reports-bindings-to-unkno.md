---
id: TASK-2108
type: task
role: plan
title: "Baseline integrity check reports bindings to unknown governed values"
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
Covers: AC-CV-4
Approach: findBaselineIntegrityFindings adds current-value-unbound via the literal 'if (!isKnownBinding(binding.source)) findings.push(' (falsifier); value add refuses an unknown id with exit 4. baseline-status.ts is also changed by the #416 plan (authored-children finding); that plan lands first, so branch from main after it.
