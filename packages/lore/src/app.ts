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
import { TreeCheckService } from "./service/tree-check-service.js";
import { ApiKeyStore } from "./adapters/http/auth.js";
import { SessionStore } from "./adapters/http/sessions.js";
import { resolveSyncCredentials, type LoreConfig, AiConfigSchema } from "@lore/core";
import { err, type Result, type LoreError } from "@lore/core";
import {
  NoOpTelemetry,
  createTelemetry,
  type Telemetry,
} from "@lore/core";
import { buildProviderRegistry } from "./ai/registry.js";
import { AIProviderService } from "./service/ai-provider-service.js";

export interface App {
  corpusService: CorpusService;
  reviewService: ReviewService;
  versionService: VersionService;
  outlineService: OutlineService;
  migrationService: MigrationService;
  treeCheckService: TreeCheckService;
  apiKeyStore: ApiKeyStore;
  /**
   * SessionStore — optional so existing test stubs (InMemoryStore-backed) remain valid.
   * Always present in production (HTTP server). Absent in test stubs that don't exercise auth.
   * Source: SPEC-016 §3.5
   */
  sessionStore?: SessionStore;
  /**
   * AIProviderService — required; always wired by createApp via buildProviderRegistry.
   * Test fixtures that never exercise the AI path may cast null to this type with a comment
   * explaining why (see SPEC-017 §3.12 and ai-native-coding guide §"as unknown as").
   * Source: SPEC-017 §3.12
   */
  aiProviderService: AIProviderService;
  close(): void;
}

/**
 * Build an App backed by a SQLiteStore.
 * @param store - SQLiteStore instance
 * @param telemetry - Telemetry sink; defaults to NoOpTelemetry (no file I/O unless opted in)
 * @param aiProviderService - Wired AI service from buildProviderRegistry (always required)
 */
function buildAppFromSqlite(
  store: SQLiteStore,
  telemetry: Telemetry = new NoOpTelemetry(),
  aiProviderService: AIProviderService,
): App {
  const db = store.getDatabase();
  return {
    corpusService: new CorpusService(store, telemetry),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: new ApiKeyStore(db),
    // reason: SessionStore shares the same Database as ApiKeyStore — one connection, no WAL lock
    // contention. Both auth tables live in the same SQLite file. SPEC-016 §3.5.
    sessionStore: new SessionStore(db),
    aiProviderService,
    close: () => { telemetry.close(); store.close(); },
  };
}

/**
 * Build an App backed by a TursoStore (embedded replica).
 * ApiKeyStore uses the same local SQLite file as the TursoStore's embedded replica —
 * api_keys is one of the 5 replicated tables (R3) and must persist across restarts.
 * WAL multi-connection interop between bun:sqlite and @libsql/client is verified in
 * tests/unit/store/libsql-compat.bun.test.ts. Corpus operations use TursoStore.
 * @param store - TursoStore instance
 * @param dbPath - Local replica path (for ApiKeyStore)
 * @param telemetry - Telemetry sink; defaults to NoOpTelemetry
 * @param aiProviderService - Wired AI service from buildProviderRegistry (always required)
 */
function buildAppFromTurso(
  store: TursoStore,
  dbPath: string,
  telemetry: Telemetry = new NoOpTelemetry(),
  aiProviderService: AIProviderService,
): App {
  const apiKeyDb = new Database(dbPath);
  return {
    corpusService: new CorpusService(store, telemetry),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: new ApiKeyStore(apiKeyDb),
    // reason: Same local replica file as ApiKeyStore — sessions table lives alongside api_keys.
    // api_keys is one of the 5 replicated tables; sessions is local-only (SPEC-016 non-goal:
    // sessions are ephemeral, not replicated). SPEC-016 §3.5.
    sessionStore: new SessionStore(apiKeyDb),
    aiProviderService,
    close: () => { telemetry.close(); store.close(); apiKeyDb.close(); },
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
  // Resolve telemetry from config — defaults to NoOp when telemetry section is absent.
  // reason: AC-C3 — createApp default behavior MUST NOT produce file side effects.
  // Users must explicitly set telemetry.enabled=true in config.yaml to opt in.
  const telemetry = createTelemetry(config?.telemetry);

  // Build AI provider registry — must happen before store selection so a bad ai.provider
  // name fails loud at startup rather than at first generate() call.
  // reason: AiConfigSchema.parse({}) always succeeds (all defaults present), so the registry
  // never fails when config is absent. Failure only occurs when user sets ai.provider to an
  // unknown name — which is caught here and surfaces as exit 1 (AC-AI-11).
  const aiConfig = config?.ai ?? AiConfigSchema.parse({});
  const registryResult = buildProviderRegistry(aiConfig);
  if (!registryResult.ok) {
    telemetry.close();
    // Folds into the existing Result<App> path (SPEC-017 §3.12)
    return registryResult;
  }
  const aiProviderService = new AIProviderService(
    registryResult.value.providers,
    registryResult.value.active,
    aiConfig.templates,
    telemetry,
    aiConfig.telemetry,
  );

  // No config supplied or sync section absent / disabled → local-only SQLiteStore
  if (
    config === undefined ||
    config.sync === undefined ||
    !config.sync.enabled
  ) {
    return buildAppFromSqlite(new SQLiteStore(dbPath), telemetry, aiProviderService);
  }

  // Sync is enabled — resolve credentials (fail loud on missing/empty token, D-007)
  const credResult = resolveSyncCredentials(config);
  if (!credResult.ok) {
    // Propagate error as Result — caller must handle (CLI exits 1, not silently falls back)
    telemetry.close();
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
    return { ok: true, value: buildAppFromTurso(store, dbPath, telemetry, aiProviderService) };
  } catch (e) {
    telemetry.close();
    const message =
      e instanceof Error
        ? `TursoStore construction failed: ${e.message}`
        : "TursoStore construction failed: unknown error";
    const cause = e instanceof Error ? e : undefined;
    return err({
      code: "STORE_ERROR",
      message,
      ...(cause !== undefined ? { cause } : {}),
    } satisfies LoreError);
  }
}
