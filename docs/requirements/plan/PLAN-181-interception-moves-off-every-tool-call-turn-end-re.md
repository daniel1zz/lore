---
id: PLAN-181
type: plan
role: plan
title: "Interception moves off every tool call: turn-end review and gate-hook retirement"
status: approved
priority: high
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: SPEC-180
phases:
  - {name: "Phase 1: Foundations", description: "gate-hook retirement with parity proof (AC-TE-1); turn record agent id and turn-start snapshot (AC-TE-2, AC-TE-7 snapshot half); harness-run prefix (AC-TE-6)"}
  - {name: "Phase 2: Turn-end review", description: "stop-turn-review hook with findings (a)(b)(c) and its setting (AC-TE-3, TE-4, TE-7)"}
  - {name: "Phase 3: Roster swap", description: "shipped roster and this repo's settings swap the retired hooks for stop-turn-review; converge proof (AC-TE-5)"}
  - {name: "Phase 4: Land and verify", description: "rule apply + BR-1089/BR-1090 restatement (#198), anchors, lore verify, full suite on main"}
---
# Plan: Interception moves off every tool call — turn-end review and gate-hook retirement

Implements spec-interception-moves-off-every-tool-call-one-turn-end-review (AC-TE-1..7). Resolves #22, #142, #146, #184, #190.

## Risk Register
- R1 (H): removing g1–g4 hooks loses a refusal the service layer does not make. Mitigation: B1's parity test (AC-TE-1) must be green BEFORE the hook files are deleted, in the same task; contingency: keep the hook for the failing checkpoint and file an issue.
- R2 (M): the turn-start snapshot (`git add -A` into a temporary index) is slow on large trees. Mitigation: B2 records the snapshot duration in the turn record; the review checks it on this repo. Trigger: > 1 s per prompt.
- R3 (M): stop-turn-review blocks compliant turns (false positives) — the failure mode the ADR forbids. Mitigation: AC-TE-3/TE-7 controls; after landing, the main agent measures blocks over a week of this repo's turns.
- R4 (M): shared files with the upgrade-reminder plan (distribution-hooks.ts, assets manifest, .claude/settings.json). Mitigation: blocks links B1 → (upgrade plan A3) → B4.
- R5 (L): BR-1089/BR-1090 land with wording the spec marks non-authoritative (#198). Mitigation: landing task restates both with `lore rule set` right after `lore rule apply`.
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
