/**
 * Task-start feed pack DI wiring (SPEC-070 §Design Decisions D2, D5; §Module
 * Boundary: "adapters/cli/task-feed-wiring.ts (NEW: buildTaskFeedFlowDeps)").
 *
 * THICK-BUNDLE / THIN-FLOW (D2): every domain derivation `flows/task-feed-flow.ts`
 * renders — `computeAcCoverage`, `extractClaim`+`isClaimStale`, fail-evidence
 * extraction, `ac_scope` filtering/dangling-id detection — lives HERE, over
 * `CorpusService.getPlanBundle` + `TaskWorkflowService.ready`. The flow module
 * itself imports none of these functions (AC-070-1, enforced by
 * `tests/unit/flows/task-feed-flow.test.ts`'s import-graph check) — this module is
 * where that weight actually lives, mirroring `phase-wiring.ts`'s
 * `buildPhaseFeedFlowDeps` precedent for the phase-start checkpoint.
 *
 * SPEC-070 review-fix wave additions (AC-070-10..14, 17 — see each function's own
 * JSDoc for the full rationale):
 *   - `output_tail` clipping uses `@lore/core`'s `headChars` (surrogate-safe),
 *     never a bare `.slice()` (F1/AC-070-10 — BUG-001-class corruption).
 *   - Prior-failure extraction is PER-ENTRY tolerant (`extractEvidenceTolerant`),
 *     a documented divergence from `extractEvidence`'s whole-array fail-closed
 *     contract (F2/AC-070-11) — `computeAcCoverage` keeps using `extractEvidence`
 *     unchanged for AC-coverage counting.
 *   - Coverage-label precedence delegates to `@lore/core`'s shared
 *     `deriveAcCoverageState` (F3/AC-070-12) instead of a second, independently
 *     drifted precedence implementation.
 *   - A present-but-schema-invalid `plan.extra.ac_scope` is a loud
 *     `VALIDATION_ERROR`, never silently treated as absent (F4/AC-070-13).
 *   - Aux-port internal refetch failures (`listLinkedKnowledgePointers`,
 *     `latestHandoffForPlan`) propagate as `err(...)` instead of manufacturing a
 *     success row (F5/AC-070-14).
 *   - The task doc is fetched exactly once — `listLinkedKnowledgePointers` takes
 *     the already-computed `TaskBundle.relatedKnowledge` directly rather than
 *     re-fetching the task by id (F10/AC-070-17).
 *   - Each `AcceptanceView`'s `oracle_generation` field is populated straight from
 *     the SAME `fact` this function already reads for `deriveCoverageLabel` — no
 *     second `computeAcCoverage` call, no re-derivation (task-carry-the-retired-
 *     oracle-signal-into-the-feed-pack-so-a, AC-DC-11; spec-the-defect-channel-
 *     cannot-be-honestly-maintained-an §M5).
 *
 * Two DISTINCT truncation mechanisms — never conflated (2026-07-23 lesson,
 * documented again here since this is the mechanism that performs the first one):
 * `buildTaskBundle` pre-clips a fail-evidence entry's `output_tail` to 500 chars
 * and keeps only the LAST ≤3 fail entries (never recorded in any `truncated[]` —
 * that is entry-count/tail-length clipping, a data-shaping decision). The flow
 * module's OWN section char-budget clipping (via `truncateSection`) is the SECOND,
 * separate mechanism, and IS recorded in `TaskStartPack.truncated[]`.
 *
 * Public surface:
 *   - buildTaskFeedFlowDeps(app) — the SAME construction the CLI `lore feed
 *     task-start` dispatch and (a future) MCP `lore_feed` task-start branch both
 *     call, mirroring `buildPhaseFeedFlowDeps`'s deep-equal-by-construction rationale.
 *   - resolveTaskStartBudgets(config) — resolves `workflow.task_feed.*` config into
 *     a `Partial<TaskStartBudgets>` (D5) — the CLI/MCP adapter's job per the flow
 *     module's own "budget resolution vs. budget application" split.
 *
 * Side-effect class: none (pure construction — no IO of its own; the constructed
 *   deps functions themselves perform IO, same as every other App-bound wiring)
 * Source: spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start
 *   §Design D2, D4, D5, D9
 */

import {
  ok,
  err,
  computeAcCoverage,
  deriveAcCoverageState,
  extractClaim,
  isClaimStale,
  extractFileAnchors,
  planAcScopeSchema,
  evidenceEntrySchema,
  UPSTREAM_APPROVED_STATUSES,
  isInvalidated,
  headChars,
} from "@lore/core";
import type { Result, LoreError, LoreConfig, EvidenceEntry, AcCoverageFact, DocRecord } from "@lore/core";
import type { App } from "../../app.js";
import { extractSpecCriteria } from "../../flows/phase-status-flow.js";
import { isNonPlanParentError } from "../../service/checkpoint-registry.js";
import { selectGoverningRules } from "../../service/governing-rules.js";
import type { GoverningRules } from "../../service/governing-rules.js";
import { deriveAcCites } from "../../store/index-rows.js";
import type {
  TaskFeedFlowDeps,
  TaskBundle,
  AcceptanceView,
  FailureSummary,
  ClaimView,
  PlanStateSlice,
  TaskStartBudgets,
  KnowledgePointer,
  HandoffPointer,
  RelatedKnowledgeRef,
} from "../../flows/task-feed-flow.js";

/** Cap on how many prior-failure evidence entries `buildTaskBundle` surfaces (last-N, not budget-clipped). */
const PRIOR_FAILURE_LIMIT = 3;

/** Cap on one prior-failure entry's `output_tail`, pre-clipped HERE (distinct from the flow's own char-budget clipping — see module header). */
const PRIOR_FAILURE_TAIL_CHARS = 500;

/**
 * Derives the coverage-precedence label `AcceptanceView.coverage` renders. Delegates
 * to `@lore/core`'s `deriveAcCoverageState` — the ONE fail-first precedence
 * implementation this codebase shares with `commands/ac.ts`'s `coverageBadge`
 * (SPEC-070 AC-070-12, review finding F3). Previously this function re-implemented
 * its OWN ordering (`attested_pass > pass > fail > none`), which silently masked a
 * real failure behind an attested-pass badge whenever a criterion had both — the
 * shared helper's fail-first ordering is the deliberate semantic fix.
 */
function deriveCoverageLabel(fact: AcCoverageFact): AcceptanceView["coverage"] {
  return deriveAcCoverageState(fact);
}

/**
 * Per-entry tolerant fail-evidence extraction for the `constraints` section's
 * prior-failure list (SPEC-070 AC-070-11, review finding F2) — a DELIBERATE
 * DIVERGENCE from `@lore/core`'s `extractEvidence`, which is whole-array
 * fail-closed ON PURPOSE (one malformed entry poisons the WHOLE parsed array —
 * the safe direction for AC-coverage counting, where a corrupted entry must never
 * silently count as evidence; `computeAcCoverage` keeps using `extractEvidence`
 * unchanged). This section is advisory prose for a human/agent dispatch read, not
 * a counting oracle — one malformed entry among several good ones must not blank
 * the ENTIRE prior-failure history. `evidenceEntrySchema` (the SAME schema
 * `extractEvidence` parses with) is applied PER ENTRY via `safeParse`; entries
 * that fail are counted, never surfaced individually.
 *
 * @param task - The task doc whose `extra.verification_evidence` is read directly
 *   (mirrors this file's existing direct `task.extra["phase"]` access — `extra` is
 *   typed `Record<string, unknown>`, untyped storage by design).
 * @returns `{entries, unparseableCount}` — `entries` holds every entry that DID
 *   parse (original array order preserved); `unparseableCount` is how many did not.
 *   A non-array/absent `verification_evidence` yields `{entries: [], unparseableCount: 0}`
 *   (a fact — "no evidence recorded", not a parse failure).
 */
function extractEvidenceTolerant(
  task: DocRecord,
): { entries: EvidenceEntry[]; unparseableCount: number } {
  const raw = task.extra["verification_evidence"];
  if (!Array.isArray(raw)) return { entries: [], unparseableCount: 0 };

  const entries: EvidenceEntry[] = [];
  let unparseableCount = 0;
  for (const item of raw) {
    const parsed = evidenceEntrySchema.safeParse(item);
    if (parsed.success) {
      entries.push(parsed.data);
    } else {
      unparseableCount++;
    }
  }
  return { entries, unparseableCount };
}

/**
 * Rendered as `TaskBundle.planSlug` for a task with no governing plan (SPEC-069
 * ad-hoc gap fix, see `buildTaskBundle`'s JSDoc) — `TaskBundle.planSlug` is a
 * required `string` (never `string | null`; widening it would ripple into
 * `flows/task-feed-flow.ts`'s render functions and `TaskFeedFlowDeps` signatures,
 * out of this fix's scope), so a real slug value is needed here. This sentinel is
 * deliberately NOT kebab-case (real slugs never contain spaces/parens/em-dashes),
 * so it can never collide with an actual corpus slug; `planStateForTask`/
 * `latestHandoffForPlan` resolving it fails with `DOC_NOT_FOUND` — both call sites
 * already render THAT failure gracefully (`renderPlanState`/`renderHandoffSection`,
 * `task-feed-flow.ts`'s non-fatal-by-design contract for these two sections), so
 * the pack still renders in full, just with an honest "unavailable" note in those
 * two sections instead of a fabricated plan name.
 */
const NO_GOVERNING_PLAN_SENTINEL = "(none — ad-hoc task, no governing plan)";

/**
 * Baseline rules governing a task, capped at 40 (BL-15, spec baseline-slice-2 C6).
 *
 * Reads through `app.corpusService` (the one store handle every `App` carries, so a bare test App
 * works) and runs the pure `rule-index-queries` over it — the SAME queries `RuleReadService.find`
 * answers with. `ac_cites` rows come from `deriveAcCites`, the store's own derivation of that
 * index, so no criterion is re-parsed here. A store failure is propagated (fail loud), never read
 * as "no governing rules".
 */
async function loadGoverningRules(
  app: App,
  specSlug: string | null,
  anchors: readonly string[],
): Promise<Result<GoverningRules | undefined, LoreError>> {
  const baseline = await app.corpusService.listFull({ type: "baseline" });
  if (!baseline.ok) return baseline;
  if (baseline.value.docs.length === 0) return ok(undefined);
  const specs = await app.corpusService.listFull({ type: "spec" });
  if (!specs.ok) return specs;
  return ok(
    selectGoverningRules(specSlug, anchors, {
      baseline: baseline.value.docs,
      specs: specs.value.docs,
      cites: deriveAcCites(specs.value.docs),
      depends: [],
    }),
  );
}

/**
 * `TaskFeedFlowDeps.getTaskBundle` real binding — resolves `taskIdOrSlug`, walks its
 * parent plan via `corpusService.getPlanBundle` (the SAME port `TaskWorkflowService`'s
 * claim gate and `phase-wiring.ts`'s `buildPhaseBundle` both use), and assembles every
 * pre-derived fact `buildTaskStartPack` (`flows/task-feed-flow.ts`) renders.
 *
 * **SPEC-069 ad-hoc gap fix (task-fix-spec-069-gap-adhoc-task-claim-structurally-
 * impossible, AC-4)**: a `--adhoc` task's `parent_id` (SPEC-069 D2) is the root PRD
 * — non-null, but not `type: "plan"` — so `getPlanBundle` used to hard-fail this
 * function with "Expected a plan document" for the ENTIRE `--adhoc` channel,
 * mirroring the SAME root cause `TaskWorkflowService.enforceClaimGate`/`gate.ts`'s
 * `runTaskClaimGate` had (`checkpoint-registry.ts::isNonPlanParentError`
 * distinguishes this SPECIFIC, structural failure shape from every other
 * `getPlanBundle` error, which still propagates fatally, unchanged). When it fires,
 * this function degrades to a "no governing plan" bundle instead of failing:
 * `spec: undefined` (an ad-hoc task's parent is a PRD, never a spec-tier ancestor),
 * `criteria: []` (nothing to score against — `noDeclaredAcs: true`), `acScope:
 * undefined` (there is no PLAN doc at all to read `extra.ac_scope` off of — the
 * AC-070-13 malformed-scope check below is skipped entirely, not silently passed;
 * skipping is correct here because there is structurally no field to be malformed),
 * and `planSlug: NO_GOVERNING_PLAN_SENTINEL` (see that constant's own JSDoc). Every
 * OTHER fact on `TaskBundle` (`anchors`, `claimView`, `priorFailures`,
 * `relatedKnowledge`, `phaseName`) is read DIRECTLY off `task`/`taskResult`, not off
 * the plan bundle, so none of it is affected by this branch.
 */
async function buildTaskBundle(app: App, taskIdOrSlug: string): Promise<Result<TaskBundle, LoreError>> {
  const taskResult = await app.corpusService.get(taskIdOrSlug);
  if (!taskResult.ok) return taskResult;
  const task = taskResult.value.doc;

  if (task.type !== "task") {
    return err({
      code: "VALIDATION_ERROR",
      field: "type",
      message: `Expected a task document; got type '${task.type}'`,
      value: task.type,
    });
  }
  if (task.parent_id === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "parent_id",
      message: `Task '${task.slug}' has no parent plan`,
      value: task.id,
    });
  }

  const bundleResult = await app.corpusService.getPlanBundle(task.parent_id);
  if (!bundleResult.ok && !isNonPlanParentError(bundleResult.error)) return bundleResult;

  // reason: SPEC-069 ad-hoc gap fix — `planSlug`/`spec`/`siblingTasks` all resolve to
  // the "no governing plan" degraded shape when `getPlanBundle` failed structurally
  // (see this function's own JSDoc); otherwise the real bundle's fields, unchanged.
  const planSlug = bundleResult.ok ? bundleResult.value.plan.slug : NO_GOVERNING_PLAN_SENTINEL;
  const spec = bundleResult.ok ? bundleResult.value.spec : undefined;
  const siblingTasks = bundleResult.ok ? bundleResult.value.tasks : [];

  const criteria = spec !== undefined ? extractSpecCriteria(spec) : [];

  // reason: SPEC-070 AC-070-13 (review finding F4) — a PRESENT-but-schema-invalid
  // `plan.extra.ac_scope` previously fell through `safeParse`'s failure branch to
  // `undefined` (= "unscoped", suppressing dangling-id reporting entirely). `extra`
  // is untyped storage (direct store write, legacy data, or a future format never
  // validated by this reader) — an ABSENT key is legal (no scope declared), but a
  // PRESENT, malformed one must fail loud rather than silently degrade to the
  // widest-possible interpretation. Only reachable when `bundleResult.ok` — an
  // ad-hoc task has no PLAN doc at all to read `extra.ac_scope` off of, so `acScope`
  // stays `undefined` (no scope declared, structurally) rather than attempting a
  // read against a bundle that doesn't exist.
  let acScope: string[] | undefined;
  if (bundleResult.ok) {
    const rawAcScope: unknown = bundleResult.value.plan.extra["ac_scope"];
    if (rawAcScope === undefined) {
      acScope = undefined;
    } else {
      const acScopeParsed = planAcScopeSchema.safeParse(rawAcScope);
      if (!acScopeParsed.success) {
        return err({
          code: "VALIDATION_ERROR",
          field: "plan.extra.ac_scope",
          message: `Plan '${bundleResult.value.plan.slug}' declares a schema-invalid ac_scope: ${acScopeParsed.error.message}`,
          value: rawAcScope,
        });
      }
      acScope = acScopeParsed.data;
    }
  } else {
    acScope = undefined;
  }

  const coverage = computeAcCoverage(criteria, siblingTasks);
  const acceptance: AcceptanceView[] = criteria.map((criterion, i) => {
    const fact = coverage[i];
    const scoped = acScope === undefined ? true : acScope.includes(criterion.id);
    return {
      id: criterion.id,
      statement: criterion.statement,
      mode: criterion.verify.mode,
      ...(criterion.verify.mode === "script" ? { command: criterion.verify.command } : {}),
      coverage: fact !== undefined ? deriveCoverageLabel(fact) : "none",
      scoped,
      // reason: SPEC-070 AC-DC-11 (task-carry-the-retired-oracle-signal-into-the-
      // feed-pack-so-a) — `fact.oracle_generation` is carried onto the view
      // VERBATIM, ALONGSIDE `coverage` above, never folded into it (this task's
      // own binding constraint: `deriveAcCoverageState` gains no eighth state).
      // Conditional spread (never a bare field assignment) because
      // `AcceptanceView.oracle_generation` is optional under
      // `exactOptionalPropertyTypes` — an explicit `undefined` VALUE on the key
      // is rejected by the same rule `resolveTaskStartBudgets` documents on
      // itself below; omitting the key entirely (rather than writing
      // `oracle_generation: undefined`) is the only well-typed way to say
      // "no split known for this criterion".
      ...(fact?.oracle_generation !== undefined ? { oracle_generation: fact.oracle_generation } : {}),
    };
  });

  const danglingScopedIds =
    acScope !== undefined ? acScope.filter((id) => !criteria.some((c) => c.id === id)) : [];

  const anchors = extractFileAnchors(task);

  const governingRulesResult = await loadGoverningRules(app, spec !== undefined ? spec.slug : null, anchors);
  if (!governingRulesResult.ok) return governingRulesResult;

  const nowIso = new Date().toISOString();
  const ttlMinutes = app.taskWorkflowService.claimTtlMinutes;
  const claim = extractClaim(task);
  const claimView: ClaimView | null =
    claim === undefined ? null : { holder: claim.by, fresh: !isClaimStale(claim, nowIso, ttlMinutes) };

  const { entries: tolerantEvidence, unparseableCount: unparseableEvidenceCount } = extractEvidenceTolerant(task);
  const priorFailures: FailureSummary[] = tolerantEvidence
    .filter((e) => e.result === "fail")
    .slice(-PRIOR_FAILURE_LIMIT)
    .map((e) => ({
      oracle: e.oracle,
      command: e.command,
      // reason: SPEC-070 AC-070-10 (review finding F1, BUG-001-class corruption) —
      // a bare `.slice(0, N)` cuts by raw UTF-16 code-unit offset, splitting an
      // astral-plane character (emoji, CJK ext-B) straddling the cut boundary into
      // an unpaired surrogate half. `bun:sqlite` accepts and stores that unpaired
      // surrogate WITHOUT raising an error but does not round-trip it — silent
      // corruption. `headChars` (@lore/core) is the surrogate-safe replacement.
      tail: headChars(e.output_tail ?? "", PRIOR_FAILURE_TAIL_CHARS),
    }));

  const upstreamSpecApproved = spec !== undefined ? UPSTREAM_APPROVED_STATUSES.has(spec.status) : null;

  const phaseName = typeof task.extra["phase"] === "string" ? (task.extra["phase"] as string) : null;

  // reason: SPEC-070 AC-070-17 (review finding F10) — reuse THIS fetch's own
  // `navigation.related`, already computed by `app.corpusService.get` above, so
  // `listLinkedKnowledgePointers` never needs to re-fetch the task doc just to
  // re-derive the same related-links list.
  const relatedKnowledge: RelatedKnowledgeRef[] = taskResult.value.navigation.related
    .filter((r) => r.type === "knowledge")
    .map((r) => ({ id: r.id, slug: r.slug, title: r.title }));

  return ok({
    task,
    planSlug,
    specSlug: spec !== undefined ? spec.slug : null,
    phaseName,
    acceptance,
    noDeclaredAcs: criteria.length === 0,
    danglingScopedIds,
    anchors,
    priorFailures,
    unparseableEvidenceCount,
    claimView,
    upstreamSpecApproved,
    relatedKnowledge,
    ...(governingRulesResult.value !== undefined ? { governingRules: governingRulesResult.value } : {}),
  });
}

/**
 * `TaskFeedFlowDeps.planStateForTask` real binding — a thin slice of
 * `TaskWorkflowService.ready`'s report (`sessions`/`anchor_conflicts` only; the
 * flat `records[]` array is out of this section's scope, it belongs to `lore
 * ready` itself).
 */
async function planStateForTask(app: App, planIdOrSlug: string): Promise<Result<PlanStateSlice, LoreError>> {
  const result = await app.taskWorkflowService.ready(planIdOrSlug);
  if (!result.ok) return result;
  return ok({ sessions: result.value.sessions, anchor_conflicts: result.value.anchor_conflicts });
}

/**
 * `TaskFeedFlowDeps.listLinkedKnowledgePointers` real binding — takes the task's
 * already-filtered `relatedKnowledge` pointers DIRECTLY (SPEC-070 AC-070-17, review
 * finding F10 — the task doc was already fetched once by `buildTaskBundle`, this
 * binding must not re-fetch it just to re-derive the same `navigation.related`
 * list). Each candidate is still re-fetched (bounded by `limit`) to check
 * `isInvalidated`, since invalidation state isn't carried on the lightweight
 * `DocSummary` navigation entries — that per-pointer fetch is unavoidable and
 * explicitly out of this fix's scope.
 *
 * **SPEC-070 AC-070-14 (review finding F5)**: a refetch failure on any candidate
 * PROPAGATES as `err(...)` — it no longer manufactures a success row
 * (`invalidated: false`) for a pointer whose doc couldn't actually be re-read. The
 * flow's `renderKnowledgeSection` already degrades the WHOLE section to one
 * "unavailable" line on any `err`, so one bad pointer among several good ones does
 * still lose the whole section here — deliberately: a partial, silently-wrong
 * pointer list is worse than an honest "couldn't verify" note.
 */
async function listLinkedKnowledgePointers(
  app: App,
  related: RelatedKnowledgeRef[],
  limit: number,
): Promise<Result<KnowledgePointer[], LoreError>> {
  const nowIso = new Date().toISOString();
  const candidates = related.slice(0, limit);

  const pointers: KnowledgePointer[] = [];
  for (const summary of candidates) {
    const docResult = await app.corpusService.get(summary.id);
    if (!docResult.ok) return docResult;
    const invalidated = isInvalidated(docResult.value.doc, nowIso);
    pointers.push({ doc_id: summary.id, slug: summary.slug, title: summary.title, invalidated });
  }
  return ok(pointers);
}

/**
 * `TaskFeedFlowDeps.latestHandoffForPlan` real binding — mirrors `phase-wiring.ts`'s
 * identically-named binding (`SessionService.resume({plan: planId})`, the SAME
 * newest-wins/multi-actor derivation `lore feed session-resume` uses).
 *
 * **SPEC-070 AC-070-14 (review finding F5)**: the handoff doc's own refetch failure
 * (`corpusService.get(record.handoff_slug)`) PROPAGATES as `err(...)` — it no
 * longer manufactures a `{slug, title: slug}` row when the doc couldn't actually be
 * re-read (previously silently substituted the slug for the title, indistinguishable
 * from a real, successfully-resolved pointer whose title happens to equal its slug).
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
  if (!docResult.ok) return docResult;
  return ok({ slug: record.handoff_slug, title: docResult.value.doc.title });
}

/**
 * Builds `TaskFeedFlowDeps` from a wired `App` — the SAME construction the CLI
 * `lore feed task-start` dispatch and (a future) MCP `lore_feed` task-start branch
 * both call, mirroring `phase-wiring.ts::buildPhaseFeedFlowDeps`'s
 * deep-equal-by-construction rationale.
 */
export function buildTaskFeedFlowDeps(app: App): TaskFeedFlowDeps {
  return {
    getTaskBundle: (taskId) => buildTaskBundle(app, taskId),
    planStateForTask: (planId) => planStateForTask(app, planId),
    listLinkedKnowledgePointers: (related, limit) => listLinkedKnowledgePointers(app, related, limit),
    latestHandoffForPlan: (planId) => latestHandoffForPlan(app, planId),
  };
}

/**
 * Resolves `workflow.task_feed.*` config into a `Partial<TaskStartBudgets>` (SPEC-070
 * D5) — the "budget resolution" half of the flow module's own "budget resolution
 * vs. budget application" split (`ai.assess.*`/`truncateSection` precedent).
 * Absence of the whole config, the `workflow` section, or `task_feed` within it all
 * resolve to `{}` — `buildTaskStartPack`'s own `{ ...DEFAULT_TASK_START_BUDGETS,
 * ...budgets }` merge fills in every field from its flow-owned default.
 *
 * @param config - The parsed project `.lore/config.yaml` (`loadLoreApp()`'s `config`
 *   return field), or `undefined` when no config file was found/parsed.
 */
export function resolveTaskStartBudgets(config: LoreConfig | undefined): Partial<TaskStartBudgets> {
  const raw = config?.workflow?.task_feed;
  if (raw === undefined) return {};

  // reason: `raw`'s fields are typed `number | undefined` (Zod `.optional()` with no
  // `.default()` — see config.ts's own JSDoc on why). Under `exactOptionalPropertyTypes`,
  // a `Partial<TaskStartBudgets>` target (whose fields are `readonly` AND rejects an
  // explicit `undefined` VALUE on an optional key) forces a conditional-spread
  // construction — each field is included ONLY when actually defined, never a bare
  // field assignment (readonly) or a wholesale spread (would carry `undefined` values).
  return {
    ...(raw.max_objective_chars !== undefined ? { max_objective_chars: raw.max_objective_chars } : {}),
    ...(raw.max_acceptance_chars !== undefined ? { max_acceptance_chars: raw.max_acceptance_chars } : {}),
    ...(raw.max_constraints_chars !== undefined ? { max_constraints_chars: raw.max_constraints_chars } : {}),
    ...(raw.max_boundaries_chars !== undefined ? { max_boundaries_chars: raw.max_boundaries_chars } : {}),
    ...(raw.max_claim_chars !== undefined ? { max_claim_chars: raw.max_claim_chars } : {}),
    ...(raw.max_plan_state_chars !== undefined ? { max_plan_state_chars: raw.max_plan_state_chars } : {}),
    ...(raw.max_knowledge_chars !== undefined ? { max_knowledge_chars: raw.max_knowledge_chars } : {}),
    ...(raw.max_handoff_chars !== undefined ? { max_handoff_chars: raw.max_handoff_chars } : {}),
  };
}
