---
id: TASK-226
type: task
role: plan
title: "Adversarial six-dimension test sweep for SPEC-066 (independent tester)"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PLAN-049
plan: PLAN-049
---
After the implementation task merges: independent tester agent writes adversarial tests (test files ONLY) covering HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/REGRESSION for slugify (polyphonic chars, mixed scripts, 64-char boundaries with off-by-one probes, empty/whitespace titles, all 7 doc types prefix dedup) and set --slug (rename conflicts, surface inheritance, version-log ordering). Must NOT modify source files.
