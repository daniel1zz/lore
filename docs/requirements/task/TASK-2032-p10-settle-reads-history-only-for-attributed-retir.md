---
id: TASK-2032
type: task
role: plan
title: "P10 settle reads history only for attributed retirements; stale owner decisions are withdrawn"
status: archived
priority: medium
phase: "P"
created: 2026-10-24
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
---
Resolves #353, #354.

1. #353: retired-ac-service settle computes previous_status (version history) for every deprecation in the plan's time range before filtering by retired_in_plan, so old deprecations with missing history error unrelated plans (audit rows 73165/73166: "spec-version-history has no version 4"). Filter by retired_in_plan first; read history only for attributed retirements.
2. #354: an awaiting-owner plan whose pending ac-retire-confirm decision lists retirements different from its current attributed list is in the trigger set, so the batch's settle withdraws the stale decision (P4's withdrawPending). Today decisions 543, 545, 547, 551, 552 stay pending because those plans are never settled.

Tests (milestone-review.test.ts, prefix 'milestone review gates close'): an unattributed old deprecation with no version history does not error settle; an awaiting-owner plan with a stale decision enters the trigger set and its decision is withdrawn.
