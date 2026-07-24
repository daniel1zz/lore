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
 * `extractClaim`, `isClaimStale`, or `extractEvidence` itself (those derivations
 * live in `adapters/cli/task-feed-wiring.ts::buildTaskFeedFlowDeps`, over
 * `CorpusService.getPlanBundle` + `TaskWorkflowService.ready`). AC-070-1 asserts
 * this module's import graph contains none of those four function names — grep:
 * `grep -n 'computeAcCoverage\|extractClaim\|isClaimStale\|extractEvidence' \
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
 *
 * `TASK_START_CHECKPOINT` is registered in `feed-flow.ts`'s `CHECKPOINT_PRODUCED_TYPE`
 * SSOT map (SPEC-070 D1) — `commands/feed.ts` special-cases it (mirroring
 * `PHASE_START_CHECKPOINT`) to call `buildTaskStartPack` directly, since a generic
 * `buildFeed` call has no notion of a task-scoped bundle.
 *
 * Side-effect class: none (pure over the injected `TaskFeedFlowDeps` — no direct IO)
 * Source: spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start
 *   §Design D1-D4, D9; §Acceptance Criteria AC-070-1..7
 */

import { ok, truncateSection } from "@lore/core";
import type { AcVerifyMode, LoreError, DocRecord, Result } from "@lore/core";
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
   * Pre-aggregated coverage verdict: `"attested_pass"` (runner-attested pass
   * evidence exists) > `"pass"` (self-reported pass) > `"fail"` (no pass, at
   * least one fail) > `"none"` (no evidence at all) — precedence resolved by the
   * wiring, never here.
   */
  readonly coverage: "attested_pass" | "pass" | "fail" | "none";
  /**
   * `true` when the parent plan declares NO `ac_scope` (nothing is "out of
   * scope", so every criterion counts as in-scope) OR the plan's `ac_scope`
   * explicitly includes this id; `false` when the plan DOES declare a
   * (non-empty) `ac_scope` that omits this id (SPEC-070 D4).
   */
  readonly scoped: boolean;
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

function renderAcceptanceRow(ac: AcceptanceView): string {
  const scopeTag = ac.scoped ? "" : " [out-of-scope]";
  const commandTag = ac.command !== undefined ? ` — command: ${ac.command}` : "";
  return `- ${ac.id} [${ac.coverage}] (${ac.mode})${scopeTag}: ${ac.statement}${commandTag}`;
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

function renderConstraints(bundle: TaskBundle): string {
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
 * @param deps - Narrow injected port bundle.
 * @param taskId - The target task's id or slug (forwarded to `deps.getTaskBundle` untouched).
 * @param budgets - Optional partial override merged over `DEFAULT_TASK_START_BUDGETS`.
 * @returns `ok(TaskStartPack)`, or `err(LoreError)` propagated verbatim from a fatal `getTaskBundle` failure.
 * @example
 * const result = await buildTaskStartPack(deps, "task-implement-cli-slice");
 * const objectiveText = result.ok ? result.value.sections.objective : null;
 */
export async function buildTaskStartPack(
  deps: TaskFeedFlowDeps,
  taskId: string,
  budgets?: Partial<TaskStartBudgets>,
): Promise<Result<TaskStartPack, LoreError>> {
  const bundleResult = await deps.getTaskBundle(taskId);
  if (!bundleResult.ok) return bundleResult;
  const bundle = bundleResult.value;

  const resolvedBudgets: TaskStartBudgets = { ...DEFAULT_TASK_START_BUDGETS, ...budgets };

  const [planStateResult, knowledgeResult, handoffResult] = await Promise.all([
    deps.planStateForTask(bundle.planSlug),
    deps.listLinkedKnowledgePointers(bundle.relatedKnowledge, KNOWLEDGE_POINTER_LIMIT),
    deps.latestHandoffForPlan(bundle.planSlug),
  ]);

  const rawSections = {
    objective: renderObjective(bundle),
    acceptance: renderAcceptance(bundle),
    constraints: renderConstraints(bundle),
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

  return ok({ task_id: taskId, sections, truncated });
}
