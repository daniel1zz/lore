---
id: TASK-103
type: task
role: plan
title: "T3-test: gate spec-promote gate + judge-advisory (RED)"
status: archived
priority: high
phase: Phase 1 — gate kernel
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-024
plan: PLAN-024
links:
  - {id: TASK-102, type: blocks}
---
Approach: bun test on throwaway corpus.
Source: spec §4.1, §9 AC3/AC4.
AC: RED. no-AC spec→exit 4; ≥1 AC→exit 0 AND judge advisory appears on stderr while exit stays 0.
Estimate: S
