---
id: TASK-2035
type: task
role: plan
title: "Q1 a fixed covering issue sends its plan back to review"
status: archived
priority: medium
phase: "Q"
created: 2026-10-24
updated: 2026-10-26
tags: []
parent: PLAN-269
plan: PLAN-269
---
Resolves #394.

A complete plan whose latest review failed a dimension that was covered by a linked issue which is now CLOSED (the defect was fixed) needs review again: the fixed issue is new input. Classification (review-batch-service.ts listCompletePlans / the single coverage predicate from P13) returns needs-review for it, not filing; the next batch re-reviews against current main and then accepts or files what remains. Filing never re-links a closed issue (dedupe matches OPEN issues only).

Live: plan-the-approval-judge-rejects-patch-shaped-designs (regression covered only by closed #351) and plan-defect-clusters-round-1 (snapshot_accuracy covered only by closed #361) are refused at close on every batch.

Tests (plan-progress.test.ts, AC-PCR-5 title): a failed plan whose only covering issue for a dimension is closed → classified needs-review and re-reviewed by the batch; a passing re-review archives it as accepted; filing with a closed issue of the same fingerprint files a new issue rather than linking the closed one.
