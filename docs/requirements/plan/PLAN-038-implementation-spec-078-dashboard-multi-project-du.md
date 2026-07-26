---
id: PLAN-038
type: plan
role: plan
title: "Implementation — SPEC-078 dashboard multi-project (dual-wave)"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-26
tags: []
parent: SPEC-078
phases:
  - {name: "Phase 1: Contracts & spikes", description: "Three parallel roots: D9 busy_timeout hardening (sqlite-store.ts); D8 deleted-corpus liveness spike (empirical pin: throw vs hang); Q3 contract layer — GlobalLoreConfigSchema.dashboard.projects + MountState/MountEntry/MountRegistry interface + /api/projects response types. Contract task T3 gates BOTH waves."}
  - {name: "Phase 2: Server wave", description: "MountRegistry implementation (packages/lore/src/mount/, bun-only, probe-before-createApp hard gate), machine-scope auth store + bootstrap re-point (D1 unconditional), path shim + /api/projects route + R-17 dispatch boundary (consumes T2 spike conclusion). TDD-paired: RED tests block implementations. Runs in parallel with Phase 3 (disjoint anchors)."}
  - {name: "Phase 3: Client wave", description: "Factory triple (apiFetch/queryKeys/useProjectParam) + full call-site migration + ESLint raw-literal rule; then switcher UI + persistent project identity + pending badges + /p/:name routing. Consumes T3 contract types only, never server runtime — parallel with Phase 2."}
  - {name: "Phase 4: Integration & verification", description: "Two-corpus e2e fixture (registry over 2 mkdtemp corpora, assertServerIsOurs extended) + isolation/writes/cache suites + registry-less route-shape pin; then lore verify (attested), full vitest+bun+e2e on main, doc sync (CLAUDE.md layers), spec code anchors post-landing."}
links:
  - {id: SPEC-078, type: implements}
---
# Plan — SPEC-078 dashboard multi-project implementation

## Overview

Implements spec-078-dashboard-multi-project-mount-registry-machine-scope (PRD §22, R-11..R-17, G16) via Interface-First dual-wave decomposition (owner-selected strategy B, 2026-07-25): contracts + spikes first, then a server wave and a client wave in parallel worktrees, then integration e2e + full verification.

## Invariants

1. No write to any registered corpus's schema at any point — mount path uses readonly `PRAGMA user_version` probe before any store construction (AC-078-1 byte-identity oracle).
2. Registry-less mode stays observably identical to today — the existing single-project Playwright suite must be green at every merge to main (AC-078-9).
3. All client data fetches and query keys flow through the project-scoped factory — non-factory `/api/` literals = 0, ESLint-enforced (AC-078-8).
4. Every worktree oracle run is scoped (AC file paths + typecheck); the full suite runs only on main after merge.
5. Contract types (config schema, MountState, MountEntry, /api/projects response) live in ONE home (packages/core / packages/lore/src/mount/types.ts) — client code byte-mirrors nothing; it imports or re-pins against the e2e contract oracle (SPEC-077 shape-drift lesson).

## Risk Register

| Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|
| Client/server shape drift across parallel waves (SPEC-077 repeat) | H | T11 e2e fails on response shape | T3 contract SSOT lands before both waves; T11 is the contract oracle | Client re-pins to as-built service types; spec S-pin corrected |
| bun:sqlite hangs (not throws) on deleted-underneath DB | H | T2 spike observes >5s stall | T2 runs in wave 1; T8 consumes its conclusion (watchdog decision) | Add per-request timeout wrapper around store calls in dispatch boundary |
| Client migration (~31 literals, ~43 keys) regresses a route | M | AC-078-9 or existing e2e red | Single factory seam + ESLint rule + route-shape pin | Revert client wave branch; re-migrate in smaller slices |
| e2e fixture rework destabilizes existing suite | M | Existing specs flaky after T11 | Registry-less regression stays in the same suite run; fixture adds, never edits, existing corpus setup | Isolate multi-project specs behind separate global-setup project |
| Machine auth re-point breaks single-project login | M | AC-078-4 both-modes assertion fails | One code path (D1 unconditional); both modes asserted in one test | Feature-flag the store selection temporarily (named, loud) |

## Estimation Summary

Phase 1: 4 units (T1=1, T2=2, T3=1) | Phase 2: 8 (T4=1, T5=2, T6=1, T7=2, T8=2) | Phase 3: 5 (T9=3, T10=2) | Phase 4: 4 (T11=3, T12=1) | Total: 21 session-units, wall-clock ≈6-7 sessions at concurrency 3.

## Critical Path

T3 → T4 → T5 → T8 → T11 → T12 = 10 session-units (client branch T3→T9→T10→T11 = 9 has 1 unit slack). Recorded after link wiring.

## Exit Criteria

All 13 tasks (12 planned + T13 mid-flight repair) archived with pass evidence; `lore verify <plan>` attests all 10 script ACs; AC coverage backtrack 10/10; full vitest+bun+e2e suites green on main; `lore assess` verdict reviewed; spec code anchors declared post-landing; handoff written.

## Governance Mode

attended

## Decisions Log

- 2026-07-25 Strategy B (Interface-First dual-wave) selected by owner over A (dependency-ordered serial, ~10 serial units) and C (global spike-wait, wasteful — absorbed into B's wave 1). Shape-drift risk consciously accepted with T3-SSOT + T11-oracle mitigations.

- 2026-07-25 T13 added mid-flight (replan-light): T10 shipped a declared partial /p/:name route mirror; PRD F2/F3 commit ALL pages, so the gap became task T13 (blocks T11) rather than an accepted reduction. Estimation/exit criteria amended post-assess.
- 2026-07-25 assess triage (partially_met 79/100): (1) check-tree exit 3 WAIVED — 10 task-under-prd findings are SPEC-069 adhoc-by-design + legacy orphan knowledge docs, pre-existing debt tracked in task-tree-check-contract-vs-spec-069-adhoc-channel-task-under; drift check itself is green. (2) deleted-corpus-liveness flake (2 recorded fails under load) tracked as a stabilization adhoc task; risk-register contingency (dispatch watchdog) stays available. (3) AC sub-clause visibility limited by evidence output_tail 4000-char cap — execution was matched-count-verified; display limitation noted for a future lore enhancement. (4) repo-scope lint debt (4 pre-existing react-hooks rule-not-found errors) tracked as an adhoc task. (5) ProjectSwitcher stale mirror comment fixed post-assess.
