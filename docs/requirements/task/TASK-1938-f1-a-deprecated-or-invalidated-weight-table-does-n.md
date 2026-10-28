---
id: TASK-1938
type: task
role: plan
title: "F1 a deprecated or invalidated weight table does not hold its kind"
status: archived
priority: medium
phase: "F"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-245
plan: PLAN-245
---
AC-DR-10. WeightTableService's one-live-document-per-kind check (packages/lore/src/service/weight-table-service.ts ~:10, ~:131) counts a deprecated or invalidated table as live, so a replaced table can never be superseded (found 2026-10-28: after lore invalidate --superseded-by the kind stayed held). Live = not deleted, not archived, not deprecated, not invalidated (extra.validity). Add AC-DR-10 cases: a deprecated table and an invalidated table no longer hold their kind.
