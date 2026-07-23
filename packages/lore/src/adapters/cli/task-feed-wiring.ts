/**
 * Task-start feed pack DI wiring (SPEC-070 §Design Decisions D2, D5; §Module
 * Boundary: "adapters/cli/task-feed-wiring.ts (NEW: buildTaskFeedFlowDeps)").
 *
 * THICK-BUNDLE / THIN-FLOW (D2): every domain derivation `flows/task-feed-flow.ts`
 * renders — `computeAcCoverage`, `extractClaim`+`isClaimStale`, fail-evidence
 * extraction (`extractEvidence`), `ac_scope` filtering/dangling-id detection —
 * lives HERE, over `CorpusService.getPlanBundle` + `TaskWorkflowService.ready`.
 * The flow module itself imports none of these functions (AC-070-1, enforced by
 * `tests/unit/flows/task-feed-flow.test.ts`'s import-graph check) — this module is
 * where that weight actually lives, mirroring `phase-wiring.ts`'s
 * `buildPhaseFeedFlowDeps` precedent for the phase-start checkpoint.
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
  extractClaim,
  isClaimStale,
  extractEvidence,
  extractFileAnchors,
  planAcScopeSchema,
  UPSTREAM_APPROVED_STATUSES,
  isInvalidated,
} from "@lore/core";
import type { Result, LoreError, LoreConfig, AcCoverageFact } from "@lore/core";
import type { App } from "../../app.js";
import { extractSpecCriteria } from "../../flows/phase-status-flow.js";
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
} from "../../flows/task-feed-flow.js";

/** Cap on how many prior-failure evidence entries `buildTaskBundle` surfaces (last-N, not budget-clipped). */
const PRIOR_FAILURE_LIMIT = 3;

/** Cap on one prior-failure entry's `output_tail`, pre-clipped HERE (distinct from the flow's own char-budget clipping — see module header). */
const PRIOR_FAILURE_TAIL_CHARS = 500;

/** Derives the coverage-precedence label `AcceptanceView.coverage` renders (attested_pass > pass > fail > none). */
function deriveCoverageLabel(fact: AcCoverageFact): AcceptanceView["coverage"] {
  if (fact.attested_pass > 0) return "attested_pass";
  if (fact.pass > 0) return "pass";
  if (fact.fail > 0) return "fail";
  return "none";
}

/**
 * `TaskFeedFlowDeps.getTaskBundle` real binding — resolves `taskIdOrSlug`, walks its
 * parent plan via `corpusService.getPlanBundle` (the SAME port `TaskWorkflowService`'s
 * claim gate and `phase-wiring.ts`'s `buildPhaseBundle` both use), and assembles every
 * pre-derived fact `buildTaskStartPack` (`flows/task-feed-flow.ts`) renders.
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
  if (!bundleResult.ok) return bundleResult;
  const bundle = bundleResult.value;

  const criteria = bundle.spec !== undefined ? extractSpecCriteria(bundle.spec) : [];
  const acScopeParsed = planAcScopeSchema.safeParse(bundle.plan.extra["ac_scope"]);
  const acScope = acScopeParsed.success ? acScopeParsed.data : undefined;

  const coverage = computeAcCoverage(criteria, bundle.tasks);
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
    };
  });

  const danglingScopedIds =
    acScope !== undefined ? acScope.filter((id) => !criteria.some((c) => c.id === id)) : [];

  const anchors = extractFileAnchors(task);

  const nowIso = new Date().toISOString();
  const ttlMinutes = app.taskWorkflowService.claimTtlMinutes;
  const claim = extractClaim(task);
  const claimView: ClaimView | null =
    claim === undefined ? null : { holder: claim.by, fresh: !isClaimStale(claim, nowIso, ttlMinutes) };

  const priorFailures: FailureSummary[] = extractEvidence(task)
    .filter((e) => e.result === "fail")
    .slice(-PRIOR_FAILURE_LIMIT)
    .map((e) => ({
      oracle: e.oracle,
      command: e.command,
      tail: (e.output_tail ?? "").slice(0, PRIOR_FAILURE_TAIL_CHARS),
    }));

  const upstreamSpecApproved =
    bundle.spec !== undefined ? UPSTREAM_APPROVED_STATUSES.has(bundle.spec.status) : null;

  const phaseName = typeof task.extra["phase"] === "string" ? (task.extra["phase"] as string) : null;

  return ok({
    task,
    planSlug: bundle.plan.slug,
    specSlug: bundle.spec !== undefined ? bundle.spec.slug : null,
    phaseName,
    acceptance,
    noDeclaredAcs: criteria.length === 0,
    danglingScopedIds,
    anchors,
    priorFailures,
    claimView,
    upstreamSpecApproved,
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
 * `TaskFeedFlowDeps.listLinkedKnowledgePointers` real binding — mirrors
 * `phase-wiring.ts`'s identically-named binding (reuses `corpusService.get()`'s
 * already-computed `navigation.related`, filtered to `type === "knowledge"`, each
 * candidate re-fetched to check `isInvalidated` since invalidation state isn't
 * carried on the lightweight `DocSummary` navigation entries).
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
 * `TaskFeedFlowDeps.latestHandoffForPlan` real binding — mirrors `phase-wiring.ts`'s
 * identically-named binding (`SessionService.resume({plan: planId})`, the SAME
 * newest-wins/multi-actor derivation `lore feed session-resume` uses).
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
 * Builds `TaskFeedFlowDeps` from a wired `App` — the SAME construction the CLI
 * `lore feed task-start` dispatch and (a future) MCP `lore_feed` task-start branch
 * both call, mirroring `phase-wiring.ts::buildPhaseFeedFlowDeps`'s
 * deep-equal-by-construction rationale.
 */
export function buildTaskFeedFlowDeps(app: App): TaskFeedFlowDeps {
  return {
    getTaskBundle: (taskId) => buildTaskBundle(app, taskId),
    planStateForTask: (planId) => planStateForTask(app, planId),
    listLinkedKnowledgePointers: (docId, limit) => listLinkedKnowledgePointers(app, docId, limit),
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
