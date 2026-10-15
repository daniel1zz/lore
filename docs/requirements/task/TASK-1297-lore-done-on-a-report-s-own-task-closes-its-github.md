---
id: TASK-1297
type: task
role: plan
title: "lore done on a report's own task closes its GitHub issue; sync closes missed ones"
status: archived
priority: medium
phase: "done-close"
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-179
plan: PLAN-179
---
Covers AC-IT-1..3 of spec-completing-an-adopted-report-s-own-task-closes-its-github (D1-D3). Reuse IssueCloser + IssueCloseOnArchive: TaskWorkflowService.done on a task with extra.issue_report + github ref closes as completed (comment naming the task, label resolution:closed); other archive paths label only; failures printed + issue_close_failed audit, never undo; issues --sync --apply closes done-archived reports still open. Red-first.
