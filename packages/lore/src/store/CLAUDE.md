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
- **migration-001 is crash-safe / idempotent** — every `CREATE TABLE/INDEX/VIRTUAL TABLE/TRIGGER` in `migration-001.ts` + `001-initial.sql` uses `IF NOT EXISTS`, so a process killed mid-`db.exec` (leaving `PRAGMA user_version` at 0) re-runs the identical SQL on next startup without throwing `table already exists`. Do NOT drop the `IF NOT EXISTS` guards.
- **FTS5 maintenance is trigger-driven** — `MIGRATION_001_SQL` installs `docs_ai`, `docs_ad`, `docs_au` triggers. Both stores rely on these; no manual `fts*` calls. Verified by `tests/unit/store/libsql-compat.bun.test.ts`.
- **`UpdateOpts.expected_version` → conditional UPDATE** — when set, the store performs `UPDATE … WHERE id = ? AND version = ?`. Zero affected rows → `err({ code: "STALE_VERSION", expected, actual })`. Without `expected_version` the unconditional path is preserved (backward-compatible).
- **`findMany` excludes soft-deleted by default** — `StoreFilters.exclude_deleted` defaults to `true`. Pass `false` to include `deleted_at !== null` rows.
- **`findMany` supports optional `limit`/`offset` paging** — both absent → unbounded (byte-identical to pre-pagination behavior, no implicit truncation). When used, ordering is deterministic across all three stores (`updated_at DESC, id ASC` tiebreaker) so offset paging is stable. Limit/offset are applied AFTER the in-memory `tags` filter (which narrows post-SQL), never before. CLI `lore list` exposes `--limit`/`--offset` (no default cap); MCP `lore_list` applies a default cap of 100 when the caller omits `limit` and always returns an explicit `truncated: boolean` (probe via `limit+1` fetch — no COUNT query). No silent cap on any surface.
- **Batch fetch methods avoid N+1** — `findByIds(ids)` → `Map<DocId, DocRecord>` (batch `WHERE id IN (...)`, empty input → empty Map, no malformed query) and `findLinksByFromIds(fromIds, direction?)` → `Map<DocId, LinkRecord[]>` (outgoing-link batch analog of `findLinksByToIds`). Consumed by `CorpusService._getImpl` (related-link resolution), `SessionService` bootstrap (per-plan blocker lookup), and `TreeCheckService.reconcile` — each issues ONE batch call, not a per-item loop. Cross-store parity enforced by `tests/unit/store/batch-methods.shared.ts`.
- **Self-referencing parent link is always rejected** — `detectParentCycle(fromId, toId)` in all three stores short-circuits `fromId === toId` → `err(LINK_CYCLE, path:[fromId])` before walking the chain. This parity is enforced (previously SQLite/Turso silently accepted `X→X`).
- **Audit `LIMIT` is bound, not interpolated** — all `LIMIT`/`OFFSET` clauses use `LIMIT ? OFFSET ?` bind parameters (no string interpolation anywhere in the store SQL).
- **`escapeFtsQuery` is mandatory before FTS5 MATCH** — see `store-shared.ts`. Wraps each whitespace piece in `"…"`, doubles internal `"`. Empty input → empty string; callers MUST short-circuit (FTS5 errors on empty MATCH). `InMemoryStore` does substring search and does not use this helper.
- **Row mappers handle libsql `bigint`** — `rowToDocRecord` and `rowToVersionRecord` apply `Number()` to `version`. Direct row reads bypass this at the caller's risk.
- **`findLinksByToIds(toIds, linkType)` is a batch link query** (SPEC-025 §3 D7) — `WHERE to_id IN (...) AND link_type = ?` in one round trip, avoiding an N+1 loop over `findLinks` when `TaskWorkflowService.ready()` computes readiness across a whole plan. Returns `ok([])` immediately for an empty `toIds` array (no query issued).
- **`listAllVersions(since?)` is corpus-wide, unlike `findVersions` (per-doc)** (SPEC-035 §2 D5) — `WHERE created_at >= ? ORDER BY created_at ASC` with no `doc_id` filter. Sole consumer: `AuditService.verify`'s versions⋈audit completeness reconcile, which needs every version row since the watermark, not one doc's history at a time.
- **`findByIdPrefix(prefix)` powers `resolveDoc`'s unique-ID-prefix resolution** (SPEC-065 D1/D2) — a discovery-shaped query, UNLIKE `find`/`findByIds` (direct-address, deliberately do NOT filter soft-deleted rows): it EXCLUDES `deleted_at IS NOT NULL` rows, same default `findMany` applies. Matching is case-INSENSITIVE in all three stores (SQLite/libSQL's native ASCII-`LIKE` default needs no `UPPER()`; `InMemoryStore` does an explicit `toUpperCase()` compare) — mirrors the `/i`-flagged prefix regex `resolve.ts` tests input against. `resolveDoc` only calls it after an exact `find`/`findBySlug` miss.

## Patterns

- **`store-shared.ts` is the SSOT for row shapes and mappers** — `DocRow`, `LinkRow`, `VersionRow`, `AuditRow`, `FtsRow` and their `rowToX` mappers. Both stores import these; do not duplicate.
- **Error wrapping via `wrapStoreError`** — unknown thrown values from the driver become `err({ code: "STORE_ERROR", message, cause })`. Service-layer errors (duplicate slug, validation) are constructed directly, not via `wrapStoreError`.
- **`InMemoryStore` mirrors `SQLiteStore` semantics, not FTS5** — substring scoring differs intentionally. Recall-rate scenarios must run against `SQLiteStore` / `TursoStore`, not in-memory.
- **`api_keys` is one of the 5 replicated tables** — see `packages/lore/src/adapters/http/sync-push.ts`. Composition root (`packages/lore/src/app.ts`) opens a separate `bun:sqlite` `Database` for `ApiKeyStore` when using `TursoStore` so it shares the same local replica file.

## Links

- Depends on: [`@lore/core`](../../../../core/src/CLAUDE.md).
- Used by: [`../service`](../service/CLAUDE.md), [`../adapters/http`](../adapters/http/CLAUDE.md) (ApiKeyStore + sync-push hit the libsql client directly), and `../app.ts`.
