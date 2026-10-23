---
id: TASK-1830
type: task
role: plan
title: "[Skill:refactor] GS-T11 retire the old shape: extra.issue_report and resolves refused on every write path (lands after the migration)"
status: deprecated
priority: medium
phase: "migration"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-224
plan: PLAN-224
---
Estimate: M
Approach: spec spec-github-owns-issue-report-state-no-mirror-task-work-carries section for T11; see plan invariants. Own the existing tests importing your anchored modules (grep issue_report|task-gh-|<module>).
Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries.
AC: .
