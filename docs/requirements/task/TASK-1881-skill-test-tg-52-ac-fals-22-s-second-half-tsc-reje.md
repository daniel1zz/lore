---
id: TASK-1881
type: task
role: plan
title: "[Skill:test] TG-52 AC-FALS-22's second half (tsc rejects a fixture missing falsified) lost its oracle when TG-50 removed the tsc spawn from the unit lane"
status: archived
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: TG-50 (f143f7aa) replaced the unit test that spawned tsc in packages/dashboard/tests/unit/typecheck-scope.test.ts with in-process tsconfig resolution. AC-FALS-22's second half ("running the project over a fixture whose AcCoverageFact omits `falsified` exits nonzero naming `falsified`") now has no oracle: it needs a real type-check. Read AC-FALS-22 (`lore ac list` its spec, grep FALS-22), then give that half a real oracle outside the unit lane: one integration test that runs tsc -p on a throwaway fixture project (only the files needed) and asserts nonzero + "falsified" — one spawn, not three. If the AC's declared command must change to point at it, report the exact correction text (the orchestrator applies `lore ac set --correction`).
Source: TG-50 report
AC: the half is asserted by a test that fails when the fixture includes `falsified`.
