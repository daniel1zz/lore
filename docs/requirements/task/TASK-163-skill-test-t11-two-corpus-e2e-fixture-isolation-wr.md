---
id: TASK-163
type: task
role: plan
title: "[Skill:test] T11 two-corpus e2e fixture + isolation/writes/cache suites + route-shape pin"
status: archived
priority: critical
phase: "Phase 4: Integration & verification"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
links:
  - {id: TASK-162, type: blocks}
---
Estimate: L
Approach: Extend packages/dashboard/tests/e2e/global-setup.ts family: generate a machine-config registry pointing at 2 mkdtemp throwaway corpora (never the repo corpus); extend assertServerIsOurs to authenticate against BOTH corpora. New specs: multi-project-isolation.spec.ts (login once → both readable; A-write → B byte-unchanged doc set; unregistered project 404; If-Match minted under A replayed on B rejected); multi-project-writes.spec.ts (gate-armed write denied in A with A's feeding pack, same write green in B, audit surface=http_cookie in both); multi-project-cache.spec.ts (distinguishable seeds, switch A→B, zero A-content in B's list/tree/detail). Add registry-less route-shape pin assertion to the existing suite (canonical route 200 with no /p/ segment).
Source: spec-078 Acceptance Criteria section; QA review fixture requirements; AC-078-6/7/8/9.
Dimensions: D-FUNC, D-UX
Scope-Alt: none — this is the contract oracle for the dual-wave strategy.
Covers: AC-078-6, AC-078-7, AC-078-8, AC-078-9

AC:
- Given the three new Playwright specs, When run serially against the fixed-port dev server, Then all green with matched spec-file counts (no vacuous zero-match).
- Given the registry-less run, When the existing suite executes, Then green INCLUDING the new route-shape pin assertion.
- Integration: suite runs green twice consecutively (flake check) on main after both waves merged.
