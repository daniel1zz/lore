---
id: PLAN-108
type: plan
role: plan
title: "Implementation — trace layer (SPEC-102)"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-29
tags: []
parent: SPEC-102
phases:
  - {name: "P1-store"}
  - {name: "P2-service"}
  - {name: "P3-cli"}
  - {name: "P4-hardening"}
---
## Goal

Implement SPEC-102 (trace layer): migration-011 `trace_events`, fire-and-forget TraceRecorder DI port, read/deny instrumentation, `lore trace stats`, retention pruning. All 7 ACs (AC-TRACE-1..7) bound to script:test oracles; `lore verify` is the exit gate.

## Phases

- P1-store: migration-011 + StoreInterface trace methods across SQLiteStore/TursoStore/InMemoryStore + bun tests (AC-TRACE-1, AC-TRACE-7).
- P2-service: @lore/core Zod trace schema + TraceRecorder port + CorpusService.get/search instrumentation + GateEnforcer deny instrumentation + vitest tests (AC-TRACE-2, AC-TRACE-3).
- P3-cli: config keys (trace.enabled/trace.retention_days) + composition-root wiring (incl. Turso separate-local-handle per ApiKeyStore precedent) + `lore trace stats` verb + feed/context_bundle instrumentation + startup prune + integration tests (AC-TRACE-4/5/6).

## Execution notes

Tasks are dependency-chained (P1→P2→P3): ONE implementer agent in ONE worktree claims sequentially. Worktree oracle: `bun run test:changed <base>` + typecheck. Tests for medium-complexity units are authored by an independent tester agent per house rules; `.bun.test.ts` files spawning dist/lore need `bun run build` first (build-freshness precheck is mechanized in lore verify).
