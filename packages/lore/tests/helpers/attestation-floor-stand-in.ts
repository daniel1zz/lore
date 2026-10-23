/**
 * Test helper: the stamp-axis and attestation read the plan-close `attestationFloor` predicate used to expose.
 *
 * The predicate left `gate-predicates.ts` when the milestone review became the only plan-close check (BR-1372). What
 * SPEC-143's stamp-currency tests (AC-CT-3, AC-CT-9) pin is the derivation underneath it — `deriveAttestationSummary`
 * in `@lore/core`, which `lore done`'s floors and the dashboard evidence panel still use. This stand-in reads that
 * derivation the way the predicate did (zero evidence is "not applicable", an unmet floor is a refusal) so those
 * tests keep their verdict vocabulary without a gate that no longer exists.
 *
 * Side-effect class: pure.
 */

import { deriveAttestationSummary, type AcCoverageFact, type TaskAttestationInfo } from "@lore/core";

export const ATTESTATION_FLOOR_REASON = "ATTESTATION_FLOOR_NOT_MET";
export const ATTESTATION_FLOOR_FIELD = "attestation-floor";

/** Not-applicable (no evidence), refused (floor unmet) or ok, from the core attestation derivation alone. */
export function attestationFloor(
  tasks: readonly TaskAttestationInfo[] | undefined,
  minRatio: number | null,
  referent: string,
  acCoverage: readonly AcCoverageFact[],
  _declaredScope?: unknown,
):
  | { notApplicable: true; reason: "no-evidence"; referent: string }
  | { ok: false; reason: string; field: string }
  | { ok: true } {
  const summary = deriveAttestationSummary(tasks ?? [], minRatio, acCoverage);
  if (summary.total_evidence === 0) return { notApplicable: true, reason: "no-evidence", referent };
  if (!summary.meets_floor) return { ok: false, reason: ATTESTATION_FLOOR_REASON, field: ATTESTATION_FLOOR_FIELD };
  return { ok: true };
}
