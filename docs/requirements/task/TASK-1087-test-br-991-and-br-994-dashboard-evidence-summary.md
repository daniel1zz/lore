---
id: TASK-1087
type: task
role: plan
title: "Test BR-991 and BR-994 dashboard evidence summary and unusable projects"
status: archived
priority: medium
phase: "tests"
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-166
plan: PLAN-166
---
Estimate: M
Source: spec-p0-requirement-coverage-falsifying-criteria-for-the-8 AC-P0C-5 AC-P0C-6
Approach: write the named test file covering the rule's unasserted claims (spec Scope table); prove each case red against a one-line mutation of the guarded code (record expected-fail with the mutation named), revert, then green.
AC: AC-P0C-5 AC-P0C-6 pass via its declared command.
