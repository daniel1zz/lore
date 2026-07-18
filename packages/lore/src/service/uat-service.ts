/**
 * UatService — the SOLE write orchestrator for a structured UAT verdict (SPEC-054).
 *
 * `record()` validates a `lore-uat` run's verdict payload, creates the `knowledge`
 * (sub_type `"uat"`) doc via the writer-identity-guarded `CorpusService.createUatDoc`
 * seam, and links it to the accepted plan with an `informs` edge — the authoritative
 * binding the `plan-close` gate reads. Mirrors the `handoff` sub_type's "sole-writer
 * service composes a guarded create + a link" shape.
 *
 * Depends on NARROW injected ports (not the full `CorpusService` — services don't
 * cross-import, service/CLAUDE.md), so it is unit-testable against plain fakes with no
 * real store, mirroring `calibration-hook.ts`/`staleness-flow.ts`'s narrow-deps pattern.
 * Wired in `app.ts` to `corpusService.createUatDoc`/`corpusService.resolve`/`store.addLink`.
 *
 * @invariant `record()` NEVER writes `extra.uat` through any path but `createUatDoc` —
 *   the guarded seam is the sole injection site, matching SPEC-054 D5.
 * @invariant Half-failure (create ok, link fails) is LOUD: `record()` returns an `err`
 *   naming the created doc's slug and the exact `lore link` repair command, never a
 *   silent orphaned verdict doc.
 *
 * Source: SPEC-054 §Scope, §Design D5.
 */

import {
  err,
  ok,
  uatVerdictSchema,
  type CreateDocInput,
  type DocId,
  type DocRecord,
  type LinkRecord,
  type LoreError,
  type Result,
  type UatVerdict,
  renderUatContent,
} from "@lore/core";

/** Narrow injected ports UatService needs — bound in `app.ts` (see module header). */
export interface UatServiceDeps {
  /** Writer-identity-guarded UAT-doc creation seam (`corpusService.createUatDoc`). */
  readonly createUatDoc: (input: CreateDocInput) => Promise<Result<DocRecord, LoreError>>;
  /** ID-or-slug → DocId resolver (`corpusService.resolve`). */
  readonly resolveDocId: (idOrSlug: string) => Promise<Result<DocId, LoreError>>;
  /** Link inserter (`store.addLink`). */
  readonly addLink: (link: LinkRecord) => Promise<Result<LinkRecord, LoreError>>;
  /** Current-time source (`() => new Date().toISOString()` in production) — injectable for
   *  deterministic tests. */
  readonly now: () => string;
}

/** Result of a successful `UatService.record`. */
export interface UatRecordResult {
  /** The created UAT verdict doc. */
  readonly doc: DocRecord;
}

/**
 * Stateless service — holds only its injected ports. All persistent state lives behind
 * `createUatDoc`/`addLink`.
 */
export class UatService {
  constructor(private readonly deps: UatServiceDeps) {}

  /**
   * Records a UAT verdict for a plan: validate → create the guarded `knowledge/uat` doc →
   * link it to the plan with `informs`.
   *
   * @param planIdOrSlug - The plan the verdict accepts/rejects.
   * @param payload - The UAT verdict (validated against `uatVerdictSchema`).
   * @param opts - `by` is the recording actor (stamped on the link's `created_by`).
   * @returns `ok({doc})` on success; `err(VALIDATION_ERROR)` for an invalid payload, an
   *   unresolvable plan, or a LOUD half-failure (doc created, link failed — message names
   *   the repair command).
   */
  async record(
    planIdOrSlug: string,
    payload: unknown,
    opts: { by: string },
  ): Promise<Result<UatRecordResult, LoreError>> {
    const parsed = uatVerdictSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue ? String(issue.path.join(".")) : "uat",
        message: `Invalid UAT verdict payload: ${issue?.message ?? "unknown"}`,
      });
    }
    const verdict: UatVerdict = parsed.data;

    const planIdResult = await this.deps.resolveDocId(planIdOrSlug);
    if (!planIdResult.ok) return planIdResult;
    const planId = planIdResult.value;

    const input: CreateDocInput = {
      type: "knowledge",
      title: `UAT — ${planIdOrSlug}`,
      content: renderUatContent(verdict),
      extra: { sub_type: "uat", uat: verdict },
    };
    const createResult = await this.deps.createUatDoc(input);
    if (!createResult.ok) return createResult;
    const doc = createResult.value;

    const linkResult = await this.deps.addLink({
      from_id: doc.id,
      to_id: planId,
      link_type: "informs",
      created_at: this.deps.now(),
      created_by: opts.by,
    });
    if (!linkResult.ok && linkResult.error.code !== "DUPLICATE_LINK") {
      // reason: LOUD half-failure — the verdict doc EXISTS but is unlinked, so the
      // plan-close gate can't find it. Name the exact repair rather than silently
      // orphaning it (mirrors supersede-flow's loud half-failure posture).
      return err({
        code: "VALIDATION_ERROR",
        field: "informs_link",
        message:
          `UAT verdict doc created (${doc.slug}) but linking it to plan "${planIdOrSlug}" ` +
          `failed: ${linkResult.error.code}. Repair: ` +
          `\`lore link ${doc.slug} ${planIdOrSlug} --type informs\``,
      });
    }

    return ok({ doc });
  }
}
