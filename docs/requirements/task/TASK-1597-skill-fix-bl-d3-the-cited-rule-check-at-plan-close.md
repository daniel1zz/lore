---
id: TASK-1597
type: task
role: plan
title: "[Skill:fix] BL-D3 the cited-rule check at plan close gets a setting named for it, retiring BR-226's borrowed switch (baseline-close-a-plan)"
status: archived
priority: medium
phase: "P3-stale-and-draft"
created: 2026-10-18
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Estimate: S
Approach: baseline-close-a-plan BR-226: the cited-rule check at plan close is switched by a setting named for something else. Review 2026-10-18 (reject 0.80): "a setting named for the cited-rule check, with BR-226 retired". Introduce the correctly named setting (read once, one source), migrate configs that use the old name, retire BR-226, update the leaf.
Source: leaf re-approval 2026-10-18 (scratchpad leaves/rv3-baseline-close-a-plan*)
AC: red-first test on the new setting; old name migrated with a named notice; leaf updated.
