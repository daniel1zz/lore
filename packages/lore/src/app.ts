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

import { warnSinkOf, type WarnSink } from "./service/warn-sink.js";
import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { SQLiteStore } from "./store/sqlite-store.js";
import { assertNoForeignSchemaMigration } from "./store/foreign-schema-guard.js";
import { TursoStore, probeTmpdirUsability } from "./store/turso-store.js";
import type { StoreInterface } from "./store/store-interface.js";
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
  resolveRequirementQuantifiableEnabled,
  resolveCiteGateRaw,
  resolveAttestationMinRatio,
  resolveTraceEnabled,
  resolveTraceRetentionDays,
  resolveLedgerAutoApprove,
  resolveJudgmentRequiredTypes,
  type LoreConfig,
  type VerifyEnvConfig,
  AiConfigSchema,
} from "@lore/core";
import { err, ok, type Result, type LoreError } from "@lore/core";
import type { CallerSurface, AiDefaultSource, InvocationIdentity, Invocation } from "@lore/core";
import type { AiDefaultPerSurface } from "@lore/core";
import { resolveAiDefault } from "./ai/resolve-ai.js";
import { NoOpTelemetry, type Telemetry } from "@lore/core";
// reason: createTelemetry writes JSONL via Node fs — only reachable via the
// @lore/core/node subpath (browser-safety split, packages/core/src/CLAUDE.md).
// resolveGlobalConfigPath/resolveGlobalConfigWritePath (SPEC-064 D1) are the SAME
// XDG resolution helpers loader.ts already uses for the read-only global-defaults
// merge — reused here (never re-derived) to locate the machine-scope config file
// GlobalConfigService writes to.
import {
  createTelemetry,
  readSessionTrail,
  resolveGlobalConfigPath,
  resolveGlobalConfigWritePath,
  stateBase,
} from "@lore/core/node";
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
import { buildAuditVerifyRunner, type AuditVerifyRunner } from "./service/audit-verify-runner.js";
import { StateBindingService } from "./service/state-binding-service.js";
import { AcService } from "./service/ac-service.js";
import { RequirementService } from "./service/requirement-service.js";
import { RuleService } from "./service/rule-service.js";
import { RuleChangeService } from "./service/rule-change-service.js";
import { RuleReadService } from "./service/rule-read-service.js";
import { ImpactService } from "./service/impact-service.js";
import { PrdOutlineService } from "./service/prd-outline-service.js";
import { RuleStateService } from "./service/rule-state-service.js";
import { SpawnGitPort, resolveGitRoot } from "./service/rule-state-git-port.js";
import type { RadiusDiffPort } from "./service/stamp-binding-reader.js";
import { RunService } from "./service/run-service.js";
import { WorktreeRemovalService, type WorktreeRemovalRunStore } from "./service/worktree-removal-service.js";
import { DecisionService } from "./service/decision-service.js";
import { createOverrideDecisionPort, type OverrideDecisionPort } from "./service/override-decision.js";
import { createRealWorktreeProbe } from "./service/worktree-cleanup.js";
import { createReadSessionHeartbeat, createWriteSessionHeartbeat } from "./adapters/session-heartbeat-port.js";
import { createRealProcessScanPort } from "./adapters/real-process-scan-port.js";
import { createRealProcessTablePort } from "./adapters/process-table-port.js";
import { RunReapService } from "./service/run-reap-service.js";
import { ensureVerifiedIdentity, resolveWriteActorFor, withVerifiedWriteContext } from "./store/write-context-store.js";
import { PlanExemptionService } from "./service/plan-exemption-service.js";
import { UatService } from "./service/uat-service.js";
import { VerifyRunnerService } from "./service/verify-runner-service.js";
import type { StateBindingOccupancyPort } from "./service/verify-runner-service.js";
import { probeOccupancyForCheckout } from "./adapters/oracle-occupancy.js";
import { executeVerifySpawnSpec } from "./service/verify-executor.js";
import { GateEnforcer } from "./service/gate-enforcer.js";
import { RecordLockService } from "./service/record-lock-service.js";
import { TraceRecorder } from "./service/trace-recorder.js";
import { TraceStatsService } from "./service/trace-stats-service.js";
import { pruneTraceEventsOpportunistically } from "./service/trace-retention.js";
import { VerificationProjectionService } from "./service/verification-projection-service.js";
import { SessionService } from "./service/session-service.js";
import { ValidityService } from "./service/validity-service.js";
import { DriftCheckService } from "./service/drift-check-service.js";
import { OutlineMigrationService } from "./service/outline-migration-service.js";
import { OrdinalMigrationService } from "./service/ordinal-migration-service.js";
import { SpecParentMigrationService } from "./service/spec-parent-migration-service.js";
import { SeatService } from "./service/seat-service.js";
import { RealGitPort } from "./adapters/real-git-port.js";
import { realpathNative } from "./adapters/real-realpath-port.js";
import { ConfigService } from "./service/config-service.js";
import { GlobalConfigService } from "./service/global-config-service.js";
import { resolveDoc } from "./service/resolve.js";
// reason: SPEC-056 phase execution model DI — construction lives in phase-wiring.ts,
// NOT inline here, to minimize this file's diff surface against the concurrently-
// dispatched app.ts-wiring task (see phase-wiring.ts's module header).
import { buildPhaseServices } from "./adapters/cli/phase-wiring.js";
import type { PhaseWorkflowService } from "./service/phase-workflow-service.js";
import type { PhaseChecklistService } from "./service/phase-checklist-service.js";
import type { PhaseMigrationService } from "./service/phase-migration-service.js";
import { ResolutionProjector } from "./service/resolution-projector.js";
// reason: task-skill-implement-wire-a-real-resolutionlabelport-so-the — the
// ONE production ResolutionLabelPort, wired unconditionally on both store
// branches below (see the `resolutionProjector` field's own JSDoc for why
// this is no longer "optional here, absent in production").
import { GhResolutionLabelPort } from "./service/resolution-label-port.js";
import { GhRunner, createNodeGhExecFile } from "./service/gh-runner.js";
import { GhIssueCloser } from "./service/issue-closer-port.js";
import { IssueCloseOnArchive } from "./service/issue-close-on-archive.js";
import { isGithubUpstreamCfg, resolveFeedbackUpstreamCfg } from "./adapters/cli/report-issue-wiring.js";

export interface App {
  /**
   * Where this app's components (and the adapters that hold it) write advisory lines: the stderr writer of the run the
   * composition was built for (`ambient.io.stderr`). A line has no trailing newline; the sink adds it.
   */
  warn: WarnSink;
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
   * PhaseWorkflowService — the `phase` doc-type generalization of
   * `TaskWorkflowService`'s claim/release/evidence/ready mechanics (SPEC-056 D2,
   * T4). `task-workflow-service.ts` is untouched and stays live for legacy `task`
   * docs — the two services coexist as parallel files, not a migration in place.
   * Same optional-gate constructor shape as `taskWorkflowService` (own telemetry
   * wiring, `resolveDeclaredAcIds` port, `{enforcer, getPlanBundle}` gate bundle
   * gating the additive `phase-claim` checkpoint rather than `task-claim`).
   * Scoped to claim/release/evidence/ready ONLY — checklist/track mechanics are
   * `phaseChecklistService`, below. Constructed in
   * `adapters/cli/phase-wiring.ts::buildPhaseServices` (kept out of this file's own
   * composition bodies — see that module's header).
   *
   * Optional for the same reason `acService`/`driftCheckService`/`sessionService`
   * are: pre-existing hand-built App test stubs (HTTP routes / MCP tools / eval
   * scenarios — outside this task's file anchors) remain valid without a
   * mechanical touch to every one of them. Always present in production — both
   * `buildAppFromSqlite` and `buildAppFromTurso` wire it unconditionally.
   * Source: SPEC-056 §Module Boundary, §Design Decisions D1/D2/D7.
   */
  phaseWorkflowService?: PhaseWorkflowService;
  /**
   * PhaseChecklistService — checklist + track verbs on a `phase` doc's
   * `extra.checklist`/`extra.track` (SPEC-056 §Module Boundary) — mirrors
   * `AcService`'s add/list/remove-on-extra shape one level up. Store-only, no
   * telemetry, no gate — checklist/track mutation is not itself a gated
   * checkpoint (script-mode checklist items execute through the SPEC-039
   * trusted runner via a separate injected port, not through this service).
   * Constructed alongside `phaseWorkflowService` in
   * `adapters/cli/phase-wiring.ts::buildPhaseServices`.
   *
   * Optional for the same reason `phaseWorkflowService`/`acService` are:
   * pre-existing hand-built App test stubs remain valid without a mechanical
   * touch to every one of them. Always present in production — both
   * `buildAppFromSqlite` and `buildAppFromTurso` wire it unconditionally.
   * Source: SPEC-056 §Module Boundary, §Design Decisions D2.
   */
  phaseChecklistService?: PhaseChecklistService;
  /**
   * PhaseMigrationService — one-shot idempotent task→phase sweep (SPEC-056 §Design
   * Decisions D6/D6a) driving `lore migrate tasks-to-phases`. Store-only, no
   * telemetry, no gate (a one-shot migration path, not a steady-state write — same
   * rationale `MigrationService`/`PhaseService.migratePhases` document). Constructed
   * alongside `phaseWorkflowService`/`phaseChecklistService` in
   * `adapters/cli/phase-wiring.ts::buildPhaseServices`.
   *
   * Optional for the same reason `phaseWorkflowService`/`phaseChecklistService` are:
   * pre-existing hand-built App test stubs remain valid without a mechanical touch to
   * every one of them. Always present in production — both `buildAppFromSqlite` and
   * `buildAppFromTurso` wire it unconditionally.
   * Source: SPEC-056 §Module Boundary, §Acceptance Criteria AC-P-5.
   */
  phaseMigrationService?: PhaseMigrationService;
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
   * Read-only decision-log view for the dashboard's GET /api/decisions, /api/decisions/:id, /api/audit-items
   * (HR-T3). Only its pure `read*` methods may be called from HTTP: `listPending` appends stale-close markers.
   * Optional so test App literals stay valid; the routes answer 503 when absent.
   */
  decisionReadService?: DecisionService;
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
   * Where the HTTP route and the MCP tool compute the full-chain audit verdict: in a worker for every persistent
   * store, in-loop only for an InMemory composition, chosen by store kind in `buildAuditVerifyRunner`. It reads
   * `.lore/audit-anchor.json`, so those surfaces report the same anchor status as `lore audit --verify`. The CLI
   * calls `auditService.verify` directly (a one-shot process has no event loop to stall).
   * Required: every composition (both build paths, every test stub) names its runner, so no surface can end up
   * computing the verdict on its own loop by omission.
   * Source: plan-audit-verify-reads-only-the-keys-it-joins-runs-off-the D2, D3
   */
  auditVerifyRunner: AuditVerifyRunner;
  /**
   * StateBindingService — the per-corpus state-binding arming step (SPEC-143 AC-CT-3) behind
   * `lore audit arm`. Optional on the same precedent as `acService` (hand-built App test stubs
   * stay valid); always present in production — both build paths wire it unconditionally.
   */
  stateBindingService?: StateBindingService;
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
   * RunService — register/look up harness runs (spec-run-identity-slice-1 D5). Built over the SAME store
   * `createApp` selected (SQLite or Turso, D-007), never a second handle. Optional like `sessionService`
   * so hand-built App test stubs stay valid; always present from `createApp`.
   */
  runService?: RunService;
  /**
   * RunReapService — `lore run reap [--apply]` (AC-AU-5): ends runs that died without ending and reaps only the
   * processes an ended run provably left behind. Optional like `runService` so hand-built App test stubs stay valid.
   */
  runReapService?: RunReapService;
  /**
   * WorktreeRemovalService — THE "may this worktree be removed now" test's measurement + `lore worktree check|sweep`
   * (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a). Optional like `runService` so hand-built App test
   * stubs stay valid; always present from `createApp`.
   */
  worktreeRemovalService?: WorktreeRemovalService;
  /**
   * The invocation identity with its run VERIFIED against the registry (once; unregistered → `harnessRun`
   * null + one warning); `ok(undefined)` when this App was built without a write context (MCP/HTTP/tests).
   * Services' callers that DECIDE on the run (claim/release) must pass this, never the raw flag value.
   */
  verifiedInvocationIdentity?: () => Promise<Result<InvocationIdentity | undefined, LoreError>>;
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
   * VerificationProjectionService — assembles the dashboard adjudication
   * workbench's Evidence-tab projection for one doc (`GET /api/evidence-panel/:id`,
   * SPEC-075 §Module Boundary D1). Store-only, no telemetry, same DI shape as
   * `DriftCheckService`/`PhaseService` — plus one resolved scalar
   * (`resolveAttestationMinRatio(config)`, the SAME value `GateEnforcer` feeds
   * `attestationFloor`, so the plan panel and the `plan-close` gate can never
   * disagree on which floor a plan is measured against).
   *
   * Optional for the same reason `driftCheckService`/`acService` are:
   * pre-existing hand-built App test stubs (HTTP routes / MCP tools / eval
   * scenarios — outside this task's file anchors) remain valid without a
   * mechanical touch to every one of them. Always present in production —
   * both `buildAppFromSqlite` and `buildAppFromTurso` wire it unconditionally.
   * Source: SPEC-075 §Module Boundary D1, §Design Decisions D3/D6.
   */
  verificationProjectionService?: VerificationProjectionService;
  /**
   * OutlineMigrationService — one-shot, idempotent, per-section PRD→outline
   * migration (`lore migrate prd-to-outline`, SPEC-080 §Migration Plan
   * Phase 1). Store-only, no telemetry, no gate (a one-shot migration path,
   * same `PhaseMigrationService` rationale — no `outline-section-migrate`
   * checkpoint exists to gate against), same DI shape as
   * `PhaseMigrationService`/`DriftCheckService`.
   *
   * Optional for the same "pre-existing hand-built App test stubs stay
   * valid" reason `driftCheckService`/`verificationProjectionService` are;
   * always present in production — both `buildAppFromSqlite` and
   * `buildAppFromTurso` wire it unconditionally; the CLI guards
   * `app.outlineMigrationService === undefined` before use (mirrors
   * `app.driftCheckService`'s inline-guard convention, not
   * `phase-wiring.ts`'s bundled `requirePhaseMigrationService` — this
   * service has exactly one call site and needs no shared DI bundle).
   * Source: SPEC-080 §Migration Plan Phase 1, §Acceptance Criteria AC-080-7.
   */
  outlineMigrationService?: OutlineMigrationService;
  /**
   * OrdinalMigrationService — one-shot SPEC-084 repair migration
   * (`lore migrate ordinals [--apply]`). Store-only, no telemetry, no gate
   * (a one-shot migration path, same `PhaseMigrationService`/
   * `OutlineMigrationService` rationale), same DI shape as
   * `outlineMigrationService`.
   *
   * Optional for the same "pre-existing hand-built App test stubs stay
   * valid" reason `outlineMigrationService`/`driftCheckService` are; always
   * present in production — both `buildAppFromSqlite` and
   * `buildAppFromTurso` wire it unconditionally; the CLI guards
   * `app.ordinalMigrationService === undefined` before use (mirrors
   * `app.outlineMigrationService`'s inline-guard convention).
   * Source: SPEC-084 §One-shot repair migration, §Acceptance Criteria AC-084-4.
   */
  ordinalMigrationService?: OrdinalMigrationService;
  /**
   * SpecParentMigrationService — `lore migrate spec-parents [--apply | --revert]` (BR-1009, AC-BLS3B-7).
   * Store-only, no telemetry, no gate; optional for the same hand-built-App-stub reason as
   * `ordinalMigrationService`; always present in production; the CLI guards `=== undefined`.
   */
  specParentMigrationService?: SpecParentMigrationService;
  /**
   * UatService — the sole write orchestrator for a structured UAT verdict
   * (`lore uat record`, SPEC-054). Narrow injected ports (`corpusService.createUatDoc` /
   * `corpusService.resolve` / `store.addLink`), same optional-DI shape as `acService`.
   * Optional for the same "pre-existing hand-built App stubs stay valid" reason; always
   * wired in production.
   */
  uatService?: UatService;
  /**
   * RequirementService — the sole structured writer for a PRD's requirement inventory
   * (`lore requirement add/list/rm`, SPEC-055). Store-only, same optional-DI shape as
   * `acService`; always wired in production.
   */
  requirementService?: RequirementService;
  /**
   * RuleService — the sole writer of a `baseline` doc's verb-owned `extra` keys (rules with
   * permanent `BR-n` ids, label, depends_on, glossary) and of baseline node creation
   * (`lore rule add|set`, `lore baseline add|set-label|depends|glossary`, spec
   * baseline-slice-1 §C3). Holds the store plus the wired `corpusService.create`; same
   * optional-DI shape as `requirementService`; always wired in production.
   */
  ruleService?: RuleService;
  /**
   * RuleChangeService — the sole writer of a spec's rule change set (`extra.rule_changes`:
   * `lore rule propose|changes`). Needs the ONE RecordLockService; optional like `ruleService` so bare test
   * stubs stay valid; always wired in production.
   */
  ruleChangeService?: RuleChangeService;
  /**
   * RuleReadService / ImpactService — the read path of baseline rules (`lore rule show|find|impact`,
   * spec baseline-slice-2 C6). Store-only; optional like `ruleService` so bare test stubs stay valid.
   */
  ruleReadService?: RuleReadService;
  impactService?: ImpactService;
  /**
   * RecordLockService — the ONE lock resolver (spec documents-are-living-or-records D17). Exposed so read
   * surfaces (`lore get` Standing line) ask the same service the write gate asks. Optional like the other
   * store-only services so bare test stubs stay valid; always wired in production.
   */
  recordLockService?: RecordLockService;
  /**
   * PrdOutlineService — READ-ONLY reader of a PRD's stored outline (`lore outline list`); its writers
   * and the plan-close exemption writer were retired by slice 3a (BR-985). Store-only, same
   * optional-DI shape as `acService`/`requirementService`; always wired in production.
   */
  prdOutlineService?: PrdOutlineService;
  /**
   * PlanExemptionService — the sole writer of a plan's audited plan-close
   * exemptions (`lore plan exempt-attestation` / `exempt-assessment-freshness`,
   * SPEC-069 D1 + SPEC-106 D4). Store-only, same optional-DI shape as
   * `acService`/`prdOutlineService`; always wired in production.
   */
  planExemptionService?: PlanExemptionService;
  /**
   * SeatService — thin `GitPort` orchestration for the `lore seat` verb family
   * (`enter`/`list`/`resume`/`remove`, SPEC-057). Wired here with the REAL `GitPort`
   * (`RealGitPort(repoRoot)`, the same `repoRoot` `VerifyRunnerService` already
   * receives) and a `getReadyReport` thunk bound to `taskWorkflowService.ready` (fail-
   * open to `{anchor_conflicts: []}` on a `ready()` error — `GetReadyReport`'s type has
   * no `Result` wrapper to propagate a failure through, SPEC-057 §Public Interface).
   * Optional for the same "pre-existing hand-built App test stubs stay valid" reason as
   * `acService`/`driftCheckService`/`sessionService`; always wired in production.
   * Source: SPEC-057 §Module Boundary, §Design Decisions D1.
   */
  seatService?: SeatService;
  /**
   * ConfigService — the FIRST runtime write path for `.lore/config.yaml`
   * (`read`/`update`, SPEC-062 §Scope D1). Constructed over the corpus
   * directory (`repoRoot`, the SAME directory `VerifyRunnerService`/
   * `SeatService` already receive) rather than a store — config is file
   * state, not `StoreInterface` state — plus a narrow `appendAuditEntry` port
   * bound to `store.appendAuditEntry` for the D6 audit row.
   * Optional for the same "pre-existing hand-built App test stubs stay valid"
   * reason as `acService`/`seatService`/`uatService`; always wired in production.
   * Source: SPEC-062 §Scope D1, D6.
   */
  configService?: ConfigService;
  /**
   * GlobalConfigService — the machine-scope (`~/.config/lore/config.yaml` / XDG)
   * sibling of `configService` (SPEC-064 §Design D1/D7). Constructed over
   * `resolveGlobalConfigPath() ?? resolveGlobalConfigWritePath()` — the SAME
   * XDG-precedence helpers `loader.ts` already uses for the read-only global-
   * defaults merge, never a second resolution path — plus the same narrow
   * `appendAuditEntry` port `configService` receives.
   * Optional for the same "pre-existing hand-built App test stubs stay valid"
   * reason as `configService`/`acService`/`seatService`; always wired in production.
   * Source: SPEC-064 §Design D1.
   */
  globalConfigService?: GlobalConfigService;
  /**
   * ResolutionProjector — the one-way projection of a corpus-computed issue
   * resolution onto a GitHub `resolution:<state>` label (spec-the-defect-
   * channel-reaches-no-machine-but-its-own-github, Scope "ResolutionProjector",
   * AC-GI-4). `commands/issue.ts`'s `lore issue resolve` calls
   * `app.resolutionProjector?.project(...)` right after the corpus write
   * lands — this is the live call site the projector is reachable from,
   * never a `new ResolutionProjector(...)` built inline in that file.
   *
   * Wired unconditionally on BOTH store branches below, via
   * `GhResolutionLabelPort` (`service/resolution-label-port.ts`) — the
   * `GhRunner`-backed `ResolutionLabelPort` that lists an issue's current
   * labels, drops any stale `resolution:*` sibling, and adds the current
   * one (task-skill-implement-wire-a-real-resolutionlabelport-so-the).
   * Optional on this interface for the same "pre-existing hand-built App
   * test stubs stay valid" reason every other optional field here documents
   * — a bare `new XService(store)`-shaped construction of
   * `buildAppFromSqlite`/`buildAppFromTurso` predates this field and stays
   * valid without a mechanical touch; every REAL `createApp()` call gets one.
   */
  resolutionProjector?: ResolutionProjector;
  /**
   * The post-archive GitHub issue step (spec-archiving-the-work-that-resolves-a-defect-report-closes
   * D1-D4): the SAME instance `corpusService` and `taskWorkflowService` run after every archive, and
   * what `lore issues --sync` reads drift through. Always present on a `createApp()` App; its closer is
   * wired only when `feedback.upstream` is a GitHub repository (otherwise it reports "GitHub not
   * configured" instead of acting). Optional for hand-built App test stubs.
   */
  issueClose?: IssueCloseOnArchive;
  /**
   * TraceStatsService — read-only aggregation surface for `lore trace stats`
   * (SPEC-102). Store-only, no telemetry, same DI shape as `AuditService`
   * (stateless, IO-reads-only). Always constructed over `store` regardless of
   * `trace.enabled` — a disabled corpus simply reports all-zero counts (no
   * rows were ever written), never a missing service.
   * Optional for the same "pre-existing hand-built App test stubs stay valid"
   * reason as `driftCheckService`/`acService`; always wired in production.
   * Source: SPEC-102 §Acceptance Criteria AC-TRACE-4.
   */
  traceStatsService?: TraceStatsService;
  /**
   * SPEC-102 OPTIONAL read/deny-instrumentation port — the SAME instance
   * wired into `CorpusService`/`GateEnforcer` (service-layer deny). Exposed
   * on `App` so the CLI adapter can fire the HOOK-layer deny trace
   * (`kind="gate_deny"`, `layer="hook"`) from `commands/gate.ts`'s own six
   * `isCheckpointBlocked` branches — the ONLY consumer that needs a direct
   * reference (SPEC-102 D7: hook-layer and service-layer denies are counted
   * separately, since `lore gate` pre-empts the service call entirely on a
   * block). `undefined` when `trace.enabled` resolves `false`.
   */
  traceRecorder?: TraceRecorder;
  /**
   * SPEC-102 §Migration Strategy "retention prune" — fires the opportunistic,
   * BOUNDED-BATCH trace retention prune loop WITHOUT awaiting it
   * (fire-and-forget, mirrors `TraceRecorder`'s own contract). Bound in
   * `createApp` to `store.pruneTraceEvents` (local-only mode) or
   * `localTraceStore.pruneTraceEvents` (Turso mode — the SAME separate local
   * handle `TraceRecorder` writes through, never `this.client`). Absent when
   * `trace.enabled` resolves `false` — nothing is pruned (mirrors
   * `traceRecorder`'s identical "absent disables the feature" shape).
   * Called ONCE by `loader.ts`'s `loadLoreApp()` at CLI startup — MCP/HTTP
   * adapters (long-lived processes, not a per-invocation "startup") don't call it.
   * Optional for the same "pre-existing hand-built App test stubs stay valid"
   * reason as `driftCheckService`/`acService`.
   */
  pruneTraceEventsOpportunistically?(): void;
  /**
   * The corpus root — `dirname(dirname(dbPath))` (`dbPath` is always
   * `<repoRoot>/.lore/lore.db`), the SAME value threaded into
   * `VerifyRunnerService`'s `config.repoRoot` (SPEC-039 §2) and
   * `RealGitPort(repoRoot)` (SPEC-057). Exposed on `App` (SPEC-063 §Design
   * Decisions D1/D2) so the CLI adapter can pass it as `corpusRoot` to
   * `resolveVerifyExecutionRoot(...)` BEFORE calling `verifyPlan` — this is
   * the ONLY consumer that needed a public read of it; every other caller
   * (`VerifyRunnerService`/`SeatService`) already receives it via constructor
   * injection and does not read this field.
   *
   * Optional for the same reason `verifyRunnerService`/`acService` are:
   * pre-existing hand-built App test stubs (HTTP routes / MCP tools / eval
   * scenarios — outside this task's file anchors) remain valid without a
   * mechanical touch to every one of them. Always present in production —
   * both `buildAppFromSqlite` and `buildAppFromTurso` wire it unconditionally;
   * the CLI only ever receives a fully-wired App from `createApp`.
   * Source: SPEC-063 §Design Decisions D1.
   */
  repoRoot?: string;
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
  /**
   * Build a sibling App over the same corpus whose store is wrapped for ONE invocation identity
   * (spec-run-identity-slice-1 D3). For adapters that serve many callers from one process (MCP): the caller
   * runs one call against the returned App and `close()`s it. Present on every App `createApp` returns; absent on
   * hand-built test stubs, which an adapter must then treat as "cannot attest" rather than guess.
   */
  forWriteContext?: (writeContext: AppWriteContext) => Result<App, LoreError>;
  close(): void;
}

/**
 * Write context a CLI entry hands to {@link createApp}: the invocation identity resolved ONCE
 * (spec-run-identity-slice-1 D1) and the sink for the unregistered-run warning (default: stderr).
 */
export interface AppWriteContext {
  readonly identity: InvocationIdentity;
  readonly warn?: (line: string) => void;
  /** Called once with the identity after its run was verified against the registry (unknown run → null). */
  readonly onVerified?: (verified: InvocationIdentity) => void;
}

/**
 * The diff port the attestation floor's radius axis measures through (SPEC-143 AC-CT-9): a `SpawnGitPort`
 * whose repository root is resolved on FIRST use, so an app that never reads a stamped row never spawns the VCS.
 */
function lazyRadiusDiffPort(cwd: string): RadiusDiffPort {
  let port: SpawnGitPort | undefined;
  return {
    changedSince(sha, paths) {
      port ??= new SpawnGitPort(resolveGitRoot(cwd));
      return port.changedSince(sha, paths);
    },
  };
}

/**
 * Wires `VerifyRunnerService`'s state-binding SKIP path (SPEC-143 AC-CT-8): the read-only occupancy
 * reader plus the store's audit append. The writer of the lock protocol stays `scripts/oracle-lock.ts`.
 */
function buildStateBindingOccupancyPort(store: Pick<StoreInterface, "appendAuditEntry">): StateBindingOccupancyPort {
  return {
    probe: probeOccupancyForCheckout,
    recordSkip: (entry) => store.appendAuditEntry(entry),
  };
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
 * @param attestationMinRatio - `workflow.attestation.min_ratio` floor (SPEC-075
 *   §Public Interface), threaded into `VerificationProjectionService` — the SAME
 *   resolved value `GateEnforcer.resolveAttestationMinRatio` feeds `attestationFloor`,
 *   so the dashboard's plan Evidence-panel and the `plan-close` gate can never
 *   disagree on which floor a plan is measured against.
 * @param traceRecorder - SPEC-102 OPTIONAL read/deny-instrumentation port —
 *   constructed once in `createApp` (same "already-built instance" shape as
 *   `gateEnforcer`) ONLY when `trace.enabled` resolves `true`; `undefined`
 *   when trace recording is disabled by config. Wired into `CorpusService`
 *   (get/search) — `gateEnforcer` above already carries its OWN reference to
 *   the SAME instance (constructed in `createApp` before `gateEnforcer`
 *   itself, since `GateEnforcer`'s constructor needs it too).
 * @param surfaceBox - The SAME mutable `{current: CallerSurface}` box
 *   `createApp` constructed `traceRecorder`'s `getSurface` closure over
 *   (SPEC-102) — this function's `App.callerSurface` getter/setter read/write
 *   THIS box directly (replacing the previous function-local `let
 *   _callerSurface`) so a `TraceRecorder` built before this function runs
 *   still observes the surface an adapter sets AFTER `createApp` returns.
 *   Defaults to a fresh box for every pre-existing caller that doesn't pass
 *   one (bare test constructions, `createApp` callers with trace disabled) —
 *   behaviorally identical to the old function-local variable in that case.
 */
/**
 * The ambient process facts the composition root hands to the ports it wires: the environment, the user's home
 * directory, the OS temp directory and the working directory. Built from the entry's `Invocation` where there is one
 * (`ambientOfInvocation(inv)`); every caller supplies one — there is no process-reading fallback.
 */
export interface AppAmbient {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly tmpDir: string;
  /** The directory the entry ran in; git roots for the lazily-built git ports resolve from it. */
  readonly cwd: string;
  /** The writers of the run: advisory lines of the components wired below go to `io.stderr`. */
  readonly io: Invocation["io"];
}

/**
 * The {@link AppAmbient} of an entry's `Invocation`: the values the composition hands to the ports it wires.
 *
 * @param inv - the Invocation the entry resolved (or a test's `liveInvocation()`)
 * @returns `{ env, home, tmpDir, cwd, io }` copied from `inv`
 */
export function ambientOfInvocation(inv: Invocation): AppAmbient {
  return { env: inv.env, home: inv.paths.home, tmpDir: inv.paths.tmpDir, cwd: inv.cwd, io: inv.io };
}

function buildAppFromSqlite(
  store: SQLiteStore,
  telemetry: Telemetry = new NoOpTelemetry(),
  aiProviderService: AIProviderService,
  aiDefaultPerSurface: AiDefaultPerSurface | undefined,
  claimTtlMinutes: number = 120,
  handoffTtlMinutes: number = 10_080,
  auditVerifySince: string = "2026-07-06T00:00:00Z",
  verifyDefaultTimeoutMs: number = 300_000,
  verifyEnvConfig: VerifyEnvConfig = { allowlist: [], passthrough_all: false },
  verifyRequireCommandApproval: boolean = true,
  repoRoot: string,
  gateEnforcer: GateEnforcer = new GateEnforcer(undefined),
  requirementQuantifiableEnabled: boolean = true,
  attestationMinRatio: number | null = resolveAttestationMinRatio(undefined),
  traceRecorder: TraceRecorder | undefined,
  surfaceBox: { current: CallerSurface } = { current: "cli" },
  pruneTrigger: (() => void) | undefined,
  // SPEC-103 §Mechanisms M1/M2 — resolved config values (`resolveLedgerAutoApprove`/
  // `resolveJudgmentRequiredTypes`, `@lore/core`), threaded the SAME way every other
  // resolved-config-value param above is (`claimTtlMinutes` precedent) — never a raw
  // `LoreConfig` reference passed into either service. Defaults mirror the Zod
  // schema's own defaults so a caller that omits them (bare test construction) still
  // gets the SAME "default" reading `resolveLedgerAutoApprove(undefined)` would.
  ledgerAutoApprove: boolean = true,
  judgmentRequiredTypes: readonly string[] = resolveJudgmentRequiredTypes(undefined),
  // SPEC-102 hardening (T4 item 4) — the SAME mutable box `pruneTrigger`
  // (above) writes its in-flight promise into; `close()` below reads it so
  // an in-flight prune batch is waited out before the store handle it uses
  // is actually released (see `pruneTrigger`'s construction-site comment in
  // `createApp` for the full race this closes). `undefined` for every
  // pre-existing bare test construction that omits it (nothing to wait for
  // — `close()` falls back to closing immediately, byte-identical to
  // pre-hardening behavior).
  pruneState: { inFlight?: Promise<void> } | undefined,
  // spec-baseline-slice-2 §C4 — the raw `workflow.gates."ac-cite"` entry (`resolveCiteGateRaw`, `@lore/core`),
  // validated per write by the AC write chokepoint. The composition root ALWAYS arms the citation gate
  // (even with `undefined`): it then resolves to its default — off without baseline docs, report with
  // them. Only a bare `new AcService(store)` / `new CorpusService(store)` is ungated.
  citeGateRaw: unknown,
  ambient: AppAmbient,
  // reason: built where the store kind and corpus path are known (createAppUnscoped), never re-derived here.
  auditVerifyRunner: AuditVerifyRunner,
): App {
  const db = store.getDatabase();
  // reason: claimTtlMinutes flows into DocSummary.meta's task.claim_stale (SPEC-036 §2
  // D3) — same resolved value TaskWorkflowService below uses, one resolution path
  // (resolveClaimTtlMinutes at the bottom of this file).
  // reason: 4th arg wires GateEnforcer (retro follow-up item 8, defense-in-depth) —
  // CorpusService gates spec-create (_createImpl) and spec-promote reached via `set`.
  // 5th arg wires SPEC-102's OPTIONAL TraceRecorder (undefined when trace.enabled
  // resolves false) — CorpusService.get/search fire a fire-and-forget trace row.
  // reason: spec-documents-are-living-or-records D17 — ONE RecordLockService (store + the config-/audit-wired
  // gate enforcer) is the REQUIRED constructor argument of the four rewrite-path services below, so no write
  // path can be composed ungated.
  const recordLockService = new RecordLockService(store, gateEnforcer);
  const corpusService = new CorpusService(
    store,
    recordLockService,
    telemetry,
    claimTtlMinutes,
    gateEnforcer,
    traceRecorder,
    ledgerAutoApprove,
  );
  corpusService.setCiteGate(citeGateRaw);
  // reason: BR-984 — plan-close's cited-rule-state predicate reads rule state through the real git port.
  // Built lazily (git root resolved on first use) so an app that never closes a plan never spawns git.
  corpusService.setRuleStateService({
    full: () => new RuleStateService(store, new SpawnGitPort(resolveGitRoot(ambient.cwd))).full(),
  });
  // reason: AC-CT-9 — the attestation floor's radius axis diffs through the SAME lazy git port shape (git root
  // resolved on first measurement, so an app that never reads a stamped row never spawns git).
  const stampRadiusDiff = lazyRadiusDiffPort(ambient.cwd);
  corpusService.setStampRadiusDiff(stampRadiusDiff);
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
  // reason: 6th arg wires task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref's
  // ad-hoc sibling port — CorpusService.resolveDeclaredAcIdsForAdhocTask resolves an
  // --adhoc task's governing spec via its own declared ac_scope (never a plan→spec
  // walk, structurally impossible for an --adhoc task).
  // reason: 7th arg is the ONLY place `process.env` reaches the claim path's session
  // capture (task-two-concurrent-orchestrators-both-resolve-to-agent-main) — the
  // service defaults to `{}` so unit constructions stay deterministic, so EVERY
  // shipped surface depends on this one line being here. Pinned by an end-to-end
  // oracle over the real `createApp` (tests/integration/claim-session-capture-app-wiring.bun.test.ts).
  // reason: 8th/9th args wire task-widen-the-declared-ac-port-to-carry-criteria-so-the's
  // generation-carrying siblings of the 4th/6th args — `resolveDeclaredAcCriteria`/
  // `resolveDeclaredAcCriteriaForAdhocTask` return the full criterion (not just its id),
  // which `resolveAcOracleGeneration` needs and a bare id set structurally cannot supply.
  const worktreeRemovalService = buildWorktreeRemovalService(store, ambient, repoRoot);
  const taskWorkflowService = new TaskWorkflowService(
    store,
    telemetry,
    { claimTtlMinutes, repoRoot },
    corpusService.resolveDeclaredAcIds.bind(corpusService),
    { enforcer: gateEnforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
    corpusService.resolveDeclaredAcIdsForAdhocTask.bind(corpusService),
    ambient.env,
    corpusService.resolveDeclaredAcCriteria.bind(corpusService),
    corpusService.resolveDeclaredAcCriteriaForAdhocTask.bind(corpusService),
    // reason: args 10-13 keep their real-IO defaults; arg 14 is the single worktree-removal test's facts for `done`'s
    // cleanup (both composition roots must pass it, or `lore done` reports every worktree not-measured).
    undefined,
    undefined,
    undefined,
    createRealWorktreeProbe(ambient.cwd),
    worktreeRemovalService,
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
    readTrail: (sessionId) => readSessionTrail(sessionId, stateBase(ambient.env, ambient.home)),
  }, undefined, createWriteSessionHeartbeat(ambient.tmpDir), createReadSessionHeartbeat(ambient.tmpDir));
  // reason: extracted to a local (mirrors taskWorkflowService/sessionService above) so
  // both the `judgmentService:` field AND `validityService`'s SPEC-044 D12 calibration
  // port AND `stalenessProbeService`'s recordJudgment port can bind to the SAME instance
  // — never three separately-constructed JudgmentServices.
  const judgmentService = new JudgmentService(store, telemetry);
  // reason: SPEC-056 phase execution model (PhaseWorkflowService + PhaseChecklistService)
  // — DI construction lives in phase-wiring.ts's buildPhaseServices (same optional-gate
  // DI shape as taskWorkflowService: own telemetry, resolveDeclaredAcIds port,
  // {enforcer, getPlanBundle} gate bundle gating "phase-claim" rather than "task-claim")
  // so this file's own composition bodies stay minimal — see that module's header.
  const phaseServices = buildPhaseServices(store, telemetry, claimTtlMinutes, gateEnforcer, corpusService, ambient.env);
  // reason: hoisted to a local so the SAME ReviewService instance is both the App's `reviewService` and
  // the approval path CorpusService.set(status: "approved") delegates to (BR-1071, issues #65 #50) —
  // services never import each other, so the port is wired here, never inside CorpusService.
  const reviewService = new ReviewService(
    store,
    recordLockService,
    claimTtlMinutes,
    { enforcer: gateEnforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
    judgmentService,
    judgmentRequiredTypes,
  );
  corpusService.setApprovalPort({ approve: (id, o) => reviewService.approve(id, o) });
  corpusService.setDoneFloorPort({ checkDoneFloors: (id) => taskWorkflowService.checkDoneFloors(id) });
  // reason: AC-AU-7 — the self-grantable overrides (approve --override-*, done --override-attestation) ask decide();
  // both composition roots wire it (a root that forgets leaves those overrides granted to whoever types them).
  const overrideDecisionPort = buildOverrideDecisionPort(store);
  reviewService.setOverrideDecisionPort(overrideDecisionPort);
  taskWorkflowService.setOverrideDecisionPort(overrideDecisionPort);
  // reason: plan close and spec deprecation land / abandon a spec's rule change set through ONE writer
  // (D3, spec-a-spec-carries-its-rule-changes-the-baseline-takes-them); the instance is shared with the
  // `lore rule` verbs so a claim-scoped authoring guard armed on it covers both.
  const ruleChangeService = new RuleChangeService(store, recordLockService);
  corpusService.setRuleChangeLanding(ruleChangeService);
  return {
    warn: warnSinkOf(ambient.io.stderr),
    corpusService,
    ...phaseServices,
    // reason: same resolved claimTtlMinutes as CorpusService above — one resolution
    // path feeds PendingDoc.meta's task.claim_stale too (SPEC-036 §2 D3 pending-queue
    // extension), not a second config read. 3rd arg wires GateEnforcer (retro follow-up
    // item 8) — approve() gates spec-promote (spec docs) and plan-promote (plan docs,
    // via the same corpusService.getPlanBundle port TaskWorkflowService above uses).
    // reason: SPEC-103 §Mechanisms M2 — 4th/5th args wire the judgment-required
    // gate's IO dependency (judgmentService, constructed above) and its resolved
    // per-type config value (judgmentRequiredTypes), mirroring the claimTtlMinutes/
    // gateEnforcer resolved-value DI shape every other optional dependency here uses.
    reviewService,
    versionService: new VersionService(store, recordLockService, corpusService),
    outlineService,
    migrationService: new MigrationService(store, corpusService),
    treeCheckService: new TreeCheckService(store, corpusService),
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
    }, warnSinkOf(ambient.io.stderr)),
    // reason: PhaseService depends only on StoreInterface — stateless, no AI, no telemetry. SPEC-023 §9.1.
    phaseService: new PhaseService(store, recordLockService, corpusService),
    taskWorkflowService,
    sessionService,
    runService: new RunService(store, undefined, taskWorkflowService, realpathNative, repoRoot, createRealWorktreeProbe(ambient.cwd)),
    runReapService: buildRunReapService(store, taskWorkflowService, ambient, repoRoot),
    worktreeRemovalService,
    verifiedInvocationIdentity: () => ensureVerifiedIdentity(store),
    // reason: ValidityService owns extra.validity (bi-temporal invalidation) — store +
    // own telemetry wiring, same DI shape as TaskWorkflowService/JudgmentService.
    // SPEC-043 §Design Decisions D2. 3rd arg wires the SPEC-044 D12 OPTIONAL calibration
    // port — a stale_candidate probe that a human later confirms via `lore invalidate`
    // writes exactly one calibration record FK'd to that judgment; bound to the SAME
    // judgmentService instance the `judgmentService:`/`stalenessProbeService:` fields use.
    validityService: new ValidityService(store, telemetry, {
      latestStalenessJudgment: (docId) => judgmentService.latestFor(docId, "staleness"),
      recordCalibration: judgmentService.recordCalibration.bind(judgmentService),
    }, corpusService),
    // reason: DriftCheckService depends only on StoreInterface — stateless, no AI, no
    // telemetry, same shape as PhaseService/AcService. SPEC-045 §Design Decisions D4.
    driftCheckService: new DriftCheckService(store),
    // reason: VerificationProjectionService depends only on StoreInterface plus the
    // resolved attestationMinRatio scalar — stateless, no AI, no telemetry, same DI
    // shape as DriftCheckService/PhaseService. SPEC-075 §Module Boundary D1/D6.
    verificationProjectionService: new VerificationProjectionService(store, attestationMinRatio, stampRadiusDiff),
    // reason: OutlineMigrationService depends only on StoreInterface — stateless,
    // no AI, no telemetry, same shape as PhaseMigrationService/DriftCheckService.
    // SPEC-080 §Migration Plan Phase 1.
    outlineMigrationService: new OutlineMigrationService(store),
    // reason: OrdinalMigrationService depends only on StoreInterface — stateless,
    // no AI, no telemetry, same shape as OutlineMigrationService/PhaseMigrationService.
    // SPEC-084 §One-shot repair migration.
    ordinalMigrationService: new OrdinalMigrationService(store, corpusService),
    specParentMigrationService: new SpecParentMigrationService(store),
    // reason: SeatService (SPEC-057) — real GitPort over the SAME repoRoot
    // VerifyRunnerService already receives (captured at composition time, never a
    // second `process.cwd()` read); getReadyReport is bound to
    // `taskWorkflowService.ready`, fail-open to `{anchor_conflicts: []}` on a
    // `ready()` error (GetReadyReport's type carries no Result to propagate a
    // failure through — SeatService.enter's own readiness check would otherwise be
    // unreachable on a plan-resolution hiccup that isn't itself the plan's fault).
    seatService: new SeatService(store, new RealGitPort(repoRoot), async (planId) => {
      const readyResult = await taskWorkflowService.ready(planId);
      return readyResult.ok ? { anchor_conflicts: readyResult.value.anchor_conflicts } : { anchor_conflicts: [] };
    }),
    // reason: SpecKindService depends only on StoreInterface — stateless, no AI, no telemetry,
    // same shape as PhaseService. SPEC-032 §3.4.
    specKindService: new SpecKindService(store),
    // reason: JudgmentService owns review_judgments + calibration_records — store + own
    // telemetry wiring, same DI shape as TaskWorkflowService (D8). SPEC-034 §5, §9.1.
    judgmentService,
    decisionReadService: new DecisionService({ store, executorRun: null }),
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
    auditVerifyRunner,
    stateBindingService: new StateBindingService(store),
    // reason: AcService depends only on StoreInterface — stateless, no AI, no telemetry,
    // same shape as PhaseService. SPEC-038 §4, §6, §9.1.
    acService: new AcService(store, recordLockService, { citeGate: citeGateRaw }),
    // reason: RequirementService is store-only, same shape as AcService (SPEC-055).
    // 2nd arg wires the resolved workflow.requirement_quantifiable.enabled config
    // brake (SPEC-059 §Scope) — one resolution path (resolveRequirementQuantifiableEnabled
    // at createApp), mirroring claimTtlMinutes's identical "resolve once, thread down" shape.
    requirementService: new RequirementService(store, requirementQuantifiableEnabled, corpusService),
    // reason: RuleService gets the WIRED corpusService.create (gates + provenance guards apply to
    // node creation); its `createDoc` port is required — RuleService builds no CorpusService of its own.
    ruleService: new RuleService(store, corpusService.create.bind(corpusService), corpusService),
    // reason: the change set of a locked spec is gated by the ONE RecordLockService, like criteria edits.
    ruleChangeService,
    ruleReadService: new RuleReadService(store),
    impactService: new ImpactService(store),
    recordLockService,
    // reason: PrdOutlineService is store-only, same shape as AcService/
    // RequirementService (SPEC-080 C1, C4).
    prdOutlineService: new PrdOutlineService(store),
    // reason: PlanExemptionService is store-only, same shape as PrdOutlineService
    // (SPEC-069 D1 + SPEC-106 D4) — the sole writer of the plan-close exemption
    // fields, which were gate-read with no authoring surface before it existed.
    planExemptionService: new PlanExemptionService(store),
    // reason: UatService takes narrow injected ports (SPEC-054) — the guarded
    // createUatDoc seam, the shared resolveDoc helper, and store.addLink — never the
    // full CorpusService. `resolveTarget` is bound to `resolveDoc` (not
    // `corpusService.resolve`, which projects away `.type`) because
    // task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict's fix needs the
    // target's actual type to refuse a non-plan target before any doc/link is created.
    uatService: new UatService({
      createUatDoc: corpusService.createUatDoc.bind(corpusService),
      resolveTarget: (idOrSlug: string) => resolveDoc(store, idOrSlug),
      addLink: store.addLink.bind(store),
      now: () => new Date().toISOString(),
    }),
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
        processEnv: ambient.env,
        tmpDir: ambient.tmpDir,
        warn: warnSinkOf(ambient.io.stderr),
      },
      undefined,
      undefined,
      buildStateBindingOccupancyPort(store),
      worktreeRemovalService,
    ).setOverrideDecisionPort(overrideDecisionPort),
    // reason: ConfigService (SPEC-062 D1) — constructed over the SAME repoRoot
    // VerifyRunnerService/SeatService already receive (config lives at
    // "<repoRoot>/.lore/config.yaml"), not a store; the narrow appendAuditEntry
    // port is bound directly to the store for the D6 audit row.
    configService: new ConfigService(repoRoot, store.appendAuditEntry.bind(store)),
    // reason: GlobalConfigService (SPEC-064 D1) — the machine-scope sibling of
    // ConfigService above, over the XDG global config path rather than repoRoot.
    // `resolveGlobalConfigPath()` returns undefined when no global config file
    // exists yet (D7 — a missing file is `ok({})`, not an error); falling back to
    // `resolveGlobalConfigWritePath()` gives GlobalConfigService.update somewhere
    // to write the FIRST machine config to, mirroring loader.ts's read-only use of
    // the same pair.
    globalConfigService: new GlobalConfigService(
      resolveGlobalConfigPath(ambient.env, ambient.home) ?? resolveGlobalConfigWritePath(ambient.env, ambient.home),
      store.appendAuditEntry.bind(store),
    ),
    // reason: task-skill-implement-wire-a-real-resolutionlabelport-so-the —
    // ResolutionProjector over the real GhRunner-backed ResolutionLabelPort.
    // GhRunner takes NO repoRoot/config (unlike SeatService's RealGitPort
    // above) — its only real dependency is `createNodeGhExecFile()`, the
    // production `execFile` wrapper — so this, like `RealGitPort(repoRoot)`
    // above, is constructed fresh inline rather than threaded down as a
    // createApp parameter.
    resolutionProjector: new ResolutionProjector(
      new GhResolutionLabelPort(new GhRunner({ execFile: createNodeGhExecFile(ambient.cwd), env: ambient.env })),
    ),
    // reason: TraceStatsService (SPEC-102) is store-only, no telemetry, same
    // shape as AuditService/DriftCheckService — always constructed regardless
    // of trace.enabled (a disabled corpus just reports all-zero counts).
    traceStatsService: new TraceStatsService(store),
    // reason: SPEC-102 — exposes the SAME TraceRecorder instance wired into
    // CorpusService/gateEnforcer above, so commands/gate.ts can fire the
    // hook-layer deny trace directly (see this field's App JSDoc).
    ...(traceRecorder !== undefined ? { traceRecorder } : {}),
    // reason: SPEC-102 §Migration Strategy — fire-and-forget prune trigger,
    // bound in createApp; undefined when trace.enabled resolves false.
    ...(pruneTrigger !== undefined ? { pruneTraceEventsOpportunistically: pruneTrigger } : {}),
    // reason: SPEC-063 §Design Decisions D1 — exposed so the CLI adapter can read
    // the corpus root as `resolveVerifyExecutionRoot`'s `corpusRoot` input, the
    // SAME value already threaded into VerifyRunnerService's config.repoRoot below.
    repoRoot,
    // reason: telemetry exposed on App so dashboard route handlers can emit source-tagged events
    // without requiring service-layer signature changes (SPEC-022 §9.6).
    telemetry,
    // SPEC-024: callerSurface getter/setter + resolveAiDefault — reads/writes
    // `surfaceBox` directly (SPEC-102) so a `TraceRecorder` built in `createApp`
    // BEFORE this function ran still observes the surface an adapter sets AFTER
    // `createApp` returns (see this function's `surfaceBox` param JSDoc).
    get callerSurface(): CallerSurface { return surfaceBox.current; },
    set callerSurface(s: CallerSurface) { surfaceBox.current = s; },
    resolveAiDefault(explicit: boolean | undefined) {
      return resolveAiDefault(explicit, surfaceBox.current, aiDefaultPerSurface);
    },
    // SPEC-102 hardening (T4 item 4) — if a prune batch is IN FLIGHT
    // (`pruneState.inFlight` set), wait for it to settle before releasing
    // the handles it reads/writes through, instead of racing a `DELETE`
    // against an already-closed `store`. Still non-blocking from the
    // command's own perspective: `close()` itself returns immediately
    // (`void`), it only defers WHEN the underlying handles actually close.
    close: () => {
      const releaseHandles = () => { telemetry.close(); store.close(); };
      if (pruneState?.inFlight !== undefined) {
        void pruneState.inFlight.finally(releaseHandles);
      } else {
        releaseHandles();
      }
    },
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
 * @param attestationMinRatio - `workflow.attestation.min_ratio` floor — see
 *   `buildAppFromSqlite`'s identical parameter JSDoc.
 * @param traceRecorder - SPEC-102 OPTIONAL read/deny-instrumentation port —
 *   see `buildAppFromSqlite`'s identical parameter JSDoc. In Turso mode this
 *   is constructed by `createApp` over a SEPARATE local `bun:sqlite` handle
 *   on the replica FILE (`localTraceStore`, below) — trace writes NEVER route
 *   through `this.client` (the libsql/remote-syncing connection), mirroring
 *   `ApiKeyStore`'s identical "separate local handle on the replica file"
 *   precedent one field up (SPEC-102 D3).
 * @param surfaceBox - See `buildAppFromSqlite`'s identical parameter JSDoc.
 * @param localTraceStore - The SAME `SQLiteStore` instance `traceRecorder`'s
 *   `insert` port is bound to (when trace is enabled) — threaded through so
 *   `close()` can release this SECOND connection on the replica file
 *   alongside `apiKeyDb`. `undefined` when trace is disabled (nothing to close).
 */
function buildAppFromTurso(
  store: TursoStore,
  dbPath: string,
  telemetry: Telemetry = new NoOpTelemetry(),
  aiProviderService: AIProviderService,
  aiDefaultPerSurface: AiDefaultPerSurface | undefined,
  claimTtlMinutes: number = 120,
  handoffTtlMinutes: number = 10_080,
  auditVerifySince: string = "2026-07-06T00:00:00Z",
  verifyDefaultTimeoutMs: number = 300_000,
  verifyEnvConfig: VerifyEnvConfig = { allowlist: [], passthrough_all: false },
  verifyRequireCommandApproval: boolean = true,
  repoRoot: string,
  gateEnforcer: GateEnforcer = new GateEnforcer(undefined),
  requirementQuantifiableEnabled: boolean = true,
  attestationMinRatio: number | null = resolveAttestationMinRatio(undefined),
  traceRecorder: TraceRecorder | undefined,
  surfaceBox: { current: CallerSurface } = { current: "cli" },
  localTraceStore: SQLiteStore | undefined,
  pruneTrigger: (() => void) | undefined,
  // SPEC-103 §Mechanisms M1/M2 — resolved config values (`resolveLedgerAutoApprove`/
  // `resolveJudgmentRequiredTypes`, `@lore/core`), threaded the SAME way every other
  // resolved-config-value param above is (`claimTtlMinutes` precedent) — never a raw
  // `LoreConfig` reference passed into either service. Defaults mirror the Zod
  // schema's own defaults so a caller that omits them (bare test construction) still
  // gets the SAME "default" reading `resolveLedgerAutoApprove(undefined)` would.
  ledgerAutoApprove: boolean = true,
  judgmentRequiredTypes: readonly string[] = resolveJudgmentRequiredTypes(undefined),
  // SPEC-102 hardening (T4 item 4) — see `buildAppFromSqlite`'s identical
  // parameter JSDoc; the SAME mutable box `pruneTrigger` (above) writes its
  // in-flight promise into, read by `close()` below.
  pruneState: { inFlight?: Promise<void> } | undefined,
  // See buildAppFromSqlite's identical parameter JSDoc.
  citeGateRaw: unknown,
  ambient: AppAmbient,
  // reason: built where the store kind and corpus path are known (createAppUnscoped), never re-derived here.
  auditVerifyRunner: AuditVerifyRunner,
): App {
  const apiKeyDb = new Database(dbPath);
  // reason: claimTtlMinutes flows into DocSummary.meta's task.claim_stale (SPEC-036 §2
  // D3) — same resolved value TaskWorkflowService below uses, one resolution path
  // (resolveClaimTtlMinutes at the bottom of this file).
  // reason: 4th arg wires GateEnforcer (retro follow-up item 8) — see buildAppFromSqlite's
  // identical comment. 5th arg wires SPEC-102's OPTIONAL TraceRecorder — see
  // buildAppFromSqlite's identical comment.
  // reason: spec-documents-are-living-or-records D17 — ONE RecordLockService (store + the config-/audit-wired
  // gate enforcer) is the REQUIRED constructor argument of the four rewrite-path services below, so no write
  // path can be composed ungated.
  const recordLockService = new RecordLockService(store, gateEnforcer);
  const corpusService = new CorpusService(
    store,
    recordLockService,
    telemetry,
    claimTtlMinutes,
    gateEnforcer,
    traceRecorder,
    ledgerAutoApprove,
  );
  corpusService.setCiteGate(citeGateRaw);
  // reason: BR-984 — plan-close's cited-rule-state predicate reads rule state through the real git port.
  // Built lazily (git root resolved on first use) so an app that never closes a plan never spawns git.
  corpusService.setRuleStateService({
    full: () => new RuleStateService(store, new SpawnGitPort(resolveGitRoot(ambient.cwd))).full(),
  });
  // reason: AC-CT-9 — the attestation floor's radius axis diffs through the SAME lazy git port shape (git root
  // resolved on first measurement, so an app that never reads a stamped row never spawns git).
  const stampRadiusDiff = lazyRadiusDiffPort(ambient.cwd);
  corpusService.setStampRadiusDiff(stampRadiusDiff);
  const outlineService = new OutlineService(store);
  // reason: extracted to a local (see buildAppFromSqlite's identical comment) so
  // VerifyRunnerService can bind its recordVerifiedEvidence method below. 5th arg
  // wires GateEnforcer's {enforcer, getPlanBundle} bundle — see buildAppFromSqlite's
  // identical comment.
  // reason: 6th arg wires task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref's
  // ad-hoc sibling port — see buildAppFromSqlite's identical comment.
  // reason: 7th arg wires the claim path's session capture — see
  // buildAppFromSqlite's identical comment (both composition roots must pass it,
  // or the Turso-backed surface silently records no session_id).
  // reason: 8th/9th args — see buildAppFromSqlite's identical comment (both
  // composition roots must wire the generation-carrying siblings, or the
  // Turso-backed surface silently stamps no `ac_oracle_generation`).
  const worktreeRemovalService = buildWorktreeRemovalService(store, ambient, repoRoot);
  const taskWorkflowService = new TaskWorkflowService(
    store,
    telemetry,
    { claimTtlMinutes, repoRoot },
    corpusService.resolveDeclaredAcIds.bind(corpusService),
    { enforcer: gateEnforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
    corpusService.resolveDeclaredAcIdsForAdhocTask.bind(corpusService),
    ambient.env,
    corpusService.resolveDeclaredAcCriteria.bind(corpusService),
    corpusService.resolveDeclaredAcCriteriaForAdhocTask.bind(corpusService),
    // reason: args 10-13 keep their real-IO defaults; arg 14 is the single worktree-removal test's facts for `done`'s
    // cleanup (both composition roots must pass it, or `lore done` reports every worktree not-measured).
    undefined,
    undefined,
    undefined,
    createRealWorktreeProbe(ambient.cwd),
    worktreeRemovalService,
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
    readTrail: (sessionId) => readSessionTrail(sessionId, stateBase(ambient.env, ambient.home)),
  }, undefined, createWriteSessionHeartbeat(ambient.tmpDir), createReadSessionHeartbeat(ambient.tmpDir));
  // reason: extracted to a local (mirrors buildAppFromSqlite's identical comment) so both
  // the `judgmentService:` field AND `validityService`'s SPEC-044 D12 calibration port
  // AND `stalenessProbeService`'s recordJudgment port can bind to the SAME instance.
  const judgmentService = new JudgmentService(store, telemetry);
  // reason: SPEC-056 phase execution model (PhaseWorkflowService + PhaseChecklistService)
  // — see buildAppFromSqlite's identical comment.
  const phaseServices = buildPhaseServices(store, telemetry, claimTtlMinutes, gateEnforcer, corpusService, ambient.env);
  // reason: hoisted to a local so the SAME ReviewService instance is both the App's `reviewService` and
  // the approval path CorpusService.set(status: "approved") delegates to (BR-1071, issues #65 #50) —
  // services never import each other, so the port is wired here, never inside CorpusService.
  const reviewService = new ReviewService(
    store,
    recordLockService,
    claimTtlMinutes,
    { enforcer: gateEnforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
    judgmentService,
    judgmentRequiredTypes,
  );
  corpusService.setApprovalPort({ approve: (id, o) => reviewService.approve(id, o) });
  corpusService.setDoneFloorPort({ checkDoneFloors: (id) => taskWorkflowService.checkDoneFloors(id) });
  // reason: AC-AU-7 — the self-grantable overrides (approve --override-*, done --override-attestation) ask decide();
  // both composition roots wire it (a root that forgets leaves those overrides granted to whoever types them).
  const overrideDecisionPort = buildOverrideDecisionPort(store);
  reviewService.setOverrideDecisionPort(overrideDecisionPort);
  taskWorkflowService.setOverrideDecisionPort(overrideDecisionPort);
  // reason: plan close and spec deprecation land / abandon a spec's rule change set through ONE writer
  // (D3, spec-a-spec-carries-its-rule-changes-the-baseline-takes-them); the instance is shared with the
  // `lore rule` verbs so a claim-scoped authoring guard armed on it covers both.
  const ruleChangeService = new RuleChangeService(store, recordLockService);
  corpusService.setRuleChangeLanding(ruleChangeService);
  return {
    warn: warnSinkOf(ambient.io.stderr),
    corpusService,
    ...phaseServices,
    // reason: same resolved claimTtlMinutes as CorpusService above — one resolution
    // path feeds PendingDoc.meta's task.claim_stale too (SPEC-036 §2 D3 pending-queue
    // extension), not a second config read. 3rd arg wires GateEnforcer — see
    // buildAppFromSqlite's identical comment.
    // reason: SPEC-103 §Mechanisms M2 — 4th/5th args wire the judgment-required
    // gate's IO dependency (judgmentService, constructed above) and its resolved
    // per-type config value (judgmentRequiredTypes), mirroring the claimTtlMinutes/
    // gateEnforcer resolved-value DI shape every other optional dependency here uses.
    reviewService,
    versionService: new VersionService(store, recordLockService, corpusService),
    outlineService,
    migrationService: new MigrationService(store, corpusService),
    treeCheckService: new TreeCheckService(store, corpusService),
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
    }, warnSinkOf(ambient.io.stderr)),
    // reason: PhaseService depends only on StoreInterface — stateless, no AI, no telemetry. SPEC-023 §9.1.
    phaseService: new PhaseService(store, recordLockService, corpusService),
    taskWorkflowService,
    sessionService,
    runService: new RunService(store, undefined, taskWorkflowService, realpathNative, repoRoot, createRealWorktreeProbe(ambient.cwd)),
    runReapService: buildRunReapService(store, taskWorkflowService, ambient, repoRoot),
    worktreeRemovalService,
    verifiedInvocationIdentity: () => ensureVerifiedIdentity(store),
    // reason: ValidityService owns extra.validity (bi-temporal invalidation) — store +
    // own telemetry wiring, same DI shape as TaskWorkflowService/JudgmentService.
    // SPEC-043 §Design Decisions D2. 3rd arg wires the SPEC-044 D12 OPTIONAL calibration
    // port — see buildAppFromSqlite's identical comment.
    validityService: new ValidityService(store, telemetry, {
      latestStalenessJudgment: (docId) => judgmentService.latestFor(docId, "staleness"),
      recordCalibration: judgmentService.recordCalibration.bind(judgmentService),
    }, corpusService),
    // reason: DriftCheckService depends only on StoreInterface — stateless, no AI, no
    // telemetry, same shape as PhaseService/AcService. SPEC-045 §Design Decisions D4.
    driftCheckService: new DriftCheckService(store),
    // reason: VerificationProjectionService depends only on StoreInterface plus the
    // resolved attestationMinRatio scalar — stateless, no AI, no telemetry, same DI
    // shape as DriftCheckService/PhaseService. SPEC-075 §Module Boundary D1/D6.
    verificationProjectionService: new VerificationProjectionService(store, attestationMinRatio, stampRadiusDiff),
    // reason: OutlineMigrationService depends only on StoreInterface — stateless,
    // no AI, no telemetry, same shape as PhaseMigrationService/DriftCheckService.
    // SPEC-080 §Migration Plan Phase 1.
    outlineMigrationService: new OutlineMigrationService(store),
    // reason: OrdinalMigrationService depends only on StoreInterface — stateless,
    // no AI, no telemetry, same shape as OutlineMigrationService/PhaseMigrationService.
    // SPEC-084 §One-shot repair migration.
    ordinalMigrationService: new OrdinalMigrationService(store, corpusService),
    specParentMigrationService: new SpecParentMigrationService(store),
    // reason: SeatService (SPEC-057) — real GitPort over the SAME repoRoot
    // VerifyRunnerService already receives (captured at composition time, never a
    // second `process.cwd()` read); getReadyReport is bound to
    // `taskWorkflowService.ready`, fail-open to `{anchor_conflicts: []}` on a
    // `ready()` error (GetReadyReport's type carries no Result to propagate a
    // failure through — SeatService.enter's own readiness check would otherwise be
    // unreachable on a plan-resolution hiccup that isn't itself the plan's fault).
    seatService: new SeatService(store, new RealGitPort(repoRoot), async (planId) => {
      const readyResult = await taskWorkflowService.ready(planId);
      return readyResult.ok ? { anchor_conflicts: readyResult.value.anchor_conflicts } : { anchor_conflicts: [] };
    }),
    // reason: SpecKindService depends only on StoreInterface — stateless, no AI, no telemetry,
    // same shape as PhaseService. SPEC-032 §3.4.
    specKindService: new SpecKindService(store),
    // reason: JudgmentService owns review_judgments + calibration_records — store + own
    // telemetry wiring, same DI shape as TaskWorkflowService (D8). SPEC-034 §5, §9.1.
    judgmentService,
    decisionReadService: new DecisionService({ store, executorRun: null }),
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
    auditVerifyRunner,
    stateBindingService: new StateBindingService(store),
    // reason: AcService depends only on StoreInterface — stateless, no AI, no telemetry,
    // same shape as PhaseService. SPEC-038 §4, §6, §9.1.
    acService: new AcService(store, recordLockService, { citeGate: citeGateRaw }),
    // reason: RequirementService is store-only, same shape as AcService (SPEC-055).
    // 2nd arg wires the resolved workflow.requirement_quantifiable.enabled config
    // brake (SPEC-059 §Scope) — one resolution path (resolveRequirementQuantifiableEnabled
    // at createApp), mirroring claimTtlMinutes's identical "resolve once, thread down" shape.
    requirementService: new RequirementService(store, requirementQuantifiableEnabled, corpusService),
    // reason: RuleService gets the WIRED corpusService.create (gates + provenance guards apply to
    // node creation); its `createDoc` port is required — RuleService builds no CorpusService of its own.
    ruleService: new RuleService(store, corpusService.create.bind(corpusService), corpusService),
    // reason: the change set of a locked spec is gated by the ONE RecordLockService, like criteria edits.
    ruleChangeService,
    ruleReadService: new RuleReadService(store),
    impactService: new ImpactService(store),
    recordLockService,
    // reason: PrdOutlineService is store-only, same shape as AcService/
    // RequirementService (SPEC-080 C1, C4).
    prdOutlineService: new PrdOutlineService(store),
    // reason: PlanExemptionService is store-only, same shape as PrdOutlineService
    // (SPEC-069 D1 + SPEC-106 D4) — the sole writer of the plan-close exemption
    // fields, which were gate-read with no authoring surface before it existed.
    planExemptionService: new PlanExemptionService(store),
    // reason: UatService takes narrow injected ports (SPEC-054) — the guarded
    // createUatDoc seam, the shared resolveDoc helper, and store.addLink — never the
    // full CorpusService. `resolveTarget` is bound to `resolveDoc` (not
    // `corpusService.resolve`, which projects away `.type`) because
    // task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict's fix needs the
    // target's actual type to refuse a non-plan target before any doc/link is created.
    uatService: new UatService({
      createUatDoc: corpusService.createUatDoc.bind(corpusService),
      resolveTarget: (idOrSlug: string) => resolveDoc(store, idOrSlug),
      addLink: store.addLink.bind(store),
      now: () => new Date().toISOString(),
    }),
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
        processEnv: ambient.env,
        tmpDir: ambient.tmpDir,
        warn: warnSinkOf(ambient.io.stderr),
      },
      undefined,
      undefined,
      buildStateBindingOccupancyPort(store),
      worktreeRemovalService,
    ).setOverrideDecisionPort(overrideDecisionPort),
    // reason: ConfigService (SPEC-062 D1) — see buildAppFromSqlite's identical comment.
    configService: new ConfigService(repoRoot, store.appendAuditEntry.bind(store)),
    // reason: GlobalConfigService (SPEC-064 D1) — see buildAppFromSqlite's identical comment.
    globalConfigService: new GlobalConfigService(
      resolveGlobalConfigPath(ambient.env, ambient.home) ?? resolveGlobalConfigWritePath(ambient.env, ambient.home),
      store.appendAuditEntry.bind(store),
    ),
    // reason: task-skill-implement-wire-a-real-resolutionlabelport-so-the —
    // see buildAppFromSqlite's identical comment; GhRunner needs no
    // repoRoot/config, so this is constructed fresh inline here too.
    resolutionProjector: new ResolutionProjector(
      new GhResolutionLabelPort(new GhRunner({ execFile: createNodeGhExecFile(ambient.cwd), env: ambient.env })),
    ),
    // reason: TraceStatsService (SPEC-102) reads from `store` (the TursoStore
    // embedded replica, local reads) — same shape as buildAppFromSqlite's
    // identical field. Deliberately NOT `localTraceStore`: stats reads are
    // just as valid over the replica's local view, and this keeps ONE
    // TraceStatsService construction shape across both branches.
    traceStatsService: new TraceStatsService(store),
    // reason: SPEC-102 — exposes the SAME TraceRecorder instance wired into
    // CorpusService/gateEnforcer above, so commands/gate.ts can fire the
    // hook-layer deny trace directly (see this field's App JSDoc).
    ...(traceRecorder !== undefined ? { traceRecorder } : {}),
    // reason: SPEC-102 §Migration Strategy — fire-and-forget prune trigger,
    // bound in createApp (Turso mode: bound to localTraceStore); undefined
    // when trace.enabled resolves false.
    ...(pruneTrigger !== undefined ? { pruneTraceEventsOpportunistically: pruneTrigger } : {}),
    // reason: SPEC-063 §Design Decisions D1 — exposed so the CLI adapter can read
    // the corpus root as `resolveVerifyExecutionRoot`'s `corpusRoot` input, the
    // SAME value already threaded into VerifyRunnerService's config.repoRoot below.
    repoRoot,
    // reason: telemetry exposed on App so dashboard route handlers can emit source-tagged events
    // without requiring service-layer signature changes (SPEC-022 §9.6).
    telemetry,
    // SPEC-024: callerSurface getter/setter + resolveAiDefault — see
    // buildAppFromSqlite's identical `surfaceBox` comment.
    get callerSurface(): CallerSurface { return surfaceBox.current; },
    set callerSurface(s: CallerSurface) { surfaceBox.current = s; },
    resolveAiDefault(explicit: boolean | undefined) {
      return resolveAiDefault(explicit, surfaceBox.current, aiDefaultPerSurface);
    },
    // reason: closes the SEPARATE local trace-write handle (SPEC-102 D3)
    // alongside apiKeyDb/store — a leaked connection on the replica file
    // would keep a WAL lock held past this App's lifetime.
    // SPEC-102 hardening (T4 item 4) — see `buildAppFromSqlite`'s identical
    // `close` comment; waits out an in-flight prune batch (bound to
    // `localTraceStore`, the SAME separate local handle the batch reads/
    // writes through) before releasing every handle, instead of racing a
    // `DELETE` against an already-closed `localTraceStore`.
    close: () => {
      const releaseHandles = () => {
        telemetry.close();
        store.close();
        apiKeyDb.close();
        localTraceStore?.close();
      };
      if (pruneState?.inFlight !== undefined) {
        void pruneState.inFlight.finally(releaseHandles);
      } else {
        releaseHandles();
      }
    },
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
/**
 * Builds the post-archive issue step and hands it to every service that commits an archive
 * (spec-archiving-the-work-that-resolves-a-defect-report-closes D4). The closer exists only for a
 * GitHub-repo `feedback.upstream` — NOT the vendor-consent shape, which names the lore vendor's own
 * intake repository, an issue tracker this corpus must never close issues on.
 */
function wireIssueCloseOnArchive(app: App, store: StoreInterface, config: LoreConfig | undefined, ambient: AppAmbient): void {
  const upstream = resolveFeedbackUpstreamCfg(config);
  const repo = upstream !== undefined && isGithubUpstreamCfg(upstream) ? upstream.repo : undefined;
  const closer = repo === undefined ? undefined : new GhIssueCloser(new GhRunner({ execFile: createNodeGhExecFile(ambient.cwd), env: ambient.env }));
  const step = new IssueCloseOnArchive(store, closer, repo);
  app.corpusService.setArchiveIssueClosePort(step);
  app.taskWorkflowService.setArchiveIssueClosePort(step);
  app.issueClose = step;
}

export function createApp(dbPath: string, config: undefined, ambient: AppAmbient, writeContext?: AppWriteContext): App;
export function createApp(
  dbPath: string,
  config: LoreConfig | undefined,
  ambient: AppAmbient,
  writeContext?: AppWriteContext,
): App | Result<App, LoreError>;
export function createApp(
  dbPath: string,
  config: LoreConfig | undefined,
  ambient: AppAmbient,
  writeContext?: AppWriteContext,
): App | Result<App, LoreError> {
  const built = createAppUnscoped(dbPath, config, ambient, writeContext);
  const app = "corpusService" in built ? built : built.ok ? built.value : undefined;
  if (app === undefined) return built;
  // reason: spec-run-identity-slice-1 D3 — an MCP server is one long-lived App serving many callers, each call
  // carrying its own identity. The call-scoped App is built by the SAME composition path (same store selection,
  // same wrapping chokepoint) over the same corpus file, so no service can write outside the call's context.
  app.forWriteContext = (callContext) => {
    const scoped = createApp(dbPath, config, ambient, callContext);
    return "corpusService" in scoped ? ok(scoped) : scoped;
  };
  return built;
}

/**
 * Builds the App for ONE write context over a config that provably carries no `sync` section.
 *
 * reason: the CLI loader hands the invocation identity to the store chokepoint at construction
 * (spec-run-identity-slice-1 D3). `createApp`'s Turso branch falls back to a synchronous `createRequire`
 * that throws from the compiled binary (libsql-lazy-load AC-LL-10), so a `createApp` call site must stay
 * one- or two-argument with a sync-stripped config. This entry point carries the third argument under a
 * type that forbids `sync`: a sync-bearing config no longer type-checks, so the Turso branch is
 * unreachable by construction rather than by scan.
 *
 * @param config - Config with `sync` forbidden (`sync?: never`); `undefined` for a corpus without config.
 * @returns the App, or the Result error arm `createApp` keeps for an unknown `ai.provider`.
 */
export function createAppWithWriteContext(
  dbPath: string,
  config: (LoreConfig & { sync?: never }) | undefined,
  ambient: AppAmbient,
  writeContext: AppWriteContext,
): App | Result<App, LoreError> {
  return createApp(dbPath, config, ambient, writeContext);
}

function createAppUnscoped(
  dbPath: string,
  config: LoreConfig | undefined,
  ambient: AppAmbient,
  writeContext?: AppWriteContext,
): App | Result<App, LoreError> {
  // reason: spec-close-the-eight-verified-critical-defects F5 (AC-CRIT-7) — the composition root is the one
  // place scripts/tests calling createApp(findLoreDbPath()) directly pass through; a linked worktree must
  // never let `new SQLiteStore` migrate the MAIN checkout's behind corpus. Throws ForeignSchemaMigrationRefusedError.
  assertNoForeignSchemaMigration(dbPath, ambient.cwd);
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
  const registryResult = buildProviderRegistry(aiConfig, { env: ambient.env, tmpDir: ambient.tmpDir });
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

  // Requirement-layer quantifiability lint config brake (SPEC-059 §Scope) — defaults
  // to enabled (true) when config/workflow section absent.
  const requirementQuantifiableEnabled = resolveRequirementQuantifiableEnabled(config);

  // Citation gate config entry (spec-baseline-slice-2 §C4) — raw; validated per write by the chokepoint.
  const citeGateRaw = resolveCiteGateRaw(config);

  // Attestation-floor ratio (SPEC-069/SPEC-075) — the SAME resolved value
  // GateEnforcer.resolveAttestationMinRatio feeds attestationFloor, threaded here
  // so VerificationProjectionService's plan Evidence-panel and the plan-close gate
  // can never disagree on which floor a plan is measured against.
  const attestationMinRatio = resolveAttestationMinRatio(config);

  // Tiered-review config (SPEC-103 §Mechanisms M1/M2) — defaults to `true` /
  // the Zod schema defaults (resolveJudgmentRequiredTypes: ["spec","adr","plan"]) when the section is absent.
  const ledgerAutoApprove = resolveLedgerAutoApprove(config);
  const judgmentRequiredTypes = resolveJudgmentRequiredTypes(config);

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
  // bypass every checkpoint). Built per-branch below (not once here) because SPEC-080
  // G4's OPTIONAL `recordGateSkip` port needs the ACTUAL store instance
  // (`store.appendAuditEntry.bind(store)`) — SQLiteStore vs TursoStore is only known
  // after the branch below resolves, so `gateEnforcer` can't be constructed until
  // then. `GateEnforcer.enforce` re-derives per-checkpoint enablement from the
  // resolved `LoreConfig` on every call via `resolveGateEnabled`, the SAME config knob
  // `lore gate` already honors (`workflow.gates.<checkpoint>.enabled`). Enforcement is
  // ON by default — a corpus opts a specific checkpoint OUT via config, never the
  // reverse.

  // SPEC-102 — the mutable box a TraceRecorder's `getSurface` port (built
  // BELOW, before `buildAppFromSqlite`/`buildAppFromTurso` run) reads at fire
  // time. Shared with the built App's own `callerSurface` getter/setter (both
  // build functions accept it as `surfaceBox`) so an adapter setting
  // `app.callerSurface` AFTER `createApp` returns is observed by trace writes
  // too — see `buildAppFromSqlite`'s `surfaceBox` param JSDoc for the full
  // sequencing rationale (a TraceRecorder needs this box to exist before
  // either build function's own local surface state does).
  const surfaceBox: { current: CallerSurface } = { current: "cli" };

  // Trace recording/pruning config (SPEC-102 §Scope) — resolved once here,
  // read by BOTH store branches below.
  const traceEnabled = resolveTraceEnabled(config);
  const traceRetentionDays = resolveTraceRetentionDays(config);

  // No config supplied or sync section absent / disabled → local-only SQLiteStore
  if (
    config === undefined ||
    config.sync === undefined ||
    !config.sync.enabled
  ) {
    // reason: spec-run-identity-slice-1 D3 — the ONE place a CLI invocation's identity meets the store: every
    // service below receives the wrapped store, so no write path can skip the stamp. The Proxy forwards every
    // member (`getDatabase`, `close`, trace methods) to the same SQLiteStore, hence the structural cast.
    const baseSqliteStore = new SQLiteStore(dbPath);
    const sqliteStore =
      writeContext === undefined
        ? baseSqliteStore
        : (withVerifiedWriteContext(baseSqliteStore, writeContext.identity, writeContext.warn ?? warnSinkOf(ambient.io.stderr), writeContext.onVerified) as SQLiteStore);
    // reason: SPEC-102 — local-only mode has no separate replica file; trace
    // writes route through the SAME sqliteStore every other corpus write
    // uses. `undefined` when trace.enabled resolves false — every
    // TraceRecorder call site (CorpusService/GateEnforcer) already treats
    // this as "untraced", byte-identical to pre-SPEC-102 behavior.
    const traceRecorder = traceEnabled
      ? new TraceRecorder(sqliteStore.insertTraceEvent.bind(sqliteStore), () => surfaceBox.current, warnSinkOf(ambient.io.stderr))
      : undefined;
    // reason: SPEC-102 §Migration Strategy — fire-and-forget from the
    // CALLER's perspective (loader.ts never awaits `pruneTrigger()`, so a
    // startup prune never delays or fails the CLI command that triggered
    // it). SPEC-102 hardening (T4 item 4): the returned promise is now
    // tracked in `pruneState` (rather than discarded via `void`) so
    // `close()` below can wait for an IN-FLIGHT batch to settle before the
    // store handle it reads/writes through is actually released — without
    // this, a command whose own work finishes quickly could call
    // `app.close()` while a later batch of the bounded prune loop is still
    // pending, and that batch's next `DELETE` would race a closed handle
    // (swallowed by pruneTraceEventsOpportunistically's own never-throws
    // invariant, but silently leaving old rows unpruned until the NEXT
    // invocation — not a correctness bug, but "the prune ran to completion"
    // was never actually guaranteed).
    const pruneState: { inFlight?: Promise<void> } = {};
    const pruneTrigger = traceEnabled
      ? () => {
          pruneState.inFlight = pruneTraceEventsOpportunistically(
            sqliteStore.pruneTraceEvents.bind(sqliteStore),
            traceRetentionDays,
          );
        }
      : undefined;
    // reason: SPEC-080 G4 — `store.appendAuditEntry` already returns
    // `Promise<Result<void, LoreError>>`, exactly the `RecordGateSkip` shape
    // `GateEnforcer`'s constructor expects, so no adapter shim is needed. Every
    // bare `new GateEnforcer(config)` test construction elsewhere in this
    // codebase omits this 2nd arg and stays unwired (gate-enforcer.ts's own
    // SPEC-080 module invariant) — this is the ONLY production wiring site for
    // the local-store branch. 3rd arg wires SPEC-102's OPTIONAL TraceRecorder
    // — a BLOCKED enforce() fires a kind="gate_deny" trace row (layer="service").
    const gateEnforcer = new GateEnforcer(
      config,
      sqliteStore.appendAuditEntry.bind(sqliteStore),
      traceRecorder,
      () => resolveWriteActorFor(sqliteStore),
      ambient.env,
      warnSinkOf(ambient.io.stderr),
    );
    const sqliteApp = buildAppFromSqlite(
      sqliteStore,
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
      requirementQuantifiableEnabled,
      attestationMinRatio,
      traceRecorder,
      surfaceBox,
      pruneTrigger,
      ledgerAutoApprove,
      judgmentRequiredTypes,
      pruneState,
      citeGateRaw,
      ambient,
      // reason: D2 — a SQLite file is persistent, so verify runs in a worker over this same file (read-only).
      buildAuditVerifyRunner({ kind: "sqlite", dbPath }, { verifySince: auditVerifySince, anchorRoot: repoRoot }),
    );
    wireIssueCloseOnArchive(sqliteApp, sqliteStore, config, ambient);
    return sqliteApp;
  }

  // Sync is enabled — resolve credentials (fail loud on missing/empty token, D-007)
  const credResult = resolveSyncCredentials(config, ambient.env);
  if (!credResult.ok) {
    // Propagate error as Result — caller must handle (CLI exits 1, not silently falls back)
    telemetry.close();
    return credResult;
  }

  // reason: spec-eager-libsql-load-makes-every-command-depend-on-a-healthy
  // AC-LL-4's pinned ordering — credential validation FIRST (above), TMPDIR
  // usability probe SECOND, native load (TursoStore construction, below)
  // only after both. `probeTmpdirUsability` never rewrites TMPDIR itself (no
  // silent fallback) — an unusable value is reported, never repaired. This
  // branch is currently unreachable from any CLI command (`loader.ts` strips
  // `config.sync` unconditionally before calling `createApp` — see that
  // file's own comment), but keeping the composition root itself compliant
  // with the invariant matters for any future direct caller (this is also
  // where `AC-LL-5`/`AC-LL-7(c)`'s in-process tests exercise `createApp`
  // directly, bypassing `loader.ts`).
  const tmpdirError = probeTmpdirUsability(ambient.env);
  if (tmpdirError !== null) {
    telemetry.close();
    return err(tmpdirError);
  }

  // Credentials valid — construct TursoStore (embedded replica, SPEC-009 §3, D-007).
  // TursoStore uses local file as embedded replica: normal reads stay local (microsecond),
  // writes forward to remote Turso, auto-sync gives multi-machine visibility.
  // If construction fails (network unreachable, auth error, etc.) we fail loud with
  // STORE_ERROR — there is NO silent fallback to SQLiteStore. Offline writes must not
  // silently land only-local (D-005 EC item 5).
  const { url: remoteUrl, token: authToken } = credResult.value;
  try {
    const baseTursoStore = new TursoStore({
      localPath: dbPath,
      remoteUrl,
      authToken,
      syncInterval: config.sync.interval,
    });
    // reason: same chokepoint as the SQLite branch (spec-run-identity-slice-1 D3); structural cast over a Proxy.
    const store =
      writeContext === undefined
        ? baseTursoStore
        : (withVerifiedWriteContext(baseTursoStore, writeContext.identity, writeContext.warn ?? warnSinkOf(ambient.io.stderr), writeContext.onVerified) as TursoStore);
    // reason: SPEC-102 D3 — trace writes in Turso mode go through a SEPARATE
    // local `bun:sqlite` handle on the SAME replica file `apiKeyDb`/
    // `sessionStore` already open (`buildAppFromTurso`'s identical
    // precedent), NEVER through `store` (the libsql/remote-syncing client) —
    // this is what keeps trace_events local-only even though it physically
    // lives in the same file the embedded replica syncs. `new SQLiteStore`
    // (not a bare `Database`) is used deliberately here — it already
    // implements the full trace insert/query/prune surface (this file's own
    // migration chain has already run against this SAME file via `store`'s
    // `initSchema`, so re-running it here is a no-op idempotent PRAGMA
    // user_version check, not a duplicate migration). `undefined` when
    // trace.enabled resolves false — nothing is opened, nothing to close.
    const localTraceStore = traceEnabled ? new SQLiteStore(dbPath) : undefined;
    const traceRecorder =
      localTraceStore !== undefined
        ? new TraceRecorder(localTraceStore.insertTraceEvent.bind(localTraceStore), () => surfaceBox.current, warnSinkOf(ambient.io.stderr))
        : undefined;
    // reason: SPEC-102 §Migration Strategy — same fire-and-forget-from-the-
    // CALLER's-perspective shape as the SQLite branch, bound to the SEPARATE
    // localTraceStore handle (never `store`). SPEC-102 hardening (T4 item
    // 4): tracks the in-flight promise in `pruneState` (see the SQLite
    // branch's identical comment) instead of discarding it via `void`.
    const pruneState: { inFlight?: Promise<void> } = {};
    const pruneTrigger =
      localTraceStore !== undefined
        ? () => {
            pruneState.inFlight = pruneTraceEventsOpportunistically(
              localTraceStore.pruneTraceEvents.bind(localTraceStore),
              traceRetentionDays,
            );
          }
        : undefined;
    // reason: SPEC-080 G4 — same wiring as the SQLite branch above, bound to the
    // TursoStore instance (also implements `StoreInterface.appendAuditEntry`).
    // 3rd arg wires SPEC-102's OPTIONAL TraceRecorder — see the SQLite branch's
    // identical comment.
    const gateEnforcer = new GateEnforcer(config, store.appendAuditEntry.bind(store), traceRecorder, () => resolveWriteActorFor(store), ambient.env, warnSinkOf(ambient.io.stderr));
    const tursoApp = buildAppFromTurso(
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
        requirementQuantifiableEnabled,
        attestationMinRatio,
        traceRecorder,
        surfaceBox,
        localTraceStore,
        pruneTrigger,
        ledgerAutoApprove,
        judgmentRequiredTypes,
        pruneState,
        citeGateRaw,
        ambient,
        // reason: D2 — a Turso store is persistent, so verify runs in a worker over its local replica file,
        // opened without the remote URL (no second thread syncing the embedded replica).
        buildAuditVerifyRunner({ kind: "turso", localPath: dbPath }, { verifySince: auditVerifySince, anchorRoot: repoRoot }),
      );
    wireIssueCloseOnArchive(tursoApp, store, config, ambient);
    return { ok: true, value: tursoApp };
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

/**
 * Builds `lore run reap`'s service (AC-AU-5): the run registry and decision log through `store`, run endings through a
 * claim-wired `RunService` (an ended run releases its claims), the OS through the real process-table port.
 * reason: `executorRun: null` — the reap sweep is machine-channel and names no executing run until AU-T3 threads the
 * verified invocation identity into decision rows; do not invent one here.
 */
function buildRunReapService(
  store: ConstructorParameters<typeof DecisionService>[0]["store"],
  taskWorkflowService: TaskWorkflowService,
  ambient: AppAmbient,
  repoRoot: string,
): RunReapService {
  return new RunReapService({
    store,
    runs: new RunService(store, undefined, taskWorkflowService, realpathNative, repoRoot, createRealWorktreeProbe(ambient.cwd)),
    decisions: new DecisionService({ store, executorRun: null }),
    processes: createRealProcessTablePort({ env: ambient.env, cwd: ambient.cwd }),
  });
}

/**
 * Builds the decide() port the self-grantable overrides ask (AC-AU-7) over `store`'s decision log.
 * reason: `executorRun: null` — same as the other in-process services here; the override rows are machine-channel.
 */
function buildOverrideDecisionPort(store: ConstructorParameters<typeof DecisionService>[0]["store"]): OverrideDecisionPort {
  return createOverrideDecisionPort(new DecisionService({ store, executorRun: null }));
}

/**
 * Builds the worktree-removal service over `store`. Run occupancy comes from a CLAIM-PORT-LESS `RunService` (occupancy
 * reads only the store + realpath), which also avoids the TaskWorkflowService <-> RunService construction cycle.
 */
function buildWorktreeRemovalService(
  store: ConstructorParameters<typeof RunService>[0] & WorktreeRemovalRunStore & StoreInterface,
  ambient: AppAmbient,
  repoRoot: string,
): WorktreeRemovalService {
  return new WorktreeRemovalService({
    // reason: AC-AU-11 — every worktree removal asks decide(worktree-remove) through the decision log; `executorRun: null`
    // because an in-process service has no attested run id of its own (AU-T9 stamps the executor on the CLI path).
    decisions: new DecisionService({ store, executorRun: null }),
    probe: createRealWorktreeProbe(ambient.cwd),
    processScan: createRealProcessScanPort({ cwd: ambient.cwd }),
    occupancy: new RunService(store, undefined, undefined, realpathNative, repoRoot, createRealWorktreeProbe(ambient.cwd)),
    runs: store,
  });
}
