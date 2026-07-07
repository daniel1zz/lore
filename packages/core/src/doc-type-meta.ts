/**
 * Type-differentiated summary metadata — derives {@link DocTypeMeta} (types.ts) from a
 * DocRecord's type + `extra` fields for dashboard/CLI list-view presentation.
 *
 * Public surface:
 *   - deriveTypeMeta(doc, opts?) — the single derivation point (SPEC-036 §2 D3);
 *     no call site hand-rolls this projection.
 *
 * Invariants:
 *   - Never throws on arbitrary/legacy `extra` shapes (null, wrong types, missing
 *     fields) — degrades by OMISSION (absent field / undefined meta), never by
 *     fabricating a default value that wasn't actually derivable.
 *   - The one documented exception is `spec.kind`: an absent `extra.spec_kind` on a
 *     legacy row defaults to `"feature"`, because that is the exact create-time
 *     default `CorpusService._createImpl` already materializes for every spec created
 *     after SPEC-032 landed (see inline `// reason:` below) — completing a value the
 *     write path always intends, not fabricating one.
 *   - Reads the wall clock (`Date.now()`) ONLY to compute `task.claim_stale`, and only
 *     when `opts.claimTtlMinutes` is provided. This is a deliberate, narrow deviation
 *     from this package's usual "no wall-clock reads, caller passes nowIso" convention
 *     (see task-workflow.ts) — SPEC-036 §2's approved contract fixes the signature as
 *     `deriveTypeMeta(doc, opts?: {claimTtlMinutes?: number})` with no nowIso parameter.
 *     Tests avoid flakiness by constructing claims far in the past/future rather than
 *     near "now".
 *
 * Side-effect class: pure (except the narrow Date.now() read noted above)
 *
 * Source: SPEC-036 §2 D3, §3 AC-36-7, AC-36-10
 */

import type { DocRecord, DocTypeMeta } from "./types.js";
import { SPEC_KINDS, type SpecKind } from "./spec-kind.js";
import { decisionStatusSchema, knowledgeSubTypeSchema, planExtraSchema } from "./schemas.js";
import { extractClaim, extractEvidence, isClaimStale } from "./task-workflow.js";

/**
 * Narrows an unknown value to a valid {@link SpecKind} — `SPEC_KINDS` is the SSOT tuple.
 */
function isSpecKind(value: unknown): value is SpecKind {
  return typeof value === "string" && (SPEC_KINDS as readonly string[]).includes(value);
}

/**
 * Defensive `extra` accessor — a DocRecord's `extra` is typed `Record<string, unknown>`,
 * but corrupted/legacy store rows (or hand-built test fixtures, AC-36-10) may hand this
 * function a `null`/non-object value at runtime. Returns `{}` rather than indexing into
 * a non-object, which would throw.
 */
function safeExtra(doc: DocRecord): Record<string, unknown> {
  const extra: unknown = doc.extra;
  return extra !== null && typeof extra === "object" && !Array.isArray(extra)
    ? (extra as Record<string, unknown>)
    : {};
}

/**
 * Derives type-differentiated presentation metadata for one document.
 *
 * @param doc - Full DocRecord (needs `type` + `extra`; DocSummary alone lacks `extra`)
 * @param opts - `{ claimTtlMinutes? }` — TTL for `task.claim_stale`; when omitted,
 *   `claim_stale` is never computed (omitted from the result), never fabricated `false`
 * @returns The derived {@link DocTypeMeta}, or `undefined` when the doc's type has no
 *   meta variant (prd) or its required extra field is missing/malformed
 *
 * @example
 * deriveTypeMeta({ ...taskDoc, extra: { claim: { by: "alice", at: "…" } } }, { claimTtlMinutes: 120 })
 * // => { t: "task", claimed_by: "alice", claim_stale: false, evidence_pass: 0, evidence_fail: 0 }
 */
export function deriveTypeMeta(
  doc: DocRecord,
  opts?: { claimTtlMinutes?: number },
): DocTypeMeta | undefined {
  const extra = safeExtra(doc);

  switch (doc.type) {
    case "spec": {
      const raw = extra["spec_kind"];
      if (raw === undefined) {
        // reason: mirrors CorpusService._createImpl's create-time default (SPEC-032
        // §3.1 specExtraSchema doc comment) — every spec created after SPEC-032 landed
        // carries an explicit spec_kind; a pre-032 legacy row simply lacks the field
        // entirely. Re-applying that SAME documented default here completes a value
        // the write path always intends — it is not a fabricated guess.
        return { t: "spec", kind: "feature" };
      }
      return isSpecKind(raw) ? { t: "spec", kind: raw } : undefined;
    }

    case "adr": {
      const parsed = decisionStatusSchema.safeParse(extra["decision_status"]);
      return parsed.success ? { t: "adr", decision_status: parsed.data } : undefined;
    }

    case "knowledge": {
      const parsed = knowledgeSubTypeSchema.safeParse(extra["sub_type"]);
      return parsed.success ? { t: "knowledge", sub_type: parsed.data } : undefined;
    }

    case "plan": {
      // reason: planExtraSchema.safeParse fails the WHOLE object when `phases` is
      // present but not an array (AC-36-10 NEGATIVE case) — falling back to 0 rather
      // than throwing or guessing a count.
      const parsed = planExtraSchema.safeParse(extra);
      const phaseCount = parsed.success ? (parsed.data.phases?.length ?? 0) : 0;
      return { t: "plan", phase_count: phaseCount };
    }

    case "task": {
      const evidence = extractEvidence(doc);
      const claim = extractClaim(doc);
      const claimStale =
        claim !== undefined && opts?.claimTtlMinutes !== undefined
          ? isClaimStale(claim, new Date().toISOString(), opts.claimTtlMinutes)
          : undefined;

      return {
        t: "task",
        ...(claim !== undefined ? { claimed_by: claim.by } : {}),
        ...(claimStale !== undefined ? { claim_stale: claimStale } : {}),
        evidence_pass: evidence.filter((e) => e.result === "pass").length,
        evidence_fail: evidence.filter((e) => e.result === "fail").length,
      };
    }

    case "prd":
      return undefined;

    default:
      return undefined;
  }
}
