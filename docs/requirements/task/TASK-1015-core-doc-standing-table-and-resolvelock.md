---
id: TASK-1015
type: task
role: plan
title: "Core: doc-standing table and resolveLock"
status: archived
priority: medium
phase: "core-and-gate"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-160
plan: PLAN-160
links:
  - {id: TASK-1007, type: blocks}
---
Covers: AC-DR-1, AC-DR-8. Spec: spec-documents-are-living-or-records-a-locked-record-is-never §Public Interface, D1, D2, D5. New packages/core/src/doc-standing.ts: DocStanding, StandingRule (fixed | by-sub-type | by-plan-state), exhaustive DOC_TYPE_STANDING and KNOWLEDGE_SUB_TYPE_STANDING, LockInput (everApproved / everClaimed / planStatus / subType — each REQUIRED for the kinds that need it, missing → throw, never a default), resolveLock with a never-default switch. NO user-facing prose here (refusal text lives in the service checkpoint feed — D18). schemas.ts: add REOPEN_ALLOWED_TYPES = ['spec'] + isReopenTransition; leave VALID_TRANSITIONS unchanged (approved→draft stays refused for generic status moves). Browser-safe: no Node builtin. Export from index.ts. Red-first: write doc-standing.test.ts, run it red, record lore evidence --result expected-fail at that moment.
