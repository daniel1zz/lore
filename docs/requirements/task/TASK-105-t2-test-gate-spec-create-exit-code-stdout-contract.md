---
id: TASK-105
type: task
role: plan
title: "T2-test: gate spec-create exit-code + stdout contract (RED)"
status: archived
priority: high
phase: Phase 1 — gate kernel
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-024
plan: PLAN-024
links:
  - {id: TASK-104, type: blocks}
---
Approach: bun test (bun:sqlite via throwaway corpus) asserting exit code + feeding-pack stdout.
Source: spec §4.1, §9 AC1/AC2/AC5.
AC: RED. Asserts no-parent→exit 4 AND stdout contains "[source:"; compliant→exit 0; LORE_GATE_BYPASS=1→exit 0.
Estimate: M
