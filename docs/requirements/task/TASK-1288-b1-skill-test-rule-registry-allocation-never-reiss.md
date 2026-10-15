---
id: TASK-1288
type: task
role: plan
title: "[B1] [Skill:test] rule registry allocation, never-reissue, move — RED"
status: archived
priority: critical
phase: "Phase B: store"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-172
plan: PLAN-172
---
Estimate: S
Source: Spec: `spec-baseline-slice-1-rules-with-permanent-ids-ac-citations` (read it first: `lore get spec-baseline-slice-1-rules-with-permanent-ids-ac-citations`). §C2, QA-1
TDD-Role: red | Paired-Impl: B2
Covers: AC-BLS1-1

Scenarios (run against SQLiteStore on a temp file, and InMemoryStore; Turso variant if the repo already has a local libsql test harness — otherwise state that it is not covered):
- Given 8 concurrent `allocateRuleAndUpdateLeaf` calls across 2 leaves, Then 8 distinct ids or loud CONFLICT errors, 0 duplicates.
- Given a leaf whose CAS fails, Then no registry row is left behind (allocation rolled back).
- Given BR-3 allocated then retired, then the leaf soft-deleted, When allocating again, Then the new id is not BR-3 (n strictly increases).
- Given moveRule(BR-2, leafA, leafB), Then BR-2 appears only in leafB extra and registry leaf_doc_id = leafB, in one transaction (a forced failure leaves both unchanged).
- Falsifier to declare after red: replacing the in-transaction MAX(n)+1 with a pre-read outside the transaction must turn the concurrency scenario red.

AC:
- All scenarios are executable tests in the anchored file.
- Running the file's command yields every scenario RED, and each failure message names the missing behaviour (not a syntax/import error in the test itself).
- Record `lore evidence <this-task> --result expected-fail --oracle test --command "<cmd>"` AT THE MOMENT it runs red (not transcribed later).
