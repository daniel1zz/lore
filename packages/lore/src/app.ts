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
import { OutlineService, renderResolvedToMarkdown } from "./service/outline-service.js";
import { MigrationService } from "./service/migration-service.js";
import { TreeCheckService } from "./service/tree-check-service.js";
import { ApiKeyStore } from "./adapters/http/auth.js";
import { SessionStore } from "./adapters/http/sessions.js";
import {
  resolveSyncCredentials,
  resolveClaimTtlMinutes,
  resolveAuditVerifySince,
  type LoreConfig,
  AiConfigSchema,
} from "@lore/core";
import { err, ok, type Result, type LoreError } from "@lore/core";
import type { CallerSurface, AiDefaultSource } from "@lore/core";
import type { AiDefaultPerSurface } from "@lore/core";
import { resolveAiDefault } from "./ai/resolve-ai.js";
import { NoOpTelemetry, type Telemetry } from "@lore/core";
// reason: createTelemetry writes JSONL via Node fs — only reachable via the
// @lore/core/node subpath (browser-safety split, packages/core/src/CLAUDE.md).
import { createTelemetry } from "@lore/core/node";
import { buildProviderRegistry } from "./ai/registry.js";
import { AIProviderService } from "./service/ai-provider-service.js";
import { SyncDocsService } from "./service/sync-docs-service.js";
import { ExportDocsService } from "./service/export-docs-service.js";
import { PhaseService } from "./service/phase-service.js";
import { TaskWorkflowService } from "./service/task-workflow-service.js";
import { SpecKindService } from "./service/spec-kind-service.js";
import { JudgmentService } from "./service/judgment-service.js";
import { AuditService } from "./service/audit-service.js";

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
  /**
   * SyncDocsService — required; syncs spec files from disk into the corpus.
   * Constructed from corpusService with no other state.
   * Source: SPEC-018 §3.6
   */
  syncDocsService: SyncDocsService;
  /**
   * ExportDocsService — required; exports corpus docs to per-doc .md files.
   * Inverse of SyncDocsService. Constructed from StoreInterface plus a ResolveDocBody
   * callback (this composition root wires OutlineService.resolve + renderResolvedToMarkdown
   * behind it — SPEC-032 §3.3 AC-4 — without ExportDocsService importing OutlineService).
   * Source: SPEC-021 §9.1, SPEC-032 §3.3
   */
  exportDocsService: ExportDocsService;
  /**
   * PhaseService — manages declared phases on plan documents (extra.phases[]).
   * Provides addPhase / listPhases / removePhase / renamePhase / migratePhases.
   * Source: SPEC-023 §4, §9.1
   */
  phaseService: PhaseService;
  /**
   * TaskWorkflowService — evidence, claim lease, and computed readiness for task docs
   * (extra.claim / extra.verification_evidence). Own telemetry wiring (D8).
   * Source: SPEC-025 §3 D5, §9.1
   */
  taskWorkflowService: TaskWorkflowService;
  /**
   * SpecKindService — one-shot heuristic audit that flags `spec` docs whose
   * title/content suggests `tech`/`design` but still carry the defaulted
   * `"feature"` spec_kind. Mirrors PhaseService.migratePhases structurally.
   * Source: SPEC-032 §3.4
   */
  specKindService: SpecKindService;
  /**
   * JudgmentService — persistence + audit for AI review judgments (review_judgments) and
   * their human calibration outcomes (calibration_records). Owns the whole judgment/
   * calibration data family (SPEC-034 D8) — never touches doc status.
   * Source: SPEC-034 §5, §9.1
   */
  judgmentService: JudgmentService;
  /**
   * AuditService — read/verify surface over the LIVE `audit` table (query +
   * versions⋈audit completeness oracle). Store-only, no telemetry (mirrors
   * VersionService) — audit reads are a CLI-invoked oracle, not a hot path.
   * Source: SPEC-035 §2, §5, §9.1
   */
  auditService: AuditService;
  /**
   * Telemetry sink — exposed for dashboard route handlers to emit source-tagged events.
   * Dashboard handlers record { service: "dashboard", source: "dashboard" } events after
   * successful writes so AC-DASH-WRITE-TEL-1 is satisfied without modifying service signatures.
   * Source: SPEC-022 §9.6
   */
  telemetry: Telemetry;
  /**
   * Current caller surface — set once at adapter startup before any command dispatch.
   * Adapters set this immediately after receiving the App:
   *   - CLI/loader.ts: "cli" or "agent" (from env vars CLAUDECODE, CI, LORE_AI_DEFAULT)
   *   - MCP/index.ts: "mcp" (in-process flag, not env var — see SPEC-024 §9.2)
   *   - HTTP: not set on App; per-request via ActorContext.callerSurface
   * Default: "cli" (safest — AI on, no change from SPEC-017 behavior).
   * Source: SPEC-024 §9.1
   */
  callerSurface: CallerSurface;
  /**
   * Resolve whether AI generation should run for the current call.
   * Delegates to resolveAiDefault() with this.callerSurface + config defaults.
   *
   * @param explicit - Caller explicit opt-in (true) or opt-out (false); undefined = use default.
   * @returns {ai, source} — whether to run AI and why (for telemetry).
   *
   * Source: SPEC-024 §9.3
   */
  resolveAiDefault(explicit: boolean | undefined): { ai: boolean; source: AiDefaultSource };
  close(): void;
}

/**
 * Build an App backed by a SQLiteStore.
 * @param store - SQLiteStore instance
 * @param telemetry - Telemetry sink; defaults to NoOpTelemetry (no file I/O unless opted in)
 * @param aiProviderService - Wired AI service from buildProviderRegistry (always required)
 * @param aiDefaultPerSurface - Per-surface AI default overrides from config (SPEC-024)
 * @param claimTtlMinutes - Task claim lease TTL in minutes (SPEC-025 §3 D2; default 120)
 * @param auditVerifySince - Audit-verify watermark, ISO 8601 (SPEC-035 §2 D5; default the
 *   SPEC-035 deploy date)
 */
function buildAppFromSqlite(
  store: SQLiteStore,
  telemetry: Telemetry = new NoOpTelemetry(),
  aiProviderService: AIProviderService,
  aiDefaultPerSurface?: AiDefaultPerSurface,
  claimTtlMinutes: number = 120,
  auditVerifySince: string = "2026-07-06T00:00:00Z",
): App {
  // reason: SPEC-024 §9.1 — callerSurface must be mutable so adapters can set it at startup.
  // Using a let variable closed over by the getter/setter ensures reads always see the current
  // value without exposing it as plain data (where external code could mistake it for an
  // immutable snapshot). Default "cli" is the safest: AI on, unchanged from SPEC-017 behavior.
  let _callerSurface: CallerSurface = "cli";
  const db = store.getDatabase();
  // reason: claimTtlMinutes flows into DocSummary.meta's task.claim_stale (SPEC-036 §2
  // D3) — same resolved value TaskWorkflowService below uses, one resolution path
  // (resolveClaimTtlMinutes at the bottom of this file).
  const corpusService = new CorpusService(store, telemetry, claimTtlMinutes);
  const outlineService = new OutlineService(store);
  return {
    corpusService,
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService,
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: new ApiKeyStore(db),
    // reason: SessionStore shares the same Database as ApiKeyStore — one connection, no WAL lock
    // contention. Both auth tables live in the same SQLite file. SPEC-016 §3.5.
    sessionStore: new SessionStore(db),
    aiProviderService,
    // reason: SyncDocsService depends only on CorpusService — no store access, no AI. SPEC-018 §3.6.
    syncDocsService: new SyncDocsService(corpusService),
    // reason: ExportDocsService needs to splice MDX placeholders into the exported body
    // (SPEC-032 §3.3 AC-4) — wired here as a narrow ResolveDocBody callback so
    // ExportDocsService itself never imports OutlineService (services don't cross-import).
    exportDocsService: new ExportDocsService(store, async (doc) => {
      const resolved = await outlineService.resolve(doc);
      if (!resolved.ok) return resolved;
      return ok(renderResolvedToMarkdown(resolved.value));
    }),
    // reason: PhaseService depends only on StoreInterface — stateless, no AI, no telemetry. SPEC-023 §9.1.
    phaseService: new PhaseService(store),
    // reason: own telemetry wiring restores parity with CorpusService (D8) — TaskWorkflowService
    // never routes writes through CorpusService (cross-service calls forbidden). SPEC-025 §3 D5, D8.
    taskWorkflowService: new TaskWorkflowService(store, telemetry, { claimTtlMinutes }),
    // reason: SpecKindService depends only on StoreInterface — stateless, no AI, no telemetry,
    // same shape as PhaseService. SPEC-032 §3.4.
    specKindService: new SpecKindService(store),
    // reason: JudgmentService owns review_judgments + calibration_records — store + own
    // telemetry wiring, same DI shape as TaskWorkflowService (D8). SPEC-034 §5, §9.1.
    judgmentService: new JudgmentService(store, telemetry),
    // reason: AuditService is store-only (no telemetry, mirrors VersionService) — takes
    // the resolved watermark via constructor, same DI shape as TaskWorkflowService's
    // claimTtlMinutes (D5). SPEC-035 §2, §5, §9.1.
    auditService: new AuditService(store, { verifySince: auditVerifySince }),
    // reason: telemetry exposed on App so dashboard route handlers can emit source-tagged events
    // without requiring service-layer signature changes (SPEC-022 §9.6).
    telemetry,
    // SPEC-024: callerSurface getter/setter + resolveAiDefault
    get callerSurface(): CallerSurface { return _callerSurface; },
    set callerSurface(s: CallerSurface) { _callerSurface = s; },
    resolveAiDefault(explicit: boolean | undefined) {
      return resolveAiDefault(explicit, _callerSurface, aiDefaultPerSurface);
    },
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
 * @param aiDefaultPerSurface - Per-surface AI default overrides from config (SPEC-024)
 * @param claimTtlMinutes - Task claim lease TTL in minutes (SPEC-025 §3 D2; default 120)
 * @param auditVerifySince - Audit-verify watermark, ISO 8601 (SPEC-035 §2 D5; default the
 *   SPEC-035 deploy date)
 */
function buildAppFromTurso(
  store: TursoStore,
  dbPath: string,
  telemetry: Telemetry = new NoOpTelemetry(),
  aiProviderService: AIProviderService,
  aiDefaultPerSurface?: AiDefaultPerSurface,
  claimTtlMinutes: number = 120,
  auditVerifySince: string = "2026-07-06T00:00:00Z",
): App {
  // reason: SPEC-024 §9.1 — same mutable callerSurface pattern as buildAppFromSqlite.
  let _callerSurface: CallerSurface = "cli";
  const apiKeyDb = new Database(dbPath);
  // reason: claimTtlMinutes flows into DocSummary.meta's task.claim_stale (SPEC-036 §2
  // D3) — same resolved value TaskWorkflowService below uses, one resolution path
  // (resolveClaimTtlMinutes at the bottom of this file).
  const corpusService = new CorpusService(store, telemetry, claimTtlMinutes);
  const outlineService = new OutlineService(store);
  return {
    corpusService,
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService,
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: new ApiKeyStore(apiKeyDb),
    // reason: Same local replica file as ApiKeyStore — sessions table lives alongside api_keys.
    // api_keys is one of the 5 replicated tables; sessions is local-only (SPEC-016 non-goal:
    // sessions are ephemeral, not replicated). SPEC-016 §3.5.
    sessionStore: new SessionStore(apiKeyDb),
    aiProviderService,
    // reason: SyncDocsService depends only on CorpusService — no store access, no AI. SPEC-018 §3.6.
    syncDocsService: new SyncDocsService(corpusService),
    // reason: ExportDocsService needs to splice MDX placeholders into the exported body
    // (SPEC-032 §3.3 AC-4) — wired here as a narrow ResolveDocBody callback so
    // ExportDocsService itself never imports OutlineService (services don't cross-import).
    exportDocsService: new ExportDocsService(store, async (doc) => {
      const resolved = await outlineService.resolve(doc);
      if (!resolved.ok) return resolved;
      return ok(renderResolvedToMarkdown(resolved.value));
    }),
    // reason: PhaseService depends only on StoreInterface — stateless, no AI, no telemetry. SPEC-023 §9.1.
    phaseService: new PhaseService(store),
    // reason: own telemetry wiring restores parity with CorpusService (D8) — TaskWorkflowService
    // never routes writes through CorpusService (cross-service calls forbidden). SPEC-025 §3 D5, D8.
    taskWorkflowService: new TaskWorkflowService(store, telemetry, { claimTtlMinutes }),
    // reason: SpecKindService depends only on StoreInterface — stateless, no AI, no telemetry,
    // same shape as PhaseService. SPEC-032 §3.4.
    specKindService: new SpecKindService(store),
    // reason: JudgmentService owns review_judgments + calibration_records — store + own
    // telemetry wiring, same DI shape as TaskWorkflowService (D8). SPEC-034 §5, §9.1.
    judgmentService: new JudgmentService(store, telemetry),
    // reason: AuditService is store-only (no telemetry, mirrors VersionService) — takes
    // the resolved watermark via constructor, same DI shape as TaskWorkflowService's
    // claimTtlMinutes (D5). SPEC-035 §2, §5, §9.1.
    auditService: new AuditService(store, { verifySince: auditVerifySince }),
    // reason: telemetry exposed on App so dashboard route handlers can emit source-tagged events
    // without requiring service-layer signature changes (SPEC-022 §9.6).
    telemetry,
    // SPEC-024: callerSurface getter/setter + resolveAiDefault
    get callerSurface(): CallerSurface { return _callerSurface; },
    set callerSurface(s: CallerSurface) { _callerSurface = s; },
    resolveAiDefault(explicit: boolean | undefined) {
      return resolveAiDefault(explicit, _callerSurface, aiDefaultPerSurface);
    },
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
    aiConfig.refine.max_input_chars,
    aiConfig.assess,
    aiConfig.review,
  );

  // Extract per-surface AI defaults from config (SPEC-024)
  const aiDefaultPerSurface = aiConfig.default_per_surface;

  // Task claim lease TTL (SPEC-025 §3 D2) — defaults to 120 when config/workflow section absent.
  const claimTtlMinutes = resolveClaimTtlMinutes(config);

  // Audit-verify watermark (SPEC-035 §2 D5) — defaults to the SPEC-035 deploy date
  // when config/audit section absent.
  const auditVerifySince = resolveAuditVerifySince(config);

  // No config supplied or sync section absent / disabled → local-only SQLiteStore
  if (
    config === undefined ||
    config.sync === undefined ||
    !config.sync.enabled
  ) {
    return buildAppFromSqlite(
      new SQLiteStore(dbPath),
      telemetry,
      aiProviderService,
      aiDefaultPerSurface,
      claimTtlMinutes,
      auditVerifySince,
    );
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
    return {
      ok: true,
      value: buildAppFromTurso(
        store,
        dbPath,
        telemetry,
        aiProviderService,
        aiDefaultPerSurface,
        claimTtlMinutes,
        auditVerifySince,
      ),
    };
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
