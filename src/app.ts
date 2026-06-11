/**
 * Composition root — wires services to a store implementation.
 * All adapters (CLI, MCP, HTTP) call createApp() to get a wired App instance.
 *
 * Store selection (D-007, SPEC-009 §3.3):
 *   - No config / config.sync absent / sync.enabled=false → SQLiteStore (local-only)
 *   - config.sync.enabled=true + remote_url present:
 *     - Missing or empty token env var → error Result (fail loud, D-007)
 *     - Credentials valid → TursoStore (embedded replica: local reads stay local,
 *       writes forward to remote, auto-sync provides multi-machine visibility)
 *     - TursoStore construction fails (network unreachable, etc.) → error Result
 *       (fail loud, STORE_ERROR — offline writes MUST NOT silently land only-local)
 *
 * D-007 invariant: with sync enabled, there is NO silent fallback to SQLiteStore.
 * Either TursoStore is constructed successfully, or createApp returns err(STORE_ERROR).
 * This ensures write operations never bypass the sync semantics silently.
 */

import { Database } from "bun:sqlite";
import { SQLiteStore } from "./store/sqlite-store.js";
import { TursoStore } from "./store/turso-store.js";
import { CorpusService } from "./service/corpus-service.js";
import { ReviewService } from "./service/review-service.js";
import { VersionService } from "./service/version-service.js";
import { OutlineService } from "./service/outline-service.js";
import { MigrationService } from "./service/migration-service.js";
import { ApiKeyStore } from "./adapters/http/auth.js";
import { resolveSyncCredentials, type LoreConfig } from "./core/config.js";
import { err, type Result, type LoreError } from "./core/errors.js";

export interface App {
  corpusService: CorpusService;
  reviewService: ReviewService;
  versionService: VersionService;
  outlineService: OutlineService;
  migrationService: MigrationService;
  apiKeyStore: ApiKeyStore;
  close(): void;
}

/**
 * Build an App backed by a SQLiteStore.
 */
function buildAppFromSqlite(store: SQLiteStore): App {
  return {
    corpusService: new CorpusService(store),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    apiKeyStore: new ApiKeyStore(store.getDatabase()),
    close: () => store.close(),
  };
}

/**
 * Build an App backed by a TursoStore (embedded replica).
 * ApiKeyStore uses a separate in-memory SQLite DB — the HTTP API key table
 * is local-only metadata (not replicated via Turso). Corpus operations use TursoStore.
 */
function buildAppFromTurso(store: TursoStore): App {
  const apiKeyDb = new Database(":memory:");
  return {
    corpusService: new CorpusService(store),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    apiKeyStore: new ApiKeyStore(apiKeyDb),
    close: () => { store.close(); apiKeyDb.close(); },
  };
}

/**
 * Create a wired App instance.
 *
 * Overload 1 — no config (or config with no sync section):
 *   createApp(dbPath) → App  (backward-compatible, synchronous, no Result wrapper)
 *
 * Overload 2 — config provided:
 *   - sync disabled / absent in config → App directly (SQLiteStore, local-only)
 *   - sync enabled + remote_url + token valid → Result<App> { ok: true } backed by TursoStore
 *     (embedded replica: local reads are microsecond, writes forward to remote, auto-sync
 *     gives multi-machine visibility — SPEC-009 §3, D-007)
 *   - sync enabled + token missing/empty → Result<App> { ok: false } (fail loud, D-007)
 *   - sync enabled + TursoStore construction fails (network unreachable, etc.)
 *     → Result<App> { ok: false, error: STORE_ERROR } (fail loud — offline writes
 *     MUST NOT silently land only-local, D-005)
 *
 * D-007 invariant: with sync.enabled=true there is NO silent fallback to SQLiteStore.
 */
export function createApp(dbPath: string): App;
export function createApp(dbPath: string, config: LoreConfig | undefined): App | Result<App, LoreError>;
export function createApp(
  dbPath: string,
  config?: LoreConfig,
): App | Result<App, LoreError> {
  // No config supplied or sync section absent / disabled → local-only SQLiteStore
  if (
    config === undefined ||
    config.sync === undefined ||
    !config.sync.enabled
  ) {
    return buildAppFromSqlite(new SQLiteStore(dbPath));
  }

  // Sync is enabled — resolve credentials (fail loud on missing/empty token, D-007)
  const credResult = resolveSyncCredentials(config);
  if (!credResult.ok) {
    // Propagate error as Result — caller must handle (CLI exits 1, not silently falls back)
    return credResult;
  }

  // Credentials valid — construct TursoStore (embedded replica, SPEC-009 §3, D-007).
  // TursoStore uses local file as embedded replica: normal reads stay local (microsecond),
  // writes forward to remote Turso, auto-sync gives multi-machine visibility.
  // If construction fails (network unreachable, auth error, etc.) we fail loud with
  // STORE_ERROR — there is NO silent fallback to SQLiteStore. Offline writes must not
  // silently land only-local (D-005 EC item 5).
  const { url: remoteUrl, token: authToken } = credResult.value;
  try {
    const store = new TursoStore({
      localPath: dbPath,
      remoteUrl,
      authToken,
      syncInterval: config.sync.interval,
    });
    return { ok: true, value: buildAppFromTurso(store) };
  } catch (e) {
    const message =
      e instanceof Error
        ? `TursoStore construction failed: ${e.message}`
        : "TursoStore construction failed: unknown error";
    return err({
      code: "STORE_ERROR",
      message,
      cause: e instanceof Error ? e : undefined,
    } satisfies LoreError);
  }
}
