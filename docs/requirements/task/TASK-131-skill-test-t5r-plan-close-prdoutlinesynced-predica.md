---
id: TASK-131
type: task
role: plan
title: "[Skill:test] T5r plan-close prdOutlineSynced predicate — RED scenarios"
status: draft
priority: high
phase: "Phase 2: Oracles & gate predicate"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-130, type: blocks}
---
Estimate: S
Source: AC of task T5 (SPEC-080 C4)
TDD-Role: red | Paired-Impl: T5 plan-close predicate

Scenarios:
- Given knob ON and a closing plan whose linked domain doc has zero content-differing versions inside [earliest-claim-at, close-write), When plan → archived, Then VALIDATION_ERROR exit 4 and the feeding pack names `lore outline set`, `lore set <domain-doc>`, and `lore outline exempt` repair commands.
- Given one version whose content differs from its predecessor inside the window, Then the close passes.
- Given a whitespace-only diff, Then the close passes (documented residual, pinned).
- Given a valid prd_sync_exempt on the plan, Then the close passes and audit trail shows the exemption.
- Given knob OFF (default), Then behavior byte-identical to pre-change for all closes (I5 pin).
- Given a plan with no claim ever recorded, Then window opens at plan created_at (fallback rule).
- Given >= 1 exempt plan, When `lore status`, Then an exempt-plans section lists count + slugs; zero exemptions → output byte-stable vs baseline.

AC:
- Executable at packages/lore/tests/unit/service/plan-close-prd-sync.test.ts (+ status surfacing cases in packages/lore/tests/unit/cli/status-exempt-surfacing.test.ts)
- Run → all RED for missing-implementation reasons only
