/**
 * Pure argument validation + exemption rendering for `lore plan exempt-*`
 * (SPEC-069 AC-069-9, AC-069-13's naming half).
 *
 * Module purpose: `commands/plan.ts` must refuse a blank `--reason` or an
 * off-taxonomy `--kind` as a CLI USAGE error (exit 2) BEFORE any store is
 * opened — mirroring `commands/outline.ts`'s `exempt` convention, where a
 * missing reason never reaches the service (which would surface it as
 * `VALIDATION_ERROR`, exit 4). These checks live here, not inline in the
 * command, for the same reason `create-task-validation.ts` and
 * `decision-status-validation.ts` exist: they are the units a vitest suite can
 * exercise directly (`commands/*.ts` sit behind `bun:sqlite`).
 *
 * Public surface:
 *   - `ATTESTATION_EXEMPT_KIND_VALUES` — the permitted `--kind` set, DERIVED
 *     from `attestationExemptKindSchema` (never a restated literal union).
 *   - `PLAN_EXEMPT_USAGE_EXIT_CODE` — the one exit code these refusals use.
 *   - `checkExemptAttestationArgs` / `checkExemptAssessmentFreshnessArgs` —
 *     pure classifiers: accepted (with the narrowed values) or refused (with
 *     the exact stderr message).
 *   - `formatAttestationExemptionNotice` — renders the "this close was allowed
 *     by an exemption" line, or `null` when no ACTIVE exemption is present.
 *
 * @invariant The permitted-kind set has exactly ONE definition site
 *   (`attestationExemptKindSchema`, `@lore/core`). A locally restated union
 *   would silently drift from the gate's own `attestationExemptKindValid`.
 * @invariant `formatAttestationExemptionNotice`'s ACTIVENESS rule mirrors the
 *   plan-close gate's: flag `=== true` AND a non-blank reason AND a
 *   schema-valid kind. Any weaker rule would announce an exemption the gate
 *   does not honour (a bare `attestation_exempt: true` is NOT exempt) —
 *   telling the operator the close was excused when it was not. The gate's own
 *   copy of this rule lives in `CorpusService.set`'s plan-close block
 *   (sentinel-delimited as the AC-069-12 scan region) and in
 *   `gate-predicates.ts::attestationExemptKindValid`; AC-069-13 pins the two
 *   together end to end by asserting the SAME plan that closes WITH the
 *   exemption is denied WITHOUT it.
 *
 * Side-effect class: PURE. No IO, no wall-clock, no process state.
 *
 * Source: SPEC-069 §Design Decisions D1; spec-verify-reachability-plan-promote-
 *         early-warning §Scope M3 (typed kind); SPEC-003 §5 (exit codes)
 */

import { attestationExemptKindSchema } from "@lore/core";
import type { AttestationExemptKind } from "@lore/core";

/**
 * CLI usage-error exit code for these refusals (SPEC-003 §5: 2 = usage error).
 * Exported so a test can observe the exact value the command sets rather than
 * re-asserting a magic number that could drift from the command's own literal.
 */
export const PLAN_EXEMPT_USAGE_EXIT_CODE = 2;

/**
 * The permitted `--kind` values, derived from the schema — the CLI's help text,
 * its refusal message, and the gate's validation therefore cannot disagree.
 */
export const ATTESTATION_EXEMPT_KIND_VALUES: readonly AttestationExemptKind[] =
  attestationExemptKindSchema.options;

// ─── Argument classification ─────────────────────────────────────────────────

/** A refused invocation, carrying the exact stderr text. */
export interface PlanExemptArgsRefused {
  readonly ok: false;
  readonly message: string;
}

/** An accepted `exempt-attestation` invocation, with values narrowed. */
export interface AttestationExemptArgsAccepted {
  readonly ok: true;
  readonly reason: string;
  readonly kind: AttestationExemptKind;
}

/** An accepted `exempt-assessment-freshness` invocation. */
export interface AssessmentFreshnessExemptArgsAccepted {
  readonly ok: true;
  readonly reason: string;
}

/**
 * Classifies `lore plan exempt-attestation`'s `--reason`/`--kind` pair.
 *
 * Both flags are REQUIRED and both are refused at the CLI tier. `--kind` is
 * required (rather than defaulted to `"other"`) deliberately: a default would
 * make every untyped exemption silently land in the catch-all bucket, which is
 * the silent-fallback shape `attestationExemptKindValid` exists to ban.
 *
 * @param raw - `{reason, kind}` straight off citty's parsed args (unknown-typed
 *   — citty yields `undefined` for an omitted flag and can yield non-strings)
 * @returns Accepted with narrowed `{reason, kind}`, or refused with the message
 * @example
 * checkExemptAttestationArgs({ reason: "no oracle", kind: "no-oracle" });
 * // => { ok: true, reason: "no oracle", kind: "no-oracle" }
 * @example
 * checkExemptAttestationArgs({ reason: "  ", kind: "no-oracle" });
 * // => { ok: false, message: "Error: --reason is required and must not be blank." }
 */
export function checkExemptAttestationArgs(raw: {
  readonly reason?: unknown;
  readonly kind?: unknown;
}): AttestationExemptArgsAccepted | PlanExemptArgsRefused {
  const reason = checkReason(raw.reason);
  if (!reason.ok) return reason;

  if (raw.kind === undefined || raw.kind === null || raw.kind === "") {
    return {
      ok: false,
      message:
        `Error: --kind is required. An exemption with no declared type is the ` +
        `silent-fallback shape the plan-close gate refuses. Permitted values: ` +
        `${ATTESTATION_EXEMPT_KIND_VALUES.join(" | ")}.`,
    };
  }

  const parsed = attestationExemptKindSchema.safeParse(raw.kind);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        `Error: --kind '${String(raw.kind)}' is not a permitted exemption kind. ` +
        `Permitted values: ${ATTESTATION_EXEMPT_KIND_VALUES.join(" | ")}.`,
    };
  }

  return { ok: true, reason: reason.reason, kind: parsed.data };
}

/**
 * Classifies `lore plan exempt-assessment-freshness`'s `--reason` (SPEC-106 D4
 * declares no kind taxonomy for this predicate's exemption).
 *
 * @param raw - `{reason}` straight off citty's parsed args
 * @returns Accepted with the narrowed reason, or refused with the message
 */
export function checkExemptAssessmentFreshnessArgs(raw: {
  readonly reason?: unknown;
}): AssessmentFreshnessExemptArgsAccepted | PlanExemptArgsRefused {
  const reason = checkReason(raw.reason);
  if (!reason.ok) return reason;
  return { ok: true, reason: reason.reason };
}

/** Shared non-blank `--reason` check — the one place its refusal text lives. */
function checkReason(
  raw: unknown,
): { readonly ok: true; readonly reason: string } | PlanExemptArgsRefused {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {
      ok: false,
      message:
        "Error: --reason is required and must not be blank. An exemption with no " +
        "justification is never authorable — the reason IS the audit trail.",
    };
  }
  return { ok: true, reason: raw };
}

// ─── Close-output rendering ──────────────────────────────────────────────────

/**
 * Renders the notice naming an ACTIVE attestation exemption on a plan, or
 * `null` when the plan carries none.
 *
 * Why this exists (SPEC-069 §Mechanism required item 3): an exemption that
 * silently allows a close is the same failure as a vacuous predicate — the
 * operator sees a plan archive cleanly and never learns that a declared
 * exemption, not real attested evidence, is what let it through. `commands/set.ts`
 * prints this on every successful plan → `archived` transition.
 *
 * The activeness rule is deliberately the GATE's rule, not a looser one — see
 * this module's second `@invariant`.
 *
 * @param extra - The plan's `extra` object (unknown-typed; legacy/malformed
 *   values must degrade to `null`, never throw)
 * @returns The notice line, or `null` when no active exemption is present
 * @example
 * formatAttestationExemptionNotice({ attestation_exempt: true, attestation_exempt_reason: "no oracle", attestation_exempt_kind: "no-oracle" });
 * // => "Closed under an ATTESTATION EXEMPTION [no-oracle]: no oracle …"
 * @example
 * formatAttestationExemptionNotice({ attestation_exempt: true }); // => null (no reason ⇒ the gate does not honour it either)
 */
export function formatAttestationExemptionNotice(extra: unknown): string | null {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return null;
  const record = extra as Record<string, unknown>;

  if (record["attestation_exempt"] !== true) return null;

  const reason = record["attestation_exempt_reason"];
  if (typeof reason !== "string" || reason.trim().length === 0) return null;

  const kind = attestationExemptKindSchema.safeParse(record["attestation_exempt_kind"]);
  if (!kind.success) return null;

  return (
    `Closed under an ATTESTATION EXEMPTION [${kind.data}]: ${reason}\n` +
    `  (the plan-close attestation floor was not measured against evidence — ` +
    `this exemption is what allowed the close; see \`lore log\` for who declared it.)`
  );
}
