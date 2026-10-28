/**
 * UatService — the SOLE write orchestrator for a structured UAT verdict (SPEC-054).
 *
 * `record()` validates a `lore-uat` run's verdict payload, resolves and TYPE-CHECKS the
 * target (task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict — a verdict
 * linked to anything but a `plan` is invisible to its sole reader, see below), creates
 * the `knowledge` (sub_type `"uat"`) doc via the writer-identity-guarded
 * `CorpusService.createUatDoc` seam, and links it to the plan with an `informs` edge —
 * the authoritative binding the `plan-close` gate reads. Mirrors the `handoff` sub_type's
 * "sole-writer service composes a guarded create + a link" shape.
 *
 * Depends on NARROW injected ports (not the full `CorpusService` — services don't
 * cross-import, service/CLAUDE.md), so it is unit-testable against plain fakes with no
 * real store, mirroring `calibration-hook.ts`/`staleness-flow.ts`'s narrow-deps pattern.
 * Wired in `app.ts` to `corpusService.createUatDoc`/the shared `resolveDoc` helper
 * (`./resolve.js`, bound over the same `store` every other service resolves against —
 * NOT `corpusService.resolve`, which projects away the `type` this service now needs)/
 * `store.addLink`.
 *
 * @invariant `record()` NEVER writes `extra.uat` through any path but `createUatDoc` —
 *   the guarded seam is the sole injection site, matching SPEC-054 D5.
 * @invariant Half-failure (create ok, link fails) is LOUD: `record()` returns an `err`
 *   naming the created doc's slug and the exact `lore link` repair command, never a
 *   silent orphaned verdict doc.
 * @invariant The target-type check runs BEFORE `createUatDoc` (ORDERING is load-bearing):
 *   refusing a non-`plan` target happens with ZERO corpus side effects — no `knowledge`/
 *   `uat` doc created, no link added. A post-create refusal would leave exactly the
 *   orphan doc (and, for a nested-slug target, the nested `knowledge-uat-knowledge-…`
 *   slug) this defect used to produce.
 * @invariant DECISION (task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict):
 *   there is no supported no-plan path. The `plan-close` checkpoint (`uatP0Accepted`,
 *   `gate-predicates.ts`) is the verdict's ONLY consumer and it reads a verdict
 *   informs-linked to a `plan` doc — an ADR-only project (the reporter's real trigger)
 *   has nothing else that would ever read the verdict, and building a second consumer/
 *   storage location for an ADR-linked verdict is explicitly out of scope for this fix
 *   (would duplicate the one binding `plan-close` already owns). The refusal's only
 *   advice is therefore "create a plan and record against it" — never a `--force`/
 *   `--any-type` escape, which would just mint a guaranteed-inert record (the
 *   silently-inert-flag false-oracle vector this task explicitly forbids).
 *
 * Source: SPEC-054 §Scope, §Design D5; task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict.
 */

import {
  err,
  ok,
  uatVerdictSchema,
  type CreateDocInput,
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
  /**
   * ID-or-slug → full `DocRecord` resolver — the shared `resolveDoc` helper
   * (`./resolve.js`), bound to the live store in `app.ts`. Returns the FULL record
   * (not just the `DocId` a prior version of this port projected) because `record()`
   * must inspect `.type` to refuse a non-`plan` target before creating anything.
   */
  readonly resolveTarget: (idOrSlug: string) => Promise<Result<DocRecord, LoreError>>;
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
   * Records a UAT verdict for a plan: validate → resolve + type-check the target →
   * create the guarded `knowledge/uat` doc → link it to the plan with `informs`.
   *
   * @param planIdOrSlug - The plan the verdict accepts/rejects. MUST resolve to a `plan`
   *   doc — the `plan-close` checkpoint (`uatP0Accepted`) is the verdict's sole consumer
   *   and only ever reads a verdict informs-linked to a plan, so a non-`plan` target is
   *   refused BEFORE any doc/link is created (see module `@invariant`s).
   * @param payload - The UAT verdict (validated against `uatVerdictSchema`).
   * @param opts - `by` is the recording actor (stamped on the link's `created_by`).
   * @returns `ok({doc})` on success; `err(VALIDATION_ERROR)` for an invalid payload, an
   *   unresolvable target, a non-`plan` target (actionable — names the actual type, the
   *   `plan-close` consumer, and "create a plan" as the only supported remedy), or a LOUD
   *   half-failure (doc created, link failed — message names the repair command).
   * @example
   * // target resolves to an ADR, not a plan:
   * await uatService.record("adr-some-decision", verdict, { by: "agent:uat" });
   * // => err({ code: "VALIDATION_ERROR", field: "plan", message: '..."adr"... plan-close ...' })
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
        rule: "BR-560",
      });
    }
    const verdict: UatVerdict = parsed.data;

    // reason: resolve BEFORE createUatDoc runs (AC-4 — ordering is load-bearing). A
    // pre-existing not-found/ambiguous-prefix error from resolveTarget is returned
    // unchanged (AC-8: check order matters — a bad id/slug never reaches the new type
    // check below).
    /** @lore-site BR-561 */
    const targetResult = await this.deps.resolveTarget(planIdOrSlug);
    if (!targetResult.ok) return targetResult;
    const target = targetResult.value;

    if (target.type !== "plan") {
      // reason: task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict — the ONLY
      // consumer of a UAT verdict is the plan-close checkpoint, which reads a verdict
      // informs-linked to a plan; anything else is a guaranteed-inert write. Names both
      // the actual type and the consumer as independent lone tokens (AC-3), and states
      // the sole supported remedy (module @invariant DECISION: no --force escape, no
      // second storage location — "create a plan" is the only correct advice).
      return err({
        code: "VALIDATION_ERROR",
        field: "plan",
        message:
          `Cannot record a UAT verdict against "${planIdOrSlug}": it resolves to a ` +
          `"${target.type}" doc, not a "plan". The plan-close checkpoint is the SOLE ` +
          `consumer of a UAT verdict — it reads the latest verdict informs-linked to a ` +
          `plan doc, so a verdict attached to a ${target.type} would never be read by ` +
          `anything. There is no supported way to record a UAT verdict without a plan: ` +
          `if none exists yet, create one first (\`lore create plan --parent <spec-or-prd> ...\`) and record ` +
          `the verdict against it.`,
        rule: "BR-561",
      });
    }
    const planId = target.id;

    const input: CreateDocInput = {
      type: "knowledge",
      title: `UAT — ${planIdOrSlug}`,
      // BR-570: the verdict is filed under the plan it judges (its parent), as well as informs-linked to it below.
      parent_id: planId,
      content: renderUatContent(verdict),
      extra: { sub_type: "uat", uat: verdict },
    };
    const createResult = await this.deps.createUatDoc(input);
    if (!createResult.ok) return createResult;
    const doc = createResult.value;

    /** @lore-site BR-564 */
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
        rule: "BR-564",
      });
    }

    return ok({ doc });
  }
}
