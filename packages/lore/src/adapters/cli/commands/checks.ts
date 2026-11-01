/**
 * lore checks stats [--quality] [--json]
 *
 * What each retained gate and hook has caught. Plain run: runs, denials and last denial per check id, then the
 * removal candidates (>= 30 days observed AND >= 50 runs AND 0 denials). `--quality`: per closed plan, the issues
 * filed within 14 days of its close that cite the plan or one of its tasks, plus reopened tasks and fix tasks
 * (AC-LG-13, AC-LG-14, BR-1373). Every number is computed by `CheckStatsService`; this file parses flags, runs the
 * hooks' outcome ingest first (so the numbers include hook runs since the last call), renders and maps errors.
 *
 * `--quality` reads the project's issue tracker through `feedback.upstream`; an unconfigured or retired upstream is
 * a refusal, never "0 escaped defects".
 *
 * The plain run also prints the plan acceptance section (BR-1379): each accepted plan's time from complete to accepted,
 * and the anomalies (complete, not accepted, not awaiting an unresolved owner decision, over 24 h) with their last error.
 *
 * Exit codes: 0 success; non-zero via `exitCode()` on a store/validation error.
 */
import { defineLoreCommand } from "../cli-exit.js";
import type { LoreError, Result } from "@lore/core";
import type { EscapeIssue } from "../../../service/check-stats-service.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, formatTable } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import { formatAge } from "../../../service/plan-acceptance-view.js";
import { buildCompletePlanLister, buildReviewTriggerService, refuseBatchLeaseForRead, refuseSpawnForRead } from "../review-batch-wiring.js";
import { classifyFeedbackUpstream, resolveGithubIssueListing } from "../report-issue-wiring.js";

export default defineLoreCommand({
  meta: { name: "checks", description: "What each retained gate and hook has caught (BR-1373)" },
  subCommands: {
    stats: defineLoreCommand({
      meta: {
        name: "stats",
        description: "Runs, denials and last denial per check id, removal candidates; --quality adds escaped defects per closed plan",
      },
      args: {
        quality: { type: "boolean", description: "Per closed plan: issues filed within 14 days of close citing it, reopened and fix tasks" },
        json: { type: "boolean", description: "Output as JSON" },
      },
      async run(context) {
        const { args } = context;
        const inv = invocationOf(context);
        const { app, config } = loadLoreApp({ inv });
        try {
          const service = app.checkStatsService;
          if (service === undefined) {
            inv.io.stderr.write("Error: checks stats unavailable (checkStatsService not wired)\n");
            return 1;
          }
          const fail = (error: LoreError): number => {
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          };

          // reason: hooks append outcomes to a local file instead of spawning lore; this call is where lore takes them in.
          const ingested = await service.ingestHookOutcomes();
          if (!ingested.ok) return fail(ingested.error);
          if (ingested.value.malformed > 0) {
            inv.io.stderr.write(`warning: ${ingested.value.malformed} hook outcome line(s) were not valid and were skipped\n`);
          }

          if (args.quality === true) {
            const classification = classifyFeedbackUpstream(config);
            if (classification.kind === "retired") return fail(classification.error);
            if (classification.kind === "unconfigured") {
              return fail({
                code: "VALIDATION_ERROR",
                field: "feedback.upstream",
                message: "--quality counts issues filed after a plan closed, so it needs feedback.upstream.repo in .lore/config.yaml",
                value: null,
                rule: "BR-1373",
              });
            }
            const cfg = classification.cfg;
            const listIssues = async (): Promise<Result<readonly EscapeIssue[], LoreError>> => {
              const listing = await resolveGithubIssueListing(inv.io, cfg, inv);
              // reason: GitHub's listing names the instant `created_at`; the escaped-defect reader names it `createdAt`.
              return listing.ok
                ? { ok: true, value: listing.value.issues.map((issue) => ({ ...issue, ...(issue.created_at === undefined ? {} : { createdAt: issue.created_at }) })) }
                : listing;
            };
            const quality = await service.quality(listIssues);
            if (!quality.ok) return fail(quality.error);
            if (args.json === true) {
              printLine(inv.io.stdout, JSON.stringify({ ok: true, data: quality.value }, null, 2));
              return 0;
            }
            const rows = quality.value.plans.map((p) => [p.plan_slug, p.closed_at, String(p.escaped_issues), String(p.reopened_tasks), String(p.fix_tasks)]);
            printLine(inv.io.stdout, "Escaped defects per closed plan (issues within 14 days of close citing the plan or a task of it):");
            printLine(inv.io.stdout, rows.length > 0 ? formatTable(["Plan", "Closed", "Escaped issues", "Reopened tasks", "Fix tasks"], rows) : "  (no closed plans)");
            return 0;
          }

          const stats = await service.stats();
          if (!stats.ok) return fail(stats.error);
          // BR-1379 self-measurement: time from complete to accepted per plan, and the over-24h anomalies.
          const trigger = buildReviewTriggerService(app, refuseSpawnForRead, refuseBatchLeaseForRead);
          if (trigger === undefined) {
            inv.io.stderr.write("Error: this composition cannot classify complete plans (no lease store or decision reader wired).\n");
            return 1;
          }
          const acceptance = await service.acceptance(buildCompletePlanLister(trigger));
          if (!acceptance.ok) return fail(acceptance.error);
          if (args.json === true) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { ...stats.value, acceptance: acceptance.value } }, null, 2));
            return 0;
          }
          // reason: an informational check cannot deny, so its denial columns would read as "never caught" when the truth is "cannot catch".
          const rows = stats.value.checks.map((c) => [
            c.check_id,
            String(c.runs),
            c.can_deny ? String(c.denials) : "-",
            String(c.errors),
            c.can_deny ? (c.last_denial ?? "never") : "- (informational)",
          ]);
          printLine(inv.io.stdout, "Checks:");
          printLine(inv.io.stdout, rows.length > 0 ? formatTable(["Check", "Runs", "Denials", "Errors", "Last denial"], rows) : "  (no outcomes recorded yet)");
          printLine(inv.io.stdout, "\nRemoval candidates (checks that can deny: >= 30 days observed, >= 50 runs, 0 denials):");
          printLine(inv.io.stdout, stats.value.removal_candidates.length > 0 ? stats.value.removal_candidates.map((id) => `  - ${id}`).join("\n") : "  (none)");
          printLine(inv.io.stdout, "\nPlan acceptance (time from complete to accepted):");
          const accepted = acceptance.value.accepted.map((a) => [a.plan_slug, a.complete_at, a.accepted_at, formatAge(a.complete_to_accepted_ms)]);
          printLine(inv.io.stdout, accepted.length > 0 ? formatTable(["Plan", "Complete", "Accepted", "Took"], accepted) : "  (no accepted plans)");
          printLine(inv.io.stdout, "\nAnomalies (complete, not accepted, not awaiting owner, over 24 h):");
          const anomalyLines = acceptance.value.anomalies.map(
            (a) => `  - ${a.plan_slug}: complete for ${formatAge(a.complete_for_ms)}; last error: ${a.last_error === undefined ? "none recorded" : `${a.last_error.stage}: ${a.last_error.message}`}`,
          );
          printLine(inv.io.stdout, anomalyLines.length > 0 ? anomalyLines.join("\n") : "  (none)");
          return 0;
        } finally {
          app.close();
        }
      },
    }),
  },
});
