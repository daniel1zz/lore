---
id: TASK-140
type: task
role: plan
title: "[Skill:test] T6 compiled-binary e2e: --injection + knobs + --json pin"
status: draft
priority: high
phase: "Phase 3: Verification"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-032
plan: PLAN-032
links:
  - {id: TASK-141, type: blocks}
---
Estimate: M
Source: AC-080-3 + AC-080-6; packages/lore's slugify-compiled.bun.test.ts (AC-068-10) as the compiled-binary e2e pattern; throwaway corpus discipline (mkdtemp + lore init, NEVER the repo .lore/ — packages/dashboard/tests/e2e/global-setup.ts precedent).
Dimensions: D-FUNC
Scope-Alt: none — sole attested oracle for AC-080-3/6
Covers: AC-080-3, AC-080-6

Scenarios:
- Given a freshly built dist/lore (`bun run build` inside the test's beforeAll or an explicit AC precondition) and a seeded throwaway corpus (root PRD + plans with mixed ready/dead states + handoffs + pending drafts), When `dist/lore bootstrap --injection` runs with default budgets, Then stdout parses as compact JSON whose key order equals the literal contract list and whose omitted ledger is present with expected counts; `omitted`/`budget_exceeded` are the final keys.
- Given the same corpus, When `dist/lore bootstrap --json` runs, Then the payload has exactly the literal 9-key set (root, active_plans, pending_reviews, my_claims, armed_gates, latest_handoffs, resume_hint, corpus, active_sessions) — REGRESSION pin.
- Given .lore/config.yaml with workflow.bootstrap_injection {max_active_plans:1, max_handoffs:1, max_pending_slugs:1, char_budget:2000}, When `--injection` runs, Then payload reflects each knob (1 plan + omitted count, 1 handoff, 1 pending slug, json length <= 2000 or budget_exceeded present) — knobs never decorative (AC-080-6).
- Given the old binary semantics, When `dist/lore bootstrap --injectoin` (typo) runs, Then exit 2 (strict-flags regression).
- Given T3's documented decision on `--injection --json` combined (allowed-same-output OR rejected — whichever the T3 implementer pinned in the command JSDoc), When both flags are passed, Then the observed behavior matches that documented decision exactly (this scenario oracle-forces the delegated choice; reviewer finding 2026-07-26).

AC:
- `cd packages/lore && bun test tests/e2e/bootstrap-injection-compiled.bun.test.ts` → GREEN with >0 executed tests (zero-match self-skip = FAIL, assert on the runner's reported count).
- Test file never touches the repo's own .lore/ (path assertion inside the suite).
