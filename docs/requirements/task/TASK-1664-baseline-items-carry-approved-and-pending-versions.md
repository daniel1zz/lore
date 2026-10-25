---
id: TASK-1664
type: task
role: plan
title: "Baseline items carry approved and pending versions; every deciding reader goes through one approved-version accessor; the upgrade converts nodes once"
status: archived
priority: high
phase: "P1"
created: 2026-10-19
updated: 2026-10-20
tags: []
parent: PLAN-219
plan: PLAN-219
links:
  - {id: TASK-1634, type: blocks}
---
Implements end state items 1, 6, 7 of spec-baseline-approval-is-per-item-an-edit-adds-a-pending (BR-1340, BR-1341). Item model in baseline.ts: each rule and the node's own part (title, body, label, glossary, depends_on, commands) has an approved version (absent for a new item) and at most one pending revision. New accessor module service/baseline-items.ts returns approved versions; every deciding reader (coverage + floor script, citations/cite gate, rule state, governing feeds, resume diffs, fidelity, dependency and removal checks, exports, MCP/HTTP/dashboard reads) uses it. Registry triggers/index rows follow approved versions only (a pending add stays proposed). One-time conversion in the schema upgrade (lore migrate schema only): approved node -> all approved; draft node -> approved from its last approved version, differences pending; never approved -> all pending; second run no-op. Do not touch site_map code (lore-40's D1 deletes it). Writes/review/approve are T2.
