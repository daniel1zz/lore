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
import { dirname } from "node:path";
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
  resolveHandoffTtlMinutes,
  resolveAuditVerifySince,
  resolveVerifyDefaultTimeoutMs,
  resolveVerifyEnvConfig,
  resolveVerifyRequireCommandApproval,
  type LoreConfig,
  type VerifyEnvConfig,
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
import { StalenessProbeService } from "./service/staleness-probe-service.js";
import { AuditService } from "./service/audit-service.js";
import { AcService } from "./service/ac-service.js";
import { VerifyRunnerService } from "./service/verify-runner-service.js";
import { executeVerifySpawnSpec } from "./service/verify-executor.js";
import { GateEnforcer } from "./service/gate-enforcer.js";
import { SessionService } from "./service/session-service.js";
import { ValidityService } from "./service/validity-service.js";
import { DriftCheckService } from "./service/drift-check-service.js";

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
   * StalenessProbeService — batch/single-doc orchestration for `lore review --staleness`
   * (SPEC-044 §Design Decisions D4): assembles candidates via the pure selection layer,
   * probes each via `aiProviderService.probeStaleness`, and persists via
   * `judgmentService.record` (audit action `staleness_probe`, actor = the commissioning
   * `by`). Store + two injected ports — never imports AIProviderService/JudgmentService
   * directly (services don't cross-import).
   *
   * Optional for the same reason `acService`/`verifyRunnerService`/`sessionService`/
   * `validityService` are: pre-existing hand-built App test stubs (HTTP routes / MCP
   * tools / eval scenarios — outside this task's file anchors) remain valid without a
   * mechanical touch to every one of them. Always present in production — both
   * `buildAppFromSqlite` and `buildAppFromTurso` wire it unconditionally.
   * Source: SPEC-044 §Design Decisions D4, §Scope
   */
  stalenessProbeService?: StalenessProbeService;
  /**
   * AuditService — read/verify surface over the LIVE `audit` table (query +
   * versions⋈audit completeness oracle). Store-only, no telemetry (mirrors
   * VersionService) — audit reads are a CLI-invoked oracle, not a hot path.
   * Source: SPEC-035 §2, §5, §9.1
   */
  auditService: AuditService;
  /**
   * AcService — add/list/rm on spec.extra.acceptance_criteria (structured AC-as-code).
   * Store-only, no telemetry, same DI shape as PhaseService — AC declarations ride
   * the parent spec's own version log rather than needing their own event stream.
   *
   * Optional so pre-existing hand-built App test stubs across the codebase (HTTP
   * routes / MCP tools / eval scenarios — outside this task's file anchors) remain
   * valid without a mechanical touch to every one of them, mirroring `sessionStore?`'s
   * documented precedent above. Always present in production — both `buildAppFromSqlite`
   * and `buildAppFromTurso` wire it unconditionally; `lore ac` asserts non-null since
   * the CLI only ever receives a fully-wired App from `createApp`.
   * Source: SPEC-038 §4, §6, §9.1
   */
  acService?: AcService;
  /**
   * VerifyRunnerService — orchestrates `lore verify`'s trusted-runner spawn-and-attest
   * flow (SPEC-039 §2). Constructor-injected with `corpusService.getPlanBundle` and
   * `taskWorkflowService.recordVerifiedEvidence` (both bound, mirroring `acService`'s
   * PhaseService-shaped DI) plus the real bun-only `executeVerifySpawnSpec` executor.
   *
   * Optional for the same reason `acService` is: pre-existing hand-built App test
   * stubs (HTTP routes / MCP tools / eval scenarios — outside this task's file
   * anchors) remain valid without a mechanical touch to every one of them. Always
   * present in production — both `buildAppFromSqlite` and `buildAppFromTurso` wire it
   * unconditionally.
   * Source: SPEC-039 §2 D3, §9.1
   */
  verifyRunnerService?: VerifyRunnerService;
  /**
   * SessionService — SPEC-041 S1 (bootstrap pointer-set) + S2 (lossless handoff) +
   * resume. Constructor-injected with `corpusService.createHandoffDoc` (bound — the
   * SOLE legitimate write path for `knowledge` docs with `extra.sub_type: "handoff"`,
   * mirroring `acService`'s PhaseService-shaped DI) and `gateEnforcer.isEnabled`
   * (bound — `bootstrap`'s armed-gate resolution reuses `GateEnforcer`'s OWN
   * enablement decision rather than re-deriving it from a second config reference).
   *
   * Optional for the same reason `acService`/`verifyRunnerService` are: pre-existing
   * hand-built App test stubs (HTTP routes / MCP tools / eval scenarios — outside
   * this task's file anchors) remain valid without a mechanical touch to every one of
   * them. Always present in production — both `buildAppFromSqlite` and
   * `buildAppFromTurso` wire it unconditionally.
   * Source: SPEC-041 §3 D1, §9.1
   */
  sessionService?: SessionService;
  /**
   * ValidityService — the SOLE write path for `knowledge`/`adr` bi-temporal validity
   * metadata (`extra.validity`, `lore invalidate`). Store + own telemetry wiring, same
   * DI shape as `TaskWorkflowService`/`JudgmentService` (SPEC-043 §Design Decisions D2).
   *
   * Optional for the same reason `acService`/`verifyRunnerService`/`sessionService`
   * are: pre-existing hand-built App test stubs (HTTP routes / MCP tools / eval
   * scenarios — outside this task's file anchors) remain valid without a mechanical
   * touch to every one of them. Always present in production — both
   * `buildAppFromSqlite` and `buildAppFromTurso` wire it unconditionally.
   * Source: SPEC-043 §Design Decisions D2, §Scope
   */
  validityService?: ValidityService;
  /**
   * DriftCheckService — the doc-code drift oracle (`lore status --check-drift`,
   * `lore anchor add/rm/list` spec-target dispatch, `lore create spec --code-anchor`
   * grammar consumer at read time). Store-only, no telemetry, no config, same DI
   * shape as `PhaseService`/`AcService` (SPEC-045 §Design Decisions D4, D6).
   *
   * Optional for the same reason `acService`/`verifyRunnerService`/`sessionService`/
   * `validityService`/`stalenessProbeService` are: pre-existing hand-built App test
   * stubs (HTTP routes / MCP tools / eval scenarios — outside this task's file
   * anchors) remain valid without a mechanical touch to every one of them. Always
   * present in production — both `buildAppFromSqlite` and `buildAppFromTurso` wire
   * it unconditionally; adapters guard `app.driftCheckService === undefined` before
   * use (mirrors `lore_bootstrap`'s `app.sessionService === undefined` guard).
   * Source: SPEC-045 §Design Decisions D4, §Scope
   */
  driftCheckService?: DriftCheckService;
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
 * @param handoffTtlMinutes - Handoff staleness TTL in minutes (SPEC-041 §3 D5; default
 *   10080 = 7 days) — feeds `SessionService.resume`'s `ttl_warning` threshold
 * @param auditVerifySince - Audit-verify watermark, ISO 8601 (SPEC-035 §2 D5; default the
 *   SPEC-035 deploy date)
 * @param verifyDefaultTimeoutMs - Trusted-runner default spawn timeout, ms (SPEC-039 §2 D9;
 *   default 300000)
 * @param verifyEnvConfig - Trusted-runner env-passthrough allowlist config (SPEC-039 §M2;
 *   default `{allowlist: [], passthrough_all: false}` — the hardened default)
 * @param verifyRequireCommandApproval - Trusted-runner command-provenance approval gate
 *   on/off (SPEC-039 §M2; default `true` — the hardened default)
 * @param repoRoot - Absolute project root `lore verify` spawns commands from (SPEC-039 §2;
 *   derived by `createApp` as `dirname(dirname(dbPath))` since `dbPath` is always
 *   `<repoRoot>/.lore/lore.db`)
 * @param gateEnforcer - Service-layer gate enforcement (retro follow-up item 8,
 *   defense-in-depth) — constructed once in `createApp` (mirrors `aiProviderService`,
 *   an already-built instance rather than raw config passed down) and wired into
 *   `CorpusService`/`ReviewService`/`TaskWorkflowService`, all three of which treat it
 *   as OPTIONAL DI (see each service's constructor JSDoc). Also bound into
 *   `SessionService` (`isEnabled`) — SPEC-041's `bootstrap` armed-gate resolution.
 */
function buildAppFromSqlite(
  store: SQLiteStore,
  telemetry: Telemetry = new NoOpTelemetry(),
  aiProviderService: AIProviderService,
  aiDefaultPerSurface?: AiDefaultPerSurface,
  claimTtlMinutes: number = 120,
  handoffTtlMinutes: number = 10_080,
  auditVerifySince: string = "2026-07-06T00:00:00Z",
  verifyDefaultTimeoutMs: number = 300_000,
  verifyEnvConfig: VerifyEnvConfig = { allowlist: [], passthrough_all: false },
  verifyRequireCommandApproval: boolean = true,
  repoRoot: string = process.cwd(),
  gateEnforcer: GateEnforcer = new GateEnforcer(undefined),
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
  // reason: 4th arg wires GateEnforcer (retro follow-up item 8, defense-in-depth) —
  // CorpusService gates spec-create (_createImpl) and spec-promote reached via `set`.
  const corpusService = new CorpusService(store, telemetry, claimTtlMinutes, gateEnforcer);
  const outlineService = new OutlineService(store);
  // reason: own telemetry wiring restores parity with CorpusService (D8) — TaskWorkflowService
  // never routes writes through CorpusService (cross-service calls forbidden). SPEC-025 §3 D5, D8.
  // 4th arg wires the SPEC-038 §7 D4 cross-entity port: resolveDeclaredAcIds is implemented
  // by CorpusService (the sole plan→spec graph-walk locus) and bound here rather than
  // imported — TaskWorkflowService never gains graph-walking responsibility of its own.
  // 5th arg wires GateEnforcer's `{enforcer, getPlanBundle}` bundle (retro follow-up
  // item 8) — task-claim needs the SAME plan→ancestor-spec walk as resolveDeclaredAcIds,
  // hence the same corpusService.getPlanBundle port, bound alongside the enforcer rather
  // than as a second independent constructor arg (GateDependencies JSDoc explains why
  // they're bundled). Extracted to a local (not built inline in the return literal
  // below, unlike most other services) because VerifyRunnerService needs to bind its
  // recordVerifiedEvidence method.
  const taskWorkflowService = new TaskWorkflowService(
    store,
    telemetry,
    { claimTtlMinutes },
    corpusService.resolveDeclaredAcIds.bind(corpusService),
    { enforcer: gateEnforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
  );
  // reason: SessionService (SPEC-041 §3 D1) — createHandoffDoc is CorpusService's
  // internal creation seam (the SOLE legitimate write path for knowledge/handoff
  // docs, bound rather than imported — services don't cross-import). isCheckpointEnabled
  // reuses GateEnforcer's OWN per-checkpoint decision for bootstrap's armed_gates,
  // rather than re-deriving workflow.gates.* from a second raw config reference.
  const sessionService = new SessionService(store, {
    claimTtlMinutes,
    handoffTtlMinutes,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
    isCheckpointEnabled: gateEnforcer.isEnabled.bind(gateEnforcer),
  });
  // reason: extracted to a local (mirrors taskWorkflowService/sessionService above) so
  // both the `judgmentService:` field AND `validityService`'s SPEC-044 D12 calibration
  // port AND `stalenessProbeService`'s recordJudgment port can bind to the SAME instance
  // — never three separately-constructed JudgmentServices.
  const judgmentService = new JudgmentService(store, telemetry);
  return {
    corpusService,
    // reason: same resolved claimTtlMinutes as CorpusService above — one resolution
    // path feeds PendingDoc.meta's task.claim_stale too (SPEC-036 §2 D3 pending-queue
    // extension), not a second config read. 3rd arg wires GateEnforcer (retro follow-up
    // item 8) — approve() gates spec-promote (spec docs) and plan-promote (plan docs,
    // via the same corpusService.getPlanBundle port TaskWorkflowService above uses).
    reviewService: new ReviewService(store, claimTtlMinutes, {
      enforcer: gateEnforcer,
      getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
    }),
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
    taskWorkflowService,
    sessionService,
    // reason: ValidityService owns extra.validity (bi-temporal invalidation) — store +
    // own telemetry wiring, same DI shape as TaskWorkflowService/JudgmentService.
    // SPEC-043 §Design Decisions D2. 3rd arg wires the SPEC-044 D12 OPTIONAL calibration
    // port — a stale_candidate probe that a human later confirms via `lore invalidate`
    // writes exactly one calibration record FK'd to that judgment; bound to the SAME
    // judgmentService instance the `judgmentService:`/`stalenessProbeService:` fields use.
    validityService: new ValidityService(store, telemetry, {
      latestStalenessJudgment: (docId) => judgmentService.latestFor(docId, "staleness"),
      recordCalibration: judgmentService.recordCalibration.bind(judgmentService),
    }),
    // reason: DriftCheckService depends only on StoreInterface — stateless, no AI, no
    // telemetry, same shape as PhaseService/AcService. SPEC-045 §Design Decisions D4.
    driftCheckService: new DriftCheckService(store),
    // reason: SpecKindService depends only on StoreInterface — stateless, no AI, no telemetry,
    // same shape as PhaseService. SPEC-032 §3.4.
    specKindService: new SpecKindService(store),
    // reason: JudgmentService owns review_judgments + calibration_records — store + own
    // telemetry wiring, same DI shape as TaskWorkflowService (D8). SPEC-034 §5, §9.1.
    judgmentService,
    // reason: StalenessProbeService takes two injected ports — probeStaleness (bound to
    // aiProviderService, the same instance createApp() already constructed) and
    // recordJudgment (bound to the SAME judgmentService instance above, never a second
    // JudgmentService) — never imports either service directly (services don't
    // cross-import). SPEC-044 §Design Decisions D4.
    stalenessProbeService: new StalenessProbeService(
      store,
      aiProviderService.probeStaleness.bind(aiProviderService),
      judgmentService.record.bind(judgmentService),
    ),
    // reason: AuditService is store-only (no telemetry, mirrors VersionService) — takes
    // the resolved watermark via constructor, same DI shape as TaskWorkflowService's
    // claimTtlMinutes (D5). SPEC-035 §2, §5, §9.1.
    auditService: new AuditService(store, { verifySince: auditVerifySince }),
    // reason: AcService depends only on StoreInterface — stateless, no AI, no telemetry,
    // same shape as PhaseService. SPEC-038 §4, §6, §9.1.
    acService: new AcService(store),
    // reason: VerifyRunnerService takes THREE injected ports (getPlanBundle,
    // recordVerifiedEvidence, executor) plus scalar config — never imports
    // CorpusService/TaskWorkflowService/the bun-only executor module directly
    // (SPEC-039 §2 D3). SPEC-039 §M2 additions: requireCommandApproval/envAllowlist/
    // envPassthroughAll (resolved config) + processEnv (a `process.env` snapshot
    // captured HERE at composition time, mirroring how `repoRoot` is captured from
    // `process.cwd()` — VerifyRunnerService itself never reads `process.env`).
    verifyRunnerService: new VerifyRunnerService(
      corpusService.getPlanBundle.bind(corpusService),
      taskWorkflowService.recordVerifiedEvidence.bind(taskWorkflowService),
      executeVerifySpawnSpec,
      {
        repoRoot,
        defaultTimeoutMs: verifyDefaultTimeoutMs,
        claimTtlMinutes,
        requireCommandApproval: verifyRequireCommandApproval,
        envAllowlist: verifyEnvConfig.allowlist,
        envPassthroughAll: verifyEnvConfig.passthrough_all,
        processEnv: process.env,
      },
    ),
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
 * @param handoffTtlMinutes - Handoff staleness TTL in minutes (SPEC-041 §3 D5; default
 *   10080 = 7 days) — see `buildAppFromSqlite`'s identical parameter JSDoc.
 * @param auditVerifySince - Audit-verify watermark, ISO 8601 (SPEC-035 §2 D5; default the
 *   SPEC-035 deploy date)
 * @param verifyDefaultTimeoutMs - Trusted-runner default spawn timeout, ms (SPEC-039 §2 D9;
 *   default 300000)
 * @param verifyEnvConfig - Trusted-runner env-passthrough allowlist config (SPEC-039 §M2;
 *   default `{allowlist: [], passthrough_all: false}` — the hardened default) — see
 *   `buildAppFromSqlite`'s identical parameter JSDoc.
 * @param verifyRequireCommandApproval - Trusted-runner command-provenance approval gate
 *   on/off (SPEC-039 §M2; default `true` — the hardened default) — see
 *   `buildAppFromSqlite`'s identical parameter JSDoc.
 * @param repoRoot - Absolute project root `lore verify` spawns commands from (SPEC-039 §2;
 *   derived by `createApp` as `dirname(dirname(dbPath))` since `dbPath` is always
 *   `<repoRoot>/.lore/lore.db`)
 * @param gateEnforcer - Service-layer gate enforcement (retro follow-up item 8,
 *   defense-in-depth) — see `buildAppFromSqlite`'s identical parameter JSDoc.
 */
function buildAppFromTurso(
  store: TursoStore,
  dbPath: string,
  telemetry: Telemetry = new NoOpTelemetry(),
  aiProviderService: AIProviderService,
  aiDefaultPerSurface?: AiDefaultPerSurface,
  claimTtlMinutes: number = 120,
  handoffTtlMinutes: number = 10_080,
  auditVerifySince: string = "2026-07-06T00:00:00Z",
  verifyDefaultTimeoutMs: number = 300_000,
  verifyEnvConfig: VerifyEnvConfig = { allowlist: [], passthrough_all: false },
  verifyRequireCommandApproval: boolean = true,
  repoRoot: string = process.cwd(),
  gateEnforcer: GateEnforcer = new GateEnforcer(undefined),
): App {
  // reason: SPEC-024 §9.1 — same mutable callerSurface pattern as buildAppFromSqlite.
  let _callerSurface: CallerSurface = "cli";
  const apiKeyDb = new Database(dbPath);
  // reason: claimTtlMinutes flows into DocSummary.meta's task.claim_stale (SPEC-036 §2
  // D3) — same resolved value TaskWorkflowService below uses, one resolution path
  // (resolveClaimTtlMinutes at the bottom of this file).
  // reason: 4th arg wires GateEnforcer (retro follow-up item 8) — see buildAppFromSqlite's
  // identical comment.
  const corpusService = new CorpusService(store, telemetry, claimTtlMinutes, gateEnforcer);
  const outlineService = new OutlineService(store);
  // reason: extracted to a local (see buildAppFromSqlite's identical comment) so
  // VerifyRunnerService can bind its recordVerifiedEvidence method below. 5th arg
  // wires GateEnforcer's {enforcer, getPlanBundle} bundle — see buildAppFromSqlite's
  // identical comment.
  const taskWorkflowService = new TaskWorkflowService(
    store,
    telemetry,
    { claimTtlMinutes },
    corpusService.resolveDeclaredAcIds.bind(corpusService),
    { enforcer: gateEnforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
  );
  // reason: SessionService (SPEC-041 §3 D1) — createHandoffDoc is CorpusService's
  // internal creation seam (the SOLE legitimate write path for knowledge/handoff
  // docs, bound rather than imported — services don't cross-import). isCheckpointEnabled
  // reuses GateEnforcer's OWN per-checkpoint decision for bootstrap's armed_gates,
  // rather than re-deriving workflow.gates.* from a second raw config reference.
  const sessionService = new SessionService(store, {
    claimTtlMinutes,
    handoffTtlMinutes,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
    isCheckpointEnabled: gateEnforcer.isEnabled.bind(gateEnforcer),
  });
  // reason: extracted to a local (mirrors buildAppFromSqlite's identical comment) so both
  // the `judgmentService:` field AND `validityService`'s SPEC-044 D12 calibration port
  // AND `stalenessProbeService`'s recordJudgment port can bind to the SAME instance.
  const judgmentService = new JudgmentService(store, telemetry);
  return {
    corpusService,
    // reason: same resolved claimTtlMinutes as CorpusService above — one resolution
    // path feeds PendingDoc.meta's task.claim_stale too (SPEC-036 §2 D3 pending-queue
    // extension), not a second config read. 3rd arg wires GateEnforcer — see
    // buildAppFromSqlite's identical comment.
    reviewService: new ReviewService(store, claimTtlMinutes, {
      enforcer: gateEnforcer,
      getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
    }),
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
    taskWorkflowService,
    sessionService,
    // reason: ValidityService owns extra.validity (bi-temporal invalidation) — store +
    // own telemetry wiring, same DI shape as TaskWorkflowService/JudgmentService.
    // SPEC-043 §Design Decisions D2. 3rd arg wires the SPEC-044 D12 OPTIONAL calibration
    // port — see buildAppFromSqlite's identical comment.
    validityService: new ValidityService(store, telemetry, {
      latestStalenessJudgment: (docId) => judgmentService.latestFor(docId, "staleness"),
      recordCalibration: judgmentService.recordCalibration.bind(judgmentService),
    }),
    // reason: DriftCheckService depends only on StoreInterface — stateless, no AI, no
    // telemetry, same shape as PhaseService/AcService. SPEC-045 §Design Decisions D4.
    driftCheckService: new DriftCheckService(store),
    // reason: SpecKindService depends only on StoreInterface — stateless, no AI, no telemetry,
    // same shape as PhaseService. SPEC-032 §3.4.
    specKindService: new SpecKindService(store),
    // reason: JudgmentService owns review_judgments + calibration_records — store + own
    // telemetry wiring, same DI shape as TaskWorkflowService (D8). SPEC-034 §5, §9.1.
    judgmentService,
    // reason: StalenessProbeService — see buildAppFromSqlite's identical comment.
    // SPEC-044 §Design Decisions D4.
    stalenessProbeService: new StalenessProbeService(
      store,
      aiProviderService.probeStaleness.bind(aiProviderService),
      judgmentService.record.bind(judgmentService),
    ),
    // reason: AuditService is store-only (no telemetry, mirrors VersionService) — takes
    // the resolved watermark via constructor, same DI shape as TaskWorkflowService's
    // claimTtlMinutes (D5). SPEC-035 §2, §5, §9.1.
    auditService: new AuditService(store, { verifySince: auditVerifySince }),
    // reason: AcService depends only on StoreInterface — stateless, no AI, no telemetry,
    // same shape as PhaseService. SPEC-038 §4, §6, §9.1.
    acService: new AcService(store),
    // reason: VerifyRunnerService takes THREE injected ports (getPlanBundle,
    // recordVerifiedEvidence, executor) plus scalar config — never imports
    // CorpusService/TaskWorkflowService/the bun-only executor module directly
    // (SPEC-039 §2 D3). SPEC-039 §M2 additions — see `buildAppFromSqlite`'s
    // identical comment.
    verifyRunnerService: new VerifyRunnerService(
      corpusService.getPlanBundle.bind(corpusService),
      taskWorkflowService.recordVerifiedEvidence.bind(taskWorkflowService),
      executeVerifySpawnSpec,
      {
        repoRoot,
        defaultTimeoutMs: verifyDefaultTimeoutMs,
        claimTtlMinutes,
        requireCommandApproval: verifyRequireCommandApproval,
        envAllowlist: verifyEnvConfig.allowlist,
        envPassthroughAll: verifyEnvConfig.passthrough_all,
        processEnv: process.env,
      },
    ),
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
    // reason: SPEC-044 §Design Decisions D8 — wires config.ai.staleness.* (max_doc_chars/
    // neighbor_limit) into the staleness-probe judge prompt budgets; without this the
    // constructor's own hardcoded default would silently ignore a corpus's configured
    // override (mirrors aiConfig.review's identical wiring one line above).
    aiConfig.staleness,
  );

  // Extract per-surface AI defaults from config (SPEC-024)
  const aiDefaultPerSurface = aiConfig.default_per_surface;

  // Task claim lease TTL (SPEC-025 §3 D2) — defaults to 120 when config/workflow section absent.
  const claimTtlMinutes = resolveClaimTtlMinutes(config);

  // Handoff staleness TTL (SPEC-041 §3 D5) — defaults to 10080 (7 days) when
  // config/workflow section absent. Feeds SessionService.resume's ttl_warning.
  const handoffTtlMinutes = resolveHandoffTtlMinutes(config);

  // Audit-verify watermark (SPEC-035 §2 D5) — defaults to the SPEC-035 deploy date
  // when config/audit section absent.
  const auditVerifySince = resolveAuditVerifySince(config);

  // Trusted-runner default spawn timeout (SPEC-039 §2 D9) — defaults to 300000ms
  // when config/verify section absent.
  const verifyDefaultTimeoutMs = resolveVerifyDefaultTimeoutMs(config);

  // Trusted-runner env-passthrough allowlist config (SPEC-039 §M2) — defaults to the
  // HARDENED default ({allowlist: [], passthrough_all: false}) when config/verify
  // section absent.
  const verifyEnvConfig = resolveVerifyEnvConfig(config);

  // Trusted-runner command-provenance approval gate on/off (SPEC-039 §M2) — defaults
  // to the HARDENED default (true) when config/verify section absent.
  const verifyRequireCommandApproval = resolveVerifyRequireCommandApproval(config);

  // reason: dbPath is always "<repoRoot>/.lore/lore.db" (findLoreDbPath's contract,
  // adapters/cli/utils.ts) — two levels up recovers the project root `lore verify`
  // spawns commands from (SPEC-039 §2). Computed here rather than added as a new
  // createApp parameter so this task's file anchors stay confined to app.ts's
  // existing signature.
  const repoRoot = dirname(dirname(dbPath));

  // Service-layer gate enforcement (retro follow-up item 8, defense-in-depth) —
  // enforces the four IoC vertical-slice checkpoints (spec-create/spec-promote/
  // plan-promote/task-claim) for EVERY caller of the gated service methods, not only
  // ones that shell out to `lore gate` first (MCP/HTTP/direct-service callers used to
  // bypass every checkpoint). Constructed once here (mirrors aiProviderService —
  // an already-built instance, not raw config, flows down to build*) with the
  // resolved LoreConfig itself: `GateEnforcer.enforce` re-derives per-checkpoint
  // enablement from it on every call via `resolveGateEnabled`, the SAME config knob
  // `lore gate` already honors (`workflow.gates.<checkpoint>.enabled`). Enforcement is
  // ON by default — a corpus opts a specific checkpoint OUT via config, never the
  // reverse.
  const gateEnforcer = new GateEnforcer(config);

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
      handoffTtlMinutes,
      auditVerifySince,
      verifyDefaultTimeoutMs,
      verifyEnvConfig,
      verifyRequireCommandApproval,
      repoRoot,
      gateEnforcer,
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
        handoffTtlMinutes,
        auditVerifySince,
        verifyDefaultTimeoutMs,
        verifyEnvConfig,
        verifyRequireCommandApproval,
        repoRoot,
        gateEnforcer,
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
