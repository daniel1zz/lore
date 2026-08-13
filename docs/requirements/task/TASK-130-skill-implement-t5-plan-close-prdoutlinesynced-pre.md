---
id: TASK-130
type: task
role: plan
title: "[Skill:implement] T5 plan-close prdOutlineSynced predicate + exemption surfacing in lore status"
status: archived
priority: high
phase: "Phase 2: Oracles & gate predicate"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-123, type: blocks}
---
Estimate: M
Approach: prdOutlineSynced predicate joins checkpoint-registry.ts plan-close checkpoint (additive alongside SPEC-054 UAT predicate; knob workflow.gates."plan-close".prd_sync.enabled default false), window derivation from plan claim/created_at + store.listVersions content comparison; exemption surfacing spliced into commands/status.ts (after T4 lands — serialized on status.ts contention).
Source: SPEC-080 C4 + AC-080-4/5; SPEC-054 plan-close precedent; SPEC-069 attestation_exempt shape (+ its documented invisibility gap fix)
Dimensions: D-FUNC, D-CODE
Scope-Alt: dashboard surfacing of exemptions deferred (status/CLI only per spec).
Covers: AC-080-4, AC-080-5

AC:
- Given T5r RED suites, When run post-implementation, Then all GREEN.
- Given GateEnforcer service-layer path and `lore gate` CLI path with identical ctx, Then denial messages byte-identical (SPEC-049 parity pin).
- Knob OFF default proven by full pre-existing suite pass with zero edits to those suites.
- `bun run typecheck` exit 0.

Integration: feeding pack renders through the SAME checkpoint feed callback both surfaces use; `lore status` exempt section prints via existing status render path.
