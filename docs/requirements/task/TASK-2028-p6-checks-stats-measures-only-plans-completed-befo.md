---
id: TASK-2028
type: task
role: plan
title: "P6 checks stats measures only plans completed before acceptance"
status: archived
priority: medium
phase: "P"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
---
Resolves #347.

lore checks stats "Plan acceptance" measures only plans whose complete time precedes their acceptance. Migration 035 backfilled progress.at for every plan, so a plan archived before progress tracking has no measurable complete time and is not listed (today ~40 rows show Complete 2026-10-23 > Accepted 2026-07-07, Took 0m). The complete time is when progress last became complete by a task write, not the backfill.

Test (plan-progress.test.ts, AC-PCR-6 title): a plan archived before its progress.at is not listed; a plan completed then accepted shows the exact duration.
