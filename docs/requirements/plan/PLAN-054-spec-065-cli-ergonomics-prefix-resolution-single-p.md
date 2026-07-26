---
id: PLAN-054
type: plan
role: plan
title: "Plan — SPEC-065 CLI ergonomics: prefix resolution + single-pass task validation"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: SPEC-065
phases:
  - {name: "service"}
  - {name: "cli"}
---
# Plan — SPEC-065 CLI ergonomics

## Goal
Implement SPEC-065: service-level unique ID-prefix resolution + pending slug column + single-pass create-task validation with parent inference.

## Phases
- service: store prefix lookup + resolveDoc (D1/D2)
- cli: pending output (D3) + create-task validation (D4)

## Oracle
All 7 script ACs (AC-065-1..7) green via lore verify; bun run test + typecheck green.
