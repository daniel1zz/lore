---
id: TASK-1596
type: task
role: plan
title: "[Skill:fix] BL-D4 plan close with no linked assessment no longer passes the freshness condition silently (BR-225 vacuous pass)"
status: draft
priority: medium
phase: "P3-stale-and-draft"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-206
plan: PLAN-206
---
Estimate: S
Approach: baseline-close-a-plan BR-225: a plan with no linked assessment passes the assessment-freshness condition with no notice (gate-predicates.ts:1671-1673) — a vacuous pass indistinguishable from a real one, which the North Star forbids ("vacuously true" must be distinguishable from "true"). End state: the close prints that freshness was not applicable because no assessment is linked (or refuses, if the plan's close requires an assessment — the existing fresh-assessment rule decides which); never a silent pass. Update the leaf.
Source: leaf re-approval 2026-10-18 (scratchpad leaves/rv3-baseline-close-a-plan*)
AC: red-first test: close of a plan with no assessment shows the not-applicable line (or the refusal) instead of a silent pass; leaf updated and re-approved together with BL-D2/BL-D3.
