/**
 * SessionService — SPEC-041 S1 (bootstrap pointer-set) + S2 (lossless handoff) + resume.
 *
 * Public surface:
 *   bootstrap(by, now?)       → BootstrapReport — the volatile session pointer-set
 *                                (plans, claims, queue, gates, handoffs). READ-ONLY.
 *   writeHandoff(input, now?) → creates a `knowledge`/`handoff` doc via the injected
 *                                `createHandoffDoc` port; four-way parent resolution.
 *   resume(opts, now?)        → ResumeResult — newest-wins or direct handoff targeting,
 *                                age/TTL warning, multi-actor surfacing. READ-ONLY.
 *
 * @invariant `bootstrap` and `resume` perform ZERO store mutations — no
 *   insert/update/softDelete/addLink/removeLink/insertVersion/appendAuditEntry/
 *   insertJudgment/insertCalibrationRecord call, ever (SPEC-041 §4 AC-SL-2). Both
 *   methods only ever call `store.find`/`findMany`/`findLinksByToIds`.
 * @invariant `writeHandoff` never writes through `store` directly — every doc it
 *   creates goes through the constructor-injected `createHandoffDoc` port
 *   (`CorpusService.createHandoffDoc`, bound in `app.ts`), mirroring the
 *   `GateEnforcer`/`resolveDeclaredAcIds` injected-port pattern used elsewhere in this
 *   codebase specifically so services never cross-import each other
 *   (service/CLAUDE.md "Service per concern, no cross-service calls").
 * @invariant Stateless — the only state is the injected `StoreInterface` + the scalar
 *   config bundle passed at construction. All persistent state lives in the store.
 *
 * Source: SPEC-041 §3 D1-D5.
 */

import {
  err,
  ok,
  evaluateReadiness,
  extractClaim,
  isClaimStale,
  knowledgeExtraSchema,
  handoffExtraSchema,
  renderHandoffContent,
  bootstrapReportSchema,
} from "@lore/core";
import type {
  BootstrapReport,
  BlockerInfo,
  CreateDocInput,
  DocId,
  DocRecord,
  HandoffExtra,
  LoreError,
  Result,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";
import type { GateCheckpoint } from "./checkpoint-registry.js";

const defaultNow = (): string => new Date().toISOString();

/** All four IoC vertical-slice gate checkpoints, in the fixed order `bootstrap` renders them. */
const GATE_CHECKPOINTS: readonly GateCheckpoint[] = [
  "spec-create",
  "spec-promote",
  "plan-promote",
  "task-claim",
];

/**
 * checkpoint → discoverable feeding-skill scope (`knowledgeExtraSchema.skill.applies_to`),
 * consumed by {@link SessionService.bootstrap}'s `armed_gates[].feeding_source_slug`. A
 * LOCAL, narrower mirror of `flows/feed-flow.ts::CHECKPOINT_PRODUCED_TYPE` — services
 * must not import from `flows/`/`adapters/` (service/CLAUDE.md "no cross-service
 * calls" / composition lives in app.ts), so this module cannot import that map
 * directly. Only `"spec-create"` has a discoverable feeding SKILL wired in production
 * today (mirrors `CHECKPOINT_PRODUCED_TYPE`'s current single entry) — the other three
 * checkpoints source their feeding message from the TARGET doc's resolved ancestor
 * spec (`checkpoint-registry.ts::feedUpstreamSpecCheckpoint`), not a skill-doc lookup,
 * so they have no single corpus-wide "the feeding source" a bootstrap snapshot could
 * point at; their `feeding_source_slug` is `null`.
 */
const CHECKPOINT_APPLIES_TO: Partial<Record<GateCheckpoint, string>> = {
  "spec-create": "spec",
};

/** Truncates `title` to at most `maxChars`, appending an ellipsis marker when cut. */
function truncateTitle(title: string, maxChars = 120): string {
  return title.length > maxChars ? `${title.slice(0, maxChars - 1)}…` : title;
}

/** Ascending `created_at` comparator — the deterministic ordering `bootstrap` uses for "first PRD" / pending-queue sampling. */
function byCreatedAtAsc(a: DocRecord, b: DocRecord): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return 0;
}

/**
 * Extracts a Zod-valid `HandoffExtra` from `doc`, or `null` when `doc` isn't a
 * `knowledge` doc with `extra.sub_type === "handoff"` and a valid `extra.handoff`.
 * The single extraction point both `bootstrap` and `resume` use for handoff docs.
 */
function extractHandoffExtra(doc: DocRecord): HandoffExtra | null {
  if (doc.type !== "knowledge") return null;
  const parsed = knowledgeExtraSchema.safeParse(doc.extra);
  if (!parsed.success || parsed.data.sub_type !== "handoff" || parsed.data.handoff === undefined) {
    return null;
  }
  return parsed.data.handoff;
}

/**
 * Constructor dependency bundle for {@link SessionService}.
 *
 * @invariant `createHandoffDoc` is the ONLY way `writeHandoff` persists a document —
 *   production wiring is `corpusService.createHandoffDoc.bind(corpusService)` (`app.ts`).
 * @invariant `isCheckpointEnabled` is OPTIONAL (undefined in bare test construction,
 *   mirroring every other optional-DI service in this codebase) — defaults to
 *   "everything enabled" (bootstrap's own fallback), the SAME default
 *   `resolveGateEnabled(undefined, checkpoint)` and `GateEnforcer.isEnabled` already
 *   apply when no config is wired. Production wiring is
 *   `gateEnforcer.isEnabled.bind(gateEnforcer)` (`app.ts`) — reusing `GateEnforcer`'s
 *   OWN enablement decision rather than re-deriving `workflow.gates.*` from a second
 *   raw `LoreConfig` reference, so the two can never drift.
 */
export interface SessionServiceDeps {
  /** Task claim lease TTL in minutes — forwarded to `isClaimStale`/`evaluateReadiness`. */
  readonly claimTtlMinutes: number;
  /** Handoff staleness TTL in minutes — `resume`'s `ttl_warning` threshold. */
  readonly handoffTtlMinutes: number;
  /** Internal creation seam — `CorpusService.createHandoffDoc`, bound. See module invariants. */
  readonly createHandoffDoc: (input: CreateDocInput) => Promise<Result<DocRecord, LoreError>>;
  /** Per-checkpoint gate enablement port — `GateEnforcer.isEnabled`, bound. See module invariants. */
  readonly isCheckpointEnabled?: (checkpoint: GateCheckpoint) => boolean;
}

/** One resolved handoff, as `resume` returns it — pointer fields plus the full rendered content (the one deliberate pointers-only exception, D5). */
export interface ResumeHandoffRecord {
  readonly handoff_slug: string;
  readonly plan_slug: string | null;
  readonly by: string;
  readonly at: string;
  readonly age_minutes: number;
  /** `true` when `age_minutes` exceeds `workflow.handoff_ttl_minutes` (default 10080 = 7 days). */
  readonly ttl_warning: boolean;
  /** Mirrors `extra.handoff.degraded` — a git-only capture with no recorded decisions. */
  readonly degraded: boolean;
  /** Deterministic re-render of `extra.handoff` via `renderHandoffContent` — the SSOT projection, not `doc.content` read verbatim. */
  readonly content: string;
}

/** Live readiness snapshot for the plan a resumed handoff (or `--plan` target) is scoped to. Reuses the same `evaluateReadiness` computation `lore ready` uses. */
export interface ResumeReadinessPointer {
  readonly plan_slug: string;
  readonly total: number;
  readonly ready: number;
  readonly claimed: number;
  readonly done: number;
}

/**
 * `SessionService.resume`'s result. `found: false` (both `handoff`/`handoffs` absent,
 * `readiness: null`) is a FACT, not an error — "no handoff recorded yet" is a
 * legitimate corpus state (D5: "(no handoff recorded)", exit 0 at the CLI layer).
 */
export interface ResumeResult {
  readonly found: boolean;
  /** Present iff `found` and `multi_actor` is `false` — the single newest-wins (or direct-targeted) record. */
  readonly handoff?: ResumeHandoffRecord;
  /** Present iff `found` and `multi_actor` is `true` — newest PER actor, newest-first. */
  readonly handoffs?: ResumeHandoffRecord[];
  /** `true` iff `--by` was omitted, no explicit `--handoff` was given, and the candidate set spans >1 actor (D5 — divergent state is surfaced, never silently collapsed). */
  readonly multi_actor: boolean;
  /** `null` when no single plan context applies (empty result, or a multi-actor result spanning ambiguous plan scope). */
  readonly readiness: ResumeReadinessPointer | null;
}

export class SessionService {
  constructor(
    private readonly store: StoreInterface,
    private readonly deps: SessionServiceDeps,
  ) {}

  // ── Bootstrap (S1) ────────────────────────────────────────────────────────

  /**
   * Assembles the S1 volatile pointer-set for a fresh session: root PRD, active
   * plans + task readiness, the pending-review queue, the caller's own claims, armed
   * gate checkpoints, latest handoffs per plan, and a corpus-wide resume hint.
   * READ-ONLY — see module invariants.
   *
   * @param by - The requesting actor's identity — filters `my_claims` to this actor.
   * @param now - Caller-supplied current-time seam (never `Date.now()` directly),
   *   mirroring `TaskWorkflowService.ready`'s `now` parameter shape.
   * @returns `ok(BootstrapReport)` — always a fact, never an error; an empty corpus
   *   produces `root: null` + empty arrays, not a failure (AC-SL-10).
   * @example
   * const result = await sessionService.bootstrap("alice");
   * if (result.ok) console.log(result.value.active_plans.length);
   */
  async bootstrap(
    by: string,
    now: () => string = defaultNow,
  ): Promise<Result<BootstrapReport, LoreError>> {
    const nowIso = now();

    const allDocsResult = await this.store.findMany({});
    if (!allDocsResult.ok) return allDocsResult;
    const allDocs = allDocsResult.value;

    const slugById = new Map<DocId, string>(allDocs.map((d) => [d.id, d.slug]));

    // reason: D2 pins bootstrap's root resolution to "first PRD by created_at,
    // deterministic" — deliberately NOT an error for >1 PRDs (unlike writeHandoff's
    // stricter parent-resolution rule below, D3) — bootstrap is an advisory snapshot,
    // not a write path that needs disambiguation.
    const prds = allDocs.filter((d) => d.type === "prd").sort(byCreatedAtAsc);
    const firstPrd = prds[0];
    const root = firstPrd !== undefined ? { slug: firstPrd.slug, title: truncateTitle(firstPrd.title) } : null;

    // Active (non-terminal) plans + per-plan task readiness counts.
    const plans = allDocs.filter((d) => d.type === "plan");
    const activePlans: BootstrapReport["active_plans"] = [];
    for (const plan of plans) {
      if (plan.status === "archived" || plan.status === "deprecated") continue;
      const tasks = allDocs.filter((d) => d.type === "task" && d.parent_id === plan.id);
      const countsResult = await this.computeTaskCounts(tasks, allDocs, nowIso);
      if (!countsResult.ok) return countsResult;
      activePlans.push({ slug: plan.slug, title: truncateTitle(plan.title), task_counts: countsResult.value });
    }

    // Pending review queue — same `status: "draft"` filter ReviewService.pending uses.
    const pendingDrafts = allDocs.filter((d) => d.status === "draft").sort(byCreatedAtAsc);
    const pendingReviews = {
      count: pendingDrafts.length,
      slugs: pendingDrafts.slice(0, 10).map((d) => d.slug),
    };

    // Caller's own claims, across every task corpus-wide.
    const myClaims: BootstrapReport["my_claims"] = [];
    for (const task of allDocs) {
      if (task.type !== "task") continue;
      const claim = extractClaim(task);
      if (claim === undefined || claim.by !== by) continue;
      myClaims.push({
        task_slug: task.slug,
        // reason: task.parent_id not resolving to a known doc (broken ref / hard
        // delete) is a data-integrity edge case, not a reason to fail the whole
        // bootstrap snapshot — degrades to a placeholder, never silently a wrong slug.
        plan_slug: task.parent_id !== null ? (slugById.get(task.parent_id) ?? "(unknown)") : "(unknown)",
        claimed_at: claim.at,
        stale: isClaimStale(claim, nowIso, this.deps.claimTtlMinutes),
      });
    }

    // Armed gates — enabled checkpoints + discoverable feeding-skill source.
    const approvedSkills = allDocs.filter((d) => {
      if (d.type !== "knowledge" || d.status !== "approved") return false;
      const parsed = knowledgeExtraSchema.safeParse(d.extra);
      return parsed.success && parsed.data.sub_type === "skill";
    });
    const isCheckpointEnabled = this.deps.isCheckpointEnabled ?? (() => true);
    const armedGates: BootstrapReport["armed_gates"] = [];
    for (const checkpoint of GATE_CHECKPOINTS) {
      if (!isCheckpointEnabled(checkpoint)) continue;
      const appliesTo = CHECKPOINT_APPLIES_TO[checkpoint];
      let feedingSourceSlug: string | null = null;
      if (appliesTo !== undefined) {
        const matches = approvedSkills.filter((d) => {
          const parsed = knowledgeExtraSchema.safeParse(d.extra);
          return parsed.success && parsed.data.skill?.applies_to === appliesTo;
        });
        const latest =
          matches.length > 0
            ? matches.reduce((newest, d) => (d.updated_at > newest.updated_at ? d : newest))
            : undefined;
        feedingSourceSlug = latest?.slug ?? null;
      }
      armedGates.push({ checkpoint, feeding_source_slug: feedingSourceSlug });
    }

    // Latest handoff per plan grouping (null group = parentless or PRD-parented) + a
    // corpus-wide resume hint (the single newest handoff overall).
    const planIds = new Set(plans.map((p) => p.id));
    const handoffPairs = allDocs
      .map((doc) => ({ doc, handoff: extractHandoffExtra(doc) }))
      .filter((p): p is { doc: DocRecord; handoff: HandoffExtra } => p.handoff !== null);

    const groups = new Map<DocId | null, Array<{ doc: DocRecord; handoff: HandoffExtra }>>();
    for (const pair of handoffPairs) {
      const key = pair.doc.parent_id !== null && planIds.has(pair.doc.parent_id) ? pair.doc.parent_id : null;
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, [pair]);
      } else {
        group.push(pair);
      }
    }

    const latestHandoffs: BootstrapReport["latest_handoffs"] = [];
    for (const [planId, pairs] of groups) {
      const newest = pairs.reduce((n, p) => (p.doc.created_at > n.doc.created_at ? p : n));
      latestHandoffs.push({
        plan_slug: planId !== null ? (slugById.get(planId) ?? null) : null,
        handoff_slug: newest.doc.slug,
        by: newest.handoff.by,
        at: newest.doc.created_at,
      });
    }
    latestHandoffs.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    const overallNewest =
      handoffPairs.length > 0
        ? handoffPairs.reduce((n, p) => (p.doc.created_at > n.doc.created_at ? p : n))
        : undefined;
    const resumeHint =
      overallNewest !== undefined
        ? {
            plan_slug:
              overallNewest.doc.parent_id !== null && planIds.has(overallNewest.doc.parent_id)
                ? (slugById.get(overallNewest.doc.parent_id) ?? null)
                : null,
            handoff_slug: overallNewest.doc.slug,
          }
        : null;

    // Corpus-wide size + freshness snapshot.
    const lastUpdated =
      allDocs.length > 0
        ? allDocs.reduce((latest, d) => (d.updated_at > latest ? d.updated_at : latest), allDocs[0]!.updated_at)
        : null;

    const report: BootstrapReport = {
      root,
      active_plans: activePlans,
      pending_reviews: pendingReviews,
      my_claims: myClaims,
      armed_gates: armedGates,
      latest_handoffs: latestHandoffs,
      resume_hint: resumeHint,
      corpus: { total_docs: allDocs.length, last_updated: lastUpdated },
    };

    // reason: self-consistency assertion, not user-input validation —
    // bootstrapReportSchema documents the exact shape this method is contractually
    // obligated to produce; a parse failure here means a programmer error in this
    // method, not bad external input, so a throwing `.parse` is appropriate (mirrors
    // checkpoint-registry.ts's "can't happen in production" throw shape).
    return ok(bootstrapReportSchema.parse(report));
  }

  // ── Handoff Write (S2) ──────────────────────────────────────────────────

  /**
   * Validates `input` against `handoffExtraSchema`, resolves its parent (four-way
   * rule below), renders deterministic content, and creates the doc via the injected
   * `createHandoffDoc` port. Status is always `draft` (the doc enters the normal
   * review loop — unreviewed handoffs are advisory, PRD §15).
   *
   * Parent resolution (pinned, SPEC-041 §3 D3):
   *   1. `input.plan_ref` given → must resolve to a live (non-deleted) `plan` doc,
   *      else `VALIDATION_ERROR`.
   *   2. No `plan_ref`, exactly one PRD in the corpus → that PRD.
   *   3. No `plan_ref`, zero PRDs → parentless (legal for `knowledge` docs).
   *   4. No `plan_ref`, >1 PRDs → `VALIDATION_ERROR` requiring `plan_ref`.
   *
   * @param input - A `handoffExtraSchema`-shaped payload (validated here, not by the
   *   caller — the JSON IS the `extra.handoff` SSOT, D6).
   * @param now - Reserved for symmetry with `bootstrap`/`resume`'s time seam; not
   *   currently consulted (doc timestamps come from `createHandoffDoc`'s own clock).
   * @returns `ok(DocRecord)` of the created handoff doc, or `err(VALIDATION_ERROR)`.
   * @example
   * await sessionService.writeHandoff({
   *   by: "claude", task_refs: [], modified_files: [], key_decisions: [],
   *   next_steps: ["merge the PR"],
   * });
   */
  async writeHandoff(
    input: HandoffExtra,
    // reason: accepted for signature symmetry with bootstrap/resume's explicit time
    // seam (D10-style discipline); writeHandoff itself performs no now()-dependent
    // computation — doc timestamps are stamped by createHandoffDoc's own clock.
    _now: () => string = defaultNow,
  ): Promise<Result<DocRecord, LoreError>> {
    const parsed = handoffExtraSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? String(issue.path.join(".")) : "handoff",
        message: issue?.message ?? "Invalid handoff payload",
        value: input,
      });
    }
    const handoff = parsed.data;

    let parentId: DocId | null = null;
    if (handoff.plan_ref !== undefined) {
      const resolveResult = await resolveDoc(this.store, handoff.plan_ref);
      if (!resolveResult.ok) {
        return err({
          code: "VALIDATION_ERROR",
          field: "plan_ref",
          message: `plan_ref "${handoff.plan_ref}" does not resolve to any document`,
          value: handoff.plan_ref,
        });
      }
      const planDoc = resolveResult.value;
      if (planDoc.type !== "plan" || planDoc.deleted_at !== null) {
        return err({
          code: "VALIDATION_ERROR",
          field: "plan_ref",
          message:
            `plan_ref "${handoff.plan_ref}" must resolve to a live plan document — ` +
            `found type "${planDoc.type}"${planDoc.deleted_at !== null ? " (soft-deleted)" : ""}`,
          value: handoff.plan_ref,
        });
      }
      parentId = planDoc.id;
    } else {
      const prdsResult = await this.store.findMany({ type: "prd" });
      if (!prdsResult.ok) return prdsResult;
      const prds = prdsResult.value;
      if (prds.length === 1) {
        parentId = prds[0]!.id;
      } else if (prds.length > 1) {
        return err({
          code: "VALIDATION_ERROR",
          field: "plan_ref",
          message:
            "multiple PRDs exist in the corpus; plan_ref is required to disambiguate the handoff's parent",
          value: prds.map((p) => p.slug),
        });
      }
      // prds.length === 0 → parentId stays null (parentless — legal for knowledge docs).
    }

    const createInput: CreateDocInput = {
      type: "knowledge",
      title: `Handoff — ${handoff.by}`,
      ...(parentId !== null ? { parent_id: parentId } : {}),
      content: renderHandoffContent(handoff),
      extra: { sub_type: "handoff", handoff },
    };

    return this.deps.createHandoffDoc(createInput);
  }

  // ── Resume (S2 read path) ────────────────────────────────────────────────

  /**
   * Resolves the handoff(s) matching `opts` and returns them with rendered content,
   * age/TTL status, and a readiness pointer. READ-ONLY — see module invariants.
   *
   * Targeting (SPEC-041 §3 D5):
   *   - `opts.handoff` given → direct targeting, skips all derivation.
   *   - Else `opts.plan` given → newest-wins scoped to that plan (or newest PER
   *     actor when `opts.by` is omitted and >1 actor has handoffs there —
   *     `multi_actor: true`).
   *   - Else corpus-wide → newest-wins overall (same actor-isolation/multi-actor
   *     rule, applied without a plan scope).
   *   - `opts.by`, when given, filters the candidate set to that actor first.
   *
   * @param opts.plan - Plan id/slug to scope the search to. Ignored when `opts.handoff` is given.
   * @param opts.handoff - Handoff doc id/slug — direct targeting. When given, this is
   *   the ENTIRE candidate set: `opts.plan` and `opts.by` are both ignored (D5 "skips
   *   derivation" — an explicit target is never re-filtered).
   * @param opts.by - Actor identity to isolate to. Only consulted when `opts.handoff`
   *   is omitted.
   * @param now - Caller-supplied current-time seam.
   * @returns `ok(ResumeResult)` — `found: false` is a fact (D5: "(no handoff recorded)"),
   *   never an error. An unresolvable `--plan`/`--handoff` id IS an error (bad input,
   *   distinct from "valid target, zero handoffs yet").
   * @example
   * const result = await sessionService.resume({ plan: "plan-session-layer" });
   * if (result.ok && result.value.found) console.log(result.value.handoff?.content);
   */
  async resume(
    opts: { plan?: string; handoff?: string; by?: string },
    now: () => string = defaultNow,
  ): Promise<Result<ResumeResult, LoreError>> {
    const nowIso = now();

    let scopePlan: DocRecord | null = null;
    let explicitPair: { doc: DocRecord; handoff: HandoffExtra } | null = null;

    if (opts.handoff !== undefined) {
      const resolveResult = await resolveDoc(this.store, opts.handoff);
      if (!resolveResult.ok) return resolveResult;
      const doc = resolveResult.value;
      const handoff = extractHandoffExtra(doc);
      if (handoff === null) {
        return err({
          code: "VALIDATION_ERROR",
          field: "handoff",
          message: `"${opts.handoff}" does not resolve to a knowledge/handoff document`,
          value: opts.handoff,
        });
      }
      explicitPair = { doc, handoff };
    }

    if (opts.plan !== undefined) {
      const resolveResult = await resolveDoc(this.store, opts.plan);
      if (!resolveResult.ok) return resolveResult;
      const doc = resolveResult.value;
      if (doc.type !== "plan") {
        return err({
          code: "VALIDATION_ERROR",
          field: "plan",
          message: `"${opts.plan}" does not resolve to a plan document`,
          value: opts.plan,
        });
      }
      scopePlan = doc;
    }

    // Candidate set — direct targeting skips derivation entirely (D5).
    let candidates: Array<{ doc: DocRecord; handoff: HandoffExtra }>;
    if (explicitPair !== null) {
      candidates = [explicitPair];
    } else {
      const allResult = await this.store.findMany({ type: "knowledge" });
      if (!allResult.ok) return allResult;
      candidates = [];
      for (const doc of allResult.value) {
        const handoff = extractHandoffExtra(doc);
        if (handoff === null) continue;
        if (scopePlan !== null && doc.parent_id !== scopePlan.id) continue;
        candidates.push({ doc, handoff });
      }
      if (opts.by !== undefined) {
        candidates = candidates.filter((c) => c.handoff.by === opts.by);
      }
    }

    if (candidates.length === 0) {
      return ok({ found: false, multi_actor: false, readiness: null });
    }

    // Newest-wins / newest-per-actor selection (skipped for direct --handoff targeting).
    let selected: Array<{ doc: DocRecord; handoff: HandoffExtra }>;
    let multiActor = false;
    if (explicitPair !== null) {
      selected = candidates;
    } else {
      const actors = new Set(candidates.map((c) => c.handoff.by));
      if (actors.size <= 1) {
        selected = [candidates.reduce((n, c) => (c.doc.created_at > n.doc.created_at ? c : n))];
      } else {
        multiActor = true;
        const newestByActor = new Map<string, { doc: DocRecord; handoff: HandoffExtra }>();
        for (const c of candidates) {
          const existing = newestByActor.get(c.handoff.by);
          if (existing === undefined || c.doc.created_at > existing.doc.created_at) {
            newestByActor.set(c.handoff.by, c);
          }
        }
        selected = [...newestByActor.values()].sort((a, b) => (a.doc.created_at < b.doc.created_at ? 1 : -1));
      }
    }

    const records: ResumeHandoffRecord[] = [];
    for (const pair of selected) {
      records.push(await this.buildResumeRecord(pair.doc, pair.handoff, nowIso));
    }

    // Readiness pointer — only for a single, unambiguous plan context (D5's readiness
    // block is a per-plan concept; a multi-actor result has no single plan to point at).
    let readiness: ResumeReadinessPointer | null = null;
    if (!multiActor) {
      const single = selected[0]!;
      let planDoc: DocRecord | null = scopePlan;
      if (planDoc === null && single.doc.parent_id !== null) {
        const parentResult = await this.store.find(single.doc.parent_id);
        if (parentResult.ok && parentResult.value !== null && parentResult.value.type === "plan") {
          planDoc = parentResult.value;
        }
      }
      if (planDoc !== null) {
        const readinessResult = await this.computeReadinessPointer(planDoc, nowIso);
        if (!readinessResult.ok) return readinessResult;
        readiness = readinessResult.value;
      }
    }

    if (multiActor) {
      return ok({ found: true, handoffs: records, multi_actor: true, readiness });
    }
    // reason: non-empty by construction — `selected` (and therefore `records`) always
    // has exactly 1 entry in the non-multi-actor branch (see selection logic above).
    return ok({ found: true, handoff: records[0]!, multi_actor: false, readiness });
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Computes `{ready, claimed, done}` for one plan's `tasks`, reusing
   * `evaluateReadiness` (`@lore/core`) — the same computation `lore ready` uses.
   * `claimed` counts tasks with a FRESH (non-stale) claim; `done` counts tasks whose
   * `status === "archived"` — the same "satisfied iff archived" convention
   * `evaluateReadiness` already applies to blockers, reused here at the plan level
   * since this codebase has no separate task-completion status field (SPEC-025 §3 D6
   * removed `task_status`).
   *
   * @param tasks - The plan's child task docs.
   * @param allDocs - Every doc in the corpus (already loaded by the caller) — used to
   *   build the blocker-status map without a second `findMany({})` round trip.
   * @param nowIso - Current time, ISO 8601.
   */
  private async computeTaskCounts(
    tasks: DocRecord[],
    allDocs: DocRecord[],
    nowIso: string,
  ): Promise<Result<{ ready: number; claimed: number; done: number }, LoreError>> {
    if (tasks.length === 0) return ok({ ready: 0, claimed: 0, done: 0 });

    const taskIds = tasks.map((t) => t.id);
    const linksResult = await this.store.findLinksByToIds(taskIds, "blocks");
    if (!linksResult.ok) return linksResult;

    const blockerStatuses = new Map<DocId, BlockerInfo>();
    for (const doc of allDocs) {
      blockerStatuses.set(doc.id, { slug: doc.slug, status: doc.status });
    }

    const records = evaluateReadiness(
      tasks,
      linksResult.value,
      blockerStatuses,
      nowIso,
      this.deps.claimTtlMinutes,
    );

    let ready = 0;
    let claimed = 0;
    let done = 0;
    for (const record of records) {
      if (record.ready) ready += 1;
      if (record.claim !== undefined && !record.claim.stale) claimed += 1;
      if (record.task.status === "archived") done += 1;
    }
    return ok({ ready, claimed, done });
  }

  /** Fetches `planDoc`'s tasks + computes its readiness pointer for `resume`'s output. */
  private async computeReadinessPointer(
    planDoc: DocRecord,
    nowIso: string,
  ): Promise<Result<ResumeReadinessPointer, LoreError>> {
    const tasksResult = await this.store.findMany({ type: "task", parent_id: planDoc.id });
    if (!tasksResult.ok) return tasksResult;
    const allDocsResult = await this.store.findMany({});
    if (!allDocsResult.ok) return allDocsResult;

    const countsResult = await this.computeTaskCounts(tasksResult.value, allDocsResult.value, nowIso);
    if (!countsResult.ok) return countsResult;

    return ok({
      plan_slug: planDoc.slug,
      total: tasksResult.value.length,
      ...countsResult.value,
    });
  }

  /** Builds one {@link ResumeHandoffRecord} from a resolved (doc, handoff) pair. */
  private async buildResumeRecord(
    doc: DocRecord,
    handoff: HandoffExtra,
    nowIso: string,
  ): Promise<ResumeHandoffRecord> {
    const ageMs = new Date(nowIso).getTime() - new Date(doc.created_at).getTime();

    let planSlug: string | null = null;
    if (doc.parent_id !== null) {
      // reason: plan_slug is an OPTIONAL pointer (nullable in the schema) — a lookup
      // failure or a non-plan parent both legitimately resolve to "no plan", not an
      // error. This is a display pointer, not a required field (contrast with
      // writeHandoff's plan_ref resolution above, which DOES fail loud — that path
      // decides where a doc gets WRITTEN; this one only decides what to DISPLAY).
      const parentResult = await this.store.find(doc.parent_id);
      if (parentResult.ok && parentResult.value !== null && parentResult.value.type === "plan") {
        planSlug = parentResult.value.slug;
      }
    }

    return {
      handoff_slug: doc.slug,
      plan_slug: planSlug,
      by: handoff.by,
      at: doc.created_at,
      age_minutes: Math.floor(ageMs / 60_000),
      ttl_warning: ageMs > this.deps.handoffTtlMinutes * 60_000,
      degraded: handoff.degraded === true,
      content: renderHandoffContent(handoff),
    };
  }
}
