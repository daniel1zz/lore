---
id: TASK-169
type: task
role: plan
title: "[Skill:implement] T5 MountRegistry: probe-classify-mount lifecycle"
status: archived
priority: critical
phase: "Phase 2: Server wave"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
links:
  - {id: TASK-166, type: blocks}
---
Estimate: M
Approach: packages/lore/src/mount/mount-registry.ts implementing the T3 interface: load machine config → validate → per-entry readonly PRAGMA user_version probe (probeUpstreamDb pattern, packages/lore/src/flows/upstream-probe.ts:54) → parallel createApp via Promise.all for mountable entries → Map<name, MountEntry> with per-entry state + runtime error transition + ordered close() fan-out. bun-only module (loader.ts discipline); never imported by routes.ts.
Source: spec-078 D2 + Components table; T4 RED tests define behavior.
Dimensions: D-FUNC, D-CODE
Scope-Alt: runtime re-probe of a failed mount (recovery without restart) is out — restart-only per D6.
Covers: AC-078-1

AC:
- Given T4's RED suite, When implementation lands, Then tests/unit/mount/mount-registry.bun.test.ts is GREEN with all scenario cases matched (no under-match).
- Given typecheck, Then tsc --noEmit 0 errors.
- Integration: MountRegistry is constructed only by the dashboard command path (T8 wires it); no import from vitest-reachable modules — verified by the existing import-graph conventions.
