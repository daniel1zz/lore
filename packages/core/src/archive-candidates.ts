/**
 * Lifecycle archival — pure rule engine (SPEC-lifecycle-archival R1-R4).
 * Browser-safe: no IO, no wall-clock reads, no randomness — `nowIso` is always
 * caller-injected (the same D10 time-seam discipline `evaluateReadiness` /
 * `isClaimStale` use).
 *
 * Public surface:
 *   - computeArchiveCandidates(docs, nowIso, ttl) — the SWEEP rule engine (R2
 *     superseded handoff, R3 expired handoff, R4 done-plan straggler task).
 *     ONE derivation site shared by `lore archive --sweep`/`--apply` and
 *     `SessionService.bootstrap`'s injected `archive_candidates` count (SPEC
 *     §Design Decisions D1 — "the SAME function backs the sweep verb and the
 *     injection count").
 *   - computePlanCloseCascadeTargets(children, nowIso, claimTtlMinutes) — the
 *     CASCADE rule (R1): a plan's direct child tasks/handoffs to archive when
 *     the plan itself closes. Deliberately a SEPARATE, simpler function from
 *     `computeArchiveCandidates` — R1 is unconditional ("their purpose is
 *     definitionally complete" the moment the parent plan closes), never
 *     age/supersession-gated the way R2/R3 are, so folding it into the same
 *     predicate would either weaken R1 (miss fresh-but-parent-closed docs) or
 *     misapply R2-R4's staleness gating to a rule that has none.
 *
 * @invariant `ArchiveCandidateTtlMinutes` carries TWO independently-configured
 *   TTLs (`handoffTtlMinutes`/`claimTtlMinutes`), not one shared value — the
 *   governing spec's own prose names R3's threshold `workflow.
 *   handoff_ttl_minutes` (default 10080) and R4's "unclaimed" check reuses
 *   `isClaimStale`, which is governed by the UNRELATED `workflow.
 *   claim_ttl_minutes` (default 120, two orders of magnitude smaller).
 *   Collapsing both onto one caller-supplied number would make R4 either
 *   never fire (handoff TTL is 84x larger) or fire prematurely (claim TTL is
 *   far too short for a handoff) — so this module accepts the two values
 *   explicitly rather than pretending they are one "ttlMinutes" scalar.
 * @invariant Exclusions are structural, not special-cased: only `knowledge`
 *   docs with `extra.sub_type === "handoff"` and `task` docs are ever
 *   inspected — `adr`, `spec`, `prd`, `plan`, and every OTHER `knowledge`
 *   sub_type (retro/research/reference/assessment/prompt/skill/uat) never
 *   enter either candidate loop, so they can never be produced as output
 *   regardless of their parent plan's status or the doc's own age.
 * @invariant A doc already in a TERMINAL status (`archived`/`deprecated`) is
 *   never re-reported as a candidate — its purpose-completion is already
 *   recorded.
 *
 * Source: spec-lifecycle-archival-plan-close-cascade-deterministic
 *   §Candidate Rules R1-R4, §Design Decisions D1.
 */

import { extractClaim, isClaimStale } from "./task-workflow.js";
import { knowledgeExtraSchema } from "./schemas.js";
import type { HandoffExtra } from "./session.js";
import type { DocId, DocRecord, DocStatus } from "./types.js";

/** Terminal statuses — a doc here has already completed its lifecycle; never a candidate. */
const TERMINAL_STATUSES: ReadonlySet<DocStatus> = new Set(["archived", "deprecated"]);

// ─── Sweep rule engine (R2/R3/R4) ──────────────────────────────────────────

/** Which R2-R4 rule flagged a given {@link ArchiveCandidate}. */
export type ArchiveCandidateRule = "superseded_handoff" | "expired_handoff" | "done_plan_straggler";

/** One doc the sweep rule engine has determined is due for archival, with a human-readable reason. */
export interface ArchiveCandidate {
  readonly doc_id: DocId;
  readonly slug: string;
  readonly rule: ArchiveCandidateRule;
  readonly reason: string;
}

/**
 * The two independently-configured TTLs {@link computeArchiveCandidates} needs
 * (see this module's header invariant for why they cannot be one shared value).
 */
export interface ArchiveCandidateTtlMinutes {
  /** `workflow.handoff_ttl_minutes` — governs R3's age threshold. */
  readonly handoffTtlMinutes: number;
  /** `workflow.claim_ttl_minutes` — governs R4's claim-freshness check (via `isClaimStale`). */
  readonly claimTtlMinutes: number;
}

/** A handoff doc plus its extracted `HandoffExtra` payload — the sweep loop's working shape. */
interface HandoffInfo {
  readonly doc: DocRecord;
  readonly handoff: HandoffExtra;
}

/**
 * Extracts every live, non-terminal `knowledge`/`sub_type: "handoff"` doc from
 * `docs` with its Zod-valid `HandoffExtra` payload. A doc that fails to parse
 * (malformed/legacy `extra`) is silently excluded — the same "tolerate, don't
 * crash" contract {@link extractClaim} already applies to task claims.
 */
function extractHandoffs(docs: readonly DocRecord[]): HandoffInfo[] {
  const infos: HandoffInfo[] = [];
  for (const doc of docs) {
    if (doc.deleted_at !== null) continue;
    if (doc.type !== "knowledge") continue;
    if (TERMINAL_STATUSES.has(doc.status)) continue;
    const parsed = knowledgeExtraSchema.safeParse(doc.extra);
    if (!parsed.success || parsed.data.sub_type !== "handoff" || parsed.data.handoff === undefined) {
      continue;
    }
    infos.push({ doc, handoff: parsed.data.handoff });
  }
  return infos;
}

/**
 * The SWEEP rule engine (R2 superseded handoff, R3 expired handoff, R4
 * done-plan straggler task) — pure, deterministic, zero LLM. The SAME
 * function backs `lore archive --sweep`/`--apply` and the
 * `SessionService.bootstrap`-injected `archive_candidates` count (SPEC
 * §Design Decisions D1 — one derivation site).
 *
 * R1 (cascade) is NOT covered here — see {@link computePlanCloseCascadeTargets}.
 *
 * @param docs - The full corpus doc set (or any superset containing every
 *   handoff/task candidate plus their parent plan docs — a candidate whose
 *   parent plan is absent from `docs` degrades to "no plan found",
 *   equivalent to a planless doc for R3's purposes, never a thrown error).
 * @param nowIso - Caller-supplied current time (D10 — never `Date.now()` here).
 * @param ttl - `{handoffTtlMinutes, claimTtlMinutes}` — see this module's header invariant.
 * @returns Every distinct candidate, R2 before R3 before R4, in `docs` order
 *   within each rule. A handoff already reported under R2 (superseded) is
 *   NEVER also reported under R3 (expired) even if both conditions hold —
 *   one candidate per doc, never a double-count (R2's `reason` already
 *   explains why it needs archiving).
 * @example
 * computeArchiveCandidates(docs, "2026-07-27T00:00:00.000Z", { handoffTtlMinutes: 10080, claimTtlMinutes: 120 });
 * // => [{ doc_id: "...", slug: "knowledge-handoff-...", rule: "superseded_handoff", reason: "..." }, ...]
 */
export function computeArchiveCandidates(
  docs: readonly DocRecord[],
  nowIso: string,
  ttl: ArchiveCandidateTtlMinutes,
): ArchiveCandidate[] {
  const byId = new Map<DocId, DocRecord>();
  for (const doc of docs) byId.set(doc.id, doc);

  function parentPlanStatus(parentId: DocId | null): DocStatus | undefined {
    if (parentId === null) return undefined;
    return byId.get(parentId)?.status;
  }

  const candidates: ArchiveCandidate[] = [];
  const handoffInfos = extractHandoffs(docs);

  // R2 — superseded handoff: group by (plan_id, by); every non-newest member
  // of a group with >=2 members is a candidate. Grouping key uses JSON.stringify
  // over a [planId, by] tuple — mirrors deriveSessions' identical "null is a
  // stable, distinct grouping value" convention (session.ts).
  const groups = new Map<string, HandoffInfo[]>();
  for (const info of handoffInfos) {
    const key = JSON.stringify([info.doc.parent_id, info.handoff.by]);
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.push(info);
    } else {
      groups.set(key, [info]);
    }
  }

  const supersededIds = new Set<DocId>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let newest = group[0]!;
    for (const info of group) {
      if (info.doc.created_at > newest.doc.created_at) newest = info;
    }
    for (const info of group) {
      if (info.doc.id === newest.doc.id) continue;
      supersededIds.add(info.doc.id);
      candidates.push({
        doc_id: info.doc.id,
        slug: info.doc.slug,
        rule: "superseded_handoff",
        reason: `superseded by newer handoff ${newest.doc.slug} for the same plan+actor pair`,
      });
    }
  }

  // R3 — expired handoff: age > handoffTtlMinutes (strict) AND (planless OR
  // parent plan archived/deprecated). Skips anything already flagged by R2
  // above (one candidate per doc — review the module header invariant).
  for (const info of handoffInfos) {
    if (supersededIds.has(info.doc.id)) continue;
    const ageMinutes = (Date.parse(nowIso) - Date.parse(info.doc.created_at)) / 60_000;
    if (ageMinutes <= ttl.handoffTtlMinutes) continue;
    const planId = info.doc.parent_id;
    const planStatus = parentPlanStatus(planId);
    const planDone = planId === null || (planStatus !== undefined && TERMINAL_STATUSES.has(planStatus));
    if (!planDone) continue;
    candidates.push({
      doc_id: info.doc.id,
      slug: info.doc.slug,
      rule: "expired_handoff",
      reason:
        `age ${Math.floor(ageMinutes)}m exceeds handoff_ttl_minutes (${ttl.handoffTtlMinutes}) and its plan is ` +
        `${planId === null ? "absent" : `${planStatus}`}`,
    });
  }

  // R4 — done-plan straggler task: parent plan archived/deprecated AND the
  // task holds no FRESH claim (isClaimStale reused verbatim — never a
  // hand-rolled expiry check).
  for (const doc of docs) {
    if (doc.deleted_at !== null) continue;
    if (doc.type !== "task") continue;
    if (TERMINAL_STATUSES.has(doc.status)) continue;
    const planStatus = parentPlanStatus(doc.parent_id);
    if (planStatus === undefined || !TERMINAL_STATUSES.has(planStatus)) continue;
    const claim = extractClaim(doc);
    const fresh = claim !== undefined && !isClaimStale(claim, nowIso, ttl.claimTtlMinutes);
    if (fresh) continue;
    candidates.push({
      doc_id: doc.id,
      slug: doc.slug,
      rule: "done_plan_straggler",
      reason: `parent plan is ${planStatus} and this task holds no fresh claim`,
    });
  }

  return candidates;
}

// ─── Cascade rule (R1) ──────────────────────────────────────────────────────

/** One direct child of a closing plan slated for cascade archival. */
export interface PlanCloseCascadeTarget {
  readonly doc_id: DocId;
  readonly slug: string;
  readonly kind: "task" | "handoff";
}

/** One direct child task SKIPPED by the cascade because it holds a fresh claim. */
export interface PlanCloseCascadeSkip {
  readonly doc_id: DocId;
  readonly slug: string;
  readonly reason: string;
}

/** {@link computePlanCloseCascadeTargets}'s return shape — targets to archive plus loudly-reported skips. */
export interface PlanCloseCascadePlan {
  readonly toArchive: PlanCloseCascadeTarget[];
  readonly skipped: PlanCloseCascadeSkip[];
}

/**
 * The CASCADE rule (R1): given a plan's DIRECT children (its `task` children
 * plus its `knowledge`/`sub_type: "handoff"` children — both filtered by the
 * CALLER via `parent_id === plan.id`, this function never re-derives
 * parentage), determines which are archived immediately and which are
 * skipped. Unconditional for handoffs (a plan-parented handoff's purpose is
 * definitionally complete once the plan closes — no age/supersession check,
 * unlike R2/R3). For tasks, ONLY a task holding a FRESH claim is skipped
 * (`isClaimStale` reused verbatim, never hand-rolled) — an already-terminal
 * task/handoff (archived/deprecated) is silently omitted from both lists
 * (nothing to do, not a failure).
 *
 * @param children - The plan's direct `task`/`handoff` children (pre-filtered
 *   by the caller — see module header for why this stays a separate,
 *   simpler function from {@link computeArchiveCandidates}).
 * @param nowIso - Caller-supplied current time (D10).
 * @param claimTtlMinutes - `workflow.claim_ttl_minutes`, forwarded to `isClaimStale`.
 * @returns `{toArchive, skipped}` — `toArchive` in `children` order;
 *   `skipped` only ever contains tasks (a handoff is never skipped by this rule).
 * @example
 * computePlanCloseCascadeTargets([task1, handoff1], "2026-07-27T00:00:00.000Z", 120);
 * // => { toArchive: [{doc_id: task1.id, ..., kind: "task"}, {doc_id: handoff1.id, ..., kind: "handoff"}], skipped: [] }
 */
export function computePlanCloseCascadeTargets(
  children: readonly DocRecord[],
  nowIso: string,
  claimTtlMinutes: number,
): PlanCloseCascadePlan {
  const toArchive: PlanCloseCascadeTarget[] = [];
  const skipped: PlanCloseCascadeSkip[] = [];

  for (const doc of children) {
    if (doc.deleted_at !== null) continue;
    if (TERMINAL_STATUSES.has(doc.status)) continue;

    if (doc.type === "task") {
      const claim = extractClaim(doc);
      const fresh = claim !== undefined && !isClaimStale(claim, nowIso, claimTtlMinutes);
      if (fresh) {
        skipped.push({
          doc_id: doc.id,
          slug: doc.slug,
          reason: `fresh claim held by ${claim!.by}`,
        });
        continue;
      }
      toArchive.push({ doc_id: doc.id, slug: doc.slug, kind: "task" });
    } else if (doc.type === "knowledge") {
      const parsed = knowledgeExtraSchema.safeParse(doc.extra);
      if (!parsed.success || parsed.data.sub_type !== "handoff") continue;
      toArchive.push({ doc_id: doc.id, slug: doc.slug, kind: "handoff" });
    }
  }

  return { toArchive, skipped };
}
