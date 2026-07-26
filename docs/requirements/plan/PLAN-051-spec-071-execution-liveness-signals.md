---
id: PLAN-051
type: plan
role: plan
title: "Plan — SPEC-071 execution liveness signals"
status: archived
priority: medium
created: 2026-07-23
updated: 2026-07-23
tags: []
parent: SPEC-071
phases:
  - {name: "Phase 1: Implementation", description: "Three parallel file-disjoint feature slices: F1 session actor tier (core + cli utils), F2 evidence claim renewal (core + task/phase workflow services), F3 last_activity_at (core session schema + SessionService + bootstrap formatter + fixture migration)."}
  - {name: "Phase 2: Verification", description: "Main-checkout merge of the three branches, whole-repo oracles (typecheck + both runners), lore verify attested AC runs, spec code anchors, CLAUDE.md docs sync."}
links:
  - {id: SPEC-071, type: implements}
---
# Plan — SPEC-071 execution liveness signals

## Overview

Implement SPEC-071's three collision-window fixes as three file-disjoint, fully parallel tasks plus one serial merge/verification task. Governing spec: `spec-071-execution-liveness-signals-session-actor-tier-evidence` (approved, AC-069-1..8).

## Invariants

1. No new stored state: every signal is derived (pure functions over existing data). `git diff` must show no new schema tables/columns and no new persisted `extra` fields other than the refreshed `claim.at` value.
2. Claim renewal and evidence append commit in ONE CAS write — doc `version` delta === 1 (test-asserted, AC-069-4/5).
3. `now()` thunk fires exactly once per `appendEvidenceEntry` call — the STALE_VERSION test recipe must keep passing unmodified (REGRESSION).
4. Task and Phase workflow services stay behavior-identical for every non-renewal path (foreign holder / no claim → `extra.claim` byte-identical).
5. `@lore/core` stays browser-safe: no Node builtins, no `Date.now()` in the three new pure functions.
6. Worktree oracle scoping: implementers run ONLY their AC-scoped test files + typecheck; the full two-runner suite runs once on main after merge (T4).

## Phases

- Phase 1: Implementation — three parallel file-disjoint tasks (F1/F2/F3).
- Phase 2: Verification — merge, whole-repo oracles, spec code anchors, docs sync.

## Exit Criteria

- All AC-069-1..8 carry pass evidence (script ACs via `lore verify` attested runs).
- `bun run typecheck` + `bun run test` green on main after merge.
- Spec code anchors declared post-landing (`lore anchor add`), `lore status --check-drift` exit 0.
- `lore assess` run; findings triaged.

## Governance Mode

unattended — user pre-authorized full autonomous execution through final review; invariant violations still hard-block.

## Decisions Log

- Decomposition: by feature (F1/F2/F3) rather than by layer — each feature's core fn + wiring + tests form one vertical slice with disjoint anchors, maximizing parallel dispatch (3-layer model: no artifact consumption between slices; file contention zero by anchor design).
- TDD pairing skipped as separate task docs: each slice's deliverable IS a new pure function plus its dedicated test files (the AC anchors name the test files); implementers follow red-green inside the slice. Separate RED tasks would duplicate the same artifact at S-size granularity.
- F3 fixture migration is folded into T3 (same slice touches the bootstrap fixtures its schema change breaks — fail-loud parse errors enumerate them mechanically).
