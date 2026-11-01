/**
 * Criteria as a milestone-review fact: `correctness_vs_acs` decided from ONE run of each live script criterion at the
 * assessed commit (main's head when the review runs), never from attestations made at landings or in task worktrees (BR-1498).
 *
 * Purpose: for every live criterion in a plan's task scopes, run it once at the assessed commit through the trusted
 *   `lore verify` runner (behind {@link HeadCriteriaRunnerPort}) and say pass / fail / not-measured from the attestation
 *   that run made. A plan closes only when what it delivered is correct at the end (D3, D5): a criterion a later plan's
 *   landing broke fails here even though an older attestation passed.
 * Public surface: {@link planCriterionScopes}, {@link attestationRowsOf}, {@link measureCriteriaAtHead},
 *   {@link filesNamedByCommand}, {@link testPathsOfQualifyingCommand}, {@link CriterionScope}, {@link AttestationRow},
 *   {@link HeadCriteriaRunnerPort}, {@link CarryPort}, {@link CarryReach}, {@link AttestationFacts}.
 * Invariants:
 *   - A criterion is DECIDED by a row whose `state_stamp.head_sha` EQUALS the assessed commit (the run just made), or by a
 *     CARRIED row (below); a row at any other commit (a landing, a task worktree, a newer main commit) decides nothing.
 *   - Carry (#553): the candidate is the newest review-recorded (`milestone_refresh`), stamped row of the criterion at its
 *     current revision whose commit is the assessed commit or on its first-parent line. It is carried (no run) only when it
 *     PASSED, the command is nothing but test-runner invocations over test files ({@link testPathsOfQualifyingCommand}),
 *     every such file exists at the assessed commit and the selector reaches none of them over the C..H changes. Every other
 *     case runs the criterion and the row's detail names why ("re-run: ..."). A newer failure is the candidate, never skipped.
 *   - Each script criterion is run exactly once per measurement; the latest row at the assessed commit (by `recorded_at`)
 *     decides and its id (`<task-slug>@<recorded_at>`) is exposed in `deciding_ids` for the fingerprint.
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
  resolveOracleGeneration,
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
  readonly doc_slug: string;
  readonly ac_id: string;
  readonly mode: "script" | "ai" | "human";
  /** The AI rubric (mode `ai` only). */
  readonly rubric?: string;
  /** The verify command (mode `script` only); the files it names are a failing criterion's re-review triggers. */
  readonly command?: string;
  /** The criterion's current revision (BR-238, `resolveOracleGeneration`; absent = 1). */
  readonly revision?: number;
  readonly holders: readonly CriterionHolder[];
}

/** A runner-attested, conclusive evidence row with its stamp. */
export interface AttestationRow {
  /** `<task-slug>@<recorded_at>`: stable, unique per evidence row. */
  readonly id: string;
  readonly doc_slug: string;
  readonly ac_id: string;
  readonly result: "pass" | "fail";
  readonly head_sha: string;
  readonly recorded_at: string;
  /** The criterion revision stamped on the row (BR-238, `resolveOracleGeneration`); absent = 1. */
  readonly criterion_revision?: number;
  /** True for a row the milestone review's own criterion run wrote (`milestone_refresh`); only such rows are carry candidates. */
  readonly review_recorded?: true;
}

/** The criteria attestation facts of one plan. */
export interface AttestationFacts {
  readonly rows: readonly MilestoneFactRow[];
  /** AI-mode criteria for the judgment layer. */
  readonly ai_criteria: readonly AiCriterionInput[];
  /** `subject` (`<spec>:<ac>`) and the id of the attestation that decided it; absent for a not-measured criterion. */
  readonly deciding_ids: readonly { readonly subject: string; readonly id: string }[];
  /** Files named by the verify command of each criterion that FAILED at the assessed commit, sorted; a landing touching one re-reviews a kept-open plan. */
  readonly failing_files: readonly string[];
}

/**
 * The source files a verify command names: its whitespace-separated tokens that end in a source or script extension
 * (`bun run test:file packages/x/a.test.ts && echo ...` names `packages/x/a.test.ts`).
 *
 * @param command - a criterion's verify command
 * @returns the distinct file paths, in order of appearance
 */
export function filesNamedByCommand(command: string): string[] {
  const named = command
    .split(/\s+/)
    .map((token) => token.replace(/^["'`(]+|["'`);]+$/g, ""))
    .filter((token) => !token.startsWith("-") && /^[\w@./-]+\.(?:[cm]?[jt]sx?|sh|py)$/.test(token));
  return [...new Set(named)];
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
      doc_slug: spec.slug,
      ac_id: criterion.id,
      mode: criterion.verify.mode,
      ...(criterion.verify.mode === "ai" ? { rubric: criterion.verify.rubric } : {}),
      ...(criterion.verify.mode === "script" ? { command: criterion.verify.command } : {}),
      revision: resolveOracleGeneration(criterion.oracle_generation),
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
      rows.push({
        id: `${task.slug}@${entry.recorded_at}`,
        doc_slug: spec.slug,
        ac_id: entry.ac_ref,
        result: entry.result,
        head_sha: stamp.head_sha,
        recorded_at: entry.recorded_at,
        criterion_revision: resolveOracleGeneration(entry.ac_oracle_generation),
        ...(entry.milestone_refresh === true ? { review_recorded: true as const } : {}),
      });
    }
  }
  return rows;
}

/** One criterion handed to the runner. */
export interface HeadCriterionRef {
  readonly doc_slug: string;
  readonly ac_id: string;
}

/** What the runner did for one criterion: it ran (its attestation is in the corpus) or it could not complete. */
export type HeadCriterionOutcome =
  | {
      readonly doc_slug: string;
      readonly ac_id: string;
      readonly ran: true;
      /** Why the run left no stamp (`VerifyAcResult.unbound_cause`, BR-1512); absent when it was stamped. */
      readonly unbound_cause?: string;
    }
  | { readonly doc_slug: string; readonly ac_id: string; readonly ran: false; readonly cause: string };

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

/** What the selector says about a criterion's test files between the candidate's commit C and the assessed commit H. */
export type CarryReach =
  /** Nothing between C and H selects any of the command's test files, and all of them exist at H. */
  | { readonly kind: "untouched" }
  /** The selector reaches these of the command's test files (changed, imported, `@reads`, `@spawns`, run-config). */
  | { readonly kind: "reached"; readonly files: readonly string[] }
  /** These of the command's test files do not exist at H (deleted or renamed between C and H). */
  | { readonly kind: "missing"; readonly paths: readonly string[] };

/**
 * The git and selector reads carrying needs, behind a port so this service imports no script
 * (real one: `adapters/cli/assess-carry-selection.ts`, which applies `selectForCommit` of `scripts/changed-tests.ts`).
 * An `err` from either method means the diff, tree or ancestry could not be read: nothing is carried then.
 */
export interface CarryPort {
  /** Every commit on `head`'s first-parent line, `head` included. */
  readonly firstParentLine: (head: string) => Promise<Result<ReadonlySet<string>, LoreError>>;
  /** Whether the C..H changes reach any of `testPaths` (the selector at H over the paths changed between `from` and `to`). */
  readonly reachBetween: (request: {
    readonly from: string;
    readonly to: string;
    readonly testPaths: readonly string[];
  }) => Promise<Result<CarryReach, LoreError>>;
}

const TEST_PATH_TOKEN_RE = /^[\w@./-]+\.test\.(?:tsx?|jsx)$/;
/** Flags of the three runners that take one value; any other flag makes the command unqualified (its effect on what runs is unknown). */
const VALUE_FLAGS: ReadonlySet<string> = new Set(["-t", "--testNamePattern"]);
/** Shell metacharacters outside quotes that make a command more than a list of `&&`-joined invocations. */
const SHELL_META_RE = /[|;<>`$()&\n\\]/;

/** Splits a command into tokens per `&&`-separated segment, honouring quotes; `undefined` when an unquoted shell metacharacter appears. */
function tokenizeCommand(command: string): string[][] | undefined {
  const segments: string[][] = [[]];
  let current = "";
  let quote: "'" | '"' | undefined;
  let inToken = false;
  const endToken = (): void => {
    if (inToken) segments[segments.length - 1]?.push(current);
    current = "";
    inToken = false;
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command.charAt(i);
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
      continue;
    }
    if (ch === "&" && command.charAt(i + 1) === "&") {
      endToken();
      segments.push([]);
      i += 1;
      continue;
    }
    if (SHELL_META_RE.test(ch)) return undefined;
    if (/\s/.test(ch)) endToken();
    else {
      current += ch;
      inToken = true;
    }
  }
  if (quote !== undefined) return undefined;
  endToken();
  return segments;
}

/**
 * The test files of a verify command that runs NOTHING BUT test runners: every `&&`-joined segment is
 * `bun run test:file <paths> [-t <name>]`, `vitest run <paths> [-t <name>]` or `bunx vitest run <paths> [-t <name>]`
 * over `*.test.ts(x)` / `.jsx` files, except an optional final `echo '<text>'`. Anything else (`bun run lint`, a script path,
 * a pipe, `;`, `||`, a directory or an unknown flag instead of a test path) disqualifies the whole command: the selector
 * answers for test files only, so a command running anything more is never carried (spec D2).
 *
 * @param command - a criterion's verify command
 * @returns the distinct test paths in order of appearance, or `undefined` when the command does not qualify
 */
export function testPathsOfQualifyingCommand(command: string): string[] | undefined {
  const segments = tokenizeCommand(command);
  if (segments === undefined) return undefined;
  const paths: string[] = [];
  for (const [index, tokens] of segments.entries()) {
    if (tokens.length === 0) return undefined;
    if (index === segments.length - 1 && index > 0 && tokens[0] === "echo") continue;
    const rest =
      tokens[0] === "bun" && tokens[1] === "run" && tokens[2] === "test:file"
        ? tokens.slice(3)
        : tokens[0] === "vitest" && tokens[1] === "run"
          ? tokens.slice(2)
          : tokens[0] === "bunx" && tokens[1] === "vitest" && tokens[2] === "run"
            ? tokens.slice(3)
            : undefined;
    if (rest === undefined) return undefined;
    let segmentPaths = 0;
    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i] as string;
      if (token.startsWith("-")) {
        if (!VALUE_FLAGS.has(token) || i + 1 >= rest.length) return undefined;
        i += 1;
        continue;
      }
      if (!TEST_PATH_TOKEN_RE.test(token) || token.startsWith("/") || token.split("/").includes("..")) return undefined;
      if (!paths.includes(token)) paths.push(token);
      segmentPaths += 1;
    }
    if (segmentPaths === 0) return undefined;
  }
  return paths;
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
  /** Carries an unchanged criterion's stamped pass instead of running it (#553); absent = every script criterion runs. */
  readonly carry?: CarryPort;
}

const causeOf = (error: LoreError): string => ("message" in error ? error.message : error.code);

/** The outcome of the carry decision for one criterion: carried with its row, or run for a named reason. */
type CarryDecision =
  | { readonly carried: true; readonly row: AttestationRow; readonly paths: readonly string[] }
  | { readonly carried: false; readonly reason: string };

/**
 * Decides whether a criterion's earlier pass carries to `headCommit` (spec "Carried when untouched" / "Re-run otherwise").
 * Checks in a fixed order so the reason named is the first that applies: candidate, pass, command, reach.
 */
async function decideCarry(
  scope: CriterionScope,
  rows: readonly AttestationRow[],
  headCommit: string,
  carry: CarryPort,
  line: () => Promise<Result<ReadonlySet<string>, LoreError>>,
): Promise<CarryDecision> {
  const revision = scope.revision ?? resolveOracleGeneration(undefined);
  const own = rows.filter(
    (r) =>
      r.doc_slug === scope.doc_slug &&
      r.ac_id === scope.ac_id &&
      r.review_recorded === true &&
      resolveOracleGeneration(r.criterion_revision) === revision,
  );
  if (own.length === 0) return { carried: false, reason: "no candidate: no review-recorded stamped attestation of this criterion at its current revision" };
  const onLine = await line();
  if (!onLine.ok) return { carried: false, reason: `diff unreadable: first-parent line of ${short(headCommit)}: ${causeOf(onLine.error)}` };
  const candidate = own
    .filter((r) => onLine.value.has(r.head_sha))
    .reduce<AttestationRow | undefined>((newest, r) => (newest === undefined || r.recorded_at >= newest.recorded_at ? r : newest), undefined);
  if (candidate === undefined) return { carried: false, reason: "no candidate: its stamped attestations are not on the assessed commit's first-parent line" };
  if (candidate.result !== "pass") return { carried: false, reason: `candidate failed: its newest stamped attestation (${candidate.id} at ${short(candidate.head_sha)}) failed` };
  const paths = testPathsOfQualifyingCommand(scope.command ?? "");
  if (paths === undefined) return { carried: false, reason: "command does not qualify: it runs something other than test files through a test runner" };
  const reach = await carry.reachBetween({ from: candidate.head_sha, to: headCommit, testPaths: paths });
  if (!reach.ok) return { carried: false, reason: `diff unreadable: ${short(candidate.head_sha)}..${short(headCommit)}: ${causeOf(reach.error)}` };
  if (reach.value.kind === "missing") return { carried: false, reason: `test path missing at ${short(headCommit)}: ${reach.value.paths.join(", ")}` };
  if (reach.value.kind === "reached") return { carried: false, reason: `change reaches ${reach.value.files.join(", ")} (${short(candidate.head_sha)}..${short(headCommit)})` };
  return { carried: true, row: candidate, paths };
}

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
    if (scope.mode === "ai") aiCriteria.push({ spec: scope.doc_slug, ac: scope.ac_id, rubric: scope.rubric ?? "" });
    else if (scope.mode === "script") scripts.push(scope);
  }
  if (scripts.length === 0) {
    if (aiCriteria.length === 0) {
      // reason: spec "Criteria attestation" (corrected 2026-10-29): nothing in scope is `na`, not not-measured; it must not
      // block the close, and the reason names the empty scope so it never reads as a vacuous pass.
      rows.push({ subject: "criteria", verdict: "na", detail: "no criterion in scope: the plan's task scopes hold no live script or AI-mode criterion" });
    }
    return { rows, ai_criteria: aiCriteria, deciding_ids: decidingIds, failing_files: [] };
  }

  const subjectOf = (scope: CriterionScope): string => `${scope.doc_slug}:${scope.ac_id}`;

  // Carry decisions (#553), made BEFORE the run from the rows already in the corpus.
  const carried = new Map<string, Extract<CarryDecision, { carried: true }>>();
  const reasons = new Map<string, string>();
  if (input.carry !== undefined) {
    const carry = input.carry;
    const before = await input.readRows();
    let linePromise: Promise<Result<ReadonlySet<string>, LoreError>> | undefined;
    const line = (): Promise<Result<ReadonlySet<string>, LoreError>> => (linePromise ??= carry.firstParentLine(input.headCommit));
    for (const scope of scripts) {
      const decision = before.ok
        ? await decideCarry(scope, before.value, input.headCommit, carry, line)
        : ({ carried: false, reason: `the attestations could not be read: ${causeOf(before.error)}` } as const);
      if (decision.carried) carried.set(subjectOf(scope), decision);
      else reasons.set(subjectOf(scope), decision.reason);
    }
  }
  // reason suffix naming why a criterion ran at the assessed commit (spec "Named"); empty when carrying is off.
  const because = (scope: CriterionScope): string => {
    const reason = reasons.get(subjectOf(scope));
    return reason === undefined ? "" : `; re-run: ${reason}`;
  };

  const toRun = scripts.filter((s) => !carried.has(subjectOf(s)));
  const decided = new Map<string, MilestoneFactRow>();
  const decidedIds = new Map<string, string>();
  for (const scope of scripts) {
    const hit = carried.get(subjectOf(scope));
    if (hit === undefined) continue;
    decided.set(subjectOf(scope), {
      subject: subjectOf(scope),
      verdict: "pass",
      detail: `carried from ${short(hit.row.head_sha)} (${hit.row.id}): no change reaches ${hit.paths.join(", ")}`,
    });
    decidedIds.set(subjectOf(scope), hit.row.id);
  }

  const notMeasuredRun = (cause: string): void => {
    for (const s of toRun) decided.set(subjectOf(s), { subject: subjectOf(s), verdict: "not-measured", detail: `not run at ${short(input.headCommit)}: ${cause}${because(s)}` });
  };

  if (toRun.length > 0) {
    const ran = await input.runner.attestAtHead({
      commit: input.headCommit,
      ...(input.worktreeRoot !== undefined ? { worktreeRoot: input.worktreeRoot } : {}),
      criteria: toRun.map((s) => ({ doc_slug: s.doc_slug, ac_id: s.ac_id })),
    });
    const attested = ran.ok ? await input.readRows() : undefined;
    if (!ran.ok) notMeasuredRun(causeOf(ran.error));
    else if (attested !== undefined && !attested.ok) notMeasuredRun(`the attestations could not be read: ${causeOf(attested.error)}`);
    else if (attested !== undefined && attested.ok) {
      for (const scope of toRun) {
        const subject = subjectOf(scope);
        const outcome = ran.value.find((o) => o.doc_slug === scope.doc_slug && o.ac_id === scope.ac_id);
        if (outcome === undefined || !outcome.ran) {
          const cause = outcome === undefined ? "the runner reported nothing for it" : outcome.cause;
          decided.set(subject, { subject, verdict: "not-measured", detail: `its run at ${short(input.headCommit)} could not complete: ${cause}${because(scope)}` });
          continue;
        }
        const latest = attested.value
          .filter((a) => a.doc_slug === scope.doc_slug && a.ac_id === scope.ac_id && a.head_sha === input.headCommit)
          .reduce<AttestationRow | undefined>((newest, a) => (newest === undefined || a.recorded_at >= newest.recorded_at ? a : newest), undefined);
        if (latest === undefined) {
          // BR-1512: name the cause the verify run reported; the generic sentence alone hides it.
          const why = outcome.unbound_cause !== undefined ? `: ${outcome.unbound_cause}` : "";
          decided.set(subject, { subject, verdict: "not-measured", detail: `its run at ${short(input.headCommit)} left no attestation stamped at that commit${why}${because(scope)}` });
          continue;
        }
        decided.set(subject, { subject, verdict: latest.result, detail: `attested ${latest.result} at ${short(latest.head_sha)} (${latest.id})${because(scope)}` });
        decidedIds.set(subject, latest.id);
      }
    }
  }
  for (const scope of scripts) {
    const row = decided.get(subjectOf(scope));
    if (row !== undefined) rows.push(row);
    const id = decidedIds.get(subjectOf(scope));
    if (id !== undefined) decidingIds.push({ subject: subjectOf(scope), id });
  }
  const failingFiles = scripts.flatMap((scope) =>
    rows.some((r) => r.subject === subjectOf(scope) && r.verdict === "fail") ? filesNamedByCommand(scope.command ?? "") : [],
  );
  return { rows, ai_criteria: aiCriteria, deciding_ids: decidingIds, failing_files: [...new Set(failingFiles)].sort() };
}
