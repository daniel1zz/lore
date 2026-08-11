/**
 * `lore issues [--open|--resolved|--all] [--local] [--json]`
 *
 * D4 (spec-issue-closure-loop-computed-resolution-agent-reachable) —
 * agent-reachable listing of every filed issue report (a `task` doc carrying
 * `extra.issue_report`), each row annotated with its COMPUTED resolution
 * (`computeIssueResolution`, `../../../service/issue-resolution.js` — CONSUMED,
 * never reimplemented). Pull-only: no SessionStart/bootstrap injection wires
 * into this command — that stays rejected per §20 F4 (the spec's own "Out of
 * scope"); an agent PULLS this on demand, it is never pushed automatically.
 *
 * ── WHICH CORPUS (spec-the-defect-channel-cannot-be-honestly-maintained-an §M4) ──
 * This command used to read the corpus discovered from cwd, unconditionally.
 * That is correct only UPSTREAM-side, and the MEASURED consequence (2026-08-11,
 * a consuming project) was that at the same instant, in the same cwd, `lore
 * issues --all` printed `(no all issue reports)` and `lore issues --open --json`
 * printed `total: 0` while `lore report-issue --list` printed 12 rows (10 open /
 * 2 closed) — because `--list` reads the local receipt ledger joined against the
 * CONFIGURED UPSTREAM. Both commands' help claims to be about upstream reports,
 * so the one an agent is steered toward reported `0`, which reads as "the queue
 * is empty, file freely" — and the CAP counts the side `--list` can see.
 *
 * Resolution now runs through ONE decision seam, `@lore/core`'s
 * `resolveIssueReadSource`:
 *   - `feedback.upstream` configured → THAT corpus (the default).
 *   - `--local` → the cwd corpus, whatever the config says.
 *   - unconfigured → the cwd corpus, exactly as before.
 * ⛔ An upstream that is configured but cannot be opened is a LOUD refusal, never
 * a downgrade to cwd: a fallback would print a clean empty listing, which is
 * byte-identical in shape to "the queue is genuinely empty" — the defect's exact
 * failure mode, reintroduced as a "safety" net.
 *
 * Every run NAMES the corpus it read (§M4's declared render contract): the human
 * output's FIRST line is `formatIssueCorpusLine(...)`'s fixed `Corpus: ` prefix
 * plus the absolute path, and `--json` carries the same value as
 * `data.corpus_path` (plus `data.source`, which distinguishes "read cwd because
 * you asked" from "read cwd because nothing is configured" — a bare path renders
 * those identically and the second one is the state that caused the defect).
 *
 * ── HOW each corpus is read ──
 * The UPSTREAM branch goes through `flows/upstream-context-flow.ts`'s
 * `UpstreamPort.listIssueReports` — the same narrow, schema-version-probed
 * cross-corpus seam `lore report-issue` uses, whose per-report facts are derived
 * at the SAME site `--list`'s `getResolution` uses. That shared derivation is
 * §M4's actual mechanism: the two surfaces can no longer disagree about one
 * report because there is one computation.
 *
 * The LOCAL branch keeps `loadLoreApp()` + `CorpusService` (unchanged: telemetry
 * stays wired, and a local corpus at an older schema keeps being migrated by the
 * normal loader path rather than newly refused by the upstream probe).
 * ⛔ RESIDUAL, named rather than silently inherited: the local branch computes
 * resolution WITHOUT the audit-trail review-rejection lookback the upstream
 * branch performs (`hasRecordedReviewRejection`), because `CorpusService` exposes
 * no audit read. A locally-review-rejected report therefore reads `open` here and
 * `rejected` via `--list`. Pre-existing (this file never had the lookback), out of
 * §M4's scope, and reachable only when reading one's OWN corpus with `--local`.
 *
 * Default `--open` — resolution NOT IN `TERMINAL_ISSUE_RESOLUTIONS`
 * (`../../../service/issue-resolution.js`, the SSOT member set — CONSUMED here,
 * ⛔ never re-listed; this file's own private copy of that set was the second of
 * the two copies §M1 collapsed into one, after they drifted and left resolved
 * reports occupying cap quota), i.e. `open` OR `resolving` (a fix in flight still
 * needs eyes until it actually lands). `--resolved` is the complement — including
 * the two NON-DEROGATORY states (`superseded`/`duplicate`, §M3), which stay
 * VISIBLE here rather than disappearing, and `closed` (P2, D2), which covers an
 * issue task whose OWN status reached `archived` with no `resolves` in-edge and no
 * explicit terminal state ever recorded (every report closed BEFORE the
 * computed-resolution mechanism existed has exactly this shape). `--all` shows
 * every issue-report-carrying task regardless of resolution. The three flags are
 * mutually exclusive — passing more than one is a usage error (exit 2), the same
 * mutex shape SPEC-024's `--ai`/`--no-ai` pair uses. `--local` is orthogonal to
 * all three (it selects the CORPUS, they select the resolution filter).
 *
 * §M6 adds `Severity`/`Category` columns and `--json` keys, read through
 * `@lore/core`'s single `readIssueTriageLabels`. ⛔ ORDERING ONLY — nothing in
 * this listing sorts, groups, or filters by them, and nothing in the cap path
 * reads them at all.
 *
 * Exit codes: 0 success (including the zero-report empty-list case, per
 *   AC-ICL-5's explicit "empty list and exit 0" clause); 1 store failure; 2 usage
 *   error (more than one of --open/--resolved/--all passed together); 4 a
 *   configured upstream that cannot be opened/validated (`exitCode()`-mapped).
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D4,
 *   AC-ICL-5, AC-ICL-10; spec-the-defect-channel-cannot-be-honestly-maintained-an
 *   §M4 (AC-DC-5, AC-DC-6) and §M6 (AC-DC-7).
 */

import { dirname } from "node:path";
import { defineCommand } from "citty";
import {
  formatIssueCorpusLine,
  ok,
  readIssueTriageLabels,
  resolveIssueReadSource,
  type IssueReadSource,
  type IssueSeverity,
  type LoreError,
  type Result,
} from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { relativeTime, formatTable, exitCode, formatError } from "../utils.js";
import { resolveDeclaredCorpusPath, resolveFeedbackUpstreamCfg } from "../report-issue-wiring.js";
import { buildUpstreamContext, type UpstreamIssueReportRow } from "../../../flows/upstream-context-flow.js";
import {
  hasIssueReport,
  computeIssueResolution,
  TERMINAL_ISSUE_RESOLUTIONS,
  type IssueResolution,
} from "../../../service/issue-resolution.js";

/**
 * One rendered row — the fields D4 names (title, slug, reporter_project,
 * reported_at, age, computed resolution) plus `id` (useful for piping straight
 * into `lore issue resolve`/`lore get`) and §M6's two ordering-only labels.
 *
 * `severity`/`category` are OPTIONAL and the key is OMITTED when the filer
 * declared none — an absent label is an honest NOT DECLARED, and a defaulted one
 * would assert a triage judgment nobody made.
 */
interface IssueRow {
  id: string;
  slug: string;
  title: string;
  reporter_project: string;
  reported_at: string;
  age: string;
  resolution: IssueResolution;
  severity?: IssueSeverity;
  category?: string;
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

/** The three mode flags' resolution filter — keyed on the SSOT terminal set, ⛔ never a re-listed membership test. */
function includedByMode(mode: "open" | "resolved" | "all", resolution: IssueResolution): boolean {
  if (mode === "open") return !TERMINAL_ISSUE_RESOLUTIONS.has(resolution);
  if (mode === "resolved") return TERMINAL_ISSUE_RESOLUTIONS.has(resolution);
  return true;
}

/**
 * Projects one already-resolved report into its rendered row — the ONE place a
 * row's field set is composed, so the local and upstream branches cannot render
 * different columns for the same corpus contents.
 *
 * @param doc - identity fields plus the raw `extra` the two defensive readers consume
 * @param resolution - the ALREADY-computed resolution (each branch computes it
 *   with the facts it can reach; see this file's header on the residual)
 */
function projectIssueRow(
  doc: { id: string; slug: string; title: string; extra: Record<string, unknown> },
  resolution: IssueResolution,
): IssueRow {
  const reportedAt = readIssueReportString(doc.extra, "reported_at");
  const triage = readIssueTriageLabels(doc.extra);
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    reporter_project: readIssueReportString(doc.extra, "reporter_project"),
    reported_at: reportedAt,
    age: computeAge(reportedAt),
    resolution,
    ...(triage.severity !== undefined ? { severity: triage.severity } : {}),
    ...(triage.category !== undefined ? { category: triage.category } : {}),
  };
}

export default defineCommand({
  meta: {
    name: "issues",
    description:
      "List filed issue reports with computed resolution — reads the configured feedback.upstream corpus by default (--local reads this corpus), and always names the corpus it read",
  },
  args: {
    open: {
      type: "boolean",
      // reason: the state list is RENDERED from the SSOT set, never typed out —
      // a hand-written help string is exactly how the previous private copy
      // drifted out of date without any test noticing.
      description: `Show only still-open reports (default) — resolution not in ${[...TERMINAL_ISSUE_RESOLUTIONS].join("/")}`,
    },
    resolved: {
      type: "boolean",
      description: `Show only resolved reports (${[...TERMINAL_ISSUE_RESOLUTIONS].join("/")})`,
    },
    all: {
      type: "boolean",
      description: "Show every filed report regardless of resolution",
    },
    local: {
      type: "boolean",
      description:
        "Read THIS corpus (the one discovered from cwd) instead of the configured feedback.upstream corpus",
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

    // reason: loadLoreApp() is called on BOTH branches, not just the local one.
    // It is this command's only source for the consumer's own parsed config
    // (`feedback.upstream`) and for the cwd corpus root, and it is also the
    // established choke point for the missing-`.lore/lore.db` exit and the
    // telemetry/callerSurface wiring every CLI command shares. On the upstream
    // branch its App is simply not read from — the cost is one local SQLite
    // handle, and the alternative (a bespoke findLoreDbPath + loadProjectConfig
    // pair here) would be a second, independently-drifting startup path.
    const { app, dbPath, config } = loadLoreApp();
    try {
      const upstreamCfg = resolveFeedbackUpstreamCfg(config);
      const source = resolveIssueReadSource({
        localCorpusRoot: dirname(dirname(dbPath)),
        upstreamCorpusPath:
          upstreamCfg === undefined ? undefined : resolveDeclaredCorpusPath(upstreamCfg.corpus_path),
        forceLocal: args.local === true,
      });

      const rowsResult =
        source.kind === "upstream"
          ? await readUpstreamRows(source.corpus_path, mode)
          : await readLocalRows(app, mode);
      if (!rowsResult.ok) {
        process.stderr.write(formatError(rowsResult.error) + "\n");
        process.exitCode = exitCode(rowsResult.error);
        return;
      }
      renderRows(rowsResult.value, mode, source, args.json === true);
    } finally {
      app.close();
    }
  },
});

/** Both readers below share ONE return contract, so the caller has a single error rail. */
type RowsResult = Result<IssueRow[], LoreError>;

/**
 * Reads the CONFIGURED UPSTREAM corpus through the narrow, schema-probed
 * `UpstreamPort` — the same seam `lore report-issue` uses, so both read surfaces
 * consume ONE per-report derivation (§M4).
 *
 * @param corpusPath - the absolute upstream corpus root
 * @param mode - the resolution filter to apply
 * @returns the projected rows; `err(...)` VERBATIM from `buildUpstreamContext`
 *   (missing db, schema-version mismatch, unopenable file) — ⛔ never swallowed
 *   into an empty listing
 */
async function readUpstreamRows(corpusPath: string, mode: "open" | "resolved" | "all"): Promise<RowsResult> {
  const portResult = buildUpstreamContext(corpusPath);
  if (!portResult.ok) return portResult;
  const port = portResult.value;
  try {
    const reportsResult = await port.listIssueReports();
    if (!reportsResult.ok) return reportsResult;
    const rows: IssueRow[] = [];
    for (const report of reportsResult.value as UpstreamIssueReportRow[]) {
      if (!includedByMode(mode, report.resolution)) continue;
      rows.push(projectIssueRow(report, report.resolution));
    }
    return ok(rows);
  } finally {
    port.close();
  }
}

/**
 * Reads the cwd corpus via `CorpusService` — behaviour preserved from before §M4
 * (telemetry wired, no schema-version refusal), including the documented residual
 * that this path cannot consult the audit trail for a review-workflow rejection.
 *
 * Built over `CorpusService.listFull({type: "task"})` — the SAME narrow "extra
 * survives" read `http/issue-reports-routes.ts`'s SPEC-074 dashboard projection
 * uses, for the identical reason (`list()` strips `extra`, which is the only place
 * `issue_report` lives) — plus one `CorpusService.get()` call PER matching task to
 * read its `resolves` in-edges. This is the SAME "N candidates -> N per-doc calls"
 * CLI-scale trade-off `commands/pending.ts` already documents for its own per-doc
 * AI-judgment lookup.
 *
 * @param app - the loaded local App
 * @param mode - the resolution filter to apply
 */
async function readLocalRows(
  app: ReturnType<typeof loadLoreApp>["app"],
  mode: "open" | "resolved" | "all",
): Promise<RowsResult> {
  const listResult = await app.corpusService.listFull({ type: "task" });
  if (!listResult.ok) return listResult;

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
    const resolvesInEdges = getResult.value.navigation.related.filter((r) => r.link_type === "resolves");
    const resolution = computeIssueResolution(
      task,
      resolvesInEdges.map((r) => ({ from_id: r.id })),
      resolvesInEdges.map((r) => ({ id: r.id, status: r.status })),
    );
    if (!includedByMode(mode, resolution)) continue;
    rows.push(projectIssueRow(task, resolution));
  }
  return ok(rows);
}

/**
 * The ONE render for both branches — §M4's declared contract lives here.
 *
 * ⛔ The `Corpus: ` line is emitted FIRST, before the count line and before the
 * empty-listing line, on EVERY path: the empty case is precisely where a missing
 * header would go unnoticed, and it is the case the measured defect produced.
 *
 * @param rows - the already-filtered, already-projected rows
 * @param mode - the resolution filter that produced them (rendered in the count line)
 * @param source - which corpus was read and why (both fields reach `--json`)
 * @param json - whether `--json` was passed
 */
function renderRows(
  rows: IssueRow[],
  mode: "open" | "resolved" | "all",
  source: IssueReadSource,
  json: boolean,
): void {
  if (json) {
    console.log( // CLI surface
      JSON.stringify(
        {
          ok: true,
          data: {
            corpus_path: source.corpus_path,
            source: source.kind,
            source_reason: source.why,
            mode,
            total: rows.length,
            reports: rows,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(formatIssueCorpusLine(source.corpus_path)); // CLI surface
  if (rows.length === 0) {
    console.log(`(no ${mode} issue reports)`); // CLI surface
    return;
  }

  console.log(`${mode} issue reports (${rows.length}):`); // CLI surface
  const headers = ["Title", "Slug", "Reporter", "Reported", "Age", "Resolution", "Severity", "Category"];
  const tableRows = rows.map((r) => [
    r.title,
    r.slug,
    r.reporter_project,
    r.reported_at,
    r.age,
    r.resolution,
    r.severity ?? "",
    r.category ?? "",
  ]);
  console.log(formatTable(headers, tableRows)); // CLI surface
}
