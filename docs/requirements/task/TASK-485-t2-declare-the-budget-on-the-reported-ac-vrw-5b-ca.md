---
id: TASK-485
type: task
role: plan
title: "T2 declare the budget on the reported AC-VRW-5b case"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PLAN-097
plan: PLAN-097
---
## Task

Covers AC-TB-4. The AC-VRW-5b case in cli-plan-promote-advisory.bun.test.ts spawns the compiled binary 6+ times inside the default 5000ms budget and fails under load (measured 6222ms, empty stderr from a killed child). Declare an explicit timeout matched to its spawn count. This is a DECLARATION, not a symptom-fix bump: the oracle from T1 must then pass on the tree.
