---
id: TASK-1134
type: task
role: plan
title: "Implement: decideCiteGate admits an uncited criterion holding an unexpired exemption (#105)"
status: archived
priority: medium
phase: "fix"
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-175
plan: PLAN-175
---
Implementer makes AC-BLS2-19 green without touching the test assertions. Pass active exemptions (spec doc_id, ac_id, expires_at > now) into decideCiteGate from the chokepoint; waive only 'uncited'. Scoped oracle: bun run test:changed + typecheck + the cite-gate test files. Estimate: S
