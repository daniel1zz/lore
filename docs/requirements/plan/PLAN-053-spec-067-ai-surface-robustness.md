---
id: PLAN-053
type: plan
role: plan
title: "Plan — SPEC-067 AI-surface robustness"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: SPEC-067
phases:
  - {name: "provider"}
  - {name: "judge"}
---
# Plan — SPEC-067 AI-surface robustness

## Goal
Implement SPEC-067: timeout floor 180s, partial-provider fail-loud at registry build, mechanical grounding/truncation downgrades in assessment finalization.

## Phases
- provider: D1 timeout + D2 registry validation
- judge: D3 grounding + D4 truncation downgrades

## Oracle
AC-067-1..6 green via lore verify.
