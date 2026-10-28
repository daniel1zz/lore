---
id: TASK-2054
type: task
role: plan
title: "[implement] Migration removes the retired extra.site_map from current baseline state (#362)"
status: approved
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-257
plan: PLAN-257
links:
  - {id: TASK-2057, type: blocks}
---
Estimate: M
Approach: follow the migration-028 / migration-038 precedent (versions row + audit row per converted doc).
Source: spec Scope 9; packages/lore/src/store/migrations/migration-038.ts; audit-service.ts update completeness family (migrate-schema-028/029 entries).
Covers: AC-CP-5

## Work
- New schema migration (next free number at landing) removing extra.site_map from every non-deleted baseline doc, one content write each; audit action added to the update completeness family.
- Register it in the three stores' migration chains.

## AC
- AC-CP-5 command passes, red first. After landing, the orchestrator runs `lore migrate schema` on this corpus and AC-RIC-6 turns green.
