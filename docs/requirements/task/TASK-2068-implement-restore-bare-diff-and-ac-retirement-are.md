---
id: TASK-2068
type: task
role: plan
title: "[implement] Restore, bare diff and AC retirement are gap-aware; restore keeps working state"
status: approved
priority: high
phase: "Phase 3: Readers"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-258
plan: PLAN-258
links:
  - {id: TASK-1976, type: blocks}
  - {id: TASK-2057, type: blocks}
---
Estimate: M
Approach: per spec Scope 4-5 and ADR D4, D6.
Source: version-service.ts (restore at ~268, diff default at ~131), retired-ac-service.ts (~305-309), keepStoredPlanProgress (store/plan-progress.ts, keep it).
Covers: AC-HC-3, AC-HC-4, AC-HC-9

## Work
- Restore: content/title/content keys from version n, remove content keys n lacked, keep current working-state keys (WORKING_STATE_KEYS).
- Bare diff: from = closest earlier existing row; explicit missing n still exit 3 (CLI, MCP, HTTP).
- retired-ac-service: previous row = latest row below new_version.
- Stored version numbers with no row (review judgment doc_version, calibration) resolve to the closest earlier row wherever a row is read for them.

## AC
- AC-HC-3, AC-HC-4, AC-HC-9 commands pass, red first.
