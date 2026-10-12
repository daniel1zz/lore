/**
 * Module: landing-evidence — which criteria of a spec have a runner-attested pass (the gate of `lore rule apply`).
 *
 * Purpose: answer, for ONE spec, "does every criterion citing a changed rule id hold a runner-attested pass, and is
 *   every added / modified id cited by at least one criterion?" (D2: landing is evidence-gated, not status-gated).
 *   Self-reported rows, `expected-fail` rows and criteria without any run never count; an `add` / `modify` id that
 *   no criterion cites is an UNPROVEN change (nothing would ever vouch for it). A `retire` needs no evidence.
 * Public surface: {@link measureLandingEvidence}, {@link LandingEvidenceInput}, {@link LandingShortfall},
 *   {@link LandingMeasure}.
 * Invariants:
 *   - Pure: no store, IO or clock; every function takes already-loaded docs.
 *   - Which run belongs to which criterion is `attested-ac-runs.ts` — the SAME module `RuleStateService` uses, so
 *     the two never disagree.
 *   - A malformed `acceptance_criteria` is returned as an error value, never read as "no criteria".
 * Side-effect class: pure.
 * Source: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (D2); rule-state-service.ts (attribution).
 */

import { specAcceptanceCriteriaSchema, type DocRecord } from "@lore/core";
import { attestedRunKey, indexLatestAttestedRuns } from "./attested-ac-runs.js";

/** The docs the measure reads. `specs` must hold every spec (ad-hoc evidence attribution needs all of them). */
export interface LandingEvidenceInput {
  readonly spec: DocRecord;
  readonly specs: readonly DocRecord[];
  readonly plans: readonly DocRecord[];
  readonly tasks: readonly DocRecord[];
  /** Rule ids the unlanded change set changes (adds, modifies, retires): a criterion citing one needs a pass. */
  readonly changedRuleIds: ReadonlySet<string>;
  /** The subset (adds and modifies) that some criterion must cite; a retire is not in it. */
  readonly provableRuleIds: ReadonlySet<string>;
}

/** One criterion citing a changed id that has no runner-attested pass, and why. */
export interface LandingShortfall {
  readonly acId: string;
  /** The changed ids this criterion cites, sorted. */
  readonly cites: readonly string[];
  readonly reason: "no-attested-run" | "latest-attested-run-failed";
}

/** What blocks landing: criteria without a pass, and add/modify ids no criterion cites. Both empty = may land. */
export interface LandingMeasure {
  readonly shortfalls: LandingShortfall[];
  /** Sorted ids of `add` / `modify` entries cited by no criterion of the spec. */
  readonly unproven: string[];
}

function declaredAcIdsOf(spec: DocRecord): string[] {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  return parsed.success ? parsed.data.map((c) => c.id) : [];
}

/**
 * @returns `ok: true` with the {@link LandingMeasure}; `ok: false` with the reason when the stored
 *   `acceptance_criteria` cannot be read (the gate never guesses).
 * @example
 * measureLandingEvidence({ spec, specs, plans, tasks, changedRuleIds: new Set(["BR-9"]), provableRuleIds: new Set(["BR-9"]) });
 * // => { ok: true, shortfalls: [], unproven: ["BR-9"] }   (no criterion cites BR-9)
 */
export function measureLandingEvidence(input: LandingEvidenceInput): ({ ok: true } & LandingMeasure) | { ok: false; reason: string } {
  const raw = input.spec.extra["acceptance_criteria"];
  const parsed = raw === undefined ? { success: true as const, data: [] } : specAcceptanceCriteriaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `the stored acceptance_criteria of ${input.spec.slug} is invalid: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  }
  const { latest } = indexLatestAttestedRuns({
    specs: input.specs.map((spec) => ({ id: spec.id as string, acIds: declaredAcIdsOf(spec) })),
    plans: input.plans,
    tasks: input.tasks,
  });
  const cited = new Set<string>();
  const shortfalls: LandingShortfall[] = [];
  for (const criterion of parsed.data) {
    const cites = [...new Set(criterion.cites ?? [])].filter((id) => input.changedRuleIds.has(id)).sort();
    for (const id of cites) cited.add(id);
    if (cites.length === 0) continue;
    const run = latest.get(attestedRunKey(input.spec.id as string, criterion.id));
    if (run === undefined) shortfalls.push({ acId: criterion.id, cites, reason: "no-attested-run" });
    else if (run.result !== "pass") shortfalls.push({ acId: criterion.id, cites, reason: "latest-attested-run-failed" });
  }
  const unproven = [...input.provableRuleIds].filter((id) => !cited.has(id)).sort();
  return { ok: true, shortfalls, unproven };
}
