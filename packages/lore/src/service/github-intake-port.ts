/**
 * `GitHubIntakePort` — the four-op transport GitHub intake talks through
 * (spec-the-defect-channel-reaches-no-machine-but-its-own-github, Scope
 * entry `GitHubIntakePort`; AC-GI-1). Replaces the six-method corpus-shaped
 * SQLite `UpstreamPort` for the LIVE filing path. That legacy port and its
 * `IssueReportService` orchestrator were deleted outright in P4 of the same
 * spec — untouched by THIS module at the time it landed (P2, "SQLite path
 * still selectable"), but gone as of P4.
 *
 * Public surface:
 *   - `GitHubIntakePort` — `new GitHubIntakePort(options)`, then
 *     `verifyTarget()` / `searchDuplicates(title, limit)` /
 *     `fileIssue(input)` / `listIssues()`. Exactly these four ops — never a
 *     fifth public method (the retry/idempotency-lookup orchestration that
 *     needs to run BEFORE `fileIssue` is a caller concern, wired in
 *     `adapters/cli/report-issue-wiring.ts::fileGithubIssue`, precisely so
 *     this class's own surface stays the four ops the spec names).
 *   - `GitHubIntakePortOptions` / `FileIssueInput` / `FileIssuePortResult` /
 *     `GithubListedIssue` — the DTOs the constructor and methods are typed
 *     against.
 *
 * Invariants:
 *   - Every network call is `runner.run(["api", ...])` — `GhRunner.run`
 *     (`gh-runner.ts`) is the ONLY module that spawns `gh` (AC-GI-7); this
 *     module imports ZERO `node:child_process`.
 *   - The target repo (`options.repo`, `"owner/repo"`) is resolved ONCE by
 *     the caller from config and threaded through every `gh api
 *     repos/<repo>/...` URL PATH — never `-R <repo>` (a `gh issue`/`gh
 *     repo`-family flag this module never uses, since every call goes
 *     through `gh api`) and never left to `gh`'s own git-remote inference.
 *     This is risk R2's structural mitigation: the repo is baked into the
 *     REST path string this module builds, so there is no flag for an
 *     attacker-controlled `GH_REPO`/git-remote to override (`GhRunner.run`
 *     additionally scrubs `GH_REPO`/`GH_HOST`/`GH_CONFIG_DIR`/
 *     `GH_ENTERPRISE_TOKEN` from the child env regardless, AC-GI-8).
 *   - `fileIssue` is the ONLY method that writes: it calls
 *     `frontMatterCodec` (`assembleIssueBody`/`redactReporterIdentity`,
 *     imported from `@lore/core`) to build the body — NEVER a hand-rolled
 *     reimplementation of front-matter serialisation, which would produce a
 *     byte-identical body while leaving that codec a zero-caller module
 *     (the exact false-green this plan's structural AC exists to catch) —
 *     and it appends an `intent` receipt line (via a `ReceiptLogV2`
 *     instance this class constructs from `options.receiptsPath`, Risk R4)
 *     BEFORE the network call, then an `outcome` line after it succeeds.
 *     A failed network call leaves the `intent` with no paired `outcome` —
 *     the reconcile signal AC-GI-3 depends on.
 *   - `searchDuplicates` never calls the expensive `/search/issues` REST
 *     endpoint (a 30-request/min bucket measured at 1054–1561ms) — it
 *     reuses `listIssues`'s paginated batched read and substring-matches the
 *     cached titles locally. A `listIssues` failure degrades this to
 *     `err(...)`, which the caller (`fileGithubIssue`) turns into an
 *     advisory `dedup_degraded: true` — it NEVER blocks filing (Scope-Alt).
 *   - `listIssues` issues one `gh api` request PER PAGE (100 entries each),
 *     never one per issue: max(1, ceil(N/100)) requests (BR-1241 as modified
 *     by spec-github-owns-issue-report-state D2, AC-GS-1). Any failing page
 *     fails the whole listing — a partial list is never returned. Pull
 *     requests (entries carrying `pull_request`) are dropped.
 *
 * Side-effect class: IO (subprocess via the injected `GhRunner`; local
 * receipt-file append via the internally-constructed `ReceiptLogV2`).
 *
 * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github,
 *   Scope "GhRunner"/"GitHubIntakePort"/"frontMatterCodec"/"ReceiptLogV2",
 *   Risk R1/R2/R4, AC-GI-1, AC-GI-6, AC-GI-7, AC-GI-8, AC-GI-12.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  assembleIssueBody,
  err,
  ok,
  redactReporterIdentity,
  type IssueFrontMatterFields,
  type IssueSeverity,
  type LoreError,
  type RawReporterIdentity,
  type Result,
} from "@lore/core";

import type { GhRunner } from "./gh-runner.js";
import { ReceiptLogV2 } from "./receipt-log-v2.js";

/** Constructor options for {@link GitHubIntakePort}. */
export interface GitHubIntakePortOptions {
  /** The single `gh` subprocess seam — every call this class makes routes through it. */
  runner: GhRunner;
  /**
   * The GitHub intake target, `"owner/repo"` — resolved ONCE by the caller
   * from `feedback.upstream.repo` and passed explicitly. See this module's
   * header for why this closes risk R2 structurally.
   */
  repo: string;
  /**
   * Path to the LOCAL two-phase receipt log (the reporter's OWN
   * `<corpusRoot>/.lore/issue-receipts-v2.jsonl`, never the upstream's) —
   * `ReceiptLogV2`'s own header documents construction as cheap enough to
   * do per call, which is what this class does internally.
   */
  receiptsPath: string;
  /** Wall-clock read, injected for determinism. Defaults to `() => new Date().toISOString()`. */
  now?: () => string;
  /** `idempotency_key` generator, injected for determinism in tests. Defaults to `crypto.randomUUID()`. */
  idGenerator?: () => string;
}

/**
 * One issue as `listIssues`/`searchDuplicates` observe it.
 *
 * `labels` is the issue's current `resolution:*`/other label NAMES (`gh`'s
 * own `{name, color, ...}` objects, already decoded down to just `.name` —
 * spec-a-github-filed-defect-must-be-claimable-one-ingest-seam: GitHub's
 * issues REST payload already carries a `labels` array on every entry, so
 * `listIssues` surfaces it at ZERO extra network cost, never a second `gh`
 * call). `undefined` ONLY for a record `listIssues` never produced — i.e. a
 * SYNTHETICALLY reconstructed one (`report-issue-wiring.ts::mintIssueTask`
 * builds one locally right after `fileIssue()` returns, rather than
 * re-fetching from GitHub); a freshly-filed issue carries no labels yet
 * regardless, so that omission is never lossy.
 */
export interface GithubListedIssue {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly body: string;
  readonly labels?: readonly string[];
  /** GitHub's `state_reason` (`completed`/`not_planned`/`reopened`/...); `null` when GitHub gives none; `undefined` for a synthetically reconstructed record. */
  readonly state_reason?: string | null;
}

/** A complete `listIssues` result: every issue (PRs excluded) plus the request count that read it. */
export interface GithubListing {
  readonly issues: GithubListedIssue[];
  /** Number of `gh api` requests made — one per page, never one per issue. */
  readonly pages: number;
}

/**
 * Input to {@link GitHubIntakePort.fileIssue} — the reporter-supplied triage
 * labels (severity/category/tags), the free-form description text, and the
 * RAW (pre-redaction) identity facts `redactReporterIdentity` (`@lore/core`)
 * needs. `idempotency_key` is deliberately absent here: this method mints
 * it itself (Risk R4).
 */
export interface FileIssueInput {
  readonly title: string;
  readonly description: string;
  readonly severity: IssueSeverity;
  readonly category: string;
  readonly tags: readonly string[];
  readonly identity: RawReporterIdentity;
}

/** Successful outcome of {@link GitHubIntakePort.fileIssue}. */
export interface FileIssuePortResult {
  readonly number: number;
  readonly url: string;
  readonly idempotencyKey: string;
}

/** `gh api user`'s response shape — only `login` is read. `.passthrough()`: the real payload carries many more fields this module has no use for. */
const GithubUserSchema = z.object({ login: z.string() }).passthrough();

/**
 * `gh api repos/<repo>`'s response shape — only the numeric `id` is read
 * (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam D1: the
 * rename-proof identity key `githubIssueTaskSlug`/`joinListing` join on,
 * fetched here at ZERO extra network cost since `verifyTarget` already
 * makes this exact call). `.passthrough()`: the real payload carries dozens
 * more fields this module has no use for.
 */
const GithubRepoSchema = z.object({ id: z.number() }).passthrough();

/** `gh api repos/<repo>/issues -X POST`'s response shape — only the two fields this module persists. */
const GithubCreatedIssueSchema = z.object({ number: z.number(), html_url: z.string() }).passthrough();

/** One label entry inside `gh api repos/<repo>/issues`'s per-issue `labels` array — only `.name` is read (`resolution:*` decoding, `resolution-projector.ts::labelToResolution`). `.passthrough()`: GitHub's real label object also carries `id`/`color`/`description`, unused here. */
const GithubIssueListLabelSchema = z.object({ name: z.string() }).passthrough();

/**
 * One entry of `gh api repos/<repo>/issues`'s array response. `body` is
 * nullable on GitHub's own API when an issue has no body at all. `labels`
 * is REQUIRED here (never `.optional()`) because GitHub's real payload
 * always includes it (possibly `[]`) — {@link GithubListedIssue.labels}'s
 * own optionality is for a SYNTHETICALLY reconstructed record that never
 * passes through this parse at all, not for a gap in the wire schema.
 */
const GithubIssueListEntrySchema = z
  .object({
    number: z.number(),
    title: z.string(),
    state: z.string(),
    body: z.string().nullable().optional(),
    labels: z.array(GithubIssueListLabelSchema),
    state_reason: z.string().nullable().optional(),
    pull_request: z.unknown().optional(),
  })
  .passthrough();

const GithubIssueListSchema = z.array(GithubIssueListEntrySchema);

/**
 * Defensive `JSON.parse` — `gh api`'s stdout is untrusted external text (a
 * network response relayed unmodified by `GhRunner.run`). A malformed body
 * degrades to `undefined` here rather than throwing past this module's
 * `Result` boundary; the immediately-following `.safeParse` turns that into
 * a reportable `VALIDATION_ERROR` rather than a silently-swallowed failure.
 */
function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Entries per `listIssues` request — GitHub's documented maximum. */
const LIST_PAGE_SIZE = 100;

/**
 * Splits a `gh api -i` stdout into its `Link` header value and JSON body.
 * Headers end at the first blank line. Stdout that does not start with
 * `HTTP/` (no header block) is treated as a body with no `Link`, i.e. a
 * single page; real `gh api -i` always emits headers.
 */
export function splitHttpResponse(stdout: string): { body: string; linkHeader: string | undefined } {
  if (!stdout.startsWith("HTTP/")) return { body: stdout, linkHeader: undefined };
  const boundary = /\r?\n\r?\n/.exec(stdout);
  if (boundary === null) return { body: "", linkHeader: undefined };
  const head = stdout.slice(0, boundary.index);
  const body = stdout.slice(boundary.index + boundary[0].length);
  const linkLine = head.split(/\r?\n/).find((line) => /^link:/i.test(line));
  return { body, linkHeader: linkLine?.slice(linkLine.indexOf(":") + 1).trim() };
}

/** Page number of the `rel="next"` entry in a `Link` header value; `undefined` when there is none. */
export function parseNextPage(linkHeader: string | undefined): number | undefined {
  if (linkHeader === undefined) return undefined;
  for (const part of linkHeader.split(/,\s*(?=<)/)) {
    if (!/rel="?next"?/.test(part)) continue;
    const match = /[?&]page=(\d+)/.exec(part);
    return match === null ? undefined : Number(match[1]);
  }
  return undefined;
}

/**
 * The `gh`-backed four-op intake port. See this module's header for the
 * full contract.
 */
export class GitHubIntakePort {
  private readonly runner: GhRunner;
  private readonly repo: string;
  private readonly receipts: ReceiptLogV2;
  private readonly now: () => string;
  private readonly idGenerator: () => string;

  constructor(options: GitHubIntakePortOptions) {
    this.runner = options.runner;
    this.repo = options.repo;
    this.receipts = new ReceiptLogV2(options.receiptsPath);
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
  }

  /**
   * Asserts `gh` is authenticated (`gh api user`) AND that the configured
   * target repo is reachable (`gh api repos/<repo>`) — both against the
   * repo resolved ONCE at construction, never a git-remote-inferred one
   * (risk R2). The repo call's response ALSO carries the numeric repo `id`
   * (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam D1) —
   * returned here at zero extra network cost, since this call was already
   * being made for reachability alone before D1 existed.
   *
   * @returns `ok({login, id})` — the authenticated account's GitHub login,
   *   plus the target repo's numeric id (D1's rename-proof identity key) —
   *   when both calls succeed; `err(...)` on the FIRST failing call
   *   (`GhRunner.run`'s own `AUTH_REQUIRED`/`TRANSPORT_UNAVAILABLE`/
   *   `RATE_LIMITED`/generic taxonomy, propagated verbatim; a malformed
   *   `gh api user`/`gh api repos/<repo>` JSON body is a `VALIDATION_ERROR`
   *   this method raises itself)
   */
  async verifyTarget(): Promise<Result<{ login: string; id: number }, LoreError>> {
    const userResult = await this.runner.run(["api", "user"]);
    if (!userResult.ok) return userResult;

    const userParsed = GithubUserSchema.safeParse(parseJsonSafely(userResult.value.stdout));
    if (!userParsed.success) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gh_user_response",
        message: `gh returned a user payload this module could not parse: ${userParsed.error.message}`,
        value: userResult.value.stdout,
      });
    }

    const repoResult = await this.runner.run(["api", `repos/${this.repo}`]);
    if (!repoResult.ok) return repoResult;

    const repoParsed = GithubRepoSchema.safeParse(parseJsonSafely(repoResult.value.stdout));
    if (!repoParsed.success) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gh_repo_response",
        message: `gh returned a repo payload this module could not parse: ${repoParsed.error.message}`,
        value: repoResult.value.stdout,
      });
    }

    return ok({ login: userParsed.data.login, id: repoParsed.data.id });
  }

  /**
   * Advisory duplicate search — substring-matches `title` against the
   * BATCHED `listIssues()` result (never the expensive `/search/issues`
   * endpoint, see this module's header). A search failure degrades — the
   * CALLER (`fileGithubIssue`) marks `dedup_degraded: true` and files
   * anyway, this method itself still returns `err(...)` so that
   * distinction is possible.
   *
   * @param title - the new report's title
   * @param limit - maximum number of matches to return
   * @returns up to `limit` `"#<number> <title>"` strings for issues whose
   *   title contains, or is contained by, `title` (case-insensitive)
   */
  async searchDuplicates(title: string, limit: number): Promise<Result<string[], LoreError>> {
    const listResult = await this.listIssues();
    if (!listResult.ok) return listResult;

    const lowerTitle = title.toLowerCase();
    const matches = listResult.value.issues
      .filter((issue) => {
        const lowerIssueTitle = issue.title.toLowerCase();
        return lowerIssueTitle.includes(lowerTitle) || lowerTitle.includes(lowerIssueTitle);
      })
      .slice(0, limit)
      .map((issue) => `#${issue.number} ${issue.title}`);

    return ok(matches);
  }

  /**
   * Files a new GitHub issue: mints a fresh `idempotency_key`, appends the
   * `intent` receipt line, redacts the two identity leaks Risk R1 names
   * (`redactReporterIdentity`), assembles the body via `frontMatterCodec`'s
   * `assembleIssueBody` (never reimplemented inline — see this module's
   * header), creates the issue over `gh api`, then appends the `outcome`
   * receipt line.
   *
   * @param input - see {@link FileIssueInput}
   * @returns `ok({number, url, idempotencyKey})` once the issue is created
   *   AND the outcome receipt is durably recorded; `err(...)` on the first
   *   failure — an `intent`-append failure refuses BEFORE any network call
   *   (a local IO problem, not worth risking a duplicate filing over); a
   *   `gh api` failure leaves the `intent` line stranded with no `outcome`
   *   (AC-GI-3's reconcile signal, by design — do not retro-append an
   *   outcome for a filing that never happened); an outcome-append failure
   *   AFTER a successful creation names the issue number/url in its
   *   message so the upstream filing is never silently lost from view
   */
  async fileIssue(input: FileIssueInput): Promise<Result<FileIssuePortResult, LoreError>> {
    const idempotencyKey = this.idGenerator();

    const intentResult = this.receipts.appendIntent({
      idempotency_key: idempotencyKey,
      title: input.title,
      at: this.now(),
    });
    if (!intentResult.ok) return intentResult;

    const redacted = redactReporterIdentity(input.identity);
    const fields: IssueFrontMatterFields = {
      severity: input.severity,
      category: input.category,
      tags: [...input.tags],
      reporter_corpus: redacted.reporter_corpus,
      reporter_root_prd: redacted.reporter_root_prd,
      idempotency_key: idempotencyKey,
    };
    const body = assembleIssueBody(fields, input.description, redacted.actor);

    const createResult = await this.runner.run([
      "api",
      `repos/${this.repo}/issues`,
      "-X",
      "POST",
      "-f",
      `title=${input.title}`,
      "-f",
      `body=${body}`,
    ]);
    if (!createResult.ok) return createResult;

    const createdParsed = GithubCreatedIssueSchema.safeParse(parseJsonSafely(createResult.value.stdout));
    if (!createdParsed.success) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gh_issue_create_response",
        message: `gh returned an issue-creation payload this module could not parse: ${createdParsed.error.message}`,
        value: createResult.value.stdout,
      });
    }

    const outcomeResult = this.receipts.appendOutcome({
      idempotency_key: idempotencyKey,
      number: createdParsed.data.number,
      url: createdParsed.data.html_url,
      at: this.now(),
    });
    if (!outcomeResult.ok) {
      const outcomeMessage = "message" in outcomeResult.error ? outcomeResult.error.message : outcomeResult.error.code;
      return err({
        code: "STORE_ERROR",
        message:
          `issue filed upstream as #${createdParsed.data.number} (${createdParsed.data.html_url}) but the ` +
          `local receipt outcome failed to record (${outcomeMessage}) — the upstream issue itself was NOT lost.`,
      });
    }

    return ok({
      number: createdParsed.data.number,
      url: createdParsed.data.html_url,
      idempotencyKey,
    });
  }

  /**
   * Lists every issue in the target repo (open and closed), page by page
   * (`per_page=100`, following `Link: rel="next"`) until no next page, then
   * drops every entry carrying `pull_request` (GitHub's issues endpoint
   * returns PRs too). Requests = number of pages = max(1, ceil(N/100)),
   * never one per issue (AC-GS-1). Each {@link GithubListedIssue}'s
   * `labels`/`state_reason` come from the SAME responses, so no consumer
   * needs a second `gh api` call.
   *
   * reason: requests pass `-i` so the HTTP headers (the only carrier of
   * `Link`) precede the JSON body in stdout — see {@link splitHttpResponse}.
   *
   * @returns `ok({issues, pages})`, or `err(...)` with the FIRST failing
   *   page's error (transport/auth/rate kind propagated verbatim, or
   *   `VALIDATION_ERROR` for a malformed page or a non-advancing next link).
   *   A failing page never yields the pages read before it.
   */
  async listIssues(): Promise<Result<GithubListing, LoreError>> {
    const issues: GithubListedIssue[] = [];
    let page = 1;
    let pages = 0;

    for (;;) {
      const pageResult = await this.runner.run([
        "api",
        `repos/${this.repo}/issues?state=all&per_page=${LIST_PAGE_SIZE}&page=${page}`,
        "-i",
      ]);
      if (!pageResult.ok) return pageResult;
      pages += 1;

      const response = splitHttpResponse(pageResult.value.stdout);
      const parsed = GithubIssueListSchema.safeParse(parseJsonSafely(response.body));
      const nextPage = parseNextPage(response.linkHeader);

      // reason: ONE `gh_issues_list_response` error site on purpose — a second
      // literal would split the baseline coverage site into `~0`/`~1` and
      // orphan its existing mapping.
      const malformed = !parsed.success
        ? `gh returned an issues-list payload this module could not parse (page ${page}): ${parsed.error.message}`
        : nextPage !== undefined && nextPage <= page
          ? `GitHub's Link header pointed at page ${nextPage} after page ${page}; refusing to loop.`
          : undefined;
      if (!parsed.success || malformed !== undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: "gh_issues_list_response",
          message: malformed ?? "gh returned an issues-list payload this module could not parse",
          value: pageResult.value.stdout,
        });
      }

      for (const entry of parsed.data) {
        if (entry.pull_request !== undefined) continue;
        issues.push({
          number: entry.number,
          title: entry.title,
          state: entry.state,
          body: entry.body ?? "",
          labels: entry.labels.map((label) => label.name),
          state_reason: entry.state_reason ?? null,
        });
      }

      if (nextPage === undefined) return ok({ issues, pages });
      page = nextPage;
    }
  }
}
