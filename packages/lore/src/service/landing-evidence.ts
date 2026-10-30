/**
 * Module: landing-evidence — which criteria of a spec have a runner-attested pass (the gate of `lore rule apply`).
 *
 * Purpose: answer, for ONE spec, "does every criterion citing a changed rule id hold a runner-attested pass, and is
 *   every added / modified id cited by at least one criterion?" (D2: landing is evidence-gated, not status-gated).
 *   Self-reported rows, `expected-fail` rows and criteria without any run never count; an `add` / `modify` id that
 *   no criterion cites is an UNPROVEN change (nothing would ever vouch for it). A `retire` needs no evidence. A human-mode
 *   criterion counts through the newest accepting UAT verdict of its owning plan instead (AC-DCS2-18, {@link uatAccepts}); a
 *   superseded criterion is not measured at all.
 * Public surface: {@link measureLandingEvidence}, {@link uatAccepts}, {@link LandingEvidenceInput}, {@link LandingPlanView},
 *   {@link LandingShortfall}, {@link LandingMeasure}.
 * Invariants:
 *   - Pure: no store, IO or clock; every function takes already-loaded docs.
 *   - Which run belongs to which criterion is `attested-ac-runs.ts` — the SAME module `RuleStateService` uses, so
 *     the two never disagree.
 *   - A malformed `acceptance_criteria` is returned as an error value, never read as "no criteria".
 * Side-effect class: pure.
 * Source: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (D2); rule-state-service.ts (attribution).
 */

import { isAcSuperseded, specAcceptanceCriteriaSchema, type DocRecord, type UatVerdict } from "@lore/core";
import { attestedRunKey, indexLatestAttestedRuns } from "./attested-ac-runs.js";
import type { GitRunner } from "./evidence-binding.js";

/** The commit-containment facts the second evidence rule (check and corpus tasks, AC-DCS1-19) reads from git. */
export interface CommitContainment {
  /** Whether `descendant` is `ancestor` or has it in its history; `false` for an unknown `descendant` or a git failure (fail closed). */
  readonly containsCommit: (descendant: string | undefined, ancestor: string) => boolean;
  /** Whether `commit` is `branch`'s tip or in its history; `false` for an unknown `commit` or a git failure (fail closed). */
  readonly isOnBranch: (commit: string | undefined, branch: string) => boolean;
}

/**
 * The one containment measure behind "a row counts at a main commit that contains `compiled_at_commit`": both questions are
 * `git merge-base --is-ancestor`, and a commit git cannot answer for never counts.
 *
 * @param git - the repository's git runner
 * @example
 * commitContainment(git).containsCommit(rowHead, contract.compiled_at_commit); // => true when the row ran at or after the compile
 */
export function commitContainment(git: GitRunner): CommitContainment {
  const isAncestor = (ancestor: string, descendant: string): boolean => git(["merge-base", "--is-ancestor", ancestor, descendant]).ok;
  return {
    containsCommit: (descendant, ancestor) => descendant !== undefined && isAncestor(ancestor, descendant),
    isOnBranch: (commit, branch) => commit !== undefined && isAncestor(commit, branch),
  };
}

/** One recorded UAT verdict of a plan, as the landing measure reads it. */
export interface PlanUatVerdict {
  /** When the verdict doc was created; the newest verdict of a plan is the one that counts. */
  readonly created_at: string;
  readonly verdict: UatVerdict;
}

/**
 * One plan as the landing measure reads it: the plan, the specs it is parented to or implements, the criterion ids any of its tasks
 * (of any status) lists in its `ac_scope`, and its recorded UAT verdicts (AC-DCS2-18).
 */
export interface LandingPlanView {
  readonly doc: DocRecord;
  /** Ids of the specs the plan is parented to or implements. */
  readonly spec_ids: ReadonlySet<string>;
  /** Criterion ids listed in the `ac_scope` of any task of the plan, whatever the task's status. */
  readonly scoped_ac_ids: ReadonlySet<string>;
  readonly verdicts: readonly PlanUatVerdict[];
}

/**
 * Whether a human-mode criterion is accepted by a recorded UAT verdict (AC-DCS2-18).
 *
 * The criterion belongs to the plan(s) one of whose tasks, of any status, lists it in its `ac_scope` and that are parented to or
 * implement the spec; a criterion no task lists has no owning plan and is never accepted. Only the NEWEST verdict of an owning plan
 * counts: it must be `accept` (not `reject`, not `accept_with_conditions`) and list the pair `{spec, ac}` in `accepted_criteria`.
 * A verdict recorded on any other plan counts for nothing. Several owning plans: any one whose newest verdict accepts is enough.
 *
 * @param plans - every plan with its tasks' scopes and verdicts
 * @param spec - the spec that declares the criterion (matched by its slug, which `UatService.record` stores)
 * @param acId - the criterion id
 * @returns `true` when an owning plan's newest verdict accepts the criterion
 */
export function uatAccepts(plans: readonly LandingPlanView[], spec: DocRecord, acId: string): boolean {
  for (const plan of plans) {
    if (!plan.spec_ids.has(spec.id as string) || !plan.scoped_ac_ids.has(acId) || plan.verdicts.length === 0) continue;
    const newest = plan.verdicts.reduce((latest, candidate) => (candidate.created_at >= latest.created_at ? candidate : latest));
    if (newest.verdict.verdict !== "accept") continue;
    if ((newest.verdict.accepted_criteria ?? []).some((accepted) => accepted.spec === spec.slug && accepted.ac === acId)) return true;
  }
  return false;
}

/** The docs the measure reads. `specs` must hold every spec (ad-hoc evidence attribution needs all of them). */
export interface LandingEvidenceInput {
  readonly spec: DocRecord;
  readonly specs: readonly DocRecord[];
  readonly plans: readonly LandingPlanView[];
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
  /** `no-uat-verdict`: a human-mode criterion with no accepting verdict of its owning plan (AC-DCS2-18). */
  readonly reason: "no-attested-run" | "latest-attested-run-failed" | "no-uat-verdict";
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
    plans: input.plans.map((plan) => plan.doc),
    tasks: input.tasks,
  });
  const cited = new Set<string>();
  const shortfalls: LandingShortfall[] = [];
  for (const criterion of parsed.data) {
    // reason: a superseded criterion is retired (D15): it vouches for nothing and is never measured, with or without a run
    if (isAcSuperseded(criterion)) continue;
    const cites = [...new Set(criterion.cites ?? [])].filter((id) => input.changedRuleIds.has(id)).sort();
    for (const id of cites) cited.add(id);
    if (cites.length === 0) continue;
    const isHuman = criterion.verify.mode === "human";
    // reason: a criterion that cites a changed rule is met in exactly two ways: a runner-attested latest pass, or (human mode only) a
    // recorded UAT verdict of its owning plan. Skipping a human criterion would be a third way, and it is not one (AC-DCS2-18).
    if (isHuman) {
      if (uatAccepts(input.plans, input.spec, criterion.id)) continue;
    }
    const run = latest.get(attestedRunKey(input.spec.id as string, criterion.id));
    if (run === undefined) shortfalls.push({ acId: criterion.id, cites, reason: isHuman ? "no-uat-verdict" : "no-attested-run" });
    else if (run.result !== "pass") shortfalls.push({ acId: criterion.id, cites, reason: "latest-attested-run-failed" });
  }
  const unproven = [...input.provableRuleIds].filter((id) => !cited.has(id)).sort();
  return { ok: true, shortfalls, unproven };
}
