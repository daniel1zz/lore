---
id: TASK-2089
type: task
role: plan
title: "Remove the evidence pre-check from review; record the legacy archived-without-evidence set once"
status: draft
priority: high
phase: "P2 Classification"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-264
plan: PLAN-264
links:
  - {id: TASK-2116, type: blocks}
---
Covers: AC-JV-6, AC-JV-7
Resolves: #408 (merged into this spec per user decision D20; the separate #408 spec and plan are deprecated).
Approach: delete checkEvidenceCompleteness and its entry; runDeterministicChecks returns the literal 'return [schema, parentContract, treePosition, linkIntegrity];' (falsifier). Every consumer of the five-entry list (review service, gate advisory, milestone review inputs, stored judgment rendering) follows: scoped floor = every importer of review-checks.ts. One-time integrity record: from the shared checkout, capture the legacy set as evidence on THIS task: lore evidence <this task> --oracle other --command "sqlite3 -readonly .lore/lore.db \"select slug from docs where type='task' and deleted_at is null and status='archived' and coalesce(json_array_length(json_extract(extra,'$.verification_evidence')),0)=0\"" --result pass --capture (23 rows on 2026-10-26). Those tasks are history and are not rewritten.
