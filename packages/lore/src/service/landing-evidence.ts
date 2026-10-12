/**
 * Module: landing-evidence — which criteria of a spec have a runner-attested pass (the gate of `lore rule apply`).
 *
 * Purpose: answer, for ONE spec, "does every criterion citing a changed rule id hold a runner-attested pass?"
 *   (D2: landing is evidence-gated, not status-gated). Self-reported rows, `expected-fail` rows and criteria
 *   without any run never count.
 * Public surface: {@link measureLandingEvidence}, {@link LandingEvidenceInput}, {@link LandingShortfall}.
 * Invariants:
 *   - Pure: no store, IO or clock; every function takes already-loaded docs.
 *   - Only runner-attested (`attestation` present), conclusive (`pass` | `fail`) rows count; the LATEST per
 *     criterion wins. Evidence reaches a criterion by plan lineage (a task of a plan whose parent is the spec); a
 *     task with no plan lineage reaches it only when exactly ONE spec declares that criterion id — the same
 *     attribution rule `RuleStateService` applies, so the two never disagree about what a run belongs to.
 *   - A malformed `acceptance_criteria` is returned as an error value, never read as "no criteria".
 * Side-effect class: pure.
 * Source: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (D2); rule-state-service.ts (attribution).
 */

import { extractEvidence, specAcceptanceCriteriaSchema, type DocRecord, type EvidenceEntry } from "@lore/core";

/** The docs the measure reads. `specs` must hold every spec (ad-hoc evidence attribution needs all of them). */
export interface LandingEvidenceInput {
  readonly spec: DocRecord;
  readonly specs: readonly DocRecord[];
  readonly plans: readonly DocRecord[];
  readonly tasks: readonly DocRecord[];
  /** Rule ids the unlanded change set changes (adds, modifies, retires). */
  readonly changedRuleIds: ReadonlySet<string>;
}

/** One criterion citing a changed id that has no runner-attested pass, and why. */
export interface LandingShortfall {
  readonly acId: string;
  /** The changed ids this criterion cites, sorted. */
  readonly cites: readonly string[];
  readonly reason: "no-attested-run" | "latest-attested-run-failed";
}

type Conclusive = EvidenceEntry & { result: "pass" | "fail" };

function isConclusiveAttested(entry: EvidenceEntry): entry is Conclusive {
  return entry.attestation !== undefined && (entry.result === "pass" || entry.result === "fail");
}

function declaredAcIdsOf(spec: DocRecord): string[] {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  return parsed.success ? parsed.data.map((c) => c.id) : [];
}

/** The latest attested conclusive run of each criterion of `input.spec`, keyed by criterion id. */
function latestRunsOfSpec(input: LandingEvidenceInput): Map<string, Conclusive> {
  const planParent = new Map(input.plans.map((p) => [p.id as string, p.parent_id as string | null]));
  const ownersOfAc = new Map<string, string[]>();
  for (const spec of input.specs) {
    for (const acId of declaredAcIdsOf(spec)) ownersOfAc.set(acId, [...(ownersOfAc.get(acId) ?? []), spec.id as string]);
  }
  const latest = new Map<string, Conclusive>();
  const offer = (entry: Conclusive): void => {
    const acRef = entry.ac_ref as string;
    const current = latest.get(acRef);
    if (current === undefined || entry.recorded_at >= current.recorded_at) latest.set(acRef, entry);
  };
  for (const task of input.tasks) {
    const planId = task.extra["plan_id"];
    const hasLineage = typeof planId === "string";
    const lineageSpecId = hasLineage ? planParent.get(planId) ?? null : null;
    for (const entry of extractEvidence(task)) {
      if (entry.ac_ref === undefined || !isConclusiveAttested(entry)) continue;
      if (hasLineage) {
        if (lineageSpecId === (input.spec.id as string)) offer(entry);
        continue;
      }
      const owners = ownersOfAc.get(entry.ac_ref) ?? [];
      if (owners.length === 1 && owners[0] === (input.spec.id as string)) offer(entry);
    }
  }
  return latest;
}

/**
 * The criteria of `input.spec` that cite a changed id and lack a runner-attested pass.
 *
 * @returns `ok: true` with the shortfalls (empty = the change set may land); `ok: false` with the reason when the
 *   stored `acceptance_criteria` cannot be read (the gate never guesses).
 * @example
 * measureLandingEvidence({ spec, specs, plans, tasks, changedRuleIds: new Set(["BR-9"]) });
 * // => { ok: true, shortfalls: [{ acId: "AC-1", cites: ["BR-9"], reason: "no-attested-run" }] }
 */
export function measureLandingEvidence(
  input: LandingEvidenceInput,
): { ok: true; shortfalls: LandingShortfall[] } | { ok: false; reason: string } {
  const raw = input.spec.extra["acceptance_criteria"];
  if (raw === undefined) return { ok: true, shortfalls: [] };
  const parsed = specAcceptanceCriteriaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `the stored acceptance_criteria of ${input.spec.slug} is invalid: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  }
  const latest = latestRunsOfSpec(input);
  const shortfalls: LandingShortfall[] = [];
  for (const criterion of parsed.data) {
    const cites = [...new Set(criterion.cites ?? [])].filter((id) => input.changedRuleIds.has(id)).sort();
    if (cites.length === 0) continue;
    const run = latest.get(criterion.id);
    if (run === undefined) shortfalls.push({ acId: criterion.id, cites, reason: "no-attested-run" });
    else if (run.result !== "pass") shortfalls.push({ acId: criterion.id, cites, reason: "latest-attested-run-failed" });
  }
  return { ok: true, shortfalls };
}
