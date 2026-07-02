# Module: store

## Purpose

Async persistence abstraction. `StoreInterface` is the single contract every service depends on. Three implementations:

- `SQLiteStore` (`bun:sqlite`) — production local-only.
- `TursoStore` (`@libsql/client`) — embedded replica for `sync.enabled` mode.
- `InMemoryStore` — unit-test double; substring search instead of FTS5.

Row mappers, FTS5 query escaping, and JSON helpers are shared in `store-shared.ts`.

## Key Invariants

- **All `StoreInterface` methods are async** — they return `Promise<Result<T, LoreError>>`. `SQLiteStore` wraps synchronous `bun:sqlite` calls; `TursoStore` is natively async. Services depend on the interface, never on a concrete store.
- **Single SQL migration set** — `migrations/migration-001.sql` (corpus + FTS5 triggers) and `migration-002` (api_keys + extensions). Both stores apply the same SQL constants exported from `migrations/`. **Never edit a shipped migration in place** — add a new one.
- **FTS5 maintenance is trigger-driven** — `MIGRATION_001_SQL` installs `docs_ai`, `docs_ad`, `docs_au` triggers. Both stores rely on these; no manual `fts*` calls. Verified by `tests/unit/store/libsql-compat.bun.test.ts`.
- **`UpdateOpts.expected_version` → conditional UPDATE** — when set, the store performs `UPDATE … WHERE id = ? AND version = ?`. Zero affected rows → `err({ code: "STALE_VERSION", expected, actual })`. Without `expected_version` the unconditional path is preserved (backward-compatible).
- **`findMany` excludes soft-deleted by default** — `StoreFilters.exclude_deleted` defaults to `true`. Pass `false` to include `deleted_at !== null` rows.
- **`escapeFtsQuery` is mandatory before FTS5 MATCH** — see `store-shared.ts`. Wraps each whitespace piece in `"…"`, doubles internal `"`. Empty input → empty string; callers MUST short-circuit (FTS5 errors on empty MATCH). `InMemoryStore` does substring search and does not use this helper.
- **Row mappers handle libsql `bigint`** — `rowToDocRecord` and `rowToVersionRecord` apply `Number()` to `version`. Direct row reads bypass this at the caller's risk.
- **`findLinksByToIds(toIds, linkType)` is a batch link query** (SPEC-025 §3 D7) — `WHERE to_id IN (...) AND link_type = ?` in one round trip, avoiding an N+1 loop over `findLinks` when `TaskWorkflowService.ready()` computes readiness across a whole plan. Returns `ok([])` immediately for an empty `toIds` array (no query issued).

## Patterns

- **`store-shared.ts` is the SSOT for row shapes and mappers** — `DocRow`, `LinkRow`, `VersionRow`, `AuditRow`, `FtsRow` and their `rowToX` mappers. Both stores import these; do not duplicate.
- **Error wrapping via `wrapStoreError`** — unknown thrown values from the driver become `err({ code: "STORE_ERROR", message, cause })`. Service-layer errors (duplicate slug, validation) are constructed directly, not via `wrapStoreError`.
- **`InMemoryStore` mirrors `SQLiteStore` semantics, not FTS5** — substring scoring differs intentionally. Recall-rate scenarios must run against `SQLiteStore` / `TursoStore`, not in-memory.
- **`api_keys` is one of the 5 replicated tables** — see `packages/lore/src/adapters/http/sync-push.ts`. Composition root (`packages/lore/src/app.ts`) opens a separate `bun:sqlite` `Database` for `ApiKeyStore` when using `TursoStore` so it shares the same local replica file.

## Links

- Depends on: [`@lore/core`](../../../../core/src/CLAUDE.md).
- Used by: [`../service`](../service/CLAUDE.md), [`../adapters/http`](../adapters/http/CLAUDE.md) (ApiKeyStore + sync-push hit the libsql client directly), and `../app.ts`.
