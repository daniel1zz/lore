---
id: TASK-133
type: task
role: plan
title: "[Skill:test] T4r --check-prd-budget — RED scenarios"
status: archived
priority: high
phase: "Phase 2: Oracles & gate predicate"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-132, type: blocks}
---
Estimate: S
Source: AC of task T4 (SPEC-080 C3)
TDD-Role: red | Paired-Impl: T4 budget oracle

Scenarios:
- Given a prd whose rendered body is 24001 chars, When `lore status --check-prd-budget`, Then exit 3 and the report names the whole-doc breach.
- Given a compliant prd, Then exit 0 and runtime < 1000 ms.
- Given a tier "core" entry of 4001 chars, Then exit 3 naming the entry and its tier budget; at exactly 4000, exit 0.
- Given a free-text extra string of extra_prose_chars+1 chars outside typed schemas, Then flagged; at exactly the threshold, 0 flags; typed schemas (requirements/acceptance_criteria/phases/outline) never flagged.
- Given an outline entry with zero rel=detail links, Then exit 3 naming the entry (AC-080-10); given a detail link to a deleted doc, Then exit 3.
- Given both --check-tree inconsistency and a budget breach, Then exit 3 once with both sections printed (exit-precedence composition).
- Given a legacy prd without extra.outline, Then whole-doc budget only, never a crash.

AC:
- Scenarios split across packages/lore/tests/unit/service/prd-budget-content-flight.test.ts (pure fn) and packages/lore/tests/integration/prd-budget-check.bun.test.ts (CLI, incl. a `-t detail-link` addressable case)
- Run → all RED for missing-implementation reasons only
