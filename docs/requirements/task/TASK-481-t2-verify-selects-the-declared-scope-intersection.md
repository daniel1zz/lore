---
id: TASK-481
type: task
role: plan
title: "T2 verify selects the declared-scope intersection and refuses out-of-scope or undeclared runs"
status: archived
priority: medium
phase: "Runner selection and refusal"
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PLAN-095
plan: PLAN-095
---
## Task

Covers AC-VS-1 through AC-VS-5. Depends on T1's field existing.

Default run selects ac_scope intersect declared script ACs. Unknown scope (absent field) refuses pre-flight exit 4 naming 'lore scope add'; empty array refuses exit 4 containing 'declares no acceptance criterion'; an explicit --ac outside scope refuses pre-flight exit 4 naming the offending id and the declared set. All refusals happen BEFORE recordVerifiedEvidence is called — assert non-invocation through the existing injected seam, no store needed.
