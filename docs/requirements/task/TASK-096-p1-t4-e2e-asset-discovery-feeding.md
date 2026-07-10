---
id: TASK-096
type: task
role: plan
title: "P1-T4: e2e asset discovery + feeding"
status: archived
priority: high
phase: Phase 3 - closed loop
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-023
plan: PLAN-023
---
Approach: e2e (throwaway corpus) — create a knowledge/skill (applies_to=spec, approved) via API → trigger a violating spec-create gate → assert the feeding pack quotes THAT skill, discovered by applies_to (not title). ⛔ zero repo .lore writes.
AC (=AC-P1-4): full loop green.
Estimate: S
Depends: P1-T2, P1-T3
Files: packages/lore/tests/integration/p1-asset-loop.bun.test.ts
