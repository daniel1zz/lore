/**
 * Shared CLI/MCP composition helper for `lore report-issue` / `lore_report_issue`
 * (SPEC-072 T5) — resolves + narrows the consumer's `feedback.upstream` config
 * and orchestrates the LIVE GitHub filing path, so the two adapters never
 * independently re-derive this wiring. Mirrors the `phase-wiring.ts`/
 * `task-feed-wiring.ts` precedent of a CLI-adjacent shared wiring module.
 *
 * ⛔ RETIRED (P4, spec-the-defect-channel-reaches-no-machine-but-its-own-github):
 * this module used to ALSO build the LEGACY SQLite-shaped `IssueReportDeps`
 * bundle (`buildIssueReportDeps`) and self-provision the legacy
 * `feedback.upstream.{corpus_path,root_prd}` shape from the running binary's
 * own installed corpus location (`resolveUpstreamFromInstalledBinary` /
 * `provisionFeedbackUpstream`, spec-out-of-box-reporting-channel-report-issue-
 * self-provisions T3). Both are deleted outright: their only output was the
 * legacy shape, which P4 retires to parses-but-ignored (see `@lore/core`'s
 * `FeedbackConfigSchema`) — self-provisioning a shape nothing acts on any
 * more would give a caller the illusion of having configured something,
 * while `IssueReportDeps`'s real port implementations (the two `bun:sqlite`
 * `flows/` modules this same phase deletes outright) no longer exist to
 * construct at all. `commands/report-issue.ts` refuses a legacy-shaped
 * `feedback.upstream` loudly instead.
 *
 * Public surface:
 *   - `resolveConsumerCorpusRoot()` — the CALLING corpus's own root directory
 *     (the one containing `.lore/`), derived the SAME walk-up `loadLoreApp`
 *     uses — NOT the upstream corpus this feature reports issues INTO.
 *   - `resolveFeedbackUpstreamCfg(config)` — narrows a parsed `LoreConfig`'s
 *     optional `feedback.upstream` section to its `UpstreamCfg` shape
 *     (LEGACY `{root_prd, ...}` OR GITHUB `{repo}`, spec-the-defect-
 *     channel-reaches-no-machine-but-its-own-github P2). STAYS the ONLY
 *     `feedback.upstream` READ site (plan invariant).
 *   - `isGithubUpstreamCfg(cfg)` — type guard distinguishing the two
 *     `UpstreamCfg` branches.
 *   - `fileGithubIssue(input, cfg, ctx)` — the LIVE GitHub filing path's
 *     orchestration (AC-GI-1): retry recognition over the local v2 receipt
 *     log, then `GitHubIntakePort.verifyTarget`/`.searchDuplicates`/
 *     `.fileIssue`. The LIVE path `commands/report-issue.ts` calls whenever
 *     `resolveFeedbackUpstreamCfg` resolves the GITHUB shape.
 *
 * Invariants:
 *   - `resolveConsumerCorpusRoot` is safe to call from a long-lived MCP
 *     handler despite internally calling `findLoreDbPath` (which
 *     `process.exit(1)`s on a miss) — `loadLoreApp()` already called it once,
 *     successfully, at MCP server STARTUP (`index.ts`'s `--mcp-server`
 *     branch), and `process.cwd()` does not change over the server's
 *     lifetime, so a per-call re-walk from the same cwd cannot newly fail.
 *     This mirrors the established precedent `loader.ts::loadProjectConfig`
 *     already sets (also re-calls `findLoreDbPath()` per MCP `lore_feed`
 *     "task-start" invocation, SPEC-070 F6).
 *   - This module does NO actor resolution — the CLI resolves via
 *     `resolveActor` (fallback chain), MCP requires `by` explicitly
 *     (SPEC-025 precedent); both thread the resolved actor through
 *     `GithubFilingContext.actor`, never through anything built here.
 *
 * Side-effect class: IO indirectly — `fileGithubIssue` reads/writes the local
 * v2 receipt log and calls `gh` via `GitHubIntakePort`.
 *
 * Source: SPEC-072 §3 Structure, §4 Public Interface, §11 Downstream Handoff;
 * spec-the-defect-channel-reaches-no-machine-but-its-own-github P2/P4.
 */

import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  err,
  ok,
  type FeedbackConfig,
  type IssueSeverity,
  type LoreConfig,
  type LoreError,
  type RawReporterIdentity,
  type ReporterActorSource,
  type Result,
} from "@lore/core";
import type { CorpusService } from "../../service/corpus-service.js";
import { GhRunner, createNodeGhExecFile } from "../../service/gh-runner.js";
import { GitHubIntakePort } from "../../service/github-intake-port.js";
import { ReceiptLogV2, type ReceiptV2Entry } from "../../service/receipt-log-v2.js";
import { findLoreDbPath } from "./utils.js";

/**
 * Resolves the CALLING corpus's own root — the directory containing
 * `.lore/` — via the SAME walk-up `loadLoreApp` uses. This is NEVER the
 * upstream corpus `lore report-issue` files a report INTO; it is where the
 * local receipt log (`<root>/.lore/issue-receipts.jsonl`) lives.
 *
 * @returns absolute path to the consumer corpus root
 * @throws process.exit(1) via `findLoreDbPath` (unchanged CLI convention)
 *   when no `.lore/lore.db` is discoverable from `cwd` — see this module's
 *   header for why this is still safe to call from an MCP tool handler.
 */
export function resolveConsumerCorpusRoot(): string {
  const dbPath = findLoreDbPath();
  return dirname(dirname(dbPath));
}

/**
 * Consumer-side `feedback.upstream.*` config, either shape — DERIVED
 * directly from `@lore/core`'s `FeedbackConfigSchema.upstream` inference
 * (never hand-redeclared) so this type can never drift from the schema's
 * own `exactOptionalPropertyTypes`-sensitive shape (`write_wait_ms`'s exact
 * optionality bit, in particular — a hand-written `{write_wait_ms?: number}`
 * mirror previously failed assignability against the real inferred value
 * under this repo's `exactOptionalPropertyTypes: true`).
 */
export type UpstreamCfg = NonNullable<FeedbackConfig["upstream"]>;

/**
 * Consumer-side `feedback.upstream.*` config, GITHUB shape (spec-the-defect-
 * channel-reaches-no-machine-but-its-own-github P2) — `repo` alone,
 * `"owner/repo"`, resolved ONCE here and threaded explicitly into
 * `GitHubIntakePort` (risk R2).
 */
export type GithubUpstreamCfg = Extract<UpstreamCfg, { repo: string }>;

/**
 * Narrows a parsed `LoreConfig`'s optional `feedback.upstream` section to the
 * shape `IssueReportService.report`/`.list` (legacy) or `fileGithubIssue`
 * (GitHub) take.
 *
 * @param config - the consumer's OWN parsed `.lore/config.yaml` (or
 *   `undefined` when none was found/parsed)
 * @returns the configured shape (legacy OR GitHub) when configured;
 *   `undefined` otherwise (SPEC-072 §5 step 1's "not configured" case) —
 *   `FeedbackConfigSchema`'s `.strict()` union branches already guarantee
 *   every field REQUIRED by whichever branch matched is present, so no
 *   partial-config case can reach here.
 */
export function resolveFeedbackUpstreamCfg(config: LoreConfig | undefined): UpstreamCfg | undefined {
  return config?.feedback?.upstream;
}

/**
 * Type guard distinguishing the GitHub shape from the legacy SQLite shape —
 * the two are mutually exclusive by construction (`FeedbackConfigSchema`'s
 * two `.strict()` union branches), so `"repo" in cfg` is a sound
 * discriminant even though neither branch carries an explicit tag field.
 *
 * @example
 *   isGithubUpstreamCfg({ repo: "acme/widget" }) // => true
 *   isGithubUpstreamCfg({ corpus_path: "/x", root_prd: "prd-x" }) // => false
 */
export function isGithubUpstreamCfg(cfg: UpstreamCfg): cfg is GithubUpstreamCfg {
  return "repo" in cfg;
}

// ─── GitHub filing path (spec-the-defect-channel-reaches-no-machine-but-its-own-github P2, AC-GI-1) ───

/** Filename of the v2 (GitHub-era) receipt log, sibling to v1's `issue-receipts.jsonl`. */
const RECEIPT_LOG_V2_FILENAME = "issue-receipts-v2.jsonl";

/** Report-filing input to {@link fileGithubIssue} — the CLI-validated fields `commands/report-issue.ts` collects. */
export interface GithubReportInput {
  readonly title: string;
  readonly description: string;
  readonly expected: string;
  readonly actual: string;
  readonly repro_command?: string;
  readonly severity: IssueSeverity;
  readonly category: string;
  readonly tags: readonly string[];
}

/** Everything {@link fileGithubIssue} needs about the CALLER's own identity and corpus, beyond `input`/`cfg`. */
export interface GithubFilingContext {
  /** The reporter's own corpus root (see `resolveConsumerCorpusRoot`) — receipts live under `<root>/.lore/`. */
  readonly consumerCorpusRoot: string;
  /** The reporter's OWN corpus service — used ONLY to resolve `reporter_root_prd` (this corpus's root PRD), never the upstream's. */
  readonly corpusService: CorpusService;
  /**
   * The resolved filing actor — every `resolveActorWithSource` tier
   * (`@lore/core/node`) always resolves SOME string, including the
   * `"os-fallback"` tier (`os.userInfo().username`). Required, mirroring
   * `RawReporterIdentity.actor`'s own required-string shape: when
   * `actorSource === "os-fallback"`, `redactReporterIdentity` DROPS this
   * value from the published identity regardless of what it is (Risk R1),
   * so its content is irrelevant for that tier but its PRESENCE is not
   * optional at this type.
   */
  readonly actor: string;
  /** Which precedence tier produced `actor` — `"os-fallback"` is DROPPED entirely by `redactReporterIdentity` (Risk R1). */
  readonly actorSource: ReporterActorSource;
  /** The ambient home directory, for redacting `reporter_corpus`'s path prefix. Defaults to `os.homedir()`. */
  readonly home?: string;
}

/** Successful outcome of {@link fileGithubIssue}. */
export interface GithubReportResult {
  readonly number: number;
  readonly url: string;
  readonly possible_duplicates: string[];
  /** `true` iff the advisory dedup search errored — filing proceeded (or the retry short-circuit fired) anyway. */
  readonly dedup_degraded: boolean;
  /** `true` iff this call returned a PRIOR filing's outcome rather than creating a new issue (retry recognition). */
  readonly retried: boolean;
}

/**
 * Finds a prior SUCCESSFUL filing for the exact same `title` inside an
 * already-read {@link ReceiptV2Entry} list — the retry-recognition
 * mechanism `fileGithubIssue` runs BEFORE calling `GitHubIntakePort` at all.
 *
 * Pairs an `outcome` line back to its originating `intent` line by
 * `idempotency_key` (the outcome schema itself carries no `title`, only the
 * intent does — `receipt-log-v2.ts`'s closed per-phase field sets), then
 * compares that paired title against `title` byte-for-byte. This is a
 * deliberate LOCAL-RECEIPT-LOOKUP strategy (one of the two the spec's own
 * paired e2e test names as valid) rather than a content-hash-derived
 * `idempotency_key` — the six-field front-matter closed set has no room for
 * a seventh "content signature" field, so title-matching against the one
 * content field the receipt log already carries is the only zero-schema-
 * change option.
 *
 * @param entries - `ReceiptLogV2.read()`'s already-parsed entries (any mix
 *   of intent/outcome/legacy rows — legacy v1 rows carry no `phase` key and
 *   are ignored here)
 * @param title - the new report's title to match against
 * @returns the matched `{number, url}`, or `undefined` when no prior
 *   successful filing shares this exact title
 */
function findPriorGithubFiling(
  entries: readonly ReceiptV2Entry[],
  title: string,
): { number: number; url: string } | undefined {
  const intentTitleByKey = new Map<string, string>();
  for (const entry of entries) {
    if ("phase" in entry && entry.phase === "intent") {
      intentTitleByKey.set(entry.idempotency_key, entry.title);
    }
  }
  for (const entry of entries) {
    if ("phase" in entry && entry.phase === "outcome" && intentTitleByKey.get(entry.idempotency_key) === title) {
      return { number: entry.number, url: entry.url };
    }
  }
  return undefined;
}

/**
 * Resolves the REPORTER'S OWN root PRD (`{id, slug}`) — the identity
 * `reporter_root_prd` publishes (Risk R1's "corpus name + root-PRD id"
 * mitigation). Deliberately the LOCAL corpus's root PRD, never the
 * upstream's — mirrors the "first PRD found" convention the now-deleted
 * legacy SQLite upstream port used for its own root-doc resolution, applied
 * here against the CALLER's own `CorpusService` instead of an opened
 * upstream connection.
 *
 * @returns `ok({id, slug})`, or `ok(null)` when this corpus has no PRD at
 *   all (a fact, not an error); `err(...)` only on a genuine store failure
 */
async function resolveLocalRootPrd(
  corpusService: CorpusService,
): Promise<Result<{ id: string; slug: string } | null, LoreError>> {
  const listResult = await corpusService.list({ type: "prd" });
  if (!listResult.ok) return listResult;
  const rootPrd = listResult.value.docs[0];
  return ok(rootPrd ? { id: rootPrd.id, slug: rootPrd.slug } : null);
}

/** Joins `description`/`expected`/`actual`/`repro_command` into ONE free-form body block — the consumer-authority content the Per-Field-Authority table assigns to the issue body (never the front-matter block). */
function buildIssueDescriptionBlock(input: GithubReportInput): string {
  const lines = [input.description, "", `**Expected:** ${input.expected}`, `**Actual:** ${input.actual}`];
  if (input.repro_command !== undefined) {
    lines.push(`**Repro command:** \`${input.repro_command}\``);
  }
  return lines.join("\n");
}

/**
 * Orchestrates the LIVE GitHub filing path — the caller-side glue around
 * `GitHubIntakePort`'s four ops (`report-issue.ts` calls this instead of
 * `IssueReportService.report()` whenever `resolveFeedbackUpstreamCfg`
 * resolved the GITHUB shape, see {@link isGithubUpstreamCfg}). Runs, in
 * order:
 *   1. Retry recognition — reads the LOCAL v2 receipt log and returns a
 *      PRIOR filing's outcome verbatim (no network call at all) when one
 *      exists for the exact same title ({@link findPriorGithubFiling}).
 *   2. `verifyTarget()` — fail loud before any write-shaped call.
 *   3. `searchDuplicates()` — advisory; a failure degrades, never blocks.
 *   4. Resolves the reporter's own identity (`resolveLocalRootPrd`,
 *      `os.homedir()`) and calls `fileIssue()`, which itself performs the
 *      redaction + front-matter assembly + two-phase receipt writes.
 *
 * @param input - the report's content + already-validated triage labels
 * @param cfg - the GitHub-shaped `feedback.upstream` config
 * @param ctx - the caller's own corpus/identity context
 * @returns see {@link GithubReportResult}; `err(...)` on the first failing
 *   step (retry recognition itself never fails the call — a receipt-log
 *   read error just means "no known prior filing", proceeding to file
 *   normally, mirroring the dedup-degrade philosophy of "advisory checks
 *   never block filing")
 */
export async function fileGithubIssue(
  input: GithubReportInput,
  cfg: GithubUpstreamCfg,
  ctx: GithubFilingContext,
): Promise<Result<GithubReportResult, LoreError>> {
  const receiptsPath = join(ctx.consumerCorpusRoot, ".lore", RECEIPT_LOG_V2_FILENAME);

  const priorReadResult = new ReceiptLogV2(receiptsPath).read();
  if (priorReadResult.ok) {
    const prior = findPriorGithubFiling(priorReadResult.value.entries, input.title);
    if (prior !== undefined) {
      return ok({
        number: prior.number,
        url: prior.url,
        possible_duplicates: [],
        dedup_degraded: false,
        retried: true,
      });
    }
  }

  const runner = new GhRunner({ execFile: createNodeGhExecFile() });
  const port = new GitHubIntakePort({ runner, repo: cfg.repo, receiptsPath });

  const verifyResult = await port.verifyTarget();
  if (!verifyResult.ok) return verifyResult;

  let possibleDuplicates: string[] = [];
  let dedupDegraded = false;
  const dedupResult = await port.searchDuplicates(input.title, 5);
  if (dedupResult.ok) {
    possibleDuplicates = dedupResult.value;
  } else {
    dedupDegraded = true;
  }

  const rootPrdResult = await resolveLocalRootPrd(ctx.corpusService);
  if (!rootPrdResult.ok) return rootPrdResult;
  const rootPrd = rootPrdResult.value;
  if (rootPrd === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "reporter_root_prd",
      message:
        "this corpus has no root PRD at all — 'reporter_root_prd' (Risk R1's identity mitigation) has nothing " +
        "to publish. Create one (`lore create prd`) before filing.",
      value: ctx.consumerCorpusRoot,
    });
  }

  const identity: RawReporterIdentity = {
    corpusRoot: ctx.consumerCorpusRoot,
    home: ctx.home ?? homedir(),
    rootPrdId: rootPrd.slug,
    actor: ctx.actor,
    actorSource: ctx.actorSource,
  };

  const fileResult = await port.fileIssue({
    title: input.title,
    description: buildIssueDescriptionBlock(input),
    severity: input.severity,
    category: input.category,
    tags: input.tags,
    identity,
  });
  if (!fileResult.ok) return fileResult;

  return ok({
    number: fileResult.value.number,
    url: fileResult.value.url,
    possible_duplicates: possibleDuplicates,
    dedup_degraded: dedupDegraded,
    retried: false,
  });
}
