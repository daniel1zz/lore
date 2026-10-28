---
id: TASK-2119
type: task
role: plan
title: "P12 milestone review judge timeouts measured and fixed at the cause"
status: deprecated
priority: medium
phase: "P"
created: 2026-10-24
updated: 2026-10-25
tags: []
parent: PLAN-268
plan: PLAN-268
---
Resolves #355.

In the batch on 2ec2b0b7 the milestone review judge timed out ("provider claude-cli timeout: process killed after 180000ms") for at least 6 plans (audit rows 73147, 73149, 73150, 73152, 73163, 73164); the first batch completed reviews. Measure the root cause before changing anything: per-plan prompt size (bytes/tokens) for the failing plans vs the passing ones, judge wall time, whether calls run concurrently, whether the host slept (compare wall clock gaps). Fix the cause (e.g. bound the review input like C1/C2 bounded handoff/bootstrap, or split per dimension) rather than raising the timeout. If the measured cause is host sleep only, say so with the evidence and make the batch treat a timeout as a review error retried by the next batch (it already is) without code change.

Test: the measured cause has a regression test (e.g. the review input for a large plan stays under the bound).
