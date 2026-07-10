---
id: TASK-092
type: task
role: plan
title: "T2: new predicates upstreamApproved + upstreamHasAcceptanceCriteria"
status: archived
priority: high
phase: Core: registry + predicates
created: 2026-07-09
updated: 2026-07-09
tags: []
parent: PLAN-022
plan: PLAN-022
links:
  - {id: TASK-091, type: blocks}
---
## Task Objective
Extend `packages/lore/src/service/gate-predicates.ts` with two PURE predicates:
- `upstreamApproved(upstream: {type,status}|null)` → `{ok:true}` iff upstream resolves, is the expected type, and `status ∈ {"approved","active"}`; reasons `UPSTREAM_MISSING`/`UPSTREAM_WRONG_TYPE`/`UPSTREAM_NOT_APPROVED`.
- `upstreamHasAcceptanceCriteria(upstreamSpec)` → `{ok:true}` iff the spec carries ≥1 `extra.acceptance_criteria`; reason `UPSTREAM_NO_AC`. Reuse the SAME existence check `spec-promote` runs on self (SPEC-038).

## Spec Reference
§5.2 (new predicates) + the SSOT note: the "plan's parent spec not approved" condition is ALREADY computed by `evaluateReadiness` (`packages/core/src/task-workflow.ts:423`, advisory `upstream_unapproved`). Do NOT fork that logic — these predicates express the same corpus fact for the write/gate path; keep them consistent (ideally the shared notion of "approved-enough" is one definition).

## Acceptance Criteria
- Unit tests (happy/negative/boundary/missing) for both predicates in `gate-predicates.test.ts`: approved→ok; draft/in-review→NOT_APPROVED; wrong type→WRONG_TYPE; null→MISSING; spec with 0 AC→NO_AC; spec with ≥1 AC→ok.

## Context Digest
`PredicateResult = {ok:true}|{ok:false;reason:string}` (gate-predicates.ts:25). `acceptance_criteria` lives on `spec.extra` (SPEC-038, `packages/core/src/acceptance.ts`). DocStatus/DocType from `@lore/core`. These predicates are consumed by T3's plan-promote (upstreamApproved+upstreamHasAcceptanceCriteria on the parent spec) and task-claim (upstreamApproved on the plan's parent spec).

## File Anchors
- EDIT `packages/lore/src/service/gate-predicates.ts`
- READ `packages/core/src/acceptance.ts`, `packages/core/src/task-workflow.ts` (evaluateReadiness parentSpecStatus)
- EDIT `packages/lore/tests/unit/service/gate-predicates.test.ts`
