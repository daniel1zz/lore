---
id: TASK-313
type: task
role: plan
title: "T1 — GateEnforcer skip-audit port + lore gate env-bypass trace"
status: archived
priority: medium
phase: "Wave 1"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-075
plan: PLAN-075
---
SPEC-080 G4 (AC-080-1, AC-080-2). GateEnforcer optional recordGateSkip port wired only in app.ts from store.appendAuditEntry; best-effort fail-open loud-on-failure (D1); gate_skipped details {checkpoint, mechanism, target?} (D2); action joins NO verify family. lore gate LORE_GATE_BYPASS=1 keeps unconditional exit 0 but best-effort writes the env_bypass entry, stderr not-audited line when store unreachable (D3). Service layer does NOT honor LORE_GATE_BYPASS — unchanged.
