---
id: TASK-1934
type: task
role: plan
title: "X2 an exemption keeps its decision and the milestone re-check reads it"
status: archived
priority: medium
phase: "X"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-244
plan: PLAN-244
---
Resolves #481. AC-DX-2. Next store migration adds a nullable decision column to the exemption table (SQLite, Turso, InMemory); AcExemptionService stores the judged decision there (today: 'validated, not kept'); decision-recheck.ts selects exemption decisions for a plan by its spec and by its tasks' claim runs within their windows and checks them like version-row decisions; decision-outcome-service.ts (lore decision rates) counts them. Test both selection paths.
