---
id: TASK-1883
type: task
role: plan
title: "[Skill:test] TG-50 two wall-clock oracles measure the machine (prd-budget-check <1000 ms, typecheck-scope 30 s tsc spawn) — replace with product-property oracles"
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
Approach: TG-48 (2026-10-19) found two wall-clock oracles that measure the machine, not the product: packages/lore/tests/integration/prd-budget-check.bun.test.ts asserts elapsedMs < 1000 around a CLI spawn + corpus scan (1305 ms under the full parallel run, passes alone); packages/dashboard/tests/unit/typecheck-scope.test.ts spawns the real tsc over the dashboard (61 s in the full run, 30 s timeout). Replace each with an oracle of the product property: prd-budget — assert the work done (only the fixture's docs scanned, exit 0) or a ratio against a control command in the same run; typecheck-scope — static assertions on the tsconfig include/exclude and the declared typecheck chain, leaving tsc cost to `bun run typecheck`. No limit bumps, no retries.
Source: TG-48 report
AC: both files assert the product property, not elapsed time; green in a full run.
