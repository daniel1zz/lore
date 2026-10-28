---
id: TASK-2049
type: task
role: plan
title: "[implement] Working-state key list, isContentChange and state_change builder in @lore/core"
status: archived
priority: critical
phase: "Phase 1: Foundation"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-258
plan: PLAN-258
links:
  - {id: TASK-2050, type: blocks}
---
Estimate: M
Approach: per spec spec-history-records-content-a-working-state-only-write-adds-no Scope 1-3 (key list, isContentChange, state_change shape).
Source: spec Scope 1-3; ADR D1-D3.
Covers: AC-HC-2

## Work
- New `packages/core/src/working-state.ts`, no imports (browser-safe barrel): `WORKING_STATE_KEYS: Record<DocType, readonly string[]>` exactly as spec Scope 1; `isContentChange(type, before, after)` per Scope 2 (every docs column except version, updated_at, fts_*; extra minus the type's keys, deep-equal ignoring key order); `buildStateChange(type, beforeExtra, afterExtra)` returning `{ keys, values, previous, appended, removed }` per Scope 3 (array-prefix → appended; deleted → removed + previous; otherwise values + previous).
- Export from the `@lore/core` default barrel. Check `packages/core/src` for an existing stable-stringify / deep-equal helper before writing one.
- `DocType` keys: use the existing DocType union so a new type fails compilation until classified.

## AC
- AC-HC-2 command passes (packages/lore/tests/unit/core/working-state.test.ts), red first.
- Unit cases for buildStateChange: evidence append → appended only; landing replaced → values + previous; claim deleted → removed + previous; no change → keys [].
- barrel-isolation test stays green.
