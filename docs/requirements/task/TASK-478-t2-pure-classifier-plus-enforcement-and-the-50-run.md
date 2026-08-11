---
id: TASK-478
type: task
role: plan
title: "T2 pure classifier plus enforcement and the 50-run harness"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PLAN-090
plan: PLAN-090
---
## Task

Covers AC-IC-1 through AC-IC-6. Depends on T1's recorded contract. Pure classifier in @lore/core mapping a pair of exitCode and stderr to the D2 verdict; the harness calls it rather than re-implementing the rule. Control fixture holds an OPEN WRITE TRANSACTION for the full duration of the second invocation. NO setTimeout, sleep or backoff in any of the three paths named in D3.
