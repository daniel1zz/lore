/**
 * `lore issues [--resolved|--all] [--severity <level>] [--category <value>] [--json]` and
 * `lore issues --sync [--json]` — the live read surface and the push-only repair
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D5, AC-GS-2, AC-GS-3, AC-GS-16).
 *
 * GitHub owns every issue fact; the corpus owns only the work that resolves an issue (the CARRIERS:
 * tasks and plans naming an issue in `extra.issues`). So this command:
 *   - ALWAYS reads the complete live listing (`report-issue-wiring.ts::resolveGithubStatusRows`, one
 *     paginated `GitHubIntakePort.listIssues`) and joins it with the carrier index
 *     (`github-issue-listing.ts::joinIssueStatuses`) into one displayed status per listed issue.
 *   - Has NO `--local`, NO `--verify` and NO offline fallback: a listing that fails exits 9 (transport),
 *     8 (auth) or 10 (rate limit) with nothing listed — a carrier alone proves nothing about what GitHub shows.
 *   - Exits 4 when no destination is configured (`feedback.upstream` absent) or the retired SQLite shape is
 *     configured; both messages are the SSOT builders `report-issue` uses.
 *   - Names the repository and the corpus it read FIRST (`Corpus: <path>`, `Repository: <owner/repo>`; `--json`
 *     carries `data.corpus_path` and `data.repo`).
 *
 * Default (and `--open`) shows UNFINISHED issues: `open`, `adopted`, `resolving`, `fixed (close pending)`,
 * `adopted (abandoned)`. `--resolved` shows every other status; `--all` shows all. The three are mutually
 * exclusive (exit 2). `--severity`/`--category` narrow on the front matter of each issue's own body, applied
 * BEFORE `total` is computed so a filtered run reports the filtered count.
 *
 * `--sync` is the PUSH-ONLY repair: it closes each `fixed (close pending)` issue, converges `resolution:fixed`
 * on a fixed one and strips `resolution:*` labels from open issues, printing one line per change
 * (`issues-sync.ts`, `IssueCloseOnArchive.applySync`). It writes nothing to the corpus, prints `clean` only
 * after a COMPLETE listing showed nothing to do, and exits 0 when every repair succeeds or with the failing
 * call's own kind otherwise.
 *
 * Exit codes: 0 success (an empty list is success); 2 usage error; 4 no destination / retired shape /
 * validation; 8 auth required; 9 transport unavailable; 10 rate limited (stderr carries the reset time);
 * 1 store failure.
 *
 * Pull-only: no SessionStart/bootstrap injection wires into this command.
 *
 * Side-effect class: IO (`gh` reads; `--sync` also GitHub writes); never writes the corpus.
 */

import type { Invocation } from "@lore/core";

import { dirname } from "node:path";
import { defineLoreCommand } from "../cli-exit.js";
import {
  buildUnconfiguredUpstreamRemedy,
  formatIssueCorpusLine,
  isIssueSeverity,
  MalformedIssueFrontMatterError,
  parseIssueBody,
  ISSUE_SEVERITIES,
  type IssueSeverity,
  type IssueStatus,
  type LoreError,
} from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { runIssuesSync } from "../issues-sync.js";
import { formatTable, exitCode, formatErrorFor } from "../utils.js";
import {
  classifyFeedbackUpstream,
  resolveGithubIssueListing,
  resolveGithubStatusRows,
  type GithubUpstreamCfg,
} from "../report-issue-wiring.js";
import type { CorpusLocator } from "../corpus-resolution.js";
import type { IssueStatusRow } from "../../../service/github-issue-listing.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import type { ExitReport } from "../cli-exit.js";

/** Statuses that still need work (ADR status table, "Unfinished"); every other displayed status is finished. */
const UNFINISHED_STATUSES: ReadonlySet<IssueStatus> = new Set<IssueStatus>([
  "open",
  "adopted",
  "resolving",
  "fixed (close pending)",
  "adopted (abandoned)",
]);

/** The three mode flags' status filter. */
function includedByMode(mode: "open" | "resolved" | "all", status: IssueStatus): boolean {
  if (mode === "all") return true;
  return mode === "open" ? UNFINISHED_STATUSES.has(status) : !UNFINISHED_STATUSES.has(status);
}

/** One rendered row of the live listing. `severity`/`category` are omitted when the filer declared none. */
interface ProjectedIssueRow {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly status: IssueStatus;
  readonly carriers: readonly string[];
  readonly severity?: IssueSeverity;
  readonly category?: string;
}

/**
 * Severity/category from the front matter of the issue's own body — the one remaining copy of a declared
 * triage label now that no corpus mirror exists. A body with no parsable front matter (hand-filed, or
 * edited on GitHub) yields neither field rather than failing the whole listing.
 */
function readBodyTriageLabels(body: string): { severity?: IssueSeverity; category?: string } {
  try {
    const parsed = parseIssueBody(body);
    return parsed.present ? { severity: parsed.fields.severity, category: parsed.fields.category } : {};
  } catch (error) {
    if (error instanceof MalformedIssueFrontMatterError) return {};
    throw error;
  }
}

/** The ONE place a joined row becomes a rendered row, so the table and `--json` agree. */
function projectIssueRow(row: IssueStatusRow): ProjectedIssueRow {
  const triage = readBodyTriageLabels(row.issue.body);
  return {
    number: row.issue.number,
    title: row.issue.title,
    state: row.issue.state,
    status: row.status,
    carriers: row.carrierSlugs,
    ...(triage.severity !== undefined ? { severity: triage.severity } : {}),
    ...(triage.category !== undefined ? { category: triage.category } : {}),
  };
}

/** `--severity`/`--category` exact-match narrowing; an absent filter is a no-op. */
function filterIssueRows(
  rows: readonly ProjectedIssueRow[],
  severity: IssueSeverity | undefined,
  category: string | undefined,
): ProjectedIssueRow[] {
  return rows.filter((row) => {
    if (severity !== undefined && row.severity !== severity) return false;
    if (category !== undefined && row.category !== category) return false;
    return true;
  });
}

/**
 * Reads, joins and renders the live listing — the ONE listing implementation `commands/report-issue.ts
 * --list` also calls (lazy `import("./issues.js")`), so neither command re-derives its own read/render.
 *
 * ⛔ A failing listing writes its error to stderr and returns its exit kind with NOTHING on stdout.
 *
 * @param app - the loaded local App; `app.corpusService` is the only corpus consulted (for carriers)
 * @param cfg - the GitHub-shaped `feedback.upstream` config
 * @param corpusPath - the local corpus root, printed first (`Corpus: `)
 * @param json - whether `--json` was passed
 * @param locator - the run's `cwd` + `env` (an `Invocation`)
 * @param filters - mode/severity/category; omitted by a caller that wants the unfiltered listing
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
  const joined = await resolveGithubStatusRows(inv.io, app.corpusService, cfg, locator);
  if (!joined.ok) {
    inv.io.stderr.write(formatErrorFor(inv, joined.error) + "\n");
    return exitCode(joined.error);
  }

  const projected = joined.value.rows.map(projectIssueRow);
  const modeFiltered = projected.filter((row) => includedByMode(filters.mode, row.status));
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
          },
        },
        null,
        2,
      ),
    );
    return 0;
  }

  printLine(inv.io.stdout, formatIssueCorpusLine(corpusPath)); // CLI surface
  printLine(inv.io.stdout, `Repository: ${cfg.repo}`); // CLI surface
  if (filtered.length === 0) {
    printLine(inv.io.stdout, `(no ${filters.mode} GitHub issues)`); // CLI surface
    return 0;
  }
  printLine(inv.io.stdout, `GitHub issues (${cfg.repo}) (${filtered.length}):`); // CLI surface
  const headers = ["Number", "Title", "State", "Status", "Carriers", "Severity", "Category"];
  const tableRows = filtered.map((r) => [
    String(r.number),
    r.title,
    r.state,
    r.status,
    r.carriers.join(", "),
    r.severity ?? "",
    r.category ?? "",
  ]);
  printLine(inv.io.stdout, formatTable(headers, tableRows)); // CLI surface
  return 0;
}

export default defineLoreCommand({
  meta: {
    name: "issues",
    description:
      "List the configured repository's GitHub issues with their displayed status (live listing joined with the work that carries them); --sync repairs GitHub from the carriers",
  },
  args: {
    action: {
      type: "positional",
      required: false,
      description: "'migrate' runs the one-time mirror-to-carrier migration (dry run unless --apply)",
    },
    apply: {
      type: "boolean",
      description: "With 'migrate': execute the plan (writes GitHub and the corpus); resumable and idempotent",
    },
    open: {
      type: "boolean",
      // reason: the member list is RENDERED from the SSOT status array, never typed out, so help cannot drift.
      description: `Show only unfinished issues (default) — ${[...UNFINISHED_STATUSES].join(", ")}`,
    },
    resolved: {
      type: "boolean",
      description: `Show only finished issues — every status except ${[...UNFINISHED_STATUSES].join(", ")}`,
    },
    all: {
      type: "boolean",
      description: "Show every listed issue regardless of status",
    },
    severity: {
      type: "string",
      description: `Filter to issues whose declared severity exactly matches (${ISSUE_SEVERITIES.join("/")}) — the printed total reflects this filter`,
    },
    category: {
      type: "string",
      description: "Filter to issues whose declared category exactly matches (case-sensitive) — the printed total reflects this filter",
    },
    sync: {
      type: "boolean",
      description:
        "Push-only repair: close every 'fixed (close pending)' issue, converge resolution:fixed, strip resolution:* labels from open issues; writes nothing to the corpus; prints 'clean' only after a complete listing showed nothing to do",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context): Promise<number> {
    const inv = invocationOf(context);
    const { args } = context;
    // reason: `lore issues migrate` is dispatched on the positional VALUE, not a citty `subCommands` entry — citty runs a
    // parent's own `run` after a nested subcommand, which would list issues (and reject `--apply`) after the migration ran.
    if (args.action !== undefined) {
      if (args.action !== "migrate") {
        inv.io.stderr.write(`Error: unknown action '${String(args.action)}'; the only action is 'migrate'.\n`);
        return 2;
      }
      if (args.open === true || args.resolved === true || args.all === true || args.severity !== undefined || args.category !== undefined || args.sync === true) {
        inv.io.stderr.write("Error: 'migrate' takes only --apply and --json.\n");
        return 2;
      }
      const { runIssuesMigrate } = await import("./issues-migrate.js");
      return runIssuesMigrate({ apply: args.apply === true, json: args.json === true }, inv);
    }
    if (args.apply === true) {
      inv.io.stderr.write("Error: --apply belongs to 'lore issues migrate'.\n");
      return 2;
    }
    // reason: usage errors exit 2 BEFORE the corpus is opened or GitHub is contacted.
    if (
      args.sync === true &&
      (args.open === true || args.resolved === true || args.all === true || args.severity !== undefined || args.category !== undefined)
    ) {
      inv.io.stderr.write("Error: --sync cannot be combined with --open, --resolved, --all, --severity or --category.\n");
      return 2;
    }
    const modeFlagsSet = [args.open === true, args.resolved === true, args.all === true].filter(Boolean).length;
    if (modeFlagsSet > 1) {
      inv.io.stderr.write("Error: --open, --resolved, and --all are mutually exclusive.\n");
      return 2;
    }
    const mode: "open" | "resolved" | "all" =
      args.all === true ? "all" : args.resolved === true ? "resolved" : "open";

    const severityFilter = typeof args.severity === "string" ? args.severity : undefined;
    if (severityFilter !== undefined && !isIssueSeverity(severityFilter)) {
      inv.io.stderr.write(`Error: --severity must be one of ${ISSUE_SEVERITIES.join("/")}.\n`);
      return 2;
    }
    const categoryFilter = typeof args.category === "string" ? args.category : undefined;

    // reason: loadLoreApp() is the only source of the consumer's parsed `feedback.upstream`, the cwd corpus root,
    // and the missing-`.lore/lore.db` exit every CLI command shares.
    const { app, dbPath, config } = loadLoreApp({ inv });
    try {
      // reason: ONE shared classifier — `commands/report-issue.ts` consumes the same function, so the two
      // verbs cannot drift into independently derived verdicts on the same config.
      const classification = classifyFeedbackUpstream(config);
      if (classification.kind !== "github") {
        const refusal: LoreError =
          classification.kind === "retired" ? classification.error : buildUnconfiguredUpstreamRemedy();
        inv.io.stderr.write(formatErrorFor(inv, refusal) + "\n");
        return exitCode(refusal);
      }
      const corpusPath = dirname(dirname(dbPath));

      if (args.sync === true) {
        // reason: the listing is fetched HERE and handed in, so a failed listing exits with its own kind before
        // any plan exists; `runIssuesSync` can therefore never print `clean` for a listing it could not read.
        const listing = await resolveGithubIssueListing(inv.io, classification.cfg, inv);
        if (!listing.ok) {
          inv.io.stderr.write(formatErrorFor(inv, listing.error) + "\n");
          return exitCode(listing.error);
        }
        return await runIssuesSync(inv, app.issueClose, listing.value, { json: args.json === true });
      }

      return await runGithubIssuesListing(inv, app, classification.cfg, corpusPath, args.json === true, inv, {
        mode,
        ...(severityFilter !== undefined ? { severity: severityFilter } : {}),
        ...(categoryFilter !== undefined ? { category: categoryFilter } : {}),
      });
    } finally {
      app.close();
    }
  },
});
