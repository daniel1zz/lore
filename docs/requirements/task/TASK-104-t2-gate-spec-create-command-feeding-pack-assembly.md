---
id: TASK-104
type: task
role: plan
title: "T2: gate spec-create command + feeding-pack assembly"
status: archived
priority: high
phase: Phase 1 — gate kernel
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-024
plan: PLAN-024
links:
  - {id: TASK-103, type: blocks}
  - {id: TASK-101, type: blocks}
---
Approach: cli/commands/gate.ts spec-create subcommand; calls gate-predicates; on fail assembles feeding pack via renderResolvedToMarkdown (trimmed) + parent slice; exit via exitCode() SSOT (utils.ts:66).
Source: spec §4.1, §3.
AC: T2-test GREEN. no-parent→exit 4 + stdout feeding pack with [source/trust] header + rule slice; compliant→exit 0; LORE_GATE_BYPASS=1→exit 0.
Integration: reachable as `lore gate spec-create --input-json <toolInput>`; consumed by G1 hook (T5).
Estimate: M
