---
id: TASK-628
type: task
role: plan
title: "[Skill:docs] restate SPEC-084 plan Invariant 2 as three sanctioned ordinal-write sites + mechanize the grep oracle"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PRD-001
---
Assess finding (plan-level): Invariant 2 says 'exactly TWO allocation sites' but the shipped contract has three ordinal-write sites (insertWithAllocatedOrdinal, allocateOrdinalForExisting MAX+1 allocation; assignOrdinalForRepair D7 targeted repair). Restate the invariant and mechanize the 'no MAX+1 arithmetic elsewhere' grep over packages/ as a scripted check. Source: knowledge-assessment-implementation-spec-084-corpus-allocated.
