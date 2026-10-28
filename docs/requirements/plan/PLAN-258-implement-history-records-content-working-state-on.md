---
id: PLAN-258
type: plan
role: plan
title: "Implement history-records-content: working-state-only writes add no version snapshot"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: SPEC-255
phases:
  - {name: "Phase 1: Foundation", description: "Pure WORKING_STATE_KEYS, isContentChange and the state_change delta builder in packages/core/src/working-state.ts, exported from the @lore/core barrel (no imports: browser-safe)."}
  - {name: "Phase 2: Write paths", description: "Consult isContentChange on every path that writes a versions row; working-state-only writes bump version, write no row, and carry details.state_change in the same transaction. Main path first, then secondary paths (same files, serial)."}
  - {name: "Phase 3: Readers", description: "Restore keeps working state and removes absent content keys; bare diff and AC retirement read the closest earlier row; stored version numbers with no row resolve to the closest earlier row; lore log reports state changes not shown."}
  - {name: "Phase 4: Verify", description: "Compiled-binary e2e (AC-HC-7), lore verify for AC-HC-1..10, full suite on main, spec code anchors."}
---
## Overview

Implements `spec-history-records-content-a-working-state-only-write-adds-no` (approved, AC-HC-1..10) under `adr-a-history-entry-records-content-working-state-is-recorded`: a write that changes no content writes no `versions` snapshot, keeps raising `docs.version` (CAS), and records its working-state delta in the audit row; restore, diff and log become gap-aware.

## Invariants

- I1 CAS unchanged: every existing STALE_VERSION test stays green; no `expectedVersion` site changes meaning.
- I2 Every content write still writes exactly one `versions` row (AC-HC-3, AC-HC-8 matrix).
- I3 `lore audit --verify` passes after every landing on a throwaway corpus run of the write matrix.
- I4 One key list: `WORKING_STATE_KEYS` lives only in `packages/core/src/working-state.ts` (AC-HC-2 scan).
- I5 No existing `versions` row is deleted or rewritten (ADR D8).

## Risk Register

| # | Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | A write path skips the classifier and keeps snapshotting, or writes a bump without its delta | H | AC-HC-8 matrix row red, or audit row without `state_change` for a no-row bump | T2b owns the full matrix with one falsifier per path class | Add the missed path to T2b via SendMessage before landing |
| R2 | Turso store diverges from SQLite (inline SQL per method) | M | A Turso case red in AC-HC-1/HC-8 | Both ACs run on all three stores | Fix in the same task; never land with a store skipped |
| R3 | Existing tests assert one versions row per bump (63 files read `versions`, 84 assert version numbers) | M | Scoped oracles red after T2a/T2b | Each write-path task updates the tests of the paths it reclassifies, only where the spec changed the expected behaviour | The integrate floor runs NO tests (install, build, typecheck, two :changed checks; scripts/run-chain.ts). So each write-path task runs the full `bun run test:vitest` in its worktree before release, and the orchestrator runs `bun run test` on main after every landing; a red found there is fixed in the owning task before the next landing |
| R4 | Concurrent sessions edit corpus-service.ts or the stores | M | `lore integrate` exit 4 (conflict) | Anchors declared; T2a → T2b serialized | Merge main into the branch, re-run integrate |

## Phases

1. Foundation — pure key list, classifier and delta builder in `@lore/core`.
2. Write paths — main path first, then every secondary path (serial: same files).
3. Readers — restore/diff/AC-retirement/closest-earlier resolution, then log.
4. Verify — compiled e2e, `lore verify`, full suite on main.

## Critical Path

T1 and the store-flag task (parallel) → T2a → T2b → T3 → T4 → T5. T2b → T3 because AC-HC-3 exercises paths T2b changes.

## Decisions Log

- Strategy chosen: Dependency-Ordered with file-contention serialization (foundation module first, then writers, then readers). Rejected: vertical slices per doc type (every slice touches the same write path in corpus-service.ts and the three stores, so slices would serialize anyway and duplicate the matrix); horizontal "all stores then all services" for the whole feature. One store-level piece IS split out (plan audit finding: the main write path was too large for one session): the store composites gain an explicit snapshot flag that callers set to true, which is independently testable through the shared store contract suite and changes no behaviour until the service task uses it.
- No third-party library: deep-equal of plain JSON is done in-house only if `@lore/core` has no existing helper; the implementer checks `packages/core/src` first (`grep -rn "deepEqual\|stableStringify"`), since `@lore/core` must stay import-free for the browser barrel.
- User decision 2026-10-26: "直接改，按照你认为的最佳设计" — design and decomposition chosen by the AI.

## Exit Criteria

All tasks archived; `lore verify <plan>` passes for AC-HC-1..10; `bun run test` green on main; spec code anchors declared after landing; `lore assess` at the end of the initiative.
