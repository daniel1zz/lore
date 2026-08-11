/**
 * Narrow second composition root for an UPSTREAM lore corpus (SPEC-072
 * `lore report-issue`). This is the ONLY place `lore report-issue`'s CLI/MCP
 * wiring reaches into a corpus that is NOT the caller's own — every other
 * flow/service in this codebase composes against the local corpus via
 * `app.ts`. Mirrors the `flows/` "thin composition, not business logic"
 * convention (`setup-project-flow.ts` precedent) rather than living in
 * `service/`, since `service/` files never construct stores themselves.
 *
 * Public surface:
 *   - `UpstreamPort` — the transport seam `IssueReportService` is injected
 *     with (SPEC-072 §4; a future P2 `HttpUpstreamPort` implements the same
 *     interface with zero orchestration rewrite). Gained a 5th op,
 *     `getResolution` (spec-issue-closure-loop-computed-resolution-agent-reachable
 *     D6/D7, AC-ICL-7), on top of the original 4 — see that method's own
 *     JSDoc for why a per-doc computed-resolution lookup could not be
 *     derived from the original 4 ops. `getResolution` REPLACES the earlier
 *     T5 `getDocStatus` (SPEC-072 AC-072-10) — D6 needs "has the DEFECT
 *     itself been triaged terminal" (`lore issue resolve`) or fixed (a
 *     `resolves` edge to a terminal doc), which `getResolution` answers
 *     directly, folding the raw doc status in as a demoted debugging field
 *     rather than the primary signal. `getDocStatus`'s audit-log
 *     reject-reason lookback ("was this draft ever bounced by the REVIEW
 *     workflow") was DROPPED by that replacement, then RESTORED by P2
 *     (spec-issue-closure-loop-computed-resolution-agent-reachable D2,
 *     AC-ICL-11) once the drop proved to be a real regression: a
 *     review-rejected report is indistinguishable from an untouched one by
 *     `doc.status` alone (SPEC-005), so `getResolution` needs that same
 *     lookback to feed `computeIssueResolution`'s `hasRecordedReviewRejection`
 *     parameter — see `getResolution`'s own JSDoc. A 6th op,
 *     `listIssueReports`, was added by
 *     spec-the-defect-channel-cannot-be-honestly-maintained-an §M4: `lore issues`
 *     now reads the CONFIGURED UPSTREAM by default, which no combination of the
 *     other five can answer (see that method's own JSDoc).
 *   - `UpstreamIssueFacts` / `UpstreamIssueReportRow` — the computed per-report
 *     facts BOTH read ops return, derived at ONE site (`deriveIssueFacts`) so
 *     `lore issues` and `lore report-issue --list` cannot disagree about the same
 *     report. That agreement IS §M4's mechanism; a second derivation would
 *     re-open the measured 0-vs-12 divergence one layer below where it was fixed.
 *   - `buildUpstreamContext(corpusRoot)` — resolves `corpusRoot/.lore/lore.db`,
 *     re-asserts its schema version against `LATEST_SCHEMA_VERSION` via a
 *     readonly probe BEFORE constructing a real (migrating) `SQLiteStore`,
 *     then composes `SQLiteStore` + `CorpusService` ONLY.
 *
 * Invariants:
 *   - Deliberately NARROW composition — `SQLiteStore` + `CorpusService`
 *     only. NO `Telemetry`, NO AI-provider registry, NO `GateEnforcer`.
 *     `CorpusService._createImpl`'s gate branch only ever fires for
 *     `type === "spec"` (`corpus-service.ts:749`) — a task-type `create()`
 *     (what `createDraft` below performs) never consults ANY of the five
 *     registered checkpoints, so wiring a `GateEnforcer` here would be dead
 *     coupling implying false assurance (SPEC-072 §7 Design Decisions).
 *   - TOCTOU guard: `probeUpstreamDb` is called HERE (not just by an earlier
 *     caller) immediately before `new SQLiteStore(dbPath)` — `SQLiteStore`'s
 *     constructor unconditionally runs `runMigrations()`, so a version
 *     mismatch discovered ONE call earlier could still be raced by another
 *     process bumping the schema in between; re-checking right before the
 *     migrating construction closes that window. The cost is one extra
 *     cheap `PRAGMA` read.
 *   - A version mismatch or missing db file returns BEFORE any `SQLiteStore`
 *     is constructed — zero migration side effect is ever observable on a
 *     rejected upstream corpus.
 *   - **`buildUpstreamContext` NEVER THROWS** — the same guarantee
 *     `upstream-probe.ts::probeUpstreamDb` makes for the readonly handle now
 *     holds for the read-write one. `new SQLiteStore(...)` runs PRAGMAs and
 *     migration DDL inside its CONSTRUCTOR, and bun:sqlite raises straight out
 *     of it (`database is locked` when a concurrent writer holds the corpus),
 *     so this function used to leak an exception past its own `Result` type —
 *     every caller's `if (!result.ok)` rail was simply bypassed and the
 *     process died with a raw stack trace (measured: 92 of ~300 attempts of
 *     the SPEC-072 cross-corpus concurrency harness;
 *     task-openvalidatedupstream-lets-a-synchronous-store-init-throw). It is
 *     now caught and returned as `err({code: "STORE_ERROR", ...})`, message
 *     and `cause` intact. This module CLASSIFIES nothing: deciding that a
 *     given failure is write CONTENTION (and re-typing it to
 *     `WRITE_CONTENTION`) stays with the caller that knows the declared bound
 *     — `IssueReportService.openValidatedUpstream`.
 *
 * Side-effect class: IO (opens a real SQLite connection to the upstream
 * corpus on success; the probe-only rejection paths are read-only).
 *
 * Source: SPEC-072 §3 Structure, §4 Public Interface
 * (`flows/upstream-context-flow.ts`), §6 Dependency Graph, §7 Design
 * Decisions ("Composition home", "GateEnforcer in upstream context",
 * "Schema precheck", "Version SSOT").
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_WRITE_WAIT_MS, err, ok, readIssueTriageLabels, type Result } from "@lore/core";
import type { DocStatus, IssueSeverity, LoreError } from "@lore/core";
import { probeUpstreamDb } from "./upstream-probe.js";
import { SQLiteStore, LATEST_SCHEMA_VERSION } from "../store/sqlite-store.js";
import { wrapStoreError } from "../store/store-shared.js";
import { CorpusService } from "../service/corpus-service.js";
import {
  computeIssueResolution,
  EXPLICIT_TERMINAL_RESOLUTIONS,
  hasIssueReport,
  reachOfTerminalResolution,
  type ExplicitTerminalResolution,
  type IssueResolution,
} from "../service/issue-resolution.js";

/**
 * The transport seam `IssueReportService` and the `lore issues` read surface
 * orchestrate through — never the full `CorpusService`/`StoreInterface` surface
 * (leak-proof against a future P2 `HttpUpstreamPort` needing to implement
 * anything beyond the ops declared below; ⛔ never restate their count here —
 * this interface's own members are the only true tally). Every method returns
 * `Promise<Result<T, LoreError>>`, same convention as every other service in
 * this codebase.
 */
export interface UpstreamPort {
  /**
   * @returns the upstream corpus's root PRD (`{id, slug}`), or `null` when
   *   the upstream corpus has no PRD document at all (empty/malformed
   *   corpus — a fact, not an error)
   */
  resolveRootDoc(): Promise<Result<{ id: string; slug: string } | null, LoreError>>;
  /**
   * @returns every OPEN (status=`draft`) ad-hoc (`extra.adhoc === true`)
   *   task in the upstream corpus — the candidate set `countOpenReports`
   *   (`@lore/core`) filters down to one reporter project's own reports
   */
  listOpenAdhocDrafts(): Promise<
    Result<Array<{ id: string; status: string; extra?: unknown }>, LoreError>
  >;
  /**
   * Advisory FTS duplicate search — a search failure is the CALLER's concern
   * (surfaced as `dedup_degraded: true`, never blocks filing); this method
   * itself still returns `err(...)` on failure rather than silently
   * swallowing it, so the caller can distinguish "zero hits" from "search
   * broke".
   * @param query - free-text search query (title/description of the new report)
   * @param limit - maximum number of duplicate doc ids to return
   * @returns up to `limit` upstream doc ids ranked by search relevance
   */
  searchDuplicates(query: string, limit: number): Promise<Result<string[], LoreError>>;
  /**
   * Creates the upstream ad-hoc draft task. ANY failure (validation, store,
   * or otherwise) is returned VERBATIM (SPEC-072 R-5e failure-transparency)
   * — the caller must never paper over an upstream rejection.
   * @param input - `title`/`content` plus the fully-assembled `extra`
   *   (`buildIssueReportExtra`'s output, `@lore/core`) — this method does
   *   NOT itself inject `adhoc: true`; the caller's `extra` is passed
   *   through untouched, so it alone owns that contract.
   * @returns the newly created upstream doc's `id`
   */
  createDraft(input: {
    title: string;
    content: string;
    extra: Record<string, unknown>;
  }): Promise<Result<{ id: string }, LoreError>>;
  /**
   * Computed resolution (D2 `computeIssueResolution`, consumed verbatim from
   * `service/issue-resolution.ts` — never reimplemented here) for ONE
   * upstream issue-task doc by id, plus its raw lifecycle status (D6: demoted
   * to a debugging detail, no longer the primary signal) and, when a
   * rejection reason is on record, that reason echoed back.
   *
   * Added AFTER the original 4 ops proved insufficient: none of
   * `resolveRootDoc`/`listOpenAdhocDrafts`/`searchDuplicates`/`createDraft`
   * can answer "has this defect actually been fixed or triaged terminal" —
   * that needs a join this port didn't expose: every `resolves` in-edge
   * targeting the issue doc, plus each edge's source doc's lifecycle status.
   * Reuses `CorpusService.getResolvesInEdgesForIssues` (D7's ONE cross-doc
   * read-orchestration locus for exactly this join — batched, never N+1;
   * same method the local-corpus surfaces `lore issues`/HTTP issue-reports
   * projection call) rather than re-deriving the join here.
   *
   * P2 (AC-ICL-11) RESTORED the old T5 audit-log "most recent reject"
   * lookback that D6 had dropped: `ReviewService.reject` never transitions a
   * doc OFF `draft` (SPEC-005), so a review-rejected report is
   * indistinguishable from an untouched one by `status` alone — the audit
   * trail is the ONLY record. `computeIssueResolution`'s new
   * `hasRecordedReviewRejection` parameter needs exactly this boolean, which
   * only this store-backed caller can supply (the pure service module cannot
   * query the audit table itself). ONE unified reason reader
   * (`readResolutionReason` below, extended) surfaces the reason regardless
   * of whether it came from an explicit D3 write or this audit-log fallback
   * — there is no second `*_reason` field on the return type.
   *
   * @param id - the upstream draft task's doc id (a `ReceiptEntry.upstream_doc_id`)
   * @returns `ok(null)` when no doc with this id exists upstream anymore
   *   (deleted, or never existed) — a fact, not an error, and the caller's
   *   documented "unreachable"-equivalent row case; {@link UpstreamIssueFacts}
   *   otherwise. `resolution_reason` is populated ONLY when the computed
   *   `resolution` is itself an EXPLICIT terminal state — a stale audit-log
   *   reason from BEFORE a later fix landed (resolution now `fixed`/`resolving`)
   *   is never echoed, so no row ever shows a reason next to a resolution that
   *   never recorded one.
   *
   *   The formerly-`rejection_reason` field is now the state-neutral
   *   {@link UpstreamIssueFacts.resolution_reason}, and the pointer the two
   *   NON-DEROGATORY states carry is echoed as `resolution_pointer` — see that
   *   interface's own field docs. The previously-recorded KNOWN GAP (a
   *   rejection-named field could not carry a `superseded`/`duplicate` reason
   *   without mislabelling it, and its pointer reached no read surface at all)
   *   is CLOSED at all three sites this file's own note named:
   *   `resolution_reason`/`resolution_pointer` here, `ReceiptStatusRow` in
   *   `service/issue-report-service.ts`, and the row render in
   *   `adapters/cli/commands/report-issue.ts` (a `Pointer` column). Grep
   *   `resolution_pointer` to find all three.
   */
  getResolution(id: string): Promise<Result<UpstreamIssueFacts | null, LoreError>>;
  /**
   * EVERY task in this corpus carrying `extra.issue_report`, each annotated with
   * the facts {@link getResolution} computes for one — the read `lore issues`
   * consumes (spec-the-defect-channel-cannot-be-honestly-maintained-an §M4).
   *
   * Added as a 6th op because §M4 makes `lore issues` read the CONFIGURED
   * UPSTREAM by default, and none of the existing 5 can answer it:
   * `listOpenAdhocDrafts` is narrowed to `status: "draft"` (so `--all`/`--resolved`
   * would silently miss an archived report, whose computed resolution is exactly
   * the `closed` state that listing exists to show) and carries no
   * `slug`/`title`; `getResolution` answers for one already-known id, which is
   * the question `report-issue --list` asks from its local receipt ledger, not
   * the question a listing asks.
   *
   * ⛔ Resolution is computed by the SAME internal derivation `getResolution`
   * uses, deliberately: the whole point of §M4 is that the two read surfaces stop
   * disagreeing, so a second derivation here would re-open the defect one layer
   * down.
   *
   * @returns every issue-report-carrying task, in store order — filtering by
   *   `--open`/`--resolved`/`--all` is the CALLER's concern (the terminal-set
   *   predicate lives in `service/issue-resolution.ts`, not in a transport op)
   */
  listIssueReports(): Promise<Result<UpstreamIssueReportRow[], LoreError>>;
  /** Closes the underlying SQLite connection. Idempotent-unsafe (do not call twice). */
  close(): void;
}

/**
 * The computed facts about ONE upstream issue report, shared verbatim by
 * {@link UpstreamPort.getResolution} (one id) and
 * {@link UpstreamPort.listIssueReports} (every report).
 */
export interface UpstreamIssueFacts {
  /** The issue task's OWN raw lifecycle status — a demoted debugging detail (D6), never the primary signal. */
  readonly status: DocStatus;
  /** The COMPUTED resolution (`computeIssueResolution`, consumed verbatim — never reimplemented here). */
  readonly resolution: IssueResolution;
  /**
   * The reason recorded alongside an EXPLICIT terminal resolution — `rejected`
   * and `wontfix` (derogatory) AND `superseded`/`duplicate` (non-derogatory,
   * §M3) alike — or, for `rejected` only, the most recent review-workflow reject
   * reason from the audit trail.
   *
   * State-NEUTRAL by name and by predicate: membership is tested against
   * `EXPLICIT_TERMINAL_RESOLUTIONS` (the SSOT set), ⛔ never a hand-written state
   * list, so a future explicit state cannot ship with its reason silently
   * withheld. Absent when the computed resolution is not an explicit terminal
   * state, so no row ever shows a reason beside a resolution that did not record
   * one (AC-ICL-11, preserved).
   */
  readonly resolution_reason?: string;
  /**
   * The RESOLVED doc id the two NON-DEROGATORY states point at
   * (`resolution.superseded_by` / `resolution.duplicate_of`), read via the state's
   * own declared `extra_key` from `reachOfTerminalResolution` — ⛔ never a
   * hardcoded key pair.
   *
   * Load-bearing rather than decorative: a non-derogatory terminal state whose
   * pointer never reaches a read surface is operationally indistinguishable from
   * a rejection, which is the defect §M3 exists to remove — so §M3's capability
   * would be implemented and unreachable without this field.
   */
  readonly resolution_pointer?: string;
  /** §M6 ORDERING-ONLY severity, as the FILER declared it. Absent = NOT DECLARED. */
  readonly severity?: IssueSeverity;
  /** §M6 ORDERING-ONLY category, as the FILER declared it. Absent = NOT DECLARED. */
  readonly category?: string;
}

/** One row of {@link UpstreamPort.listIssueReports} — the shared facts plus the identity a listing renders. */
export interface UpstreamIssueReportRow extends UpstreamIssueFacts {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  /** The report's raw `extra` — the caller reads `reporter_project`/`reported_at` off it with its own defensive reader. */
  readonly extra: Record<string, unknown>;
}

/**
 * Defensive `extra.issue_report.resolution.reason` reader — mirrors the
 * duplicated-defensive-extra-reader pattern already established by
 * `adapters/cli/commands/issues.ts::readIssueReportString` and
 * `adapters/http/issue-reports-routes.ts::projectIssueReportRow` (same
 * module-boundary reasoning: a malformed/legacy `extra` degrades to
 * "no reason", never throws; duplicated rather than imported since each
 * call site reads a different key). `lore issue resolve` is the sole writer
 * of this field (`adapters/cli/commands/issue.ts`, D3). {@link deriveIssueFacts}
 * (below) is this reader's ONLY caller — it merges this D3-explicit source
 * with the D2 audit-log reject-reason fallback into the SAME single
 * `resolution_reason` output field, preferring this one when both exist.
 *
 * @param extra - the issue task's raw `extra` field
 * @returns the recorded reason string when `extra.issue_report.resolution.reason`
 *   is present and well-shaped; `undefined` otherwise (absent, malformed, or
 *   no explicit terminal state was ever recorded)
 */
function readResolutionReason(extra: unknown): string | undefined {
  return readResolutionStringField(extra, "reason");
}

/**
 * Defensive reader for ONE string field inside `extra.issue_report.resolution` —
 * the guard shape {@link readResolutionReason} used to inline, factored out
 * because §M3's pointer lives in a SIBLING key of the same object and reading it
 * with a second hand-copied guard chain is how the two would drift.
 *
 * @param extra - the issue task's raw `extra` field (untyped storage)
 * @param field - the key to read off `extra.issue_report.resolution`
 * @returns the string value when present and well-shaped; `undefined` otherwise
 */
function readResolutionStringField(extra: unknown, field: string): string | undefined {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return undefined;
  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  if (issueReport === null || typeof issueReport !== "object" || Array.isArray(issueReport)) return undefined;
  const resolution = (issueReport as Record<string, unknown>)["resolution"];
  if (resolution === null || typeof resolution !== "object" || Array.isArray(resolution)) return undefined;
  const value = (resolution as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * The §M3 pointer for an EXPLICIT terminal state, read from the key that state
 * itself DECLARES (`reachOfTerminalResolution(state).pointer.extra_key`).
 *
 * ⛔ The key is never hardcoded and the two states are never enumerated here: a
 * third pointer-carrying state added to the reach table surfaces automatically,
 * whereas a `state === "superseded" ? "superseded_by" : "duplicate_of"` ternary
 * would inherit one state's key for the new one — the exact fall-through
 * `TerminalResolutionPointer.names` was introduced to prevent.
 *
 * @param extra - the issue task's raw `extra` field
 * @param state - the EXPLICIT terminal state the resolution computed to
 * @returns the resolved pointer doc id, or `undefined` for a state that declares
 *   no pointer (`rejected`/`wontfix`) or a record that carries none
 */
function readResolutionPointer(extra: unknown, state: ExplicitTerminalResolution): string | undefined {
  const pointer = reachOfTerminalResolution(state).pointer;
  if (pointer === null) return undefined;
  return readResolutionStringField(extra, pointer.extra_key);
}

/** Is `resolution` a state a caller may have recorded a reason (and possibly a pointer) on? Keyed on the SSOT set, never a literal list. */
function isExplicitTerminal(resolution: IssueResolution): resolution is ExplicitTerminalResolution {
  return (EXPLICIT_TERMINAL_RESOLUTIONS as ReadonlySet<string>).has(resolution);
}

/**
 * Per-connection options for the upstream corpus — currently only the DECLARED
 * write-wait bound (spec-report-issue-has-no-specified-concurrency-contract-ac-072
 * D4). Passed IN by the caller that also owns the refusal message, so the
 * applied bound and the reported bound are the same value by construction.
 */
export interface UpstreamContextOptions {
  /**
   * `PRAGMA busy_timeout` (ms), applied identically to BOTH the readonly
   * schema-version probe AND the real write connection
   * (task-fix-the-spec-072-cross-corpus-database-is-locked-race — the probe
   * used to get none at all, letting a fast reader lose to a concurrent
   * writer's `BEGIN IMMEDIATE` with zero wait). Absent → `DEFAULT_WRITE_WAIT_MS`.
   */
  readonly writeWaitMs?: number;
}

/**
 * Resolves `corpusRoot/.lore/lore.db`, re-asserts its schema version against
 * `LATEST_SCHEMA_VERSION` via a readonly probe, and — only on a match —
 * composes a narrow `UpstreamPort` over `SQLiteStore` + `CorpusService`.
 *
 * @param corpusRoot - the upstream repo ROOT (the shape `lore init`
 *   produces — i.e. the directory containing `.lore/`, NOT `.lore/` itself)
 * @param options - see {@link UpstreamContextOptions}; omitted →
 *   `DEFAULT_WRITE_WAIT_MS`, applied to BOTH the probe and the store (every
 *   pre-existing call site keeps the SAME store-side bound it always got;
 *   the probe now shares it instead of getting none)
 * @returns `ok(UpstreamPort)` on a schema-version match; `err({code:
 *   "VALIDATION_ERROR", ...})` naming the resolved path (missing db) or both
 *   versions (mismatch) — no `SQLiteStore` is ever constructed on either
 *   rejection path; `err({code: "STORE_ERROR", ...})` when opening the
 *   read-write handle itself fails (write contention, corrupt file, a failed
 *   migration), carrying the driver error's own message and `cause`
 * @invariant NEVER THROWS — every bun:sqlite exception raised while
 *   constructing the store is caught and returned as `err({code:
 *   "STORE_ERROR", ...})`, the same guarantee {@link probeUpstreamDb} makes
 *   for the readonly handle. Callers rail on the `Result` and nothing else;
 *   before this held, a `database is locked` throw out of `SQLiteStore`'s
 *   constructor sailed past every `if (!result.ok)` check and killed the
 *   process (task-openvalidatedupstream-lets-a-synchronous-store-init-throw).
 *   This function classifies NOTHING — see the inline note at the catch.
 * @example
 *   const ctx = buildUpstreamContext("/path/to/upstream/repo");
 *   if (ctx.ok) {
 *     const root = await ctx.value.resolveRootDoc();
 *     ctx.value.close();
 *   }
 */
export function buildUpstreamContext(
  corpusRoot: string,
  options?: UpstreamContextOptions,
): Result<UpstreamPort, LoreError> {
  const dbPath = join(corpusRoot, ".lore", "lore.db");

  if (!existsSync(dbPath)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "feedback.upstream.corpus_path",
      message: `upstream corpus database not found at '${dbPath}' — is this a lore-init'd corpus root?`,
      value: corpusRoot,
    });
  }

  // reason: resolved ONCE and reused for BOTH the probe below and the
  // SQLiteStore construction further down — the probe (a readonly reader) and
  // the store (the real writer) are opened against the exact same file, so
  // they must wait out the SAME declared window or the probe stays racy for
  // any caller that leaves `options` unset (the bug this task fixes: the
  // probe previously got busy_timeout=0 in every case, while the store below
  // already defaulted to DEFAULT_WRITE_WAIT_MS internally — a mismatch that
  // let a fast reader lose to a concurrent writer's `BEGIN IMMEDIATE` with no
  // wait at all). Byte-identical to the store's own pre-existing default for
  // every caller (task-fix-the-spec-072-cross-corpus-database-is-locked-race).
  const effectiveWriteWaitMs = options?.writeWaitMs ?? DEFAULT_WRITE_WAIT_MS;

  const probeResult = probeUpstreamDb(dbPath, effectiveWriteWaitMs);
  if (!probeResult.ok) return probeResult;

  if (probeResult.value.user_version !== LATEST_SCHEMA_VERSION) {
    return err({
      code: "VALIDATION_ERROR",
      field: "feedback.upstream.corpus_path",
      message:
        `upstream corpus schema version mismatch at '${dbPath}': ` +
        `this lore install expects user_version ${LATEST_SCHEMA_VERSION}, found ${probeResult.value.user_version}`,
      value: { expected: LATEST_SCHEMA_VERSION, found: probeResult.value.user_version },
    });
  }

  // reason: narrow composition — SQLiteStore + CorpusService ONLY, no
  // Telemetry/AI-registry/GateEnforcer. See module header "Invariants".
  // `effectiveWriteWaitMs` is the SAME resolved bound the probe above just
  // applied (never re-derived here): the layer that reports an expiry must
  // print the very bound this connection applied (spec-report-issue-has-no-
  // specified-concurrency-contract-ac-072 D4).
  //
  // The try/catch is what makes this function's DECLARED `Result` return type
  // TRUE (task-openvalidatedupstream-lets-a-synchronous-store-init-throw).
  // `new SQLiteStore(...)` runs `init()`'s PRAGMAs and any pending migration
  // DDL inside the constructor, and bun:sqlite raises straight out of it — so
  // this Result-returning function could THROW, and every `if (!result.ok)`
  // rail its callers had written was simply bypassed. Measured: the throw
  // escaped to `IssueReportService.report` and killed the process with a raw
  // `database is locked` stack trace (frames `run (bun:sqlite)` → `init` →
  // `new SQLiteStore` → here), 92 times in ~300 attempts of the SPEC-072
  // cross-corpus concurrency harness — where the contract requires the loser
  // to REFUSE with the declared exit code and 3-part template.
  //
  // This is the SAME "never throws, always `err(...)`" invariant
  // `upstream-probe.ts::probeUpstreamDb` already documents and upholds for the
  // readonly handle, now held by the read-write handle too, and it is the
  // narrow contract the repo's `Result<T, LoreError>` rule states: no
  // exception crosses this boundary.
  //
  // ⛔ NOTHING is classified here. `wrapStoreError` preserves the driver
  // error's `message` AND attaches the original as `cause` (so the
  // `SQLITE_BUSY` code survives), and the CALLER decides what the failure
  // means: `IssueReportService.openValidatedUpstream` runs the SAME
  // `toWriteContentionError` narrowing over this `err(...)` that it already
  // ran over the probe's, re-typing contention — and ONLY contention — into
  // `WRITE_CONTENTION`. A non-contention failure (corrupt file, permissions, a
  // failed migration) stays a `STORE_ERROR` carrying its original message and
  // propagates verbatim, exactly as it must. Do NOT add a second
  // classification site here.
  let store: SQLiteStore;
  let corpusService: CorpusService;
  try {
    store = new SQLiteStore(dbPath, { writeWaitMs: effectiveWriteWaitMs });
    corpusService = new CorpusService(store);
  } catch (error) {
    return wrapStoreError(error);
  }

  /**
   * THE single derivation of {@link UpstreamIssueFacts} for one already-fetched
   * issue doc — consumed by BOTH `getResolution` (one id) and `listIssueReports`
   * (every report).
   *
   * ⛔ Shared rather than duplicated because §M4's whole purpose is that the two
   * issue read surfaces stop disagreeing: `lore issues` reads it through
   * `listIssueReports`, `lore report-issue --list` through `getResolution`, and a
   * second derivation would re-open the measured 0-vs-12 defect one layer down
   * from where it was fixed. (It also closes a pre-existing asymmetry: the
   * pre-§M4 `commands/issues.ts` computed resolution with NO review-rejection
   * lookback, so a review-rejected report read `open` there and `rejected` on
   * `--list` — same corpus, two answers.)
   *
   * @param doc - the issue task, already fetched (id/slug/title/status/extra)
   * @param ctx - that doc's `resolves` in-edges and their source docs, from the
   *   BATCHED `getResolvesInEdgesForIssues` read
   * @returns the computed facts; `err(...)` only when the audit-trail read fails
   *   (⛔ never degraded to "no rejection on record" — that would silently
   *   downgrade a rejected report to `open`)
   */
  async function deriveIssueFacts(
    doc: { readonly id: string; readonly status: DocStatus; readonly extra: Record<string, unknown> },
    ctx: { readonly resolvesInEdges: ReadonlyArray<{ from_id: string }>; readonly sourceDocs: ReadonlyArray<{ id: string; status: DocStatus }> },
  ): Promise<Result<UpstreamIssueFacts, LoreError>> {
    // reason: D2's review-rejection precedence step needs the audit trail
    // directly — ReviewService.reject (SPEC-005) never transitions a doc
    // OFF `draft`, so `doc.status` alone can't distinguish "never
    // reviewed" from "rejected back to draft". `queryAudit` orders by
    // `timestamp DESC`, so index 0 (limit:1) is the MOST RECENT reject,
    // correctly superseding an earlier one if the doc was rejected more
    // than once — restores the exact lookback T5's `getDocStatus` used
    // before D6 replaced it with this method (see this port's own
    // `getResolution` JSDoc, "P2 RESTORED").
    const auditResult = await store.queryAudit({ doc_id: doc.id, action: "reject", limit: 1 });
    if (!auditResult.ok) return auditResult;
    const latestReject = auditResult.value[0];

    const resolution = computeIssueResolution(
      { extra: doc.extra, status: doc.status },
      ctx.resolvesInEdges,
      ctx.sourceDocs,
      latestReject !== undefined,
    );

    // ONE unified reason field regardless of origin: an explicit D3 write wins
    // (mirrors computeIssueResolution's own precedence), else fall back to the
    // audit-log reject reason — but ONLY when the computed resolution is itself an
    // EXPLICIT terminal state, so a stale reason from BEFORE a later fix landed is
    // never echoed next to a `fixed`/`resolving`/`closed`/`open` row (AC-ICL-11:
    // no row ever shows a reason beside a resolution that isn't one).
    //
    // ⛔ The membership test is `EXPLICIT_TERMINAL_RESOLUTIONS`, not the
    // `rejected`/`wontfix` pair this line used to name literally: that literal is
    // exactly why §M3's two non-derogatory states landed with their reason AND
    // their pointer invisible on every read surface. The audit fallback stays
    // `rejected`-only — a review-workflow rejection can reach no other state.
    const explicitState = isExplicitTerminal(resolution) ? resolution : undefined;
    const auditReason = latestReject?.details?.["reason"];
    const reason =
      explicitState === undefined
        ? undefined
        : (readResolutionReason(doc.extra) ??
          (resolution === "rejected" && typeof auditReason === "string" ? auditReason : undefined));
    const pointer = explicitState === undefined ? undefined : readResolutionPointer(doc.extra, explicitState);
    const triage = readIssueTriageLabels(doc.extra);

    return ok({
      status: doc.status,
      resolution,
      ...(reason !== undefined ? { resolution_reason: reason } : {}),
      ...(pointer !== undefined ? { resolution_pointer: pointer } : {}),
      ...(triage.severity !== undefined ? { severity: triage.severity } : {}),
      ...(triage.category !== undefined ? { category: triage.category } : {}),
    });
  }

  const port: UpstreamPort = {
    async resolveRootDoc() {
      const result = await store.findMany({ type: "prd" });
      if (!result.ok) return result;
      const rootPrd = result.value[0];
      return ok(rootPrd ? { id: rootPrd.id, slug: rootPrd.slug } : null);
    },

    async listOpenAdhocDrafts() {
      const result = await store.findMany({ type: "task", status: "draft" });
      if (!result.ok) return result;
      const drafts = result.value.filter((task) => task.extra?.["adhoc"] === true);
      return ok(drafts.map((task) => ({ id: task.id, status: task.status, extra: task.extra })));
    },

    async searchDuplicates(query, limit) {
      const result = await corpusService.search(query);
      if (!result.ok) return result;
      return ok(result.value.results.slice(0, limit).map((hit) => hit.id));
    },

    async createDraft(input) {
      const result = await corpusService.create({
        type: "task",
        title: input.title,
        content: input.content,
        extra: input.extra,
      });
      if (!result.ok) return result;
      return ok({ id: result.value.id });
    },

    async getResolution(id) {
      const docResult = await store.find(id);
      if (!docResult.ok) return docResult;
      const doc = docResult.value;
      if (doc === null) return ok(null);

      const edgesResult = await corpusService.getResolvesInEdgesForIssues([doc.id]);
      if (!edgesResult.ok) return edgesResult;
      const ctx = edgesResult.value.get(doc.id) ?? { resolvesInEdges: [], sourceDocs: [] };

      const factsResult = await deriveIssueFacts(doc, ctx);
      if (!factsResult.ok) return factsResult;
      return ok(factsResult.value);
    },

    async listIssueReports() {
      // Every task, EVERY status — not `status: "draft"` like
      // `listOpenAdhocDrafts`: a report archived upstream computes `closed`, and
      // narrowing to draft here would make `--all`/`--resolved` silently omit the
      // very rows those flags exist to show.
      const tasksResult = await store.findMany({ type: "task" });
      if (!tasksResult.ok) return tasksResult;
      const issueTasks = tasksResult.value.filter((task) => hasIssueReport(task.extra));
      if (issueTasks.length === 0) return ok([]);

      // ONE batched resolves-edge read for all N reports (`getResolvesInEdgesForIssues`
      // is D7's cross-doc read-orchestration locus for exactly this join), replacing
      // the N per-doc `CorpusService.get()` calls the pre-§M4 `commands/issues.ts`
      // made against its own corpus.
      const edgesResult = await corpusService.getResolvesInEdgesForIssues(issueTasks.map((t) => t.id));
      if (!edgesResult.ok) return edgesResult;

      const rows: UpstreamIssueReportRow[] = [];
      for (const task of issueTasks) {
        const ctx = edgesResult.value.get(task.id) ?? { resolvesInEdges: [], sourceDocs: [] };
        const factsResult = await deriveIssueFacts(task, ctx);
        if (!factsResult.ok) return factsResult;
        rows.push({
          id: task.id,
          slug: task.slug,
          title: task.title,
          extra: task.extra,
          ...factsResult.value,
        });
      }
      return ok(rows);
    },

    close() {
      store.close();
    },
  };

  return ok(port);
}
