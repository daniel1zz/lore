/**
 * Phase execution model DI wiring (SPEC-056 task-skill-implement-cli-mcp-surfaces-
 * checklist-ref-evidence, "CLI + MCP surfaces + checklist_ref evidence").
 *
 * Kept OUT of `app.ts`'s own composition bodies to minimize the contended `app.ts`
 * diff surface — `task-skill-implement-assets-resync-app-ts-wiring` (T12) is
 * dispatched CONCURRENTLY against the SAME file. `app.ts` imports `buildPhaseServices`
 * with a single call per composition function (`buildAppFromSqlite`/
 * `buildAppFromTurso`) and spreads its result into the returned `App` literal —
 * every OTHER piece of phase-service DI construction (the services themselves, the
 * `PhaseStatusFlowDeps`/`PhaseFeedFlowDeps` binders CLI commands and MCP tools both
 * consume) lives here instead of inline in `app.ts`.
 *
 * `App.phaseWorkflowService`/`App.phaseChecklistService` are OPTIONAL (same
 * "pre-existing hand-built App test stubs stay valid" reason `acService`/
 * `driftCheckService`/etc. document in `app.ts`) — `requirePhaseWorkflowService`/
 * `requirePhaseChecklistService` are the guard functions every CLI command / MCP tool
 * handler calls before use, mirroring `commands/ac.ts`'s `requireAcService` precedent.
 * `loadLoreApp()`'s only production App source (`createApp`) always wires both, so
 * these guards never actually throw in the CLI/MCP binaries.
 *
 * Side-effect class: none (pure construction — no IO of its own; the constructed
 *   services themselves are IO, same as every other `app.ts`-composed service). ONE
 *   ambient read: `process.env` is passed to `PhaseWorkflowService`'s `processEnv`
 *   injection point, the composition-time env snapshot `app.ts` performs identically
 *   for `TaskWorkflowService` (see that argument's own `reason` comment below).
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Module Boundary; task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence
 */

import { ok, err, computeAcCoverage, computePhaseCompletion, phaseExtraSchema, isInvalidated } from "@lore/core";
import type { Telemetry, DocRecord, AcceptanceCriterion } from "@lore/core";
import { PhaseWorkflowService } from "../../service/phase-workflow-service.js";
import { PhaseChecklistService } from "../../service/phase-checklist-service.js";
import { PhaseMigrationService } from "../../service/phase-migration-service.js";
import type { StoreInterface } from "../../store/store-interface.js";
import type { CorpusService } from "../../service/corpus-service.js";
import type { GateEnforcer } from "../../service/gate-enforcer.js";
// reason: `import type` is erased at compile time — no runtime circular import is
// ever emitted, even though app.ts (the module that imports THIS file) is also the
// module declaring `App`. Same sanctioned pattern as `flows/staleness-flow.ts`'s
// `buildStalenessFlowDeps(app: App)` binder (adapters/cli/CLAUDE.md documents the
// precedent — proven vitest-safe via the pre-existing `flows/validity-state.ts`).
import type { App } from "../../app.js";
import {
  buildPhaseStatusPayload,
  extractSpecCriteria,
  type PhaseStatusFlowDeps,
  type PhaseStatusPayload,
} from "../../flows/phase-status-flow.js";
import type {
  PhaseFeedFlowDeps,
  PhaseBundle,
  PhaseSiblingSummary,
  KnowledgePointer,
  HandoffPointer,
} from "../../flows/phase-feed-flow.js";
import type { Result, LoreError } from "@lore/core";

/** The three phase-execution-model services constructed for `App` (SPEC-056 D2). */
export interface PhaseServiceBundle {
  phaseWorkflowService: PhaseWorkflowService;
  phaseChecklistService: PhaseChecklistService;
  phaseMigrationService: PhaseMigrationService;
}

/**
 * Constructs `PhaseWorkflowService`/`PhaseChecklistService`/`PhaseMigrationService`
 * for the composition root. Mirrors the SAME DI shape `app.ts` already uses for
 * `TaskWorkflowService` (own telemetry wiring, `resolveDeclaredAcIds` bound to
 * `corpusService`, `GateDependencies` bundle sharing the SAME `getPlanBundle` port)
 * — this function exists purely to keep that construction OUT of `app.ts`'s own body
 * (see module header). `PhaseMigrationService` needs only `store` — no telemetry, no
 * gate (see its own module header for why).
 *
 * @param store - Storage abstraction (same instance passed to CorpusService)
 * @param telemetry - Telemetry sink (own wiring, mirrors TaskWorkflowService's D8)
 * @param claimTtlMinutes - Task/phase claim lease TTL in minutes (SPEC-025 §3 D2; same
 *   resolved value every other claim-aware service in `app.ts` uses)
 * @param gateEnforcer - Service-layer gate enforcement (retro follow-up item 8) —
 *   `PhaseWorkflowService.claim` runs the ADDITIVE `phase-claim` checkpoint through it
 * @param corpusService - Already-constructed `CorpusService` — `resolveDeclaredAcIds`
 *   and `getPlanBundle` are bound FROM it (never imported/re-derived)
 * @param env - the invocation's environment (`AppAmbient.env`): the session-id source for phase claims (AS-26)
 */
export function buildPhaseServices(
  store: StoreInterface,
  telemetry: Telemetry,
  claimTtlMinutes: number,
  gateEnforcer: GateEnforcer,
  corpusService: CorpusService,
  env: Readonly<Record<string, string | undefined>>,
): PhaseServiceBundle {
  const phaseWorkflowService = new PhaseWorkflowService(
    store,
    telemetry,
    { claimTtlMinutes },
    corpusService.resolveDeclaredAcIds.bind(corpusService),
    { enforcer: gateEnforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
    // reason: task-phaseworkflowservice-claim-captures-no-session-id-so-every —
    // `PhaseWorkflowService` defaults `processEnv` to `{}` so unit constructions stay
    // machine-independent, which puts the ENTIRE production capture on this ONE
    // argument (the exact shape `app.ts` uses for `TaskWorkflowService`). Read HERE
    // rather than threaded from `app.ts` because THIS function is the composition
    // site for every phase service — adding a parameter would only move the same
    // ambient read into `app.ts`'s two call sites, widening a deliberately narrow
    // diff surface (module header) for no gain in testability: the service itself
    // takes the env by injection, which is where the seam belongs. Dropping this
    // argument would fail SILENT (claims would simply record no `session_id` and the
    // anchor mutex would degrade to the retired same-actor proxy) while every unit
    // test stayed green — hence its own distribution oracle,
    // `tests/integration/phase-claim-session-parity.bun.test.ts`.
    env,
  );
  const phaseChecklistService = new PhaseChecklistService(store);
  const phaseMigrationService = new PhaseMigrationService(store, corpusService);
  return { phaseWorkflowService, phaseChecklistService, phaseMigrationService };
}

/** Guard function for `App.phaseMigrationService`'s optional typing — see `requirePhaseWorkflowService`'s JSDoc. */
export function requirePhaseMigrationService(app: App): PhaseMigrationService {
  if (app.phaseMigrationService === undefined) {
    throw new Error("Internal error: PhaseMigrationService not wired on App");
  }
  return app.phaseMigrationService;
}

/**
 * Guard function for `App.phaseWorkflowService`'s optional typing — see module
 * header. Every CLI command / MCP tool handler that needs the service calls this
 * FIRST rather than accessing the optional field directly.
 */
export function requirePhaseWorkflowService(app: App): PhaseWorkflowService {
  if (app.phaseWorkflowService === undefined) {
    throw new Error("Internal error: PhaseWorkflowService not wired on App");
  }
  return app.phaseWorkflowService;
}

/** Guard function for `App.phaseChecklistService`'s optional typing — see `requirePhaseWorkflowService`'s JSDoc. */
export function requirePhaseChecklistService(app: App): PhaseChecklistService {
  if (app.phaseChecklistService === undefined) {
    throw new Error("Internal error: PhaseChecklistService not wired on App");
  }
  return app.phaseChecklistService;
}

/**
 * Builds `PhaseStatusFlowDeps` from a wired `App` — the SAME construction the CLI
 * `lore phase status` command and MCP `lore_phase_status` tool both call, so their
 * `--json`/tool-response payloads are deep-equal BY CONSTRUCTION (never two
 * independently-authored bindings — mirrors `flows/staleness-flow.ts`'s
 * `buildStalenessFlowDeps` precedent).
 */
export function buildPhaseStatusDeps(app: App): PhaseStatusFlowDeps {
  const phaseWorkflowService = requirePhaseWorkflowService(app);
  return {
    getPhase: async (idOrSlug) => {
      const result = await app.corpusService.get(idOrSlug);
      if (!result.ok) return result;
      return ok(result.value.doc);
    },
    getPlanBundle: app.corpusService.getPlanBundle.bind(app.corpusService),
    claimTtlMinutes: phaseWorkflowService.claimTtlMinutes,
  };
}

/**
 * Thin convenience wrapper: builds `PhaseStatusFlowDeps` from `app` and calls
 * `buildPhaseStatusPayload` — the ONE call CLI `commands/phase.ts`'s `status`
 * subcommand and MCP `tools.ts`'s `lore_phase_status` handler each make.
 */
export async function getPhaseStatus(
  app: App,
  phaseIdOrSlug: string,
  nowIso: string,
): Promise<Result<PhaseStatusPayload, LoreError>> {
  return buildPhaseStatusPayload(buildPhaseStatusDeps(app), phaseIdOrSlug, nowIso);
}

// ─── PhaseFeedFlowDeps real binding (lore feed phase-start) ────────────────

/**
 * Computes one sibling phase's `PhaseCompletionState` — reuses the exact same
 * `computeAcCoverage`/`computePhaseCompletion` pipeline `phase-status-flow.ts` uses,
 * scoped to `sibling`'s OWN evidence only (never a cross-phase aggregate). A
 * malformed `claimTtlMinutes`/`acScope` (which `computePhaseCompletion` would reject)
 * degrades to `"pending"` — this is presentation-only context in a feed pack, not a
 * gate; a real validation failure has nowhere useful to surface here.
 */
function computeSiblingState(
  sibling: DocRecord,
  criteria: AcceptanceCriterion[],
  claimTtlMinutes: number,
  nowIso: string,
): string {
  const extraParsed = phaseExtraSchema.safeParse(sibling.extra);
  const acScope = extraParsed.success ? (extraParsed.data.ac_scope ?? []) : [];
  const checklist = extraParsed.success ? (extraParsed.data.checklist ?? []) : [];
  const claim = extraParsed.success ? extraParsed.data.claim : undefined;
  const coverage = computeAcCoverage(criteria, [sibling]);
  const completionResult = computePhaseCompletion({
    acScope,
    coverage,
    checklist,
    claim,
    claimTtlMinutes,
    now: new Date(nowIso),
  });
  return completionResult.ok ? completionResult.value.state : "pending";
}

/**
 * `PhaseFeedFlowDeps.getPhaseBundle` real binding — resolves `phaseIdOrSlug`, walks
 * its parent plan via `corpusService.getPlanBundle` (the SAME port
 * `PhaseWorkflowService`'s claim gate uses — `bundle.tasks` already includes sibling
 * `phase` docs, SPEC-056 T4/T5's D2 read-tolerance extension), and assembles the
 * `PhaseBundle` shape `buildPhaseStartPack` (`flows/phase-feed-flow.ts`) consumes.
 */
async function buildPhaseBundle(app: App, phaseIdOrSlug: string): Promise<Result<PhaseBundle, LoreError>> {
  const phaseResult = await app.corpusService.get(phaseIdOrSlug);
  if (!phaseResult.ok) return phaseResult;
  const phase = phaseResult.value.doc;

  if (phase.type !== "phase") {
    return err({
      code: "VALIDATION_ERROR",
      field: "type",
      message: `Expected a phase document; got type '${phase.type}'`,
      value: phase.type,
    });
  }
  if (phase.parent_id === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "parent_id",
      message: `Phase '${phase.slug}' has no parent plan`,
      value: phase.id,
    });
  }

  const bundleResult = await app.corpusService.getPlanBundle(phase.parent_id);
  if (!bundleResult.ok) return bundleResult;
  const bundle = bundleResult.value;

  const criteria = bundle.spec !== undefined ? extractSpecCriteria(bundle.spec) : [];
  const claimTtlMinutes = requirePhaseWorkflowService(app).claimTtlMinutes;
  const nowIso = new Date().toISOString();

  const siblings: PhaseSiblingSummary[] = bundle.tasks
    .filter((doc) => doc.type === "phase" && doc.id !== phase.id)
    .map((doc) => ({
      slug: doc.slug,
      title: doc.title,
      state: computeSiblingState(doc, criteria, claimTtlMinutes, nowIso),
    }));

  return ok({
    phase,
    plan: bundle.plan,
    specSlice: bundle.spec !== undefined ? `${bundle.spec.title}\n\n${bundle.spec.content}` : null,
    siblings,
  });
}

/**
 * `PhaseFeedFlowDeps.listLinkedKnowledgePointers` real binding — reuses
 * `corpusService.get()`'s already-computed `navigation.related` (every non-parent
 * link, both directions — the SAME array `lore_context_bundle` filters for
 * `linked_specs`/`related_adrs`), filtered to `type === "knowledge"`. Invalidation
 * state (SPEC-043) isn't carried on the lightweight `DocSummary` navigation entries,
 * so each candidate is re-fetched (bounded by `limit`) to check `isInvalidated` —
 * this module's OWN defense-in-depth filtering happens in `phase-feed-flow.ts`'s
 * `renderKnowledgeSection`, this binding's job is only to report the fact correctly.
 */
async function listLinkedKnowledgePointers(
  app: App,
  docId: string,
  limit: number,
): Promise<Result<KnowledgePointer[], LoreError>> {
  const result = await app.corpusService.get(docId);
  if (!result.ok) return result;

  const nowIso = new Date().toISOString();
  const knowledgeRelated = result.value.navigation.related
    .filter((r) => r.type === "knowledge")
    .slice(0, limit);

  const pointers: KnowledgePointer[] = [];
  for (const summary of knowledgeRelated) {
    const docResult = await app.corpusService.get(summary.id);
    const invalidated = docResult.ok ? isInvalidated(docResult.value.doc, nowIso) : false;
    pointers.push({ doc_id: summary.id, slug: summary.slug, title: summary.title, invalidated });
  }
  return ok(pointers);
}

/**
 * `PhaseFeedFlowDeps.latestHandoffForPlan` real binding — reuses
 * `SessionService.resume({plan: planId})` (the SAME newest-wins/multi-actor
 * derivation `lore feed session-resume` uses) rather than re-deriving handoff
 * selection here; the newest record (across ALL actors when `multi_actor`) is
 * re-fetched once for its `title` (`ResumeHandoffRecord` carries `handoff_slug` only).
 */
async function latestHandoffForPlan(app: App, planId: string): Promise<Result<HandoffPointer | null, LoreError>> {
  if (app.sessionService === undefined) {
    return err({ code: "STORE_ERROR", message: "Internal error: SessionService not wired on App" });
  }
  const resumeResult = await app.sessionService.resume({ plan: planId });
  if (!resumeResult.ok) return resumeResult;
  const resume = resumeResult.value;
  if (!resume.found) return ok(null);

  const record = resume.multi_actor ? resume.handoffs?.[0] : resume.handoff;
  if (record === undefined) return ok(null);

  const docResult = await app.corpusService.get(record.handoff_slug);
  const title = docResult.ok ? docResult.value.doc.title : record.handoff_slug;
  return ok({ slug: record.handoff_slug, title });
}

/**
 * Builds `PhaseFeedFlowDeps` from a wired `App` — the SAME construction the CLI
 * `lore feed phase-start` dispatch and (a future) MCP `lore_feed` phase-start branch
 * both call, mirroring `buildPhaseStatusDeps`'s deep-equal-by-construction rationale.
 */
export function buildPhaseFeedFlowDeps(app: App): PhaseFeedFlowDeps {
  return {
    getPhaseBundle: (phaseId) => buildPhaseBundle(app, phaseId),
    listLinkedKnowledgePointers: (docId, limit) => listLinkedKnowledgePointers(app, docId, limit),
    latestHandoffForPlan: (planId) => latestHandoffForPlan(app, planId),
  };
}
