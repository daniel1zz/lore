---
id: TASK-1839
type: task
role: plan
title: "Design: a merge that adds an unmapped census site is refused, so baseline completeness cannot silently regress"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
> ⚠ INVALIDATED 2026-10-19T06:50:39.441Z — superseded by plan-complete-coverage-integrate-floor; Delivered by plan-complete-coverage-integrate-floor (archived 2026-10-19): the integrate floor step check:baseline-coverage refuses a merge whose merged tree leaves an unaccounted pair or undeclared command (BR-1248 live, AC-BCR-1..6 verified).

Lesson 2026-10-19: root coverage reached complete=true (123/123 leaves ok) on 2026-10-18 and was back to 0/124 ok the next morning: overnight merges (autonomy decision/override/calibration, invocation) added 84 census sites reached by almost every command through app wiring. Nothing refused those merges (NOT ENFORCED in the plan's Open items). End state wanted: the author of a change that adds or changes a refusal site maps it (rule, owned-by, or non-business reason) in the same change, and a merge that leaves an unmapped site is refused with the site keys named. Constraints from the North Star: the check must be incremental and cheaper than a full root census (~10 min), concurrency-safe (two merges at once), and attributable to the merging change. Candidate shape to evaluate: census diff of the changed files only (sites added/changed vs main) checked against all site_maps, run in hooks/pre-push and at lore done. Needs a spec (product gate) before implementation.
