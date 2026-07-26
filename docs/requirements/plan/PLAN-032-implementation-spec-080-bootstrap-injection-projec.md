---
id: PLAN-032
type: plan
role: plan
title: "Implementation — SPEC-080 bootstrap injection projection (interface-first)"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: SPEC-081
phases:
  - {name: "Phase 1: Core contract", description: "Pin the projection contract: RED unit suite then buildBootstrapInjection + bootstrapInjectionSchema + workflow.bootstrap_injection knobs in @lore/core. Serial."}
  - {name: "Phase 2: Surfaces (parallel)", description: "Three disjoint-anchor consumers of the frozen contract: CLI --injection + config threading; hook blind-pipe + backstop; session-service omitted-plan fixture. 3-way parallel, each blocked only by T2."}
  - {name: "Phase 3: Verification", description: "Compiled-binary e2e (AC-080-3/6) then the attested sweep: build, manifest check, typecheck, full suites on main, lore verify, spec code anchors, live smoke."}
links:
  - {id: SPEC-081, type: implements}
---
## Overview

Implementation plan for approved `spec-080-bootstrap-injection-projection-tier-1-tier-2-payload` (SPEC-080). Strategy: **Interface-First** (user-selected 2026-07-26) — Phase 1 pins the core contract (pure fn + own schema + config knobs), Phase 2 runs three disjoint-anchor surfaces in parallel (CLI flag + app wiring / hook blind-pipe / session-service fixture), Phase 3 verifies via compiled-binary e2e and the attested sweep.

## Governance Mode

unattended — phase gates auto-proceed; Invariant violations hard-block regardless.

## Invariants

1. `lore bootstrap --json` output shape byte-identical pre/post (field set = the literal 9-key list in AC-080-3); MCP `lore_bootstrap` inherits unchanged.
2. ALL trimming logic (selection, count caps, char budget, entry drops) lives in exactly ONE exported core entry point (`buildBootstrapInjection`) — no truncation math in CLI, hook, or service. Oracle: grep for slice/length-budget logic outside `packages/core/src/session.ts`.
3. SPEC-057 frozen-baseline describe blocks in `session-service.test.ts` stay byte-untouched — extend-only (git diff scope oracle).
4. Zero new runtime dependencies.
5. The session-start hook remains package-import-free (spawn-only, blind pipe) — no `BootstrapInjection` field names appear in hook code beyond the markdown wrapper.

## Risk Register

| ID | Cat | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | Technical | M | git diff shows edits inside SPEC-057 frozen describe blocks | T5 AC pins extend-only + Invariant 3 | revert fixture, re-author as appended block |
| R2 | Quality | M | e2e passes with 0 matched tests, or dist/lore older than sources | T6 AC requires `bun run build` first + asserts matched-count > 0; `lore verify` judgeBinaryFreshness already mechanized | treat as inconclusive, rebuild, rerun |
| R3 | Dependency | L | user machines run old hook + new binary (or inverse) | spec D3: strict-flags exit 2 → Phase E degradation report, converges via `lore setup`; T4 re-embeds manifest | none needed — loud by design |
| R4 | Scope | M | projection fields patched onto bootstrapReportSchema instead of the separate injection schema (unknown-key strip eats them) | T1 strip-hazard negative scenario (AC-080-1) | fix schema home before any merge |

## Estimation Summary

S=1, M=2 session-units. T1=1, T2=2, T3=2, T4=1, T5=1, T6=2, T7=1 → **Total: 10 units**. Phase 1: 3 | Phase 2: 4 | Phase 3: 3.

## Critical Path

T1 → T2 → T3 → T6 → T7 = **8 session-units** (slack: T4, T5). Long-ish critical path accepted: T3→T6 serialization is real (e2e needs the compiled flag), no further split available without violating task atomicity.

## Exit Criteria

- All 7 tasks archived with pass evidence; script ACs attested via `lore verify <plan>` (AC-080-1..6 all covered).
- Both test runners green on main post-merge; `lore status --check-drift` exit 0 after `lore anchor add` on SPEC-080.
- `lore assess <plan> --diff <first-task-commit..HEAD>` reviewed; gaps fixed or accepted.
- Handoff written (`lore handoff --plan <plan>`).

## Decisions Log

- 2026-07-26 Strategy: Interface-First over Vertical-Serial — spec already pins the contract, 3-way P2 parallelism fits the worktree-dispatch protocol; B's combined L task violates INVEST-Small and blinds the anchor gate.
- 2026-07-26 Clarification coverage (medium plan, ≥5 dims): tech stack / third-party deps / error semantics / testing strategy / deployment-convergence / migration-compat all pinned by the user-approved SPEC-080 (design-stage AskUserQuestion approval); the one open preference dimension (governance mode) asked → unattended.
- 2026-07-26 TDD deviation: T3 (CLI) has no separate RED task — its behavioral oracle is the compiled-binary e2e (T6); strict RED-first would force a dist rebuild per red-green cycle. T4 (hook) logic shrinks to a blind pipe (< 5-min rule) — covered by T6 + AC-080-4. T2 keeps a strict RED pair (T1).
- 2026-07-26 Phase-2 dispatch note: 3 parallel implementers each get distinct `LORE_ACTOR=agent:<branch-slug>`; claims from inside their own worktrees; `bun install` first in every fresh worktree.
