---
id: TASK-1542
type: task
role: plan
title: "[Skill:fix] TG-35 two new test files reference AC-CT-3 / AC-TG-11 without owning them (ownership check red on main)"
status: archived
priority: high
phase: "Phase 3b: one runner"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: S
Approach: On main 5a45ac2f, bun run check:ac-oracle-ownership exits 1: unowned-ac-reference for AC-CT-3 in packages/lore/tests/integration/cli/capture-stamps-and-init-arms.bun.test.ts (from CT-3b) and AC-TG-11 in packages/lore/tests/integration/in-process-parity.test.ts (from T25). The full run did not catch it because check:spec-mirror failed earlier in the && chain and skipped it. Per file decide: the file is a different surface → add the @layer <surface> <AC-ID> annotation the checker accepts; or it is the AC's real oracle → repoint the AC command with lore ac set --correction. Do not weaken the checker.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-5
AC: bun run check:ac-oracle-ownership exits 0; both files still pass unfiltered.
