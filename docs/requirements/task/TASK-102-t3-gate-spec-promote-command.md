---
id: TASK-102
type: task
role: plan
title: "T3: gate spec-promote command"
status: archived
priority: high
phase: Phase 1 — gate kernel
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-024
plan: PLAN-024
links:
  - {id: TASK-101, type: blocks}
---
Approach: gate.ts spec-promote subcommand; ac list existence gate; on pass optionally trigger SPEC-034 judge writing advisory to stderr, never changing exit.
Source: spec §4.1.
AC: T3-test GREEN. no-AC→exit 4; ≥1 AC→exit 0 + stderr judge advisory, exit unchanged (INV2). Same file as T2 (gate.ts) → serial after T2.
Integration: reachable as `lore gate spec-promote --spec <id>`; consumed by G2 hook (T5).
Estimate: M
