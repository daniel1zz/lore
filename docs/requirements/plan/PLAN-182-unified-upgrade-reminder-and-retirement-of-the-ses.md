---
id: PLAN-182
type: plan
role: plan
title: "Unified upgrade reminder and retirement of the session-start fragment hook"
status: draft
priority: high
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: SPEC-179
phases:
  - {name: "Phase 1: Project check", description: "lore setup --project --check and the shared check cache shape (AC-UR-1)"}
  - {name: "Phase 2: Advisory and outlet retirement", description: "session-start-resume advisory (AC-UR-2); retire hook:session-start outlet and session-start-fragments hook (AC-UR-3..5)"}
  - {name: "Phase 3: Land and verify", description: "rule apply, anchors, lore verify, full suite on main"}
---
# Plan: Unified upgrade reminder and retirement of the session-start fragment hook

Implements spec-one-upgrade-reminder-at-session-start-covers-the-global (AC-UR-1..5). Resolves #143, #144. Sibling plans: the turn-end review plan (Spec B) and the active-spec plan (Spec D).

## Risk Register
- R1 (M): the project check cache shape is consumed by the session-start hook — a later shape change silently breaks the advisory. Mitigation: task UR-cache (A1) defines one shared cache shape used by both the global and the project check; A2 is blocked by A1. Trigger: AC-UR-2 red after an A1 change.
- R2 (M): retiring `hook:session-start` touches files the turn-end plan also edits (distribution-hooks.ts, assets manifest). Mitigation: blocks links serialise A3 after the gate-hook retirement task and before the roster task of the turn-end plan.
- R3 (L): `lore run` main-run composition records the session-start outlet (#167); removing it could change run records. Mitigation: A3 anchors run.ts and its AC-UR-3 test covers helper-start rendering only; run composition is checked in review.
## Invariants
- I1: No test or smoke run writes this repo's `.lore/` or the real `~/.claude`; every install/corpus test uses `mkdtemp` + `lore init` / `lore setup --claude-dir <tmp>` (checked at review: grep for the real paths in new tests).
- I2: Every change ships through a distribution surface (assets/ SSOT + `packages/lore/src/generated/assets-manifest.ts` regenerated, or binary code) — never only this machine's `~/.claude` (adr-distribution-first-every-improvement-names-its-consumer).
- I3: Red first, recorded by the implementer who ran it: `lore evidence <task> --result expected-fail --output-tail-file <log>` before the green run.
- I4: Worktree oracles are scoped (`bun run test:changed <base>` + the task's AC test files + `bun run typecheck`); the full suite runs once on main after merge.
- I5: Governing ADR adr-rule-delivery-tiers-gate-hook-skill-and-optimistic: no new per-tool-call hook may refuse anything except an irreversible action.

## Decisions Log
- D1 (2026-10-15): No [Skill:test]-blocks-[Skill:implement] TDD pairs. Issue #23: that pairing is unsatisfiable under lore done's floors. Each task's implementer writes the failing test, records expected-fail, then implements to green. Rejected: TDD-pair injection (deadlock), test-after (no red evidence).
- D2: Decomposition = vertical slice per acceptance-criterion group, serialised only where tasks share a file (packages/core/src/distribution-hooks.ts, packages/lore/src/generated/assets-manifest.ts, .claude/settings.json). Rejected: horizontal (all hooks, then all CLI) — creates false serial edges.

## Exit Criteria
- Every task archived via `lore done` after merge; `lore verify <plan>` attests every script AC of the governing spec; full suite (`bun run test:vitest`, `bun run test:bun`) and `bun run typecheck` green on main; `lore assess <plan>` triaged.
