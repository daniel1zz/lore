---
id: TASK-461
type: task
role: plan
title: "[Skill:implement] context-projection pure module — parse render splice with five-state and fingerprints"
status: archived
priority: medium
phase: "Phase 1: Pure Core"
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: PLAN-088
plan: PLAN-088
---
Objective: implement parseManagedSections/renderManagedSections/spliceManagedSections per spec-context-verb-family-two-zone-claude-md-anatomy-lore Public Interface — PURE (zero IO, zero store). Fingerprint = first 8 hex of sha256 over section body EXCLUDING the fingerprint line. Green oracle: AC-CTX-1 command (bunx vitest run packages/lore/tests/unit/service/context-projection.test.ts) — assert matched file count is 1.
