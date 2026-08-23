---
id: TASK-785
type: task
role: plan
title: "[Skill:implement] ReceiptLogV2 two-phase log on a new path, legacy rows still readable"
status: archived
priority: high
phase: "P2: Intake"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-774, type: blocks}
---
Estimate: M
Approach: a new append-only JSONL file, distinct path from the existing receipt log, carrying two line kinds discriminated by phase: intent {idempotency_key, title, at} written BEFORE the network call, and outcome {idempotency_key, number, url, at} written after. The existing receipt-log module and its 12 legacy rows are left untouched and still readable.
Source: spec Scope entry `ReceiptLogV2`; the .strict() constraint measured at service/receipt-log.ts:53-59
Dimensions: D-FUNC, D-CODE
Scope-Alt: the truncated-final-line tolerance can ship as a reported error rather than a recovered prefix
Covers: AC-GI-3

AC:
- Given the anchored test file from the paired red task, When it runs, Then all five cases pass
- Given the invariant that zero upstream writes precede a successful create, When the intent line is written first, Then the only thing written before the network call is a LOCAL append — no upstream write, deliberately breaking only the local half of the old invariant
- Given a read of both logs, When the v1 file exists, Then its rows are returned alongside v2 rows without a schema error
- A full-repo typecheck is exit 0

Integration: the intent-before-call ordering is only real once the intake port calls it. The port task asserts the ordering end to end; this task asserts the log's own contract.
