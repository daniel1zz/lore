---
id: TASK-120
type: task
role: plan
title: "T2 — audit hash chain: store-shared hash fns, migration-009 backfill, three-store insert paths"
status: archived
priority: medium
phase: "Wave 1 — provenance + chain"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-030
plan: PLAN-030
links:
  - {id: TASK-119, type: blocks}
---
Implements SPEC-079 G3 storage half (AC-079-3, AC-079-6). canonicalAuditPayload + computeAuditEntryHash (sha256, sorted-key canonical JSON, genesis prev_hash='') in store-shared.ts; migration-009 adds nullable prev_hash/entry_hash to audit and backfills chain in id ASC inside the migration transaction; schema-version bump; SQLiteStore/TursoStore/InMemoryStore compute the chain at appendAuditEntry AND all *WithProvenance paths, reading head inside the same transaction. bun test suite audit-chain.bun.test.ts + vitest in-memory parity suite at the canonical AC paths.
