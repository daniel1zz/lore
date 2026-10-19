/**
 * Task-start feed pack assembly (SPEC-070 §Design Decisions D1-D4, §Module Boundary:
 * "flows/task-feed-flow.ts (NEW: pure, render-only)"). Assembles the deterministic
 * "task-start" pack an agent PULLs at claim/resume time before beginning work on a
 * task — objective, structured acceptance-criteria coverage, prior-failure
 * constraints, declared file-anchor boundaries, claim state, plan-scoped session/
 * anchor-conflict state, linked-knowledge pointers, and the latest handoff for the
 * plan — from a NARROW injected dependency bundle (`TaskFeedFlowDeps`), mirroring
 * `phase-feed-flow.ts`'s `PhaseFeedFlowDeps` precedent (never the full `App`).
 *
 * THICK-BUNDLE / THIN-FLOW (SPEC-070 D2, the review-mandated correction over the
 * phase-start precedent): every domain fact this module renders arrives ALREADY
 * DERIVED on `TaskBundle` — this module NEVER calls `computeAcCoverage`,
 * `readClaimRecord`, `isClaimStale`, or `extractEvidence` itself (those derivations
 * live in `adapters/cli/task-feed-wiring.ts::buildTaskFeedFlowDeps`, over
 * `CorpusService.getPlanBundle` + `TaskWorkflowService.ready`). AC-070-1 asserts
 * this module's import graph contains none of those four function names — grep:
 * `grep -n 'computeAcCoverage\|readClaimRecord\|isClaimStale\|extractEvidence' \
 *   packages/lore/src/flows/task-feed-flow.ts` MUST return 0 hits.
 *
 * Contract (resolved by `tests/unit/flows/task-feed-flow.test.ts` — that file is the
 * authoritative shape this module satisfies, same "CONTRACT NOTE" convention
 * `phase-feed-flow.test.ts` established):
 *   - `deps.getTaskBundle(taskId)` failing is FATAL — propagated verbatim (SPEC-070
 *     D2). Task/plan/spec resolution is entirely the wiring's job.
 *   - `deps.planStateForTask` / `deps.listLinkedKnowledgePointers` /
 *     `deps.latestHandoffForPlan` each failing is NON-FATAL — the OWN section
 *     degrades to a one-line note; the other seven sections still render (AC-070-2).
 *   - Eight sections, each with its own char budget + its own degrade path
 *     (SPEC-070 D3 cohesion split — task-scoped `claim` vs plan-scoped
 *     `plan_state`, and `knowledge_pointers` vs `handoff`, fail/truncate
 *     independently): `objective`, `acceptance`, `constraints`, `boundaries`,
 *     `claim`, `plan_state`, `knowledge_pointers`, `handoff`.
 *   - Acceptance-view selection is TYPED-FIELDS-ONLY (SPEC-070 D4) — this module
 *     never parses the task's own content prose; `TaskBundle.acceptance`/
 *     `danglingScopedIds` arrive pre-joined from `spec.extra.acceptance_criteria` ×
 *     `plan.extra.ac_scope`.
 *   - Two DISTINCT truncation mechanisms — never conflated (2026-07-23 lesson,
 *     mechanized here as pack text in `boundaries`): the wiring pre-clips
 *     fail-evidence tails to 500 chars and keeps only the last ≤3 entries (never
 *     recorded in `truncated[]`); THIS module's own char-budget clipping (below)
 *     records section keys in `truncated[]` when a section itself overflows its
 *     configured budget.
 *   - `buildTaskStartPack` is deterministic for identical deps+args (AC-070-1) —
 *     the CLI `--json` / MCP deep-equal foundation.
 *   - **SPEC-070 AC-070-11 (review finding F2)**: the wiring's fail-evidence
 *     extraction is PER-ENTRY tolerant (a documented divergence from
 *     `extractEvidence`'s whole-array fail-closed contract, which stays
 *     fail-closed for AC-coverage counting) — `TaskBundle.unparseableEvidenceCount`
 *     carries how many raw evidence entries failed to parse; `renderConstraints`
 *     appends an explicit degraded line whenever it is `> 0`, so a non-empty raw
 *     evidence array never silently renders "(no prior failures)".
 *   - **SPEC-070 AC-070-17 (review finding F10)**: `TaskBundle.relatedKnowledge`
 *     carries the task's already-filtered `navigation.related` (type === "knowledge")
 *     summaries from the wiring's ONE `getTaskBundle` fetch of the task doc —
 *     `deps.listLinkedKnowledgePointers` takes THESE pointers directly (not a
 *     `docId` to re-fetch), so the task doc is never fetched a second time just to
 *     re-derive its own `navigation.related`.
 *   - **AC-DC-11** (task-carry-the-retired-oracle-signal-into-the-feed-pack-so-a,
 *     spec-the-defect-channel-cannot-be-honestly-maintained-an §M5): each
 *     `AcceptanceView` carries an optional `oracle_generation` split ALONGSIDE
 *     `coverage` (never folding it into `deriveAcCoverageState`'s seven states —
 *     the eighth-state extension this task was explicitly forbidden from making).
 *     `renderAcceptanceRow` appends the SAME literal ` [retired_oracle_evidence:
 *     prior_refs=<n> current_refs=<n> generation=<n>]` marker `commands/ac.ts`'s
 *     `lore ac list` already renders (byte-identical vocabulary, see
 *     {@link retiredOracleMarker}'s own JSDoc for why it is a reproduction rather
 *     than an import), omitted whenever `prior_refs === 0`.
 *     `TaskStartPack.acceptance_detail` carries the same `AcceptanceView[]`
 *     structured for `--json`, so a machine consumer reads `oracle_generation` as
 *     a real object instead of re-parsing the rendered marker text.
 *
 * `TASK_START_CHECKPOINT` is registered in `feed-flow.ts`'s `CHECKPOINT_PRODUCED_TYPE`
 * SSOT map (SPEC-070 D1) — `commands/feed.ts` special-cases it (mirroring
 * `PHASE_START_CHECKPOINT`) to call `buildTaskStartPack` directly, since a generic
 * `buildFeed` call has no notion of a task-scoped bundle.
 *
 * ## A RETRACTED task is REFUSED, not annotated
 * (task-validity-landed-on-lore-list-only-the-dispatch-surface, Required #2)
 *
 * MEASURED on `main @ 074df1cd`: `lore feed task-start <retracted task>` returned a
 * complete, confident, entirely normal-looking eight-section work order and exit 0 —
 * total silence on the one surface that DISPATCHES. `lore list`'s D3 exclusion removed
 * the ENUMERATION half of that defect; this module is the other half, and the worse
 * one: a listing is read by something that goes on to check, whereas this pack exists
 * precisely so its reader does NOT have to check.
 *
 * ⛔ REFUSAL was chosen over an in-band announcement, and the reasoning is not
 * interchangeable with the file-anchor advisory precedent (`anchor add`'s non-blocking
 * stderr note) — three independent reasons:
 *   1. A retracted task has NO legitimate "not yet" reading. A mistyped file anchor may
 *      name a path the implementer is about to create; a retracted task is work someone
 *      explicitly withdrew. There is no state of the world in which starting it is right.
 *   2. Every in-band channel here is DROPPABLE. Section text is subject to this module's
 *      own per-section char budgets, and a consumer legitimately reads a SUBSET of
 *      `sections` (`task-feed-render.ts` prints all eight; an agent grepping
 *      `sections.acceptance` reads one). A refusal has no field to miss: there is no
 *      pack, and the non-zero exit code / `ok: false` is structural.
 *   3. It cannot be opted out of. The task's binding constraint was "⛔ no opt-in — a
 *      validity signal a caller must ask for is the inert `--include-invalid` flag all
 *      over again", and a refusal is the one shape with no flag to forget.
 * The escape is NOT a bypass flag: `lore get <task>` shows a retracted doc by design
 * (SPEC-043's deliberate list-hides / direct-address-shows asymmetry), and
 * `lore invalidate <task> --undo` is the write that makes it dispatchable again. Both
 * are named in the refusal message itself.
 *
 * ⛔ The verdict comes from `service/validity-service.ts`'s `projectValidityStatus` —
 * the SSOT read-surface projection — never from a local re-derivation over
 * `task.extra.validity`. A surface that re-derives it is the divergence that makes the
 * next inconsistency invisible.
 *
 * A SEPARATE, non-refusing case: validity metadata that EXISTS but does not parse. The
 * SSOT projection degrades that to "live" (its documented contract) and flags it
 * `metadata_unreadable`; `renderConstraints` announces it in the pack rather than
 * serving a doc whose retraction status could not be established in silence.
 *
 * Side-effect class: PURE given an injected `now`. The DEFAULT `now` performs exactly
 * one wall-clock read per call (the time-seam convention every service here uses); no
 * other IO — every domain fact still arrives on `TaskBundle`.
 * Source: spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start
 *   §Design D1-D4, D9; §Acceptance Criteria AC-070-1..7;
 *   SPEC-043 §Design Decisions D3/D4;
 *   task-validity-landed-on-lore-list-only-the-dispatch-surface Required #1, #2
 */

import { ok, err, truncateSection } from "@lore/core";
import type { AcOracleGenerationSplit, AcVerifyMode, LoreError, DocRecord, Result, deriveAcCoverageState } from "@lore/core";
import { projectValidityStatus, type ValidityStatus } from "../service/validity-service.js";
import type { GoverningRules } from "../service/governing-rules.js";
import type { DefinitionOfDone } from "../service/task-workflow-service.js";
import type { KnowledgePointer, HandoffPointer } from "./feed-shared-types.js";

/** Re-exported for import-compat — see `feed-shared-types.ts` for the authoritative shapes. */
export type { KnowledgePointer, HandoffPointer } from "./feed-shared-types.js";

// ─── Contract shapes (SPEC-070 D2, D3, D4) ─────────────────────────────────

/**
 * One declared acceptance criterion pre-joined against evidence coverage and the
 * parent plan's `ac_scope` — the caller (`buildTaskFeedFlowDeps`) computes every
 * field; this module only renders them (thick-bundle/thin-flow, D2).
 */
export interface AcceptanceView {
  readonly id: string;
  readonly statement: string;
  readonly mode: AcVerifyMode;
  /** Present only for `mode: "script"` criteria — the declared oracle command. */
  readonly command?: string;
  /**
   * Pre-aggregated coverage verdict — the seven-state precedence
   * `deriveAcCoverageState` (`@lore/core`, `acceptance.ts`) returns; see that
   * function's own JSDoc for the complete precedence table (M4's `fail_superseded`,
   * M5's `not_measured`, both spec-oracle-tier-falsifiability-a-criterion-never-
   * observed-red). Precedence itself is resolved entirely by the wiring
   * (`task-feed-wiring.ts::deriveCoverageLabel`), never here — this type is
   * DERIVED from that function's return type (`ReturnType<typeof
   * deriveAcCoverageState>`), not a hand-widened copy: a hand-maintained union IS
   * the SSOT defect M4/M5 measured (two of six consumers silently drifted before
   * this fix), so widening it by hand here would preserve exactly that defect in a
   * form that drifts again the next time the derivation grows a state.
   */
  readonly coverage: ReturnType<typeof deriveAcCoverageState>;
  /**
   * `true` when the parent plan declares NO `ac_scope` (nothing is "out of
   * scope", so every criterion counts as in-scope) OR the plan's `ac_scope`
   * explicitly includes this id; `false` when the plan DOES declare a
   * (non-empty) `ac_scope` that omits this id (SPEC-070 D4).
   */
  readonly scoped: boolean;
  /**
   * The current-vs-retired oracle-generation split for this criterion
   * (spec-the-defect-channel-cannot-be-honestly-maintained-an §M5,
   * task-carry-the-retired-oracle-signal-into-the-feed-pack-so-a, AC-DC-11) —
   * `AcCoverageFact.oracle_generation` (`@lore/core`'s `acceptance.ts`), carried
   * VERBATIM by the wiring (`task-feed-wiring.ts::buildTaskBundle`) ALONGSIDE
   * `coverage`, never folded into it: `deriveAcCoverageState` gains NO eighth
   * state for this (the task's own binding constraint) — `coverage`'s badge
   * stays whatever it already was, exactly the additive-reporting design
   * `commands/ac.ts`'s module header documents for the sibling `lore ac list`
   * surface (AC-DC-10). This field is the ONLY thing on this view that
   * distinguishes a criterion whose green evidence includes rows produced by a
   * RETIRED (rewritten) oracle command from one whose evidence is entirely
   * current.
   *
   * `undefined` when the wiring's underlying `AcCoverageFact` carries no split
   * at all (no coverage fact for this criterion — see that field's own JSDoc);
   * NEVER coalesced to a computed zero (`?? 0`) by any reader — a consumer
   * (this module's {@link renderAcceptanceRow}, or a `--json` reader of
   * {@link TaskStartPack.acceptance_detail}) must branch on PRESENCE, the same
   * convention `AcCoverageFact.oracle_generation` itself documents.
   */
  readonly oracle_generation?: AcOracleGenerationSplit;
}

/** One prior FAILING evidence entry, pre-clipped by the wiring (tail ≤500 chars, last ≤3 kept — SPEC-070 D2/D3). */
export interface FailureSummary {
  readonly oracle: string;
  readonly command: string;
  readonly tail: string;
}

/**
 * One `type === "knowledge"` entry from the task's own `navigation.related` — the
 * pre-filtered pointer shape `TaskBundle.relatedKnowledge` carries (SPEC-070
 * AC-070-17, review finding F10) so `deps.listLinkedKnowledgePointers` never needs
 * to re-fetch the task doc just to re-derive its own related-links list.
 */
export interface RelatedKnowledgeRef {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

/** Pre-derived claim verdict — the flow receives a verdict, never computes staleness itself (SPEC-070 D2). */
export interface ClaimView {
  readonly holder: string;
  readonly fresh: boolean;
}

/** One derived session grouping, render-narrowed from `@lore/core`'s `ReadySession` (SPEC-042 D1). */
export interface SessionView {
  readonly by: string;
  // reason: `| undefined` explicit (not just `?:`) — `exactOptionalPropertyTypes`
  // distinguishes "absent" from "present as undefined"; the real binding assigns
  // `ReadySession[]` (whose Zod-inferred optional fields carry the explicit
  // union) straight through without remapping, so this type must accept both.
  readonly machine?: string | undefined;
  readonly worktree?: string | undefined;
  readonly task_slugs: string[];
}

/** One anchor-overlap advisory entry, render-narrowed from the service layer's `AnchorConflict` (SPEC-042 D7). */
export interface AnchorConflictView {
  readonly task_slug: string;
  readonly holder: string;
  readonly paths: string[];
}

/** Plan-scoped session/anchor-conflict slice of `TaskWorkflowService.ready`'s report — the `plan_state` section's raw material. */
export interface PlanStateSlice {
  readonly sessions: SessionView[];
  readonly anchor_conflicts: AnchorConflictView[];
}

/**
 * The raw materials `buildTaskStartPack` renders into a pack — assembled entirely
 * by `deps.getTaskBundle`, never re-derived by this module (thick-bundle/thin-flow,
 * SPEC-070 D2).
 */
export interface TaskBundle {
  readonly task: DocRecord;
  readonly planSlug: string;
  /** `null` when the plan has no spec ancestor (top-level, or PRD-parented). */
  readonly specSlug: string | null;
  /** `null` when the task declares no `extra.phase`. */
  readonly phaseName: string | null;
  /** Declared acceptance criteria pre-joined with coverage + scope (empty when `noDeclaredAcs`). */
  readonly acceptance: AcceptanceView[];
  /** `true` when the parent spec declares zero structured acceptance criteria (or has no spec ancestor at all). */
  readonly noDeclaredAcs: boolean;
  /** `plan.extra.ac_scope` ids that name NO declared criterion on the spec — rendered as a loud row, never dropped (SPEC-070 D4). */
  readonly danglingScopedIds: string[];
  /** Declared `file_anchors` on the task, verbatim. */
  readonly anchors: string[];
  /** Last ≤3 FAILING evidence entries, pre-clipped (see module header). */
  readonly priorFailures: FailureSummary[];
  /**
   * Count of raw `verification_evidence` entries that failed per-entry parsing
   * (SPEC-070 AC-070-11, review finding F2) — rendered as an explicit degraded
   * line in `constraints` whenever `> 0`. `0` when every entry parsed (including
   * when there is no evidence at all).
   */
  readonly unparseableEvidenceCount: number;
  /** `null` when the task holds no claim. */
  readonly claimView: ClaimView | null;
  /** `null` when the plan has no spec ancestor — "nothing to check", not "unapproved". */
  readonly upstreamSpecApproved: boolean | null;
  /**
   * The task's OWN `navigation.related` entries filtered to `type === "knowledge"`
   * (SPEC-070 AC-070-17, review finding F10) — `deps.listLinkedKnowledgePointers`
   * consumes this directly instead of re-fetching the task doc.
   */
  readonly relatedKnowledge: RelatedKnowledgeRef[];
  /**
   * Baseline rules governing the task, already capped (`selectGoverningRules`, BL-15). ABSENT when
   * no baseline rule governs it — the pack then carries no `governing_rules` and renders no section.
   */
  readonly governingRules?: GoverningRules;
  /** The task's definition of done (BR-1357), computed by the wiring from the done floors' own predicates. */
  readonly definitionOfDone?: DefinitionOfDone;
}

/**
 * Narrow injected dependency bundle — mirrors `phase-feed-flow.ts`'s
 * `PhaseFeedFlowDeps` (never the full `App`; see module header).
 */
export interface TaskFeedFlowDeps {
  /** Resolves `taskId` into its full bundle (task + plan/spec pointers + pre-joined acceptance/claim/failures). FATAL on error. */
  getTaskBundle: (taskId: string) => Promise<Result<TaskBundle, LoreError>>;
  /** Plan-scoped sessions + anchor conflicts (a slice of `TaskWorkflowService.ready`'s report). NON-FATAL on error. */
  planStateForTask: (planId: string) => Promise<Result<PlanStateSlice, LoreError>>;
  /**
   * Hygiene-filtered (D3-style) linked-knowledge lookup — this module also filters
   * defensively. Takes `TaskBundle.relatedKnowledge` DIRECTLY (SPEC-070 AC-070-17,
   * review finding F10) rather than a `docId` to re-fetch — the task doc's
   * `navigation.related` was already computed by the ONE `getTaskBundle` fetch.
   * NON-FATAL on error.
   */
  listLinkedKnowledgePointers: (
    related: RelatedKnowledgeRef[],
    limit: number,
  ) => Promise<Result<KnowledgePointer[], LoreError>>;
  /** The most recent `handoff` knowledge doc linked to `planId`, or `null` when none exists. NON-FATAL on error. */
  latestHandoffForPlan: (planId: string) => Promise<Result<HandoffPointer | null, LoreError>>;
}

/** Per-section character budgets — eight sections, each independently configurable (SPEC-070 D3, D5). */
export interface TaskStartBudgets {
  readonly max_objective_chars: number;
  readonly max_acceptance_chars: number;
  readonly max_constraints_chars: number;
  readonly max_boundaries_chars: number;
  readonly max_claim_chars: number;
  readonly max_plan_state_chars: number;
  readonly max_knowledge_chars: number;
  readonly max_handoff_chars: number;
}

/**
 * `workflow.task_feed.*` config defaults (SPEC-070 D5) — sized generously so
 * ordinary task/plan/spec content never truncates; only pathological oversized
 * material hits these caps. FLOW-OWNED — `@lore/core`'s `workflow.task_feed`
 * schema fields are all optional with NO Zod-level default, deliberately, so this
 * constant stays the sole default source (see `config.ts`'s own JSDoc).
 */
export const DEFAULT_TASK_START_BUDGETS: TaskStartBudgets = {
  max_objective_chars: 8000,
  max_acceptance_chars: 6000,
  max_constraints_chars: 3000,
  max_boundaries_chars: 2000,
  max_claim_chars: 500,
  max_plan_state_chars: 2000,
  max_knowledge_chars: 2000,
  max_handoff_chars: 1000,
};

/** Cap on how many linked-knowledge pointers are requested per pack assembly. */
const KNOWLEDGE_POINTER_LIMIT = 20;

/** Default time seam for {@link buildTaskStartPack}'s `now` parameter (D3 convention). */
const defaultNow = (): string => new Date().toISOString();

/**
 * The `"task-start"` checkpoint literal (SPEC-070 D1) — registered in
 * `feed-flow.ts`'s `CHECKPOINT_PRODUCED_TYPE` SSOT map; `commands/feed.ts`
 * special-cases it to call `buildTaskStartPack` directly, mirroring
 * `PHASE_START_CHECKPOINT`'s dispatch shape exactly.
 */
export const TASK_START_CHECKPOINT = "task-start";

/** The assembled task-start pack — the shape both CLI `lore feed task-start` and (a future) MCP `lore_feed` render/return. */
export interface TaskStartPack {
  readonly task_id: string;
  readonly sections: {
    readonly objective: string;
    readonly acceptance: string;
    readonly constraints: string;
    readonly boundaries: string;
    readonly claim: string;
    readonly plan_state: string;
    readonly knowledge_pointers: string;
    readonly handoff: string;
  };
  /** Exactly the section keys clipped to fit their budget — mirrors `phase-feed-flow.ts`'s `truncated[]`. */
  readonly truncated: string[];
  /**
   * The declared acceptance criteria, STRUCTURED and verbatim (`TaskBundle.
   * acceptance`, unchanged by this module) — the machine-readable counterpart
   * to `sections.acceptance`'s prose (task-carry-the-retired-oracle-signal-
   * into-the-feed-pack-so-a, AC-DC-11). A `--json` consumer reads
   * `oracle_generation` per criterion here as a REAL object (keyed by
   * `AcCoverageFact`'s own field names, `@lore/core`), never by re-parsing
   * `sections.acceptance`'s rendered marker text. The two are asserted to
   * AGREE — both come from the SAME `AcceptanceView[]`, never two
   * independently derived answers (see
   * `tests/integration/cli/feed-retired-oracle-visibility.bun.test.ts`'s
   * cross-surface checks against `lore ac list`'s own coverage fact).
   */
  readonly acceptance_detail: readonly AcceptanceView[];
  /**
   * Baseline rules governing the task: at most 40, cited-by-spec first, then rules reached through
   * the task's file anchors, plus the overflow count (BL-15). ABSENT (key omitted) when none govern.
   */
  readonly governing_rules?: GoverningRules;
  /** What `lore done` will require of this task (BR-1357); the same value `lore claim --json` prints. ABSENT when the bundle carries none. */
  readonly definition_of_done?: DefinitionOfDone;
}

/** The fixed scoped-oracle discipline line embedded in every `boundaries` section (2026-07-23 full-suite-contention lesson, mechanized as pack text — SPEC-070 D3). */
const SCOPED_ORACLE_DISCIPLINE_LINE =
  "Oracle scope (SCOPED ONLY — never the full suite in a worktree): run only the " +
  "declared script-mode AC commands above, `vitest run --changed <merge-base>`, and " +
  "the project's typecheck command. The full test suite is the orchestrator's " +
  "post-merge job on main, not a worktree implementer's.";

/** Renders a `LoreError` into a short human-readable note (mirrors `phase-feed-flow.ts`'s `describeError`). */
function describeError(error: LoreError): string {
  const message = "message" in error && typeof error.message === "string" ? error.message : error.code;
  return `${error.code}: ${message}`;
}

/**
 * The refusal a retracted task produces instead of a pack — see this module's header
 * for why refusal (not annotation) is the chosen shape.
 *
 * ⛔ TWO tokens are emitted UNCONDITIONALLY — the literal `RETRACTED` and the
 * `invalid_at=` key — because a machine consumer matching on one of them must not be
 * defeated by a retraction that recorded no successor and no reason. `superseded_by`
 * and `reason` are appended only when stored (a fabricated placeholder for either would
 * be a made-up fact about the retraction).
 *
 * @param task - The retracted task, verbatim from the bundle (its `slug` is the stable
 *   identity carried on `value`, never the caller's raw id-or-slug input)
 * @param validity - The SSOT projection's verdict for this task
 * @returns A `VALIDATION_ERROR` on `extra.validity` → CLI exit 4, MCP `isError: true`
 */
function retractedTaskRefusal(task: DocRecord, validity: ValidityStatus): LoreError {
  // reason: an `invalidated: true` verdict entails a stored `invalid_at` (the projection's
  // own contract), so the fallback branch is unreachable — it is spelled out LOUDLY
  // rather than defaulted to a blank/`??`-ed value so the token can never silently
  // vanish from the message if that entailment ever breaks.
  const instant =
    validity.invalid_at !== undefined
      ? validity.invalid_at
      : "(contract violation: retracted with no recorded instant)";
  const details = [
    `invalid_at=${instant}`,
    ...(validity.superseded_by !== undefined ? [`superseded_by=${validity.superseded_by}`] : []),
    ...(validity.reason !== undefined ? [`reason="${validity.reason}"`] : []),
  ].join("; ");

  return {
    code: "VALIDATION_ERROR",
    field: "extra.validity",
    message:
      `RETRACTED task "${task.slug}" — refusing to assemble a task-start dispatch pack ` +
      `(${details}). A retracted task is work that was explicitly withdrawn, so there is ` +
      `no pack to serve and nothing to start. Read the document itself with ` +
      `\`lore get ${task.slug}\` — direct address always shows a retracted doc, by design. ` +
      `If the retraction was itself wrong, \`lore invalidate ${task.slug} --undo\` ` +
      `restores the task and this command with it.`,
    value: task.slug,
  };
}

// ─── Section renderers (pure — every fact already sits on `TaskBundle`) ────

function renderObjective(bundle: TaskBundle): string {
  const lines: string[] = [
    `Task: ${bundle.task.title} (${bundle.task.slug}) — status: ${bundle.task.status}`,
    `Plan: ${bundle.planSlug}`,
  ];
  if (bundle.specSlug !== null) lines.push(`Spec: ${bundle.specSlug}`);
  if (bundle.phaseName !== null) lines.push(`Phase: ${bundle.phaseName}`);
  lines.push("");
  lines.push(bundle.task.content);
  return lines.join("\n");
}

/**
 * Trailing marker naming `ac`'s retired-oracle evidence split — the SAME literal
 * vocabulary `commands/ac.ts::retiredOracleMarker` renders for `lore ac list`
 * (AC-DC-10), reproduced HERE rather than imported: `commands/ac.ts` sits outside
 * this task's file anchors (task-carry-the-retired-oracle-signal-into-the-feed-
 * pack-so-a's own File Anchors), so the two functions are two call sites by
 * necessity, not by choice — see this task's own residual note (recorded at
 * hand-off) proposing a follow-up that extracts ONE shared function into
 * `@lore/core` and points `commands/ac.ts` at it too, closing the drift risk this
 * duplication leaves open. AC-DC-11's binding constraint is "ONE renderer
 * vocabulary across both surfaces, never invent a second spelling" — this
 * function's three branches and their exact string templates MUST stay in
 * lockstep with `retiredOracleMarker`'s (`commands/ac.ts`, current line ~943); a
 * future edit to either side without the other is exactly the drift this comment
 * exists to catch on read. `tests/integration/cli/
 * feed-retired-oracle-visibility.bun.test.ts`'s HAPPY dimension asserts the two
 * surfaces' rendered marker SUBSTRINGS are byte-identical for the same criterion
 * in the same corpus, which would catch a silent divergence even without this
 * comment being re-read.
 *
 * @param split - `AcceptanceView.oracle_generation` — never re-derived here.
 * @returns `""` when `split` is `undefined` (no coverage fact for this criterion
 *   at all — the only reachable "absent" case through this module's real wiring,
 *   `task-feed-wiring.ts::buildTaskBundle`, since `computeAcCoverage` always
 *   populates `oracle_generation` on every fact it returns) or when
 *   `prior_refs === 0` (every referencing evidence row is current-generation —
 *   the NEGATIVE-control case a bare `> 0` marker-always-fires bug would miss);
 *   the full ` [retired_oracle_evidence: prior_refs=<n> current_refs=<n>
 *   generation=<n>]` marker otherwise.
 */
function retiredOracleMarker(split: AcceptanceView["oracle_generation"]): string {
  if (split === undefined) return "";
  if (split.prior_refs === 0) return "";
  return ` [retired_oracle_evidence: prior_refs=${split.prior_refs} current_refs=${split.current_refs} generation=${split.current}]`;
}

function renderAcceptanceRow(ac: AcceptanceView): string {
  const scopeTag = ac.scoped ? "" : " [out-of-scope]";
  const commandTag = ac.command !== undefined ? ` — command: ${ac.command}` : "";
  const retiredTag = retiredOracleMarker(ac.oracle_generation);
  return `- ${ac.id} [${ac.coverage}] (${ac.mode})${scopeTag}: ${ac.statement}${commandTag}${retiredTag}`;
}

function renderAcceptance(bundle: TaskBundle): string {
  const lines: string[] = [];
  if (bundle.noDeclaredAcs) {
    lines.push("(no declared acceptance criteria)");
  } else {
    lines.push(...bundle.acceptance.map(renderAcceptanceRow));
  }
  for (const id of bundle.danglingScopedIds) {
    lines.push(`⚠ ${id} (dangling scoped id — no such AC declared on the spec)`);
  }
  return lines.join("\n");
}

function renderFailure(f: FailureSummary): string {
  return `- [${f.oracle}] ${f.command}\n  ${f.tail}`;
}

function renderConstraints(bundle: TaskBundle, validity: ValidityStatus): string {
  const lines: string[] = [];
  lines.push(
    bundle.priorFailures.length === 0
      ? "(no prior failures)"
      : bundle.priorFailures.map(renderFailure).join("\n"),
  );
  if (bundle.unparseableEvidenceCount > 0) {
    lines.push(
      `⚠ (${bundle.unparseableEvidenceCount} evidence entries unparseable — history may be incomplete)`,
    );
  }
  // reason: an UNREADABLE `extra.validity` degrades to the "live" verdict by the SSOT
  // projection's documented contract, which is the right verdict (a read surface must
  // not invent a retraction) but the WRONG silence — this task is served on the
  // strength of metadata nobody could parse. Announced here rather than refused: unlike
  // a recorded retraction, unparseable metadata carries no withdrawal decision to obey.
  if (validity.metadata_unreadable === true) {
    lines.push(
      "⛔ validity metadata on this task is present but UNREADABLE — its retraction status " +
        "could NOT be established. Verify with `lore get` before starting, and repair the " +
        "field via `lore invalidate` (its sole writer).",
    );
  }
  if (bundle.upstreamSpecApproved === false) {
    lines.push("⚠ upstream spec not approved");
  }
  return lines.join("\n");
}

function renderBoundaries(bundle: TaskBundle): string {
  const lines: string[] = [];
  lines.push(
    bundle.anchors.length === 0
      ? "(no declared file anchors)"
      : bundle.anchors.map((a) => `- ${a}`).join("\n"),
  );
  lines.push("");
  lines.push(SCOPED_ORACLE_DISCIPLINE_LINE);
  return lines.join("\n");
}

function renderClaim(bundle: TaskBundle): string {
  if (bundle.claimView === null) return "(no claim)";
  return bundle.claimView.fresh
    ? `Claimed by ${bundle.claimView.holder} (fresh)`
    : `Claimed by ${bundle.claimView.holder} (STALE — reclaimable)`;
}

function renderSession(s: SessionView): string {
  const parts = [s.by];
  if (s.machine !== undefined) parts.push(`machine: ${s.machine}`);
  if (s.worktree !== undefined) parts.push(`worktree: ${s.worktree}`);
  return `- ${parts.join(", ")} — claimed: ${s.task_slugs.join(", ")}`;
}

function renderAnchorConflict(c: AnchorConflictView): string {
  return `- ${c.task_slug} conflicts with ${c.holder} on: ${c.paths.join(", ")}`;
}

function renderPlanState(result: Result<PlanStateSlice, LoreError>): string {
  if (!result.ok) {
    return `(plan state unavailable: ${describeError(result.error)})`;
  }
  const { sessions, anchor_conflicts } = result.value;
  const lines: string[] = [];
  lines.push(sessions.length === 0 ? "(no active sessions)" : sessions.map(renderSession).join("\n"));
  lines.push(
    anchor_conflicts.length === 0
      ? "(no anchor conflicts)"
      : anchor_conflicts.map(renderAnchorConflict).join("\n"),
  );
  return lines.join("\n");
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
 * Assembles the task-start deterministic pack for `taskId`. See module header for
 * the full fatal/non-fatal failure contract and truncation semantics.
 *
 * ⛔ REFUSES a RETRACTED task (see this module's header for why refusal, not annotation):
 * `err(VALIDATION_ERROR)` on `extra.validity`, no pack, non-zero exit at both call sites.
 * The check runs BEFORE any section render and before the three auxiliary port calls —
 * a refused dispatch must not cost three store round trips, and no partially-assembled
 * pack must exist for a caller to salvage.
 *
 * @param deps - Narrow injected port bundle.
 * @param taskId - The target task's id or slug (forwarded to `deps.getTaskBundle` untouched).
 * @param budgets - Optional partial override merged over `DEFAULT_TASK_START_BUDGETS`.
 * @param now - Time seam (SPEC-043 D3 convention) for the bi-temporal retraction verdict;
 *   defaults to one wall-clock read. Injected by tests so a FUTURE-dated `invalid_at`
 *   (correctly still live) is assertable. ⛔ Never echoed into the pack — the returned
 *   payload stays byte-identical across repeat runs (`list-plan-membership.test.ts`'s
 *   read-idempotence contract, and the `--json` deep-equal foundation of AC-070-1).
 * @returns `ok(TaskStartPack)`; `err(LoreError)` propagated verbatim from a fatal
 *   `getTaskBundle` failure; or `err(VALIDATION_ERROR)` when the task is retracted.
 * @example
 * const result = await buildTaskStartPack(deps, "task-implement-cli-slice");
 * const objectiveText = result.ok ? result.value.sections.objective : null;
 */
export async function buildTaskStartPack(
  deps: TaskFeedFlowDeps,
  taskId: string,
  budgets?: Partial<TaskStartBudgets>,
  now: () => string = defaultNow,
): Promise<Result<TaskStartPack, LoreError>> {
  const bundleResult = await deps.getTaskBundle(taskId);
  if (!bundleResult.ok) return bundleResult;
  const bundle = bundleResult.value;

  // ONE instant for the whole assembly — the verdict and the pack can never straddle
  // two "now"s. `bundle.task` is a full `DocRecord`, so the SSOT projection reads
  // `extra.validity` off the ONE fetch the wiring already made (no new dep port).
  const validity = projectValidityStatus(bundle.task, now());
  if (validity.invalidated) {
    return err(retractedTaskRefusal(bundle.task, validity));
  }

  const resolvedBudgets: TaskStartBudgets = { ...DEFAULT_TASK_START_BUDGETS, ...budgets };

  const [planStateResult, knowledgeResult, handoffResult] = await Promise.all([
    deps.planStateForTask(bundle.planSlug),
    deps.listLinkedKnowledgePointers(bundle.relatedKnowledge, KNOWLEDGE_POINTER_LIMIT),
    deps.latestHandoffForPlan(bundle.planSlug),
  ]);

  const rawSections = {
    objective: renderObjective(bundle),
    acceptance: renderAcceptance(bundle),
    constraints: renderConstraints(bundle, validity),
    boundaries: renderBoundaries(bundle),
    claim: renderClaim(bundle),
    plan_state: renderPlanState(planStateResult),
    knowledge_pointers: renderKnowledgeSection(knowledgeResult),
    handoff: renderHandoffSection(handoffResult),
  };

  const truncated: string[] = [];
  const clip = (key: keyof TaskStartPack["sections"], text: string, maxChars: number): string => {
    const clipped = truncateSection(text, maxChars);
    if (clipped.truncated) truncated.push(key);
    return clipped.text;
  };

  const sections = {
    objective: clip("objective", rawSections.objective, resolvedBudgets.max_objective_chars),
    acceptance: clip("acceptance", rawSections.acceptance, resolvedBudgets.max_acceptance_chars),
    constraints: clip("constraints", rawSections.constraints, resolvedBudgets.max_constraints_chars),
    boundaries: clip("boundaries", rawSections.boundaries, resolvedBudgets.max_boundaries_chars),
    claim: clip("claim", rawSections.claim, resolvedBudgets.max_claim_chars),
    plan_state: clip("plan_state", rawSections.plan_state, resolvedBudgets.max_plan_state_chars),
    knowledge_pointers: clip(
      "knowledge_pointers",
      rawSections.knowledge_pointers,
      resolvedBudgets.max_knowledge_chars,
    ),
    handoff: clip("handoff", rawSections.handoff, resolvedBudgets.max_handoff_chars),
  };

  return ok({
    task_id: taskId,
    sections,
    truncated,
    acceptance_detail: bundle.acceptance,
    ...(bundle.governingRules !== undefined ? { governing_rules: bundle.governingRules } : {}),
    ...(bundle.definitionOfDone !== undefined ? { definition_of_done: bundle.definitionOfDone } : {}),
  });
}
