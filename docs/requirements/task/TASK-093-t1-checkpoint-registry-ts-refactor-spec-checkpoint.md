---
id: TASK-093
type: task
role: plan
title: "T1: checkpoint-registry.ts + refactor spec-* checkpoints in (behavior-preserving)"
status: archived
priority: high
phase: "Core: registry + predicates"
created: 2026-07-09
updated: 2026-07-09
tags: []
parent: PLAN-022
plan: PLAN-022
links:
  - {id: TASK-091, type: blocks}
---
## Task Objective
Create `packages/lore/src/service/checkpoint-registry.ts` (PURE, no IO): define `GateCheckpoint` (`"spec-create"|"spec-promote"|"plan-promote"|"task-claim"`), `CheckpointDef`, `GateContext` types, and a `checkpointRegistry` keyed by checkpoint. Populate the `spec-create` + `spec-promote` entries by lifting slice-1's EXISTING decision logic out of `cli/commands/gate.ts` into registry `check`/`feed` callbacks. Refactor `gate.ts` spec-create/spec-promote handlers to dispatch through the registry. ⛔ ZERO behavior change — this is a behavior-preserving refactor.

## Spec Reference
spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr §5.1 (CheckpointDef shape), §4 (layering: registry is the SSOT behind `lore gate`). Plan-promote/task-claim entries are OUT of this task (added in T3) — leave typed placeholders or omit until T3.

## Acceptance Criteria
- AC-P2-1: existing `packages/lore/tests/unit/service/gate-predicates.test.ts` + `gate-feeding.test.ts` still pass; `lore gate spec-create` / `spec-promote` exit codes (0 pass / 4 fail) and stdout feeding-pack unchanged.
- New `packages/lore/tests/unit/service/checkpoint-registry.test.ts`: registry has entries for spec-create/spec-promote; each `check` returns PredicateResult[]; verdict is a pure fn (same input → same output).

## Context Digest
slice-1 built `gate-predicates.ts` (pure predicates: parentLegal/specKindValid/hasSkeleton) + `cli/commands/gate.ts` (two subcommands calling them + exit-code SSOT `cli/utils.ts` `exitCode(4)`). This task does NOT change predicates — only introduces the registry indirection and moves the spec-* wiring behind it. Verdict must stay a pure fn of GateContext (no store/IO in the registry module).

## File Anchors
- NEW `packages/lore/src/service/checkpoint-registry.ts`
- EDIT `packages/lore/src/adapters/cli/commands/gate.ts` (dispatch spec-create/spec-promote through registry)
- READ `packages/lore/src/service/gate-predicates.ts`, `packages/lore/src/adapters/cli/utils.ts`
- NEW `packages/lore/tests/unit/service/checkpoint-registry.test.ts`
