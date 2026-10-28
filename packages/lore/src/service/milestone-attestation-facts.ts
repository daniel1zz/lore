/**
 * Criteria attestation as a milestone-review fact: `correctness_vs_acs` decided from evidence bound to main (BR-1498).
 *
 * Purpose: for every live criterion in a plan's task scopes, say pass / fail / not-measured from the attestations whose
 *   `state_stamp.head_sha` is the landing commit of the task whose scope holds the criterion, or a later commit on main's
 *   first-parent history. An attestation on a worktree commit, or on main before the task landed, never decides (pass or
 *   fail). Also: the post-landing step that attests the landed tasks' script criteria at their landing commit so that no
 *   criterion stays not-measured merely because nobody re-ran it on main.
 * Public surface: {@link planCriterionScopes}, {@link attestationRowsOf}, {@link attestationFacts},
 *   {@link attestLandedCriteria}, {@link CriterionScope}, {@link AttestationRow}, {@link MainFirstParentPort},
 *   {@link LandingAttesterPort}, {@link AttestationFacts}, {@link LandingAttestationReport}.
 * Invariants:
 *   - Binding is decided by commit ancestry on main's first-parent history (no tree hash is recorded). An ancestry that
 *     cannot be read makes the criterion `not-measured` with the cause, never pass.
 *   - Only runner-attested, conclusive (`pass` | `fail`) rows carrying a `state_stamp` count; a row without a stamp
 *     (dirty tree, state moved, no git) is unbound and never decides.
 *   - The latest bound row (by `recorded_at`) decides; its id (`<task-slug>@<recorded_at>`) is exposed in
 *     `deciding_ids` so the fingerprint can hash it (A6).
 *   - AI-mode criteria are listed for the judgment layer, human-mode ones are left to UAT; superseded criteria are skipped.
 *   - A plan with no live script or AI criterion in scope is `not-measured` (named), never a vacuous pass.
 *   - `attestLandedCriteria` attests only criteria whose landing is on main's first-parent history (an attestation at any
 *     other commit would not count), one port call per landing commit; a failure of one landing does not stop the others.
 * Side-effect class: pure except through the injected ports (`attestLandedCriteria` writes attested evidence via its port).
 *
 * Reference: Bazel action cache (a result is valid only for the inputs it was computed at).
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-3, BR-1498)
 */

import {
  extractEvidence,
  extractGoverningSpecRef,
  isAcSuperseded,
  ok,
  specAcceptanceCriteriaSchema,
  type AiCriterionInput,
  type DocRecord,
  type LoreError,
  type MilestoneFactRow,
  type Result,
} from "@lore/core";
import { readTaskLanding } from "./task-commit-range.js";

/** One task that holds a criterion in its `ac_scope`, with its landing commit when it has landed. */
export interface CriterionHolder {
  readonly task_slug: string;
  readonly landing_commit?: string;
}

/** One live criterion of the plan's task scopes. */
export interface CriterionScope {
  readonly spec_slug: string;
  readonly ac_id: string;
  readonly mode: "script" | "ai" | "human";
  /** The AI rubric (mode `ai` only). */
  readonly rubric?: string;
  readonly holders: readonly CriterionHolder[];
}

/** A runner-attested, conclusive evidence row with its stamp. */
export interface AttestationRow {
  /** `<task-slug>@<recorded_at>`: stable, unique per evidence row. */
  readonly id: string;
  readonly spec_slug: string;
  readonly ac_id: string;
  readonly result: "pass" | "fail";
  readonly head_sha: string;
  readonly recorded_at: string;
}

/**
 * Main's first-parent history from a landing commit up to main's head.
 * `ok(null)` = the landing commit is not on main's first-parent history (nothing binds to it); `err` = unreadable.
 */
export interface MainFirstParentPort {
  readonly commitsFrom: (landingCommit: string) => Promise<Result<ReadonlySet<string> | null, LoreError>>;
}

/** The criteria attestation facts of one plan. */
export interface AttestationFacts {
  readonly rows: readonly MilestoneFactRow[];
  /** AI-mode criteria for the judgment layer. */
  readonly ai_criteria: readonly AiCriterionInput[];
  /** `subject` (`<spec>:<ac>`) and the id of the attestation that decided it; absent for a not-measured criterion. */
  readonly deciding_ids: readonly { readonly subject: string; readonly id: string }[];
  /** Script criteria that have a landed task on main but no bound attestation: what the post-landing step attests. */
  readonly attestable: readonly { readonly landing_commit: string; readonly spec_slug: string; readonly ac_id: string; readonly task_slug: string }[];
}

const short = (sha: string): string => sha.slice(0, 8);

/**
 * The live criteria in the task scopes of a plan.
 *
 * @param spec - the plan's governing spec (`undefined` = no criteria can be resolved)
 * @param tasks - the plan's tasks (their `ac_scope` and `landing`)
 * @returns one scope per distinct criterion id, with every task holding it
 */
export function planCriterionScopes(spec: DocRecord | undefined, tasks: readonly DocRecord[]): CriterionScope[] {
  if (spec === undefined) return [];
  const raw = spec.extra["acceptance_criteria"];
  if (raw === undefined) return [];
  const parsed = specAcceptanceCriteriaSchema.safeParse(raw);
  if (!parsed.success) return [];
  const scopes: CriterionScope[] = [];
  for (const criterion of parsed.data) {
    if (isAcSuperseded(criterion)) continue;
    const holders: CriterionHolder[] = [];
    for (const task of tasks) {
      const scope = task.extra["ac_scope"];
      if (!Array.isArray(scope) || !scope.includes(criterion.id)) continue;
      const landing = readTaskLanding(task.extra);
      holders.push({ task_slug: task.slug, ...(landing !== undefined ? { landing_commit: landing.landing_commit } : {}) });
    }
    if (holders.length === 0) continue;
    scopes.push({
      spec_slug: spec.slug,
      ac_id: criterion.id,
      mode: criterion.verify.mode,
      ...(criterion.verify.mode === "ai" ? { rubric: criterion.verify.rubric } : {}),
      holders,
    });
  }
  return scopes;
}

/**
 * Every runner-attested, conclusive, stamped evidence row of the corpus attributed to a (spec, criterion), by the same
 * rules as `attested-ac-runs.ts`: a plan member counts for its plan's spec; a task with no plan lineage counts only for
 * the spec it recorded as governing (`extra.governing_spec`, BR-1495); one with neither attributes nothing.
 *
 * @param specs - every spec of the corpus
 * @param plans - every plan (its `parent_id` is the governing spec)
 * @param tasks - every task of the corpus
 * @returns the rows, unordered
 */
export function attestationRowsOf(specs: readonly DocRecord[], plans: readonly DocRecord[], tasks: readonly DocRecord[]): AttestationRow[] {
  const specsById = new Map(specs.map((s) => [s.id as string, s]));
  const plansById = new Map(plans.map((p) => [p.id as string, p]));
  const rows: AttestationRow[] = [];
  for (const task of tasks) {
    const planId = task.extra["plan_id"];
    const lineageSpecId = typeof planId === "string" ? ((plansById.get(planId)?.parent_id as string | null | undefined) ?? null) : extractGoverningSpecRef(task);
    for (const entry of extractEvidence(task)) {
      const stamp = entry.attestation?.state_stamp;
      if (entry.ac_ref === undefined || stamp === undefined) continue;
      if (entry.result !== "pass" && entry.result !== "fail") continue;
      // No plan lineage and no recorded spec: attributes nothing (BR-1495, never inferred from the id).
      const specId: string | undefined = lineageSpecId ?? undefined;
      const spec = specId === undefined ? undefined : specsById.get(specId);
      if (spec === undefined) continue;
      rows.push({ id: `${task.slug}@${entry.recorded_at}`, spec_slug: spec.slug, ac_id: entry.ac_ref, result: entry.result, head_sha: stamp.head_sha, recorded_at: entry.recorded_at });
    }
  }
  return rows;
}

/**
 * Decides every script criterion of the plan from bound attestations.
 *
 * @param scopes - the plan's live criteria ({@link planCriterionScopes})
 * @param attestations - the corpus's stamped attested rows ({@link attestationRowsOf})
 * @param main - main's first-parent history from a landing commit
 * @returns fact rows (script criteria only), the AI criteria for the judge, the deciding attestation ids and the
 *   criteria the post-landing step can attest; never throws
 */
export async function attestationFacts(
  scopes: readonly CriterionScope[],
  attestations: readonly AttestationRow[],
  main: MainFirstParentPort,
): Promise<AttestationFacts> {
  const rows: MilestoneFactRow[] = [];
  const decidingIds: { subject: string; id: string }[] = [];
  const attestable: { landing_commit: string; spec_slug: string; ac_id: string; task_slug: string }[] = [];
  const aiCriteria: AiCriterionInput[] = [];
  const history = new Map<string, Result<ReadonlySet<string> | null, LoreError>>();
  const historyOf = async (commit: string): Promise<Result<ReadonlySet<string> | null, LoreError>> => {
    const known = history.get(commit);
    if (known !== undefined) return known;
    const read = await main.commitsFrom(commit);
    history.set(commit, read);
    return read;
  };

  for (const scope of scopes) {
    const subject = `${scope.spec_slug}:${scope.ac_id}`;
    if (scope.mode === "ai") {
      aiCriteria.push({ spec: scope.spec_slug, ac: scope.ac_id, rubric: scope.rubric ?? "" });
      continue;
    }
    if (scope.mode !== "script") continue;
    const landed = scope.holders.filter((h): h is CriterionHolder & { landing_commit: string } => h.landing_commit !== undefined);
    if (landed.length === 0) {
      rows.push({ subject, verdict: "not-measured", detail: `task ${scope.holders.map((h) => h.task_slug).join(", ")} has no landing record, so no attestation can be bound to its landing` });
      continue;
    }
    const mine = attestations.filter((a) => a.spec_slug === scope.spec_slug && a.ac_id === scope.ac_id);
    const bound = new Set<string>();
    const problems: string[] = [];
    let attestableLanding: { landing_commit: string; task_slug: string } | undefined;
    for (const holder of landed) {
      const read = await historyOf(holder.landing_commit);
      if (!read.ok) {
        problems.push(`main history from ${short(holder.landing_commit)} could not be read: ${"message" in read.error ? read.error.message : read.error.code}`);
        continue;
      }
      if (read.value === null) {
        problems.push(`landing ${short(holder.landing_commit)} is not on main's first-parent history`);
        continue;
      }
      attestableLanding ??= { landing_commit: holder.landing_commit, task_slug: holder.task_slug };
      for (const a of mine) if (read.value.has(a.head_sha)) bound.add(a.id);
    }
    const decided = mine
      .filter((a) => bound.has(a.id))
      .reduce<AttestationRow | undefined>((latest, a) => (latest === undefined || a.recorded_at >= latest.recorded_at ? a : latest), undefined);
    if (decided !== undefined) {
      rows.push({ subject, verdict: decided.result, detail: `attested ${decided.result} at ${short(decided.head_sha)} (${decided.id})` });
      decidingIds.push({ subject, id: decided.id });
      continue;
    }
    const elsewhere = mine.length > 0 ? `; ${String(mine.length)} attestation(s) at ${[...new Set(mine.map((a) => short(a.head_sha)))].join(", ")} are not bound to main from the landing` : "";
    const why = problems.length > 0 ? `; ${problems.join("; ")}` : "";
    rows.push({ subject, verdict: "not-measured", detail: `no attestation bound to the landing ${landed.map((h) => short(h.landing_commit)).join(", ")} or a later main commit${elsewhere}${why}` });
    if (attestableLanding !== undefined) attestable.push({ ...attestableLanding, spec_slug: scope.spec_slug, ac_id: scope.ac_id });
  }
  if (rows.length === 0 && aiCriteria.length === 0) {
    rows.push({ subject: "criteria", verdict: "not-measured", detail: "the plan's task scopes hold no live script or AI-mode criterion, so correctness has nothing measured" });
  }
  return { rows, ai_criteria: aiCriteria, deciding_ids: decidingIds, attestable };
}

/** Attests criteria at a landing commit (the real one runs `lore verify` in a throwaway worktree of that commit). */
export interface LandingAttesterPort {
  readonly attestAt: (
    landingCommit: string,
    criteria: readonly { readonly spec_slug: string; readonly ac_id: string }[],
  ) => Promise<Result<void, LoreError>>;
}

/** What one post-landing attestation step did. */
export interface LandingAttestationReport {
  readonly attested: readonly { readonly landing_commit: string; readonly criteria: readonly string[] }[];
  readonly failures: readonly { readonly landing_commit: string; readonly criteria: readonly string[]; readonly message: string }[];
}

/**
 * Attests, at each landing commit, the landed tasks' script criteria that have no attestation bound to main yet.
 *
 * @param scopes - the plan's live criteria
 * @param attestations - the corpus's stamped attested rows
 * @param main - main's first-parent history from a landing commit
 * @param attester - runs the criteria at a landing commit and records attested evidence
 * @returns what was attested and what failed; a criterion already bound is never re-run
 */
export async function attestLandedCriteria(
  scopes: readonly CriterionScope[],
  attestations: readonly AttestationRow[],
  main: MainFirstParentPort,
  attester: LandingAttesterPort,
): Promise<Result<LandingAttestationReport, LoreError>> {
  const facts = await attestationFacts(scopes, attestations, main);
  const byLanding = new Map<string, { spec_slug: string; ac_id: string }[]>();
  for (const item of facts.attestable) {
    byLanding.set(item.landing_commit, [...(byLanding.get(item.landing_commit) ?? []), { spec_slug: item.spec_slug, ac_id: item.ac_id }]);
  }
  const attested: { landing_commit: string; criteria: string[] }[] = [];
  const failures: { landing_commit: string; criteria: string[]; message: string }[] = [];
  for (const [landing, criteria] of byLanding) {
    const names = criteria.map((c) => `${c.spec_slug}:${c.ac_id}`);
    const ran = await attester.attestAt(landing, criteria);
    if (ran.ok) attested.push({ landing_commit: landing, criteria: names });
    else failures.push({ landing_commit: landing, criteria: names, message: "message" in ran.error ? ran.error.message : ran.error.code });
  }
  return ok({ attested, failures });
}
