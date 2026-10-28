---
id: TASK-2048
type: task
role: plan
title: "T1 AC-IL tests for the issue-loop rule changes, two stale comments"
status: archived
priority: medium
phase: "T"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-259
plan: PLAN-259
---
Covers AC-IL-1..10 of spec-the-issue-loop-baseline-states-github-owned-issues-stale (AC-IL-3 by existing tests, red run by mutation). Tests only plus stale comments; no behaviour change. Every new assertion must pass on main as is; make each new test red once by a deliberate mutation, record it as expected-fail evidence, restore. Name each new test with its AC id. Details per file in the plan's T1 entry.
