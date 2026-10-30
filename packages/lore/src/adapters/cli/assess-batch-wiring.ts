/**
 * The measurements and ports behind `lore assess`, shared by the hand run, the review batch and `lore plan close` (BR-1379, BR-1507).
 *
 * Purpose: ONE place builds what a review of a plan needs — the suite measured once per batch on main, each plan's landing-derived diff
 *   and facts, the judge call, the facts fingerprint, the post-landing attestation, the issue filing and the ports of
 *   `ReviewBatchRunner` — so `lore assess`, the detached batch and the one close function (`PlanCloseService`) never carry a second copy.
 * Public surface: createAssessWiring, createAssessFiling, createBatchRunner, buildBatchRunPorts, listDocsOf, AssessWiring.
 * Invariants:
 *   - Nothing here decides a verdict: it measures, calls the judge and hands the stored review back; the batch runner decides.
 *   - A measurement that cannot be taken is reported on stderr and left absent (not-measured), never read as a pass.
 *   - The plan archive of the batch (`closePlan`) is the gated `CorpusService.set` (the plan-close checkpoint).
 * Side-effect class: IO (git worktrees, the suite, the judge, the issue tracker, corpus writes, stderr warnings).
 */

import { ok, type DocId, type LoreError, type MilestoneFacts, type Result } from "@lore/core";
import type { App } from "../../app.js";
import { IssueFilingService } from "../../service/issue-filing-service.js";
import { landedCommitsOf } from "../../service/milestone-review.js";
import type { SuiteRun } from "../../service/milestone-review-inputs.js";
import { regressionPerLanding } from "../../service/regression-per-landing.js";
import { BATCH_ERROR_AUDIT_ACTION, ReviewBatchRunner, type BatchRunPorts } from "../../service/review-batch-service.js";
import { suiteRunOfResult } from "../../service/suite-result-service.js";
import { readTaskLanding } from "../../service/task-commit-range.js";
import { createGithubIssuePort } from "./assess-file-issues.js";
import { attestPlanLanding, measurePlanAttestation, type ListDocsPort } from "./assess-attestation-wiring.js";
import { deriveLandingDiffForPlan, describeCommitCount, type DiffSourceRecord } from "./assess-commit-derivation.js";
import { createGitLandingAttester } from "./assess-landing-attester.js";
import { createGitMainFirstParent } from "./assess-main-first-parent.js";
import { createGitClearingSourceFinder } from "./assess-regression-clearing.js";
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
          `derived from ${describeCommitCount(source.commits.length, source.excluded_merged_commit_count)} across the plan's tasks` +
          (missing > 0 ? ` (${String(missing)} task(s) NOT MEASURED: no recorded commit range)` : "")
        );
      }
      if (source.status === "unverifiable_convention_mismatch") {
        return "unavailable: every task is archived but none recorded a commit range";
      }
      return `none: ${ASSESS_NO_COMMITS_DERIVED}`;
  }
}

/** The measured inputs of one review, built once per run (see {@link createAssessWiring}). */
export interface AssessWiring {
  /** The suite of main's HEAD, measured once per batch (stored results first, BR-1497); `undefined` when `suiteRefs` is empty. */
  readonly measureSuite: (suiteRefs: readonly string[]) => Promise<SuiteRun | undefined>;
  /** Judges one plan from its landed diff: the one review step the hand run and the batch both use. */
  readonly reviewOne: (ref: string, suite: SuiteRun | undefined) => ReturnType<MilestoneReviewServiceOf["review"]>;
  /** The facts fingerprint a review made now would carry (the batch's re-review test, AC-AF-6). */
  readonly factsFingerprint: (ref: string) => Promise<Result<string, LoreError>>;
  /**
   * Attests each landed task's script criteria at its landing commit and gives each landing its suite result (BR-1497, BR-1498);
   * `undefined` when neither the verify runner nor the suite-result store is wired.
   */
  readonly attestLanded: BatchRunPorts["attestLanded"];
}

/** What {@link createAssessWiring} reads. */
export interface AssessWiringInput {
  readonly app: App;
  readonly inv: Inv;
  /** The acting identity recorded on the evidence the measurements write. */
  readonly actor: string;
  readonly reviewService: MilestoneReviewServiceOf;
}

/**
 * Builds the measurements of `lore assess` over the invocation's checkout.
 *
 * @param input - the app, the invocation, the actor and the milestone review service
 * @returns the closures; they share one hand-over map so a plan measured to fingerprint it is not measured twice for one review
 */
export function createAssessWiring(input: AssessWiringInput): AssessWiring {
  const { app, inv, actor, reviewService } = input;

  // reason: Part D — the plan-close chain and the full suite run ONCE for the whole batch on main's HEAD (in a
  // throwaway worktree, never this checkout) and every plan's regression dimension reads that one result.
  const measureSuite = async (suiteRefs: readonly string[]): Promise<SuiteRun | undefined> => {
    if (suiteRefs.length === 0) return undefined;
    // reason: stale cited evidence is re-verified in this SAME throwaway main worktree, once per batch, before any
    // plan is judged (Part D); a failed refresh leaves its rules stale, which the snapshot rule reads as n/a.
    const verifyRunner = app.verifyRunnerService;
    const refreshStale =
      verifyRunner === undefined
        ? undefined
        : async (root: string): Promise<void> => {
            const refresher = createAppStaleRefresher(app, verifyRunner, {
              executionRoot: root,
              by: actor,
              nowIso: () => new Date().toISOString(),
            });
            const refreshed = await reviewService.refreshStaleCitedRules(suiteRefs, refresher);
            if (!refreshed.ok) {
              inv.io.stderr.write(`Warning: stale cited-rule refresh failed: ${formatErrorFor(inv, refreshed.error)}\n`);
              return;
            }
            for (const failure of refreshed.value.failures) {
              inv.io.stderr.write(`Warning: could not re-verify ${failure.acIds.join(", ")} for ${failure.plan}: ${failure.message}\n`);
            }
          };
    // reason: BR-1497 — main's HEAD is looked up in the suite-result store first; the suite runs only when that
    // commit has no measured result, so a second batch at the same commit runs nothing. Per-landing suite runs and
    // attestation are the post-landing batch's step (`attestLanded` below).
    const suiteResults = app.suiteResultService;
    if (suiteResults === undefined) return { status: "not_measured", reason: "the suite-result store is not wired in this app" };
    const runner = createGitCommitSuiteRunner(inv.cwd, inv.env);
    // reason: A1 noted the stale cited-rule refresh was skipped on a stored-result hit. It now runs, in a worktree at the
    // measured commit, whether or not the suite result was cached (`lookupOrRunWith`), and only when some plan cites a
    // stale rule (so a batch with nothing stale opens no worktree for it).
    const stale = refreshStale === undefined ? ok(false) : await reviewService.hasStaleCitations(suiteRefs);
    if (!stale.ok) return { status: "not_measured", reason: formatErrorFor(inv, stale.error) };
    if (refreshStale === undefined || !stale.value) {
      const looked = await suiteResults.lookupOrRun("main", runner);
      return looked.ok ? suiteRunOfResult(looked.value) : { status: "not_measured", reason: formatErrorFor(inv, looked.error) };
    }
    const refreshed = await suiteResults.lookupOrRunWith("main", runner, (root) => refreshStale(root));
    if (!refreshed.ok) return { status: "not_measured", reason: formatErrorFor(inv, refreshed.error) };
    if (refreshed.value.workError !== undefined) {
      inv.io.stderr.write(`Warning: stale cited-rule refresh could not run: ${formatErrorFor(inv, refreshed.value.workError)}\n`);
    }
    return suiteRunOfResult(refreshed.value.result);
  };

  /** One plan's measured inputs: its landing-derived diff and the facts layer (what a review reads). */
  interface MeasuredPlan {
    readonly derivation: ReturnType<typeof deriveLandingDiffForPlan>;
    readonly diffSource: DiffSourceRecord;
    readonly facts: MilestoneFacts;
    readonly rerunCriterion: ReturnType<typeof createAppCriterionRerunner> | undefined;
  }
  // reason: the batch measures a plan's facts to fingerprint them (AC-AF-6) and, when the fingerprint changed, reviews it
  // from those SAME facts: the measurement is handed over once so a batch never measures (and, for an unrunnable
  // landing, never re-runs the suite) twice for one review.
  const measuredByPlan = new Map<string, MeasuredPlan>();

  /** Measures one plan's diff and facts: the one measurement both the hand run and the batch use. */
  const measurePlanFacts = async (ref: string): Promise<Result<MeasuredPlan, LoreError>> => {
    const bundle = await app.corpusService.getPlanBundle(ref);
    if (!bundle.ok) return bundle;
    // reason: AC-DCS2-12 — a deprecated task is abandoned work, not work without a landing: it is neither measured nor named unlanded
    // (naming it made regression and security not-measured, so a plan with a deprecated task could never close)
    const tasks = bundle.value.tasks.filter((task) => task.status !== "deprecated");
    // reason: #459 — the diff is each landing's own `main_before..landing_commit`; a task without a landing record is
    // named in `unlanded_tasks` (no commit-range fallback).
    const derivation = deriveLandingDiffForPlan(
      inv.cwd,
      tasks.map((t) => ({ slug: t.slug, landing: readTaskLanding(t.extra) })),
      tasks.length > 0 && tasks.every((t) => t.status === "archived"),
    );
    const diffSource: DiffSourceRecord = { mode: "auto_derived", ...derivation };
    // reason: spec D6 — criteria citing a reworded rule are re-run through the same trusted runner as the stale
    // refresh, in this invocation's checkout (the batch's throwaway main worktree is gone once the suite is measured).
    const verifyRunner = app.verifyRunnerService;
    const rerunCriterion =
      verifyRunner === undefined
        ? undefined
        : createAppCriterionRerunner(app, verifyRunner, { executionRoot: inv.cwd, by: actor, nowIso: () => new Date().toISOString() });
    // reason: BR-1496 — regression is measured per landing (suite at each landing commit from the store, failing files
    // re-run at main_before and confirmed); without the suite-result store regression stays not-measured, never pass.
    const suiteResults = app.suiteResultService;
    let regressionFacts: Pick<MilestoneFacts, "regression" | "regression_files" | "landing_result_ids" | "clearing_result_id"> = {};
    if (suiteResults !== undefined) {
      const measured = await regressionPerLanding(derivation.landings, derivation.unlanded_tasks, {
        suites: suiteResults,
        runner: createGitCommitSuiteRunner(inv.cwd, inv.env),
        findClearingSource: createGitClearingSourceFinder(inv.cwd, inv.env, () => suiteResults.listResults()),
      });
      if (measured.ok) {
        regressionFacts = {
          regression: measured.value.rows,
          regression_files: [...new Set(measured.value.uncleared.map((u) => u.file))].sort(),
          landing_result_ids: measured.value.landing_result_ids,
          ...(measured.value.clearing_result_id !== undefined ? { clearing_result_id: measured.value.clearing_result_id } : {}),
        };
      } else {
        inv.io.stderr.write(`Warning: regression per landing not measured for ${ref}: ${formatErrorFor(inv, measured.error)}\n`);
      }
    }
    // reason: BR-1498 — correctness is decided from attestations bound to main from each task's landing; AI-mode
    // criteria go to the judge. Unreadable inputs leave attestation absent (not-measured), never pass.
    let attestationFacts: Pick<MilestoneFacts, "attestation" | "attestation_ids" | "ai_criteria"> = {};
    const attested = await measurePlanAttestation(listDocsOf(app), bundle.value, createGitMainFirstParent(inv.cwd, inv.env));
    if (attested.ok) attestationFacts = attested.value;
    else inv.io.stderr.write(`Warning: criteria attestation not measured for ${ref}: ${formatErrorFor(inv, attested.error)}\n`);
    const facts: MilestoneFacts = {
      ...regressionFacts,
      ...attestationFacts,
      outside_anchors: derivation.landings.flatMap((l) =>
        l.outside_anchors !== undefined && l.outside_anchors.length > 0 ? [{ landing: l.landing_commit, files: l.outside_anchors }] : [],
      ),
      unlanded_tasks: derivation.unlanded_tasks,
    };
    return ok({ derivation, diffSource, facts, rerunCriterion });
  };

  const reviewOne: AssessWiring["reviewOne"] = async (ref, suiteForPlan) => {
    const handedOver = measuredByPlan.get(ref);
    measuredByPlan.delete(ref);
    const measured = handedOver !== undefined ? ok(handedOver) : await measurePlanFacts(ref);
    if (!measured.ok) return measured;
    const { derivation, diffSource, facts, rerunCriterion } = measured.value;
    return reviewService.review(ref, {
      facts,
      ...(rerunCriterion !== undefined ? { rerunCriterion } : {}),
      ...(derivation.status === "derived" ? { diffText: derivation.diff_text } : {}),
      diffSource: describeDiffSource(diffSource),
      maxDiffChars: app.aiProviderService.assessMaxDiffChars,
      ...(suiteForPlan !== undefined ? { suite: suiteForPlan } : {}),
    });
  };

  const factsFingerprint: AssessWiring["factsFingerprint"] = async (ref) => {
    const measured = await measurePlanFacts(ref);
    if (!measured.ok) return measured;
    measuredByPlan.set(ref, measured.value);
    return reviewService.factsFingerprint(ref, measured.value.facts);
  };

  // reason: BR-1498 — the batch attests each landed task's script criteria at its landing commit before judging.
  // reason: BR-1497 — the post-landing batch also runs the suite at each new landing commit that has no stored result, and
  // the attestation rides that run's worktree (`lookupOrRunWith`): one checkout per landing, not one per job.
  const batchVerifyRunner = app.verifyRunnerService;
  const batchSuites = app.suiteResultService;
  const landingRunner = createGitCommitSuiteRunner(inv.cwd, inv.env);
  const attestLanded: AssessWiring["attestLanded"] =
    batchVerifyRunner === undefined && batchSuites === undefined
      ? undefined
      : async (ref: string) => {
          const bundle = await app.corpusService.getPlanBundle(ref);
          if (!bundle.ok) return bundle;
          const attested =
            batchVerifyRunner === undefined
              ? ok(undefined)
              : await attestPlanLanding(
                  listDocsOf(app),
                  bundle.value,
                  createGitMainFirstParent(inv.cwd, inv.env),
                  createGitLandingAttester(
                    inv.cwd,
                    inv.env,
                    (executionRoot) => createAppCriterionRerunner(app, batchVerifyRunner, { executionRoot, by: actor, nowIso: () => new Date().toISOString() }),
                    batchSuites === undefined ? undefined : { suites: batchSuites, runner: landingRunner },
                  ),
                  (line) => inv.io.stderr.write(`${line}\n`),
                );
          if (!attested.ok) return attested;
          if (batchSuites !== undefined) {
            // landings with nothing to attest still get their suite result now (a stored one runs nothing)
            for (const commit of landedCommitsOf(bundle.value.tasks)) {
              const looked = await batchSuites.lookupOrRun(commit, landingRunner);
              if (!looked.ok) inv.io.stderr.write(`Warning: suite at landing ${commit} not measured: ${formatErrorFor(inv, looked.error)}\n`);
            }
          }
          return attested;
        };

  return { measureSuite, reviewOne, factsFingerprint, attestLanded };
}

/**
 * The issue filing of the run: one issue per root-cause fingerprint on the configured GitHub upstream.
 *
 * @param input.upstream - the GitHub `feedback.upstream`; `undefined` = none configured (the filing is then absent, never faked)
 */
export function createAssessFiling(input: { readonly app: App; readonly inv: Inv; readonly actor: string; readonly upstream: GithubUpstreamCfg | undefined }): IssueFilingService | undefined {
  const { app, inv, actor, upstream } = input;
  if (upstream === undefined) return undefined;
  const filingCtx = {
    consumerCorpusRoot: resolveConsumerCorpusRoot(inv.io, inv),
    corpusService: app.corpusService,
    actor,
    home: inv.paths.home,
    env: inv.env,
  };
  return new IssueFilingService(createGithubIssuePort(upstream, filingCtx, app.corpusService, app.corpusService.getPlanCloseIssuePort()));
}

/** The batch runner over the real app's plan bundle, review docs and issue coverage reads. */
export function createBatchRunner(app: App): ReviewBatchRunner {
  return new ReviewBatchRunner({
    getPlanBundle: (ref) => app.corpusService.getPlanBundle(ref),
    listReviewDocs: (planId) => app.corpusService.listMilestoneReviewDocs(planId),
    issueCoverage: (planId, failed) => app.corpusService.coverageOfFailedDimensions(planId, failed),
  });
}

/** What {@link buildBatchRunPorts} binds. */
export interface BatchRunPortsInput {
  readonly app: App;
  readonly actor: string;
  readonly wiring: AssessWiring;
  readonly filing: IssueFilingService | undefined;
  /** The lease the batch runs under: the store lease of the post-landing batch; a no-op handle for `lore plan close` (its own plan lease is the guard). */
  readonly acquireLease: BatchRunPorts["acquireLease"];
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
    acquireLease: input.acquireLease,
    settleRetirement: async (bundle) => {
      if (app.retiredAcService === undefined) return ok(undefined);
      return app.retiredAcService.settle(bundle);
    },
    measureSuite: wiring.measureSuite,
    // reason: with the one close function around the assess, its `verify` step is the attestation; the runner would run it a second time
    ...(wiring.attestLanded !== undefined && input.closeFlow === undefined ? { attestLanded: wiring.attestLanded } : {}),
    factsFingerprint: wiring.factsFingerprint,
    reviewPlan: wiring.reviewOne,
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
