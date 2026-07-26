---
id: TASK-118
type: task
role: plan
title: "T4 — adversarial tamper suite (independent tester): audit-tamper.bun.test.ts"
status: archived
priority: medium
phase: "Wave 2 — verify + anchor + adversarial"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-030
plan: PLAN-030
---
Implements AC-079-4 as an INDEPENDENT tester-agent task (six-dimension + failure-first discipline): direct sqlite3 UPDATE of one audit row -> verify reports hash_mismatch at that id; paired DELETE of versions+audit rows -> chain break; forged appended row with fabricated hashes -> prev_link_mismatch; plus boundary (empty table, single row, genesis) and clean-path negative controls. Test-only task: writes exactly one new bun test file, no source changes.
