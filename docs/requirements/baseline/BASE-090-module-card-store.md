---
id: BASE-090
type: baseline
role: intent
title: "Module card: store"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-079
links:
  - {id: SPEC-009, type: supersedes}
---
# Module card: store

Source: `packages/lore/src/store/CLAUDE.md`.

- **Responsibility**: async persistence behind `StoreInterface`. Implementations: `SQLiteStore` (`bun:sqlite`, default), `TursoStore` (`@libsql/client`, embedded replica for `sync.enabled`), `InMemoryStore` (test double, substring search).
- **Public surface**: `StoreInterface` (every method `Promise<Result<T, LoreError>>`), the migration SQL constants under `migrations/`, shared row mappers and `escapeFtsQuery` in `store-shared.ts`.
- **Dependencies**: `@lore/core`. Used by service, http (ApiKeyStore, sync-push) and `app.ts`.
- **Invariants**:
  - CAS writes: `expected_version` -> conditional UPDATE, zero rows -> `STALE_VERSION`.
  - One migration set applied by both real stores; a shipped migration is never edited (001..015 today).
  - FTS5 MATCH input always passes `escapeFtsQuery`; empty input short-circuits; SQL uses bind parameters.
  - `busy_timeout` is set first on every connection to a shared corpus; contention waits use the native busy handler, never a JS timer.
  - Audit rows are hash-chained at every insert; `@libsql/client` loads lazily so a SQLite-only corpus never needs the native module.
