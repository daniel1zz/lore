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
 * Resolution runs through ONE decision seam, `@lore/core`'s
 * `resolveIssueReadSource` — but as of P4 (spec-the-defect-channel-reaches-
 * no-machine-but-its-own-github) this command NEVER feeds it a legacy
 * `corpus_path`: that field is retired (parses-but-ignored) since the SQLite
 * `UpstreamPort` it named is deleted outright. A legacy (RETIRED) -shaped
 * `feedback.upstream` is NOT treated as "unconfigured" — `../report-issue-
 * wiring.js`'s `classifyFeedbackUpstream` (spec-lore-issues-falls-through-to-
 * the-local-corpus-on-a-retired D1, the SAME classifier
 * `commands/report-issue.ts` consumes) classifies it `"retired"` and this
 * command refuses loudly unless `--local` bypasses upstream reading
 * entirely (spec D2).
 *   - `feedback.upstream` GITHUB-shaped → reads LIVE (spec-a-github-filed-
 *     defect-must-be-claimable-one-ingest-seam, AC-GR-1/2/10/12) via
 *     `runGithubIssuesListing` (this file, below): `../report-issue-
 *     wiring.js`'s `resolveGithubJoinedRows` fetches the listing +
 *     already-ingested tasks and joins them, this file renders. `--local`
 *     bypasses this entirely and reads the cwd corpus instead.
 *     `--open`/`--resolved`/`--all`/`--severity`/`--category`/`--verify`
 *     ALL WORK against this shape (AC-GR-8, this task's own AC) with the
 *     SAME semantics `run()` already applies to the local branch: mode
 *     filters on the COMPUTED resolution (`includedByGithubMode`, this
 *     file, below — a `not_ingested` row, no corpus task at all, is
 *     bucketed as OPEN, never RESOLVED, keeping the two mutually
 *     exclusive), `--severity`/`--category` narrow on
 *     `readGithubRowTriageLabels`'s reader (corpus `extra` for an
 *     "ingested" row, the GitHub body's own front matter — `parseIssueBody`
 *     — for a "not_ingested" one, since it has no corpus `extra` to read),
 *     and `--verify` (`runGithubVerify`, this file, below) reads each
 *     issue's CURRENT `resolution:*` label straight off
 *     `GitHubIntakePort.listIssues()`'s already-batched result (its
 *     `labels` field, ZERO extra `gh` call — AC-GI-12's invariant
 *     preserved) rather than the local branch's separate
 *     `fetchGithubLabelResolutions` call.
 *   - `feedback.upstream` RETIRED-shaped (legacy `{corpus_path, root_prd}`)
 *     → refused loudly (exit 4) unless `--local`, naming the retired shape
 *     and the `feedback.upstream.repo` remedy — the SAME `LoreError`
 *     `lore report-issue` emits for the identical shape (AC-IS-4).
 *   - `feedback.upstream` unconfigured, or `--local` passed → the cwd
 *     corpus.
 *
 * Every run NAMES the corpus it read (§M4's declared render contract): the human
 * output's FIRST line is `formatIssueCorpusLine(...)`'s fixed `Corpus: ` prefix
 * plus the absolute path, and `--json` carries the same value as
 * `data.corpus_path` (plus `data.source`, which distinguishes "read cwd because
 * you asked" from "read cwd because nothing is configured" — a bare path renders
 * those identically and the second one is the state that caused the defect).
 * The GitHub branch's `data.source` is the literal `"github"` and prints the
 * SAME `Corpus: ` line for the LOCAL corpus its already-ingested tasks live
 * in (never a second, upstream corpus — GitHub has no corpus of its own).
 *
 * ── HOW each corpus is read ──
 * `readLocalRows`/`collectLocalVerifyTargets` read via `loadLoreApp()` +
 * `CorpusService` — the read path for `--local`/unconfigured (the
 * SQLite-shaped `UpstreamPort` read path, `readUpstreamRows`/
 * `collectUpstreamVerifyTargets`, is deleted outright along with the
 * bun:sqlite-backed module it opened). `runGithubIssuesListing` is the
 * GITHUB-shaped read path (see above) — it never calls `readLocalRows`,
 * though it DOES read the same local `CorpusService` for already-ingested
 * tasks to join against the live GitHub listing.
 * ⛔ RESIDUAL, named rather than silently inherited: this branch computes
 * resolution WITHOUT the audit-trail review-rejection lookback the deleted
 * upstream branch used to perform (`hasRecordedReviewRejection`), because
 * `CorpusService` exposes no audit read. A locally-review-rejected report
 * therefore reads `open` here. Pre-existing (this file never had the
 * lookback for the LOCAL branch specifically), out of §M4's scope.
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
 * `readIssueTriageLabels` already reads is authoritative for an "ingested"
 * row on EITHER branch (an issue's GitHub-body front-matter copy is a
 * second, later write of the SAME declared value, never a second source of
 * truth). The GitHub branch's "not_ingested" rows have no corpus `extra` at
 * all — for THOSE, `readGithubRowTriageLabels` (this file, below) falls
 * back to decoding the same front matter straight off the issue's own body
 * (`@lore/core`'s `parseIssueBody`), since a not-yet-ingested issue's ONLY
 * copy of its declared severity/category lives there. Filtering happens
 * BEFORE `renderRows`/`runGithubIssuesListing` compute `total`, so a
 * filtered run's `--json` `data.total` is the FILTERED count, never the
 * unfiltered one — the exact census defect this project's own North Star
 * names ("filtering leaves a trace in the count... made a census wrong by
 * 21x").
 *
 * `--verify` (AC-GI-5) is a DIFFERENT operation from the listing above, not
 * a flag that narrows it, on EITHER branch: it scans EVERY issue-report
 * task carrying a GitHub ref (`readGithubIssueRef`,
 * `service/resolution-projector.js`) regardless of
 * `--open`/`--resolved`/`--all`/`--severity`/`--category`. The LOCAL
 * branch (`runVerify`/`collectLocalVerifyTargets`, unconfigured or
 * `--local`) groups them by repo and reads back each repo's CURRENT issue
 * labels in exactly ONE batched `GhRunner.run(...)` call per distinct repo
 * — never one call per issue (AC-GI-12: the call count for N=1 equals
 * N=50). The GITHUB-configured-upstream branch (`runGithubVerify`, this
 * file, below) makes NO SEPARATE label call at all: `resolveGithubJoinedRows`
 * already fetched the listing (ONE `gh api` call regardless of N,
 * AC-GI-12) with each issue's current `labels` attached
 * (`GitHubIntakePort.listIssues`), so `--verify` here reads them straight
 * off that same in-memory result. On both branches, a target's
 * corpus-computed resolution (`computeIssueResolution`, consumed verbatim,
 * NEVER re-derived from the label — Per-Field Authority table, "resolution
 * (9 states) | corpus | resolution:* label | NEVER: drift check only") is
 * compared against the label's decoded resolution (`labelToResolution`,
 * same module). `--verify` performs ZERO writes — no `corpusService.set`,
 * no `gh api ... -X ...` mutation — and renders a DELIBERATELY SEPARATE
 * `--json` shape (`data.clean`/`data.divergences`), never `data.reports`: a
 * verify run is a diagnostic report, not a row listing, and folding the
 * two shapes together would let a caller mistake "what GitHub currently
 * shows" for "what the corpus says" — precisely the authority inversion
 * this spec exists to prevent.
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

import type { Invocation } from "@lore/core";

import { dirname } from "node:path";
import { defineLoreCommand } from "../cli-exit.js";
import { z } from "zod";
import {
  err,
  formatIssueCorpusLine,
  isIssueSeverity,
  MalformedIssueFrontMatterError,
  ok,
  parseIssueBody,
  readIssueTriageLabels,
  resolveIssueReadSource,
  ISSUE_SEVERITIES,
  type IssueReadSource,
  type IssueSeverity,
  type IssueTriageLabels,
  type LoreError,
  type Result,
} from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { runIssuesSync } from "../issues-sync.js";
import { relativeTime, formatTable, exitCode, formatError, formatErrorFor } from "../utils.js";
import { classifyFeedbackUpstream, resolveGithubJoinedRows, type GithubUpstreamCfg } from "../report-issue-wiring.js";
import type { CorpusLocator } from "../corpus-resolution.js";
import {
  hasIssueReport,
  computeIssueResolution,
  TERMINAL_ISSUE_RESOLUTIONS,
  type IssueResolution,
} from "../../../service/issue-resolution.js";
import { GhRunner, createNodeGhExecFile } from "../../../service/gh-runner.js";
import { invocationOf } from "../command-invocation.js";
import { readGithubIssueRef, labelToResolution, type GithubIssueRef } from "../../../service/resolution-projector.js";
import type { GithubIssueRow } from "../../../service/github-issue-listing.js";
import { printLine } from "../output.js";
import type { CliIo } from "../output.js";
import type { ExitReport } from "../cli-exit.js";

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

// ═══════════════════════════════════════════════════════════════════════════
// GitHub-configured `feedback.upstream` read surface (spec-a-github-filed-
// defect-must-be-claimable-one-ingest-seam, AC-GR-1/2/10/12). Read live via
// `report-issue-wiring.ts::resolveGithubJoinedRows` — never a second
// `GhRunner`/`GitHubIntakePort` construction, never a corpus write.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * §M4's declared header contract's boundary line, PINNED verbatim
 * (AC-GR-10's oracle greps this exact literal): this listing is the live
 * GitHub state, never a union with the local-only pre-GitHub reports
 * `hasIssueReport` also matches — those stay behind `lore issues --local`.
 */
const GITHUB_LISTING_LOCAL_BOUNDARY_NOTE =
  "pre-GitHub local-only reports are not listed here (see 'lore issues --local')";

/**
 * One rendered GitHub-listing row. `resolution` is EITHER a real 9-state
 * `IssueResolution` member (already ingested — D6's computed resolution,
 * never re-derived here) OR the literal `"not_ingested"` — deliberately
 * OUTSIDE that vocabulary (`github-issue-listing.ts`'s own header), so
 * AC-GR-2's two tokens can never collide by construction, not by
 * convention. `severity`/`category` mirror {@link IssueRow}'s identical
 * optional pair (see `readGithubRowTriageLabels`'s own header for where
 * each comes from) and are the two fields `--severity`/`--category`
 * filter on — `filterIssueRows` (below) is generic over both row shapes.
 */
interface GithubProjectedRow {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly resolution: IssueResolution | "not_ingested";
  readonly slug?: string;
  readonly severity?: IssueSeverity;
  readonly category?: string;
}

/**
 * Severity/category for one GitHub-listing row (this task's twin of
 * {@link projectIssueRow}'s `readIssueTriageLabels` call for the local
 * branch). An "ingested" row already has a corpus task, whose
 * `extra.issue_report.{severity,category}` copy `readIssueTriageLabels`
 * reads is authoritative (this file's own header). A "not_ingested" row
 * has NO corpus task and therefore no `extra` to read at all — the only
 * remaining copy of its declared severity/category is the front matter
 * embedded in the GitHub issue body itself, decoded via `@lore/core`'s
 * `parseIssueBody`.
 *
 * @param row - one joined row from `resolveGithubJoinedRows`
 * @returns `{}` when the applicable source declares neither field — a
 *   "not_ingested" row whose body carries no parsable front matter (never
 *   filed through this spec's own filing path, or hand-edited on GitHub)
 *   degrades to "neither field", mirroring every other defensive
 *   `extra`/body reader in this file (`readIssueReportString`) rather than
 *   crashing this read surface over one malformed row.
 */
function readGithubRowTriageLabels(row: GithubIssueRow): IssueTriageLabels {
  if (row.kind === "ingested") return readIssueTriageLabels(row.task.extra);
  try {
    const parsed = parseIssueBody(row.issue.body);
    return parsed.present ? { severity: parsed.fields.severity, category: parsed.fields.category } : {};
  } catch (error) {
    if (error instanceof MalformedIssueFrontMatterError) return {};
    throw error;
  }
}

/** The ONE place a {@link GithubIssueRow} becomes a {@link GithubProjectedRow} — so the human table and `--json` render off the same projection. */
function projectGithubRow(row: GithubIssueRow): GithubProjectedRow {
  const triage = readGithubRowTriageLabels(row);
  const triageFields = {
    ...(triage.severity !== undefined ? { severity: triage.severity } : {}),
    ...(triage.category !== undefined ? { category: triage.category } : {}),
  };
  if (row.kind === "ingested") {
    return {
      number: row.issue.number,
      title: row.issue.title,
      state: row.issue.state,
      resolution: row.resolution,
      slug: row.task.slug,
      ...triageFields,
    };
  }
  return {
    number: row.issue.number,
    title: row.issue.title,
    state: row.issue.state,
    resolution: "not_ingested",
    ...triageFields,
  };
}

/**
 * The GitHub branch's three mode flags' resolution filter — the twin of
 * {@link includedByMode} for the local branch. A `"not_ingested"` row (no
 * corpus task exists yet, G3's "never drops a row" invariant) is bucketed
 * as OPEN, never RESOLVED: an issue nobody has ingested a corpus task for
 * cannot possibly be in a terminal state, and this choice keeps
 * `--open`/`--resolved` mutually exclusive (every row lands in exactly
 * one) while `--all` still shows both — the same completeness
 * {@link includedByMode} guarantees for the local branch.
 */
function includedByGithubMode(mode: "open" | "resolved" | "all", resolution: IssueResolution | "not_ingested"): boolean {
  if (mode === "all") return true;
  const isResolved = resolution !== "not_ingested" && TERMINAL_ISSUE_RESOLUTIONS.has(resolution);
  return mode === "resolved" ? isResolved : !isResolved;
}

/**
 * Reads + joins + renders a GitHub-configured `feedback.upstream`'s live
 * issue listing (AC-GR-1/2/10/12) — the ONE listing implementation
 * `commands/report-issue.ts --list` also calls (via a lazy `import("./
 * issues.js")`, mirroring the MCP tool's lazy import of `report-issue-
 * wiring.ts`), so neither command re-derives its own read/render.
 *
 * `filters.mode`/`.severity`/`.category` (AC-GR-8) apply the SAME semantics
 * `run()` already applies to the local branch: `includedByGithubMode` for
 * the mode filter, `filterIssueRows` (generic, shared with the local
 * branch) for severity/category — both computed BEFORE `data.total`, so a
 * filtered run's total is the FILTERED count (this file's own header names
 * the census defect an unfiltered total would reproduce). `filters`
 * DEFAULTS to `{mode: "all"}` (never filtered) ONLY for a caller that omits
 * it entirely — `commands/report-issue.ts --list`'s existing call, which
 * has no filter flags of its own and has always shown every listed issue;
 * `run()` below NEVER omits it, always passing its own explicitly-derived
 * `mode`.
 *
 * @param app - the loaded local App — `app.corpusService` is the ONLY
 *   corpus consulted for already-ingested tasks (never a second corpus)
 * @param cfg - the GitHub-shaped `feedback.upstream` config
 * @param corpusPath - the local corpus root, printed/reported exactly like
 *   the local branch's `Corpus: ` line (§M4's declared render contract)
 * @param json - whether `--json` was passed
 * @param locator - the run's `cwd` + `env` (an `Invocation`)
 * @param filters - the mode/severity/category filter to apply; omitted by
 *   a caller that wants the unfiltered listing (see above)
 */
export async function runGithubIssuesListing(inv: Invocation, 
  app: ReturnType<typeof loadLoreApp>["app"],
  cfg: GithubUpstreamCfg,
  corpusPath: string,
  json: boolean,
  locator: CorpusLocator,
  filters: {
    readonly mode: "open" | "resolved" | "all";
    readonly severity?: IssueSeverity;
    readonly category?: string;
  } = { mode: "all" },
): Promise<ExitReport> {
  const joinedResult = await resolveGithubJoinedRows(inv.io, app.corpusService, cfg, locator);
  if (!joinedResult.ok) {
    inv.io.stderr.write(formatErrorFor(inv, joinedResult.error) + "\n");
    return exitCode(joinedResult.error);
  }

  const projected = joinedResult.value.rows.map(projectGithubRow);
  const modeFiltered = projected.filter((row) => includedByGithubMode(filters.mode, row.resolution));
  const filtered = filterIssueRows(modeFiltered, filters.severity, filters.category);

  if (json) {
    printLine(inv.io.stdout,  // CLI surface
      JSON.stringify(
        {
          ok: true,
          data: {
            corpus_path: corpusPath,
            source: "github",
            repo: cfg.repo,
            mode: filters.mode,
            total: filtered.length,
            reports: filtered,
            local_note: GITHUB_LISTING_LOCAL_BOUNDARY_NOTE,
          },
        },
        null,
        2,
      ),
    );
    return 0;
  }

  printLine(inv.io.stdout, formatIssueCorpusLine(corpusPath)); // CLI surface
  if (filtered.length === 0) {
    printLine(inv.io.stdout, `(no ${filters.mode} GitHub issue reports)`); // CLI surface
  } else {
    printLine(inv.io.stdout, `GitHub issue reports (${cfg.repo}) (${filtered.length}):`); // CLI surface
    const headers = ["Number", "Title", "State", "Resolution", "Slug", "Severity", "Category"];
    const tableRows = filtered.map((r) => [
      String(r.number),
      r.title,
      r.state,
      r.resolution,
      r.slug ?? "",
      r.severity ?? "",
      r.category ?? "",
    ]);
    printLine(inv.io.stdout, formatTable(headers, tableRows)); // CLI surface
  }
  printLine(inv.io.stdout, GITHUB_LISTING_LOCAL_BOUNDARY_NOTE); // CLI surface
  return 0;
}

/**
 * `--verify` against a GitHub-configured `feedback.upstream` — the GitHub
 * branch's twin of {@link runVerify}. Only "ingested" rows have a
 * corpus-computed resolution to compare against — a "not_ingested" row has
 * no corpus task at all, so there is nothing to verify (mirrors the local
 * branch's own `collectLocalVerifyTargets`, which likewise only ever
 * collects tasks carrying a GitHub ref).
 *
 * ⛔ Makes NO SEPARATE `gh api` call for labels (AC-GI-12 preserved):
 * `resolveGithubJoinedRows` already fetched the listing (ONE call
 * regardless of N) with each issue's current `labels` attached
 * (`GitHubIntakePort.listIssues`, this task's other anchor) — this function
 * reads them straight off that already-in-memory result.
 *
 * ⛔ READ-ONLY (AC-GR-12/AC-GI-12's shared invariant): calls
 * `resolveGithubJoinedRows` only — no write, ever.
 *
 * @param app - the loaded local App
 * @param cfg - the GitHub-shaped `feedback.upstream` config
 * @param corpusPath - the local corpus root (§M4's declared render contract)
 * @param json - whether `--json` was passed
 */
async function runGithubVerify(inv: Invocation, 
  app: ReturnType<typeof loadLoreApp>["app"],
  cfg: GithubUpstreamCfg,
  corpusPath: string,
  json: boolean,
  locator: CorpusLocator,
): Promise<ExitReport> {
  const joinedResult = await resolveGithubJoinedRows(inv.io, app.corpusService, cfg, locator);
  if (!joinedResult.ok) {
    inv.io.stderr.write(formatErrorFor(inv, joinedResult.error) + "\n");
    return exitCode(joinedResult.error);
  }

  const divergences: ResolutionDivergence[] = [];
  for (const row of joinedResult.value.rows) {
    if (row.kind !== "ingested") continue; // reason: no corpus task, no corpus-computed resolution to compare.
    const labels = row.issue.labels ?? [];
    const matchingLabel = labels.find((label) => labelToResolution(label) !== undefined);
    const githubResolution = matchingLabel === undefined ? undefined : labelToResolution(matchingLabel);
    if (githubResolution === row.resolution) continue;
    divergences.push({
      id: row.task.id,
      slug: row.task.slug,
      corpus_resolution: row.resolution,
      github_label_resolution: githubResolution ?? NO_RESOLUTION_LABEL,
    });
  }

  return renderVerifyResult(inv.io, corpusPath, divergences, json);
}

export default defineLoreCommand({
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
    sync: {
      type: "boolean",
      description:
        "List GitHub issue drift (a fixed report whose archived fix left the issue open or unlabelled; a terminal report missing its resolution:* label) — writes nothing without --apply",
    },
    apply: {
      type: "boolean",
      description: "With --sync: repair the drift — close + label fixed reports, only label the other terminal states; exits 1 when any repair fails",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context): Promise<number> {
    const inv = invocationOf(context);
    const { args } = context;
    // spec-archiving-the-work-that-resolves-a-defect-report-closes D3 — --sync is its own operation
    // (never a narrowing of the listing); --apply means nothing alone. Usage errors exit 2 BEFORE the
    // corpus is opened.
    if (args.apply === true && args.sync !== true) {
      inv.io.stderr.write("Error: --apply is only meaningful with --sync.\n");
      return 2;
    }
    if (args.sync === true && (args.verify === true || args.open === true || args.resolved === true || args.all === true || args.local === true)) {
      inv.io.stderr.write("Error: --sync cannot be combined with --verify, --open, --resolved, --all or --local.\n");
      return 2;
    }
    if (args.sync === true) {
      const { app: syncApp } = loadLoreApp({ inv });
      try {
        return await runIssuesSync(inv, syncApp.issueClose, { apply: args.apply === true, json: args.json === true });
      } finally {
        syncApp.close();
      }
      return 0;
    }
    const modeFlagsSet = [args.open === true, args.resolved === true, args.all === true].filter(
      Boolean,
    ).length;
    if (modeFlagsSet > 1) {
      inv.io.stderr.write("Error: --open, --resolved, and --all are mutually exclusive.\n");
      return 2;
    }
    const mode: "open" | "resolved" | "all" =
      args.all === true ? "all" : args.resolved === true ? "resolved" : "open";

    // reason: validated BEFORE loadLoreApp() opens anything — a bad
    // --severity value is a pure usage error (exit 2, mirrors the
    // modeFlagsSet check above), never a reason to touch the corpus first
    // and fail loud only after.
    const severityFilter = typeof args.severity === "string" ? args.severity : undefined;
    if (severityFilter !== undefined && !isIssueSeverity(severityFilter)) {
      inv.io.stderr.write(`Error: --severity must be one of ${ISSUE_SEVERITIES.join("/")}.\n`);
      return 2;
    }
    const categoryFilter = typeof args.category === "string" ? args.category : undefined;

    // reason: loadLoreApp() is this command's only source for the consumer's
    // own parsed config (`feedback.upstream`) and for the cwd corpus root,
    // and it is also the established choke point for the missing-
    // `.lore/lore.db` exit and the telemetry/callerSurface wiring every CLI
    // command shares.
    const { app, dbPath, config } = loadLoreApp({ inv });
    try {
      // reason: ONE shared classifier (spec-lore-issues-falls-through-to-the-
      // local-corpus-on-a-retired D1) — `commands/report-issue.ts` consumes
      // the SAME function, so a retired-shape upstream cannot drift back
      // into two independently-derived verdicts.
      const classification = classifyFeedbackUpstream(config);
      // reason: a RETIRED-shaped upstream (spec-lore-issues-falls-through-to-
      // the-local-corpus-on-a-retired D1) is refused loudly — never silently
      // treated as "no upstream configured", which would misreport a REAL
      // configuration as absent — unless `--local` bypasses upstream reading
      // entirely. A GitHub-shaped upstream is handled by the dedicated
      // branch below (spec-a-github-filed-defect-must-be-claimable-one-
      // ingest-seam, AC-GR-1/2/10/12: `runGithubIssuesListing` reads live via
      // `report-issue-wiring.ts::resolveGithubJoinedRows`).
      if (args.local !== true && classification.kind === "retired") {
        inv.io.stderr.write(formatErrorFor(inv, classification.error) + "\n");
        return exitCode(classification.error);
      }
      // reason: the GitHub read surface (AC-GR-1/2/10/12, AC-GR-8) applies
      // ALL SIX flags — `--verify` is a different operation dispatched
      // first (`runGithubVerify`, mirrors the local branch's own ordering
      // just above `readLocalRows`), then `--open`/`--resolved`/`--all`/
      // `--severity`/`--category` all narrow `runGithubIssuesListing`'s
      // listing via the SAME `mode`/`severityFilter`/`categoryFilter` this
      // function already derived for the local branch above.
      if (args.local !== true && classification.kind === "github") {
        if (args.verify === true) {
          return await runGithubVerify(inv, app, classification.cfg, dirname(dirname(dbPath)), args.json === true, inv);
        }
        return await runGithubIssuesListing(inv, app, classification.cfg, dirname(dirname(dbPath)), args.json === true, inv, {
          mode,
          ...(severityFilter !== undefined ? { severity: severityFilter } : {}),
          ...(categoryFilter !== undefined ? { category: categoryFilter } : {}),
        });
      }
      // reason: `upstreamCorpusPath` is ALWAYS undefined here (P4,
      // spec-the-defect-channel-reaches-no-machine-but-its-own-github) — the
      // legacy `feedback.upstream.corpus_path` field is retired
      // (parses-but-ignored: no `UpstreamPort` implementation exists anymore
      // to open it against). Every non-local upstream shape is disposed of
      // ABOVE, before this call — the retired shape returns (exit
      // `exitCode(classification.error)`) via `classification.kind ===
      // "retired"`, the GitHub shape always returns via
      // `runGithubVerify`/`runGithubIssuesListing` under
      // `classification.kind === "github"`. `resolveIssueReadSource`'s
      // `"upstream"` variant is therefore structurally unreachable from THIS
      // call site — kept as a real (never constructed) branch below rather
      // than deleted from the shared decision function, which other future
      // callers may still need.
      const source = resolveIssueReadSource({
        localCorpusRoot: dirname(dirname(dbPath)),
        upstreamCorpusPath: undefined,
        forceLocal: args.local === true,
      });

      // reason: --verify is a DIFFERENT operation from the listing below, not
      // a narrowing of it (see this file's own header) — dispatched here,
      // BEFORE the mode-filtered read, so it never inherits --open/--resolved/
      // --all's filter and never touches --severity/--category.
      if (args.verify === true) {
        return await runVerify(inv, app, source, args.json === true, invocationOf(context).env);
      }

      const rowsResult =
        source.kind === "upstream" ? unsupportedUpstreamReadError<IssueRow[]>() : await readLocalRows(app, mode);
      if (!rowsResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, rowsResult.error) + "\n");
        return exitCode(rowsResult.error);
      }
      // reason: filtering happens HERE, before renderRows computes `total`
      // off the resulting array's length — so a filtered run's `data.total`
      // is the FILTERED count, never the unfiltered one (this file's own
      // header names the census defect a self-consistent-but-unfiltered
      // total would reproduce).
      const filteredRows = filterIssueRows(rowsResult.value, severityFilter, categoryFilter);
      renderRows(inv.io, filteredRows, mode, source, args.json === true);
    } finally {
      app.close();
    }
    return 0;
  },
});

/** Both readers below share ONE return contract, so the caller has a single error rail. */
type RowsResult = Result<IssueRow[], LoreError>;

/**
 * `resolveIssueReadSource`'s `"upstream"` variant is structurally
 * unreachable from this file (see the `run()` call site's own comment) — P4
 * (spec-the-defect-channel-reaches-no-machine-but-its-own-github) deleted
 * the SQLite `UpstreamPort` this branch used to open, and the legacy
 * `feedback.upstream` shape that would have named a target for it is now
 * retired (parses-but-ignored). Kept as a REAL, named error rather than an
 * `assertUnreachable`/`throw` so a future caller that does manage to
 * construct an `"upstream"` source (e.g. a GitHub-backed read source, not
 * yet wired) gets an honest `Result` instead of a crash.
 *
 * Generic over the success type `T` (never actually produced — this
 * function only ever returns the `err(...)` branch) so the SAME helper
 * serves both {@link RowsResult} (the plain listing) and
 * `Result<VerifyTarget[], LoreError>` (`--verify`) call sites without a
 * `Result<IssueRow[], ...>` return type wrongly narrowing what the caller
 * may assign it to.
 */
function unsupportedUpstreamReadError<T>(): Result<T, LoreError> {
  return err({
    code: "VALIDATION_ERROR",
    field: "feedback.upstream",
    message:
      "reading a configured feedback.upstream via 'lore issues' has no implementation for this " +
      "shape (the SQLite upstream transport was removed in P4 of spec-the-defect-channel-reaches-" +
      "no-machine-but-its-own-github; a GitHub-backed read source is a later phase). Pass --local " +
      "to read this corpus's own issue reports instead.",
  });
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
function renderRows(io: CliIo, 
  rows: IssueRow[],
  mode: "open" | "resolved" | "all",
  source: IssueReadSource,
  json: boolean,
): void {
  if (json) {
    printLine(io.stdout,  // CLI surface
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

  printLine(io.stdout, formatIssueCorpusLine(source.corpus_path)); // CLI surface
  if (rows.length === 0) {
    printLine(io.stdout, `(no ${mode} issue reports)`); // CLI surface
    return;
  }

  printLine(io.stdout, `${mode} issue reports (${rows.length}):`); // CLI surface
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
  printLine(io.stdout, formatTable(headers, tableRows)); // CLI surface
}

/**
 * `--severity`/`--category`'s exact-match narrowing over the ALREADY-
 * PROJECTED rows — see this file's own header for why this reads
 * `readIssueTriageLabels`'s existing corpus-side copy (or, for a GitHub
 * "not_ingested" row, `parseIssueBody`) rather than issuing a `gh` call: an
 * absent filter value is a no-op (`undefined` skips its own comparison), so
 * passing neither leaves `rows` untouched. Generic over `T` so ONE
 * implementation serves both {@link IssueRow} (local branch) and
 * {@link GithubProjectedRow} (GitHub branch) — both carry the identical
 * optional `severity`/`category` pair — rather than two independently
 * maintained copies of the same two-line filter.
 *
 * @param rows - the mode-filtered, already-projected rows
 * @param severity - `undefined` when `--severity` was not passed
 * @param category - `undefined` when `--category` was not passed
 * @returns the subset of `rows` matching every passed filter — the caller
 *   MUST compute `total` off THIS return value, never off `rows`
 */
function filterIssueRows<T extends { readonly severity?: IssueSeverity; readonly category?: string }>(
  rows: readonly T[],
  severity: IssueSeverity | undefined,
  category: string | undefined,
): T[] {
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
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Result<Map<string, IssueResolution | undefined>, LoreError>> {
  const runner = new GhRunner({ execFile: createNodeGhExecFile(cwd), env });

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
        rule: "BR-516",
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
 * `--verify`'s ONE render — shared by BOTH the local branch (`runVerify`)
 * and the GitHub-configured-upstream branch (`runGithubVerify`) — a
 * DELIBERATELY separate shape from {@link renderRows} (`data.clean`/
 * `data.divergences`, never `data.reports`; see this file's own header for
 * why). Sets {@link VERIFY_DIVERGENCE_EXIT_CODE} on any divergence; leaves
 * `process.exitCode` untouched (this repo's own clean-exit convention,
 * mirrored from every other clean path in this file) when clean.
 *
 * @param corpusPath - the corpus root to print on the `Corpus: ` line
 *   (§M4's declared render contract) — a plain string rather than an
 *   `IssueReadSource` so the GitHub branch (which has no `IssueReadSource`
 *   variant of its own, see `run()`'s own comment on why "upstream" is
 *   structurally unreachable) does not have to construct a fake one just
 *   to satisfy this function's signature.
 */
function renderVerifyResult(io: CliIo, corpusPath: string, divergences: readonly ResolutionDivergence[], json: boolean): ExitReport {
  const clean = divergences.length === 0;

  if (json) {
    printLine(io.stdout,  // CLI surface
      JSON.stringify(
        {
          ok: true,
          data: {
            corpus_path: corpusPath,
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
    printLine(io.stdout, formatIssueCorpusLine(corpusPath)); // CLI surface
    if (clean) {
      printLine(io.stdout, "verify: clean — no resolution-label divergences found."); // CLI surface
    } else {
      printLine(io.stdout, `verify: ${divergences.length} divergence(s) found:`); // CLI surface
      for (const divergence of divergences) {
        printLine(io.stdout, `  ${divergence.slug}: corpus=${divergence.corpus_resolution} github=${divergence.github_label_resolution}`); // CLI surface
      }
    }
  }

  if (!clean) {
    return VERIFY_DIVERGENCE_EXIT_CODE;
  }
  return 0;
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
async function runVerify(inv: Invocation, app: ReturnType<typeof loadLoreApp>["app"], source: IssueReadSource, json: boolean, env: NodeJS.ProcessEnv): Promise<ExitReport> {
  // reason: `source.kind === "upstream"` is structurally unreachable from
  // this file's own `resolveIssueReadSource` call site — see `run()`'s
  // comment there. Handled as a real error, not `assertUnreachable`, for the
  // same reason `unsupportedUpstreamReadError` is.
  const targetsResult =
    source.kind === "upstream" ? unsupportedUpstreamReadError<VerifyTarget[]>() : await collectLocalVerifyTargets(app);
  if (!targetsResult.ok) {
    inv.io.stderr.write(formatErrorFor(inv, targetsResult.error) + "\n");
    return exitCode(targetsResult.error);
  }

  const targets = targetsResult.value;
  if (targets.length === 0) {
    return renderVerifyResult(inv.io, source.corpus_path, [], json);
  }

  const labelsResult = await fetchGithubLabelResolutions(targets, inv.cwd, env);
  if (!labelsResult.ok) {
    inv.io.stderr.write(formatErrorFor(inv, labelsResult.error) + "\n");
    return exitCode(labelsResult.error);
  }

  return renderVerifyResult(inv.io, source.corpus_path, computeDivergences(targets, labelsResult.value), json);
}
