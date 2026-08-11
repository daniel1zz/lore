---
id: TASK-677
type: task
role: plan
title: "Update the five toEqual assertions that still pin the pre-oracle-generation AcCoverageFact shape"
status: archived
priority: medium
phase: "cap-honesty"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-127
plan: PLAN-127
---
Fallout of the M5 landing, reported rather than hidden by its implementer: five exhaustive toEqual assertions pin AcCoverageFact's pre-change shape and cannot survive the mandated new key. Add ONLY the new oracle_generation key to each expected literal — ⛔ weaken no assertion, relax no toEqual to toMatchObject. Sites: acceptance.test.ts:386/394/395/418, task-feed-wiring.test.ts:495 (AC-1 {current:1,current_refs:2,prior_refs:0}, AC-2 {current:1,current_refs:1,prior_refs:0}), outline-service.test.ts:1063. Re-derive each expected value from the code rather than trusting these literals. No new AC: this restores an existing oracle, it does not add one.
