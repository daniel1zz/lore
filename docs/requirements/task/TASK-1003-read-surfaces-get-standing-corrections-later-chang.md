---
id: TASK-1003
type: task
role: plan
title: "Read surfaces: get Standing/Corrections/Later-changed-by, rule impact living vs records, compiled e2e"
status: archived
priority: medium
phase: "exits-and-surfaces"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-160
plan: PLAN-160
---
Covers: AC-DR-5, AC-DR-6. Spec: spec-documents-are-living-or-records-a-locked-record-is-never D7, BR-1051, BR-1052. get.ts consumes RecordLockService from app.ts (no own lock queries): line after Type — 'Standing: living' | 'Standing: record · locked (<reason>)' | 'Standing: record · not locked'; 'Corrections: N' when N>0 (count of correction versions); 'Later changed by' = newer docs with relates-to / supersedes / implements links INTO this doc, derived at read time. ImpactService/rule-index-queries: living[] (rule leaf + dependent leaves) and records[] ({slug, acId}) additive to existing JSON; rule.ts prints a Living group before a Records group. Compiled e2e record-lock-compiled.bun.test.ts on mkdtemp + lore init (never the repo .lore/): covers the full AC-DR-5 statement incl. lore restore / lore ac add refusals, lore reopen, MCP lore_set + lore_batch + lore_reopen.
