---
id: TASK-636
type: task
role: plan
title: "[Skill:implement] T6 lore migrate ordinals repair verb + mapping report"
status: archived
priority: high
phase: "Phase 2: Consumers (parallel)"
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-120
plan: PLAN-120
links:
  - {id: TASK-635, type: blocks}
---
Estimate: M
Approach: per SPEC-084 §One-shot repair migration. New `packages/lore/src/service/ordinal-migration-service.ts` (store-only, no telemetry, no gate — MigrationService/PhaseMigrationService one-shot precedent): (1) scan numbered-type docs, backfill `ordinal` from title-declared numbers with created_at priority; collision losers → next-free; (2) LOUD old→new mapping report — every reassignment, zero silent moves; (3) strip number prefixes from titles via direct store writes (NO approved→draft reset — the un-gated migration path, version rows still written); (4) reconcile `.lore/export-index.json` human_id/file_path to columns for numbered types (rename drifted doubled-number files); (5) dry-run DEFAULT with set-equality invariants (per-doc (title#, index#, assigned-ordinal) convergence table) asserted BEFORE any write; `--apply` executes; (6) idempotent: second run performs literally zero writes. CLI: `lore migrate ordinals [--apply]` on the existing migrate command family (commands/migrate.ts), wired in app.ts (optional-DI shape like phaseMigrationService).
Source: SPEC-084 migration steps 1-6; migration-service.ts + phase-migration-service.ts patterns; export-index shape from export-docs-service.ts
Dimensions: D-FUNC, D-CODE
Scope-Alt: file-rename step may report-only (listing `git mv` commands) instead of executing renames if export-index reconcile proves sufficient — decide at implementation, document in evidence
Covers: AC-084-4, AC-084-6

AC:
- `cd packages/lore && bun test tests/unit/store/migrate-ordinals.bun.test.ts` GREEN on a fixture reproducing the live incident (2 same-number titles + diverged index): created_at priority, bijectivity, mapping-report completeness, title strip without status resets, index convergence, second-run zero writes.
- `bun run typecheck` exit 0.
