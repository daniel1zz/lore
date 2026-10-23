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
 * The diff is derived per plan from the commit range each task recorded at landing
 * (`assess-commit-derivation.ts::deriveCommitSetForPlan`); a plan with no recorded range is reviewed from its
 * documents and evidence, and the stored review says so (`diff_source`).
 *
 * AI default (SPEC-026 §3 D5): assess has no non-AI mode. It runs with AI on every surface by default; only an
 * EXPLICIT `ai.default_per_surface.<surface> = false` config override requires `--ai`. `--no-ai` is always exit 2.
 *
 * Inputs measured once per batch (Part D): before the first review `assess` runs `bun run check:plan-close` and
 * `bun run test` ONCE on main's HEAD in a throwaway worktree (`assess-suite-runner.ts`) and hands that one result to
 * every plan's regression dimension. `--file-issues` then files one GitHub issue per failed dimension (title
 * `<plan>: <dimension>`) through the report-issue path and links each to its plan (`assess-file-issues.ts`); plan close
 * accepts a failing review when every failed dimension has such an OPEN linked issue ("accepted with known defects").
 *
 * The logic lives in `MilestoneReviewService`; this file resolves flags, derives each plan's diff, renders rows.
 */

import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, formatTable, resolveActor } from "../utils.js";
import { classifyFeedbackUpstream, resolveConsumerCorpusRoot, type GithubUpstreamCfg } from "../report-issue-wiring.js";
import { fileDimensionIssues, type FailedDimensionFinding } from "../assess-file-issues.js";
import { createGitSuiteRunner } from "../assess-suite-runner.js";
import { createVerifyStaleRefresher } from "../assess-stale-refresh.js";
import type { SuiteRun } from "../../../service/milestone-review-inputs.js";
import { ASSESS_NO_COMMITS_DERIVED } from "../cli-refusal-messages.js";
import { isAssessAiBraked } from "../../../ai/resolve-ai.js";
import { deriveCommitSetForPlan, describeCommitCount, type DiffSourceRecord } from "../assess-commit-derivation.js";
import { collectRecordedRanges } from "../../../service/task-commit-range.js";
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
      description: 'Select plans by filters instead of ids: "status=approved,tag=...,older-than=30d,open-tasks=0" (plans only)',
    },
    "file-issues": {
      type: "boolean",
      description:
        "File one GitHub issue per failed dimension (title: plan + dimension, body: the finding) through the report-issue path and link each to its plan",
    },
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
    const selector = resolveBulkSelector(positionals, typeof args.where === "string" ? args.where : undefined);
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

      const refs = await resolvePlanRefs(selector.value, requireBulkLifecycleService(app));
      if (!refs.ok) {
        inv.io.stderr.write(formatErrorFor(inv, refs.error) + "\n");
        return refs.error.code === "VALIDATION_ERROR" ? 2 : exitCode(refs.error);
      }

      // reason: Part D — the plan-close chain and the full suite run ONCE for the whole batch on main's HEAD (in a
      // throwaway worktree, never this checkout) and every plan's regression dimension reads that one result.
      let suite: SuiteRun | undefined;
      if (refs.value.length > 0) {
        // reason: stale cited evidence is re-verified in this SAME throwaway main worktree, once per batch, before any
        // plan is judged (Part D); a failed refresh leaves its rules stale, which the snapshot rule reads as n/a.
        const verifyRunner = app.verifyRunnerService;
        const refreshStale =
          verifyRunner === undefined
            ? undefined
            : async (root: string): Promise<void> => {
                const refresher = createVerifyStaleRefresher({
                  verify: verifyRunner,
                  getPlanBundle: (ref) => app.corpusService.getPlanBundle(ref),
                  executionRoot: root,
                  by: resolveActor(inv),
                  nowIso: () => new Date().toISOString(),
                });
                const refreshed = await reviewService.refreshStaleCitedRules(refs.value, refresher);
                if (!refreshed.ok) {
                  inv.io.stderr.write(`Warning: stale cited-rule refresh failed: ${formatErrorFor(inv, refreshed.error)}\n`);
                  return;
                }
                for (const failure of refreshed.value.failures) {
                  inv.io.stderr.write(`Warning: could not re-verify ${failure.acIds.join(", ")} for ${failure.plan}: ${failure.message}\n`);
                }
              };
        const measured = await createGitSuiteRunner(inv.cwd, inv.env, refreshStale).run();
        suite = measured.ok ? measured.value : { status: "not_measured", reason: formatErrorFor(inv, measured.error) };
      }

      const rows: AssessRow[] = [];
      const findings: FailedDimensionFinding[] = [];
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
        const retirementState = retirement?.value;
        const tasks = bundle.value.tasks;
        const derivation = deriveCommitSetForPlan(
          inv.cwd,
          tasks.map((t) => t.slug),
          tasks.length > 0 && tasks.every((t) => t.status === "archived"),
          collectRecordedRanges(tasks),
        );
        const diffSource: DiffSourceRecord = { mode: "auto_derived", ...derivation };
        const reviewed = await reviewService.review(ref, {
          ...(derivation.status === "derived" ? { diffText: derivation.diff_text } : {}),
          diffSource: describeDiffSource(diffSource),
          maxDiffChars: app.aiProviderService.assessMaxDiffChars,
          ...(suite !== undefined ? { suite } : {}),
        });
        const baseRow = reviewed.ok ? passFailRow(ref, reviewed.value.doc.slug, reviewed.value.review) : errorRow(ref, reviewed.error);
        const retiredList =
          retirementState?.state === "pending" || retirementState?.state === "confirmed"
            ? retirementState.retired
            : retirementState?.state === "rejected"
              ? retirementState.restored
              : [];
        rows.push(
          retiredList.length === 0
            ? baseRow
            : {
                ...baseRow,
                retired_acs: retiredList,
                ...(retirementState?.state === "pending" ? { pending_decision: retirementState.pendingId } : {}),
                reason:
                  `${baseRow.reason}; ${String(retiredList.length)} retired AC(s) ${
                    retirementState?.state === "pending"
                      ? `await the owner (decision #${String(retirementState.pendingId)}, lore pending --ask)`
                      : retirementState?.state === "rejected"
                        ? "rejected by the owner and restored"
                        : "confirmed by the owner"
                  }`,
              },
        );
        if (reviewed.ok) {
          for (const dimension of failedDimensions(reviewed.value.review.dimensions)) {
            const judgment = reviewed.value.review.dimensions[dimension];
            findings.push({ plan: ref, dimension, reason: judgment.reason, reference: judgment.reference, reviewSlug: reviewed.value.doc.slug });
          }
        }
      }

      let fileError: LoreError | undefined;
      const filedByPlan = new Map<string, number[]>();
      if (issueUpstream !== undefined && findings.length > 0) {
        const filed = await fileDimensionIssues(
          findings,
          issueUpstream,
          {
            consumerCorpusRoot: resolveConsumerCorpusRoot(inv.io, inv),
            corpusService: app.corpusService,
            actor: resolveActor(inv),
            home: inv.paths.home,
            env: inv.env,
          },
          app.corpusService,
          resolveActor(inv),
        );
        if (filed.ok) {
          for (const issue of filed.value) filedByPlan.set(issue.plan, [...(filedByPlan.get(issue.plan) ?? []), issue.number]);
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
