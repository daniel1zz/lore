/**
 * `lore issues [--open|--resolved|--all] [--json]`
 *
 * D4 (spec-issue-closure-loop-computed-resolution-agent-reachable) —
 * upstream-side, agent-reachable listing of every filed issue report (a
 * `task` doc carrying `extra.issue_report`), each row annotated with its
 * COMPUTED resolution (`computeIssueResolution`, `../../../service/
 * issue-resolution.js` — CONSUMED here, never reimplemented). Pull-only: no
 * SessionStart/bootstrap injection wires into this command — that stays
 * rejected per §20 F4 (the spec's own "Out of scope"); an agent PULLS this on
 * demand, it is never pushed automatically.
 *
 * Default `--open` — resolution NOT IN {fixed, rejected, wontfix}, i.e.
 * `open` OR `resolving` (a fix in flight still needs eyes until it actually
 * lands). `--resolved` is the complement (fixed/rejected/wontfix). `--all`
 * shows every issue-report-carrying task regardless of resolution. The three
 * flags are mutually exclusive — passing more than one is a usage error
 * (exit 2), the same mutex shape SPEC-024's `--ai`/`--no-ai` pair uses.
 *
 * Built over `CorpusService.listFull({type: "task"})` — the SAME narrow
 * "extra survives" read `http/issue-reports-routes.ts`'s SPEC-074 dashboard
 * projection uses, for the identical reason (`list()` strips `extra`, which
 * is the only place `issue_report` lives) — plus one `CorpusService.get()`
 * call PER matching task to read its `resolves` in-edges. This is the SAME
 * "N candidates -> N per-doc calls" CLI-scale trade-off `commands/pending.ts`
 * already documents for its own per-doc AI-judgment lookup; there is no bulk
 * "every resolves edge across N docs in one call" read on the service
 * surface today, and adding one is out of this task's anchors (no service
 * file was assigned — see the task doc's "Added after P1 landed" section).
 *
 * Exit codes: 0 success (including the zero-report empty-list case, per
 *   AC-ICL-5's explicit "empty list and exit 0" clause); 2 usage error
 *   (more than one of --open/--resolved/--all passed together).
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D4,
 *   AC-ICL-5.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { relativeTime, formatTable } from "../utils.js";
import {
  hasIssueReport,
  computeIssueResolution,
  type IssueResolution,
} from "../../../service/issue-resolution.js";

/** The 3 terminal resolutions `--open` excludes and `--resolved` selects (D2). */
const TERMINAL_RESOLUTIONS: ReadonlySet<IssueResolution> = new Set<IssueResolution>([
  "fixed",
  "rejected",
  "wontfix",
]);

/** One rendered row — exactly the fields D4 names: title, slug, reporter_project, reported_at, age, computed resolution (plus `id`, useful for piping straight into `lore issue resolve`/`lore get`). */
interface IssueRow {
  id: string;
  slug: string;
  title: string;
  reporter_project: string;
  reported_at: string;
  age: string;
  resolution: IssueResolution;
}

/**
 * Defensive `extra.issue_report.<key>` string reader — mirrors the guard
 * shape `packages/core/src/issue-report.ts::readReporterProject` and
 * `http/issue-reports-routes.ts::projectIssueReportRow` both already use
 * (duplicated rather than imported — same module-boundary reasoning those two
 * document: a malformed/legacy `extra` degrades a field to `""`, never
 * throws).
 */
function readIssueReportString(extra: Record<string, unknown>, key: string): string {
  const issueReport = extra["issue_report"];
  if (issueReport === null || typeof issueReport !== "object" || Array.isArray(issueReport)) {
    return "";
  }
  const value = (issueReport as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/** `reported_at` empty/malformed → "unknown" rather than feeding an unparsable string into `relativeTime` (which would render a nonsensical "NaNm ago"). */
function computeAge(reportedAt: string): string {
  return reportedAt.length > 0 ? relativeTime(reportedAt) : "unknown";
}

export default defineCommand({
  meta: {
    name: "issues",
    description: "List filed issue reports with computed resolution (upstream-side, agent-reachable)",
  },
  args: {
    open: {
      type: "boolean",
      description: "Show only still-open reports (default) — resolution not in fixed/rejected/wontfix",
    },
    resolved: {
      type: "boolean",
      description: "Show only resolved reports (fixed/rejected/wontfix)",
    },
    all: {
      type: "boolean",
      description: "Show every filed report regardless of resolution",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const modeFlagsSet = [args.open === true, args.resolved === true, args.all === true].filter(
      Boolean,
    ).length;
    if (modeFlagsSet > 1) {
      process.stderr.write("Error: --open, --resolved, and --all are mutually exclusive.\n");
      process.exitCode = 2;
      return;
    }
    const mode: "open" | "resolved" | "all" =
      args.all === true ? "all" : args.resolved === true ? "resolved" : "open";

    const { app } = loadLoreApp();
    try {
      const listResult = await app.corpusService.listFull({ type: "task" });
      if (!listResult.ok) {
        process.stderr.write(`Error: ${listResult.error.code}\n`);
        process.exitCode = 1;
        return;
      }

      const issueTasks = listResult.value.docs.filter((d) => hasIssueReport(d.extra));

      const rows: IssueRow[] = [];
      for (const task of issueTasks) {
        const getResult = await app.corpusService.get(task.id);
        // reason: a task that matched listFull() but vanishes before this
        // per-doc get() (deleted between the two calls) degrades to "excluded
        // from this listing" rather than aborting the whole command — the same
        // graceful-partial-result shape commands/pending.ts accepts for its
        // own per-doc lookup loop.
        if (!getResult.ok) continue;

        // See issue.ts's identical filter for why a resolves-typed `related`
        // entry is treated as an inbound edge unconditionally.
        const resolvesInEdges = getResult.value.navigation.related.filter(
          (r) => r.link_type === "resolves",
        );
        const resolution = computeIssueResolution(
          task,
          resolvesInEdges.map((r) => ({ from_id: r.id })),
          resolvesInEdges.map((r) => ({ id: r.id, status: r.status })),
        );

        if (mode === "open" && TERMINAL_RESOLUTIONS.has(resolution)) continue;
        if (mode === "resolved" && !TERMINAL_RESOLUTIONS.has(resolution)) continue;

        const reportedAt = readIssueReportString(task.extra, "reported_at");
        rows.push({
          id: task.id,
          slug: task.slug,
          title: task.title,
          reporter_project: readIssueReportString(task.extra, "reporter_project"),
          reported_at: reportedAt,
          age: computeAge(reportedAt),
          resolution,
        });
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { mode, total: rows.length, reports: rows } }, null, 2));
        return;
      }

      if (rows.length === 0) {
        console.log(`(no ${mode} issue reports)`);
        return;
      }

      console.log(`${mode} issue reports (${rows.length}):`);
      const headers = ["Title", "Slug", "Reporter", "Reported", "Age", "Resolution"];
      const tableRows = rows.map((r) => [
        r.title,
        r.slug,
        r.reporter_project,
        r.reported_at,
        r.age,
        r.resolution,
      ]);
      console.log(formatTable(headers, tableRows));
    } finally {
      app.close();
    }
  },
});
