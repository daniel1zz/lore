---
id: TASK-1598
type: task
role: plan
title: "[Skill:fix] BL-D2 one-time migration retires the legacy outline-sync exemption field so BR-250's refusal and listing can go (baseline-close-a-plan)"
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
Approach: baseline-close-a-plan BR-250 keeps a refusal and a listing for the legacy outline-sync exemption field. Review 2026-10-18 (reject 0.80): "a one-time migration… makes the refusal and the listing unnecessary". Write the migration that rewrites or removes the legacy field on every stored plan, then retire BR-250's refusal path and the listing, and update the leaf.
Source: leaf re-approval 2026-10-18 (scratchpad leaves/rv3-baseline-close-a-plan*)
AC: migration test (red-first) — a plan carrying the legacy field is migrated; the refusal code path and listing are gone (grep); leaf updated.
