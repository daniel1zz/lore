---
id: TASK-099
type: task
role: plan
title: "T1: gate-predicates.ts pure predicates"
status: archived
priority: high
phase: Phase 1 — gate kernel
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-024
plan: PLAN-024
links:
  - {id: TASK-105, type: blocks}
---
Approach: implement pure fns parentLegal(parent)/specKindValid(kind)/hasSkeleton(content) → {ok:true} | {ok:false,reason}. No IO, no store.
Source: spec §4.1.
AC: T1-test GREEN. parent missing→{ok:false,reason:"PARENT_REQUIRED"}; spec_kind∉{feature,tech,design}→invalid; content lacks required headings→invalid; compliant→{ok:true}. vitest green.
Estimate: S
