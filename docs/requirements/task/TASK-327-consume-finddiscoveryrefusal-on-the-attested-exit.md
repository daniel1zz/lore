---
id: TASK-327
type: task
role: plan
title: "Consume findDiscoveryRefusal on the attested exit-nonzero branch so a refusal records inconclusive, never fail"
status: archived
priority: medium
phase: "mechanism"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-079
plan: PLAN-079
---
`verify-runner-service.ts` gates its completeness block on `executedSuccessfully`, with this comment: *"Runs ONLY when the process actually exited 0 (a nonzero exit/timeout is already fail, completeness is irrelevant to it)"*. That assumption IS the defect.

⛔ THE COMMENT IS PART OF THE DELIVERABLE. It states a rationale that this task falsifies; leaving it in place creates a stale assertion that will mislead the next reader.

Seam: `VerifyRunnerService` constructor arg 3 (`executor`). `verify-completeness.test.ts` already drives it with a scripted fake (`makeExecutor([ok({exitCode, outputTail, ...})])`) — extend THAT file, do not add a new one. No process spawn needed.

⛔ RED FIRST IS MANDATORY AND MUST BE RECORDED BY YOU, AT THE MOMENT IT IS RED: run the new AC-OX-2 test against the UNMODIFIED source, observe it record `fail`, and log it with `lore evidence <task> --oracle test --command "..." --result expected-fail`. A red transcribed later by someone else does not count.

AC-OX-3 is the counterweight: a genuine `Test Files 1 failed (1)` tail with exit 1 must STILL record `fail`. AC-OX-8 pins `deriveAcCoverageState`'s precedence byte-unchanged — only the RECORDING layer moves; 58 `fail_superseded` + 590 `attested_pass` must not reclassify.
