/**
 * Phase-start feed pack assembly (SPEC-056 §Design Decisions D5, §Module Boundary:
 * "flows/phase-feed-flow.ts (buildPhaseStartPack over an explicit
 * PhaseFeedFlowDeps)"). Assembles the advisory "phase-start" pack an agent PULLs
 * before beginning work on a plan phase — scope (phase + plan + spec slice),
 * sibling-phase state, linked-knowledge pointers, and the latest handoff for the
 * plan — from a NARROW injected dependency bundle (`PhaseFeedFlowDeps`), mirroring
 * `staleness-flow.ts`'s `StalenessFlowDeps` precedent (never the full `App` — keeps
 * this module testable with plain fakes, no real store, no `bun:sqlite` pull-in).
 *
 * Contract (resolved from the SPEC-056 D5 sketch by
 * `tests/unit/flows/phase-feed-flow.test.ts`'s CONTRACT NOTE — that test file is the
 * authoritative shape this module satisfies):
 *   - `deps.getPhaseBundle(phaseId)` failing is FATAL — propagated verbatim. Phase
 *     selection among a plan's phases (if any) is a caller/adapter concern, not
 *     this pure flow function's job.
 *   - `deps.listLinkedKnowledgePointers` / `deps.latestHandoffForPlan` failing is
 *     NON-fatal — mirrors `feed-flow.ts::buildFeed`'s "auxiliary lookups degrade to
 *     an advisory note" ethos. The affected section degrades to a one-line note;
 *     the rest of the pack still builds.
 *   - The knowledge-pointer section applies the SPEC-043 D3 "filtered by default"
 *     hygiene exclusion itself (defense-in-depth on top of whatever the port
 *     implementation does) — an `invalidated: true` pointer is never rendered.
 *   - Each of the four sections is clipped to its own char budget
 *     (`PhaseStartBudgets`, defaults in `DEFAULT_PHASE_START_BUDGETS`) via
 *     `truncateSection` (the same `assessment.ts` primitive `ai.assess.*` budgets
 *     use); a clipped section's key is recorded in `truncated[]` — never silent.
 *     `budgets` accepts a `Partial<PhaseStartBudgets>` override (merged over the
 *     defaults) so this stays config-schema-agnostic — resolving `workflow.phase_feed.*`
 *     into a full `PhaseStartBudgets` is the CLI adapter's job, mirroring
 *     `ai.assess.*`/`truncateSection`'s "budget resolution vs. budget application"
 *     split.
 *   - `buildPhaseStartPack` is deterministic for identical deps+args — the
 *     deep-equal foundation for AC-P-4.
 *
 * `CHECKPOINT_PRODUCED_TYPE["phase-start"]` is registered in `feed-flow.ts`'s SSOT
 * map (this module's sibling export), NOT a parallel dispatch path — `lore feed
 * phase-start` / `lore_feed {checkpoint: "phase-start"}` route through the SAME
 * `buildFeed` composition every other checkpoint does; `buildPhaseStartPack` itself
 * is the phase-specific assembly a future `buildFeed` `phase-start` branch (or a
 * dedicated adapter dispatch, mirroring `session-resume`'s D5 special-case) will
 * call — wiring that dispatch is a separate task, out of this module's scope.
 *
 * `KnowledgePointer`/`HandoffPointer` (SPEC-070 §Design Decisions D6) now live in
 * `feed-shared-types.ts` — the shared pointer vocabulary `task-feed-flow.ts` also
 * consumes. Re-exported here verbatim so existing importers of THIS module (e.g.
 * `adapters/cli/phase-wiring.ts`) keep compiling unchanged (import-compat).
 *
 * Side-effect class: none (pure over the injected `PhaseFeedFlowDeps` — no direct IO)
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Module Boundary, §Design Decisions D5; §Acceptance Criteria AC-P-4; SPEC-070 D6
 */

import { ok, truncateSection } from "@lore/core";
import type { DocRecord, LoreError, Result } from "@lore/core";
import type { KnowledgePointer, HandoffPointer } from "./feed-shared-types.js";

/** Re-exported for import-compat — see `feed-shared-types.ts` for the authoritative shapes. */
export type { KnowledgePointer, HandoffPointer } from "./feed-shared-types.js";

/** One other phase under the same plan, pre-summarized by the caller (never re-derived here). */
export interface PhaseSiblingSummary {
  readonly slug: string;
  readonly title: string;
  /** Pre-computed `PhaseCompletionState` string (caller's job via `computePhaseCompletion`). */
  readonly state: string;
}

/**
 * The raw materials `buildPhaseStartPack` renders into a pack — assembled by
 * `deps.getPhaseBundle`, never re-derived by this module.
 */
export interface PhaseBundle {
  readonly phase: DocRecord;
  readonly plan: DocRecord;
  /** `null` (not absent) when the plan has no spec ancestor — "nothing to aggregate", not "empty". */
  readonly specSlice: string | null;
  readonly siblings: PhaseSiblingSummary[];
}

/**
 * Narrow injected dependency bundle — mirrors `staleness-flow.ts`'s `StalenessFlowDeps`
 * (never the full `App`; see module header).
 */
export interface PhaseFeedFlowDeps {
  /** Resolves `phaseId` into its full bundle (phase + plan + spec slice + sibling summaries). */
  getPhaseBundle: (phaseId: string) => Promise<Result<PhaseBundle, LoreError>>;
  /** Hygiene-filtered (D3-style) linked-knowledge lookup — this module also filters defensively. */
  listLinkedKnowledgePointers: (
    docId: string,
    limit: number,
  ) => Promise<Result<KnowledgePointer[], LoreError>>;
  /** The most recent `handoff` knowledge doc linked to `planId`, or `null` when none exists. */
  latestHandoffForPlan: (planId: string) => Promise<Result<HandoffPointer | null, LoreError>>;
}

/** Per-section character budgets, mirroring `ai.assess.*`'s config-budget shape. */
export interface PhaseStartBudgets {
  readonly max_scope_chars: number;
  readonly max_siblings_chars: number;
  readonly max_knowledge_chars: number;
  readonly max_handoff_chars: number;
}

/**
 * `workflow.phase_feed.*` config defaults — sized generously so ordinary
 * phase/plan/spec-slice content never truncates; only pathological oversized
 * material (a very long spec slice, hundreds of linked knowledge pointers) hits
 * these caps.
 */
export const DEFAULT_PHASE_START_BUDGETS: PhaseStartBudgets = {
  max_scope_chars: 6000,
  max_siblings_chars: 2000,
  max_knowledge_chars: 2000,
  max_handoff_chars: 1000,
};

/** Cap on how many linked-knowledge pointers are requested per pack assembly. */
const KNOWLEDGE_POINTER_LIMIT = 20;

/**
 * The `"phase-start"` checkpoint literal — mirrors `feed-flow.ts`'s
 * `SESSION_RESUME_CHECKPOINT` export shape so `commands/feed.ts` and (a future)
 * `tools.ts` `lore_feed` handler compare against ONE exported constant rather than
 * a second hand-typed string literal (task-skill-implement-cli-mcp-surfaces-
 * checklist-ref-evidence). This is a DIFFERENT dispatch shape from
 * `SESSION_RESUME_CHECKPOINT`'s (which is consulted BEFORE the
 * `CHECKPOINT_PRODUCED_TYPE` lookup) — `"phase-start"` IS a `CHECKPOINT_PRODUCED_TYPE`
 * entry (`feed-flow.ts`), so `commands/feed.ts` special-cases it to call
 * `buildPhaseStartPack` directly instead of the generic `buildFeed` composition
 * (which has no notion of a phase-scoped bundle).
 */
export const PHASE_START_CHECKPOINT = "phase-start";

/** The assembled phase-start pack — the shape CLI `lore feed phase-start` renders/returns. */
export interface PhaseStartPack {
  readonly phase_id: string;
  readonly sections: {
    readonly scope: string;
    readonly siblings: string;
    readonly knowledge_pointers: string;
    readonly handoff: string;
  };
  /** Exactly the section keys clipped to fit their budget — mirrors `assess`'s `judgment.truncated[]`. */
  readonly truncated: string[];
}

/** Renders a `LoreError` into a short human-readable note (mirrors `feed-flow.ts::buildFeed`'s degrade notes). */
function describeError(error: LoreError): string {
  const message = "message" in error && typeof error.message === "string" ? error.message : error.code;
  return `${error.code}: ${message}`;
}

function renderScopeSection(bundle: PhaseBundle): string {
  const lines: string[] = [`Phase: ${bundle.phase.title}`, `Plan: ${bundle.plan.title}`, ""];
  lines.push(bundle.specSlice !== null ? bundle.specSlice : "(no spec ancestor)");
  return lines.join("\n");
}

function renderSiblingsSection(siblings: PhaseSiblingSummary[]): string {
  if (siblings.length === 0) return "(no other phases)";
  return siblings.map((s) => `- ${s.title} (${s.state}) — ${s.slug}`).join("\n");
}

function renderKnowledgeSection(result: Result<KnowledgePointer[], LoreError>): string {
  if (!result.ok) {
    return `(knowledge pointers unavailable: ${describeError(result.error)})`;
  }
  const visible = result.value.filter((p) => !p.invalidated);
  if (visible.length === 0) return "(no linked knowledge)";
  return visible.map((p) => `- ${p.slug}: ${p.title}`).join("\n");
}

function renderHandoffSection(result: Result<HandoffPointer | null, LoreError>): string {
  if (!result.ok) {
    return `(handoff unavailable: ${describeError(result.error)})`;
  }
  if (result.value === null) return "(no handoff recorded)";
  return `Handoff: ${result.value.slug} — ${result.value.title}`;
}

/**
 * Assembles the phase-start advisory pack for `phaseId`. See module header for the
 * full fatal/non-fatal failure contract and truncation semantics.
 *
 * @param deps - Narrow injected port bundle.
 * @param phaseId - The target phase's id or slug (forwarded to `deps.getPhaseBundle` untouched).
 * @param budgets - Optional partial override merged over `DEFAULT_PHASE_START_BUDGETS`.
 * @returns `ok(PhaseStartPack)`, or `err(LoreError)` propagated verbatim from a fatal `getPhaseBundle` failure.
 * @example
 * const result = await buildPhaseStartPack(deps, "phase-backend-slice");
 * const scopeText = result.ok ? result.value.sections.scope : null;
 */
export async function buildPhaseStartPack(
  deps: PhaseFeedFlowDeps,
  phaseId: string,
  budgets?: Partial<PhaseStartBudgets>,
): Promise<Result<PhaseStartPack, LoreError>> {
  const bundleResult = await deps.getPhaseBundle(phaseId);
  if (!bundleResult.ok) return bundleResult;
  const bundle = bundleResult.value;

  const resolvedBudgets: PhaseStartBudgets = { ...DEFAULT_PHASE_START_BUDGETS, ...budgets };

  const [knowledgeResult, handoffResult] = await Promise.all([
    deps.listLinkedKnowledgePointers(bundle.phase.id, KNOWLEDGE_POINTER_LIMIT),
    deps.latestHandoffForPlan(bundle.plan.id),
  ]);

  const rawSections = {
    scope: renderScopeSection(bundle),
    siblings: renderSiblingsSection(bundle.siblings),
    knowledge_pointers: renderKnowledgeSection(knowledgeResult),
    handoff: renderHandoffSection(handoffResult),
  };

  const truncated: string[] = [];
  const clip = (key: keyof PhaseStartPack["sections"], text: string, maxChars: number): string => {
    const clipped = truncateSection(text, maxChars);
    if (clipped.truncated) truncated.push(key);
    return clipped.text;
  };

  const sections = {
    scope: clip("scope", rawSections.scope, resolvedBudgets.max_scope_chars),
    siblings: clip("siblings", rawSections.siblings, resolvedBudgets.max_siblings_chars),
    knowledge_pointers: clip(
      "knowledge_pointers",
      rawSections.knowledge_pointers,
      resolvedBudgets.max_knowledge_chars,
    ),
    handoff: clip("handoff", rawSections.handoff, resolvedBudgets.max_handoff_chars),
  };

  return ok({ phase_id: phaseId, sections, truncated });
}
