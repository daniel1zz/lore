---
id: TASK-128
type: task
role: plan
title: "[Skill:implement] T6 OutlineMigrationService + lore migrate prd-to-outline (--dry-run, per-section, idempotent)"
status: draft
priority: critical
phase: "Phase 3: Migration machinery"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-031
plan: PLAN-031
links:
  - {id: TASK-126, type: blocks}
---
Estimate: L
Approach: OutlineMigrationService mirroring PhaseMigrationService (one-shot, idempotent markers, dry-run flag, store-only, no gate) — per-section pipeline: parse § from prd body → create domain-overview spec (verbatim prose) → link → outline entry → shrink body via renderOutlineContent splice; CLI driver `lore migrate prd-to-outline [--dry-run] [--section <key>]` joining the existing migrate group.
Source: SPEC-080 Migration Plan Phases 1-2 + AC-080-7/8; phase-migration-service.ts precedent
Dimensions: D-FUNC, D-CODE
Scope-Alt: §1-§13 core condensation may ship as manual-assisted (service migrates domains only) if core-section parsing proves brittle — decision recorded in evidence.
Covers: AC-080-7, AC-080-8

AC:
- Given T6r RED suites, When run post-implementation, Then all GREEN.
- Given the LIVE corpus, When only `--dry-run` is executed during this task, Then live corpus byte-unchanged (I4 discipline — live execution belongs to T7).
- `bun run typecheck` exit 0; both runners green scoped.

Integration: `lore migrate prd-to-outline --dry-run` runnable from compiled binary; report format consumed by T7's execution log.
