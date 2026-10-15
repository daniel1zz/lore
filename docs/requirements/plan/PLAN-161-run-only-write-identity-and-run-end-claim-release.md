---
id: PLAN-161
type: plan
role: plan
title: "Run-only write identity and run-end claim release"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: SPEC-168
phases:
  - {name: "wave-1"}
  - {name: "wave-2"}
  - {name: "wave-3"}
  - {name: "close"}
---
## Goal

Land `spec-run-only-write-identity-and-run-end-claim-release` (ADR `adr-write-identity-is-the-attested-run-alone-a-run-s-claims-end`).

## Waves and ownership

Waves are ordered by file overlap. Tasks within a wave declare disjoint `file_anchors`, and the task-claim gate refuses an overlapping concurrent claim.

| Wave | Task | ACs | Owns (declared anchors) |
|---|---|---|---|
| wave-1 | T1 `task-identity-resolution-ignores-lore-actor-no-run-order-is` | AC-ROI-2 | `packages/core/src/actor-resolution-node.ts`, `packages/lore/src/adapters/cli/utils.ts` |
| wave-1 | T3 `task-runs-end-migration-lore-run-end-ended-run-staleness` | AC-ROI-4, 5, 6 | `packages/lore/src/store/` (migration-017: `runs.ended_at` and `end_reason` for SQLite, Turso and InMemory), `run-service.ts`, `commands/run.ts`, `packages/core/src/task-workflow.ts` (staleness plus the lazy clean re-check at claim time and in `lore ready`), `task-workflow-service.ts` (release / orphaned_dirty) |
| wave-2 | T2 `task-remove-by-from-write-commands-and-mcp-write-tools-shipped` | AC-ROI-1, 8 | `adapters/cli/commands/`, `adapters/mcp/tools.ts`, `checkpoint-registry.ts`, `assets/{skills,context,agents}/`, `CLAUDE.md` |
| wave-2 | T4 `task-claim-conflict-lore-done-and-ready-overlap-decide-by-run` | AC-ROI-3 | `packages/core/src/run-identity.ts`, `task-workflow-service.ts` |
| wave-3 | T5 `task-run-end-hook-on-sessionend-and-subagentstop` | AC-ROI-7 | `assets/hooks/run-end.mjs`, `distribution-hooks.ts`, the assets manifest |
| wave-3 | T6 `task-status-reports-identity-sources-and-orphaned-dirty` | AC-ROI-9, 10 | `commands/status.ts` |
| close (runs right after T5 merges) | T7 `task-live-probe-background-subagentstop-ends-its-run-clear` | AC-ROI-11 | none (live probe, manual evidence) |

T2 / T4 boundary: T2 removes `--by` at the adapter layer only. It keeps passing the resolved actor into services unchanged and edits no service file. T4 alone changes service-side holder comparison. This boundary is what makes their anchors disjoint.

## Probe ordering (spec: "settled before AC-ROI-7 is relied on")

T5 builds the hook. After T5 merges and `lore setup` installs it, T7 probes the two unverified behaviours in a live session. T5 is NOT archived (`lore done`) until T7's manual evidence exists. If a probe is negative, the spec's fallback applies and AC-ROI-7 is narrowed before T5 is archived. "Relied on" means archived, not built.

## Close

After every task merges:

1. Run the full suites on main and compare them with the 15-vitest-failure baseline.
2. Run `lore verify`.
3. Retire BR-1018, BR-1022 and BR-1033 with a note naming BR-1055.
4. Run `lore anchor add`.
5. Run `lore assess`.
