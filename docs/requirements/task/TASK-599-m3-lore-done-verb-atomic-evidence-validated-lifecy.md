---
id: TASK-599
type: task
role: plan
title: "[M3] lore done verb: atomic evidence-validated lifecycle walk (AC-WH-3)"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-106
plan: PLAN-106
---
New lore done <task> verb per spec M3: validates >=1 result:pass evidence + no fresh foreign claim, walks VALID_TRANSITIONS to archived atomically (audited per step), idempotent second call. Service logic in TaskWorkflowService/PhaseWorkflowService (anchor overlap with M1 — claim sequentially). Readiness computation UNCHANGED. RED-first. AC: AC-WH-3.
