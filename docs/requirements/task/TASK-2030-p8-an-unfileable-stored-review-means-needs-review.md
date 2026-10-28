---
id: TASK-2030
type: task
role: plan
title: "P8 an unfileable stored review means needs review; one plan never blocks the batch"
status: archived
priority: medium
phase: "P"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
---
Resolves #349.

A stored review that cannot be filed (a failed regression without suite_failing_files) is not a valid review. The trigger set treats that plan as needing review (the next batch re-reviews it, which stores a complete review), exactly like a review error. One plan's bad record never fails the trigger set or the batch for other plans: classification is per plan, and a per-plan problem is recorded as that plan's milestone-batch-error audit row.

Live repro: landing bfadf5c2 printed "integrate: WARNING: the review batch was not started: VALIDATION_ERROR the stored review knowledge-milestone-review-lean-governance-batch-verbs-3 failed regression on a measured suite run but lacks suite_failing_files".

Tests (plan-progress.test.ts, AC-PCR-5 title): two complete plans, one with such a stored review → the trigger set contains both, the bad one as needs-review; the batch re-reviews it and the other plan is processed normally.
