---
id: TASK-049
type: task
role: plan
title: "T4 migrate spec-kind audit (dry-run idempotent)"
status: archived
priority: high
phase: taxonomy
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-012
plan: PLAN-012
---
AC-5 (SPEC-032 §3.4). lore migrate spec-kind --dry-run scans spec docs, heuristically flags tech/design candidates carrying defaulted feature; reports without writing; --dry-run off applies; idempotent re-run. Mirrors PhaseService.migratePhases + commands/migrate.ts patterns. DEPENDS ON T1 (spec_kind must exist). Anchors: packages/lore/src/adapters/cli/commands/migrate.ts, packages/lore/src/service/ (follow migratePhases owner). Oracle: dry-run lists without writes; second apply run = no-op.
