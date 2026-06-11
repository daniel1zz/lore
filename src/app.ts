/**
 * Composition root — wires services to a SQLiteStore.
 * All adapters (CLI, MCP, HTTP) call createApp() to get a wired App instance.
 *
 * Store selection (D-007, SPEC-009 §3.3):
 *   - No config / config.sync absent / sync.enabled=false → SQLiteStore (local-only)
 *   - config.sync.enabled=true + remote_url present:
 *     - Missing or empty token env var → error Result (fail loud, D-007)
 *     - Credentials valid → SQLiteStore (local ops; sync commands use TursoStore on demand)
 *
 * All app instances use SQLiteStore for local DB operations. The sync credentials
 * (remote URL + token) are validated at createApp time (fail loud per D-007) but only
 * consumed by the sync commands (lore sync push/pull) which construct TursoStore with
 * the remote URL on demand. This keeps startup synchronous and network-independent.
 */

import { SQLiteStore } from "./store/sqlite-store.js";
import { CorpusService } from "./service/corpus-service.js";
import { ReviewService } from "./service/review-service.js";
import { VersionService } from "./service/version-service.js";
import { OutlineService } from "./service/outline-service.js";
import { MigrationService } from "./service/migration-service.js";
import { ApiKeyStore } from "./adapters/http/auth.js";
import { resolveSyncCredentials, type LoreConfig } from "./core/config.js";
import type { Result, LoreError } from "./core/errors.js";

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
 * Create a wired App instance.
 *
 * Overload 1 — no config (or config with no sync section):
 *   createApp(dbPath) → App  (backward-compatible, synchronous, no Result wrapper)
 *
 * Overload 2 — config provided:
 *   - sync disabled / absent in config → App directly (SQLiteStore, local-only)
 *   - sync enabled + remote_url + token valid → App directly (SQLiteStore, local ops)
 *   - sync enabled + token missing/empty → Result<App, LoreError> { ok: false }
 *
 * D-007: missing or empty token env var MUST fail loud — no silent SQLiteStore fallback.
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

  // Credentials valid — construct SQLiteStore for local corpus operations.
  // The remote URL and token are stored in the config for explicit sync commands
  // (lore sync push/pull) which construct TursoStore with remoteUrl on-demand.
  // Using SQLiteStore here keeps app startup synchronous and network-independent;
  // TursoStore (embedded replica with syncUrl) is only instantiated by sync commands.
  return buildAppFromSqlite(new SQLiteStore(dbPath));
}
