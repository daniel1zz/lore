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
 * Inputs measured once per batch (Part D): before the first review `assess` does the head-bound work (stale cited-rule
 * refresh, plan criteria) once in a throwaway worktree of main's HEAD (`assess-suite-runner.ts`). No review runs the full suite:
 * each plan's regression runs the selector's tests for its own changed paths at the commit holding its last landing
 * (`assess-selection.ts`, `regression-at-head.ts`). `--file-issues` then files the failed findings BY ROOT CAUSE (BR-1379): one GitHub
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
import { skippedEveryPlan, type BatchPlanRow, type MachineBatchPorts, type MachineBatchRun } from "../../../service/review-batch-service.js";
import { UNKNOWN_MACHINE_ID, batchLeaseKey, leaseLostError, planLeaseKey, type LeaseHandle, type ReviewLeases } from "../../../service/review-batch-lease.js";
import { buildReviewLeases, buildReviewTriggerService, readBatchHandoff, refuseBatchLeaseForRead } from "../review-batch-wiring.js";
import { ASSESS_EXIT_LEASE_HELD, renderAssessExitCodes } from "../assess-exit-codes.js";

export { ASSESS_EXIT_CODES } from "../assess-exit-codes.js";
import { err, ok } from "@lore/core";
import { DECISION_FLAG_ARGS, parseDecisionFlags } from "../decision-flags.js";
import { DecisionGate } from "../../../service/decision-gate.js";
import { SpawnDecisionGitPort } from "../../../service/decision-git-port.js";
import { GateAcceptanceService } from "../../../service/gate-acceptance-service.js";
import type { App } from "../../../app.js";
import { buildBatchRunPorts, gateAcceptanceLogOf, createAssessFiling, createAssessWiring, createBatchRunner, createReviewTestSlots, type AssessWiring } from "../assess-batch-wiring.js";
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
        "Accept one failed or not-measured gate (regression | security) of the plan's current review as a known defect so the plan can close; needs --reason, --premise and --alt. An agent run's call only creates a pending human decision (answer it with `lore pending --ask`, then re-run the same command); a human party accepts at once. correctness_vs_acs cannot be accepted: use `lore ac supersede`",
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
    // reason: released on every exit path (an early return after the batch lease was taken must not leave it held for its 10-minute expiry).
    let batchLease: LeaseHandle | undefined;
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
      // reason: BR-1511 — plan and issue work is leased per key; a composition without the store's lease verbs cannot review at all.
      const leases = buildReviewLeases(app, holder);
      if (leases === undefined) {
        inv.io.stderr.write("Error: this composition has no lease store, so review work cannot be leased and nothing ran.\n");
        return 1;
      }
      // reason: BR-1532 — every review test run on this machine takes one of `workflow.review.machine_test_slots` slots; the runners
      // and rerunners below are built ONLY through the `slot*` decorators of this one `slots`, so no review run bypasses it.
      const slots = createReviewTestSlots(inv, leases, config);
      // reason: BR-1532 — a post-landing batch (`--where needs-review --close`) holds `batch:<machine>` for its whole run: the lease the
      // landing took for it (handoff, one compare-and-set) or, for a hand run, one taken here; busy = another batch runs and covers the plans.
      if (needsReview && args.close === true) {
        const handoff = readBatchHandoff(inv.env);
        if (!handoff.ok) {
          inv.io.stderr.write(formatErrorFor(inv, handoff.error) + "\n");
          return exitCode(handoff.error);
        }
        const machine = await leases.machineId();
        const key = batchLeaseKey(machine);
        const granted = handoff.value !== undefined && handoff.value.key === key ? await leases.acquireHandedOff(key, handoff.value.holder) : await leases.acquire(key);
        if (!granted.ok) {
          inv.io.stderr.write(formatErrorFor(inv, granted.error) + "\n");
          return exitCode(granted.error);
        }
        if (granted.value.state === "busy") {
          inv.io.stderr.write(`Another review batch holds ${key} (${granted.value.holder} until ${granted.value.expires_at}); it re-reads the trigger set when it finishes and covers these plans. Nothing ran.\n`);
          return ASSESS_EXIT_LEASE_HELD;
        }
        batchLease = granted.value.handle;
        printLine(inv.io.stdout, `review batch holds ${key}${machine === UNKNOWN_MACHINE_ID ? " (machine identity unreadable: every such process shares this key)" : ""}`);
      }
      let planRefs: string[];
      if (needsReview) {
        // reason: the SAME trigger set the landing computes (BR-1379); a hand run and the detached batch select identically.
        const trigger = buildReviewTriggerService(app, () => err({ code: "VALIDATION_ERROR", field: "spawn", message: "a hand run never spawns a batch" }), refuseBatchLeaseForRead);
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
      const wiring = createAssessWiring({ app, inv, actor, reviewService, slots });
      const { measureSuite, reviewOne } = wiring;
      const filing = createAssessFiling({ app, inv, actor, upstream: issueUpstream, leases });

      if (args.close === true) {
        // reason: BR-1532 — a post-landing batch loops under its batch lease: it re-reads the trigger set after releasing it and takes plans landed during the run.
        const machineBatch =
          batchLease === undefined
            ? undefined
            : {
                lease: batchLease,
                retakeLease: async () => leases.acquire(batchLeaseKey(await leases.machineId())),
                readTriggerSet: async () => {
                  const trigger = buildReviewTriggerService(app, () => err({ code: "VALIDATION_ERROR", field: "spawn", message: "a hand run never spawns a batch" }), refuseBatchLeaseForRead);
                  if (trigger === undefined) return err<LoreError>({ code: "VALIDATION_ERROR", field: "trigger", message: "this composition cannot compute the needs-review set" });
                  const set = await trigger.computeTriggerSet();
                  return set.ok ? ok(set.value.map((entry) => entry.plan)) : set;
                },
              };
        return await runBatchClose({ app, inv, dbPath, actor, leases, ...(machineBatch !== undefined ? { machineBatch } : {}), direct: !needsReview && typeof args.where !== "string", planRefs, wiring, filing, json: args.json === true });
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
      await batchLease?.release();
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
      writerSource: inv.identity.claimedSource,
      decisions: app.decisionReadService,
      log: gateAcceptanceLogOf(app),
    });
    const accepted = await service.acceptGate(positionals[0] ?? "", String(args["accept-gate"]), draft.value);
    if (!accepted.ok) {
      inv.io.stderr.write(formatErrorFor(inv, accepted.error) + "\n");
      return exitCode(accepted.error);
    }
    const lines = [
      `Accepted gate ${accepted.value.dimension} of plan ${accepted.value.plan} (review ${accepted.value.review}):`,
      ...accepted.value.accepted.map((entry) => `  ${entry.cause}: human decision record ${String(entry.decision_record)}, issue #${String(entry.issue)}`),
      "the next `lore assess --where needs-review --close` may archive it.",
    ];
    if (args.json === true) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: accepted.value }, null, 2));
    else for (const line of lines) printLine(inv.io.stdout, line);
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
  /** The process's keyed leases (BR-1511). */
  readonly leases: ReviewLeases;
  /** True when the plans were named by id (a direct assess always reviews); false for `--where` (a batch). */
  readonly direct: boolean;
  readonly planRefs: readonly string[];
  readonly wiring: AssessWiring;
  /** Set for a post-landing batch: the batch lease it holds and the ports of its re-read loop (BR-1532). */
  readonly machineBatch?: Pick<MachineBatchPorts, "lease" | "retakeLease" | "readTriggerSet">;
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
  const service = createBatchRunner(app);
  const batchPorts = buildBatchRunPorts({ app, actor, wiring: input.wiring, filing: input.filing, leases: input.leases, mode: input.direct ? "direct" : "batch", closeFlow: closeFlowOf(() => buildPlanCloseService({ app, inv, dbPath: input.dbPath, actor })) });
  const run = input.machineBatch === undefined ? await service.runBatch(input.planRefs, batchPorts) : await service.runMachineBatch(input.planRefs, { batch: batchPorts, ...input.machineBatch });
  if (!run.ok) {
    inv.io.stderr.write(formatErrorFor(inv, run.error) + "\n");
    return exitCode(run.error);
  }
  const rows: readonly BatchPlanRow[] = run.value.rows;
  const machineRun: MachineBatchRun | undefined = input.machineBatch === undefined ? undefined : (run.value as MachineBatchRun);
  const heldEvery = skippedEveryPlan(run.value, machineRun?.selected ?? input.planRefs.length);
  if (machineRun?.coveredBy !== undefined) {
    inv.io.stderr.write(`Review batch ended: another batch (${machineRun.coveredBy.holder}) took the lease and will review what is left.\n`);
  }
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
