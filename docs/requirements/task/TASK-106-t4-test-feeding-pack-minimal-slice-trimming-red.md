---
id: TASK-106
type: task
role: plan
title: "T4-test: feeding-pack minimal-slice trimming (RED)"
status: archived
priority: medium
phase: Phase 2 — feeding asset
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-024
plan: PLAN-024
links:
  - {id: TASK-098, type: blocks}
---
Approach: vitest for the trimming fn used by T2 assembly.
Source: spec §4.1, §6 boundary ②③.
AC: RED. Asserts output ≤ N chars, contains [source/trust] header, excludes parent full body (assert a known long-body marker absent), keeps title+summary+AC pointers only.
Estimate: S
