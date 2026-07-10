---
id: TASK-098
type: task
role: plan
title: "T4: seed write-spec rule doc + minimal-slice trimming"
status: archived
priority: medium
phase: Phase 2 — feeding asset
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-024
plan: PLAN-024
links:
  - {id: TASK-100, type: blocks}
---
Approach: scripts/seed-write-spec-rule.ts seeds ONE knowledge/reference doc (status approved) holding write-spec rules; service/gate-feeding.ts trims rule+parent into a pointers+summary slice with [source/trust] header. Only approved rule docs are feedable.
Source: spec §4.3, §6, §7 (tamper mitigation).
AC: T4-test GREEN. seed script creates exactly one approved knowledge/reference doc (idempotent re-run = no dup); trimming fn output satisfies ≤N chars + [source/trust] header + no full parent body.
Estimate: M
