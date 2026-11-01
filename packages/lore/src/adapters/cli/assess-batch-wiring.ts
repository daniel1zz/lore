/**
 * The measurements and ports behind `lore assess`, shared by the hand run, the review batch and `lore plan close` (BR-1379, BR-1507).
 *
 * Purpose: ONE place builds what a review of a plan needs — the suite measured once per batch on main, each plan's landing-derived diff
 *   and facts, the judge call, the changed-files re-review test, the criteria run once at the assessed commit, the issue filing and the ports of
 *   `ReviewBatchRunner` — so `lore assess`, the detached batch and the one close function (`PlanCloseService`) never carry a second copy.
 * Public surface: createAssessWiring, createAssessFiling, createBatchRunner, buildBatchRunPorts, listDocsOf, AssessWiring.
 * Invariants:
 *   - Nothing here decides a verdict: it measures, calls the judge and hands the stored review back; the batch runner decides.
 *   - A measurement that cannot be taken is reported on stderr and left absent (not-measured), never read as a pass.
 *   - The plan archive of the batch (`closePlan`) is the gated `CorpusService.set` (the plan-close checkpoint).
 * Side-effect class: IO (git worktrees, the suite, the judge, the issue tracker, corpus writes, stderr warnings).
 */

import { ok, resolveMachineTestSlots, type DocId, type LoreError, type MilestoneFacts, type PlanBundle, type Result } from "@lore/core";
import type { App } from "../../app.js";
import { IssueFilingService } from "../../service/issue-filing-service.js";
import type { SuiteRun } from "../../service/milestone-review-inputs.js";
import { regressionAtHead } from "../../service/regression-at-head.js";
import { createGateAcceptanceLog, unwiredGateAcceptanceLog, type GateAcceptanceLog } from "../../service/gate-acceptance-service.js";
import { createGitTestSelection } from "./assess-selection.js";
import { BATCH_ERROR_AUDIT_ACTION, ReviewBatchRunner, type BatchRunPorts } from "../../service/review-batch-service.js";
import { planLeaseKey, type ReviewLeases } from "../../service/review-batch-lease.js";
import { readTaskLanding } from "../../service/task-commit-range.js";
import { findCorpusOnlyTaskSlugs, noCodeRegressionRow } from "../../service/corpus-only-task.js";
import { createGithubIssuePort } from "./assess-file-issues.js";
import { measurePlanCriteriaAtHead, resolveAssessedCommit, type ListDocsPort } from "./assess-attestation-wiring.js";
import { deriveLandingDiffForPlan, describeLandingCount, type DiffSourceRecord } from "./assess-commit-derivation.js";
import { createGitHeadCriteriaRunner } from "./assess-landing-attester.js";
import { createGitCarryPort } from "./assess-carry-selection.js";
import { ReviewTestSlots as ReviewTestSlotsImpl, slotCommitSuiteRunner, slotCriterionRerunner, slotStaleRefresher, type ReviewTestSlots } from "../../service/review-test-slots.js";
import { createGitChangedFilesSince, createGitFileExistsAt, createGitFirstParentCommitContaining, createGitFirstParentHistory } from "./assess-regression-git.js";
import { createAppCriterionRerunner, createAppStaleRefresher } from "./assess-stale-refresh.js";
import { createGitCommitSuiteRunner } from "./assess-suite-runner.js";
import { ASSESS_NO_COMMITS_DERIVED } from "./cli-refusal-messages.js";
import type { invocationOf } from "./command-invocation.js";
import { resolveConsumerCorpusRoot, type GithubUpstreamCfg } from "./report-issue-wiring.js";
import { formatErrorFor } from "./utils.js";

type Inv = ReturnType<typeof invocationOf>;
type MilestoneReviewServiceOf = NonNullable<App["milestoneReviewService"]>;

/** The corpus reader the attestation wiring needs. */
export function listDocsOf(app: App): ListDocsPort {
  return async (type) => {
    const listed = await app.corpusService.listFull({ type });
    return listed.ok ? ok(listed.value.docs) : listed;
  };
}

/** One-line account of how a plan's diff was obtained (stored on the review as `diff_source`). */
function describeDiffSource(source: DiffSourceRecord): string {
  switch (source.mode) {
    case "explicit_diff":
      return `--diff ${source.range} (explicit override)`;
    case "explicit_diff_file":
      return `--diff-file ${source.path} (explicit override)`;
    case "explicit_diff_text":
      // reason: unreachable from the CLI (only MCP's diff_text override produces it) — kept so the switch stays
      // exhaustively typed against the shared union.
      return "diff_text (explicit override)";
    case "auto_derived":
      if (source.status === "derived") {
        const missing = source.tasks_not_measured.length;
        return (
          `derived from ${describeLandingCount(source.landings?.length ?? 0, source.commits.length)}` +
          (missing > 0 ? ` (${String(missing)} task(s) NOT MEASURED: no recorded commit range)` : "")
        );
      }
      if (source.status === "unverifiable_convention_mismatch") {
        return "unavailable: every task is archived but none recorded a commit range";
      }
      return `none: ${ASSESS_NO_COMMITS_DERIVED}`;
  }
}

/**
 * The machine's review test slots for one process (BR-1532): every review test run takes one of `workflow.review.machine_test_slots`.
 * The one construction every review entry (`lore assess`, `lore plan close`) shares.
 */
export function createReviewTestSlots(inv: Inv, leases: ReviewLeases, config: Parameters<typeof resolveMachineTestSlots>[0]): ReviewTestSlots {
  return new ReviewTestSlotsImpl({
    leases,
    slots: resolveMachineTestSlots(config),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    clock: Date.now,
    say: (line) => inv.io.stderr.write(`${line}\n`),
  });
}

/** The measured inputs of one review, built once per run (see {@link createAssessWiring}). */
export interface AssessWiring {
  /** The suite of main's HEAD, measured once per batch (stored results first, BR-1497); `undefined` when `suiteRefs` is empty. */
  readonly measureSuite: (suiteRefs: readonly string[]) => Promise<SuiteRun | undefined>;
  /** Judges one plan from its landed diff: the one review step the hand run and the batch both use. */
  readonly reviewOne: (ref: string, suite: SuiteRun | undefined) => ReturnType<MilestoneReviewServiceOf["review"]>;
  /** The files changed on main since a commit (the batch's re-review test, BR-1379); nothing is measured per landing. */
  readonly changedFilesSince: NonNullable<BatchRunPorts["changedFilesSince"]>;
}

/** What {@link createAssessWiring} reads. */
export interface AssessWiringInput {
  readonly app: App;
  readonly inv: Inv;
  /** The acting identity recorded on the evidence the measurements write. */
  readonly actor: string;
  readonly reviewService: MilestoneReviewServiceOf;
  /**
   * The machine's review test slots (BR-1532): every review test run takes one. The runners and rerunners below are built ONLY through
   * the `slot*` decorators of this one value, so no review run bypasses it.
   */
  readonly slots: ReviewTestSlots;
}

/**
 * Builds the measurements of `lore assess` over the invocation's checkout.
 *
 * @param input - the app, the invocation, the actor and the milestone review service
 * @returns the closures; they share the assessed commit and the criteria measured once in the suite's worktree
 */
export function createAssessWiring(input: AssessWiringInput): AssessWiring {
  const { app, inv, actor, reviewService, slots } = input;

  // reason: main's head as the batch resolved it once (set by `measureSuite`); the regression head recheck reads that commit, never a newer main.
  let assessedCommit: string | undefined;
  type CriteriaFacts = Pick<MilestoneFacts, "attestation" | "criteria_attestation_ids" | "ai_criteria" | "failing_fact_files" | "criteria_run">;
  // reason: why the suite's worktree did not run a plan's criteria (set by `measureSuite`), so the fallback to a worktree of
  // their own is recorded on the review and written to stderr, never silent (BR-1498).
  let criteriaFallbackReason: string | undefined;
  // reason: criteria measured in the suite's worktree by `measureSuite`, keyed by the plan ref the batch uses (BR-1498).
  const criteriaByPlan = new Map<string, CriteriaFacts>();
  /** Runs a plan's script criteria once at `commit` (in `worktreeRoot` when given, else a throwaway worktree of the commit). */
  const measureCriteria = async (bundle: PlanBundle, commit: string, worktreeRoot?: string): Promise<CriteriaFacts> => {
    const verifyRunner = app.verifyRunnerService;
    if (verifyRunner === undefined) return {};
    return measurePlanCriteriaAtHead(
      listDocsOf(app),
      bundle,
      { commit, ...(worktreeRoot !== undefined ? { worktreeRoot } : {}) },
      createGitHeadCriteriaRunner(inv.cwd, inv.env, (executionRoot) =>
        slotCriterionRerunner(createAppCriterionRerunner(app, verifyRunner, { executionRoot, by: actor, nowIso: () => new Date().toISOString() }), slots),
      ),
      createGitCarryPort(inv.cwd, inv.env),
    );
  };

  /** Stamps where the criteria ran, only when some criterion was actually run (a plan with none in scope has nothing to place). */
  const withCriteriaRun = (facts: CriteriaFacts, run: NonNullable<MilestoneFacts["criteria_run"]>): CriteriaFacts =>
    (facts.attestation ?? []).some((row) => row.verdict !== "na") ? { ...facts, criteria_run: run } : facts;

  const measureSuite = async (suiteRefs: readonly string[]): Promise<SuiteRun | undefined> => {
    if (suiteRefs.length === 0) return undefined;
    // reason: BR-1532 — a machine batch measures once per pass; nothing a previous pass measured may be read as this pass's facts.
    criteriaByPlan.clear();
    criteriaFallbackReason = undefined;
    assessedCommit = undefined;
    // reason: stale cited evidence is re-verified in this SAME throwaway main worktree, once per batch, before any
    // plan is judged (Part D); a failed refresh leaves its rules stale, which the snapshot rule reads as n/a.
    const verifyRunner = app.verifyRunnerService;
    const refreshStale =
      verifyRunner === undefined
        ? undefined
        : async (root: string): Promise<void> => {
            const refresher = slotStaleRefresher(
              createAppStaleRefresher(app, verifyRunner, {
                executionRoot: root,
                by: actor,
                nowIso: () => new Date().toISOString(),
              }),
              slots,
            );
            const refreshed = await reviewService.refreshStaleCitedRules(suiteRefs, refresher);
            if (!refreshed.ok) {
              inv.io.stderr.write(`Warning: stale cited-rule refresh failed: ${formatErrorFor(inv, refreshed.error)}\n`);
              return;
            }
            for (const failure of refreshed.value.failures) {
              inv.io.stderr.write(`Warning: could not re-verify ${failure.acIds.join(", ")} for ${failure.plan}: ${failure.message}\n`);
            }
          };
    // reason: BR-1497 — no review runs the full suite; file runs are stored per (commit, file) by the app's suite service,
    // already bound to the suite leases (BR-1511). The batch measures nothing per landing (spec D1).
    const suiteResults = app.suiteResultService;
    if (suiteResults === undefined) return { status: "not_measured", reason: "the suite-result store is not wired in this app" };
    const runner = slotCommitSuiteRunner(createGitCommitSuiteRunner(inv.cwd, inv.env), slots);
    // reason: ONE worktree at the assessed commit serves the stale cited-rule refresh (only when some plan cites a stale
    // rule) and the plans' script criteria (BR-1498, AC-AO-3), so criteria run once per review.
    const stale = refreshStale === undefined ? ok(false) : await reviewService.hasStaleCitations(suiteRefs);
    if (!stale.ok) return { status: "not_measured", reason: formatErrorFor(inv, stale.error) };
    // reason: BR-1496 (#540) — no review runs the full suite: each plan's regression runs the selector's tests at the commit
    // holding ITS last landing. What the batch does once is the head-bound work: the stale cited-rule refresh and the plans' criteria (BR-1498), in one worktree of head.
    const resolvedHead = await runner.resolveCommit("main");
    if (!resolvedHead.ok) {
      criteriaFallbackReason = `main's head could not be resolved: ${formatErrorFor(inv, resolvedHead.error)}`;
      return { status: "not_measured", reason: formatErrorFor(inv, resolvedHead.error) };
    }
    const headCommit = resolvedHead.value.commit;
    assessedCommit = headCommit;
    if (verifyRunner === undefined) return undefined;
    if (runner.withWorktree === undefined) return { status: "not_measured", reason: "the runner cannot open a worktree for the head-bound work" };
    const worked = await runner.withWorktree(headCommit, async (root) => {
      if (refreshStale !== undefined && stale.value) await refreshStale(root);
      for (const ref of suiteRefs) {
        const bundle = await app.corpusService.getPlanBundle(ref);
        if (!bundle.ok) {
          inv.io.stderr.write(`Warning: criteria not measured for ${ref}: ${formatErrorFor(inv, bundle.error)}\n`);
          continue;
        }
        criteriaByPlan.set(ref, await measureCriteria(bundle.value, headCommit, root));
      }
    });
    if (!worked.ok) {
      criteriaFallbackReason = `the head worktree could not be prepared: ${formatErrorFor(inv, worked.error)}`;
      inv.io.stderr.write(`Warning: the worktree work (stale-rule refresh, criteria) could not run: ${formatErrorFor(inv, worked.error)}\n`);
      return undefined;
    }
    // reason: the review reads a stored suite, so no suite worktree exists at head; the criteria ran once, in a worktree of their own.
    for (const [ref, facts] of criteriaByPlan) criteriaByPlan.set(ref, withCriteriaRun(facts, { worktree: "own", reason: "the review reads a stored suite, so no suite worktree exists at main's head" }));
    return undefined;
  };

  /** One plan's measured inputs: its landing-derived diff and the facts layer (what a review reads). */
  interface MeasuredPlan {
    readonly derivation: ReturnType<typeof deriveLandingDiffForPlan>;
    readonly diffSource: DiffSourceRecord;
    readonly facts: MilestoneFacts;
    readonly rerunCriterion: ReturnType<typeof createAppCriterionRerunner> | undefined;
  }
  /** Measures one plan's diff and facts: the one measurement both the hand run and the batch use. */
  const measurePlanFacts = async (ref: string): Promise<Result<MeasuredPlan, LoreError>> => {
    const bundle = await app.corpusService.getPlanBundle(ref);
    if (!bundle.ok) return bundle;
    // reason: AC-DCS2-12 — a deprecated task is abandoned work, not work without a landing: it is neither measured nor named unlanded
    // (naming it made regression and security not-measured, so a plan with a deprecated task could never close)
    const tasks = bundle.value.tasks.filter((task) => task.status !== "deprecated");
    // reason: #459 — the diff is each landing's own `main_before..landing_commit`; a task without a landing record is
    // named in `unlanded_tasks` (no commit-range fallback).
    // reason: BR-1509 — a task with no anchors, never claimed on a branch and no landing record changes no code: it is listed as
    // having no code, never `unlanded`.
    const corpusOnly = await findCorpusOnlyTaskSlugs(tasks, app.auditService);
    if (!corpusOnly.ok) return corpusOnly;
    const derivation = deriveLandingDiffForPlan(
      inv.cwd,
      tasks.map((t) => ({ slug: t.slug, landing: readTaskLanding(t.extra), ...(corpusOnly.value.has(t.slug) ? { corpus_only: true } : {}) })),
      tasks.length > 0 && tasks.every((t) => t.status === "archived"),
      { env: inv.env, ref: assessedCommit ?? "main" },
    );
    const diffSource: DiffSourceRecord = { mode: "auto_derived", ...derivation };
    // reason: spec D6 — criteria citing a reworded rule are re-run through the same trusted runner as the stale
    // refresh, in this invocation's checkout (the batch's throwaway main worktree is gone once the suite is measured).
    const verifyRunner = app.verifyRunnerService;
    const rerunCriterion =
      verifyRunner === undefined
        ? undefined
        : slotCriterionRerunner(createAppCriterionRerunner(app, verifyRunner, { executionRoot: inv.cwd, by: actor, nowIso: () => new Date().toISOString() }), slots);
    // reason: BR-1496 — regression is measured on the selector's tests for the plan's changed paths at the commit holding its last
    // landing (stored per (commit, file), so a second review runs nothing); red files are rechecked at the assessed head, bisected
    // and confirmed alone. No full suite runs. Without the suite-result store regression stays not-measured, never pass.
    const suiteResults = app.suiteResultService;
    let regressionFacts: Pick<MilestoneFacts, "regression" | "regression_files" | "head_suite_result_id" | "single_file_run_ids" | "assessed_commit" | "failing_fact_files" | "regression_causes"> = {};
    // reason: BR-1509 — when no task changes code, regression is `na` with no suite to run, so it is measured even without the
    // suite-result store.
    const noTaskChangesCode = tasks.length > 0 && derivation.no_code_tasks.length === tasks.length;
    if (noTaskChangesCode) {
      regressionFacts = { regression: [noCodeRegressionRow(derivation.no_code_tasks)], regression_files: [], regression_causes: [], single_file_run_ids: [], failing_fact_files: [] };
    } else if (suiteResults !== undefined) {
      // reason: #535 — one runner per review: its file runs share one prepared worktree per commit, removed in `finally` whatever happened.
      const regressionRunner = slotCommitSuiteRunner(createGitCommitSuiteRunner(inv.cwd, inv.env), slots);
      const measured = await (async () => {
        try {
          return await regressionAtHead(derivation.landings, derivation.unlanded_tasks, {
            suites: suiteResults,
            runner: regressionRunner,
            selectTests: createGitTestSelection(inv.cwd, inv.env),
            // reason: the head the batch resolved once, so main moving mid-run cannot move the recheck or the history under one review.
            headRef: assessedCommit ?? "main",
            firstParentHistory: createGitFirstParentHistory(inv.cwd, inv.env),
            fileExistsAt: createGitFileExistsAt(inv.cwd, inv.env),
            firstParentCommitContaining: createGitFirstParentCommitContaining(inv.cwd, inv.env),
          });
        } finally {
          const ended = await regressionRunner.disposeWorktrees?.();
          if (ended !== undefined && !ended.ok) inv.io.stderr.write(`Warning: a prepared worktree of the regression review could not be removed: ${formatErrorFor(inv, ended.error)}\n`);
        }
      })();
      if (measured.ok) {
        const chargedFiles = [...new Set(measured.value.charged.map((c) => c.file))].sort();
        regressionFacts = {
          regression: measured.value.rows,
          regression_files: chargedFiles,
          regression_causes: measured.value.causes,
          single_file_run_ids: measured.value.single_file_run_ids,
          // reason: a plan kept open by a red file is re-reviewed when a later landing changes that file (BR-1379); the batch
          // compares these files with main's changes since the assessed commit.
          failing_fact_files: chargedFiles,
          ...(measured.value.assessed_commit !== undefined ? { assessed_commit: measured.value.assessed_commit } : {}),
        };
      } else {
        inv.io.stderr.write(`Warning: regression at head not measured for ${ref}: ${formatErrorFor(inv, measured.error)}\n`);
      }
    }
    // reason: BR-1498 — criteria run once at the assessed commit, in the suite's worktree (`measureSuite`); only when that
    // did not happen for this plan are they run here in a worktree of the commit. Anything that cannot run leaves
    // criteria absent (not-measured), never pass.
    let attestationFacts: CriteriaFacts = criteriaByPlan.get(ref) ?? {};
    if (!criteriaByPlan.has(ref)) {
      const commit = assessedCommit !== undefined ? ok(assessedCommit) : resolveAssessedCommit(inv.cwd, inv.env);
      if (!commit.ok) inv.io.stderr.write(`Warning: criteria not measured for ${ref}: ${formatErrorFor(inv, commit.error)}\n`);
      else if (app.verifyRunnerService === undefined) inv.io.stderr.write(`Warning: criteria not measured for ${ref}: the verify runner is not wired in this app\n`);
      else {
        // reason: the fallback the spec allows (a throwaway worktree at the assessed commit for the criteria alone), made loud:
        // the review records which worktree ran the criteria and why the suite's was not used (BR-1498).
        const reason = criteriaFallbackReason ?? "the suite's worktree did not run the criteria for this plan";
        attestationFacts = withCriteriaRun(await measureCriteria(bundle.value, commit.value), { worktree: "own", reason });
        if (attestationFacts.criteria_run !== undefined) {
          inv.io.stderr.write(`Warning: criteria for ${ref} ran in a worktree of their own at ${commit.value.slice(0, 12)}, not the suite's: ${reason}\n`);
        }
      }
    }
    // reason: a plan kept open is re-reviewed when a landing changes a file its failing facts name: the charged red files and
    // the files a failing criterion's verify command names (BR-1379, spec "Fingerprint").
    const failingFactFiles = [...new Set([...(regressionFacts.failing_fact_files ?? []), ...(attestationFacts.failing_fact_files ?? [])])].sort();
    const facts: MilestoneFacts = {
      ...regressionFacts,
      ...attestationFacts,
      failing_fact_files: failingFactFiles,
      outside_anchors: derivation.landings.flatMap((l) =>
        l.outside_anchors !== undefined && l.outside_anchors.length > 0 ? [{ landing: l.landing_commit, files: l.outside_anchors }] : [],
      ),
      unlanded_tasks: derivation.unlanded_tasks,
      no_code_tasks: derivation.no_code_tasks,
      ...(noTaskChangesCode ? { no_task_changes_code: true } : {}),
      not_seen_files: derivation.not_seen_files,
    };
    return ok({ derivation, diffSource, facts, rerunCriterion });
  };

  const reviewOne: AssessWiring["reviewOne"] = async (ref, suiteForPlan) => {
    const measured = await measurePlanFacts(ref);
    if (!measured.ok) return measured;
    const { derivation, diffSource, facts, rerunCriterion } = measured.value;
    const suiteOfPlan = suiteForPlan;
    return reviewService.review(ref, {
      facts,
      ...(rerunCriterion !== undefined ? { rerunCriterion } : {}),
      ...(derivation.status === "derived" ? { diffText: derivation.diff_text } : {}),
      diffSource: describeDiffSource(diffSource),
      maxDiffChars: app.aiProviderService.assessMaxDiffChars,
      ...(suiteOfPlan !== undefined ? { suite: suiteOfPlan } : {}),
    });
  };

  // reason: BR-1379 — the batch measures nothing per landing: no suite and no criterion attestation at a landing commit.
  // A kept-open plan is re-reviewed only when a landing touched a file its failing facts name (`changedFilesSince`).
  const changedFilesSince = createGitChangedFilesSince(inv.cwd, inv.env);

  return { measureSuite, reviewOne, changedFilesSince };
}

/**
 * The issue filing of the run: one issue per root-cause fingerprint on the configured GitHub upstream.
 *
 * @param input.upstream - the GitHub `feedback.upstream`; `undefined` = none configured (the filing is then absent, never faked)
 */
export function createAssessFiling(input: { readonly app: App; readonly inv: Inv; readonly actor: string; readonly upstream: GithubUpstreamCfg | undefined; readonly leases: ReviewLeases }): IssueFilingService | undefined {
  const { app, inv, actor, upstream, leases } = input;
  if (upstream === undefined) return undefined;
  const filingCtx = {
    consumerCorpusRoot: resolveConsumerCorpusRoot(inv.io, inv),
    corpusService: app.corpusService,
    actor,
    home: inv.paths.home,
    env: inv.env,
  };
  return new IssueFilingService(createGithubIssuePort(upstream, filingCtx, app.corpusService, app.corpusService.getPlanCloseIssuePort()), undefined, leases);
}

/** The batch runner over the real app's plan bundle, review docs and issue coverage reads. */
export function createBatchRunner(app: App): ReviewBatchRunner {
  return new ReviewBatchRunner({
    getPlanBundle: (ref) => app.corpusService.getPlanBundle(ref),
    listReviewDocs: (planId) => app.corpusService.listMilestoneReviewDocs(planId),
    issueCoverage: (planId, failed) => app.corpusService.coverageOfFailedDimensions(planId, failed),
    acceptanceLog: gateAcceptanceLogOf(app),
  });
}

/**
 * The decision-log reader of gate acceptances over the app's decision service.
 * reason: with no decision service wired every read fails loud (`unwiredGateAcceptanceLog`), so a close never silently reads "not accepted".
 */
export function gateAcceptanceLogOf(app: App): GateAcceptanceLog {
  const decisions = app.decisionReadService;
  if (decisions === undefined) return unwiredGateAcceptanceLog();
  return createGateAcceptanceLog({ listDecisionLog: async () => decisions.chainRows() });
}

/** What {@link buildBatchRunPorts} binds. */
export interface BatchRunPortsInput {
  readonly app: App;
  readonly actor: string;
  readonly wiring: AssessWiring;
  readonly filing: IssueFilingService | undefined;
  /** The process's keyed leases: each plan of the batch is reviewed under its own plan lease (BR-1511). */
  readonly leases: ReviewLeases;
  /** `direct` (plans named by id, and `lore plan close`) always judges again; `batch` (`--where`) skips a plan whose review stands. */
  readonly mode: "batch" | "direct";
  /** The one close function (`PlanCloseService.close`) around each plan's assess; absent = the runner assesses and archives directly. */
  readonly closeFlow?: BatchRunPorts["closeFlow"];
}

/**
 * The ports of `ReviewBatchRunner` over the real app: settle the owner decision, measure, judge, archive through the gated
 * `CorpusService.set`, record an errored attempt as an audit row.
 */
export function buildBatchRunPorts(input: BatchRunPortsInput): BatchRunPorts {
  const { app, actor, wiring } = input;
  return {
    acquirePlanLease: (planId) => input.leases.acquire(planLeaseKey(planId)),
    mode: input.mode,
    settleRetirement: async (bundle) => {
      if (app.retiredAcService === undefined) return ok(undefined);
      return app.retiredAcService.settle(bundle);
    },
    measureSuite: wiring.measureSuite,
    changedFilesSince: wiring.changedFilesSince,
    reviewPlan: wiring.reviewOne,
    retryPendingIssueWrites: () => app.corpusService.retryPendingKnownDefectIssueWrites(actor),
    closePlan: async (ref) => {
      const closed = await app.corpusService.set(ref, { status: "archived" }, { by: actor });
      return closed.ok ? ok(undefined) : closed;
    },
    recordError: (error) =>
      app.corpusService.appendAudit({
        action: BATCH_ERROR_AUDIT_ACTION,
        sessionId: error.planId,
        docId: error.planId as DocId,
        details: { plan: error.planSlug, fingerprint: error.fingerprint, stage: error.stage, message: error.message, at: error.at, rule: "BR-1379" },
        by: actor,
      }),
    filing: input.filing,
    now: () => new Date().toISOString(),
    ...(input.closeFlow !== undefined ? { closeFlow: input.closeFlow } : {}),
  };
}
