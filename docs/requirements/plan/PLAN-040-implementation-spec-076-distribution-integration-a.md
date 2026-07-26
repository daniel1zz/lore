---
id: PLAN-040
type: plan
role: plan
title: "Implementation — SPEC-076 distribution integration + asset update convergence"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: SPEC-076
phases:
  - {name: "Phase 1: Foundation", description: "Generated assets manifest + ownership schema fields. T1 ∥ T2."}
  - {name: "Phase 2: Core freshness logic", description: "planUpdate five-state (RED first), lore setup --check, converge hardening. Serialized on shared anchors."}
  - {name: "Phase 3: Peripherals", description: "CLAUDE.md marker migration, pruning (RED first), hook Phase F advisory, T8b config-knob wiring."}
  - {name: "Phase 4: Verification", description: "Compiled-binary e2e cycle + full-suite + attested verify + assess close-out."}
links:
  - {id: SPEC-076, type: implements}
---
## Overview

Implementation plan for SPEC-076 (distribution integration model + asset update convergence). Strategy: **Interface-First / dependency-ordered** (spec Migration Plan) — foundation types + generated manifest first, core five-state logic second, peripherals in parallel third, verification last. Chosen over vertical slices because all three slices would contend on setup-service.ts / commands/setup.ts / setup-manifest.ts anchors, forcing full serialization of worktree dispatch.

## Governance Mode

unattended — user directive 2026-07-25: "全部做完再通知我". Invariant violations still hard-block.

## Invariants

- I1: Every service-boundary function returns `Result<T, LoreError>`; no exceptions cross boundaries.
- I2: `planUpdate` stays a pure function in `@lore/core` — zero fs/process imports (import-graph checkable).
- I3: All schema changes are additive-optional — a pre-SPEC-076 manifest parses unchanged (regression pinned by existing setup tests staying green).
- I4: `lore setup --check` performs zero writes (manifest, target files, and backups byte-identical before/after; the check cache is the sole allowed write and only by the background refresh path, not by --check itself... — DECISION: --check writes the cache file ONLY, nothing else; assert no other mtime changes).
- I5: Diverged files are never overwritten without `--force-diverged` (AC-076-3 oracle).
- I6: session-start hook Phase F never blocks: no awaited spawn, any throw degrades to silence (fail-open, g1 precedent).
- I7: Term "drift" is never used for setup-domain freshness (reserved for SPEC-045); use "diverged"/"freshness".

## Risk Register

| ID | Cat | Impact | Risk | Trigger | Mitigation (in-tree) | Contingency |
|---|---|---|---|---|---|---|
| R1 | Technical | H | build.ts orders compile before manifest generation → binary carries stale digest | AC-076-9 green in CI but T9 e2e digest mismatch | T1 AC pins generation-before-compile ordering; T9 e2e asserts binary digest = fresh recomputation | extract generation to prebuild script spawned inside build.ts |
| R2 | Technical | M | hook background refresh child killed by harness before cache write | cache never refreshes, advisory never fires | T8 AC asserts detached+unref child completes cache write observable from a second process | fall back to CLI-side-only cache maintenance (setup/check write it) |
| R3 | Scope | M | CLAUDE.md marker migration misclassifies existing file form → user content loss | user section bytes differ post-converge | T6 golden fixtures for all three legacy forms + mandatory pre-migration backup | fail-loud and leave file untouched |
| R4 | Dependency | L | fresh worktree missing bun install → oracles test stale main-checkout source | impossible import errors / stale behavior | dispatch bundle mandates `bun install` first (standing lesson) | re-dispatch with anti-pattern note |

## Estimation Summary

S=1, M=2, L=3 session-units. Total 22 units: P1=4, P2=9, P3=7, P4=2 (пре-verify T10=1 in P4 plus e2e T9=2 counted in P4 → P4=3; totals recomputed at gate). Large plan (>10) accepted — absorbed by parallel dispatch.

## Critical Path

T2 → T3r → T3 → T4 → T5 → T7 → T10 = 13 units. Slack: T1 (2u, parallel with T2), T6/T8 (parallel with T5/T7), T7r, T9 (parallel with T7).

## Exit Criteria

- All 12 tasks archived with pass evidence; script ACs runner-attested via `lore verify` (attestation floor: every evidence-bearing task ≥1 attested entry).
- `lore verify <plan>` all 10 spec ACs pass; both test runners green on main after merge; typecheck clean.
- `lore assess <plan> --diff` verdict reviewed; spec code anchors declared post-landing; `lore status --check-drift` exit 0.
- Handoff written with carry-forward context.

## Phase Descriptions

- Phase 1: Foundation — generated assets manifest + ownership schema (T1 ∥ T2, disjoint anchors).
- Phase 2: Core freshness logic — planUpdate five-state (TDD RED first), `--check` command, converge hardening (serialized on shared anchors).
- Phase 3: Peripherals — CLAUDE.md marker migration, prune logic (TDD RED first), hook Phase F (parallel where anchors disjoint).
- Phase 4: Verification — compiled-binary e2e cycle + main-checkout full-suite verify/assess close-out.

## Decisions Log

- D-PLAN-1: Strategy = Interface-First/dependency-ordered per spec Migration Plan; vertical slices rejected (anchor contention → forced serialization). Selection gate satisfied by user's standing directive ("全部做完再通知我") + approved SPEC-076 carrying the strategy; no additional AskUserQuestion issued (deviation from mode-create 1.3 recorded honestly).
- D-PLAN-2: Clarification Sprint dimensions (tech stack/data model/error handling/testing/migration/security/perf) all answered by approved SPEC-076 D1–D9 + Downstream Handoff contract; design-stage approval AskUserQuestion treated as HOW confirmation (deviation from mode-create 1.2 recorded honestly).
- D-PLAN-3: TDD injection applied to pure-logic clusters only (T3 planUpdate, T7 prune) — integration-level tasks (T4/T5/T6/T8) carry test-with-impl inside the task because their bun.test fixtures are temporally coupled to CLI flags/service surface being present; independence compensated by T9 e2e + T10 full-suite (deviation from mode-create 5.4 full-pairing recorded honestly).
- D-PLAN-4: I4 refinement decided at plan time: `--check` MAY write the check cache (it is the freshest source) but must touch nothing else.
