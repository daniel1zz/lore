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
 * The diff is derived per plan from each landing's own `main_before..landing_commit`
 * (`assess-commit-derivation.ts::deriveLandingDiffForPlan`); a task with no landing record is named, has no measured diff,
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
import type { BatchPlanRow } from "../../../service/review-batch-service.js";
import { buildReviewLease, buildReviewTriggerService } from "../review-batch-wiring.js";
import { err } from "@lore/core";
import { DECISION_FLAG_ARGS, parseDecisionFlags } from "../decision-flags.js";
import { DecisionGate } from "../../../service/decision-gate.js";
import { SpawnDecisionGitPort } from "../../../service/decision-git-port.js";
import { GateAcceptanceService } from "../../../service/gate-acceptance-service.js";
import type { App } from "../../../app.js";
import { buildBatchRunPorts, createAssessFiling, createAssessWiring, createBatchRunner, type AssessWiring } from "../assess-batch-wiring.js";
import { buildPlanCloseService, closeFlowOf } from "../plan-close-wiring.js";
import { isAssessAiBraked } from "../../../ai/resolve-ai.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import { requireBulkLifecycleService } from "../../bulk-wiring.js";
import { resolveBulkSelector, type BulkSelector } from "../../../service/bulk-lifecycle-service.js";
import { failedDimensions, type MilestoneReview, type RetiredAcRef } from "@lore/core";
import type { LoreError } from "@lore/core";

/** One plan's row of the batch result. */
interface AssessRow {
  readonly plan: string;
  readonly outcome: "PASS" | "FAIL" | "ERROR";
  readonly review: string | null;
  readonly failed: readonly string[];
  readonly diff_source: string | null;
  readonly reason: string;
  /** ACs retired during the plan (adr-an-acceptance-criterion-retires-with-the-feature-it); absent when none. */
  readonly retired_acs?: readonly RetiredAcRef[];
  /** The one pending owner decision that confirms them (`lore pending --ask`); absent when none is open. */
  readonly pending_decision?: number;
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
    description: "Milestone review: judge plan(s) on seven dimensions; plan close requires a passing review of the current state",
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

    const { app, config, dbPath } = loadLoreApp({ inv });
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
      let planRefs: string[];
      if (needsReview) {
        // reason: the SAME trigger set the landing computes (BR-1379); a hand run and the detached batch select identically.
        const trigger = buildReviewTriggerService(app, holder, () => err({ code: "VALIDATION_ERROR", field: "spawn", message: "a hand run never spawns a batch" }));
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

      // reason: the measurements, the judge call and the issue filing are one module shared with the review batch and `lore plan close`
      const wiring = createAssessWiring({ app, inv, actor, reviewService });
      const { measureSuite, reviewOne } = wiring;
      const filing = createAssessFiling({ app, inv, actor, upstream: issueUpstream });

      if (args.close === true) {
        return await runBatchClose({ app, inv, dbPath, actor, holder, planRefs, wiring, filing, json: args.json === true });
      }

      const suite = await measureSuite(refs.value);

      const rows: AssessRow[] = [];
      const findings: FailedFinding[] = [];
      for (const ref of refs.value) {
        const bundle = await app.corpusService.getPlanBundle(ref);
        if (!bundle.ok) {
          rows.push(errorRow(ref, bundle.error));
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
        const filed = await filing.fileFindings(findings);
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
      return rows.some((r) => r.outcome !== "PASS") ? 1 : 0;
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
  /** The corpus database path: the plan lease lives in the git common dir of the project two levels above it. */
  readonly dbPath: string;
  readonly actor: string;
  readonly holder: string;
  readonly planRefs: readonly string[];
  readonly wiring: AssessWiring;
  readonly filing: IssueFilingService | undefined;
  readonly json: boolean;
}

/**
 * `lore assess ... --close`: the review batch (BR-1379). Runs `ReviewBatchRunner.runBatch`, which takes each plan's lease
 * (BR-1511), and prints one row per plan with its skip reason. Each plan goes through the ONE close function
 * (`PlanCloseService`, BR-1507) around its assess, so the batch and `lore plan close` share one path. Exits 75 when every
 * selected plan was skipped as held by another holder (nothing ran).
 */
async function runBatchClose(input: BatchCloseInput): Promise<number> {
  const { app, inv, actor } = input;
  const closeService = buildPlanCloseService({ app, inv, dbPath: input.dbPath, actor });
  if (!closeService.ok) {
    inv.io.stderr.write(formatErrorFor(inv, closeService.error) + "\n");
    return exitCode(closeService.error);
  }
  const run = await createBatchRunner(app).runBatch(
    input.planRefs,
    buildBatchRunPorts({ app, actor, wiring: input.wiring, filing: input.filing, leases: input.leases, mode: input.direct ? "direct" : "batch", closeFlow: closeFlowOf(closeService.value) }),
  );
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
