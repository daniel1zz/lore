---
id: TASK-1061
type: task
role: plan
title: "Fix main red after the slice 3b and close-out merges"
status: archived
priority: medium
phase: "build"
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-164
plan: PLAN-164
---
Estimate: L
Source: spec-baseline-slice-3b-specs-belong-to-the-trees-through (main must be green after the slice 3b and close-out merges)
Approach: classify each failing test as introduced tonight (fails at main, passes at 27969373) or pre-existing; fix the introduced ones at root cause; report pre-existing.
AC: both full runners green except failures proven pre-existing at 27969373, each listed with an issue number.
