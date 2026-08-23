/**
 * Pure predicates and payload assembly for SPEC-072 upstream issue reporting
 * (`lore report-issue`). All exports here are total, side-effect-free
 * functions over already-typed inputs (no IO, no `Date.now()`, no
 * `Math.random()`) — orchestration (config loading, upstream DB probing,
 * store IO) lives in `IssueReportService` (`packages/lore/src/service/`), a
 * later phase of this spec.
 *
 * Public surface:
 *   - `IssueReportPayload` — the 7-field shape persisted under a filed
 *     report's `extra.issue_report` (SPEC-072 §4).
 *   - `matchRootPrd` — R-5a identity-pin check: does the upstream corpus's
 *     root PRD match the consumer's configured `feedback.upstream.root_prd`?
 *   - `buildIssueReportExtra` — assembles the `extra` payload for the
 *     upstream ad-hoc draft task `createDraft` writes.
 *   - `ISSUE_SEVERITIES` / `IssueSeverity` / `isIssueSeverity` — the ORDERING-ONLY
 *     severity vocabulary (§M6). ⛔ Admission-inert by construction: nothing in
 *     this module reads it as an admission decision.
 *   - `readIssueTriageLabels` — the ONE defensive reader for
 *     `extra.issue_report.{severity,category}`, consumed by BOTH read surfaces so
 *     neither can render a label the other cannot see.
 *   - `ISSUE_CORPUS_LINE_PREFIX` / `formatIssueCorpusLine` — the §M4 DECLARED
 *     render contract's single composition site.
 *   - `IssueReadSource` / `resolveIssueReadSource` — the ONE decision function for
 *     WHICH corpus an issue read surface reads (§M4).
 *
 * ⛔ RETIRED (spec-the-defect-channel-reaches-no-machine-but-its-own-github P1,
 *   AC-GI-9): the R-5d open-report rate cap this module used to help enforce is
 *   deleted outright, along with its six named implementation symbols
 *   (that spec's own Scope section is the enumeration — deliberately not
 *   repeated here as literal identifiers, since AC-GI-9's oracle is a
 *   case-sensitive repo-wide scan for exactly those six strings). The retired
 *   config key itself is NEVER removed from `FeedbackConfigSchema` (a config
 *   still carrying it must go on parsing forever, `.lore/config.yaml` being
 *   gitignored with no rollback path) — see `config.ts`'s inbound-policy field
 *   for the by-name warn-and-ignore replacement (AC-GI-10).
 *
 * Concurrency contract surface (spec-report-issue-has-no-specified-
 * concurrency-contract-ac-072, §Contract Details) — the SSOT for the DECLARED
 * observable behaviour of two concurrent `lore report-issue` invocations,
 * shared by the enforcement path and by the e2e harness that measures it (D6:
 * "the 50-run harness CALLS it rather than re-implementing the rule", so an
 * e2e harness can never quietly disagree with the contract it enforces):
 *   - `WRITE_CONTENTION_EXIT_CODE` — the declared CLI exit code (5).
 *   - `UNKNOWN_CONTENDING_SOURCE` — the literal `unknown-source` (D5).
 *   - `formatWriteContentionStderr` / `matchesWriteContentionTemplate` — the
 *     declared 3-part stderr template's single renderer and its matcher.
 *   - `isWriteContentionFailure` — is a store failure SQLite write contention
 *     (as opposed to validation or any other store error)?
 *   - `classifyConcurrencyOutcome` — the D2 verdict over a pair of
 *     `{exitCode, stderr}` observations (AC-IC-1's oracle).
 *   - `classifyForcedContentionOutcome` — the AC-IC-2 control's verdict: did
 *     the fixture actually produce the declared loud failure? Also excludes
 *     (never counts as `undetected`) a native-module load race or a
 *     startup-phase lock refusal from a layer other than the report write.
 *
 * Invariants:
 *   - `extra.issue_report` is deliberately NOT a Zod-validated field on the
 *     shared `taskExtraSchema` (SPEC-072 §11 Downstream Handoff, "P5
 *     admission rule": no typed-schema field until a pure function reads
 *     it) — it stays untyped `extra` passthrough, read defensively by every
 *     consumer (mirrors `task-workflow.ts::safeTaskExtra`'s guard shape)
 *     rather than via a schema parse, so a malformed/legacy `extra` value
 *     degrades to "no signal" instead of throwing.
 *
 * Side-effect class: pure.
 *
 * Source: SPEC-072 §4 Public Interface, §5 check sequence (step 5).
 */

/**
 * The 7 required fields persisted verbatim under a filed report's
 * `extra.issue_report` (SPEC-072 AC-072-1: "all 7 extra.issue_report fields
 * populated"), plus the two OPTIONAL ordering-only triage labels §M6 adds.
 *
 * ⛔ `severity`/`category` are absent when the filer declared none — never
 * defaulted. A fabricated `severity: "medium"` would assert a judgment nobody
 * made, and would make "was this triaged?" unanswerable from the record.
 */
export interface IssueReportPayload {
  reporter_project: string;
  reporter_actor: string;
  lore_version: string;
  repro_command?: string;
  expected: string;
  actual: string;
  reported_at: string;
  possible_duplicates: string[];
  /** §M6 ORDERING-ONLY severity, as declared by the FILER. ⛔ Never read by any admission decision. */
  severity?: IssueSeverity;
  /** §M6 ORDERING-ONLY free-text category, as declared by the FILER. ⛔ Never read by any admission decision. */
  category?: string;
}

/**
 * The ORDERING-ONLY severity vocabulary (§M6), highest first — the order the
 * `--severity` help text renders in and the order a reader triaging a queue
 * scans in.
 *
 * ⛔ A CLOSED vocabulary, deliberately: an open string would make the column
 * unsortable and a typo indistinguishable from a new level. ⛔ And ORDERING ONLY
 * — severity is self-declared by the party the cap constrains, so letting it
 * bucket, exempt, or evict quota would put the ceiling under that party's
 * control (the same reason §M2 sites the ceiling on the upstream side).
 * `IssueReportService`'s step-6 narrowing takes no severity argument, so this is
 * true by construction rather than by discipline; AC-DC-7 pins it observably (a
 * quota filled entirely with `critical` still refuses a further `critical`).
 */
export const ISSUE_SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** One member of {@link ISSUE_SEVERITIES}. */
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/**
 * Is `value` a declared severity? Total over any string — an unrecognised value
 * is REFUSED by the caller (a usage error naming the valid set), ⛔ never
 * coerced to a neighbouring level.
 *
 * @param value - a raw `--severity` argument
 * @returns `true` iff `value` is a member of {@link ISSUE_SEVERITIES}
 * @example
 *   isIssueSeverity("critical")     // => true
 *   isIssueSeverity("catastrophic") // => false
 */
export function isIssueSeverity(value: string): value is IssueSeverity {
  return (ISSUE_SEVERITIES as readonly string[]).includes(value);
}

/**
 * Upper bound on a `--category` value's length. A category is free text (the
 * filing project's own taxonomy — this repo cannot enumerate a consumer's) but
 * still a COLUMN, so it is bounded rather than unbounded: an unbounded value
 * would render a table no reader can scan and would let one filer's prose
 * destroy the shared surface.
 */
export const ISSUE_CATEGORY_MAX_LENGTH = 48;

/** The two ORDERING-ONLY triage labels as read back off a stored `extra`. Either may be absent (NOT DECLARED). */
export interface IssueTriageLabels {
  readonly severity?: IssueSeverity;
  readonly category?: string;
}

/**
 * The ONE defensive reader for `extra.issue_report.{severity,category}` — the
 * same null/array/typeof guard shape every other defensive reader in this
 * module uses (a malformed/legacy `extra` degrades to "no labels" rather than
 * throwing, since `extra.issue_report` stays untyped passthrough per this
 * module's own invariant).
 *
 * Consumed by BOTH read surfaces (`commands/issues.ts` via the upstream port, and
 * `IssueReportService.list` via `UpstreamPort.getResolution`) so neither surface
 * can render a label the other cannot see — the same "one reader, two surfaces"
 * shape §M4 exists to establish for the corpus itself.
 *
 * ⛔ An unrecognised stored `severity` reads as ABSENT, never as a coerced level:
 * a hand-edited or future-version value must not be silently relabelled into
 * today's vocabulary.
 *
 * @param extra - a task's raw `extra` field (untyped storage)
 * @returns the declared labels; `{}` when neither is present or well-shaped
 * @example
 *   readIssueTriageLabels({issue_report: {severity: "high", category: "docs"}})
 *   // => {severity: "high", category: "docs"}
 *   readIssueTriageLabels({issue_report: {severity: "catastrophic"}}) // => {}
 *   readIssueTriageLabels(null)                                      // => {}
 */
export function readIssueTriageLabels(extra: unknown): IssueTriageLabels {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return {};
  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  if (issueReport === null || typeof issueReport !== "object" || Array.isArray(issueReport)) return {};
  const bag = issueReport as Record<string, unknown>;
  const rawSeverity = bag["severity"];
  const rawCategory = bag["category"];
  return {
    ...(typeof rawSeverity === "string" && isIssueSeverity(rawSeverity) ? { severity: rawSeverity } : {}),
    ...(typeof rawCategory === "string" && rawCategory.length > 0 ? { category: rawCategory } : {}),
  };
}

/**
 * The §M4 DECLARED render contract's fixed prefix. A FIXED PREFIX AT A FIXED
 * POSITION is declared (rather than "the output mentions the corpus somewhere")
 * so an oracle can anchor on position instead of on incidental substring
 * presence anywhere in the buffer.
 *
 * ⛔ The trailing space is part of the contract — `Corpus:/path` is not it.
 */
export const ISSUE_CORPUS_LINE_PREFIX = "Corpus: ";

/**
 * Composes the FIRST line every issue read surface's human output emits.
 *
 * ONE composition site so `lore issues` and `lore report-issue --list` cannot
 * drift into two spellings of the same fact — the identical reason §M1's cap
 * refusal renders from its structured payload rather than from prose.
 *
 * @param corpusPath - the ABSOLUTE path of the corpus that was actually read
 * @returns the header line, WITHOUT a trailing newline (each caller's own
 *   `console.log` adds one)
 * @example
 *   formatIssueCorpusLine("/opt/lore") // => "Corpus: /opt/lore"
 */
export function formatIssueCorpusLine(corpusPath: string): string {
  return `${ISSUE_CORPUS_LINE_PREFIX}${corpusPath}`;
}

/**
 * WHICH corpus an issue read surface read, and why (§M4).
 *
 * `why` exists so the JSON payload can distinguish "I read cwd because you asked
 * for `--local`" from "I read cwd because no upstream is configured" — two facts
 * a bare `kind: "local"` renders identically, and the second is exactly the state
 * a caller needs to know about (it is why the measured defect read as an empty
 * queue).
 */
export type IssueReadSource =
  | { readonly kind: "local"; readonly corpus_path: string; readonly why: "forced-local" | "no-upstream-configured" }
  | { readonly kind: "upstream"; readonly corpus_path: string; readonly why: "upstream-configured" };

/**
 * The ONE decision function for which corpus an issue read surface reads (§M4).
 *
 * ⛔ Takes an ALREADY-RESOLVED upstream config rather than a `LoreConfig`, so
 * `report-issue-wiring.ts::resolveFeedbackUpstreamCfg` stays the only
 * `feedback.upstream` READ site (that module's own plan invariant) and this pure
 * function does not become a second one.
 *
 * @param input.localCorpusRoot - the CALLING corpus's own root, ABSOLUTE
 * @param input.upstreamCorpusPath - the configured upstream corpus path, ABSOLUTE,
 *   or `undefined` when `feedback.upstream` is unconfigured. Absolutization is the
 *   caller's job: this module is browser-safe and cannot import `node:path`.
 * @param input.forceLocal - whether `--local` was passed
 * @returns the resolved source. ⛔ Total — there is no failure mode and no
 *   fallback: an upstream that is configured but unopenable is the READER's
 *   loud failure, never a silent downgrade to cwd (which would print a clean
 *   empty listing, the measured defect's exact shape).
 * @example
 *   resolveIssueReadSource({localCorpusRoot: "/c", upstreamCorpusPath: "/u", forceLocal: false})
 *   // => {kind: "upstream", corpus_path: "/u", why: "upstream-configured"}
 *   resolveIssueReadSource({localCorpusRoot: "/c", upstreamCorpusPath: "/u", forceLocal: true})
 *   // => {kind: "local", corpus_path: "/c", why: "forced-local"}
 *   resolveIssueReadSource({localCorpusRoot: "/c", upstreamCorpusPath: undefined, forceLocal: false})
 *   // => {kind: "local", corpus_path: "/c", why: "no-upstream-configured"}
 */
export function resolveIssueReadSource(input: {
  readonly localCorpusRoot: string;
  readonly upstreamCorpusPath: string | undefined;
  readonly forceLocal: boolean;
}): IssueReadSource {
  if (input.forceLocal) {
    return { kind: "local", corpus_path: input.localCorpusRoot, why: "forced-local" };
  }
  if (input.upstreamCorpusPath === undefined) {
    return { kind: "local", corpus_path: input.localCorpusRoot, why: "no-upstream-configured" };
  }
  return { kind: "upstream", corpus_path: input.upstreamCorpusPath, why: "upstream-configured" };
}

/**
 * R-5a identity-pin check: does the upstream corpus's actual root PRD match
 * the consumer's configured `feedback.upstream.root_prd`? `expected` may name
 * either the root PRD's `slug` OR its `id` (SPEC-072 §Downstream Handoff:
 * "expected root-PRD slug or id") — either one matching is sufficient.
 *
 * @param root - the upstream corpus's resolved root PRD `{id, slug}`, or
 *   `null` when the upstream corpus has no root doc at all (empty/malformed
 *   corpus — treated as a mismatch, never a crash)
 * @param expected - `feedback.upstream.root_prd` from the consumer's config
 * @returns `{ok: true}` on match; `{ok: false, found}` on mismatch, where
 *   `found` is the upstream root's slug (human-readable identity for the
 *   error message) or `null` when there was no upstream root at all
 * @example
 *   matchRootPrd({id: "01ABC", slug: "prd-lore"}, "prd-lore") // => {ok: true}
 *   matchRootPrd({id: "01ABC", slug: "prd-lore"}, "01ABC")    // => {ok: true}
 *   matchRootPrd({id: "01ABC", slug: "prd-lore"}, "prd-other")
 *     // => {ok: false, found: "prd-lore"}
 *   matchRootPrd(null, "prd-lore") // => {ok: false, found: null}
 */
export function matchRootPrd(
  root: { id: string; slug: string } | null,
  expected: string,
): { ok: true } | { ok: false; found: string | null } {
  if (root === null) {
    return { ok: false, found: null };
  }
  if (root.id === expected || root.slug === expected) {
    return { ok: true };
  }
  return { ok: false, found: root.slug };
}

/**
 * Assembles the `extra` payload for the upstream ad-hoc draft task
 * `UpstreamPort.createDraft` writes. Pure structural wrap — every field of
 * `p` is carried verbatim; no defaulting, no derived fields.
 *
 * ⛔ `ac_scope: []` is written EXPLICITLY here, and that is a policy decision
 * rather than a formality (task-the-ac-scope-re-keying-left-the-red-first-floor-
 * unarmed, face 2). This is a SECOND writer of `extra.adhoc: true`: the CLI's
 * `--adhoc` branch REQUIRES an `--ac-scope` declaration
 * (`isAdhocAcScopeDeclarationMissing`, `adapters/cli/create-task-validation.ts`),
 * but that requiredness is keyed on the author's FLAG, which only the CLI sees —
 * so this write site reached the same field by another route and inbound consumer
 * bug reports used to land with the key ABSENT. That is the identical shape as
 * the defect the re-keying closed (a requiredness keyed on one writer's surface
 * while a second writer reaches the field another way — the third such pair in
 * this corpus, after the `isPlanMember` copies and the two claim writers'
 * `session_id`), so it is closed HERE, at the shared write site, rather than left
 * as a policy made by omission.
 *
 * ⛔ EMPTY, never derived. A reporting project structurally cannot know the
 * upstream's AC ids, and guessing which spec governs a task is exactly what
 * `VerifyRunnerService.verifyAdhocTask` refuses to do (zero or multiple matches
 * refuse loud, never guessed). An empty declaration does not make the report
 * verifiable — it makes the claim AUDITABLE, which is the achievable goal and
 * the same standard `lore create task --adhoc --ac-scope ""` now holds a human
 * author to. Consequence, deliberately accepted: the declared key ARMS `lore
 * done`'s no-new-tests floor for a filed report, so an upstream maintainer
 * closing one must record a red evidence row or the audited
 * `--declare-no-new-tests "<reason>"` — which is the correct standard for a bug
 * fix, and reachable either way.
 *
 * §M6: `p.severity`/`p.category` ride along inside the `{...p}` spread. Because
 * they are OPTIONAL on {@link IssueReportPayload} and the caller omits the KEY
 * (rather than passing `undefined`), an undeclared label is ABSENT from the
 * persisted `extra` — which is what lets {@link readIssueTriageLabels} report NOT
 * DECLARED instead of a fabricated default on both read surfaces.
 *
 * @param p - the fully-assembled report payload
 * @returns `{adhoc: true, ac_scope: [], issue_report: {...p}}` — `adhoc: true`
 *   marks the task as SPEC-069's ad-hoc dispatch shape (excluded from `lore
 *   ready --adhoc` output until approved, per AC-072-1); `ac_scope: []` is the
 *   explicit no-criterion-claimed declaration described above
 * @example
 *   buildIssueReportExtra({
 *     reporter_project: "consumer-a", reporter_actor: "agent:x",
 *     lore_version: "0.5.0", expected: "exit 0", actual: "exit 4",
 *     reported_at: "2026-07-24T00:00:00.000Z", possible_duplicates: [],
 *   })
 *   // => {adhoc: true, ac_scope: [], issue_report: {reporter_project: "consumer-a", ...}}
 */
export function buildIssueReportExtra(p: IssueReportPayload): Record<string, unknown> {
  return {
    adhoc: true,
    ac_scope: [],
    issue_report: { ...p },
  };
}

// ─── Concurrency contract (spec-report-issue-has-no-specified-concurrency-contract-ac-072) ───
//
// Everything below is PURE (no IO, no clock, no randomness) and is the SSOT
// for the contract's three literals — the exit code, the `unknown-source`
// token, and the stderr template — plus the two classifiers that read them.
// The enforcement path (`service/issue-report-service.ts` →
// `adapters/cli/utils.ts`) and the 50-run e2e harness both consume THESE
// functions; neither re-states the rule (D6).
//
// ⛔ D3: this file is one of the three enforcement paths `bun run
// check:no-timer-retry` greps for the spec's banned timer/retry identifiers (it
// reads the exact list from D3 itself, so this comment deliberately does not
// restate them — writing one out here trips the check, as it did once already).
// The mechanism is a DECLARED BOUNDED WAIT at the store edge (SQLite's
// `busy_timeout`, declared via `feedback.upstream.write_wait_ms`), never a
// timer-driven retry in this path.

/**
 * The DECLARED CLI exit code for a report-issue write refused by corpus write
 * contention (§Contract Details "Declared exit code: 5").
 *
 * 5 is this codebase's pre-existing write-contention family — `STALE_VERSION`
 * and `CLAIM_CONFLICT` already map to it in `adapters/cli/utils.ts::exitCode`
 * under the recorded reason "someone else won the race, re-read and retry".
 * A contended `report-issue` is that same class, so it JOINS the existing
 * code rather than minting a new one. (The pre-contract behaviour was exit 1,
 * via the generic `STORE_ERROR` mapping.)
 */
export const WRITE_CONTENTION_EXIT_CODE = 5;

/**
 * The literal the `Contending source:` field carries when the contending
 * writer cannot be resolved (D5). SQLite exposes no lock-holder identity, so
 * this is what the CLI prints today; the field exists — and this literal is
 * REQUIRED rather than an omitted line — because without it "name the
 * contender when available" is unfalsifiable: any nameless message could be
 * defended as "not available".
 */
export const UNKNOWN_CONTENDING_SOURCE = "unknown-source";

/** The declared template's three parts, matched INDEPENDENTLY (see {@link matchesWriteContentionTemplate}). */
const WRITE_CONTENTION_HEADLINE_PATTERN =
  /could not write to (\S[^\n]*?): another writer held it longer than the declared (\d+)ms bound\./;
const CONTENDING_SOURCE_LINE_PATTERN = /^Contending source: (\S[^\n]*)$/m;
const RETRY_LINE_PATTERN = /^Retry: (\S[^\n]*)$/m;

/**
 * SQLite write-contention markers. `code === "SQLITE_BUSY"` is what bun:sqlite
 * sets on the thrown `SQLiteError`; the message markers cover a wrapped or
 * re-thrown error that kept only its text (which is exactly what
 * `store-shared.ts::toStoreError` produces: `{code: "STORE_ERROR", message}`).
 */
const SQLITE_BUSY_CODE = "SQLITE_BUSY";
const LOCKED_DATABASE_MESSAGE_PATTERN = /database (?:is|table is) locked|SQLITE_BUSY/i;

/**
 * The compiled-binary native-module load race — two concurrent `dist/lore`
 * processes dlopen'ing the same embedded `.node` file. Two INDEPENDENT tokens
 * on purpose (a single remembered contiguous phrase silently degrades to
 * no-match, and "no match" is indistinguishable from "clean"): the `dlopen(`
 * call and the `.node` module extension.
 */
const DLOPEN_TOKEN_PATTERN = /dlopen\(/;
const NATIVE_MODULE_TOKEN_PATTERN = /\.node\b/;

/**
 * POSITIVE evidence that a failure came from the CLI's own app-construction
 * (startup) path rather than from the report write: `loader.ts` appends
 * SPEC-073's report-issue hint to every `"internal"`-classified `loadLoreApp()`
 * failure, and `commands/report-issue.ts`'s own error path never does.
 *
 * MEASURED, not assumed: with 50 natural pairs, 1 run failed at exit 1 with
 * `Error: Storage failure: database is locked` PLUS this hint — the per-command
 * STARTUP corpus write (`app.ts`'s unconditional `SessionStore` construction)
 * losing a race on the CONSUMER corpus, which §Contract Details names as a
 * contention source that does NOT belong to this contract.
 *
 * Two INDEPENDENT tokens (never one remembered phrase) present in BOTH hint
 * variants — the configured and the unconfigured wording. If either token ever
 * changes, such a run stops being excused and reads as NON-conforming: loud,
 * which is the safe direction for a marker to fail in.
 */
const CLI_INTERNAL_ERROR_HINT_TOKEN_PATTERNS = [/<short-title>/, /re-checking/];

/**
 * Bun/Node stack frames — the throw was UNCAUGHT, so it is not one of this
 * codebase's formatted `Result` errors.
 *
 * ⛔ That is ALL this pattern establishes. It does NOT establish which layer
 * threw: "not a formatted `Result` error" does not imply "not in the governed
 * path". Treating the two as equivalent is exactly the false-GREEN vector
 * task-the-concurrency-exclusion-classifier-excuses-governed-path closed —
 * measured, 92 of ~300 AC-IC-1 attempts were EXCLUDED while carrying an
 * uncaught `database is locked` thrown from `openValidatedUpstream`/`report`,
 * so the harness could report green over a ~31% blind spot. The layer question
 * is answered separately, by {@link GOVERNED_PATH_FRAME_TOKEN_PATTERNS}.
 */
const UNCAUGHT_STACK_FRAME_PATTERN = /\n\s+at\s/;

/**
 * POSITIVE evidence that an uncaught throw came from the write this contract
 * GOVERNS, and therefore must never be excused: the contract says the loser
 * refuses with the declared code plus template, so a raw throw out of this path
 * is a violation, not a measurement of something else.
 *
 * Three INDEPENDENT lone-token conditions, never one remembered contiguous
 * phrase (root CLAUDE.md "contiguous-substring assumption"). Each frame is its
 * own regex so retiring or renaming one cannot silently disarm the other two.
 *
 * These names are matched anywhere in the buffer rather than anchored to a
 * parsed `at <name> (…)` frame position ON PURPOSE. Anchoring would couple the
 * matcher to Bun's stack-rendering grammar, and a grammar change would degrade
 * it to no-match — which on THIS branch means "excused", i.e. it would fail
 * back toward false GREEN. An over-broad match instead yields `non_conforming`:
 * loud, diagnosable from the verdict's `detail`, and the safe direction.
 *
 * SURVIVES MINIFICATION, structurally rather than by luck: `scripts/build.ts`
 * sets `minify: true`, which mangles function/class DECLARATION identifiers but
 * never property keys. All three names are methods — `report` and
 * `openValidatedUpstream` on `IssueReportService`, `createDraft` on the
 * `UpstreamPort` object — which is why the measured COMPILED-binary trace reads
 * `… → new Kr → Wy → openValidatedUpstream → report`: the store class and
 * `openUpstream` were mangled, the methods were not.
 */
const GOVERNED_PATH_FRAME_TOKEN_PATTERNS = [
  /\bopenValidatedUpstream\b/,
  /\bcreateDraft\b/,
  /\breport\b/,
];

/** The facts the declared stderr template interpolates. All caller-supplied — this module reads no ambient state. */
export interface WriteContentionFacts {
  /** The refusing operation, rendered verbatim as the message's subject (e.g. `"report-issue"`). */
  readonly operation: string;
  /** The corpus the write could not acquire — an absolute path, named so the reader knows WHICH corpus. */
  readonly corpusPath: string;
  /** The declared wait bound (ms) that expired — surfaced VERBATIM per D4, never rounded or re-derived. */
  readonly boundMs: number;
  /** Contending session / PID / host, or {@link UNKNOWN_CONTENDING_SOURCE} when unresolvable. */
  readonly source: string;
  /** The exact command line to re-run. */
  readonly retryCommand: string;
}

/**
 * Renders the DECLARED write-contention stderr template — the ONE place its
 * wording exists (§Contract Details "Declared stderr template"). Three lines,
 * three required parts: what could not be written and against which declared
 * bound, WHO contended (or the `unknown-source` literal), and HOW to retry.
 *
 * @param facts - see {@link WriteContentionFacts}; every value is interpolated
 *   verbatim, nothing is defaulted here (a missing fact is the caller's
 *   fail-loud concern, not silently papered over with a placeholder)
 * @returns the 3-line message WITHOUT a trailing newline (the CLI's stderr
 *   writer appends one, matching every other `formatError` case)
 * @example
 *   formatWriteContentionStderr({
 *     operation: "report-issue", corpusPath: "/repo/.lore/lore.db", boundMs: 2000,
 *     source: UNKNOWN_CONTENDING_SOURCE, retryCommand: "lore report-issue --title x …",
 *   })
 *   // Error: report-issue could not write to /repo/.lore/lore.db: another writer held it longer than the declared 2000ms bound.
 *   // Contending source: unknown-source
 *   // Retry: lore report-issue --title x …
 */
export function formatWriteContentionStderr(facts: WriteContentionFacts): string {
  return [
    `Error: ${facts.operation} could not write to ${facts.corpusPath}: ` +
      `another writer held it longer than the declared ${facts.boundMs}ms bound.`,
    `Contending source: ${facts.source}`,
    `Retry: ${facts.retryCommand}`,
  ].join("\n");
}

/**
 * Does `stderr` carry the declared template? Checked as THREE INDEPENDENT
 * conditions (headline + source line + retry line), never as one contiguous
 * substring — a matcher built from a remembered phrase degrades silently to
 * no-match, and AC-IC-4 must be able to fail for a missing part rather than
 * for a reworded sentence (root CLAUDE.md "contiguous-substring assumption").
 *
 * @param stderr - a process's full stderr buffer (extra surrounding lines are
 *   tolerated: each part is matched per-line, not against the whole buffer)
 * @returns `true` only when all three parts are present AND both the source
 *   and retry fields are non-empty (a blank `Contending source:` names nothing
 *   and is never conforming, D5)
 * @example
 *   matchesWriteContentionTemplate("Error: Storage failure: database is locked") // false
 */
export function matchesWriteContentionTemplate(stderr: string): boolean {
  return (
    WRITE_CONTENTION_HEADLINE_PATTERN.test(stderr) &&
    CONTENDING_SOURCE_LINE_PATTERN.test(stderr) &&
    RETRY_LINE_PATTERN.test(stderr)
  );
}

/**
 * Is this store failure SQLite WRITE CONTENTION (the `BEGIN IMMEDIATE`
 * refusal at `PRAGMA busy_timeout` expiry) rather than validation or any
 * other store error? §Contract Details settles the question the spec's
 * Options Considered left open: the refusal is CONTENTION, surfaced as
 * `SQLiteError { code: "SQLITE_BUSY", errno: 5, message: "database is locked" }`.
 *
 * @param failure - the observable fields of a caught driver error (or of a
 *   `STORE_ERROR` plus its `cause`). `errno` is accepted for shape
 *   completeness but DELIBERATELY NOT consulted: POSIX `EIO` is also 5, so an
 *   errno-only rule would misclassify a disk error as contention — the code
 *   and the message are the two non-ambiguous signals.
 * @returns `true` when the driver code is `SQLITE_BUSY` or the message carries
 *   a locked-database marker; `false` for every other store failure
 * @example
 *   isWriteContentionFailure({ code: "SQLITE_BUSY", message: "database is locked" }) // true
 *   isWriteContentionFailure({ code: "SQLITE_ERROR", message: "no such table: docs" }) // false
 */
export function isWriteContentionFailure(failure: {
  readonly message?: string;
  readonly code?: string;
  readonly errno?: number;
}): boolean {
  if (failure.code === SQLITE_BUSY_CODE) return true;
  return typeof failure.message === "string" && LOCKED_DATABASE_MESSAGE_PATTERN.test(failure.message);
}

/** One invocation's OBSERVABLE outcome — the only two facts the contract is written in terms of. */
export interface InvocationOutcome {
  readonly exitCode: number;
  readonly stderr: string;
}

/**
 * The D2 verdict for a pair of concurrent invocations.
 *
 * `not_attributable` is neither pass nor fail: the run did not measure two
 * competing corpus writers at all (§Contract Details "Two contention sources
 * the T2 harness must account for" — a harness that attributes either one to
 * the report-write contract "is measuring the wrong thing"). A harness MUST
 * exclude-and-report these rather than counting them, and must keep its own
 * cap on how many it tolerates.
 */
export type ConcurrencyVerdict =
  | { readonly outcome: "conforming"; readonly shape: "both_succeeded" | "one_refused_loudly" }
  | {
      readonly outcome: "not_attributable";
      readonly reason: "native_module_load_race" | "contention_outside_report_write";
      readonly detail: string;
    }
  | { readonly outcome: "non_conforming"; readonly detail: string };

/** Is this outcome the DECLARED loud failure — the declared exit code AND the declared template? */
function isDeclaredLoudFailure(outcome: InvocationOutcome): boolean {
  return outcome.exitCode === WRITE_CONTENTION_EXIT_CODE && matchesWriteContentionTemplate(outcome.stderr);
}

/** First line of `stderr` matching `pattern`, trimmed — the diagnostic quoted back in a verdict's `detail`. */
function firstMatchingLine(stderr: string, pattern: RegExp): string {
  return stderr.split("\n").find((line) => pattern.test(line))?.trim() ?? "";
}

/** Did this invocation die in the compiled binary's native-module load race (both tokens present)? */
function hasNativeModuleLoadRace(outcome: InvocationOutcome): boolean {
  return DLOPEN_TOKEN_PATTERN.test(outcome.stderr) && NATIVE_MODULE_TOKEN_PATTERN.test(outcome.stderr);
}

/**
 * Did this invocation fail on a locked database from a layer OTHER than the
 * report write? Every `lore` command writes its own corpus at startup
 * (`app.ts`'s unconditional `SessionStore` construction), so two concurrent
 * invocations contend at STARTUP as well, on the CONSUMER corpus — §Contract
 * Details is explicit that attributing such a refusal to the report-write
 * contract "is measuring the wrong thing".
 *
 * Requires POSITIVE evidence of that other layer — the CLI startup path's own
 * hint, or an uncaught stack trace naming NO governed frame — rather than
 * merely "a lock message that isn't the template". That asymmetry is
 * deliberate: a bare `Error: Storage failure: database is locked` with NEITHER
 * marker is exactly what a contended REPORT WRITE printed before this contract
 * existed, so it must stay NON-conforming instead of being excused (which would
 * let a removal of the enforcement pass as not-attributable).
 *
 * The stack-trace arm is DENYLISTED by
 * {@link GOVERNED_PATH_FRAME_TOKEN_PATTERNS} rather than allowlisted over
 * startup-layer frames, and that choice is forced by the build: every
 * startup-layer name (`SessionStore`, `buildAppFromSqlite`, `loadLoreApp`) is a
 * function/class declaration and is therefore MANGLED by `minify: true`, so an
 * allowlist could never match a compiled-binary startup crash — it would
 * collapse this branch into excusing nothing, which is deleting it. The
 * governed names survive minification (they are methods), so the denylist is
 * the only form with real matching power on the artifact the harness spawns.
 */
function hasContentionOutsideReportWrite(outcome: InvocationOutcome): boolean {
  if (outcome.exitCode === 0) return false;
  if (matchesWriteContentionTemplate(outcome.stderr)) return false;
  if (!LOCKED_DATABASE_MESSAGE_PATTERN.test(outcome.stderr)) return false;
  const hasStartupHint = CLI_INTERNAL_ERROR_HINT_TOKEN_PATTERNS.every((pattern) =>
    pattern.test(outcome.stderr),
  );
  if (hasStartupHint) return true;
  return (
    UNCAUGHT_STACK_FRAME_PATTERN.test(outcome.stderr) && !hasGovernedPathFrame(outcome.stderr)
  );
}

/**
 * Does this stderr name a frame from the write path this contract governs?
 *
 * @param stderr - a failed invocation's full stderr buffer
 * @returns `true` when ANY governed frame token appears — the conditions are
 *   independent, so one surviving token is enough to refuse the excuse
 * @example
 *   hasGovernedPathFrame("…\n      at report (/$bunfs/root/index.js:1088:11655)\n") // true
 */
function hasGovernedPathFrame(stderr: string): boolean {
  return GOVERNED_PATH_FRAME_TOKEN_PATTERNS.some((pattern) => pattern.test(stderr));
}

/**
 * Classifies ONE run of the two-concurrent-invocation scenario against the D2
 * observable invariant (AC-IC-1's oracle): the outcome is EITHER both
 * succeeded, OR exactly one succeeded while the other failed with the
 * declared code and the declared template. Anything else — including two
 * non-zero exits, or a declared-code exit whose stderr does not match the
 * template — is non-conforming.
 *
 * Evaluation order is significant and deliberate:
 *   1. a native-module load race in EITHER invocation excludes the run (the
 *      pair never became two competing writers);
 *   2. both exit 0 → conforming;
 *   3. exactly one exit 0 + the other a declared loud failure → conforming;
 *   4. a locked-database failure from another layer excludes the run;
 *   5. everything else is non-conforming, with the exit codes quoted back.
 *
 * @param first - one invocation's outcome
 * @param second - the other invocation's outcome (the verdict is symmetric in
 *   the two arguments — the contract never names a designated winner)
 * @returns the verdict; `detail` on the failing/excluded branches always
 *   carries enough text to diagnose the run without re-running it
 * @example
 *   classifyConcurrencyOutcome({exitCode: 0, stderr: ""}, {exitCode: 0, stderr: ""})
 *   // { outcome: "conforming", shape: "both_succeeded" }
 */
export function classifyConcurrencyOutcome(
  first: InvocationOutcome,
  second: InvocationOutcome,
): ConcurrencyVerdict {
  for (const outcome of [first, second]) {
    if (hasNativeModuleLoadRace(outcome)) {
      return {
        outcome: "not_attributable",
        reason: "native_module_load_race",
        detail: `compiled-binary native module load race: ${firstMatchingLine(outcome.stderr, DLOPEN_TOKEN_PATTERN)}`,
      };
    }
  }

  if (first.exitCode === 0 && second.exitCode === 0) {
    return { outcome: "conforming", shape: "both_succeeded" };
  }

  const succeeded = [first, second].filter((outcome) => outcome.exitCode === 0);
  const failed = [first, second].filter((outcome) => outcome.exitCode !== 0);
  if (succeeded.length === 1 && failed.length === 1 && isDeclaredLoudFailure(failed[0] as InvocationOutcome)) {
    return { outcome: "conforming", shape: "one_refused_loudly" };
  }

  for (const outcome of failed) {
    if (hasContentionOutsideReportWrite(outcome)) {
      return {
        outcome: "not_attributable",
        reason: "contention_outside_report_write",
        detail:
          "a locked-database refusal outside the report write (startup-phase corpus write): " +
          firstMatchingLine(outcome.stderr, LOCKED_DATABASE_MESSAGE_PATTERN),
      };
    }
  }

  return {
    outcome: "non_conforming",
    detail:
      `exit codes ${first.exitCode}/${second.exitCode} match neither declared state ` +
      `(both 0, or exactly one 0 and the other ${WRITE_CONTENTION_EXIT_CODE} with the declared template): ` +
      `first stderr: ${first.stderr.trim() || "(empty)"} | second stderr: ${second.stderr.trim() || "(empty)"}`,
  };
}

/**
 * The AC-IC-2 control's verdict. Its question is deliberately DIFFERENT from
 * {@link classifyConcurrencyOutcome}'s: with contention FORCED by an
 * externally-held open write transaction, the criterion is "did at least one
 * invocation produce the declared loud failure", and the first invocation's
 * status is explicitly unconstrained — the external lock blocks it too, so
 * pinning it would encode the fixture's mechanics rather than the contract.
 * A run in which BOTH invocations succeed FAILS the criterion: it shows the
 * fixture never created contention.
 *
 * Two `not_attributable` reasons — D7's forced-contention decision table
 * (§Contract Details, row 3 and row 4). A run that never measured two
 * competing report-writers is excluded regardless of which classifier reads
 * it, so both reasons mirror {@link ConcurrencyVerdict}'s:
 *   - `native_module_load_race` — the compiled-binary dlopen race.
 *   - `contention_outside_report_write` — the EXTERNAL holder blocks the
 *     per-command STARTUP write first (every `lore` invocation writes its own
 *     corpus at startup, §Contract Details), so a sibling invocation can die
 *     on a generic locked-database refusal before the report write this
 *     control targets is ever attempted. Counting that as `undetected` is a
 *     FALSE RED: the run never reached the contract, it just never got there.
 */
export type ForcedContentionVerdict =
  | { readonly outcome: "detected"; readonly refused: 1 | 2 }
  | { readonly outcome: "undetected"; readonly detail: string }
  | {
      readonly outcome: "not_attributable";
      readonly reason: "native_module_load_race" | "contention_outside_report_write";
      readonly detail: string;
    };

/**
 * Classifies ONE forced-contention control run.
 *
 * Evaluation order is significant and is D7's forced-contention table made
 * executable:
 *   1. a detected declared loud failure on EITHER invocation WINS over BOTH
 *      exclusion reasons — the criterion is satisfied by one declared
 *      refusal, and a crashed OR startup-blocked sibling cannot un-observe it
 *      (checked first, so this beats both of the checks below);
 *   2. a native-module load race in either invocation excludes the run (the
 *      pair never became two competing writers);
 *   3. a locked-database refusal from another layer — same predicate as
 *      {@link classifyConcurrencyOutcome}'s ({@link hasContentionOutsideReportWrite},
 *      reused rather than re-implemented, D6) — excludes the run: this is the
 *      row 4 fix, closing the false RED described on the type above;
 *   4. both exit 0 → undetected, the fixture created no contention;
 *   5. everything else → undetected, with both exit codes/stderrs quoted back.
 *
 * @param first - one invocation's outcome
 * @param second - the other invocation's outcome
 * @returns `detected` (with how many invocations refused), `undetected` (the
 *   criterion fails — `detail` says why, e.g. both succeeded), or
 *   `not_attributable` when the run only measured a non-report-write
 *   contention source (native-module load race, or a startup-phase lock
 *   refusal — see {@link ForcedContentionVerdict})
 * @example
 *   classifyForcedContentionOutcome({exitCode: 0, stderr: ""}, {exitCode: 0, stderr: ""})
 *   // { outcome: "undetected", detail: "both invocations succeeded — …" }
 */
export function classifyForcedContentionOutcome(
  first: InvocationOutcome,
  second: InvocationOutcome,
): ForcedContentionVerdict {
  const firstRefused = isDeclaredLoudFailure(first);
  const secondRefused = isDeclaredLoudFailure(second);
  if (firstRefused && secondRefused) return { outcome: "detected", refused: 2 };
  if (firstRefused || secondRefused) return { outcome: "detected", refused: 1 };

  for (const outcome of [first, second]) {
    if (hasNativeModuleLoadRace(outcome)) {
      return {
        outcome: "not_attributable",
        reason: "native_module_load_race",
        detail: `compiled-binary native module load race: ${firstMatchingLine(outcome.stderr, DLOPEN_TOKEN_PATTERN)}`,
      };
    }
  }

  for (const outcome of [first, second]) {
    if (hasContentionOutsideReportWrite(outcome)) {
      return {
        outcome: "not_attributable",
        reason: "contention_outside_report_write",
        detail:
          "a locked-database refusal outside the report write (startup-phase corpus write): " +
          firstMatchingLine(outcome.stderr, LOCKED_DATABASE_MESSAGE_PATTERN),
      };
    }
  }

  if (first.exitCode === 0 && second.exitCode === 0) {
    return {
      outcome: "undetected",
      detail:
        "both invocations succeeded while an open write transaction was held — " +
        "the fixture did not actually create contention",
    };
  }

  return {
    outcome: "undetected",
    detail:
      `neither invocation produced the declared loud failure (exit ${WRITE_CONTENTION_EXIT_CODE} + template): ` +
      `exit codes ${first.exitCode}/${second.exitCode}, ` +
      `first stderr: ${first.stderr.trim() || "(empty)"} | second stderr: ${second.stderr.trim() || "(empty)"}`,
  };
}
