---
id: TASK-088
type: task
role: plan
title: "T6: e2e closed-loop (AC-P2-8) + full oracle sweep + attested evidence"
status: archived
priority: high
phase: Hooks + e2e
created: 2026-07-09
updated: 2026-07-09
tags: []
parent: PLAN-022
plan: PLAN-022
---
## Task Objective
Write the closed-loop e2e proving the C2 state machine (AC-P2-8) on a THROWAWAY corpus (mkdtemp + `lore init`, cwd inside it — ⛔ NEVER repo `.lore`). Sequence: create a draft spec + draft plan (assert NO block on create) → attempt approve plan while spec draft (assert BLOCKED via plan-promote) → approve spec → approve plan (assert ALLOWED) → attempt claim a task while its plan's parent spec draft (assert BLOCKED via task-claim) → after spec approved, claim allowed. Then run the full oracle sweep and record attested evidence.

## Spec Reference
§10 AC-P2-8, §11.3. Observation: authoring is free; every COMMIT transition (plan approve, task claim) gates on real upstream corpus state.

## Acceptance Criteria
- AC-P2-8 e2e passes.
- Full oracle sweep green: `bun run typecheck`, `bun run test:vitest`, `bun run test:bun`.
- Record via `lore verify` / evidence on the P2 tasks where applicable (SPEC-039 attested).

## Context Digest
Canonical throwaway-corpus pattern: `packages/dashboard/tests/e2e/global-setup.ts`. slice-1's e2e (T6 of that plan) is the closest template for a gate closed-loop test. Two test runners: `.bun.test.ts` → bun; other `.test.ts` → vitest. Do not mix.

## File Anchors
- NEW e2e test under `packages/lore/tests/` (pick runner per bun:sqlite usage)
- READ `packages/dashboard/tests/e2e/global-setup.ts`, slice-1 e2e test
