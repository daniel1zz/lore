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
 * `@lore/core`'s single `readIssueTriageLabels`.
 *
 * `--severity <level>` / `--category <value>` (spec-the-defect-channel-
 * reaches-no-machine-but-its-own-github, Scope "Read-side --severity/
 * --category filters on lore issues"; AC-GI-12) narrow the ALREADY-PROJECTED
 * rows to an exact match on that label — no additional `gh` call, since the
 * corpus-side `extra.issue_report.severity`/`category` copy
 * `readIssueTriageLabels` already reads is authoritative for BOTH read
 * branches (an issue's GitHub-body front-matter copy is a second, later
 * write of the SAME declared value, never a second source of truth).
 * Filtering happens BEFORE `renderRows` computes `total`, so a filtered
 * run's `--json` `data.total` is the FILTERED count, never the unfiltered
 * one — the exact census defect this project's own North Star names
 * ("filtering leaves a trace in the count... made a census wrong by 21x").
 *
 * `--verify` (AC-GI-5) is a DIFFERENT operation from the listing above, not
 * a flag that narrows it: it scans EVERY issue-report task carrying a
 * GitHub ref (`readGithubIssueRef`, `service/resolution-projector.js`)
 * regardless of `--open`/`--resolved`/`--all`/`--severity`/`--category`,
 * groups them by repo, and reads back each repo's CURRENT issue labels in
 * exactly ONE batched `GhRunner.run(...)` call per distinct repo — never
 * one call per issue (AC-GI-12: the call count for N=1 equals N=50). A
 * target's corpus-computed resolution (`computeIssueResolution`, consumed
 * verbatim, NEVER re-derived from the label — Per-Field Authority table,
 * "resolution (9 states) | corpus | resolution:* label | NEVER: drift check
 * only") is compared against the label's decoded resolution
 * (`labelToResolution`, same module). `--verify` performs ZERO writes — no
 * `corpusService.set`, no `gh api ... -X ...` mutation — and renders a
 * DELIBERATELY SEPARATE `--json` shape (`data.clean`/`data.divergences`),
 * never `data.reports`: a verify run is a diagnostic report, not a row
 * listing, and folding the two shapes together would let a caller mistake
 * "what GitHub currently shows" for "what the corpus says" — precisely the
 * authority inversion this spec exists to prevent.
 *
 * Exit codes: 0 success (including the zero-report empty-list case, per
 *   AC-ICL-5's explicit "empty list and exit 0" clause, and a clean --verify
 *   run — no divergence found); 1 store failure; 2 usage error (more than
 *   one of --open/--resolved/--all passed together, or an unrecognised
 *   --severity value); 4 a configured upstream that cannot be
 *   opened/validated (`exitCode()`-mapped); 11 --verify found at least one
 *   resolution-label divergence — the next integer past `exitCode()`'s own
 *   highest claimed value (`RATE_LIMITED` -> 10, `adapters/cli/utils.ts`);
 *   `1` is already STORE_ERROR on this same command (`rowsResult.error`), so
 *   reusing it for "divergence found" would make an actual store failure and
 *   a clean-corpus-dirty-label finding indistinguishable on one command.
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D4,
 *   AC-ICL-5, AC-ICL-10; spec-the-defect-channel-cannot-be-honestly-maintained-an
 *   §M4 (AC-DC-5, AC-DC-6) and §M6 (AC-DC-7);
 *   spec-the-defect-channel-reaches-no-machine-but-its-own-github, Scope
 *   "ResolutionProjector"/"GhRunner", Per-Field Authority table, AC-GI-5,
 *   AC-GI-12.
 */

import { dirname } from "node:path";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  err,
  formatIssueCorpusLine,
  isIssueSeverity,
  ok,
  readIssueTriageLabels,
  resolveIssueReadSource,
  ISSUE_SEVERITIES,
  type IssueReadSource,
  type IssueSeverity,
  type LoreError,
  type Result,
} from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { relativeTime, formatTable, exitCode, formatError } from "../utils.js";
import { isGithubUpstreamCfg, resolveDeclaredCorpusPath, resolveFeedbackUpstreamCfg } from "../report-issue-wiring.js";
import { buildUpstreamContext, type UpstreamIssueReportRow } from "../../../flows/upstream-context-flow.js";
import {
  hasIssueReport,
  computeIssueResolution,
  TERMINAL_ISSUE_RESOLUTIONS,
  type IssueResolution,
} from "../../../service/issue-resolution.js";
import { GhRunner, createNodeGhExecFile } from "../../../service/gh-runner.js";
import { readGithubIssueRef, labelToResolution, type GithubIssueRef } from "../../../service/resolution-projector.js";

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
    severity: {
      type: "string",
      description: `Filter to reports whose declared severity exactly matches (${ISSUE_SEVERITIES.join("/")}) — the printed total reflects this filter`,
    },
    category: {
      type: "string",
      description: "Filter to reports whose declared category exactly matches (case-sensitive) — the printed total reflects this filter",
    },
    verify: {
      type: "boolean",
      description:
        "Detect drift between the corpus-computed resolution and each issue's current resolution:* GitHub label — writes nothing, exits 11 on any divergence, 0 when clean",
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

    // reason: validated BEFORE loadLoreApp() opens anything — a bad
    // --severity value is a pure usage error (exit 2, mirrors the
    // modeFlagsSet check above), never a reason to touch the corpus first
    // and fail loud only after.
    const severityFilter = typeof args.severity === "string" ? args.severity : undefined;
    if (severityFilter !== undefined && !isIssueSeverity(severityFilter)) {
      process.stderr.write(`Error: --severity must be one of ${ISSUE_SEVERITIES.join("/")}.\n`);
      process.exitCode = 2;
      return;
    }
    const categoryFilter = typeof args.category === "string" ? args.category : undefined;

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
      // reason: a GitHub-shaped upstream (spec-the-defect-channel-reaches-no-
      // machine-but-its-own-github P2) has no `corpus_path` for this legacy
      // SQLite-shaped read surface to open — refused loudly (never silently
      // treated as "no upstream configured", which would misreport a REAL
      // configuration as absent) unless `--local` bypasses upstream reading
      // entirely. The GitHub-backed read surface (`GitHubIntakePort.listIssues`)
      // is a later phase's own task, out of this task's scope.
      if (upstreamCfg !== undefined && isGithubUpstreamCfg(upstreamCfg) && args.local !== true) {
        process.stderr.write(
          formatError({
            code: "VALIDATION_ERROR",
            field: "feedback.upstream",
            message:
              "this corpus's feedback.upstream is GitHub-configured (repo: " +
              `${upstreamCfg.repo}) — reading it via 'lore issues' is not yet supported ` +
              "(a later phase of spec-the-defect-channel-reaches-no-machine-but-its-own-github). " +
              "Pass --local to read this corpus's own issue reports instead.",
          }) + "\n",
        );
        process.exitCode = 4;
        return;
      }
      const source = resolveIssueReadSource({
        localCorpusRoot: dirname(dirname(dbPath)),
        upstreamCorpusPath:
          upstreamCfg === undefined || isGithubUpstreamCfg(upstreamCfg)
            ? undefined
            : resolveDeclaredCorpusPath(upstreamCfg.corpus_path),
        forceLocal: args.local === true,
      });

      // reason: --verify is a DIFFERENT operation from the listing below, not
      // a narrowing of it (see this file's own header) — dispatched here,
      // BEFORE the mode-filtered read, so it never inherits --open/--resolved/
      // --all's filter and never touches --severity/--category.
      if (args.verify === true) {
        await runVerify(app, source, args.json === true);
        return;
      }

      const rowsResult =
        source.kind === "upstream"
          ? await readUpstreamRows(source.corpus_path, mode)
          : await readLocalRows(app, mode);
      if (!rowsResult.ok) {
        process.stderr.write(formatError(rowsResult.error) + "\n");
        process.exitCode = exitCode(rowsResult.error);
        return;
      }
      // reason: filtering happens HERE, before renderRows computes `total`
      // off the resulting array's length — so a filtered run's `data.total`
      // is the FILTERED count, never the unfiltered one (this file's own
      // header names the census defect a self-consistent-but-unfiltered
      // total would reproduce).
      const filteredRows = filterIssueRows(rowsResult.value, severityFilter, categoryFilter);
      renderRows(filteredRows, mode, source, args.json === true);
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

/**
 * `--severity`/`--category`'s exact-match narrowing over the ALREADY-
 * PROJECTED rows — see this file's own header for why this reads
 * `readIssueTriageLabels`'s existing corpus-side copy rather than issuing a
 * `gh` call: an absent filter value is a no-op (`undefined` skips its own
 * comparison), so passing neither leaves `rows` untouched.
 *
 * @param rows - the mode-filtered, already-projected rows
 * @param severity - `undefined` when `--severity` was not passed
 * @param category - `undefined` when `--category` was not passed
 * @returns the subset of `rows` matching every passed filter — the caller
 *   MUST compute `total` off THIS return value, never off `rows`
 */
function filterIssueRows(rows: IssueRow[], severity: IssueSeverity | undefined, category: string | undefined): IssueRow[] {
  return rows.filter((row) => {
    if (severity !== undefined && row.severity !== severity) return false;
    if (category !== undefined && row.category !== category) return false;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// `--verify` — drift detection between the corpus-computed resolution and
// each issue's current `resolution:*` GitHub label. See this file's own
// header for the full contract; AC-GI-5, AC-GI-12.
// ═══════════════════════════════════════════════════════════════════════════

/** The `--verify` divergence exit code. See this file's own header "Exit codes" for why `11` and why not `1`. */
const VERIFY_DIVERGENCE_EXIT_CODE = 11;

/**
 * Sentinel `github_label_resolution` value when NO label on the issue
 * decodes to a real {@link IssueResolution} member (missing entirely, or a
 * label `labelToResolution` does not recognise) — distinct from every real
 * 9-state member so a reader never mistakes "nothing to decode" for a
 * genuine state, and always still counts as a divergence (the corpus made
 * a determination; GitHub showing nothing recognisable is itself drift).
 */
const NO_RESOLUTION_LABEL = "none";

/** One issue-report task in scope for `--verify`: its identity, corpus-computed resolution, and GitHub pointer. */
interface VerifyTarget {
  readonly id: string;
  readonly slug: string;
  readonly resolution: IssueResolution;
  readonly github: GithubIssueRef;
}

/** One `--verify` finding — both values named, never just "drift detected". */
interface ResolutionDivergence {
  readonly id: string;
  readonly slug: string;
  readonly corpus_resolution: IssueResolution;
  readonly github_label_resolution: string;
}

/** `gh api repos/<repo>/issues?state=all&per_page=100`'s response shape, narrowed to the two fields `--verify` reads. `.passthrough()`: the real payload carries many more fields this command has no use for. */
const GithubVerifyLabelSchema = z.object({ name: z.string() }).passthrough();
const GithubVerifyIssueEntrySchema = z
  .object({ number: z.number(), labels: z.array(GithubVerifyLabelSchema) })
  .passthrough();
const GithubVerifyIssueListSchema = z.array(GithubVerifyIssueEntrySchema);

/**
 * Defensive `JSON.parse` — `gh api`'s stdout is untrusted external text
 * relayed unmodified by `GhRunner.run`. Mirrors the identical
 * `parseJsonSafely` helper `service/github-intake-port.ts` keeps as its own
 * module-private copy (same module-boundary reasoning: duplicated rather
 * than imported, since that symbol is not exported and this task's file
 * anchor is `commands/issues.ts` alone).
 */
function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Collects every LOCAL issue-report task carrying a GitHub ref, regardless
 * of resolution — mirrors {@link readLocalRows}'s per-task resolution
 * computation exactly (same `listFull` + per-task `get()` +
 * `computeIssueResolution` call shape) but applies NO mode filter (`--verify`
 * scans everything, per this file's own header) and keeps the GitHub
 * pointer (`readGithubIssueRef`) instead of projecting a render row —
 * a task with no GitHub ref has nothing for `--verify` to check and is
 * silently excluded, same as `readGithubIssueRef`'s own documented
 * "never filed via GitHub" contract.
 */
async function collectLocalVerifyTargets(app: ReturnType<typeof loadLoreApp>["app"]): Promise<Result<VerifyTarget[], LoreError>> {
  const listResult = await app.corpusService.listFull({ type: "task" });
  if (!listResult.ok) return listResult;

  const targets: VerifyTarget[] = [];
  for (const task of listResult.value.docs.filter((d) => hasIssueReport(d.extra))) {
    const github = readGithubIssueRef(task.extra);
    if (github === undefined) continue;

    const getResult = await app.corpusService.get(task.id);
    // reason: same graceful-partial-result degrade readLocalRows documents
    // for its own identical per-doc get() — a task that vanished between
    // the two calls is excluded from this scan, never an abort.
    if (!getResult.ok) continue;

    const resolvesInEdges = getResult.value.navigation.related.filter((r) => r.link_type === "resolves");
    const resolution = computeIssueResolution(
      task,
      resolvesInEdges.map((r) => ({ from_id: r.id })),
      resolvesInEdges.map((r) => ({ id: r.id, status: r.status })),
    );
    targets.push({ id: task.id, slug: task.slug, resolution, github });
  }
  return ok(targets);
}

/**
 * Collects every UPSTREAM issue-report task carrying a GitHub ref,
 * regardless of resolution — the same `UpstreamPort.listIssueReports` seam
 * {@link readUpstreamRows} uses, keeping each report's ALREADY-computed
 * `resolution` (`UpstreamIssueFacts`, derived at the same site `--list`
 * uses) rather than re-deriving it, and its raw `extra` to extract the
 * GitHub pointer.
 */
async function collectUpstreamVerifyTargets(corpusPath: string): Promise<Result<VerifyTarget[], LoreError>> {
  const portResult = buildUpstreamContext(corpusPath);
  if (!portResult.ok) return portResult;
  const port = portResult.value;
  try {
    const reportsResult = await port.listIssueReports();
    if (!reportsResult.ok) return reportsResult;

    const targets: VerifyTarget[] = [];
    for (const report of reportsResult.value as UpstreamIssueReportRow[]) {
      const github = readGithubIssueRef(report.extra);
      if (github === undefined) continue;
      targets.push({ id: report.id, slug: report.slug, resolution: report.resolution, github });
    }
    return ok(targets);
  } finally {
    port.close();
  }
}

/**
 * Reads back the CURRENT `resolution:*` label for every `target`, batched
 * into exactly ONE `GhRunner.run(["api", ...])` call PER DISTINCT REPO
 * (AC-GI-12: the call count for N=1 equals N=50 when every target shares a
 * repo, which is the common case — a real caller with issues spread across
 * multiple repos costs one call per distinct repo, still independent of N).
 * Constructs its own `GhRunner` directly (mirrors `app.ts`'s identical
 * construction for `ResolutionProjector` — this task's file anchor,
 * `commands/issues.ts` alone, cannot add a new module for it).
 *
 * ⛔ READ-ONLY BY CONSTRUCTION: every call is `["api", "repos/<repo>/
 * issues?state=all&per_page=100"]` — no `-X`, ever.
 *
 * @param targets - the GitHub-ref-carrying targets to read labels for
 * @returns a map keyed `"<repo>#<issueNumber>"` to the label's decoded
 *   {@link IssueResolution}, or `undefined` when no label on that issue
 *   decodes to a real member; `err(...)` on the first failing `gh` call or
 *   unparseable response body
 */
async function fetchGithubLabelResolutions(
  targets: readonly VerifyTarget[],
): Promise<Result<Map<string, IssueResolution | undefined>, LoreError>> {
  const runner = new GhRunner({ execFile: createNodeGhExecFile() });

  const targetsByRepo = new Map<string, VerifyTarget[]>();
  for (const target of targets) {
    const group = targetsByRepo.get(target.github.repo);
    if (group === undefined) {
      targetsByRepo.set(target.github.repo, [target]);
    } else {
      group.push(target);
    }
  }

  const labelResolutions = new Map<string, IssueResolution | undefined>();
  for (const repo of targetsByRepo.keys()) {
    const listResult = await runner.run(["api", `repos/${repo}/issues?state=all&per_page=100`]);
    if (!listResult.ok) return listResult;

    const parsed = GithubVerifyIssueListSchema.safeParse(parseJsonSafely(listResult.value.stdout));
    if (!parsed.success) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gh_issues_verify_response",
        message: `gh returned an issues-list payload --verify could not parse: ${parsed.error.message}`,
        value: listResult.value.stdout,
      });
    }

    for (const entry of parsed.data) {
      const matchingLabel = entry.labels.find((label) => labelToResolution(label.name) !== undefined);
      labelResolutions.set(
        `${repo}#${entry.number}`,
        matchingLabel === undefined ? undefined : labelToResolution(matchingLabel.name),
      );
    }
  }
  return ok(labelResolutions);
}

/**
 * The comparison itself — Per-Field Authority's "drift check only": the
 * corpus resolution NEVER moves, a mismatch (including "no recognisable
 * label at all", {@link NO_RESOLUTION_LABEL}) is simply NAMED, both values
 * verbatim.
 */
function computeDivergences(
  targets: readonly VerifyTarget[],
  labelResolutions: ReadonlyMap<string, IssueResolution | undefined>,
): ResolutionDivergence[] {
  const divergences: ResolutionDivergence[] = [];
  for (const target of targets) {
    const githubResolution = labelResolutions.get(`${target.github.repo}#${target.github.issueNumber}`);
    if (githubResolution === target.resolution) continue;
    divergences.push({
      id: target.id,
      slug: target.slug,
      corpus_resolution: target.resolution,
      github_label_resolution: githubResolution ?? NO_RESOLUTION_LABEL,
    });
  }
  return divergences;
}

/**
 * `--verify`'s ONE render — a DELIBERATELY separate shape from
 * {@link renderRows} (`data.clean`/`data.divergences`, never `data.reports`;
 * see this file's own header for why). Sets {@link VERIFY_DIVERGENCE_EXIT_CODE}
 * on any divergence; leaves `process.exitCode` untouched (this repo's own
 * clean-exit convention, mirrored from every other clean path in this file)
 * when clean.
 */
function renderVerifyResult(source: IssueReadSource, divergences: readonly ResolutionDivergence[], json: boolean): void {
  const clean = divergences.length === 0;

  if (json) {
    console.log( // CLI surface
      JSON.stringify(
        {
          ok: true,
          data: {
            corpus_path: source.corpus_path,
            mode: "verify",
            clean,
            divergences,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatIssueCorpusLine(source.corpus_path)); // CLI surface
    if (clean) {
      console.log("verify: clean — no resolution-label divergences found."); // CLI surface
    } else {
      console.log(`verify: ${divergences.length} divergence(s) found:`); // CLI surface
      for (const divergence of divergences) {
        console.log(`  ${divergence.slug}: corpus=${divergence.corpus_resolution} github=${divergence.github_label_resolution}`); // CLI surface
      }
    }
  }

  if (!clean) {
    process.exitCode = VERIFY_DIVERGENCE_EXIT_CODE;
  }
}

/**
 * `--verify`'s orchestration: collect targets (source-branched, same split
 * as the plain listing) -> batched label read-back -> compare -> render.
 * Zero targets short-circuits BEFORE constructing a `GhRunner` at all — a
 * corpus with no GitHub-filed issue reports has nothing to verify, so no
 * network call is warranted (never a "zero calls" false green for a corpus
 * that DOES have targets, since that path always calls
 * {@link fetchGithubLabelResolutions}).
 */
async function runVerify(app: ReturnType<typeof loadLoreApp>["app"], source: IssueReadSource, json: boolean): Promise<void> {
  const targetsResult =
    source.kind === "upstream" ? await collectUpstreamVerifyTargets(source.corpus_path) : await collectLocalVerifyTargets(app);
  if (!targetsResult.ok) {
    process.stderr.write(formatError(targetsResult.error) + "\n");
    process.exitCode = exitCode(targetsResult.error);
    return;
  }

  const targets = targetsResult.value;
  if (targets.length === 0) {
    renderVerifyResult(source, [], json);
    return;
  }

  const labelsResult = await fetchGithubLabelResolutions(targets);
  if (!labelsResult.ok) {
    process.stderr.write(formatError(labelsResult.error) + "\n");
    process.exitCode = exitCode(labelsResult.error);
    return;
  }

  renderVerifyResult(source, computeDivergences(targets, labelsResult.value), json);
}
