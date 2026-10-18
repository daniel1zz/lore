/**
 * Module: ac-exemption-service — criterion exemptions: an uncited acceptance criterion is excused
 * from the citation gate for a bounded time, with a stated reason, a named grantor and a hard cap.
 *
 * Purpose: make "exempt" a deliberate, auditable, scarce act rather than the easy way out of citing a rule.
 * Public surface: {@link AcExemptionService} (`grant`, `list`, `counts`), {@link EXEMPTION_CAP_RATIO},
 *   {@link maxActiveExemptions}, {@link AcExemptionView}, {@link AcExemptionCounts}.
 * Invariants:
 *   - A grant needs a non-blank reason, a non-blank actor and a parseable FUTURE expiry; the AC must exist on the spec.
 *   - Active exemptions never exceed floor(10% x live criteria); the count-then-insert is one store
 *     transaction (`insertAcExemptionCapped`), so concurrent grants cannot overfill the cap.
 *   - "Live criteria" = acceptance criteria across all non-deleted spec docs; an exemption is active iff expiresAt > now.
 * Side-effect class: IO (the injected store); the clock is injectable.
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation C4 "Exemptions" (AC-BLS2-10).
 */

import { err, ok, specAcceptanceCriteriaSchema } from "@lore/core";
import type { DocRecord, LoreError, Result } from "@lore/core";
import type { AcExemptionRow, StoreInterface } from "../store/store-interface.js";
import { createHash } from "node:crypto";
import { resolveDoc } from "./resolve.js";
import type { OverrideDecisionPort } from "./override-decision.js";

// reason: the 10% budget has ONE home, `ac-cite-gate.ts`, because the citation gate's feeding pack reports
// the remaining headroom and must never disagree with what `grant` enforces. Re-exported so every existing
// importer of these two names is unchanged.
import { countLiveCriteria, maxActiveExemptions } from "./ac-cite-gate.js";
export { EXEMPTION_CAP_RATIO, maxActiveExemptions } from "./ac-cite-gate.js";

/** Input of {@link AcExemptionService.grant}. */
export interface GrantAcExemptionInput {
  specIdOrSlug: string;
  acId: string;
  /** Why this criterion cannot cite a rule yet. Required, non-blank. */
  reason: string;
  /** ISO 8601 instant, strictly in the future. Required. */
  expiresAt: string;
  /** Actor granting the exemption. Required, non-blank. */
  by: string;
}

/** One exemption as shown to callers; `state` is derived from the `now` of the query. */
export interface AcExemptionView {
  specId: string;
  acId: string;
  reason: string;
  expiresAt: string;
  by: string;
  state: "active" | "expired";
}

/** Result of {@link AcExemptionService.counts}. */
export interface AcExemptionCounts {
  active: number;
  expired: number;
  liveCriteria: number;
  /** `active / liveCriteria`, 0 when there are no live criteria. */
  ratio: number;
}

function validationError(field: string, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, value } as LoreError;
}

function viewOf(row: AcExemptionRow, nowIso: string): AcExemptionView {
  return {
    specId: row.doc_id,
    acId: row.ac_id,
    reason: row.reason,
    expiresAt: row.expires_at,
    by: row.granted_by,
    state: row.expires_at > nowIso ? "active" : "expired",
  };
}

/** Count the validated criteria declared on one spec doc (0 when absent or schema-invalid, like `lore ac list`). */
function criteriaOf(spec: DocRecord) {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  return parsed.success ? parsed.data : [];
}

/**
 * Grants, lists and counts criterion exemptions.
 *
 * @example
 * const svc = new AcExemptionService(store);
 * await svc.grant({ specIdOrSlug: "spec-x", acId: "AC-1", reason: "no rule yet", expiresAt: "2027-01-01T00:00:00Z", by: "agent:me" });
 */
export class AcExemptionService {
  constructor(
    private readonly store: StoreInterface,
    private readonly clock: () => Date = () => new Date(),
    /** AC-AU-7: decide() seam of the grant; absent (bare unit constructions) = ungated. */
    private readonly overrideDecisions?: OverrideDecisionPort,
  ) {}

  /**
   * Grant one exemption.
   *
   * @throws (as `Result`) VALIDATION_ERROR — blank reason/actor, missing/unparseable/past expiry, unknown AC,
   *   already-active exemption, or the 10% cap is full (message names the cap); DOC_NOT_FOUND — unknown spec.
   */
  async grant(input: GrantAcExemptionInput): Promise<Result<AcExemptionRow, LoreError>> {
    // reason: inputs arrive from CLI/JSON as possibly-undefined despite the type; a missing one must fail loud here.
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason === "") return err(validationError("reason", "An exemption needs a non-blank --reason."));
    const by = typeof input.by === "string" ? input.by.trim() : "";
    if (by === "") return err(validationError("by", "An exemption needs a named grantor (--by)."));
    if (typeof input.expiresAt !== "string" || input.expiresAt.trim() === "") {
      return err(validationError("expires_at", "An exemption needs an expiry (--expires <ISO date>)."));
    }
    const expiresMs = Date.parse(input.expiresAt);
    if (Number.isNaN(expiresMs)) {
      return err(validationError("expires_at", `Expiry "${input.expiresAt}" is not a parseable ISO date.`, input.expiresAt));
    }
    const now = this.clock();
    if (expiresMs <= now.getTime()) {
      return err(validationError("expires_at", `Expiry "${input.expiresAt}" is not in the future.`, input.expiresAt));
    }

    const spec = await resolveDoc(this.store, input.specIdOrSlug);
    if (!spec.ok) return spec;
    if (spec.value.type !== "spec") {
      return err(validationError("type", `Expected a spec document; got type '${spec.value.type}'`, spec.value.type));
    }
    if (!criteriaOf(spec.value).some((c) => c.id === input.acId)) {
      return err(validationError("ac_id", `Spec ${spec.value.slug} declares no criterion "${input.acId}".`, input.acId));
    }

    // reason: AC-AU-7 — granting an exemption is DECIDED (class ac-exempt), not self-granted; after every input check,
    // before the capped insert. The subject version binds reason + expiry so a human accepts THIS exemption.
    if (this.overrideDecisions !== undefined) {
      const decided = await this.overrideDecisions.requireAuto({
        classId: "ac-exempt",
        subject: {
          id: `${spec.value.slug}#${input.acId}`,
          version: createHash("sha256").update(`${reason}\n${new Date(expiresMs).toISOString()}`).digest("hex").slice(0, 16),
        },
        summary: `ac exempt ${spec.value.slug} ${input.acId}`,
      });
      if (!decided.ok) return decided;
    }

    const live = await this.countLiveCriteria();
    if (!live.ok) return live;
    const nowIso = now.toISOString();
    return this.store.insertAcExemptionCapped(
      {
        doc_id: spec.value.id,
        ac_id: input.acId,
        reason,
        expires_at: new Date(expiresMs).toISOString(),
        granted_by: by,
        granted_at: nowIso,
      },
      { liveCriteria: live.value, maxActive: maxActiveExemptions(live.value), now: nowIso },
    );
  }

  /** Every exemption (active and expired) with its state at `now` (default: the clock). */
  async list(opts: { now?: string } = {}): Promise<Result<AcExemptionView[], LoreError>> {
    const nowIso = opts.now ?? this.clock().toISOString();
    const rows = await this.store.listAcExemptions();
    if (!rows.ok) return rows;
    return ok(rows.value.map((row) => viewOf(row, nowIso)));
  }

  /** Active/expired exemption counts against the live-criteria total at `now`. */
  async counts(opts: { now: string }): Promise<Result<AcExemptionCounts, LoreError>> {
    const rows = await this.store.listAcExemptions();
    if (!rows.ok) return rows;
    const live = await this.countLiveCriteria();
    if (!live.ok) return live;
    const active = rows.value.filter((r) => r.expires_at > opts.now).length;
    return ok({
      active,
      expired: rows.value.length - active,
      liveCriteria: live.value,
      ratio: live.value === 0 ? 0 : active / live.value,
    });
  }

  private async countLiveCriteria(): Promise<Result<number, LoreError>> {
    const specs = await this.store.findMany({ type: "spec" });
    if (!specs.ok) return specs;
    return ok(countLiveCriteria(specs.value));
  }
}
