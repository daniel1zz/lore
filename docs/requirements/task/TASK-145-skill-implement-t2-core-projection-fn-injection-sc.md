---
id: TASK-145
type: task
role: plan
title: "[Skill:implement] T2 core projection fn + injection schema + config knobs"
status: draft
priority: critical
phase: "Phase 1: Core contract"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-032
plan: PLAN-032
links:
  - {id: TASK-144, type: blocks}
  - {id: TASK-143, type: blocks}
  - {id: TASK-142, type: blocks}
---
Estimate: M
Approach: per SPEC-080 §Projection Contract + §Public Interface + D1-D8. Pure fn `buildBootstrapInjection(report, budgets)` in packages/core/src/session.ts (same tier as deriveLastActivityAt — browser-safe, zero IO/clock); own `bootstrapInjectionSchema` (NEVER a patch on bootstrapReportSchema); `workflow.bootstrap_injection.{max_active_plans,max_handoffs,max_pending_slugs,char_budget}` in WorkflowConfigSchema (packages/core/src/config.ts) with defaults 5/3/3/8000, following the SPEC-070 workflow.task_feed.* wired-budget precedent.
Source: SPEC-080 (approved) — key order incl. unknown-key rule (between corpus and omitted); char-budget rule (drop latest_handoffs entries first, then active_plans, increment omitted.budget_drops; both empty and still over → budget_exceeded:true, payload intact).
Dimensions: D-FUNC, D-CODE
Scope-Alt: none — the fn is the spec's core deliverable
Covers: AC-080-1, AC-080-5

AC:
- `bunx vitest run packages/core/tests/unit/bootstrap-injection.test.ts` → GREEN, Test Files 1 passed (matched count asserted, not just exit 0).
- `bun run typecheck` → exit 0.
- Invariant 2 oracle: no slice/char-budget logic outside packages/core/src/session.ts (`grep -rn "charBudget\|char_budget" packages/lore/src` hits only config-resolution threading, never arithmetic).
- bootstrapReportSchema and BootstrapReport are byte-untouched (git diff on their declaration ranges empty).
