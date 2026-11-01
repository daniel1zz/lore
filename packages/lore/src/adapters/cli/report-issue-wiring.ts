/**
 * Shared CLI composition helper for `lore report-issue`
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
 *     (LEGACY `{root_prd, ...}`, GITHUB `{repo}`, or VENDOR-CONSENT
 *     `{vendor: true}` — spec-the-defect-channel-reaches-no-machine-but-its-
 *     own-github P2 plus the vendor-intake split, 2026-08-25). STAYS the ONLY
 *     `feedback.upstream` READ site (plan invariant).
 *   - `isVendorUpstreamCfg(cfg)` — type guard for the VENDOR-CONSENT branch.
 *     ⛔ `isGithubUpstreamCfg` answering `false` does NOT mean "legacy shape":
 *     its discriminant is `"repo" in cfg` and a `{vendor: true}` config has NO
 *     `repo` key, so a hand-rolled `if (github) ... else retired` chain
 *     misclassifies vendor configs and refuses them with the retired-SQLite
 *     message. ⇒ new callers MUST route through `classifyFeedbackUpstream`
 *     rather than compose the guards themselves.
 *   - `isGithubUpstreamCfg(cfg)` — type guard for the GITHUB branch. Kept
 *     exported for `tests/` and for symmetry with the vendor guard; ⛔ NO
 *     production caller may use it as a standalone shape policy any more —
 *     `commands/issues.ts` and `commands/report-issue.ts` both route through
 *     `classifyFeedbackUpstream`. (A caller that re-derives the chain with
 *     `isGithubUpstreamCfg` alone is exactly the site the vendor branch would
 *     have silently broken.)
 *   - `classifyFeedbackUpstream(config)` — the ONE shape-policy source both
 *     `commands/issues.ts` and `commands/report-issue.ts` consume
 *     (spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired D1):
 *     classifies a parsed `LoreConfig`'s `feedback.upstream` into exactly one
 *     of `"unconfigured"` / `"retired"` / `"github"`, carrying the shared
 *     retired-shape `LoreError` and the narrowed `GithubUpstreamCfg`
 *     respectively so no caller re-derives shape policy in its own
 *     `if` chain (the drift that let `lore issues` silently fall through to
 *     the local corpus on a retired-shape upstream while `lore report-issue`
 *     already refused it). ALSO the one NORMALIZATION point: a VENDOR-CONSENT
 *     `{vendor: true}` config is returned as `{kind: "github", cfg: {repo:
 *     VENDOR_INTAKE_REPO}}`, so every downstream consumer keeps seeing exactly
 *     one addressing shape.
 *   - `fileGithubIssue(input, cfg, ctx)` — the LIVE GitHub filing path's
 *     orchestration (AC-GI-1): retry recognition over the local v2 receipt
 *     log, then `GitHubIntakePort.verifyTarget`/`.searchDuplicates`/
 *     `.fileIssue`. GitHub owns the report: filing creates NO corpus document
 *     (spec-github-owns-issue-report-state-no-mirror-task-work-carries D7,
 *     AC-GS-10) — the only local trace is the filing log's intent + outcome
 *     receipts, written by `GitHubIntakePort.fileIssue`. The LIVE path
 *     `commands/report-issue.ts` calls whenever `classifyFeedbackUpstream`
 *     resolves the GITHUB shape.
 *   - `resolveGithubIssueListing(cfg)` — the ONE place that constructs
 *     `GhRunner` + `GitHubIntakePort` for READS (AC-GR-1): `verifyTarget()`
 *     for the numeric repo id, then `listIssues()` for the batched listing.
 *   - `resolveGithubStatusRows(corpusService, cfg)` — the read surface's
 *     shared read+join (AC-GS-3): calls `resolveGithubIssueListing` then joins
 *     the live listing against the carriers (tasks and plans naming an issue in
 *     `extra.issues`) via `github-issue-listing.ts::joinIssueStatuses`, so
 *     `commands/issues.ts` and `commands/report-issue.ts --list` render off ONE
 *     join, never two. Read-only by construction — see that function's own header.
 *
 * Invariants:
 *   - `resolveConsumerCorpusRoot` internally calls `findLoreDbPath` (which
 *     `exitCli(1)`s on a miss) — `loadLoreApp()` already called it once,
 *     successfully, at startup, so a per-call re-walk from the same cwd
 *     cannot newly fail.
 *   - This module does NO actor resolution — the CLI resolves via
 *     `resolveActor`; the caller threads the resolved actor through
 *     `GithubFilingContext.actor`, never through anything built here.
 *   - ⛔ `fileGithubIssue` NEVER writes the corpus (AC-GS-10): the former
 *     mint-a-task step and its split-write failure path are deleted. The
 *     retry branch (a prior successful filing for this exact title is in the
 *     local receipt log AND that earlier issue is still open on GitHub)
 *     returns the prior outcome and creates nothing; the earlier issue's
 *     state is read from GitHub first, and a failed read fails the filing
 *     by kind (#397).
 *     `ctx.corpusService` is READ only, to resolve the reporter's root PRD.
 *
 * Side-effect class: IO indirectly — `fileGithubIssue` reads/writes the local
 * v2 receipt log and calls `gh` via `GitHubIntakePort`; it writes no corpus
 * document.
 *
 * Source: SPEC-072 §3 Structure, §4 Public Interface, §11 Downstream Handoff;
 * spec-the-defect-channel-reaches-no-machine-but-its-own-github P2/P4;
 * spec-a-github-filed-defect-must-be-claimable-one-ingest-seam D8, D13 (the
 * mint they describe is retired by spec-github-owns-issue-report-state-no-mirror-
 * task-work-carries D7).
 */

import { accessSync, constants as fsConstants, existsSync, statSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { isSameGithubRepository } from "../../service/github-remote.js";
import { buildReportContext } from "../../service/report-issue-context.js";
import { exitCli } from "./cli-exit.js";
import {
  err,
  ok,
  validationError,
  VENDOR_INTAKE_REPO,
  type FeedbackConfig,
  type IssueSeverity,
  type LoreConfig,
  type LoreError,
  type RawReporterIdentity,
  type Result,
} from "@lore/core";
import type { CorpusService } from "../../service/corpus-service.js";
import { renderIssueReportBody } from "../../service/issue-report-body.js";
import { checkReproCommand, type ReproCheck } from "../../service/report-issue-repro.js";
import { GhRunner, createNodeGhExecFile } from "../../service/gh-runner.js";
import { GitHubIntakePort, type GithubListedIssue } from "../../service/github-intake-port.js";
import { joinIssueStatuses, type IssueStatusRow } from "../../service/github-issue-listing.js";
import { ReceiptLogV2, type ReceiptV2Entry, type ReceiptV2ReadResult } from "../../service/receipt-log-v2.js";
import { findLoreDbPath, type CorpusLocator } from "./corpus-resolution.js";
import type { CliIo } from "./output.js";

/**
 * Resolves the CALLING corpus's own root — the directory containing
 * `.lore/` — via the SAME walk-up `loadLoreApp` uses. This is NEVER the
 * upstream corpus `lore report-issue` files a report INTO; it is where the
 * local receipt log (`<root>/.lore/issue-receipts.jsonl`) lives.
 *
 * @param locator - the run's `cwd` + `env` (an `Invocation` works)
 * @returns absolute path to the consumer corpus root
 * @throws exitCli(1) via `findLoreDbPath` (unchanged CLI convention)
 *   when no `.lore/lore.db` is discoverable from `cwd` — see this module's
 *   header for why a per-call re-walk is safe.
 */
export function resolveConsumerCorpusRoot(io: CliIo, locator: CorpusLocator): string {
  const dbPath = findLoreDbPath(io, locator);
  return dirname(dirname(dbPath));
}

/**
 * Consumer-side `feedback.upstream.*` config, ANY of its three shapes — DERIVED
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
 * Consumer-side `feedback.upstream.*` config, VENDOR-CONSENT shape
 * (`{vendor: true}`) — the branch that carries CONSENT to report into the
 * vendor's own intake and NO address, the address being `@lore/core`'s
 * `VENDOR_INTAKE_REPO`.
 */
export type VendorUpstreamCfg = Extract<UpstreamCfg, { vendor: true }>;

/**
 * Type guard for the VENDOR-CONSENT branch — `"vendor" in cfg`, sound for the
 * same reason `isGithubUpstreamCfg`'s discriminant is: `FeedbackConfigSchema`'s
 * three union branches are each `.strict()`, so no config can carry `vendor`
 * alongside `repo` or `root_prd` and still parse.
 *
 * ⛔ A `false` from {@link isGithubUpstreamCfg} does NOT mean "legacy shape".
 * That guard tests `"repo" in cfg`, and a `{vendor: true}` config has no `repo`
 * key — so any chain written as `if (isGithubUpstreamCfg(cfg)) {...} else
 * {retired}` refuses a perfectly valid vendor-consent config with
 * {@link buildRetiredFeedbackUpstreamError}'s retired-SQLite message. That
 * two-branch shape is what a removed adapter handler had, and it is the reason the vendor branch had to be added to
 * {@link classifyFeedbackUpstream} rather than left to each caller.
 *
 * ⇒ ⛔ Do not rebuild the chain: call {@link classifyFeedbackUpstream} and read
 * its `kind`. This guard is exported for tests and for symmetry with
 * `isGithubUpstreamCfg`, not as a shape policy to compose by hand. (Within
 * `classifyFeedbackUpstream` itself the two guards' relative order is NOT
 * load-bearing — measured: swapping them keeps every assertion green, because
 * `retired` is a fall-through at the end, not an `else`. What IS load-bearing
 * is that the vendor branch EXISTS; see that function's own inline note for the
 * measured deletion experiment.)
 *
 * @example
 *   isVendorUpstreamCfg({ vendor: true }) // => true
 *   isVendorUpstreamCfg({ repo: "acme/widget" }) // => false
 */
export function isVendorUpstreamCfg(cfg: UpstreamCfg): cfg is VendorUpstreamCfg {
  return "vendor" in cfg;
}

/**
 * Type guard distinguishing the GitHub shape from the other two — every branch
 * of `FeedbackConfigSchema.upstream` is `.strict()` and their required-key sets
 * are disjoint, so `"repo" in cfg` is a sound discriminant even though no
 * branch carries an explicit tag field.
 *
 * ⛔ NOT a complete shape policy on its own: `false` means "not the GitHub
 * shape", NOT "the legacy shape" — `{vendor: true}` also answers `false` here.
 * Consult {@link isVendorUpstreamCfg} FIRST, or (preferably) call
 * {@link classifyFeedbackUpstream} and read its `kind`.
 *
 * @example
 *   isGithubUpstreamCfg({ repo: "acme/widget" }) // => true
 *   isGithubUpstreamCfg({ corpus_path: "/x", root_prd: "prd-x" }) // => false
 *   isGithubUpstreamCfg({ vendor: true }) // => false — see the warning above
 */
export function isGithubUpstreamCfg(cfg: UpstreamCfg): cfg is GithubUpstreamCfg {
  return "repo" in cfg;
}

/**
 * The retired legacy-SQLite-shape refusal — the ONE place this string
 * literal lives (spec-lore-issues-falls-through-to-the-local-corpus-on-a-
 * retired D1). Both `commands/report-issue.ts` and `commands/issues.ts`
 * consume it via {@link classifyFeedbackUpstream}'s `"retired"` branch;
 * neither holds its own copy. Moved here verbatim from
 * `commands/report-issue.ts`'s former `buildLegacyUpstreamRetiredError` —
 * `report-issue.ts` was the only verb that refused this shape before this
 * spec; `issues.ts` fell through to reading the local corpus instead, which
 * is the defect this classifier closes.
 *
 * Exported (spec-the-retired-shape-refusal-message-has-two-byte-identical
 * D1) so a caller outside {@link classifyFeedbackUpstream} calls this instead
 * of holding its own copy of the message. Before D1, such a copy had already
 * drifted ("file issue reports" vs. this function's "file/list issue
 * reports") with no oracle to catch it.
 *
 * Return type is narrowed to the `VALIDATION_ERROR` member (the
 * `Extract<LoreError, {code: "..."}>` pattern already used by
 * `config.ts::isValidationError`'s narrowing and `in-memory-provider.ts`'s
 * `AI_PROVIDER_ERROR` results) rather than the full `LoreError` union — a
 * caller reading `.message`/`.field` off this specific builder's result
 * (e.g. an equality probe comparing it against another VALIDATION_ERROR)
 * needs that without re-narrowing by `code` first; widening back to
 * `LoreError` at each call site (`classifyFeedbackUpstream`'s `"retired"`
 * branch) is a normal subtype-to-supertype
 * assignment.
 */
export function buildRetiredFeedbackUpstreamError(): Extract<LoreError, { code: "VALIDATION_ERROR" }> {
  return {
    code: "VALIDATION_ERROR",
    field: "feedback.upstream",
    message:
      "this corpus's feedback.upstream is configured with the retired SQLite shape " +
      "({root_prd, ...}) — SQLite-based issue reporting was removed " +
      "(spec-the-defect-channel-reaches-no-machine-but-its-own-github P4). Reconfigure " +
      'feedback.upstream.repo (e.g. "owner/repo") to file/list issue reports via GitHub.',
  };
}

/**
 * {@link classifyFeedbackUpstream}'s three possible verdicts — a
 * discriminated union so a `"github"` caller reaches `.cfg.repo` with no
 * separate `isGithubUpstreamCfg` call, and a `"retired"` caller gets the
 * SHARED refusal `LoreError` (never a second, independently-worded copy).
 */
export type FeedbackUpstreamClassification =
  | { readonly kind: "unconfigured" }
  | { readonly kind: "retired"; readonly error: LoreError }
  | { readonly kind: "github"; readonly cfg: GithubUpstreamCfg };

/**
 * ONE shape-policy source for a consumer's `feedback.upstream`, consumed by
 * BOTH `commands/issues.ts` (READ) and `commands/report-issue.ts` (WRITE) —
 * spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired D1. Before
 * this function existed, each verb re-derived the same three-way shape
 * policy in its own `if` chain via `isGithubUpstreamCfg` alone, and they
 * drifted: `report-issue` refused a retired-shape upstream loudly,
 * `issues` silently fell through to reading the local corpus, indistinguishable
 * from "nothing configured". Routing both verbs through this ONE function
 * makes that drift structurally impossible — there is nowhere left for a
 * second, independently-derived verdict to live.
 *
 * @param config - the consumer's own parsed `.lore/config.yaml` (`undefined`
 *   when none was found/parsed) — routed through
 *   {@link resolveFeedbackUpstreamCfg}, which STAYS the only
 *   `feedback.upstream` READ site (this module's own header)
 * ⛔ ALSO the ONE normalization point for the VENDOR-CONSENT shape: a
 * `{vendor: true}` config is reported as `{kind: "github", cfg: {repo:
 * VENDOR_INTAKE_REPO}}`. That is deliberate rather than a fourth `kind` —
 * `vendor` declares CONSENT, not a destination, and the destination it consents
 * to is a GitHub repository reached through exactly the same
 * `GitHubIntakePort`. Collapsing it here means `fileGithubIssue`,
 * `resolveGithubIssueListing`, and `resolveGithubStatusRows`
 * need ZERO changes and cannot learn a second addressing path — the
 * "capability implemented but not wired" failure mode, closed by construction.
 *
 * @returns `{kind: "unconfigured"}` when `feedback.upstream` is absent;
 *   `{kind: "retired", error}` when configured with the legacy
 *   `{corpus_path, root_prd}` shape, `error` carrying the SAME
 *   `VALIDATION_ERROR` literal both verbs must emit verbatim
 *   ({@link buildRetiredFeedbackUpstreamError}); `{kind: "github", cfg}` when
 *   configured with the GitHub `{repo}` shape OR with the VENDOR-CONSENT
 *   `{vendor: true}` shape (normalized to `{repo: VENDOR_INTAKE_REPO}`)
 */
export function classifyFeedbackUpstream(config: LoreConfig | undefined): FeedbackUpstreamClassification {
  const cfg = resolveFeedbackUpstreamCfg(config);
  if (cfg === undefined) return { kind: "unconfigured" };
  // ⛔ This branch is what makes a `{vendor: true}` config reachable AT ALL.
  // `isGithubUpstreamCfg` is `"repo" in cfg` and a vendor config carries no
  // `repo`, so with this line absent a vendor config falls all the way to the
  // `retired` return below and is refused as "the retired SQLite shape" — a
  // false statement about a valid config, which is exactly what every surface
  // did before this branch existed.
  //
  // MEASURED minimal mutation (2026-08-25) — deleting THIS line reddens 3
  // assertions in `tests/unit/adapters/feedback-upstream-vendor.test.ts`
  // (`kind: "retired"` where `"github"` is expected).
  //
  // ⛔ Deliberately NOT claimed: that the two guards' ORDER is what does the
  // work here. It is not — measured: SWAPPING these two `if`s leaves all 18
  // assertions GREEN, because the `retired` verdict is a fall-through at the
  // END rather than an `else` on the GitHub test. The order still matters to
  // any caller that hand-rolls the chain as `if (isGithubUpstreamCfg) {...}
  // else {retired}` (a shape a caller might hand-roll), which is why
  // `isVendorUpstreamCfg`'s JSDoc warns about it and why every production
  // caller routes through THIS function instead of rebuilding the chain.
  if (isVendorUpstreamCfg(cfg)) return { kind: "github", cfg: { repo: VENDOR_INTAKE_REPO } };
  if (isGithubUpstreamCfg(cfg)) return { kind: "github", cfg };
  return { kind: "retired", error: buildRetiredFeedbackUpstreamError() };
}

// ─── GitHub read path (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam, AC-GR-1/2/10/12) ───

/**
 * One live GitHub issue listing (D3's read half): the numeric repo id
 * `joinIssueStatuses` keys on (`repo_id`, D5's rename-proof identity) plus the
 * batched issue list, both fetched by {@link resolveGithubIssueListing}.
 */
export interface GithubIssueListing {
  readonly issues: readonly GithubListedIssue[];
  readonly repoId: number;
}

/**
 * The ONE place that constructs `GhRunner` + `GitHubIntakePort` for READS
 * (`lore issues`, `lore report-issue --list`) — mirrors {@link fileGithubIssue}'s
 * own construction for WRITES. Without this, each read site would
 * independently build its own runner + port, exactly the duplication
 * {@link classifyFeedbackUpstream} exists to prevent for shape policy.
 *
 * @param cfg - the GitHub-shaped `feedback.upstream` config
 * @returns `ok({issues, repoId})` — `repoId` is `verifyTarget()`'s numeric
 *   `id` (the join key `joinIssueStatuses` and the carrier refs both key on, never
 *   the stored `owner/repo` string, D5); `issues` is `listIssues()`'s
 *   batched result — ONE `gh api` call regardless of listing size.
 *   `err(...)` on the first failing call: `verifyTarget()`'s auth/target
 *   failure surfaces BEFORE `listIssues()` is ever attempted.
 */
export async function resolveGithubIssueListing(io: CliIo, 
  cfg: GithubUpstreamCfg,
  locator: CorpusLocator,
): Promise<Result<GithubIssueListing, LoreError>> {
  const receiptsPath = join(resolveConsumerCorpusRoot(io, locator), ".lore", RECEIPT_LOG_V2_FILENAME);
  const runner = new GhRunner({ execFile: createNodeGhExecFile(locator.cwd), env: locator.env });
  const port = new GitHubIntakePort({ runner, repo: cfg.repo, receiptsPath });

  const verifyResult = await port.verifyTarget();
  if (!verifyResult.ok) return verifyResult;

  const listResult = await port.listIssues();
  if (!listResult.ok) return listResult;

  return ok({ issues: listResult.value.issues, repoId: verifyResult.value.id });
}

/**
 * Reads the complete live GitHub listing and joins it against the carriers (every task and plan whose
 * `extra.issues` names an issue, archived ones included) — the ONE read path `commands/issues.ts` and
 * `commands/report-issue.ts --list` share, so neither builds its own port or its own join (AC-GS-3).
 *
 * ⛔ READ-ONLY: calls `corpusService.listFull` only, never a write. ⛔ No offline fallback: when the
 * listing fails, the error is returned as-is and no carrier row is produced (AC-GS-2) — a carrier alone
 * proves nothing about what GitHub currently shows.
 *
 * @param corpusService - the caller's own `CorpusService` (the only corpus consulted)
 * @param cfg - the GitHub-shaped `feedback.upstream` config
 * @param locator - the run's `cwd` + `env` (an `Invocation`)
 * @returns `ok({repoId, issues, rows})` — `rows` has exactly one entry per listed issue, in listing order;
 *   `err(...)` on the first failing `gh`/store call
 */
export async function resolveGithubStatusRows(io: CliIo,
  corpusService: CorpusService,
  cfg: GithubUpstreamCfg,
  locator: CorpusLocator,
): Promise<Result<{ repoId: number; issues: readonly GithubListedIssue[]; rows: readonly IssueStatusRow[] }, LoreError>> {
  const listingResult = await resolveGithubIssueListing(io, cfg, locator);
  if (!listingResult.ok) return listingResult;
  const { issues, repoId } = listingResult.value;

  const carriers = [];
  for (const type of ["task", "plan"] as const) {
    const listed = await corpusService.listFull({ type });
    if (!listed.ok) return listed;
    carriers.push(...listed.value.docs.filter((doc) => Array.isArray((doc.extra as Record<string, unknown> | null | undefined)?.["issues"])));
  }
  return ok({ repoId, issues, rows: joinIssueStatuses(issues, carriers, repoId, new Date().toISOString()) });
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
  /** Free multi-line text: the steps a one-line `repro_command` cannot hold. */
  readonly repro_steps?: string;
  /** The reporter's proposed fix, kept out of `expected` (which stays the behaviour). */
  readonly suggested_fix?: string;
  /** Specs, criteria, commits or issues the report relates to; one bullet each. */
  readonly refs?: readonly string[];
  /** The `**Context:**` section text (attached test-file context); set by {@link fileGithubIssue}, never by an input adapter. */
  readonly context?: string;
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
   * The filing actor: the name of the invocation's known party (an agent run's session name, a registered human's
   * or a key's own name). Required, mirroring `RawReporterIdentity.actor`'s own required-string shape.
   */
  readonly actor: string;
  /** The Invocation's home directory (`inv.paths.home`), for redacting `reporter_corpus`'s path prefix. No ambient default (AS-26). */
  readonly home: string;
  /** The environment `gh` is spawned from (`Invocation.env`; no ambient default, AS-26). */
  readonly env: NodeJS.ProcessEnv;
  /** Runs `git <args>` in `cwd` for the origin lookup (injected so a test needs no git); default: the real `git` under `env`. */
  readonly git?: OriginGit;
  /** Reads the local v2 receipt log for the repeat check (injected so a test needs no unreadable file); default: `ReceiptLogV2.read()`. */
  readonly readReceiptLog?: (receiptsPath: string) => Result<ReceiptV2ReadResult, LoreError>;
}

/**
 * Why the repeat check ran on less than the whole filing log (BR-500): `unreadable` = the log could not be read at
 * all (nothing was checked); `corrupt_lines` = unparseable lines were skipped (the readable entries were checked).
 */
export interface RepeatCheckDegraded {
  readonly reason: "unreadable" | "corrupt_lines";
  /** Human-readable cause: the read error's message, or the skipped line numbers. */
  readonly detail: string;
  /** How many log lines the check could not use (0 when the whole log was unreadable). */
  readonly skipped_lines: number;
}

/** Raw outcome of one git call; `status` is the exit status (non-zero when git is missing or refuses). */
export type OriginGit = (cwd: string, args: readonly string[], env: NodeJS.ProcessEnv) => { status: number; stdout: string };

/** The real git for the origin lookup: never throws; a missing git reads as a non-zero status. */
const runRealGit: OriginGit = (cwd, args, env) => {
  const outcome = spawnSync("git", [...args], { cwd, env, encoding: "utf8" });
  return { status: outcome.status ?? 1, stdout: outcome.stdout ?? "" };
};

/**
 * Builds the `**Context:**` section for a filing: ONE git call for the project's `origin`, then the pure builder.
 *
 * @param input - the report (its repro command names the test file)
 * @param upstreamRepo - the upstream `owner/name` the report is filed to
 * @param ctx - the caller's root, home, env and optional injected git
 * @returns the section text, or `undefined` when the command names no test file
 */
function buildFilingContext(input: GithubReportInput, upstreamRepo: string, ctx: GithubFilingContext): string | undefined {
  if (input.repro_command === undefined) return undefined;
  const git = ctx.git ?? runRealGit;
  const origin = git(ctx.consumerCorpusRoot, ["remote", "get-url", "origin"], ctx.env);
  const originUrl = origin.status === 0 ? origin.stdout.trim() : undefined;
  return buildReportContext({
    command: input.repro_command,
    projectRoot: ctx.consumerCorpusRoot,
    home: ctx.home,
    sameRepository: isSameGithubRepository(originUrl, upstreamRepo),
  });
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
  /** Set iff the repeat check could not read the whole filing log (BR-500); absent when the log was read cleanly. */
  readonly repeat_check_degraded?: RepeatCheckDegraded;
}

/**
 * Derives the repeat-check degradation of one log read (BR-500).
 *
 * @param read - the receipt log read result
 * @returns the degradation, or `undefined` when the log was read cleanly
 */
function describeRepeatCheckDegradation(read: Result<ReceiptV2ReadResult, LoreError>): RepeatCheckDegraded | undefined {
  if (!read.ok) {
    // reason: not every LoreError member carries `message`; the code is the stable fallback detail.
    const detail = "message" in read.error ? read.error.message : read.error.code;
    return { reason: "unreadable", detail, skipped_lines: 0 };
  }
  const corrupt = read.value.corrupt_lines;
  if (corrupt.length === 0) return undefined;
  return {
    reason: "corrupt_lines",
    detail: `${String(corrupt.length)} unreadable line(s) in the filing log: ${corrupt.join(", ")}`,
    skipped_lines: corrupt.length,
  };
}

/**
 * The single CLI warning line for a degraded repeat check (BR-500).
 *
 * @param result - a filing result
 * @returns the `Warning: repeat check degraded ...` line, or `undefined` for a clean result
 */
export function formatRepeatCheckWarning(result: GithubReportResult): string | undefined {
  const degraded = result.repeat_check_degraded;
  if (degraded === undefined) return undefined;
  // reason: the ending states the OUTCOME, not the cause: only the early already-filed return recognised a repeat.
  const outcome = result.retried ? "recognised from the readable entries" : "filed anyway";
  return `Warning: repeat check degraded (${degraded.detail}) — ${outcome}.`;
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
function findPriorGithubFilings(
  entries: readonly ReceiptV2Entry[],
  title: string,
): { number: number; url: string }[] {
  const intentTitleByKey = new Map<string, string>();
  for (const entry of entries) {
    if ("phase" in entry && entry.phase === "intent") {
      intentTitleByKey.set(entry.idempotency_key, entry.title);
    }
  }
  const priors: { number: number; url: string }[] = [];
  for (const entry of entries) {
    if ("phase" in entry && entry.phase === "outcome" && intentTitleByKey.get(entry.idempotency_key) === title) {
      priors.push({ number: entry.number, url: entry.url });
    }
  }
  // reason: newest first, so a title re-filed after its earlier issue was closed recognises the latest issue.
  return priors.reverse();
}

const GithubIssueStateSchema = z.object({ state: z.string() }).passthrough();

/**
 * The prior filing that is still OPEN, or `undefined` when every prior issue for the title is closed.
 *
 * reason: the receipt log exists so a retried IN-FLIGHT filing does not duplicate. A closed prior issue is a fixed
 * defect, not an in-flight filing: recognising it returned a closed issue that covers nothing, and a review batch that
 * hit the same fingerprint again looped forever (#397). A state read failure is returned, never read as "closed".
 */
async function findOpenPriorFiling(
  runner: GhRunner,
  repo: string,
  priors: readonly { number: number; url: string }[],
): Promise<Result<{ number: number; url: string } | undefined, LoreError>> {
  for (const prior of priors) {
    const read = await runner.run(["api", `repos/${repo}/issues/${String(prior.number)}`]);
    if (!read.ok) return read;
    let body: unknown;
    try {
      body = JSON.parse(read.value.stdout);
    } catch {
      body = undefined;
    }
    const parsed = GithubIssueStateSchema.safeParse(body);
    if (!parsed.success) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gh_issue_response",
        message: `gh returned an issue payload for #${String(prior.number)} that has no state: ${parsed.error.message}`,
        value: read.value.stdout,
      });
    }
    if (parsed.data.state === "open") return ok(prior);
  }
  return ok(undefined);
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

/** The slice of an Invocation the repro-command check reads: its PATH (never the process default) and its cwd. */
export interface ReproCheckEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}

/**
 * Runs {@link checkReproCommand} against the invocation's own PATH and cwd — the ONE composition of the lookups,
 * used by the CLI flag so it refuses the same values everywhere.
 *
 * @param command - the raw `--repro-command` / `repro_command` value
 * @param environment - the invocation's `env` and `cwd`
 * @returns the check result (pure data; the caller renders the refusal)
 */
export function checkReproCommandForInvocation(command: string, environment: ReproCheckEnvironment): ReproCheck {
  const pathDirs = (environment.env["PATH"] ?? "").split(delimiter).filter((dir) => dir.length > 0);
  return checkReproCommand(command, {
    selfName: "lore",
    which: (name) =>
      pathDirs.some((dir) => {
        const candidate = join(dir, name);
        try {
          accessSync(candidate, fsConstants.X_OK);
          return statSync(candidate).isFile();
        } catch {
          // reason: an unreadable or missing PATH entry simply does not hold the program.
          return false;
        }
      }),
    pathExists: (path) => existsSync(resolve(environment.cwd, path)),
  });
}

/**
 * One-line refusal text for a failed repro check, naming the reason and offending word and pointing at `--repro-steps`.
 *
 * @param check - a `{ ok: false }` result
 * @returns the message the CLI prints (usage error exit 2)
 */
export function formatReproRefusal(check: Extract<ReproCheck, { ok: false }>): string {
  return (
    `--repro-command must be one runnable command line, but it is refused (${check.reason}: ${check.detail}). ` +
    "Put multi-step or prose reproduction text in --repro-steps instead."
  );
}

/**
 * Orchestrates the LIVE GitHub filing path — the caller-side glue around
 * `GitHubIntakePort`'s four ops (`report-issue.ts` calls this instead of
 * `IssueReportService.report()` whenever `resolveFeedbackUpstreamCfg`
 * resolved the GITHUB shape, see {@link isGithubUpstreamCfg}). Runs, in
 * order:
 *   1. Retry recognition — reads the LOCAL v2 receipt log, then reads each
 *      earlier issue's state from GitHub (a failed read fails the filing by
 *      kind, never reads as closed), and returns a PRIOR filing's outcome
 *      verbatim (no corpus write, no create call) when one exists for the
 *      exact same title AND that prior issue is still OPEN
 *      ({@link findPriorGithubFilings}, {@link findOpenPriorFiling}); a closed
 *      prior issue files a new one with the same title (#397).
 *   2. `verifyTarget()` — fail loud before any write-shaped call.
 *   3. `searchDuplicates()` — advisory; a failure degrades, never blocks.
 *   4. Resolves the reporter's own identity (`resolveLocalRootPrd`,
 *      `os.homedir()`) and calls `fileIssue()`, which itself performs the
 *      redaction + front-matter assembly + two-phase receipt writes.
 *   ⛔ No further step: filing creates NO corpus document (AC-GS-10). The
 *   GitHub issue is the report; the receipts written in step 4 are the only
 *   local trace.
 *
 * @param input - the report's content + already-validated triage labels
 * @param cfg - the GitHub-shaped `feedback.upstream` config
 * @param ctx - the caller's own corpus/identity context
 * @returns see {@link GithubReportResult}; `err(...)` on the first failing
 *   step. A failed read of an earlier issue's state fails the filing with
 *   that error's kind (#397); only an unreadable LOCAL receipt log means
 *   "no known prior filing", proceeding to file normally
 */
export async function fileGithubIssue(
  rawInput: GithubReportInput,
  cfg: GithubUpstreamCfg,
  ctx: GithubFilingContext,
): Promise<Result<GithubReportResult, LoreError>> {
  // reason: the context is built once here so every path that calls this and the minted task share one body.
  const context = buildFilingContext(rawInput, cfg.repo, ctx);
  const input: GithubReportInput = context === undefined ? rawInput : { ...rawInput, context };
  const receiptsPath = join(ctx.consumerCorpusRoot, ".lore", RECEIPT_LOG_V2_FILENAME);

  const runner = new GhRunner({ execFile: createNodeGhExecFile(ctx.consumerCorpusRoot), env: ctx.env });

  const priorReadResult = (ctx.readReceiptLog ?? ((path) => new ReceiptLogV2(path).read()))(receiptsPath);
  const repeatCheckDegraded = describeRepeatCheckDegradation(priorReadResult);
  const degradedField = repeatCheckDegraded === undefined ? {} : { repeat_check_degraded: repeatCheckDegraded };
  if (priorReadResult.ok) {
    const priors = findPriorGithubFilings(priorReadResult.value.entries, input.title);
    const open = priors.length === 0 ? ok(undefined) : await findOpenPriorFiling(runner, cfg.repo, priors);
    if (!open.ok) return open;
    const prior = open.value;
    if (prior !== undefined) {
      // Retry recognition: the earlier issue is open (state read from GitHub above); no create call and no corpus write on this branch.
      return ok({
        number: prior.number,
        url: prior.url,
        possible_duplicates: [],
        dedup_degraded: false,
        retried: true,
        ...degradedField,
      });
    }
  }

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
        "to publish. Create one (`lore template show prd --blank`, fill it, `lore create prd --title <title> --fields-file <file>`) before filing.",
      value: ctx.consumerCorpusRoot,
      rule: "BR-493",
    });
  }

  const identity: RawReporterIdentity = {
    corpusRoot: ctx.consumerCorpusRoot,
    home: ctx.home,
    rootPrdId: rootPrd.slug,
    actor: ctx.actor,
  };

  // reason: BR-1528 — the body is rendered from the approved `issue-report` template (validated, fail loud), not hand-built.
  // reason: the template reader is the one the reporter's own CorpusService validates its writes with, so every composition
  // site that already passes `corpusService` (report-issue, assess, issues-migrate) gets it without a new context field.
  const templates = ctx.corpusService.templateReader;
  if (templates === undefined) {
    return err(validationError("templates", "the reporter's corpus service has no template reader, so the report cannot be rendered from the issue-report template (internal wiring error: nothing was filed)", undefined, "BR-1528"));
  }
  const body = await renderIssueReportBody(templates, input);
  if (!body.ok) return body;

  const fileResult = await port.fileIssue({
    title: input.title,
    description: body.value,
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
    ...degradedField,
  });
}
