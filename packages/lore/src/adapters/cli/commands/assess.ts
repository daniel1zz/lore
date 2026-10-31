/**
 * lore assess (<plan>... | --where "<filters>") [--json] [--ai|--no-ai]
 *
 * The binding milestone review (BR-1372, spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D).
 * For each plan it sends the plan's landed diff, its documents, its tasks' attested evidence, the state of the rules
 * its spec cites and the `milestone` decisions that belong to it to the configured AI judge, and stores the seven-
 * dimension review (correctness_vs_acs, spec_conformance, regression, design_necessity, snapshot_accuracy,
 * concurrency_safety, security; each pass | fail | na with a reason and a reference) as a knowledge doc
 * (sub_type `milestone-review`) informs-linked to the plan. The review carries the plan-state fingerprint it judged:
 * plan close (`CorpusService.set`, gate `plan-close`) requires a review of the plan's CURRENT state with no failing
 * dimension, and nothing else.
 *
 * Batch contract (Part A): plans are given as ids/slugs or selected with `--where` (the `lore bulk` filter grammar,
 * parsed and resolved by `resolveBulkSelector` / `BulkLifecycleService.preview`; plans only). One row per plan, each
 * with its own verdict; a row fails alone. Exit 0 = every plan passed; 1 = any plan failed its review or could not
 * be reviewed; 2 = usage (no selector, ids and --where together, --no-ai, a bad --where).
 *
 * The diff is derived per plan as each changed file's NET diff across the plan's landings (BR-1508,
 * `assess-commit-derivation.ts::deriveLandingDiffForPlan` -> `assess-final-state-diff.ts`); a task with no landing record is named, has no measured diff,
 * and makes regression and security not-measured (the stored review says so in `diff_source`).
 *
 * Gates (BR-1379): `correctness_vs_acs`, `regression` and `security` keep a plan open when they fail or are not measured
 * (`--close` files their issue and leaves the plan as it was); `lore assess <plan> --accept-gate <regression|security>`
 * with `--reason`, `--premise` and `--alt` records the acceptance (BR-1500, `GateAcceptanceService`) so the plan can close.
 *
 * AI default (SPEC-026 §3 D5): assess has no non-AI mode. It runs with AI on every surface by default; only an
 * EXPLICIT `ai.default_per_surface.<surface> = false` config override requires `--ai`. `--no-ai` is always exit 2.
 *
 * Inputs measured once per batch (Part D): before the first review `assess` runs `bun run check:plan-close` and
 * `bun run test` ONCE on main's HEAD in a throwaway worktree (`assess-suite-runner.ts`) and hands that one result to
 * every plan's regression dimension. `--file-issues` then files the failed findings BY ROOT CAUSE (BR-1379): one GitHub
 * issue per fingerprint (title `<dimension>: <cause> [fp:<12 hex>]`, full fingerprint in the body), an open issue with
 * the fingerprint is linked instead of duplicated, and each issue is linked to every plan sharing it
 * (`IssueFilingService` over `assess-file-issues.ts`); plan close accepts a failing review when every failed dimension
 * has such an OPEN linked issue ("accepted with known defects").
 *
 * `--where needs-review` selects the post-landing trigger set; `--close` runs the review batch under the store lease
 * (judge only when no valid review matches the plan's fingerprint, file by root cause, archive). `lore integrate` starts
 * `lore assess --where needs-review --file-issues --close` detached after a landing.
 *
 * The logic lives in `MilestoneReviewService`; this file resolves flags, derives each plan's diff, renders rows.
 */

import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, formatTable, resolveActor } from "../utils.js";
import { classifyFeedbackUpstream, resolveConsumerCorpusRoot, type GithubUpstreamCfg } from "../report-issue-wiring.js";
import { createGithubIssuePort } from "../assess-file-issues.js";
import { IssueFilingService } from "../../../service/issue-filing-service.js";
import type { FailedFinding } from "../../../service/root-cause-fingerprint.js";
import { retirementAssessFields } from "../../../service/retired-ac-service.js";
import { BATCH_ERROR_AUDIT_ACTION, ReviewBatchRunner, skippedEveryPlan, type BatchPlanRow, type BatchRunPorts } from "../../../service/review-batch-service.js";
import { leaseLostError, planLeaseKey, type LeaseHandle, type ReviewLeases } from "../../../service/review-batch-lease.js";
import { buildReviewLeases, buildReviewTriggerService } from "../review-batch-wiring.js";
import { ASSESS_EXIT_LEASE_HELD, renderAssessExitCodes } from "../assess-exit-codes.js";

export { ASSESS_EXIT_CODES } from "../assess-exit-codes.js";
import { err, ok, type DocId, type Result } from "@lore/core";
import { DECISION_FLAG_ARGS, parseDecisionFlags } from "../decision-flags.js";
import { DecisionGate } from "../../../service/decision-gate.js";
import { SpawnDecisionGitPort } from "../../../service/decision-git-port.js";
import { GateAcceptanceService } from "../../../service/gate-acceptance-service.js";
import type { App } from "../../../app.js";
import { createGitCommitSuiteRunner } from "../assess-suite-runner.js";
import { regressionAtHead } from "../../../service/regression-at-head.js";
import { measurePlanCriteriaAtHead, resolveAssessedCommit, type ListDocsPort } from "../assess-attestation-wiring.js";
import { createGitHeadCriteriaRunner } from "../assess-landing-attester.js";
import { createGitChangedFilesSince, createGitFileExistsAt, createGitFirstParentCommitContaining, createGitFirstParentHistory } from "../assess-regression-git.js";
import { createAppCriterionRerunner, createAppStaleRefresher } from "../assess-stale-refresh.js";
import type { SuiteRun } from "../../../service/milestone-review-inputs.js";
import { ASSESS_NO_COMMITS_DERIVED } from "../cli-refusal-messages.js";
import { isAssessAiBraked } from "../../../ai/resolve-ai.js";
import { deriveLandingDiffForPlan, describeLandingCount, type DiffSourceRecord } from "../assess-commit-derivation.js";
import { findCorpusOnlyTaskSlugs, noCodeRegressionRow } from "../../../service/corpus-only-task.js";
import { readTaskLanding } from "../../../service/task-commit-range.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import { requireBulkLifecycleService } from "../../bulk-wiring.js";
import { resolveBulkSelector, type BulkSelector } from "../../../service/bulk-lifecycle-service.js";
import { failedDimensions, type MilestoneReview, type RetiredAcRef } from "@lore/core";
import type { LoreError, MilestoneFacts, PlanBundle } from "@lore/core";

/** One plan's row of the batch result. */
interface AssessRow {
  readonly plan: string;
  readonly outcome: "PASS" | "FAIL" | "ERROR" | "SKIPPED";
  readonly review: string | null;
  readonly failed: readonly string[];
  readonly diff_source: string | null;
  readonly reason: string;
  /** ACs retired during the plan (adr-an-acceptance-criterion-retires-with-the-feature-it); absent when none. */
  readonly retired_acs?: readonly RetiredAcRef[];
  /** The one pending owner decision that confirms them (`lore pending --ask`); absent when none is open. */
  readonly pending_decision?: number;
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

function errorRow(plan: string, error: LoreError): AssessRow {
  const message = "message" in error && typeof error.message === "string" ? error.message : error.code;
  return { plan, outcome: "ERROR", review: null, failed: [], diff_source: null, reason: `${error.code}: ${message}` };
}

function passFailRow(plan: string, reviewSlug: string, review: MilestoneReview): AssessRow {
  const failed = failedDimensions(review.dimensions);
  return {
    plan,
    outcome: review.overall === "pass" ? "PASS" : "FAIL",
    review: reviewSlug,
    failed,
    diff_source: review.diff_source,
    reason: failed.length === 0 ? "no dimension failed" : `failed: ${failed.join(", ")}`,
  };
}

export default defineLoreCommand({
  meta: {
    name: "assess",
    // reason: AC-RL-4 — the exit codes are rendered from the one table, so the help cannot drift from what the command returns.
    description: `Milestone review: judge plan(s) on seven dimensions; plan close requires a passing review of the current state\n\nExit codes:\n${renderAssessExitCodes()}`,
  },
  args: {
    plan: {
      type: "positional",
      description: "Plan id or slug (more may follow); or use --where",
      required: false,
    },
    where: {
      type: "string",
      description:
        'Select plans by filters instead of ids: "status=approved,tag=...,older-than=30d,open-tasks=0" (plans only); or "needs-review": the complete plans the post-landing batch would process',
    },
    "file-issues": {
      type: "boolean",
      description:
        "File the failed findings by root cause: ONE issue per fingerprint (searched among open issues first, never duplicated), linked to every plan that shares it",
    },
    close: {
      type: "boolean",
      description:
        "Run as the review batch under the store lease: judge a plan only when no valid review matches its current fingerprint, file by root cause, then archive it (accepted, or accepted with known defects)",
    },
    "accept-gate": {
      type: "string",
      description:
        "Accept one failed or not-measured gate (regression | security) of the plan's current review as a known defect so the plan can close; needs --reason, --premise and --alt. correctness_vs_acs cannot be accepted: use `lore ac supersede`",
    },
    ...DECISION_FLAG_ARGS,
    json: { type: "boolean", description: "Output the rows as JSON" },
    ai: {
      type: "boolean",
      // reason: SPEC-024/026 tri-state AI flag — mri collapses --ai/no-flag, so the real detection is the argv scan below.
      description: "Explicitly confirm AI use (rarely needed). Pass --no-ai to abort (always exit 2 — assess has no non-AI mode).",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const hasExplicitAi = inv.argv.includes("--ai");
    const hasExplicitNoAi = inv.argv.includes("--no-ai");
    if (hasExplicitAi && hasExplicitNoAi) {
      inv.io.stderr.write("Error: --ai and --no-ai are mutually exclusive. Pass only one.\n");
      exitCli(2);
    }
    if (hasExplicitNoAi) {
      // reason: assess has no non-AI mode (SPEC-026 §3 D5) — the command name IS the AI intent.
      inv.io.stderr.write("Error: lore assess requires AI; --no-ai is a contradiction. Omit the flag to proceed.\n");
      exitCli(2);
    }

    const positionals = ((args._ as string[] | undefined) ?? (args.plan !== undefined ? [String(args.plan)] : [])).map(String);
    // reason: BR-1500 — accepting a gate is its own verb of this command: it judges no plan and calls no AI, so it is
    // handled before the AI checks below.
    if (args["accept-gate"] !== undefined) return await runAcceptGate(context, positionals);
    // reason: `needs-review` is not a key=value filter; it names the batch's trigger set (BR-1379), resolved below.
    const needsReview = args.where === "needs-review";
    if (needsReview && positionals.length > 0) {
      inv.io.stderr.write("Error: --where needs-review cannot be combined with plan ids.\n");
      return 2;
    }
    const selector = needsReview ? { ok: true as const, value: { kind: "ids" as const, ids: [] } } : resolveBulkSelector(positionals, typeof args.where === "string" ? args.where : undefined);
    if (!selector.ok) {
      inv.io.stderr.write(formatErrorFor(inv, selector.error) + "\n");
      return 2;
    }

    const { app, config } = loadLoreApp({ inv });
    try {
      const fileIssues = args["file-issues"] === true;
      let issueUpstream: GithubUpstreamCfg | undefined;
      if (fileIssues) {
        // reason: refused BEFORE any judge call — a batch that cannot file its issues must not spend the reviews first.
        const classification = classifyFeedbackUpstream(config);
        if (classification.kind === "retired") {
          inv.io.stderr.write(formatErrorFor(inv, classification.error) + "\n");
          return exitCode(classification.error);
        }
        if (classification.kind === "unconfigured") {
          inv.io.stderr.write("Error: --file-issues needs a GitHub `feedback.upstream.repo` in .lore/config.yaml; none is configured.\n");
          return 4;
        }
        issueUpstream = classification.cfg;
      }
      if (!hasExplicitAi && isAssessAiBraked(app.resolveAiDefault(undefined))) {
        inv.io.stderr.write(
          "Error: AI is required for `lore assess` but is disabled for this surface by " +
            "config.ai.default_per_surface. Pass --ai to override.\n",
        );
        return 2;
      }
      const reviewService = app.milestoneReviewService;
      if (reviewService === undefined) throw new Error("milestoneReviewService is not wired on this App instance");

      const actor = resolveActor(inv);
      const holder = `${actor}:assess:${String(process.pid)}`;
      // reason: BR-1511 — plan, suite and issue work is leased per key; a composition without the store's lease verbs cannot review at all.
      const leases = buildReviewLeases(app, holder);
      if (leases === undefined) {
        inv.io.stderr.write("Error: this composition has no lease store, so review work cannot be leased and nothing ran.\n");
        return 1;
      }
      let planRefs: string[];
      if (needsReview) {
        // reason: the SAME trigger set the landing computes (BR-1379); a hand run and the detached batch select identically.
        const trigger = buildReviewTriggerService(app, () => err({ code: "VALIDATION_ERROR", field: "spawn", message: "a hand run never spawns a batch" }));
        if (trigger === undefined) {
          inv.io.stderr.write("Error: this composition cannot compute the needs-review set (no lease store or decision reader wired).\n");
          return 1;
        }
        const set = await trigger.computeTriggerSet();
        if (!set.ok) {
          inv.io.stderr.write(formatErrorFor(inv, set.error) + "\n");
          return exitCode(set.error);
        }
        planRefs = set.value.map((entry) => entry.plan);
      } else {
        const refs = await resolvePlanRefs(selector.value, requireBulkLifecycleService(app));
        if (!refs.ok) {
          inv.io.stderr.write(formatErrorFor(inv, refs.error) + "\n");
          return refs.error.code === "VALIDATION_ERROR" ? 2 : exitCode(refs.error);
        }
        planRefs = refs.value;
      }
      const refs = { ok: true as const, value: planRefs };

      // reason: Part D — the plan-close chain and the full suite run ONCE for the whole batch on main's HEAD (in a
      // throwaway worktree, never this checkout) and every plan's regression dimension reads that one result.
      // reason: main's head as the one batch suite run measured it (set by `measureSuite`); regression reads that commit, never a newer main.
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
          createGitHeadCriteriaRunner(inv.cwd, inv.env, (executionRoot) => createAppCriterionRerunner(app, verifyRunner, { executionRoot, by: actor, nowIso: () => new Date().toISOString() })),
        );
      };

      /** Stamps where the criteria ran, only when some criterion was actually run (a plan with none in scope has nothing to place). */
      const withCriteriaRun = (facts: CriteriaFacts, run: NonNullable<MilestoneFacts["criteria_run"]>): CriteriaFacts =>
        (facts.attestation ?? []).some((row) => row.verdict !== "na") ? { ...facts, criteria_run: run } : facts;

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
        // commit has no measured result, so a second batch at the same commit runs nothing. No suite runs at a landing
        // commit: the batch measures nothing per landing (spec D1). The app's suite service is already bound to the suite leases (BR-1511).
        const suiteResults = app.suiteResultService;
        if (suiteResults === undefined) return { status: "not_measured", reason: "the suite-result store is not wired in this app" };
        const runner = createGitCommitSuiteRunner(inv.cwd, inv.env);
        // reason: ONE worktree at the assessed commit serves the stale cited-rule refresh (only when some plan cites a stale
        // rule) and the plans' script criteria (BR-1498, AC-AO-3): `lookupOrRunWith` rides the suite's own worktree on a fresh
        // run and opens one worktree for this work alone on a stored hit, so criteria run once per review either way.
        const stale = refreshStale === undefined ? ok(false) : await reviewService.hasStaleCitations(suiteRefs);
        if (!stale.ok) return { status: "not_measured", reason: formatErrorFor(inv, stale.error) };
        // reason: BR-1496 (#534) — the batch no longer runs the full suite at main's head: each plan's regression reads the stored
        // suite that contains ITS landings (a full suite runs at head only when none is stored or in flight). What the batch still
        // does once is the head-bound work: the stale cited-rule refresh and the plans' criteria (BR-1498), in one worktree of head.
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

      const filingCtx = {
        consumerCorpusRoot: resolveConsumerCorpusRoot(inv.io, inv),
        corpusService: app.corpusService,
        actor,
        home: inv.paths.home,
        env: inv.env,
      };
      const filing =
        issueUpstream === undefined
          ? undefined
          : new IssueFilingService(createGithubIssuePort(issueUpstream, filingCtx, app.corpusService, app.corpusService.getPlanCloseIssuePort()), undefined, leases);

      /** One plan's measured inputs: its landing-derived diff and the facts layer (what a review reads). */
      interface MeasuredPlan {
        readonly derivation: ReturnType<typeof deriveLandingDiffForPlan>;
        readonly diffSource: DiffSourceRecord;
        readonly facts: MilestoneFacts;
        readonly rerunCriterion: ReturnType<typeof createAppCriterionRerunner> | undefined;
        /** The stored suite the regression read as M; absent when none was read. */
        readonly suite: SuiteRun | undefined;
      }
      /** Measures one plan's diff and facts: the one measurement both the hand run and the batch use. */
      const measurePlanFacts = async (ref: string): Promise<Result<MeasuredPlan, LoreError>> => {
        const bundle = await app.corpusService.getPlanBundle(ref);
        if (!bundle.ok) return bundle;
        const tasks = bundle.value.tasks;
        // reason: #459 — the diff is each landing's own `main_before..landing_commit`; a task without a landing record is
        // named in `unlanded_tasks` (no commit-range fallback).
        // reason: BR-1509 — a task with no anchors, never claimed on a branch and no landing record changes no code: it is
        // listed as having no code, never `unlanded`.
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
            : createAppCriterionRerunner(app, verifyRunner, { executionRoot: inv.cwd, by: actor, nowIso: () => new Date().toISOString() });
        // reason: BR-1496 — regression is measured at the assessed commit: main's head suite (stored per commit, so a second plan at
        // the same head runs nothing), each red file confirmed once and bisected alone; without the suite-result store regression
        // stays not-measured, never pass.
        const suiteResults = app.suiteResultService;
        // reason: the suite the regression read (M) is the one the judge and the main-red ledger see for THIS plan (BR-1496).
        let reviewSuite: SuiteRun | undefined;
        let regressionFacts: Pick<MilestoneFacts, "regression" | "regression_files" | "head_suite_result_id" | "single_file_run_ids" | "assessed_commit" | "failing_fact_files" | "regression_causes"> = {};
        // reason: BR-1509 — when no task changes code, regression is `na` with no suite to run, so it is measured even without
        // the suite-result store.
        const noTaskChangesCode = tasks.length > 0 && derivation.no_code_tasks.length === tasks.length;
        if (noTaskChangesCode) {
          regressionFacts = { regression: [noCodeRegressionRow(derivation.no_code_tasks)], regression_files: [], regression_causes: [], single_file_run_ids: [], failing_fact_files: [] };
        } else if (suiteResults !== undefined) {
          // reason: #535 — one runner per review: its file runs share one prepared worktree per commit, removed in `finally` whatever happened.
          const regressionRunner = createGitCommitSuiteRunner(inv.cwd, inv.env);
          const measured = await (async () => {
            try {
              return await regressionAtHead(derivation.landings, derivation.unlanded_tasks, {
                suites: suiteResults,
                runner: regressionRunner,
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
            reviewSuite = measured.value.suite;
            const chargedFiles = [...new Set(measured.value.charged.map((c) => c.file))].sort();
            regressionFacts = {
              regression: measured.value.rows,
              regression_files: chargedFiles,
              regression_causes: measured.value.causes,
              ...(measured.value.head !== undefined ? { head_suite_result_id: measured.value.head.result_id } : {}),
              single_file_run_ids: measured.value.single_file_run_ids,
              // reason: a plan kept open by a red file is re-reviewed when a later landing changes that file (BR-1379); the batch
              // compares these files with main's changes since the assessed commit.
              failing_fact_files: chargedFiles,
              ...(measured.value.head !== undefined ? { assessed_commit: measured.value.head.commit } : {}),
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
        return ok({ derivation, diffSource, facts, rerunCriterion, suite: reviewSuite });
      };

      /** Judges one plan from its landed diff: the one review step both the hand run and the batch use. */
      const reviewOne = async (ref: string, suiteForPlan: SuiteRun | undefined) => {
        const measured = await measurePlanFacts(ref);
        if (!measured.ok) return measured;
        const { derivation, diffSource, facts, rerunCriterion } = measured.value;
        // reason: the plan's own regression suite (M) wins over a batch-level one: reuse means each plan reads the suite that contains its landings.
        const suiteOfPlan = measured.value.suite ?? suiteForPlan;
        return reviewService.review(ref, {
          facts,
          ...(rerunCriterion !== undefined ? { rerunCriterion } : {}),
          ...(derivation.status === "derived" ? { diffText: derivation.diff_text } : {}),
          diffSource: describeDiffSource(diffSource),
          maxDiffChars: app.aiProviderService.assessMaxDiffChars,
          ...(suiteOfPlan !== undefined ? { suite: suiteOfPlan } : {}),
        });
      };

      if (args.close === true) {
        // reason: BR-1379 — the batch measures nothing per landing: no suite and no criterion attestation at a landing commit.
        // A kept-open plan is re-reviewed only when a landing touched a file its failing facts name (`changedFilesSince`).
        const changedFilesSince = createGitChangedFilesSince(inv.cwd, inv.env);
        return await runBatchClose({ app, inv, actor, leases, direct: !needsReview && typeof args.where !== "string", planRefs, measureSuite, reviewOne, changedFilesSince, filing, json: args.json === true });
      }

      // reason: BR-1511 — a hand review of a plan runs under that plan's lease, taken for every selected plan BEFORE any
      // measuring or writing: a held plan is listed with its holder and expiry (and when every plan is held nothing runs, exit 75).
      const rows: AssessRow[] = [];
      const handles = new Map<string, LeaseHandle>();
      const leasedRefs: string[] = [];
      let heldCount = 0;
      try {
      for (const ref of refs.value) {
        const resolved = await app.corpusService.getPlanBundle(ref);
        if (!resolved.ok) {
          rows.push(errorRow(ref, resolved.error));
          continue;
        }
        const taken = await leases.acquire(planLeaseKey(resolved.value.plan.id));
        if (!taken.ok) {
          rows.push(errorRow(ref, taken.error));
          continue;
        }
        if (taken.value.state === "busy") {
          heldCount += 1;
          rows.push({ plan: ref, outcome: "SKIPPED", review: null, failed: [], diff_source: null, reason: `skipped: held by ${taken.value.holder} until ${taken.value.expires_at}` });
          continue;
        }
        // reason: the plan is read again after its lease is taken; an archived plan is already closed and is skipped, not re-judged.
        const current = await app.corpusService.getPlanBundle(ref);
        if (current.ok && (current.value.plan.status === "archived" || current.value.plan.status === "deprecated")) {
          await taken.value.handle.release();
          rows.push({ plan: ref, outcome: "SKIPPED", review: null, failed: [], diff_source: null, reason: `skipped: already ${current.value.plan.status}` });
          continue;
        }
        handles.set(ref, taken.value.handle);
        leasedRefs.push(ref);
      }
      const fenceAll = async (): Promise<boolean> => {
        for (const handle of handles.values()) {
          const renewed = await handle.renewNow();
          if (!renewed.ok || !renewed.value) return false;
        }
        return true;
      };

      const suite = leasedRefs.length > 0 ? await measureSuite(leasedRefs) : undefined;

      const findings: FailedFinding[] = [];
      for (const ref of leasedRefs) {
        const bundle = await app.corpusService.getPlanBundle(ref);
        if (!bundle.ok) {
          rows.push(errorRow(ref, bundle.error));
          continue;
        }
        // reason: BR-1511 fencing — the plan's lease is renewed before the writes of this review; a failed renewal writes nothing.
        const renewedLease = await handles.get(ref)?.renewNow();
        if (renewedLease === undefined || !renewedLease.ok || !renewedLease.value) {
          rows.push(errorRow(ref, leaseLostError()));
          continue;
        }
        // reason: the owner's answer to an earlier retired-AC question is carried out, and the one pending decision for
        // this plan is raised, BEFORE the review so the review lists what is still retired.
        const retirement = app.retiredAcService !== undefined ? await app.retiredAcService.settle(bundle.value) : undefined;
        if (retirement !== undefined && !retirement.ok) {
          rows.push(errorRow(ref, retirement.error));
          continue;
        }
        const reviewed = await reviewOne(ref, suite);
        const baseRow = reviewed.ok ? passFailRow(ref, reviewed.value.doc.slug, reviewed.value.review) : errorRow(ref, reviewed.error);
        // reason: one serializer for CLI and MCP (retirementAssessFields), so the row shape cannot drift between them.
        const { summary, ...retiredFields } = retirementAssessFields(retirement?.value);
        rows.push(summary === undefined ? baseRow : { ...baseRow, ...retiredFields, reason: `${baseRow.reason}; ${summary}` });
        if (reviewed.ok) {
          for (const dimension of failedDimensions(reviewed.value.review.dimensions)) {
            const judgment = reviewed.value.review.dimensions[dimension];
            findings.push({
              plan: ref,
              dimension,
              reason: judgment.reason,
              reference: judgment.reference,
              cites: judgment.cites,
              reviewSlug: reviewed.value.doc.slug,
              causes: reviewed.value.review.causes,
            });
          }
        }
      }

      let fileError: LoreError | undefined;
      const filedByPlan = new Map<string, number[]>();
      if (filing !== undefined && findings.length > 0) {
        const filed = await filing.fileFindings(findings, fenceAll);
        if (filed.ok) {
          for (const group of filed.value) {
            if (group.error !== undefined) fileError ??= group.error;
            if (group.issue === undefined) continue;
            for (const plan of group.linked) filedByPlan.set(plan, [...(filedByPlan.get(plan) ?? []), group.issue.number]);
          }
        } else {
          fileError = filed.error;
        }
      }
      const outRows = rows.map((r) => (filedByPlan.has(r.plan) ? { ...r, filed_issues: filedByPlan.get(r.plan) } : r));

      if (args.json === true) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { rows: outRows } }, null, 2));
      } else if (rows.length === 0) {
        printLine(inv.io.stdout, "No plans selected.");
      } else {
        printLine(
          inv.io.stdout,
          formatTable(
            ["RESULT", "PLAN", "REVIEW", "REASON"],
            outRows.map((r) => [
              r.outcome,
              r.plan,
              r.review ?? "-",
              "filed_issues" in r && r.filed_issues !== undefined ? `${r.reason}; issues ${r.filed_issues.map((n) => `#${String(n)}`).join(", ")}` : r.reason,
            ]),
          ),
        );
      }
      if (fileError !== undefined) {
        inv.io.stderr.write(formatErrorFor(inv, fileError) + "\n");
        return 1;
      }
      if (heldCount > 0 && heldCount === refs.value.length) {
        inv.io.stderr.write("Every selected plan is leased by another holder; nothing ran. Re-run later.\n");
        return ASSESS_EXIT_LEASE_HELD;
      }
      return rows.some((r) => r.outcome === "FAIL" || r.outcome === "ERROR") ? 1 : 0;
      } finally {
        for (const handle of handles.values()) await handle.release();
      }
    } finally {
      app.close();
    }
  },
});

/**
 * `lore assess <plan> --accept-gate <dimension> --reason ... --premise ... --alt ...` (BR-1500): resolves the flags and
 * hands them to `GateAcceptanceService`; the rules (which gates, the decision, the record) are the service's.
 */
async function runAcceptGate(context: Parameters<typeof invocationOf>[0], positionals: readonly string[]): Promise<number> {
  const inv = invocationOf(context);
  const { args } = context as unknown as { args: Record<string, unknown> };
  if (positionals.length !== 1 || args.where !== undefined || args.close === true || args["file-issues"] === true) {
    inv.io.stderr.write("Error: --accept-gate takes exactly one plan and no --where, --close or --file-issues.\n");
    return 2;
  }
  const draft = parseDecisionFlags(args);
  if (!draft.ok) {
    inv.io.stderr.write(formatErrorFor(inv, draft.error) + "\n");
    return exitCode(draft.error);
  }
  const { app, config } = loadLoreApp({ inv });
  try {
    const classification = classifyFeedbackUpstream(config);
    if (classification.kind === "retired") {
      inv.io.stderr.write(formatErrorFor(inv, classification.error) + "\n");
      return exitCode(classification.error);
    }
    const actor = resolveActor(inv);
    const filing =
      classification.kind === "unconfigured"
        ? undefined
        : new IssueFilingService(
            createGithubIssuePort(
              classification.cfg,
              { consumerCorpusRoot: resolveConsumerCorpusRoot(inv.io, inv), corpusService: app.corpusService, actor, home: inv.paths.home, env: inv.env },
              app.corpusService,
              app.corpusService.getPlanCloseIssuePort(),
            ),
            undefined,
            buildReviewLeases(app, `${actor}:accept-gate:${String(process.pid)}`),
          );
    const service = new GateAcceptanceService({
      getPlanBundle: (ref) => app.corpusService.getPlanBundle(ref),
      listReviewDocs: (planId) => app.corpusService.listMilestoneReviewDocs(planId),
      // reason: the same gate `lore set` applies to an agent's decision (BR-1476); no weight-table lookup is wired because
      // this verb takes no scores, so a decision naming scores or a table is refused rather than passed unchecked.
      gate: new DecisionGate(new SpawnDecisionGitPort(inv.cwd)),
      filing,
      writer: app.corpusService,
      by: actor,
    });
    const accepted = await service.acceptGate(positionals[0] ?? "", String(args["accept-gate"]), draft.value);
    if (!accepted.ok) {
      inv.io.stderr.write(formatErrorFor(inv, accepted.error) + "\n");
      return exitCode(accepted.error);
    }
    const line = `Accepted gate ${accepted.value.dimension} of plan ${accepted.value.plan} as a known defect (issue #${String(accepted.value.issue)}, review ${accepted.value.review}); the next \`lore assess --where needs-review --close\` may archive it.`;
    if (args.json === true) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: accepted.value }, null, 2));
    else printLine(inv.io.stdout, line);
    return 0;
  } finally {
    app.close();
  }
}

/** The inputs of the `--close` batch, built by `run`. */
interface BatchCloseInput {
  readonly app: App;
  readonly inv: ReturnType<typeof invocationOf>;
  readonly actor: string;
  /** The process's keyed leases (BR-1511). */
  readonly leases: ReviewLeases;
  /** True when the plans were named by id (a direct assess always reviews); false for `--where` (a batch). */
  readonly direct: boolean;
  readonly planRefs: readonly string[];
  readonly measureSuite: (refs: readonly string[]) => Promise<SuiteRun | undefined>;
  readonly reviewOne: (ref: string, suite: SuiteRun | undefined) => ReturnType<NonNullable<App["milestoneReviewService"]>["review"]>;
  readonly changedFilesSince: BatchRunPorts["changedFilesSince"];
  readonly filing: IssueFilingService | undefined;
  readonly json: boolean;
}

/** The corpus reader the attestation wiring needs. */
function listDocsOf(app: App): ListDocsPort {
  return async (type) => {
    const listed = await app.corpusService.listFull({ type });
    return listed.ok ? ok(listed.value.docs) : listed;
  };
}

/**
 * `lore assess ... --close`: the review batch (BR-1379). Runs `ReviewBatchRunner.runBatch`, which takes each plan's lease
 * (BR-1511), and prints one row per plan with its skip reason. Exits 75 when every selected plan was skipped as held by
 * another holder (nothing ran); skips as already closed or already reviewed are done work and exit as the rows say.
 */
async function runBatchClose(input: BatchCloseInput): Promise<number> {
  const { app, inv, actor, leases } = input;
  const service = new ReviewBatchRunner({
    getPlanBundle: (ref) => app.corpusService.getPlanBundle(ref),
    listReviewDocs: (planId) => app.corpusService.listMilestoneReviewDocs(planId),
    issueCoverage: (planId, failed) => app.corpusService.coverageOfFailedDimensions(planId, failed),
  });
  const run = await service.runBatch(input.planRefs, {
    acquirePlanLease: (planId) => leases.acquire(planLeaseKey(planId)),
    mode: input.direct ? "direct" : "batch",
    settleRetirement: async (bundle) => {
      if (app.retiredAcService === undefined) return ok(undefined);
      return app.retiredAcService.settle(bundle);
    },
    measureSuite: input.measureSuite,
    ...(input.changedFilesSince !== undefined ? { changedFilesSince: input.changedFilesSince } : {}),
    reviewPlan: input.reviewOne,
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
  });
  if (!run.ok) {
    inv.io.stderr.write(formatErrorFor(inv, run.error) + "\n");
    return exitCode(run.error);
  }
  const rows: readonly BatchPlanRow[] = run.value.rows;
  const heldEvery = skippedEveryPlan(run.value, input.planRefs.length);
  if (input.json) {
    printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { rows, suite_runs: run.value.suiteRuns } }, null, 2));
  } else if (rows.length === 0) {
    printLine(inv.io.stdout, "No plans selected.");
  } else {
    printLine(
      inv.io.stdout,
      formatTable(
        ["RESULT", "PLAN", "REVIEW", "REASON"],
        rows.map((r) => [r.outcome.toUpperCase(), r.plan, r.review ?? "-", r.issues.length > 0 ? `${r.detail}; issues ${r.issues.map((n) => `#${String(n)}`).join(", ")}` : r.detail]),
      ),
    );
  }
  if (heldEvery) {
    inv.io.stderr.write("Every selected plan is leased by another holder; nothing ran. Re-run later.\n");
    return ASSESS_EXIT_LEASE_HELD;
  }
  return rows.some((r) => r.outcome === "error") ? 1 : 0;
}

/** Plans to review: the given ids as they are, or the plans the `--where` selection yields (never a non-plan). */
async function resolvePlanRefs(
  selector: BulkSelector,
  bulk: ReturnType<typeof requireBulkLifecycleService>,
): Promise<{ ok: true; value: string[] } | { ok: false; error: LoreError }> {
  if (selector.kind === "ids") return { ok: true, value: selector.ids.map((i) => i.ref) };
  const preview = await bulk.preview(selector, "close");
  if (!preview.ok) return { ok: false, error: preview.error };
  return { ok: true, value: preview.value.filter((row) => row.type === "plan").map((row) => row.slug) };
}
