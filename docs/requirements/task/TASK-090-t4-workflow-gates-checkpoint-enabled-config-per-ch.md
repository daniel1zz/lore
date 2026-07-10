---
id: TASK-090
type: task
role: plan
title: "T4: workflow.gates.<checkpoint>.enabled config + per-checkpoint short-circuit"
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
---
## Task Objective
Add `workflow.gates.<checkpoint>.enabled` to the config schema (Zod, `@lore/core`), default `true` for every checkpoint. In `lore gate`, before running predicates: if the checkpoint's config `enabled === false` → immediate exit 0 with a stderr log line. Ensure `LORE_GATE_BYPASS=1` still short-circuits ALL checkpoints (precedence: bypass ≥ per-checkpoint config ≥ predicates).

## Spec Reference
§3 IN(6), §5.3, §7 boundary ③ ("gate density configurable" — same knob that lets a team keep execute-in-draft by disabling task-claim).

## Acceptance Criteria
- AC-P2-7: `LORE_GATE_BYPASS=1` → every checkpoint exit 0; `workflow.gates.task-claim.enabled=false` → task-claim exit 0 (restores execute-in-draft) while other checkpoints still gate.
- Config defaults: absent `workflow.gates` → all enabled (backward compatible).
Tests on throwaway corpus with config overrides.

## Context Digest
Config schema lives in `@lore/core` (browser-safe barrel; file-IO loaders in `@lore/core/node`). Existing env escape `LORE_GATE_BYPASS` is read in `gate.ts` + the hook shims. Add the `workflow.gates` object as an optional, defaulted Zod shape so existing configs keep validating (no silent fallback for REQUIRED fields, but this IS optional-with-default by design).

## File Anchors
- EDIT `packages/core/src/config.ts` (or the config schema module) — add `workflow.gates`
- EDIT `packages/lore/src/adapters/cli/commands/gate.ts` — read per-checkpoint enabled
- EDIT/NEW config unit tests + gate config tests
