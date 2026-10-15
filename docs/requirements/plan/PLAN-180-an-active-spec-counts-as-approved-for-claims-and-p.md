---
id: PLAN-180
type: plan
role: plan
title: "An active spec counts as approved for claims and plan approval"
status: archived
priority: high
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: SPEC-181
phases:
  - {name: "Phase 1: Status set", description: "UPSTREAM_APPROVED_STATUSES = {approved, active} (AC-ACT-1, AC-ACT-2)"}
  - {name: "Phase 2: Land and verify", description: "rule apply, anchors, lore verify, full suite on main"}
links:
  - {id: TASK-1246, type: resolves}
---
# Plan: An active spec counts as approved for claims and plan approval

Implements spec-an-active-spec-counts-as-approved-for-claiming-its-tasks (AC-ACT-1..2). Resolves #52.

## Risk Register
- R1 (L): some test pins the old `{approved}` set. Mitigation: D1 greps for tests asserting UPSTREAM_NOT_APPROVED on an active spec and updates them in the same task.
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
