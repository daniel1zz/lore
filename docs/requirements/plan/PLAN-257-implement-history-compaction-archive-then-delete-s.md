---
id: PLAN-257
type: plan
role: plan
title: "Implement history compaction: archive, then delete snapshots that record no reviewable change"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: SPEC-256
phases:
  - {name: "Phase 1: Compaction", description: "Selection, archive, audit, compact command; then restore and archive check; then lease, vacuum and sync refusal. Serial: shared store composite and command files."}
  - {name: "Phase 2: Retired key migration", description: "Schema migration removing extra.site_map from current baseline state (issue #362)."}
  - {name: "Phase 3: Verify", description: "Compiled-binary e2e (AC-CP-6), lore verify AC-CP-1..7, full suite on main, lore migrate schema on this corpus."}
---
## Overview

Implements `spec-compact-document-history-archive-then-delete-snapshots` (approved, AC-CP-1..7) under `adr-compact-document-history-archive-then-delete-snapshots-that`: archive-first compaction of `versions` rows that record no reviewable change, restore and archive check, and a migration that removes the retired `extra.site_map` from current baseline state (issue #362).

## Invariants

- I1 Nothing unarchived is deleted: every deleted row is in a verified archive of the same run (AC-CP-1, AC-CP-4).
- I2 No kept `versions` row, `docs` row or audit row is edited by compaction.
- I3 `lore audit --verify` passes after compaction and after restore.
- I4 The compaction command lands only after the gap-aware readers of plan-implement-history-records-content-working-state-only (its restore/diff/AC-retirement task) are archived.
- I5 Running compaction on this repo's live corpus is an operator action taken only after the user confirms the dry-run numbers.

## Risk Register

| # | Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | Selection deletes a row a reader needs | H | A reader test red after compaction; AC-CP-3 replay mismatch | Anchor rows kept; readers made gap-aware first (I4); dry run reviewed before the live run | `lore history restore-archive <file>` |
| R2 | Archive lost after the live run | H | `lore status --check-history-archives` exit 1 | Archive beside lore.db, never pruned, checked by status | Restore is impossible without it: the user is told before the live run that the archive is the only copy |
| R3 | Concurrent sessions write during the live run | M | rows skipped > 0 | Archive-membership check per row; lease | Re-run picks up nothing unarchived |
| R4 | Migration number collides with the write-provenance migration | M | integrate conflict on LATEST_SCHEMA_VERSION | Number chosen at landing | Merge main, renumber |
| R5 | VACUUM needs ~2× db free space | M | VACUUM error | Check free space before --vacuum; vacuum is a separate flag | Run without --vacuum; reclaim later |

## Critical Path

(readers task of the previous plan) → compact core → restore + archive check → concurrency/vacuum → e2e → live run (operator, after confirmation). The site_map migration runs beside, after the previous plan's secondary-write-path task (shared store files).

## Decisions Log

- Strategy: Dependency-Ordered by shared files (one compaction module and command, then restore/check, then concurrency), migration as a separate parallel slice. Rejected: one task for the whole command (too large for one session; the plan audit of the previous plan split a comparable task); vertical slices by doc type (selection is type-agnostic).
- The live run on this repo's corpus is not an implementation task: it is irreversible except through the archive, so the orchestrator runs it only after the user confirms the dry-run output (I5).
- User decision 2026-10-26: "应该要清理".

## Exit Criteria

All tasks archived; `lore verify` passes AC-CP-1..7; `bun run test` on main shows no new failures; AC-RIC-6 green after `lore migrate schema` on this corpus; live compaction run done after confirmation, archive verified by `lore status --check-history-archives`.
