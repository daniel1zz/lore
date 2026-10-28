---
id: TASK-1941
type: task
role: plan
title: "lore finish runs every contract oracle, reports all unmet, and --red records runner-produced reds (AC-DCT-6..8)"
status: deprecated
priority: high
phase: "P2 Contract, kinds and implementer verbs"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1950, type: blocks}
---
Covers: AC-DCT-6, AC-DCT-7, AC-DCT-8
TDD-Role: green
Approach: add finishTask(task) to done-contract-service.ts: (1) measure the working copy's cleanliness with the same measureWorktreeCleanliness the release guard uses and refuse before running anything; (2) run each contract oracle through the existing capture path (recordVerifiedEvidence / capture) so rows are runner-attested; (3) collect every unmet item instead of returning the first (the done floors keep their first-unmet order; finish shares the predicates and only changes the reporting); (4) record evidence, then release through TaskWorkflowService.release. finish --red runs the red stage and records expected-fail only through the existing red-row guards (BR-1077). commands/finish.ts is registered in adapters/cli/index.ts in the same task and is the only entry point the ACs use.
Done when: AC-DCT-6, AC-DCT-7 and AC-DCT-8 pass through the compiled binary; typecheck passes; scoped run of the existing task-workflow-service tests is green.
