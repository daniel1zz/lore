/**
 * IssueReportService — DI-only orchestrator behind `lore report-issue`
 * (SPEC-072). Runs the §5 fail-loud, cheapest-first check sequence over an
 * injected `IssueReportDeps` bundle: config presence → upstream's own
 * sync-mode constraint → schema-version match → upstream root-PRD identity
 * → per-reporter rate cap → advisory duplicate search → `createDraft` →
 * (only on success) local receipt append.
 *
 * Public surface:
 *   - `IssueReportService` — `report(input, cfg?)` / `list(cfg)`.
 *   - `IssueReportInput` / `IssueReportResult` / `ReceiptStatusRow` /
 *     `IssueReportDeps` — the DTOs this service's constructor and methods
 *     are typed against (SPEC-072 §4).
 *
 * Invariants:
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
 *     config (its `sync.enabled` flag) — distinct from `cfg`, which is the
 *     CONSUMER's `feedback.upstream.*` settings naming which upstream to
 *     talk to. Do not conflate the two: `cfg` says "where"; the loaded
 *     config says "is that place even a supported v1 target".
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
  OPEN_REPORT_CAP,
  UNKNOWN_CONTENDING_SOURCE,
  type DocStatus,
  type IssueReportPayload,
  type LoreConfig,
  type LoreError,
  type Result,
} from "@lore/core";
import type { UpstreamPort } from "../flows/upstream-context-flow.js";
import type { ReceiptEntry, ReceiptLog } from "./receipt-log.js";
import type { IssueResolution } from "./issue-resolution.js";

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
  /** Loads the UPSTREAM corpus's own `.lore/config.yaml` (its `sync.enabled` flag). */
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
   * @returns `ok({upstream_doc_id, possible_duplicates, dedup_degraded})` on
   *   success; `err(...)` on the first failing check (§5 table) — ZERO
   *   writes occur before `createDraft` succeeds
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
    const port = upstreamResult.value;

    try {
      // Step 6: rate cap (R-5d).
      const openDraftsResult = await port.listOpenAdhocDrafts();
      if (!openDraftsResult.ok) return openDraftsResult;
      const { open, ids } = countOpenReports(openDraftsResult.value, this.deps.reporterProject);
      if (open >= OPEN_REPORT_CAP) {
        return err({
          code: "VALIDATION_ERROR",
          field: "feedback.upstream",
          message:
            `reporter project '${this.deps.reporterProject}' already has ${open} open ` +
            `report(s) upstream (cap ${OPEN_REPORT_CAP}) — resolve or wait for review on: ${ids.join(", ")}`,
          value: ids,
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

    const port = upstreamResult.value;
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
   * @returns `ok(port)` on a fully-validated, OPEN upstream connection
   *   (caller MUST `port.close()` when done); `err(...)` naming the first
   *   failing rail
   */
  private async openValidatedUpstream(cfg: UpstreamCfg): Promise<Result<UpstreamPort, LoreError>> {
    // Step 3: upstream config sync.enabled === true (config check precedes probe).
    const upstreamConfigResult = this.deps.loadUpstreamConfig(cfg.corpus_path);
    if (!upstreamConfigResult.ok) return upstreamConfigResult;
    if (upstreamConfigResult.value.sync?.enabled === true) {
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

    return ok(port);
  }
}

/** Re-exported for callers that only need the receipt shape (CLI/MCP wiring). */
export type { ReceiptEntry };
