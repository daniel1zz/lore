---
id: TASK-132
type: task
role: plan
title: "[Skill:implement] T4 lore status --check-prd-budget (tiered budgets, content-flight, detail-link hop check, advisory knob)"
status: archived
priority: high
phase: "Phase 2: Oracles & gate predicate"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-130, type: blocks}
  - {id: TASK-126, type: blocks}
---
Estimate: M
Approach: pure check fn family in new service/prd-budget-check.ts (store-free, takes resolved prd DocRecord + budgets — mirrors computeDrift purity); CLI wiring in commands/status.ts following the SPEC-045 D5 value-returning-checks restructure (composes exit precedence, never early process.exit).
Source: SPEC-080 C3 + AC-080-1/6/10; status.ts --check-drift precedent
Dimensions: D-FUNC, D-CODE
Scope-Alt: advisory-mode knob may be a --advisory flag instead of config if config wiring exceeds scope — decision recorded in evidence either way.
Covers: AC-080-1, AC-080-6, AC-080-10

AC:
- Given T4r RED suites, When run post-implementation, Then all GREEN with matched-count assertions (Test Files N asserted, no vacuous path filters).
- Given plain `lore status` without the flag, Then output byte-identical to pre-change (I5 pin).
- Budget values read from prd.extra.outline_budget with documented defaults (core 4000 / domain 2000 / total 24000 / extra_prose_chars 1000) when absent.
- `bun run typecheck` exit 0.

Integration: flag documented in status --help; pre-push hook composition unchanged until Phase-3 arming (advisory default).
