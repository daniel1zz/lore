---
id: TASK-1486
type: task
role: plan
title: "[Skill:test] TG-21 fix two regressions from T18 and T20 (mirror exit precedence, falsifier RED control)"
status: archived
priority: critical
phase: "Phase 3: guards"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: S
Approach: Two regressions measured by the full vitest run on main 472b755e.
(1) scripts/tests/mirror-human-id-collision.test.ts (AC-R0-5): `--check` now exits 5 instead of 2 and the repair assertion sees 3 leftover entries. T18 (3b947725) made the compared-count shortfall (exit 5) take precedence over drift (exit 2); with a duplicate human_id the shortfall is a consequence of the collision already reported. Fix the precedence so a reported collision/drift keeps exit 2 and exit 5 fires only for an unexplained shortfall; keep T18's zero-parsed fixture red.
(2) packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts "both runners: BOUNDARY (RED ii, permanently pinned)" fails deterministically (2/2 runs): it expects 'cannot find module' when materialization is skipped, but since T20 (472b755e) @lore/core resolves through tsconfig paths without node_modules. Inferred, not reproduced on 868dc90e. Re-pin the RED control on a dependency that still needs materialized node_modules (a third-party package), proving materialization is still required; do not delete the control.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (INV-2 main stays green)
AC: both files green on main; each control still goes red when its rule is removed (evidence).
