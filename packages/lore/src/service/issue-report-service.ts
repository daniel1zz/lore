/**
 * IssueReportService — DI-only orchestrator behind `lore report-issue`
 * (SPEC-072). Runs the §5 fail-loud, cheapest-first check sequence over an
 * injected `IssueReportDeps` bundle: config presence → upstream's own
 * sync-mode constraint → schema-version match → upstream root-PRD identity
 * → per-reporter rate cap (narrowed by COMPUTED RESOLUTION — see the first
 * invariant below) → advisory duplicate search → `createDraft` → (only on
 * success) local receipt append.
 *
 * Public surface:
 *   - `IssueReportService` — `report(input, cfg?)` / `list(cfg)`.
 *   - `IssueReportInput` / `IssueReportResult` / `ReceiptStatusRow` /
 *     `IssueReportDeps` — the DTOs this service's constructor and methods
 *     are typed against (SPEC-072 §4).
 *   - `OpenReportCapRefusal` / `CapBlockingReport` / `ResolutionReadFailure` —
 *     the STRUCTURED cap-refusal payload and its parts
 *     (spec-the-defect-channel-cannot-be-honestly-maintained-an §M1).
 *
 * Invariants:
 *   - The step-6 cap counts COMPUTED RESOLUTION, never raw lifecycle status
 *     (§M1). `countOpenReports` supplies candidates; each candidate's
 *     `port.getResolution` result is checked against the shared
 *     `TERMINAL_ISSUE_RESOLUTIONS` SSOT, and only non-terminal candidates hold a
 *     slot. ⛔ A resolution READ FAILURE keeps its slot (fail closed) and is
 *     reported in both observable places — never treated as "resolved".
 *   - ZERO writes before `createDraft` (step 8) succeeds — every check
 *     before it is read-only or pure. `receipts.append` (step 9) runs
 *     STRICTLY AFTER `createDraft` resolves `ok`, never before, never in
 *     parallel.
 *   - Any `createDraft` failure (validation, store, or otherwise) is
 *     returned VERBATIM — this service does not wrap, rename, or
 *     re-interpret it (SPEC-072 R-5e failure-transparency, AC-072-7). ONE
 *     documented narrowing, applied at THREE sites that each open a
 *     connection against the same upstream file `createDraft` writes to
 *     (`deps.probe`, `deps.openUpstream`'s internal TOCTOU re-probe, and
 *     `createDraft` itself — task-fix-the-spec-072-cross-corpus-database-is-
 *     locked-race extended this from `createDraft` alone): a `STORE_ERROR`
 *     that IS SQLite write contention (`toWriteContentionError` below) is
 *     re-typed as `WRITE_CONTENTION` so the CLI can render the declared
 *     message and exit code
 *     (spec-report-issue-has-no-specified-concurrency-contract-ac-072).
 *     Nothing is swallowed: the same fact gets a truthful classification, and
 *     every other failure still propagates byte-identically.
 *   - `import type` ONLY from `../flows/*` — this file must stay reachable
 *     from vitest without ever touching `bun:sqlite` (AC-072-13's static
 *     import-graph pin; also enforced by this repo's `bun-only` composition
 *     convention — see `../flows/upstream-context-flow.ts`'s own header).
 *   - `deps.loadUpstreamConfig(root)` loads the UPSTREAM corpus's OWN
 *     config — distinct from `cfg`, which is the CONSUMER's
 *     `feedback.upstream.*` settings naming which upstream to talk to. Do not
 *     conflate the two: `cfg` says "where"; the loaded config says what THAT
 *     PLACE's own policy is. Two things are read from it, both the upstream's
 *     to decide: its `sync.enabled` flag (is that place even a supported v1
 *     target, step 3) and its `feedback.inbound.open_report_cap` (how deep may
 *     one reporter's open queue get, step 6 — §M2). It is loaded EXACTLY ONCE
 *     per call, inside `openValidatedUpstream`, and returned alongside the port
 *     as a {@link ValidatedUpstream}; ⛔ never re-read at the cap site — a
 *     second read could observe a different file mid-call and would let the
 *     rails and the ceiling disagree about which upstream they are talking to.
 *   - The step-6 ceiling is the UPSTREAM's DECLARED policy, resolved through
 *     `@lore/core`'s single `resolveOpenReportCap` seam (§M2). ⛔ The compiled
 *     `OPEN_REPORT_CAP` constant is NOT imported here and must not be: it is
 *     that config field's Zod default, not the operative value.
 *   - `cfg` is OPTIONAL on `report()` — an unconfigured `feedback.upstream`
 *     is the single most common failure a first-time caller hits, so it is
 *     checked before any dependency is invoked at all (T2 deviation note,
 *     reconciled with SPEC-072 intent: the spec's own TS listing shows a
 *     required `cfg`, but the check-sequence table's step 1 is literally
 *     "`feedback.upstream` unset", which is only observable if the type
 *     permits the unset state to reach this method).
 *
 * Side-effect class: orchestration only — all actual IO (config load,
 * schema probe, upstream store access, receipt file IO) lives behind the
 * injected `IssueReportDeps` ports; this class itself performs none.
 *
 * Source: SPEC-072 §4 Public Interface, §5 check sequence, §Acceptance
 * Criteria AC-072-1 .. AC-072-13.
 */

import { join } from "node:path";
import {
  ok,
  err,
  buildIssueReportExtra,
  countOpenReports,
  isWriteContentionFailure,
  matchRootPrd,
  resolveOpenReportCap,
  UNKNOWN_CONTENDING_SOURCE,
  type DocStatus,
  type IssueReportPayload,
  type LoreConfig,
  type LoreError,
  type Result,
} from "@lore/core";
import {
  TERMINAL_ISSUE_RESOLUTIONS,
  TERMINAL_ISSUE_RESOLUTION_LIST,
  reachOfTerminalResolution,
} from "./issue-resolution.js";
import type { UpstreamPort } from "../flows/upstream-context-flow.js";
import type { ReceiptEntry, ReceiptLog } from "./receipt-log.js";
import type { IssueResolution, TerminalIssueResolution } from "./issue-resolution.js";

/** Input to `IssueReportService.report` — the fields a caller (CLI/MCP) supplies. */
export interface IssueReportInput {
  title: string;
  description: string;
  expected: string;
  actual: string;
  repro_command?: string;
  /**
   * Filing actor identity. Optional at THIS layer's type — the CLI wiring
   * always resolves one via `resolveActor` before calling `report()`, and
   * the MCP wiring REQUIRES it explicitly before calling `report()` at all
   * (SPEC-072 §11 Downstream Handoff) — so an absent `by` reaching this
   * service is a defensive-only case, handled by falling back to
   * `deps.reporterProject` (see `report()`), never by throwing.
   */
  by?: string;
}

/** Successful outcome of `IssueReportService.report`. */
export interface IssueReportResult {
  upstream_doc_id: string;
  possible_duplicates: string[];
  /** `true` iff the advisory FTS dedup search errored — filing proceeded anyway. */
  dedup_degraded: boolean;
  /**
   * Candidate reports whose COMPUTED resolution could not be read during the
   * step-6 cap narrowing (M1). Each such id was counted as STILL OPEN (fail
   * closed — a read error must never free quota), so this filing succeeded
   * DESPITE them, not because of them.
   *
   * ⛔ Always present (`[]` when every read succeeded): an omitted field and a
   * silent swallow are the same shape to a reader. Surfaced verbatim by
   * `lore report-issue --json` and the MCP tool, both of which serialize this
   * whole object; the HUMAN branch of `adapters/cli/commands/report-issue.ts`
   * prints only the doc id / duplicates / dedup-degradation lines and does NOT
   * name this field (that render is outside this mechanism's file anchors).
   */
  resolution_read_failures: ResolutionReadFailure[];
}

/** One candidate report whose resolution read failed, with the failure's own classification. */
export interface ResolutionReadFailure {
  readonly id: string;
  readonly error: string;
}

/**
 * One report still occupying open-report cap quota, as carried by the cap
 * refusal's STRUCTURED payload (spec-the-defect-channel-cannot-be-honestly-
 * maintained-an §M1, "Declared contract").
 *
 * `resolution: null` means the per-report resolution read FAILED — an explicit
 * NOT MEASURED. ⛔ Never a fabricated `"open"`: the refusal would then assert a
 * computed fact nobody computed. `unreadable_reason` is present exactly when
 * `resolution` is `null`.
 */
export interface CapBlockingReport {
  readonly id: string;
  readonly resolution: IssueResolution | null;
  readonly unreadable_reason?: string;
}

/**
 * The cap refusal's `LoreError.value` payload — the CONTRACT; the human stderr
 * message is a projection of it (see {@link formatOpenReportCapRefusalMessage}).
 *
 * `quota_freeing_states` is DERIVED from the shared terminal-resolution SSOT at
 * construction time, ⛔ never written as a literal list — that is what makes
 * AC-DC-2's set comparison an observable quantity rather than a free-text
 * extraction, and what stops the refusal from ever advertising a verb that does
 * not actually free a slot.
 */
export interface OpenReportCapRefusal {
  readonly blocking: readonly CapBlockingReport[];
  readonly quota_freeing_states: readonly string[];
}

/** One joined row of `IssueReportService.list`'s output. */
export interface ReceiptStatusRow {
  upstream_doc_id: string;
  title: string;
  at: string;
  /**
   * D6 (spec-issue-closure-loop-computed-resolution-agent-reachable) — the
   * DEFECT's computed resolution (`open | resolving | fixed | rejected |
   * wontfix`, `computeIssueResolution` from `service/issue-resolution.ts`),
   * or `"unreachable"` when the upstream corpus could not be validated/opened
   * at all, OR when this receipt's doc no longer exists upstream (SPEC-072
   * AC-072-10: history stays visible even when upstream is gone — preserved
   * byte-for-byte).
   */
  status: IssueResolution | "unreachable";
  /**
   * D6 — the upstream doc's RAW lifecycle status, demoted to a debugging
   * detail (no longer the primary signal `status` above now is — a `draft`
   * issue task whose fix already shipped as an `active`/`archived` doc
   * reports `status: "fixed"` here with `doc_status: "draft"`, never the
   * reverse). Absent exactly when `status === "unreachable"` (no doc to read
   * a status from).
   */
  doc_status?: DocStatus;
  /**
   * The reason recorded on an explicit `rejected`/`wontfix` terminal state
   * (`lore issue resolve --state rejected|wontfix --reason <r>`, D3) —
   * echoed here so the reporting agent learns WHY, not just that it isn't
   * open anymore.
   */
  rejection_reason?: string;
  /**
   * Non-blocking caveats about this row's data (e.g. a receipt line the
   * local `ReceiptLog` had to skip as corrupt, or a resolution this service
   * could only infer rather than confirm — see `list()`'s inline note on
   * `UpstreamPort`'s read surface).
   */
  warnings?: string[];
}

/**
 * Constructor dependency bundle — every actual IO operation `report()` /
 * `list()` need, injected so this service stays vitest-reachable with fully
 * faked ports (SPEC-072 §4).
 */
export interface IssueReportDeps {
  /**
   * Loads the UPSTREAM corpus's own `.lore/config.yaml` — the source of BOTH
   * upstream-declared facts this service reads: its `sync.enabled` flag (step 3)
   * and its `feedback.inbound.open_report_cap` ceiling (step 6, §M2). Called
   * exactly once per `report()`/`list()`; a malformed upstream config therefore
   * refuses the call LOUDLY at step 3, naming the offending key — it never
   * degrades to "no policy declared".
   */
  loadUpstreamConfig: (root: string) => Result<LoreConfig, LoreError>;
  /** Readonly `PRAGMA user_version` probe — see `../flows/upstream-probe.ts`. */
  probe: (dbPath: string) => Result<{ user_version: number }, LoreError>;
  /** This install's `LATEST_SCHEMA_VERSION` — compared against `probe`'s result. */
  expectedSchemaVersion: number;
  /**
   * Opens the narrow `UpstreamPort` — see `../flows/upstream-context-flow.ts`.
   * The wiring MUST open it with {@link IssueReportDeps.writeWaitMs} as the
   * connection's bound, so the number this service reports on expiry is the
   * number the connection actually applied (spec-report-issue-has-no-specified-
   * concurrency-contract-ac-072 D4).
   */
  openUpstream: (root: string) => Result<UpstreamPort, LoreError>;
  receipts: ReceiptLog;
  loreVersion: string;
  reporterProject: string;
  /**
   * The DECLARED bounded wait (ms) the upstream connection was opened with —
   * `feedback.upstream.write_wait_ms`, resolved ONCE by the wiring
   * (`@lore/core`'s `resolveUpstreamWriteWaitMs`). Surfaced VERBATIM in a
   * `WRITE_CONTENTION` refusal; never re-derived here.
   */
  writeWaitMs: number;
  /** Wall-clock read, injected for determinism (no `new Date()` inside this service). */
  now: () => string;
}

/** Consumer-side `feedback.upstream.*` config, as resolved by the caller. */
type UpstreamCfg = { corpus_path: string; root_prd: string };

/**
 * What a fully-validated upstream connection carries: the open port PLUS the
 * upstream's own loaded config.
 *
 * The config travels WITH the port deliberately (§M2). `openValidatedUpstream`
 * must load it anyway for step 3's sync-mode rail, and step 6's ceiling is a
 * second fact declared by that same file — returning it here is what makes
 * "loaded exactly once per call" true by construction instead of by convention.
 * ⛔ Do not replace this with a second `deps.loadUpstreamConfig` call at the cap
 * site: two reads can observe two different files mid-call, and the rails would
 * then be validating one upstream while the ceiling came from another.
 */
interface ValidatedUpstream {
  readonly port: UpstreamPort;
  /** The UPSTREAM corpus's OWN config — read `feedback.inbound.*` from here via `resolveOpenReportCap`, never from `cfg`. */
  readonly upstreamConfig: LoreConfig;
}

/**
 * Generic human-readable description of a `LoreError` — only 4 of the 16
 * variants carry a `message` field (`VALIDATION_ERROR`/`STORE_ERROR`/
 * `AI_PROVIDER_ERROR`/`NEEDS_APPROVAL`); every other variant is identified
 * by its `code` alone. Used ONLY for composing this service's own advisory
 * warning strings (never for the `err(...)` values this service returns —
 * those always propagate the original typed `LoreError` verbatim).
 */
function describeLoreError(error: LoreError): string {
  if ("message" in error) return error.message;
  return error.code;
}

/**
 * Like {@link describeLoreError} but leads with the CODE. Used only where the
 * string is a machine-facing CLASSIFICATION carried in a structured payload (the
 * cap refusal's `unreadable_reason`, `IssueReportResult.resolution_read_failures`)
 * rather than advisory prose — a consumer deciding what to do about an unreadable
 * candidate needs the code, and `describeLoreError` alone drops it for the four
 * variants that carry a `message`. ⛔ Kept separate rather than folded into
 * `describeLoreError`: that function's output is embedded mid-sentence in
 * existing user-facing warnings, where a code prefix would be noise.
 *
 * @param error - any `LoreError`
 * @returns `"<CODE>: <message>"`, or just `"<CODE>"` for the variants without one
 */
function describeLoreErrorWithCode(error: LoreError): string {
  if ("message" in error) return `${error.code}: ${error.message}`;
  return error.code;
}

/**
 * The VERB that actually reaches one quota-freeing resolution, derived from the
 * shared reach table — so the refusal cannot name a remedy that does not exist,
 * and a newly added terminal state cannot ship without one (the `never` branch
 * makes an unhandled route a compile error).
 *
 * This exists because the measured refusal (2026-08-11) advised "resolve or wait
 * for review" and NEITHER worked: `lore issue resolve` wrote a resolution the cap
 * never read, and the review workflow cannot move a report off `draft` at all.
 *
 * @param state - a terminal resolution
 * @returns a copy-pasteable command, or a description of the workflow that
 *   reaches states no single command can set
 */
function formatQuotaFreeingRemedy(state: TerminalIssueResolution): string {
  const reach = reachOfTerminalResolution(state);
  switch (reach.route) {
    case "issue-resolve": {
      const pointer = reach.pointer === null ? "" : ` ${reach.pointer.flag} <doc>`;
      return `lore issue resolve <id> --state ${state}${pointer} --reason "<why>"`;
    }
    case "resolves-link":
      return "lore link --type resolves <fixer-doc> <id> — computed, and only once the fixer doc reaches active/archived";
    case "review-archive":
      return "upstream-side archiving of the report itself (its own lifecycle, e.g. lore set <id> --status archived)";
    default: {
      const unreachable: never = reach.route;
      return unreachable;
    }
  }
}

/** One blocking line: the id ALONGSIDE its computed resolution — never two lists a reader must join by position. */
function formatBlockingReport(entry: CapBlockingReport): string {
  if (entry.resolution === null) {
    return `  ${entry.id} — resolution UNREADABLE (${entry.unreadable_reason ?? "unknown"}); counted as still open`;
  }
  return `  ${entry.id} — ${entry.resolution}`;
}

/**
 * Renders the cap refusal's human stderr message as a PROJECTION of
 * {@link OpenReportCapRefusal} — every id, every resolution and every named verb
 * comes from the payload, so the two can never disagree.
 *
 * @param reporterProject - the filing project the cap is scoped to
 * @param cap - the ceiling in force
 * @param refusal - the structured payload this message projects
 * @returns a multi-line message (no trailing newline; the CLI's `formatError`
 *   writer adds one)
 */
function formatOpenReportCapRefusalMessage(
  reporterProject: string,
  cap: number,
  refusal: OpenReportCapRefusal,
): string {
  return [
    `reporter project '${reporterProject}' already has ${refusal.blocking.length} open report(s) upstream (cap ${cap}).`,
    "A slot frees the moment a report's COMPUTED resolution becomes terminal. Its own doc status stays 'draft' " +
      "throughout (the corpus has no draft->archived edge), so nothing below frees a slot by waiting.",
    "Still blocking (id — computed resolution):",
    ...refusal.blocking.map(formatBlockingReport),
    "Quota-freeing resolutions, and the verb that reaches each:",
    ...TERMINAL_ISSUE_RESOLUTION_LIST.map((state) => `  ${state} — ${formatQuotaFreeingRemedy(state)}`),
  ].join("\n");
}

/**
 * Defensive read of a driver error's own `code` off a `STORE_ERROR`'s `cause`
 * (bun:sqlite sets `SQLiteError.code = "SQLITE_BUSY"` on write contention).
 * A missing/odd cause degrades to `undefined` — never throws — because the
 * message marker is an independent second signal (see `isWriteContentionFailure`).
 *
 * @param cause - the `cause` field of a `STORE_ERROR`, when present
 * @returns the driver's error code string, or `undefined`
 */
function readDriverErrorCode(cause: Error | undefined): string | undefined {
  if (cause === undefined) return undefined;
  const code = (cause as Error & { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Re-classifies an upstream failure that is corpus write CONTENTION (SQLite
 * refused `BEGIN IMMEDIATE`, OR a readonly reader's `PRAGMA` read collided
 * with someone else's `BEGIN IMMEDIATE`, at `PRAGMA busy_timeout` expiry —
 * `isWriteContentionFailure` recognizes both by the identical `SQLITE_BUSY`/
 * "database is locked" signal) into the typed `WRITE_CONTENTION` error the
 * CLI renders as the declared 3-part message and maps to the declared exit
 * code (spec-report-issue-has-no-specified-concurrency-contract-ac-072
 * §Contract Details).
 *
 * This is the ONE documented narrowing of this service's
 * "failures propagate VERBATIM" invariant, applied at every call site that
 * opens a connection against the same upstream file `createDraft` writes to
 * — `deps.probe`, `deps.openUpstream`'s internal TOCTOU re-probe, and
 * `createDraft` itself (task-fix-the-spec-072-cross-corpus-database-is-
 * locked-race: the probe sites used to propagate a bare `STORE_ERROR`
 * instead, because nothing ever ran this reclassification over them).
 * Nothing is swallowed or renamed away — a contended read or write is
 * RE-TYPED so its (otherwise identical) `STORE_ERROR` text stops reading as
 * "the store is broken, exit 1" when the actual fact is "someone else held
 * the corpus, re-run this". Every non-contention failure still propagates
 * byte-identically.
 *
 * @param error - the failure `UpstreamPort.createDraft`, `deps.probe`, or
 *   `deps.openUpstream` returned
 * @param upstreamDbPath - the contended corpus FILE (what a reader must know)
 * @param boundMs - the declared bound the connection applied, surfaced verbatim
 * @returns the typed contention error, or `undefined` when this failure is not
 *   contention (caller then propagates the original error unchanged)
 */
function toWriteContentionError(
  error: LoreError,
  upstreamDbPath: string,
  boundMs: number,
): LoreError | undefined {
  if (error.code !== "STORE_ERROR") return undefined;
  const driverCode = readDriverErrorCode(error.cause);
  const isContention = isWriteContentionFailure({
    message: error.message,
    ...(driverCode !== undefined ? { code: driverCode } : {}),
  });
  if (!isContention) return undefined;
  return {
    code: "WRITE_CONTENTION",
    operation: "report-issue",
    corpus_path: upstreamDbPath,
    bound_ms: boundMs,
    // reason: SQLite exposes no lock-holder identity, so the contender cannot be
    // named from here — D5 requires the `unknown-source` LITERAL rather than an
    // omitted field precisely so "unnamed" is falsifiable instead of defensible.
    source: UNKNOWN_CONTENDING_SOURCE,
  };
}

/**
 * THE single shared "`feedback.upstream` is unconfigured" remedy —
 * spec-governance-defaults-must-ship-and-every-recorded-gap-must D3's
 * one-condition-one-remedy builder. This collapses what used to be TWO
 * independently authored messages for the identical condition: this file's
 * own (formerly `buildUnconfiguredUpstreamError`, a hand-edit-YAML template)
 * and `../adapters/cli/commands/report-issue.ts`'s own (formerly
 * `buildAutoConfigRequiredError`, now deleted) — a reader could not tell
 * which one was current, and nothing enforced that they even agreed (AC-GD-2).
 *
 * ONE DEFINITION SITE (AC-GD-2(a)(i)): this is the only place this message's
 * text is authored. BOTH consumers below import and call THIS exported
 * symbol directly — never a locally rebuilt copy — so the prescribed remedy
 * cannot drift between layers again (AC-GD-2(a)(ii)/(iii)):
 *   - `report-issue.ts`'s `resolveEffectiveUpstreamCfg`, reached when
 *     `--auto-config` is absent (CLI filing AND `--list`, single wording
 *     SSOT, AC-OOB-1).
 *   - This service's own `report()` step 1, reached from ANY direct caller
 *     that passes `cfg: undefined` — including the MCP `lore_report_issue`
 *     tool, which offers no `--auto-config` equivalent at all, and
 *     `list()`'s caller-responsibility path (see that method's own JSDoc).
 *
 * Disclosure is pinned to three LITERAL substrings (AC-GD-2(b), deliberately
 * not left to a reviewer's sense of whether the prose reads clearly enough):
 * `.lore/config.yaml`, `git-tracked`, `shared`. And per the still-live
 * AC-OOB-1 (`spec-out-of-box-reporting-channel-report-issue-self-provisions`),
 * the text MUST name `--auto-config` and MUST carry ZERO hand-edit-YAML
 * template VALUE lines (`corpus_path: /path/to`, `root_prd: prd-lore`) — this
 * is why the remedy states the two required config KEYS in dotted-path prose
 * (`feedback.upstream.corpus_path`/`feedback.upstream.root_prd`, pinned by
 * the pre-existing AC-072-2 regression) rather than a copy-pasteable YAML
 * block.
 */
export function buildUnconfiguredUpstreamRemedy(): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "feedback.upstream",
    message:
      "`feedback.upstream` is not configured — this needs both feedback.upstream.corpus_path and feedback.upstream.root_prd set in the git-tracked, team-shared .lore/config.yaml. Run `lore report-issue --auto-config` to self-provision them from this install's own upstream lore corpus — no manual YAML editing required.",
  };
}

/**
 * DI-only orchestrator for `lore report-issue` — see module header for the
 * full check-sequence/invariant summary. Construct with a fully-assembled
 * `IssueReportDeps` (CLI/MCP wiring resolves the real ports; tests fake
 * them directly — no partial/default construction path exists).
 */
export class IssueReportService {
  constructor(private readonly deps: IssueReportDeps) {}

  /**
   * Runs the SPEC-072 §5 check sequence and, on success, files a new
   * ad-hoc draft task in the configured upstream corpus.
   *
   * @param input - the report's content fields
   * @param cfg - the consumer's `feedback.upstream.{corpus_path,root_prd}`;
   *   `undefined` means "not configured" (step 1's failure case)
   * @returns `ok({upstream_doc_id, possible_duplicates, dedup_degraded,
   *   resolution_read_failures})` on success; `err(...)` on the first failing
   *   check (§5 table) — ZERO writes occur before `createDraft` succeeds. A cap
   *   refusal's `error.value` is the structured {@link OpenReportCapRefusal}
   *   payload, and its `message` is that payload's human projection
   */
  async report(
    input: IssueReportInput,
    cfg: UpstreamCfg | undefined,
  ): Promise<Result<IssueReportResult, LoreError>> {
    // Step 1: feedback.upstream unset.
    if (cfg === undefined) {
      return err(buildUnconfiguredUpstreamRemedy());
    }

    const upstreamResult = await this.openValidatedUpstream(cfg);
    if (!upstreamResult.ok) return upstreamResult;
    const { port, upstreamConfig } = upstreamResult.value;

    // The OPERATIVE ceiling: the UPSTREAM's own declared
    // `feedback.inbound.open_report_cap` (§M2), resolved through the single
    // `@lore/core` seam from the config `openValidatedUpstream` already loaded.
    // ⛔ Not `OPEN_REPORT_CAP` (that is only this field's Zod default) and ⛔ not
    // anything read off `cfg` — `cfg` is the CONSUMER's file, and a reporter that
    // could raise its own ceiling is not rate-limited at all.
    const openReportCap = resolveOpenReportCap(upstreamConfig);

    try {
      // Step 6: rate cap (R-5d), keyed on COMPUTED RESOLUTION (M1).
      //
      // `countOpenReports` yields the CANDIDATE set only — the reporter's own
      // ad-hoc drafts. It cannot answer "is this report still open?" because a
      // resolved report's `status` never leaves `draft` (no closure verb can move
      // it, and `VALID_TRANSITIONS` has no draft->archived edge), which is exactly
      // why the pre-M1 cap was unreleasable by ANY action available to the
      // reporter: 10 reports resolved `rejected` still refused the 11th with a
      // byte-identical message (measured 2026-08-11). The narrowing below asks the
      // SAME question the read surfaces ask — `port.getResolution`, the existing
      // per-doc computed-resolution read `list()` already consumes, never a
      // parallel re-derivation.
      const openDraftsResult = await port.listOpenAdhocDrafts();
      if (!openDraftsResult.ok) return openDraftsResult;
      const { ids } = countOpenReports(openDraftsResult.value, this.deps.reporterProject);

      const blocking: CapBlockingReport[] = [];
      const resolutionReadFailures: ResolutionReadFailure[] = [];
      for (const id of ids) {
        const resolutionResult = await port.getResolution(id);
        if (!resolutionResult.ok) {
          // reason: FAIL CLOSED. An unreadable candidate keeps its slot — a read
          // error must never be the thing that frees quota — and the failure is
          // recorded in BOTH observable places (the refusal payload below and
          // `IssueReportResult.resolution_read_failures` when the filing
          // proceeds), so it is never silently swallowed either way.
          const reason = describeLoreErrorWithCode(resolutionResult.error);
          resolutionReadFailures.push({ id, error: reason });
          blocking.push({ id, resolution: null, unreadable_reason: reason });
          continue;
        }
        const live = resolutionResult.value;
        // reason: `ok(null)` means the doc vanished between listOpenAdhocDrafts
        // and this read (deleted upstream). A doc that no longer exists cannot
        // need triage, so it holds no slot — a FACT, not a fallback.
        if (live === null) continue;
        if (TERMINAL_ISSUE_RESOLUTIONS.has(live.resolution)) continue;
        blocking.push({ id, resolution: live.resolution });
      }

      if (blocking.length >= openReportCap) {
        const refusal: OpenReportCapRefusal = {
          blocking,
          // DERIVED from the shared SSOT, never a literal list (AC-DC-2).
          quota_freeing_states: [...TERMINAL_ISSUE_RESOLUTION_LIST],
        };
        return err({
          code: "VALIDATION_ERROR",
          field: "feedback.upstream",
          // The message names the ceiling that was actually APPLIED — same value,
          // same variable, so "the cap printed is the cap enforced" holds by
          // construction (AC-DC-3 reads `cap N` out of this line).
          message: formatOpenReportCapRefusalMessage(this.deps.reporterProject, openReportCap, refusal),
          value: refusal,
        });
      }

      // Step 7: advisory FTS dedup — a search failure degrades, never blocks.
      let possibleDuplicates: string[] = [];
      let dedupDegraded = false;
      const dedupResult = await port.searchDuplicates(input.title, 5);
      if (dedupResult.ok) {
        possibleDuplicates = dedupResult.value;
      } else {
        dedupDegraded = true;
      }

      // Step 8: createDraft — any failure propagates VERBATIM, no receipt.
      const reportedAt = this.deps.now();
      const payload: IssueReportPayload = {
        reporter_project: this.deps.reporterProject,
        // reason: see IssueReportInput.by's JSDoc — CLI/MCP always resolve a
        // real actor before calling report(); this fallback only guards a
        // defensive/direct-caller path (also exercised by the RED suite's
        // BASE_INPUT, which omits `by`).
        reporter_actor: input.by ?? this.deps.reporterProject,
        lore_version: this.deps.loreVersion,
        expected: input.expected,
        actual: input.actual,
        reported_at: reportedAt,
        possible_duplicates: possibleDuplicates,
        ...(input.repro_command !== undefined ? { repro_command: input.repro_command } : {}),
      };
      const createResult = await port.createDraft({
        title: input.title,
        content: input.description,
        extra: buildIssueReportExtra(payload),
      });
      if (!createResult.ok) {
        const contention = toWriteContentionError(
          createResult.error,
          join(cfg.corpus_path, ".lore", "lore.db"),
          this.deps.writeWaitMs,
        );
        return contention !== undefined ? err(contention) : createResult;
      }

      // Step 9: receipts.append — strictly after step 8 succeeds.
      const appendResult = this.deps.receipts.append({
        upstream_doc_id: createResult.value.id,
        title: input.title,
        at: reportedAt,
      });
      if (!appendResult.ok) {
        return err({
          code: "STORE_ERROR",
          message:
            `report filed upstream as '${createResult.value.id}' but the local receipt ` +
            `failed to record (${describeLoreError(appendResult.error)}) — the upstream ` +
            `report itself was NOT lost, only its local audit trail.`,
        });
      }

      return ok({
        upstream_doc_id: createResult.value.id,
        possible_duplicates: possibleDuplicates,
        dedup_degraded: dedupDegraded,
        resolution_read_failures: resolutionReadFailures,
      });
    } finally {
      port.close();
    }
  }

  /**
   * Joins the local receipt history with the upstream DEFECT's computed
   * resolution (D6, spec-issue-closure-loop-computed-resolution-agent-reachable) —
   * NOT the upstream doc's raw lifecycle status, which used to be (and would
   * silently misreport a `draft` issue task whose fix already shipped as a
   * SEPARATE `active`/`archived` doc as still `draft`; that exact shape
   * misreported to a real consuming project for 9 days). Raw doc status is
   * now a demoted debugging detail (`ReceiptStatusRow.doc_status`); an
   * explicit `rejected`/`wontfix` reason is echoed via `rejection_reason`
   * (D3's `lore issue resolve --reason`, read by `UpstreamPort.getResolution`).
   *
   * @param cfg - the consumer's `feedback.upstream.{corpus_path,root_prd}`
   * @returns `ok(rows[])` — an upstream that cannot be validated/opened at
   *   all degrades every row to `status: "unreachable"` rather than failing
   *   the whole call (SPEC-072 AC-072-10: "history stays visible, no
   *   crash" — preserved byte-for-byte); a receipt whose doc no longer
   *   exists upstream ALSO degrades to `status: "unreachable"`
   *   (`UpstreamPort.getResolution`'s documented `ok(null)` case — same
   *   contract T5's `getDocStatus` established, preserved byte-for-byte);
   *   `err(...)` only for a `receipts.read()` failure (a genuine local IO
   *   error, not an upstream-reachability concern)
   */
  async list(cfg: UpstreamCfg): Promise<Result<ReceiptStatusRow[], LoreError>> {
    const receiptsResult = this.deps.receipts.read();
    if (!receiptsResult.ok) return receiptsResult;
    const { entries, corrupt_lines } = receiptsResult.value;
    const corruptWarning =
      corrupt_lines.length > 0
        ? [`${corrupt_lines.length} corrupt receipt line(s) skipped: ${corrupt_lines.join(", ")}`]
        : [];

    const upstreamResult = await this.openValidatedUpstream(cfg);
    if (!upstreamResult.ok) {
      // reason: an upstream that can't be reached/validated must never hide
      // the LOCAL history — every row degrades to "unreachable" instead of
      // propagating the rail error (AC-072-10, preserved byte-for-byte).
      return ok(
        entries.map((entry) => ({
          upstream_doc_id: entry.upstream_doc_id,
          title: entry.title,
          at: entry.at,
          status: "unreachable" as const,
          ...(corruptWarning.length > 0 ? { warnings: corruptWarning } : {}),
        })),
      );
    }

    // reason: `list()` is a pure read — it enforces no ceiling, so it destructures
    // the port and deliberately ignores `upstreamConfig`. The cap belongs to the
    // WRITE path only (`report()`); reading history must never be rate-limited.
    const { port } = upstreamResult.value;
    try {
      const rows = await Promise.all(
        entries.map(async (entry): Promise<ReceiptStatusRow> => {
          const resolutionResult = await port.getResolution(entry.upstream_doc_id);
          if (!resolutionResult.ok) {
            return {
              upstream_doc_id: entry.upstream_doc_id,
              title: entry.title,
              at: entry.at,
              status: "unreachable",
              warnings: [
                ...corruptWarning,
                `could not determine resolution: ${describeLoreError(resolutionResult.error)}`,
              ],
            };
          }
          const live = resolutionResult.value;
          if (live === null) {
            return {
              upstream_doc_id: entry.upstream_doc_id,
              title: entry.title,
              at: entry.at,
              status: "unreachable",
              warnings: [...corruptWarning, "upstream doc no longer found (deleted, or never existed)"],
            };
          }
          return {
            upstream_doc_id: entry.upstream_doc_id,
            title: entry.title,
            at: entry.at,
            status: live.resolution,
            doc_status: live.status,
            ...(live.rejection_reason !== undefined ? { rejection_reason: live.rejection_reason } : {}),
            ...(corruptWarning.length > 0 ? { warnings: corruptWarning } : {}),
          };
        }),
      );
      return ok(rows);
    } finally {
      port.close();
    }
  }

  /**
   * Runs SPEC-072 §5 steps 2-5 (upstream sync-mode constraint → schema
   * version match → open the narrow `UpstreamPort` → root-PRD identity) —
   * the rails shared verbatim by `report()` and `list()` ("§5: list() runs
   * steps 1-5, same rails").
   *
   * @returns `ok({port, upstreamConfig})` on a fully-validated, OPEN upstream
   *   connection (caller MUST `port.close()` when done) — the upstream's own
   *   loaded config travels with the port so step 6's ceiling reads the SAME
   *   file this method validated, loaded once (§M2, see {@link ValidatedUpstream});
   *   `err(...)` naming the first failing rail
   */
  private async openValidatedUpstream(cfg: UpstreamCfg): Promise<Result<ValidatedUpstream, LoreError>> {
    // Step 3: upstream config sync.enabled === true (config check precedes probe).
    // This is ALSO the one load of the upstream's own declared policy — a
    // malformed upstream config (e.g. an out-of-range
    // `feedback.inbound.open_report_cap`) refuses the whole call here, naming the
    // offending key, rather than silently reverting to the shipped default.
    const upstreamConfigResult = this.deps.loadUpstreamConfig(cfg.corpus_path);
    if (!upstreamConfigResult.ok) return upstreamConfigResult;
    const upstreamConfig = upstreamConfigResult.value;
    if (upstreamConfig.sync?.enabled === true) {
      return err({
        code: "VALIDATION_ERROR",
        field: "feedback.upstream.corpus_path",
        message:
          `upstream corpus at '${cfg.corpus_path}' has sync.enabled=true — lore ` +
          "report-issue v1 only supports SQLite-only (non-sync) upstream corpora.",
        value: cfg.corpus_path,
      });
    }

    // Step 4: probe.user_version !== expectedSchemaVersion.
    const dbPath = join(cfg.corpus_path, ".lore", "lore.db");
    const probeResult = this.deps.probe(dbPath);
    if (!probeResult.ok) {
      // reason: the readonly probe races the SAME upstream file a concurrent
      // invocation's `createDraft` may be mid-`BEGIN IMMEDIATE` on — a
      // busy_timeout expiry here is corpus write CONTENTION, not "the store
      // is broken", so it gets the identical re-typing `createDraft`'s own
      // contention failure gets below (task-fix-the-spec-072-cross-corpus-
      // database-is-locked-race). Every non-contention probe failure (missing
      // file, corrupt file) still propagates verbatim.
      const contention = toWriteContentionError(probeResult.error, dbPath, this.deps.writeWaitMs);
      return contention !== undefined ? err(contention) : probeResult;
    }
    if (probeResult.value.user_version !== this.deps.expectedSchemaVersion) {
      return err({
        code: "VALIDATION_ERROR",
        field: "feedback.upstream.corpus_path",
        message:
          `upstream corpus schema version mismatch at '${dbPath}': this lore install ` +
          `expects user_version ${this.deps.expectedSchemaVersion}, found ${probeResult.value.user_version}`,
        value: { expected: this.deps.expectedSchemaVersion, found: probeResult.value.user_version },
      });
    }

    // Open the narrow UpstreamPort (buildUpstreamContext re-runs its own
    // TOCTOU version re-check — SPEC-072 §7 Design Decisions "Schema precheck").
    // That re-probe races the same file for the same reason the direct probe
    // above does, so a contended failure here gets the SAME re-typing.
    //
    // ⛔ This rail is only as good as `openUpstream`'s promise to RETURN its
    // failures rather than throw them. That promise is not decoration: the
    // port opens a read-write bun:sqlite handle, whose constructor runs
    // `PRAGMA`/migration DDL and raises `database is locked` synchronously
    // when it collides with a concurrent writer. It USED to escape right
    // through this `if` and kill the process with a raw stack trace, in 92 of
    // ~300 attempts of the concurrency harness (task-openvalidatedupstream-
    // lets-a-synchronous-store-init-throw). It is now upheld where the handle
    // is actually opened — `flows/upstream-context-flow.ts::buildUpstreamContext`
    // catches and returns `err({code: "STORE_ERROR", ...})`, matching the
    // never-throws guarantee `probeUpstreamDb` already made for the readonly
    // handle — so the classification stays HERE, in one place, for both rails.
    // A new `openUpstream` implementation MUST uphold the same guarantee; do
    // not re-solve it with a second catch at this call site.
    const portResult = this.deps.openUpstream(cfg.corpus_path);
    if (!portResult.ok) {
      const contention = toWriteContentionError(portResult.error, dbPath, this.deps.writeWaitMs);
      return contention !== undefined ? err(contention) : portResult;
    }
    const port = portResult.value;

    // Step 5: root-PRD identity (R-5a).
    const rootResult = await port.resolveRootDoc();
    if (!rootResult.ok) {
      port.close();
      return rootResult;
    }
    const match = matchRootPrd(rootResult.value, cfg.root_prd);
    if (!match.ok) {
      port.close();
      return err({
        code: "VALIDATION_ERROR",
        field: "feedback.upstream.root_prd",
        message: `upstream root PRD mismatch: expected '${cfg.root_prd}', found '${match.found ?? "(no root PRD)"}'`,
        value: { expected: cfg.root_prd, found: match.found },
      });
    }

    return ok({ port, upstreamConfig });
  }
}

/** Re-exported for callers that only need the receipt shape (CLI/MCP wiring). */
export type { ReceiptEntry };
