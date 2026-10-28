---
id: TASK-2002
type: task
role: plan
title: "Verify AC-DC-6 against the landed main-red ledger"
status: archived
priority: medium
phase: "Recorders"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-255
plan: PLAN-255
---
## Objective
Bind AC-DC-6 of the successor spec to an attested run: the code and its oracle `packages/lore/tests/integration/cli/assess-main-red-record.bun.test.ts` already landed with task-milestone-review-records-main-red-locally (plan-evaluation-3, archived; its evidence is bound to S-C's AC-DC-6). No code change: run `lore verify plan-evaluation-3b-delivery-and-concurrency-metrics-fed-by-live` (AC-DC-6 only in scope) on main; if the oracle is red, this task stops and is reported, never edited to pass.

Spec: spec-delivery-concurrency-and-autonomy-metrics-fed-by-live (BR-1444).

Covers: AC-DC-6
