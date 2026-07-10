---
id: TASK-091
type: task
role: plan
title: "T3: wire plan-promote + task-claim gates (registry entries + CLI + GateContext + feeding)"
status: archived
priority: high
phase: Gate wiring + config
created: 2026-07-09
updated: 2026-07-09
tags: []
parent: PLAN-022
plan: PLAN-022
links:
  - {id: TASK-089, type: blocks}
  - {id: TASK-088, type: blocks}
---
## Task Objective
Add the two commit-time cross-tier gates. In `checkpoint-registry.ts` add `plan-promote` + `task-claim` entries; in `cli/commands/gate.ts` add `plan-promote --plan <id>` and `task-claim --task <id>` subcommands. Assemble `GateContext` by resolving the target doc + its upstream via the store/CorpusService:
- **plan-promote**: resolve the plan's parent spec → predicates `upstreamApproved` + `upstreamHasAcceptanceCriteria`. If the plan's parent is NOT a spec (e.g. a prd) → no upstream edge → PASS (exit 0).
- **task-claim**: resolve the task → its plan → the plan's parent spec (reuse `evaluateReadiness`'s task→plan→parent-spec traversal) → predicate `upstreamApproved`. Plan with no spec parent → PASS.
On fail, emit the feeding pack on stdout: upstream title/status/AC pointers + explicit missing-list + `[source: corpus <slug>, trust: team-authored]` header (pointers, never full dump). Exit 0 pass / 4 fail via `exitCode()` SSOT.

## Spec Reference
§3 IN(2,3), §5.2/§5.3, §7 boundary ①/②. ⛔ No create-time gate. Verdict = pure fn of resolved GateContext; the resolve/IO happens in the CLI/service seam, the predicate stays pure.

## Acceptance Criteria
- AC-P2-2: plan-promote, parent spec draft → exit 4 + stdout names "upstream spec not approved".
- AC-P2-3: plan-promote, parent spec approved but 0 AC → exit 4 + names "upstream spec has no AC".
- AC-P2-4: plan-promote, parent spec approved + ≥1 AC → exit 0.
- AC-P2-5: task-claim, plan's parent spec unapproved → exit 4; approved → exit 0.
- AC-P2-6: plan under a prd → plan-promote exit 0; task under such plan → task-claim exit 0.
Tests as script-ACs on a throwaway corpus (mkdtemp + lore init) — ⛔ never repo `.lore`.

## Context Digest
Depends on T1 (registry + GateContext type) + T2 (upstreamApproved/upstreamHasAcceptanceCriteria). CorpusService.resolve(idOrSlug) handles id|slug. Parent link is via parent_id / link table; task→plan is `extra.plan_id`, plan→spec is the plan's parent. `evaluateReadiness` (core/task-workflow.ts:355+) already does task→plan-parent-spec status lookup — mirror its traversal so the two consumers agree.

## File Anchors
- EDIT `packages/lore/src/service/checkpoint-registry.ts` (plan-promote/task-claim entries)
- EDIT `packages/lore/src/adapters/cli/commands/gate.ts` (subcommands + GateContext assembly)
- READ `packages/lore/src/service/corpus-service.ts` (resolve, getPlanBundle), `packages/core/src/task-workflow.ts`
- NEW/EDIT `packages/lore/tests/unit/service/*` + an integration test under `packages/lore/tests/`
