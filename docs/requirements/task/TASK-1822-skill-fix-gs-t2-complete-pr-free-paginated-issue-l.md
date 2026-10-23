---
id: TASK-1822
type: task
role: plan
title: "[Skill:fix] GS-T2 complete PR-free paginated issue listing"
status: approved
priority: medium
phase: "foundation"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-224
plan: PLAN-224
links:
  - {id: TASK-1451, type: resolves}
  - {id: TASK-1795, type: blocks}
  - {id: TASK-1757, type: blocks}
  - {id: TASK-1800, type: blocks}
---
Estimate: M
Approach: spec spec-github-owns-issue-report-state-no-mirror-task-work-carries section for T2; see plan invariants. Own the existing tests importing your anchored modules (grep issue_report|task-gh-|<module>).
Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries.
AC: AC-GS-1.
