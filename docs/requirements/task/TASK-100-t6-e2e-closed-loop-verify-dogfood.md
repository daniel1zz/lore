---
id: TASK-100
type: task
role: plan
title: "T6: e2e closed-loop + verify dogfood"
status: archived
priority: high
phase: Phase 3 — hook bridge + loop
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-024
plan: PLAN-024
---
Approach: tests/e2e/spec-loop.e2e.ts drives the full loop on a throwaway corpus (mkdtemp + lore init); then lore verify self-acceptance of the spec ACs.
Source: spec §9 AC6.
AC (=AC6): seed rule doc + PRD parent → agent no-parent create BLOCKED → retry with parent+kind SUCCEEDS → no-AC approve BLOCKED → ac add → approve SUCCEEDS. ⛔ throwaway corpus only, zero writes to repo .lore (INV4). lore verify on this spec → attested pass for AC1–AC6.
Integration: proves the Inversion-of-Control loop runs in a real session.
Estimate: M
