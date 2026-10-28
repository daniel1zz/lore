---
id: TASK-1943
type: task
role: plan
title: "lore migrate done-contract compiles contracts for in-flight approved tasks, preview first (AC-DCT-10)"
status: deprecated
priority: high
phase: "P2 Contract, kinds and implementer verbs"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1944, type: blocks}
---
Covers: AC-DCT-10
TDD-Role: green
Approach: migrateDoneContracts(apply) in done-contract-service.ts compiles a contract for every approved, non-archived task, returning the contract or the causes per task; preview writes nothing; apply writes one version per task through the dedicated writer and a second apply writes nothing; a task whose claim history is a no-branch claim gets kind check. commands/migrate.ts gains the done-contract action in the same task, mirroring the preview/--apply shape of the existing config-keys and plan-outline-exempt migrations (BR-1305, BR-1306).
Done when: AC-DCT-10 passes through the compiled binary; typecheck passes.
