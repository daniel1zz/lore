---
id: PLAN-186
type: plan
role: plan
title: "Move the six checkpoint-backed rules from always-loaded fragments into their skills"
status: archived
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: SPEC-182
phases:
  - {name: "Phase 1: Move rules", description: "move the six backstopped bullets verbatim into their skill/agent homes (AC-RT-1, AC-RT-2)"}
  - {name: "Phase 2: Land and verify", description: "rule apply BR-1094, lore verify, full suite on main"}
---
# Plan: Move the six checkpoint-backed rules from always-loaded fragments into their skills

Implements spec-always-loaded-rules-keep-only-what-no-checkpoint-enforces (AC-RT-1, AC-RT-2). Audit: knowledge-delivery-tier-audit-of-every-always-loaded-lore-rule.

## Risk Register
- R1 (M): a consumer that never invokes the target skill loses the text of a moved rule. Accepted by the ADR: each moved rule's violation is refused by a checkpoint whose feeding pack carries the rule. Trigger: a refusal whose pack does not name the rule — file it.
- R2 (L): the assets manifest digest conflicts with other plans' regenerations. Mitigation: the manifest is not anchored here; the merge regenerates it (`bun scripts/embed-assets-manifest.mjs`) and runs --check.
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
