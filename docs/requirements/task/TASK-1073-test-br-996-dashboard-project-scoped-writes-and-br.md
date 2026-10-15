---
id: TASK-1073
type: task
role: plan
title: "Test BR-996 dashboard project-scoped writes and BR-995 isolation run"
status: archived
priority: medium
phase: "tests"
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-166
plan: PLAN-166
---
Estimate: L
Source: spec-p0-requirement-coverage-falsifying-criteria-for-the-8 AC-P0C-7 AC-P0C-8
Approach: write the named test file covering the rule's unasserted claims (spec Scope table); prove each case red against a one-line mutation of the guarded code (record expected-fail with the mutation named), revert, then green.
AC: AC-P0C-7 AC-P0C-8 pass via its declared command.
