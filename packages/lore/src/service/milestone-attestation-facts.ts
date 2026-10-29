/**
 * Criteria as a milestone-review fact: `correctness_vs_acs` decided from ONE run of each live script criterion at the
 * assessed commit (main's head when the review runs), never from attestations made at landings or in task worktrees (BR-1498).
 *
 * Purpose: for every live criterion in a plan's task scopes, run it once at the assessed commit through the trusted
 *   `lore verify` runner (behind {@link HeadCriteriaRunnerPort}) and say pass / fail / not-measured from the attestation
 *   that run made. A plan closes only when what it delivered is correct at the end (D3, D5): a criterion a later plan's
 *   landing broke fails here even though an older attestation passed.
 * Public surface: {@link planCriterionScopes}, {@link attestationRowsOf}, {@link measureCriteriaAtHead},
 *   {@link CriterionScope}, {@link AttestationRow}, {@link HeadCriteriaRunnerPort}, {@link AttestationFacts}.
 * Invariants:
 *   - Only a row whose `state_stamp.head_sha` EQUALS the assessed commit counts; a row at any other commit (a landing, a
 *     task worktree, an older or newer main commit) is never read, pass or fail.
 *   - Each script criterion is run exactly once per measurement; the latest row at the assessed commit (by `recorded_at`)
 *     decides and its id (`<task-slug>@<recorded_at>`) is exposed in `deciding_ids` for the fingerprint (B3 hashes it).
 *   - A run that cannot complete (worktree, install, refused runner), an unreadable corpus, or a run that left no row at
 *     the assessed commit makes the criterion `not-measured` with the cause, never pass.
 *   - Only runner-attested, conclusive (`pass` | `fail`) rows carrying a `state_stamp` are rows at all.
 *   - AI-mode criteria are listed for the judgment layer, human-mode ones are left to UAT; superseded criteria are skipped.
 *   - A plan with no live script or AI criterion in scope is `na` (the row's detail says "no criterion in scope"): it neither
 *     blocks the close nor reads as pass; the runner is not called.
 * Side-effect class: pure except through the injected ports (the runner port writes attested evidence).
 *
 * Reference: Bazel action cache (a result is valid only for the inputs it was computed at).
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-3, BR-1498)
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

/** One task that holds a criterion in its `ac_scope`. */
export interface CriterionHolder {
  readonly task_slug: string;
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

/** The criteria attestation facts of one plan. */
export interface AttestationFacts {
  readonly rows: readonly MilestoneFactRow[];
  /** AI-mode criteria for the judgment layer. */
  readonly ai_criteria: readonly AiCriterionInput[];
  /** `subject` (`<spec>:<ac>`) and the id of the attestation that decided it; absent for a not-measured criterion. */
  readonly deciding_ids: readonly { readonly subject: string; readonly id: string }[];
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
      holders.push({ task_slug: task.slug });
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

/** One criterion handed to the runner. */
export interface HeadCriterionRef {
  readonly spec_slug: string;
  readonly ac_id: string;
}

/** What the runner did for one criterion: it ran (its attestation is in the corpus) or it could not complete. */
export type HeadCriterionOutcome =
  | { readonly spec_slug: string; readonly ac_id: string; readonly ran: true }
  | { readonly spec_slug: string; readonly ac_id: string; readonly ran: false; readonly cause: string };

/**
 * Runs criteria once at a commit through `lore verify` (the real one: {@link createGitHeadCriteriaRunner}).
 * `worktreeRoot` set = run in that existing throwaway worktree (the suite's, already at `commit`); absent = make a
 * throwaway worktree at `commit` for the criteria alone. `err` = nothing could run (every criterion is then not-measured).
 */
export interface HeadCriteriaRunnerPort {
  readonly attestAtHead: (request: {
    readonly commit: string;
    readonly worktreeRoot?: string;
    readonly criteria: readonly HeadCriterionRef[];
  }) => Promise<Result<readonly HeadCriterionOutcome[], LoreError>>;
}

/** Inputs of {@link measureCriteriaAtHead}. */
export interface MeasureCriteriaAtHeadInput {
  readonly scopes: readonly CriterionScope[];
  /** The assessed commit (a full sha, as recorded in `state_stamp.head_sha`). */
  readonly headCommit: string;
  readonly runner: HeadCriteriaRunnerPort;
  /** The suite's throwaway worktree at `headCommit`, when one exists for this review. */
  readonly worktreeRoot?: string;
  /** Reads the corpus's stamped attested rows AFTER the run ({@link attestationRowsOf}). */
  readonly readRows: () => Promise<Result<readonly AttestationRow[], LoreError>>;
}

const causeOf = (error: LoreError): string => ("message" in error ? error.message : error.code);

/**
 * Runs each live script criterion of the plan once at the assessed commit and decides it from the attestation made there.
 *
 * @param input - scopes, assessed commit, runner port, optional suite worktree, row reader
 * @returns fact rows (script criteria only, or one `na` row when nothing is in scope), the AI criteria for the judge and
 *   the ids of the attestations made at the assessed commit; never throws
 */
export async function measureCriteriaAtHead(input: MeasureCriteriaAtHeadInput): Promise<AttestationFacts> {
  const rows: MilestoneFactRow[] = [];
  const decidingIds: { subject: string; id: string }[] = [];
  const aiCriteria: AiCriterionInput[] = [];
  const scripts: CriterionScope[] = [];
  for (const scope of input.scopes) {
    if (scope.mode === "ai") aiCriteria.push({ spec: scope.spec_slug, ac: scope.ac_id, rubric: scope.rubric ?? "" });
    else if (scope.mode === "script") scripts.push(scope);
  }
  if (scripts.length === 0) {
    if (aiCriteria.length === 0) {
      // reason: spec "Criteria attestation" (corrected 2026-10-29): nothing in scope is `na`, not not-measured; it must not
      // block the close, and the reason names the empty scope so it never reads as a vacuous pass.
      rows.push({ subject: "criteria", verdict: "na", detail: "no criterion in scope: the plan's task scopes hold no live script or AI-mode criterion" });
    }
    return { rows, ai_criteria: aiCriteria, deciding_ids: decidingIds };
  }

  const subjectOf = (scope: CriterionScope): string => `${scope.spec_slug}:${scope.ac_id}`;
  const notMeasuredAll = (cause: string): AttestationFacts => ({
    rows: scripts.map((s) => ({ subject: subjectOf(s), verdict: "not-measured" as const, detail: `not run at ${short(input.headCommit)}: ${cause}` })),
    ai_criteria: aiCriteria,
    deciding_ids: [],
  });

  const ran = await input.runner.attestAtHead({
    commit: input.headCommit,
    ...(input.worktreeRoot !== undefined ? { worktreeRoot: input.worktreeRoot } : {}),
    criteria: scripts.map((s) => ({ spec_slug: s.spec_slug, ac_id: s.ac_id })),
  });
  if (!ran.ok) return notMeasuredAll(causeOf(ran.error));
  const attested = await input.readRows();
  if (!attested.ok) return notMeasuredAll(`the attestations could not be read: ${causeOf(attested.error)}`);

  for (const scope of scripts) {
    const subject = subjectOf(scope);
    const outcome = ran.value.find((o) => o.spec_slug === scope.spec_slug && o.ac_id === scope.ac_id);
    if (outcome === undefined || !outcome.ran) {
      const cause = outcome === undefined ? "the runner reported nothing for it" : outcome.cause;
      rows.push({ subject, verdict: "not-measured", detail: `its run at ${short(input.headCommit)} could not complete: ${cause}` });
      continue;
    }
    const decided = attested.value
      .filter((a) => a.spec_slug === scope.spec_slug && a.ac_id === scope.ac_id && a.head_sha === input.headCommit)
      .reduce<AttestationRow | undefined>((latest, a) => (latest === undefined || a.recorded_at >= latest.recorded_at ? a : latest), undefined);
    if (decided === undefined) {
      rows.push({ subject, verdict: "not-measured", detail: `its run at ${short(input.headCommit)} left no attestation stamped at that commit` });
      continue;
    }
    rows.push({ subject, verdict: decided.result, detail: `attested ${decided.result} at ${short(decided.head_sha)} (${decided.id})` });
    decidingIds.push({ subject, id: decided.id });
  }
  return { rows, ai_criteria: aiCriteria, deciding_ids: decidingIds };
}
