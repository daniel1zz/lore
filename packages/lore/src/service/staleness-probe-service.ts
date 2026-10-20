/**
 * StalenessProbeService — batch orchestration for `lore review --staleness`
 * (SPEC-044 §Design Decisions D4). Assembles probe candidates via the pure selection
 * layer (`@lore/core`'s `selectProbeCandidates`), probes each via the injected
 * `probeStaleness` port, and persists via the injected `recordJudgment` port — one
 * judgment + one `"staleness_probe"` audit row per candidate, actor = the commissioning
 * `by` (never the synthetic AI judge string).
 *
 * Public surface:
 *   probeBatch(opts) → assemble candidates, probe each, persist judgments (batch)
 *   probeOne(idOrSlug, opts) → single-doc probe, bypasses selection filters
 *
 * @invariant Candidate assembly issues EXACTLY ONE `store.countLinksByToIds` call and
 *   ONE `store.latestJudgmentsByDocIds` call per `probeBatch` invocation — never a
 *   per-candidate N+1 (review T5/T6). `store.findMany` is called once PER ELIGIBLE TYPE
 *   (knowledge, adr — `StoreFilters.type` is single-valued, so two calls is the floor,
 *   not an N+1 over candidates).
 * @invariant Probes NEVER mutate the probed doc (D13) — the only writes this service
 *   triggers are the judgment row and its audit entry, both written INSIDE the single
 *   `recordJudgment` port call (`action: "staleness_probe"`, `actor` = commissioning
 *   `by`). Verifiable: the probed doc's `version`/`updated_at` are byte-identical
 *   before/after a probe.
 * @invariant Two constructor-injected ports (`probeStaleness`, `recordJudgment`) —
 *   never imports `AIProviderService`/`JudgmentService` directly (services don't
 *   cross-import, `packages/lore/src/service/CLAUDE.md`).
 * @invariant Candidate order in `probeBatch`'s result matches the pure layer's sort
 *   order exactly (priority DESC, `last_confirmed_at` ASC, `id` ASC) — this service
 *   never re-sorts.
 * @invariant Partial-batch failures collect-and-continue: a per-candidate
 *   `probeStaleness`/`recordJudgment` failure is captured in that candidate's
 *   `StalenessProbeOutcome.result`, never aborts the remaining candidates (D9's
 *   collect-and-continue idiom — the CLI/T2 layer decides the exit-code policy from
 *   this collected result set).
 *
 * Side-effect class: IO (delegates to StoreInterface + injected ports)
 *
 * Source: SPEC-044 §Design Decisions D1, D2, D4, D9, D13
 */

import {
  computeStalenessPriority,
  isInvalidated,
  selectProbeCandidates,
  type CallerSurface,
  type DocId,
  type DocRecord,
  type LoreError,
  type NewReviewJudgment,
  type Result,
  type ReviewJudgment,
  type StalenessBundle,
  type StalenessCandidate,
  type StalenessCandidateInput,
  type StalenessNeighbor,
} from "@lore/core";
import { err, ok } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

// ─── Public Types ───────────────────────────────────────────────────────────

/** Injected port — bind to `aiProviderService.probeStaleness.bind(aiProviderService)`. */
export type ProbeStalenessPort = (
  bundle: StalenessBundle,
  opts?: { source?: CallerSurface | undefined },
) => Promise<Result<NewReviewJudgment, LoreError>>;

/** Injected port — bind to `judgmentService.record.bind(judgmentService)`. */
export type RecordJudgmentPort = (
  newJudgment: NewReviewJudgment,
  opts?: { auditAction?: string; auditActor?: string },
) => Promise<Result<ReviewJudgment, LoreError>>;

/** Options for {@link StalenessProbeService.probeBatch}. */
export interface ProbeBatchOpts {
  /** Commissioning actor — the audit-row actor for every probe in this batch (D4). */
  by: string;
  /** Applied AFTER the full priority sort (see `selectProbeCandidates`). Caller (CLI/MCP,
   *  T2) resolves this from `workflow.staleness.default_limit` when the user omits it. */
  limit: number;
  /** Inclusive lower bound on age_days. Caller resolves from `workflow.staleness.min_age_days`. */
  minAgeDays: number;
  source?: CallerSurface | undefined;
}

/** One probed (or attempted-to-probe) candidate's outcome. */
export interface StalenessProbeOutcome {
  doc: { id: DocId; slug: string; title: string };
  candidate: StalenessCandidate;
  result: { ok: true; judgment: ReviewJudgment } | { ok: false; error: LoreError };
}

/** Result of {@link StalenessProbeService.probeBatch}. */
export interface StalenessBatchResult {
  probes: StalenessProbeOutcome[];
  total_candidates: number;
  excluded_by_limit: number;
  skipped: { invalidated: number; too_young: number };
}

/** Doc types eligible for staleness probing (D1) — mirrors `@lore/core`'s internal set. */
const STALENESS_ELIGIBLE_TYPES = ["knowledge", "adr"] as const;

// ─── StalenessProbeService ──────────────────────────────────────────────────

export class StalenessProbeService {
  constructor(
    private readonly store: StoreInterface,
    private readonly probeStaleness: ProbeStalenessPort,
    private readonly recordJudgment: RecordJudgmentPort,
  ) {}

  /**
   * Assemble candidates (type/soft-delete/invalidated/age filters via the pure layer),
   * probe each via the injected `probeStaleness` port, and persist each successful
   * verdict via the injected `recordJudgment` port.
   *
   * @param opts - See {@link ProbeBatchOpts}
   * @returns Result<StalenessBatchResult, LoreError> — a STORE failure during candidate
   *   assembly is a hard error (nothing probed); once assembly succeeds, per-candidate
   *   probe/record failures are collected into each outcome's `result`, never abort the
   *   batch (D9 collect-and-continue)
   */
  async probeBatch(opts: ProbeBatchOpts): Promise<Result<StalenessBatchResult, LoreError>> {
    const nowIso = new Date().toISOString();

    const docsById = new Map<DocId, DocRecord>();
    for (const type of STALENESS_ELIGIBLE_TYPES) {
      const findResult = await this.store.findMany({ type });
      if (!findResult.ok) return findResult;
      for (const doc of findResult.value) docsById.set(doc.id, doc);
    }

    const docIds = Array.from(docsById.keys());

    // ONE batch call for ALL incoming-link counts (review T5/T6) — never per-candidate.
    const inDegreeResult = await this.store.countLinksByToIds(docIds);
    if (!inDegreeResult.ok) return inDegreeResult;

    // ONE batch call for the latest kind="staleness" judgment per doc (D2) — never
    // per-candidate. Only decision="approve" (holds) rows reset the confirmation clock;
    // an "escalate" (stale_candidate) row is deliberately NOT treated as a confirmation.
    const latestStalenessResult = await this.store.latestJudgmentsByDocIds(docIds, "staleness");
    if (!latestStalenessResult.ok) return latestStalenessResult;

    const inputs: StalenessCandidateInput[] = docIds.map((id) => {
      const doc = docsById.get(id)!;
      const latestStaleness = latestStalenessResult.value.get(id);
      const input: StalenessCandidateInput = {
        id: doc.id,
        type: doc.type,
        updated_at: doc.updated_at,
        extra: doc.extra,
        deleted_at: doc.deleted_at,
        in_degree: inDegreeResult.value.get(id) ?? 0,
      };
      if (latestStaleness !== undefined && latestStaleness.decision === "approve") {
        input.latest_holds_probe_at = latestStaleness.created_at;
      }
      return input;
    });

    const selection = selectProbeCandidates(inputs, nowIso, {
      min_age_days: opts.minAgeDays,
      limit: opts.limit,
    });

    const probes: StalenessProbeOutcome[] = [];
    for (const candidate of selection.candidates) {
      const doc = docsById.get(candidate.id)!;
      const outcome = await this._probeOneCandidate(doc, candidate, opts.by, opts.source);
      probes.push(outcome);
    }

    return ok({
      probes,
      total_candidates: selection.total_candidates,
      excluded_by_limit: selection.excluded_by_limit,
      skipped: selection.skipped,
    });
  }

  /**
   * Single-doc probe — BYPASSES the pure layer's selection filters (age/type-pool
   * membership beyond the eligibility check below), but STILL refuses a target that is
   * ALREADY invalidated (D9 — probing an invalidated doc is wasted spend, same rule the
   * batch pure layer applies).
   *
   * @param idOrSlug - Target document ULID or slug
   * @param opts - `{by, source?}` — `by` is the commissioning actor (audit-row actor, D4)
   * @returns Result<StalenessProbeOutcome, LoreError> — `DOC_NOT_FOUND` (target doesn't
   *   resolve), `VALIDATION_ERROR` (wrong type, or already invalidated), or the probe
   *   outcome (which may itself carry a `result: {ok: false, error}` on an AI failure —
   *   this method's own Result wraps ASSEMBLY failures only, mirroring `probeBatch`)
   */
  async probeOne(
    idOrSlug: string,
    opts: { by: string; source?: CallerSurface | undefined },
  ): Promise<Result<StalenessProbeOutcome, LoreError>> {
    const nowIso = new Date().toISOString();

    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;

    if (!(STALENESS_ELIGIBLE_TYPES as readonly string[]).includes(doc.type)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Staleness probing only applies to knowledge/adr documents; got type "${doc.type}"`,
        value: doc.type,
        rule: "BR-468",
      });
    }

    if (isInvalidated(doc, nowIso)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.validity",
        message: `Document "${doc.slug}" is already invalidated — probing it is wasted spend`,
        value: doc.id,
        rule: "BR-467",
      });
    }

    const inDegreeResult = await this.store.countLinksByToIds([doc.id]);
    if (!inDegreeResult.ok) return inDegreeResult;

    const latestStalenessResult = await this.store.latestJudgmentsByDocIds([doc.id], "staleness");
    if (!latestStalenessResult.ok) return latestStalenessResult;
    const latestStaleness = latestStalenessResult.value.get(doc.id);
    const latestHoldsProbeAt =
      latestStaleness !== undefined && latestStaleness.decision === "approve" ? latestStaleness.created_at : undefined;

    const lastConfirmedAt =
      latestHoldsProbeAt !== undefined && new Date(latestHoldsProbeAt).getTime() > new Date(doc.updated_at).getTime()
        ? latestHoldsProbeAt
        : doc.updated_at;
    const ageDays = Math.floor((new Date(nowIso).getTime() - new Date(lastConfirmedAt).getTime()) / 86_400_000);
    const inDegree = inDegreeResult.value.get(doc.id) ?? 0;

    const candidate: StalenessCandidate = {
      id: doc.id,
      in_degree: inDegree,
      age_days: ageDays,
      last_confirmed_at: lastConfirmedAt,
      priority: computeStalenessPriority({ in_degree: inDegree, age_days: ageDays }),
    };

    const outcome = await this._probeOneCandidate(doc, candidate, opts.by, opts.source);
    return ok(outcome);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Assembles a {@link StalenessBundle} for `doc`, invokes the injected `probeStaleness`
   * port, and — on success — persists via the injected `recordJudgment` port with the
   * D4 audit override (`action: "staleness_probe"`, `actor: by`). Never throws; every
   * failure mode lands in the returned outcome's `result` field.
   */
  private async _probeOneCandidate(
    doc: DocRecord,
    candidate: StalenessCandidate,
    by: string,
    source: CallerSurface | undefined,
  ): Promise<StalenessProbeOutcome> {
    const neighborsResult = await this._buildNeighbors(doc.id);
    const neighbors = neighborsResult.ok ? neighborsResult.value : [];

    const bundle: StalenessBundle = {
      doc,
      age_days: candidate.age_days,
      in_degree: candidate.in_degree,
      neighbors,
    };

    const probeResult = await this.probeStaleness(bundle, { source });
    if (!probeResult.ok) {
      return { doc: { id: doc.id, slug: doc.slug, title: doc.title }, candidate, result: { ok: false, error: probeResult.error } };
    }

    const recordResult = await this.recordJudgment(probeResult.value, {
      auditAction: "staleness_probe",
      auditActor: by,
    });
    if (!recordResult.ok) {
      return { doc: { id: doc.id, slug: doc.slug, title: doc.title }, candidate, result: { ok: false, error: recordResult.error } };
    }

    return {
      doc: { id: doc.id, slug: doc.slug, title: doc.title },
      candidate,
      result: { ok: true, judgment: recordResult.value },
    };
  }

  /**
   * Resolves `doc.id`'s incoming links to `{slug, title, link_type}` neighbor entries
   * (D5 "WHO depends on this" material) — bounded to the small set of docs actually
   * being probed (post-selection/limit), never the whole candidate pool, so the N+1
   * `store.find` per neighbor here is NOT the same class of cost `countLinksByToIds`/
   * `latestJudgmentsByDocIds` exist to eliminate (those bound the POOL-WIDE scan).
   * Neighbor CAPPING to `ai.staleness.neighbor_limit` is a prompt-rendering concern
   * (`staleness-template.ts`), not this method's job — it returns the FULL list.
   */
  private async _buildNeighbors(docId: DocId): Promise<Result<StalenessNeighbor[], LoreError>> {
    const linksResult = await this.store.findLinks(docId, "in");
    if (!linksResult.ok) return linksResult;

    const neighbors: StalenessNeighbor[] = [];
    for (const link of linksResult.value) {
      const fromResult = await this.store.find(link.from_id);
      if (!fromResult.ok) return fromResult;
      const fromDoc = fromResult.value;
      if (fromDoc === null) continue; // broken link target — silently skipped, not this method's concern
      neighbors.push({ slug: fromDoc.slug, title: fromDoc.title, link_type: link.link_type });
    }
    return ok(neighbors);
  }
}
