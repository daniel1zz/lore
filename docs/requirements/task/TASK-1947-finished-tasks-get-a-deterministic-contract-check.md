---
id: TASK-1947
type: task
role: plan
title: "Finished tasks get a deterministic contract check; an unstarted task is judged on intent only (AC-LND-7)"
status: deprecated
priority: high
phase: "P3 Land, dispatch, log, drift"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1948, type: blocks}
---
Covers: AC-LND-7
TDD-Role: green
Approach: ReviewService routes a task past done to a deterministic contract check (every contract oracle has an attested pass at the landed commit; the red row exists when required) and does not call the AI judge; an unstarted task is judged on intent only and the evidence_completeness dimension is not applied to it (#195, #408), so approve needs no override and the audit row records none. The execution log (previous tasks) supplies the landed commit. commands/review.ts renders the deterministic verdict in the same task.
Done when: AC-LND-7 passes through the compiled binary; typecheck passes.
