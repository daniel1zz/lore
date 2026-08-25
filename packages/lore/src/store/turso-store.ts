/**
 * TursoStore — @libsql/client implementation of StoreInterface.
 * Uses async @libsql/client.execute() for all operations.
 * Supports file-only mode (localPath) and embedded replica mode
 * (localPath + remoteUrl + authToken).
 *
 * FTS5 index: MIGRATION_001_SQL creates triggers (docs_ai/ad/au) that fire
 * automatically via libsql for INSERT, UPDATE, and DELETE operations on docs.
 * Verified by R1 spike (tests/unit/store/libsql-compat.bun.test.ts): triggers
 * are the sole FTS maintenance mechanism — no manual fts* calls needed.
 *
 * Source: SPEC-009 §3.1; AC-STORE-TURSO-001
 */

// reason: spec-eager-libsql-load-makes-every-command-depend-on-a-healthy —
// `createClient` is DELIBERATELY not imported as a value here (see
// `loadLibsqlClientModule` below). Only types are imported at the top level;
// types are fully erased at compile time, so this import has NO runtime
// effect and does not touch `@libsql/client`'s native binding.
import type { Client, InStatement, InValue, ResultSet, Row, Transaction } from "@libsql/client";
import { accessSync, constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";
import { MIGRATION_001_SQL } from "./migrations/migration-001.js";
import { MIGRATION_002_SQL } from "./migrations/migration-002.js";
import { MIGRATION_003_SQL } from "./migrations/migration-003.js";
import { MIGRATION_004_SQL } from "./migrations/migration-004.js";
import { MIGRATION_005_SQL } from "./migrations/migration-005.js";
import { MIGRATION_006_SQL } from "./migrations/migration-006.js";
import { MIGRATION_007_SQL } from "./migrations/migration-007.js";
import {
  MIGRATION_008_ADD_COLUMNS_SQL,
  MIGRATION_008_FTS_REBUILD_SQL,
} from "./migrations/migration-008.js";
import {
  MIGRATION_009_ADD_COLUMNS_SQL,
  MIGRATION_009_FINALIZE_SQL,
} from "./migrations/migration-009.js";
import { MIGRATION_010_SQL } from "./migrations/migration-010.js";
import { MIGRATION_011_SQL } from "./migrations/migration-011.js";
import { MIGRATION_012_SQL } from "./migrations/migration-012.js";
import type {
  AuditEntry,
  CalibrationRecord,
  DocId,
  DocRecord,
  DocType,
  LinkRecord,
  LinkType,
  OrdinalDocType,
  ReviewJudgment,
  ReviewJudgmentKind,
  Slug,
  VersionRecord,
} from "@lore/core";
import {
  err,
  ok,
  ORDINAL_REGISTERED_TYPES,
  SNIPPET_MARK_CLOSE,
  SNIPPET_MARK_OPEN,
  type LoreError,
  type Result,
} from "@lore/core";
import type {
  AuditChainEntry,
  AuditFilters,
  CalibrationRecordWithPromptVersion,
  CalibrationWindowFilter,
  NeverReadDoc,
  SearchHit,
  StoreFilters,
  StoreInterface,
  TraceDenyByCheckpoint,
  TraceEventInput,
  TraceGateDenyEvent,
  TraceRawSearchQuery,
  TraceStatsWindow,
  TraceZeroHitListOpts,
  TraceZeroHitSearch,
  UpdateOpts,
} from "./store-interface.js";
import {
  allocateWithBoundedRetry,
  computeAuditEntryHash,
  computeFtsShadowValues,
  detectParentCycleViaAncestry,
  escapeFtsQuery,
  isOrdinalUniqueViolationMessage,
  parseJson,
  rowToAuditChainEntry,
  rowToAuditEntry,
  rowToCalibrationRecordWithPromptVersion,
  rowToDocRecord,
  rowToLinkRecord,
  rowToReviewJudgment,
  rowToSearchHit,
  rowToVersionRecord,
  toStoreError,
  wrapStoreError,
  type AuditChainRow,
  type AuditRow,
  type CalibrationRowWithPromptVersion,
  type DocRow,
  type FtsRow,
  type JudgmentRow,
  type LinkRow,
  type VersionRow,
} from "./store-shared.js";

// ─── Deferred @libsql/client load (spec-eager-libsql-load-makes-every-command-depend-on-a-healthy) ──
//
// The embedded native `.node` binding must NOT be resolved merely by loading
// this module — only genuinely constructing a `TursoStore` (or a raw
// `createClient()` call elsewhere that reuses this loader) may trigger the
// unpack-then-dlopen a compiled `bun build --compile` binary performs.
//
// This is a LITERAL-SPECIFIER dynamic `import()`, never
// `createRequire(import.meta.url)("@libsql/client")`. `slugify-node.ts`'s
// pinyin-pro hotfix (SPEC-068, 2026-07-23) measured that a `createRequire`
// -based lazy require throws `Cannot find package '<name>'` from a compiled
// binary's virtual `$bunfs/root` filesystem when run OUTSIDE the source repo
// (no real `node_modules` to walk) — while a literal-specifier dynamic
// `import()` is discovered and bundled by `bun build --compile` the SAME way
// a static top-level import is, so it resolves correctly from any cwd, both
// in source mode and compiled. Do not "simplify" this to `createRequire`.
let cachedLibsqlModulePromise: Promise<typeof import("@libsql/client")> | null = null;

/**
 * Process-lifetime-cached loader — the dynamic import happens at most once.
 * Exported so `adapters/cli/commands/sync.ts` / `adapters/http/sync-push.ts`
 * (the other two `@libsql/client`-touching call sites, SPEC's Scope section)
 * reuse the SAME literal-specifier dynamic-import mechanism rather than each
 * re-declaring their own — they call `createClient` directly (no
 * `TursoStore`), never via a top-level value import.
 */
export function loadLibsqlClientModule(): Promise<typeof import("@libsql/client")> {
  if (cachedLibsqlModulePromise === null) {
    cachedLibsqlModulePromise = import("@libsql/client");
  }
  return cachedLibsqlModulePromise;
}

// reason: SYNCHRONOUS fallback — `createRequire`, ONLY safe from source mode
// (`bun test`/`bun run dev`, real `node_modules` reachable on disk). Empirically
// re-verified while building this fix: BOTH `createRequire(import.meta.url)
// ("@libsql/client")` and Bun's `import.meta.require("@libsql/client")` throw
// `Cannot find module '@libsql/client' from '/$bunfs/root/...'` when run from
// a `bun build --compile` binary — even from INSIDE the source repo, not only
// "outside" as SPEC-068's pinyin-pro precedent phrased it. ONLY a
// literal-specifier dynamic `import()` (`loadLibsqlClientModule` above)
// resolves correctly from a compiled binary.
//
// `TursoStore`'s constructor uses THIS synchronous fallback ONLY when no
// `injectedClient` is passed — which happens ONLY from `app.ts`'s createApp()
// Turso branch (createApp() must stay synchronous, cannot `await` the async
// loader above) and from bare test-fixture construction. Both are
// UNREACHABLE from a compiled `dist/lore` binary: `adapters/cli/loader.ts`
// strips `config.sync` unconditionally before calling `createApp`, so no CLI
// command can ever reach createApp's Turso branch (adapters/cli/CLAUDE.md).
// The ONE real compiled-binary-reachable caller of `new TursoStore(...)`
// (`adapters/cli/commands/sync.ts::performPull`) is ALREADY an async
// function — it pre-resolves the client via `loadLibsqlClientModule()` above
// and passes it in as `injectedClient`, so it never touches this fallback.
let cachedLibsqlModuleSync: typeof import("@libsql/client") | null = null;
function loadLibsqlClientModuleSync(): typeof import("@libsql/client") {
  if (cachedLibsqlModuleSync === null) {
    const req = createRequire(import.meta.url);
    cachedLibsqlModuleSync = req("@libsql/client") as typeof import("@libsql/client");
  }
  return cachedLibsqlModuleSync;
}

/**
 * Synchronously probes whether `TMPDIR` (when set) points at a writable
 * directory — the precondition a compiled binary needs before it can
 * unpack-then-dlopen `@libsql/client`'s embedded native module. Call this
 * AFTER credential validation and BEFORE the native load, at every call site
 * that is about to genuinely need libsql (`TursoStore` construction here, or
 * a raw `createClient()` call in `adapters/cli/commands/sync.ts` /
 * `adapters/http/sync-push.ts`) — AC-LL-4's pinned ordering.
 *
 * `TMPDIR` absent or empty is NOT a failure — bun falls back to the system
 * default tmpdir in that case (measured root cause, see the governing spec).
 * Deliberately does NOT rewrite `TMPDIR` on the caller's behalf (no silent
 * fallback, D-007's sibling invariant) — an unusable value is reported, never
 * repaired.
 *
 * @returns `null` when TMPDIR is absent, empty, or a writable directory;
 *   otherwise a `STORE_ERROR` `LoreError` whose message's FIRST LINE names
 *   `TMPDIR` and the offending value verbatim, followed by a remediation line
 *   containing the literal substring `export TMPDIR=` (AC-LL-4's four
 *   substring rules).
 */
export function probeTmpdirUsability(): LoreError | null {
  const tmpdir = process.env.TMPDIR;
  if (tmpdir === undefined || tmpdir === "") return null;
  try {
    accessSync(tmpdir, fsConstants.W_OK);
    return null;
  } catch {
    return {
      code: "STORE_ERROR",
      message:
        `TMPDIR is set to an unusable directory: ${tmpdir}\n` +
        "The Turso sync client needs to unpack a native module into a " +
        "writable TMPDIR before it can load.\n" +
        `Fix: export TMPDIR=/tmp   (or any writable directory you control), then retry.`,
    } satisfies LoreError;
  }
}

// ─── Config ────────────────────────────────────────────────────────────────

export interface TursoConfig {
  /** Local SQLite file path (used as `file:<localPath>` URL). */
  localPath: string;
  /** Remote Turso sync URL. When set, enables embedded replica mode. */
  remoteUrl?: string;
  /** Auth token for the remote Turso database. */
  authToken?: string;
  /** Sync interval in seconds for embedded replica. Defaults to 60. */
  syncInterval?: number;
}

/**
 * Pure helper — the `@libsql/client` `createClient()` options shape for a
 * given `TursoConfig`, extracted once so `TursoStore`'s own (source-mode-only)
 * synchronous fallback load AND `performPull`'s pre-resolved-client injection
 * path (`adapters/cli/commands/sync.ts`, the REAL compiled-binary-reachable
 * route) build the IDENTICAL options from ONE place, never duplicated.
 */
export function buildTursoClientConfig(
  config: TursoConfig,
): { url: string; syncUrl?: string; authToken?: string; syncInterval: number; readYourWrites: true } | { url: string } {
  const url = `file:${config.localPath}`;
  if (!config.remoteUrl) return { url };
  return {
    url,
    ...(config.remoteUrl !== undefined ? { syncUrl: config.remoteUrl } : {}),
    ...(config.authToken !== undefined ? { authToken: config.authToken } : {}),
    syncInterval: config.syncInterval ?? 60,
    readYourWrites: true,
  };
}

/**
 * The one statement-running capability both `Client` and `Transaction` expose,
 * so a helper can read through EITHER.
 *
 * ⛔ Structural on purpose, NOT `Pick<Client, "execute"> | Pick<Transaction,
 * "execute">`: `Client.execute` is OVERLOADED (`(stmt)` and `(sql, args)`)
 * while `Transaction.execute` has the single `(stmt: InStatement)` signature
 * (`@libsql/core/lib-esm/api.d.ts:85-86` vs `:284`), so a `Transaction` does
 * not satisfy `Pick<Client, "execute">` and a union of the two makes the call
 * site ambiguous. Both DO satisfy this single-signature shape.
 */
type SqlExecutor = { execute(stmt: InStatement): Promise<ResultSet> };

// ─── Row extraction helpers ────────────────────────────────────────────────
// libsql Row fields are accessed as row["field"] returning Value.
// Value = null | string | number | bigint | ArrayBuffer.
// These helpers safely extract typed values from libsql Row objects.
// This is the documented row-boundary guard — the only place `as` is used.

function rowStr(row: Row, col: string): string {
  const v = row[col];
  if (v === null || v === undefined) return "";
  return String(v);
}

function rowStrOrNull(row: Row, col: string): string | null {
  const v = row[col];
  if (v === null || v === undefined) return null;
  return String(v);
}

function rowNum(row: Row, col: string): number {
  const v = row[col];
  if (v === null || v === undefined) return 0;
  return Number(v);
}

/**
 * Like {@link rowNum} but for a nullable numeric column (e.g. `docs.ordinal`,
 * SPEC-084) — `null`/`undefined` map to `null`, NEVER `0` (a real ordinal
 * value), unlike {@link rowNum}'s "absent means 0" convention which is only
 * safe for columns where 0 isn't a legal value.
 */
function rowNumOrNull(row: Row, col: string): number | null {
  const v = row[col];
  if (v === null || v === undefined) return null;
  return Number(v);
}

/**
 * Convert a libsql Row (column-named access) to a DocRow-shaped plain object.
 * Row-boundary guard — this is the only `as`-cast site for libsql rows.
 */
function libsqlRowToDocRow(row: Row): DocRow {
  return {
    id: rowStr(row, "id"),
    slug: rowStr(row, "slug"),
    type: rowStr(row, "type"),
    role: rowStr(row, "role"),
    title: rowStr(row, "title"),
    status: rowStr(row, "status"),
    priority: rowStr(row, "priority"),
    content: rowStr(row, "content"),
    parent_id: rowStrOrNull(row, "parent_id"),
    extra: rowStr(row, "extra") || "{}",
    tags: rowStr(row, "tags") || "[]",
    version: rowNum(row, "version"),
    created_at: rowStr(row, "created_at"),
    updated_at: rowStr(row, "updated_at"),
    created_by: rowStr(row, "created_by"),
    deleted_at: rowStrOrNull(row, "deleted_at"),
    ordinal: rowNumOrNull(row, "ordinal"),
  };
}

function libsqlRowToLinkRow(row: Row): LinkRow {
  return {
    from_id: rowStr(row, "from_id"),
    to_id: rowStr(row, "to_id"),
    link_type: rowStr(row, "link_type"),
    created_at: rowStr(row, "created_at"),
    created_by: rowStr(row, "created_by"),
  };
}

function libsqlRowToVersionRow(row: Row): VersionRow {
  return {
    doc_id: rowStr(row, "doc_id"),
    version: rowNum(row, "version"),
    content: rowStr(row, "content"),
    extra: rowStr(row, "extra") || "{}",
    status: rowStr(row, "status"),
    title: rowStr(row, "title"),
    action: rowStr(row, "action"),
    created_at: rowStr(row, "created_at"),
    created_by: rowStr(row, "created_by"),
    change_summary: rowStrOrNull(row, "change_summary"),
    slug: rowStrOrNull(row, "slug"),
  };
}

function libsqlRowToAuditRow(row: Row): AuditRow {
  return {
    timestamp: rowStr(row, "timestamp"),
    actor: rowStr(row, "actor"),
    session_id: rowStr(row, "session_id"),
    action: rowStr(row, "action"),
    doc_id: rowStrOrNull(row, "doc_id"),
    details: rowStr(row, "details") || "{}",
  };
}

/**
 * `libsqlRowToAuditRow` plus the SPEC-079 G3 hash-chain columns (`id`,
 * `prev_hash`, `entry_hash`) — the libsql-row analog of {@link AuditChainRow}.
 */
function libsqlRowToAuditChainRow(row: Row): AuditChainRow {
  return {
    ...libsqlRowToAuditRow(row),
    id: rowNum(row, "id"),
    prev_hash: rowStrOrNull(row, "prev_hash"),
    entry_hash: rowStrOrNull(row, "entry_hash"),
  };
}

function libsqlRowToFtsRow(row: Row): FtsRow {
  return {
    id: rowStr(row, "id"),
    slug: rowStr(row, "slug"),
    title: rowStr(row, "title"),
    snippet: rowStr(row, "snippet"),
    rank: rowNum(row, "rank"),
    type: rowStr(row, "type"),
    status: rowStr(row, "status"),
    created_at: rowStr(row, "created_at"),
    extra: rowStr(row, "extra") || "{}",
  };
}

function libsqlRowToJudgmentRow(row: Row): JudgmentRow {
  return {
    id: rowStr(row, "id"),
    doc_id: rowStr(row, "doc_id"),
    doc_version: rowNum(row, "doc_version"),
    decision: rowStr(row, "decision"),
    confidence: rowNum(row, "confidence"),
    reasons: rowStr(row, "reasons") || "[]",
    checks: rowStr(row, "checks") || "[]",
    blocking_questions: rowStr(row, "blocking_questions") || "[]",
    judge_provider: rowStr(row, "judge_provider"),
    judge_model: rowStr(row, "judge_model"),
    judge_prompt_version: rowStr(row, "judge_prompt_version"),
    kind: rowStr(row, "kind") || "review",
    superseded_candidate: rowStrOrNull(row, "superseded_candidate"),
    created_at: rowStr(row, "created_at"),
    created_by: rowStr(row, "created_by"),
  };
}

/**
 * Maps a `calibration_records` ⋈ `review_judgments` row (queryCalibrationWindow's
 * now-unconditional join projects `judge_prompt_version` AND `judge_kind` onto every
 * row, SPEC-044 D12/AC-SP-11) to {@link CalibrationRowWithPromptVersion}.
 */
function libsqlRowToCalibrationRowWithPromptVersion(row: Row): CalibrationRowWithPromptVersion {
  return {
    id: rowStr(row, "id"),
    judgment_id: rowStr(row, "judgment_id"),
    doc_id: rowStr(row, "doc_id"),
    doc_type: rowStr(row, "doc_type"),
    human_outcome: rowStr(row, "human_outcome"),
    delta_reasons: rowStr(row, "delta_reasons") || "[]",
    actor: rowStr(row, "actor"),
    created_at: rowStr(row, "created_at"),
    judge_prompt_version: rowStr(row, "judge_prompt_version"),
    judge_kind: rowStr(row, "judge_kind") || "review",
  };
}

// ─── TursoStore ────────────────────────────────────────────────────────────

export class TursoStore implements StoreInterface {
  private readonly client: Client;
  private readonly hasRemote: boolean;

  /**
   * @param config - Local path + optional remote/auth/interval.
   * @param injectedClient - OPTIONAL pre-constructed `@libsql/client` `Client`
   *   (spec-eager-libsql-load-makes-every-command-depend-on-a-healthy). Pass
   *   this from any COMPILED-BINARY-REACHABLE call site — build it via
   *   `loadLibsqlClientModule()`'s literal-specifier dynamic import (already
   *   async there, e.g. `adapters/cli/commands/sync.ts::performPull`) BEFORE
   *   calling `new TursoStore(...)`, so this constructor never resolves
   *   `@libsql/client` itself for that path. Omitted by `app.ts`'s
   *   createApp() Turso branch (createApp() must stay synchronous — it
   *   cannot `await` the dynamic-import loader) and by bare test-fixture
   *   construction; both are UNREACHABLE from a compiled `dist/lore` binary
   *   (`adapters/cli/loader.ts` strips `config.sync` unconditionally before
   *   calling `createApp` — see that file's own comment / adapters/cli/
   *   CLAUDE.md), so the synchronous `createRequire` fallback below
   *   (`loadLibsqlClientModuleSync`) only ever runs under `bun test`/`bun run
   *   dev` (real `node_modules` reachable) — see that function's header for
   *   the empirical proof it fails from a compiled binary.
   */
  constructor(config: TursoConfig, injectedClient?: Client) {
    this.hasRemote = Boolean(config.remoteUrl);
    this.client =
      injectedClient !== undefined
        ? injectedClient
        : loadLibsqlClientModuleSync().createClient(buildTursoClientConfig(config));

    // Schema init is async; run eagerly in constructor.
    // The promise is stored in _schemaInitPromise so ensureReady() can await it
    // and propagate the rejection as a STORE_ERROR Result on the first operation.
    // We attach a no-op .catch() here to mark the promise as handled at the
    // Node/Bun level, preventing an unhandledRejection event if initSchema rejects
    // before any caller awaits ensureReady(). The rejection is NOT swallowed —
    // ensureReady() re-awaits the stored promise and still throws, which public
    // methods catch and convert to { ok: false, error: STORE_ERROR }.
    this.initSchema().catch(() => { /* rejection surfaced via ensureReady() on first operation */ });
  }

  // ── Initialization ─────────────────────────────────────────────────────

  private _schemaInitPromise: Promise<void> | null = null;

  private initSchema(): Promise<void> {
    if (this._schemaInitPromise) return this._schemaInitPromise;

    this._schemaInitPromise = (async () => {
      // Check current schema version
      const versionRs = await this.client.execute("PRAGMA user_version");
      const currentVersion = versionRs.rows[0]
        ? rowNum(versionRs.rows[0], "user_version")
        : 0;

      if (currentVersion < 1) {
        await this.client.executeMultiple(MIGRATION_001_SQL);
      }

      if (currentVersion < 2) {
        await this.client.executeMultiple(MIGRATION_002_SQL);
      }

      if (currentVersion < 3) {
        await this.client.executeMultiple(MIGRATION_003_SQL);
      }

      if (currentVersion < 4) {
        await this.client.executeMultiple(MIGRATION_004_SQL);
      }

      if (currentVersion < 5) {
        await this.client.executeMultiple(MIGRATION_005_SQL);
      }

      if (currentVersion < 6) {
        await this.client.executeMultiple(MIGRATION_006_SQL);
      }

      if (currentVersion < 7) {
        await this.client.executeMultiple(MIGRATION_007_SQL);
      }

      if (currentVersion < 8) {
        // reason: migration-008 is a THREE-PHASE sequence (ADD COLUMN → JS
        // per-row CJK bigram backfill → docs_fts drop/recreate + rebuild) —
        // see migration-008.ts's module JSDoc. Unlike migrations 001-007
        // (single self-contained `executeMultiple` call), the JS backfill
        // loop must run BETWEEN the two SQL phases and INSIDE the same
        // atomic unit as both — `client.transaction("write")` is the SAME
        // interactive-transaction API this file's `insertWithProvenance`/
        // `updateWithProvenance` already use (see this file's own "BUG-002"
        // section comment for why it was chosen over `batch`/a fallback: a
        // real `Transaction` object with execute/executeMultiple/commit/
        // rollback/close, no version-gap risk against the installed client).
        const tx = await this.client.transaction("write");
        try {
          await tx.executeMultiple(MIGRATION_008_ADD_COLUMNS_SQL);

          const rs = await tx.execute("SELECT id, title, content, tags FROM docs");
          for (const row of rs.rows) {
            const shadow = computeFtsShadowValues(
              rowStr(row, "title"),
              rowStr(row, "content"),
              rowStr(row, "tags"),
            );
            await tx.execute({
              sql: "UPDATE docs SET fts_title = ?, fts_content = ?, fts_tags = ? WHERE id = ?",
              args: [
                shadow.fts_title,
                shadow.fts_content,
                shadow.fts_tags,
                rowStr(row, "id"),
              ] as InValue[],
            });
          }

          await tx.executeMultiple(MIGRATION_008_FTS_REBUILD_SQL);
          await tx.commit();
        } catch (e) {
          try {
            await tx.rollback();
          } catch {
            // reason: rollback throws only when the transaction is already
            // closed — safe to ignore, `e` below is what the caller needs
            // (mirrors insertWithProvenance's identical rollback guard).
          }
          throw e;
        } finally {
          tx.close();
        }
      }

      if (currentVersion < 9) {
        // reason: migration-009 (SPEC-079 G3 audit hash chain) is a
        // THREE-PHASE sequence (ADD COLUMN → JS per-row hash-chain backfill
        // → PRAGMA user_version bump) for the identical reason migration-008
        // is — see migration-009.ts's module JSDoc. Same interactive
        // `client.transaction("write")` shape as migration-008's own block
        // above (a real Transaction with execute/executeMultiple/commit/
        // rollback/close).
        const tx = await this.client.transaction("write");
        try {
          await tx.executeMultiple(MIGRATION_009_ADD_COLUMNS_SQL);

          const rs = await tx.execute(
            "SELECT id, timestamp, actor, session_id, action, doc_id, details FROM audit ORDER BY id ASC",
          );
          // reason: threads a running prevHash through the whole legacy
          // table in id ASC order — the SAME chain-construction order every
          // future appendAuditEntryTx extends (see migration-009.ts's
          // module JSDoc). Genesis prevHash is "" for the table's very
          // first row (or the whole loop is a no-op on an empty table).
          let prevHash = "";
          for (const row of rs.rows) {
            const docId = rowStrOrNull(row, "doc_id");
            const entry: AuditEntry = {
              timestamp: rowStr(row, "timestamp"),
              actor: rowStr(row, "actor"),
              session_id: rowStr(row, "session_id"),
              action: rowStr(row, "action"),
              ...(docId !== null ? { doc_id: docId } : {}),
              details: parseJson<Record<string, unknown>>(rowStr(row, "details") || "{}", {}),
            };
            const entryHash = computeAuditEntryHash(entry, prevHash);
            await tx.execute({
              sql: "UPDATE audit SET prev_hash = ?, entry_hash = ? WHERE id = ?",
              args: [prevHash, entryHash, rowNum(row, "id")] as InValue[],
            });
            prevHash = entryHash;
          }

          await tx.executeMultiple(MIGRATION_009_FINALIZE_SQL);
          await tx.commit();
        } catch (e) {
          try {
            await tx.rollback();
          } catch {
            // reason: rollback throws only when the transaction is already
            // closed — safe to ignore, `e` below is what the caller needs
            // (mirrors migration-008's identical rollback guard).
          }
          throw e;
        } finally {
          tx.close();
        }
      }

      if (currentVersion < 10) {
        // reason: migration-010 (SPEC-084 docs.ordinal + partial unique
        // index) is a SINGLE self-contained SQL string (mirrors
        // migration-007's shape) — no JS-level backfill loop needed (zero
        // backfill of existing rows, D2 precedent), so a plain
        // `executeMultiple` call is sufficient, unlike migrations 008/009's
        // interactive-transaction three-phase sequences above.
        await this.client.executeMultiple(MIGRATION_010_SQL);
      }

      if (currentVersion < 11) {
        // reason: migration-011 (trace_events + its four indexes, SPEC-102)
        // is pure additive `CREATE TABLE/INDEX IF NOT EXISTS` — mirrors
        // migration-001..003/010's single self-contained `executeMultiple`
        // shape, no interactive transaction needed. Note: TursoStore's own
        // remote/replica connection is NEVER where trace writes land
        // (SPEC-102 D3) — `app.ts`'s composition root opens a SEPARATE local
        // `bun:sqlite` handle on this store's replica FILE for trace reads/
        // writes, so this table exists locally on the replica but this
        // migration path (running against `this.client`) applying it here
        // too is harmless idempotent schema parity, never a write path any
        // TraceRecorder actually uses.
        await this.client.executeMultiple(MIGRATION_011_SQL);
      }

      if (currentVersion < 12) {
        // reason: migration-012 (widen links.link_type CHECK to accept
        // "resolves") is a `links` table-recreate, same shape as
        // migration-004's "governs" widening — `executeMultiple` is
        // sufficient (libsql's embedded-replica client auto-rollbacks a
        // mid-string throw, see migration-004.ts's own @invariant), no
        // interactive transaction needed.
        await this.client.executeMultiple(MIGRATION_012_SQL);
      }
    })();

    return this._schemaInitPromise;
  }

  /** Ensure schema is initialized before any operation. */
  private async ensureReady(): Promise<void> {
    await this.initSchema();
  }

  // ── Document CRUD ─────────────────────────────────────────────────────

  /**
   * Id of the doc that ALREADY holds `slug`, or `null` when no row does.
   *
   * ⛔ Deliberately does NOT filter `deleted_at`: `docs.slug` is UNIQUE at the
   * COLUMN level (`migrations/migration-006.ts:103`), not a partial index over
   * live rows, so a soft-deleted row still holds its slug and still raises the
   * violation. Adding `WHERE deleted_at IS NULL` would make this return `null`
   * while the INSERT is still refused. Byte-for-byte the same SELECT
   * `SQLiteStore.findSlugConflictIdSync` issues; `InMemoryStore.
   * findSlugConflict` scans its Map with the same (unfiltered) semantics.
   *
   * @param executor - `this.client`, or the STILL-OPEN transaction whose
   *   INSERT was just refused. It is the caller's job to pass a transaction
   *   only while it is open: `insertWithProvenance` rolls back BEFORE it
   *   inspects the error, so it passes `this.client` (the winning row is
   *   committed data from another writer, so a fresh read sees it), whereas
   *   `insertWithAllocatedOrdinal*`'s retry closure runs inside the live
   *   transaction and passes that, which reads the exact snapshot the UNIQUE
   *   index arbitrated against.
   */
  private async findSlugConflictId(
    executor: SqlExecutor,
    slug: Slug,
  ): Promise<DocId | null> {
    const rs = await executor.execute({
      sql: "SELECT id FROM docs WHERE slug = ?",
      args: [slug] as InValue[],
    });
    const row = rs.rows[0];
    return row === undefined ? null : (rowStr(row, "id") as DocId);
  }

  /**
   * The ONE DUPLICATE_SLUG construction site in this file — all four insert
   * entry points (`insert`, `insertWithAllocatedOrdinal`,
   * `insertWithProvenance`, `insertWithAllocatedOrdinalAndProvenance`) funnel
   * their `UNIQUE constraint failed: docs.slug` branch through here.
   *
   * Before task-skill-implement-duplicate-slug-existing-id-names-the each of
   * those four sites inlined `existing_id: doc.id` — the id of the doc the
   * UNIQUE constraint had just REJECTED and which was therefore never
   * persisted, so `corpusService.get(error.existing_id)` answered
   * DOC_NOT_FOUND every time. `existing_id` now carries the id of the doc that
   * actually holds the slug, resolved by {@link findSlugConflictId}.
   *
   * ⛔ Returns a STORE_ERROR, not a DUPLICATE_SLUG, when the lookup finds
   * nothing: the UNIQUE index refused the INSERT, so a row held the slug at
   * that instant, and finding none now means a concurrent writer removed or
   * renamed it. `existing_id` is typed non-optional
   * (`packages/core/src/errors.ts:15`), so that state cannot be reported
   * honestly under DUPLICATE_SLUG — and falling back to `doc.id` is precisely
   * the false label this helper exists to end.
   *
   * @param executor - see {@link findSlugConflictId}'s `executor` contract.
   * @param cause - the driver error whose message identified the violation.
   */
  private async getDuplicateSlugErrorFor(
    executor: SqlExecutor,
    slug: Slug,
    cause: unknown,
  ): Promise<LoreError> {
    const winnerId = await this.findSlugConflictId(executor, slug);
    if (winnerId === null) {
      return {
        code: "STORE_ERROR",
        message:
          `slug '${slug}' was refused by the docs.slug UNIQUE constraint, but no row holds it ` +
          `now — its holder was removed or renamed concurrently between the refusal and ` +
          `TursoStore.findSlugConflictId's lookup. Retry the insert.`,
        // `exactOptionalPropertyTypes` — `cause` is `cause?: Error`, so a
        // non-Error throw must OMIT the key rather than set it undefined.
        ...(cause instanceof Error ? { cause } : {}),
      };
    }
    return { code: "DUPLICATE_SLUG", slug, existing_id: winnerId };
  }

  async insert(doc: DocRecord): Promise<Result<DocRecord, LoreError>> {
    try {
      await this.ensureReady();

      const tagsJson = JSON.stringify(doc.tags);
      // reason: fts_title/fts_content/fts_tags (migration-008) are the CJK
      // bigram shadow columns docs_fts actually indexes — every INSERT MUST
      // compute and persist them, mirroring SQLiteStore.insertDocSync.
      const shadow = computeFtsShadowValues(doc.title, doc.content, tagsJson);
      await this.client.execute({
        sql: `INSERT INTO docs
               (id, slug, type, role, title, status, priority, content,
                parent_id, extra, tags, version, created_at, updated_at,
                created_by, deleted_at, fts_title, fts_content, fts_tags, ordinal)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          doc.id,
          doc.slug,
          doc.type,
          doc.role,
          doc.title,
          doc.status,
          doc.priority,
          doc.content,
          doc.parent_id ?? null,
          JSON.stringify(doc.extra),
          tagsJson,
          doc.version,
          doc.created_at,
          doc.updated_at,
          doc.created_by,
          doc.deleted_at ?? null,
          shadow.fts_title,
          shadow.fts_content,
          shadow.fts_tags,
          doc.ordinal ?? null,
        ] as InValue[],
      });

      return ok(doc);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("UNIQUE constraint failed: docs.slug")) {
        // No transaction here — `insert` writes through `this.client` — so the
        // conflict lookup reads through the same client.
        return err(await this.getDuplicateSlugErrorFor(this.client, doc.slug, e));
      }
      // Duplicate PK also returns err (not throw)
      if (msg.includes("UNIQUE constraint failed: docs.id")) {
        return wrapStoreError(e);
      }
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.insertWithAllocatedOrdinal
   * MAX+1 computed once via the SAME interactive `client.transaction("write")`
   * shape `insertWithProvenance` uses, then delegated to the shared
   * {@link allocateWithBoundedRetry} seam (`store-shared.ts`) for the
   * bounded-attempt/exhaustion mechanics.
   */
  async insertWithAllocatedOrdinal(doc: DocRecord): Promise<Result<DocRecord, LoreError>> {
    await this.ensureReady();
    const tx = await this.client.transaction("write");
    try {
      const maxRs = await tx.execute({
        sql: "SELECT MAX(ordinal) as maxOrdinal FROM docs WHERE type = ?",
        args: [doc.type] as InValue[],
      });
      const maxRow = maxRs.rows[0];
      const base = maxRow ? rowNumOrNull(maxRow, "maxOrdinal") ?? 0 : 0;

      const tagsJson = JSON.stringify(doc.tags);
      const shadow = computeFtsShadowValues(doc.title, doc.content, tagsJson);

      const result = await allocateWithBoundedRetry<DocRecord>(base, doc.type, async (candidate) => {
        try {
          await tx.execute({
            sql: `INSERT INTO docs
                   (id, slug, type, role, title, status, priority, content,
                    parent_id, extra, tags, version, created_at, updated_at,
                    created_by, deleted_at, fts_title, fts_content, fts_tags, ordinal)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              doc.id,
              doc.slug,
              doc.type,
              doc.role,
              doc.title,
              doc.status,
              doc.priority,
              doc.content,
              doc.parent_id ?? null,
              JSON.stringify(doc.extra),
              tagsJson,
              doc.version,
              doc.created_at,
              doc.updated_at,
              doc.created_by,
              doc.deleted_at ?? null,
              shadow.fts_title,
              shadow.fts_content,
              shadow.fts_tags,
              candidate,
            ] as InValue[],
          });
          return { kind: "success", value: { ...doc, ordinal: candidate } };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (msg.includes("UNIQUE constraint failed: docs.slug")) {
            // `tx` is still OPEN here — the rollback below runs only after
            // this closure returns — so the conflict lookup reads the exact
            // snapshot the UNIQUE index arbitrated against. A failed
            // statement does not roll back or close a libsql transaction —
            // "the transaction is not rolled back" / "the transaction won't be
            // rolled back", `@libsql/core/lib-esm/api.d.ts:288` and `:293-294`
            // — so `tx` is still usable for this read.
            return { kind: "error", error: await this.getDuplicateSlugErrorFor(tx, doc.slug, e) };
          }
          if (isOrdinalUniqueViolationMessage(msg)) {
            return { kind: "collision" };
          }
          return { kind: "error", error: toStoreError(e) };
        }
      });

      if (result.ok) {
        await tx.commit();
      } else {
        await tx.rollback();
      }
      return result;
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: rollback throws only when the transaction is already
        // closed — safe to ignore (mirrors insertWithProvenance's guard).
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  /**
   * @see StoreInterface.allocateOrdinalForExisting
   * UPDATE-scoped sibling — refuses a row that already carries an ordinal
   * (checked before the CAS comparison), then delegates to the SAME shared
   * {@link allocateWithBoundedRetry} seam via a conditional UPDATE.
   */
  async allocateOrdinalForExisting(
    id: DocId,
    expectedVersion: number,
  ): Promise<Result<DocRecord, LoreError>> {
    await this.ensureReady();
    const tx = await this.client.transaction("write");
    try {
      const existingRs = await tx.execute({
        sql: "SELECT * FROM docs WHERE id = ?",
        args: [id],
      });
      const existingRow = existingRs.rows[0];
      if (!existingRow) {
        await tx.rollback();
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const current = rowToDocRecord(libsqlRowToDocRow(existingRow));
      if (current.ordinal !== null && current.ordinal !== undefined) {
        await tx.rollback();
        return err({
          code: "STORE_ERROR",
          message: `doc ${id} already carries ordinal ${current.ordinal}; allocateOrdinalForExisting refuses to overwrite an already-allocated ordinal`,
        });
      }
      if (current.version !== expectedVersion) {
        await tx.rollback();
        return err({
          code: "STALE_VERSION",
          id,
          expected: expectedVersion,
          actual: current.version,
        });
      }

      const maxRs = await tx.execute({
        sql: "SELECT MAX(ordinal) as maxOrdinal FROM docs WHERE type = ?",
        args: [current.type] as InValue[],
      });
      const maxRow = maxRs.rows[0];
      const base = maxRow ? rowNumOrNull(maxRow, "maxOrdinal") ?? 0 : 0;
      const newVersion = expectedVersion + 1;

      const result = await allocateWithBoundedRetry<DocRecord>(
        base,
        current.type,
        async (candidate) => {
          try {
            const updateRs = await tx.execute({
              sql: "UPDATE docs SET ordinal = ?, version = ? WHERE id = ? AND version = ? AND ordinal IS NULL",
              args: [candidate, newVersion, id, expectedVersion] as InValue[],
            });
            if (updateRs.rowsAffected > 0) {
              return {
                kind: "success",
                value: { ...current, ordinal: candidate, version: newVersion },
              };
            }
            return {
              kind: "error",
              error: { code: "STALE_VERSION", id, expected: expectedVersion, actual: current.version },
            };
          } catch (e) {
            const msg = e instanceof Error ? e.message : "";
            if (isOrdinalUniqueViolationMessage(msg)) {
              return { kind: "collision" };
            }
            return { kind: "error", error: toStoreError(e) };
          }
        },
      );

      if (result.ok) {
        await tx.commit();
      } else {
        await tx.rollback();
      }
      return result;
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: rollback throws only when the transaction is already
        // closed — safe to ignore (mirrors insertWithAllocatedOrdinal's guard).
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  /**
   * @see StoreInterface.assignOrdinalForRepair
   *
   * SPEC-084 D7's internal repair-migration path — a DIRECT UPDATE-scoped
   * assignment of the caller-computed target, never a `MAX(ordinal)+1`
   * allocation. No {@link allocateWithBoundedRetry} involvement: a genuine
   * `(type, ordinal)` UNIQUE violation on the target propagates loud and
   * immediate (the migration's own bookkeeping computed this target to be
   * free — a collision here means ITS plan is wrong, not a transient race).
   */
  async assignOrdinalForRepair(id: DocId, ordinal: number): Promise<Result<DocRecord, LoreError>> {
    await this.ensureReady();
    const tx = await this.client.transaction("write");
    try {
      const existingRs = await tx.execute({
        sql: "SELECT * FROM docs WHERE id = ?",
        args: [id],
      });
      const existingRow = existingRs.rows[0];
      if (!existingRow) {
        await tx.rollback();
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const current = rowToDocRecord(libsqlRowToDocRow(existingRow));

      if (!ORDINAL_REGISTERED_TYPES.includes(current.type as OrdinalDocType)) {
        await tx.rollback();
        return err({
          code: "STORE_ERROR",
          message: `assignOrdinalForRepair refuses doc ${id}: type "${current.type}" is not an ordinal-registered type`,
        });
      }

      if (current.ordinal !== null && current.ordinal !== undefined) {
        if (current.ordinal === ordinal) {
          // Idempotent no-op — a repeat repair call at the SAME target
          // succeeds without touching the row.
          await tx.rollback();
          return ok(current);
        }
        await tx.rollback();
        return err({
          code: "STORE_ERROR",
          message: `doc ${id} already carries ordinal ${current.ordinal}; assignOrdinalForRepair refuses to overwrite it with a DIFFERENT value ${ordinal}`,
        });
      }

      const newVersion = current.version + 1;
      try {
        await tx.execute({
          sql: "UPDATE docs SET ordinal = ?, version = ? WHERE id = ? AND ordinal IS NULL",
          args: [ordinal, newVersion, id] as InValue[],
        });
      } catch (e) {
        await tx.rollback();
        return wrapStoreError(e);
      }

      await tx.commit();
      return ok({ ...current, ordinal, version: newVersion });
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: rollback throws only when the transaction is already
        // closed — safe to ignore (mirrors allocateOrdinalForExisting's guard).
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  /**
   * @see StoreInterface.findByTypeOrdinal
   * Direct-address lookup — does NOT filter soft-deleted (mirrors `find`).
   */
  async findByTypeOrdinal(
    type: DocType,
    ordinal: number,
  ): Promise<Result<DocRecord | null, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT * FROM docs WHERE type = ? AND ordinal = ?",
        args: [type, ordinal] as InValue[],
      });
      const row = rs.rows[0];
      return ok(row ? rowToDocRecord(libsqlRowToDocRow(row)) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async find(id: DocId): Promise<Result<DocRecord | null, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT * FROM docs WHERE id = ?",
        args: [id],
      });
      const row = rs.rows[0];
      return ok(row ? rowToDocRecord(libsqlRowToDocRow(row)) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findBySlug(slug: Slug): Promise<Result<DocRecord | null, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT * FROM docs WHERE slug = ?",
        args: [slug],
      });
      const row = rs.rows[0];
      return ok(row ? rowToDocRecord(libsqlRowToDocRow(row)) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.findByIdPrefix
   * libSQL is SQLite-wire-compatible — `LIKE` is case-insensitive for ASCII
   * by the same default, so no `UPPER()` normalization is needed here either
   * (mirrors SQLiteStore's identical implementation note).
   */
  async findByIdPrefix(prefix: string): Promise<Result<DocRecord[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT * FROM docs WHERE id LIKE ? AND deleted_at IS NULL",
        args: [`${prefix}%`],
      });
      return ok(rs.rows.map((row) => rowToDocRecord(libsqlRowToDocRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findByIds(ids: DocId[]): Promise<Result<Map<DocId, DocRecord>, LoreError>> {
    const byId = new Map<DocId, DocRecord>();
    if (ids.length === 0) return ok(byId);
    try {
      await this.ensureReady();
      const placeholders = ids.map(() => "?").join(", ");
      const rs = await this.client.execute({
        sql: `SELECT * FROM docs WHERE id IN (${placeholders})`,
        args: [...(ids as InValue[])],
      });
      for (const row of rs.rows) {
        const doc = rowToDocRecord(libsqlRowToDocRow(row));
        byId.set(doc.id, doc);
      }
      return ok(byId);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>> {
    try {
      await this.ensureReady();

      const clauses: string[] = [];
      const params: InValue[] = [];
      const excludeDeleted = filters.exclude_deleted !== false;
      const hasTagsFilter = filters.tags !== undefined && filters.tags.length > 0;

      if (excludeDeleted) {
        clauses.push("deleted_at IS NULL");
      }
      if (filters.type !== undefined) {
        clauses.push("type = ?");
        params.push(filters.type);
      }
      if (filters.status !== undefined) {
        clauses.push("status = ?");
        params.push(filters.status);
      }
      if (filters.parent_id !== undefined) {
        clauses.push("parent_id = ?");
        params.push(filters.parent_id);
      }
      if (filters.created_by !== undefined) {
        clauses.push("created_by = ?");
        params.push(filters.created_by);
      }
      if (filters.since !== undefined) {
        clauses.push("updated_at >= ?");
        params.push(filters.since);
      }
      // reason: mirrors SQLiteStore.findMany's identical json_extract predicate —
      // `sub_type` lives in the `extra` JSON column but belongs in the SQL WHERE
      // clause (NOT the in-memory `tags` pass below), because it must narrow the
      // row set BEFORE LIMIT/OFFSET binds the page window. Bound, never
      // interpolated. See StoreFilters.sub_type.
      if (filters.sub_type !== undefined) {
        clauses.push("json_extract(extra, '$.sub_type') = ?");
        params.push(filters.sub_type);
      }

      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

      // reason: mirrors SQLiteStore.findMany's identical `hasTagsFilter` guard
      // — `tags` is filtered IN-MEMORY below (JSON-stored column, no SQL
      // index), so pushing LIMIT/OFFSET into SQL while a tags filter is
      // active would apply the page boundary BEFORE the tags filter narrows
      // the row set. Only push LIMIT/OFFSET into SQL when the WHERE clause
      // alone determines row membership.
      const limitParts: string[] = [];
      if (!hasTagsFilter) {
        if (filters.limit !== undefined) {
          limitParts.push("LIMIT ?");
          params.push(filters.limit);
        } else if (filters.offset !== undefined) {
          // reason: SQLite/libsql requires a LIMIT to use OFFSET; -1 means
          // "no limit" (offset-only paging).
          limitParts.push("LIMIT -1");
        }
        if (filters.offset !== undefined) {
          limitParts.push("OFFSET ?");
          params.push(filters.offset);
        }
      }
      const limitClause = limitParts.join(" ");

      const sql = `SELECT * FROM docs ${whereClause} ORDER BY updated_at DESC, id ASC ${limitClause}`;

      const rs = await this.client.execute({ sql, args: params });
      let records = rs.rows.map((row) => rowToDocRecord(libsqlRowToDocRow(row)));

      // tags filter applied in-memory (JSON stored as string)
      if (hasTagsFilter) {
        const requiredTags = filters.tags as string[];
        records = records.filter((doc) =>
          requiredTags.every((tag) => doc.tags.includes(tag)),
        );
        // Paging deferred until after the tags filter narrows the set (see
        // the `hasTagsFilter` reason: comment above).
        if (filters.limit !== undefined || filters.offset !== undefined) {
          const offset = filters.offset ?? 0;
          records =
            filters.limit !== undefined
              ? records.slice(offset, offset + filters.limit)
              : records.slice(offset);
        }
      }

      return ok(records);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * Apply a partial patch to an existing doc.
   * When opts.expected_version is provided, performs a conditional UPDATE
   * (AND version = ?). Zero changes → DOC_NOT_FOUND or STALE_VERSION.
   * Manually updates FTS5 index on content changes.
   */
  async update(
    id: DocId,
    patch: Partial<DocRecord>,
    opts?: UpdateOpts,
  ): Promise<Result<DocRecord, LoreError>> {
    try {
      await this.ensureReady();

      // Fetch existing row first (needed for merge + NOT FOUND check)
      const existingRs = await this.client.execute({
        sql: "SELECT * FROM docs WHERE id = ?",
        args: [id],
      });
      const existingRow = existingRs.rows[0];

      if (!existingRow) {
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const current = rowToDocRecord(libsqlRowToDocRow(existingRow));
      const updated: DocRecord = {
        ...current,
        ...patch,
        id: current.id, // id is immutable
      };
      const updatedTagsJson = JSON.stringify(updated.tags);
      // reason: same shadow-column obligation as insert() — an UPDATE that
      // skips this leaves fts_title/fts_content/fts_tags reflecting the
      // PRE-patch text (mirrors SQLiteStore.updateDocSync).
      const shadow = computeFtsShadowValues(updated.title, updated.content, updatedTagsJson);

      if (opts?.expected_version !== undefined) {
        // Conditional UPDATE: WHERE id = ? AND version = ?
        const updateRs = await this.client.execute({
          sql: `UPDATE docs SET
                 slug = ?, type = ?, role = ?, title = ?, status = ?,
                 priority = ?, content = ?, parent_id = ?, extra = ?,
                 tags = ?, version = ?, created_at = ?, updated_at = ?,
                 created_by = ?, deleted_at = ?, fts_title = ?, fts_content = ?,
                 fts_tags = ?
               WHERE id = ? AND version = ?`,
          args: [
            updated.slug,
            updated.type,
            updated.role,
            updated.title,
            updated.status,
            updated.priority,
            updated.content,
            updated.parent_id ?? null,
            JSON.stringify(updated.extra),
            updatedTagsJson,
            updated.version,
            updated.created_at,
            updated.updated_at,
            updated.created_by,
            updated.deleted_at ?? null,
            shadow.fts_title,
            shadow.fts_content,
            shadow.fts_tags,
            id,
            opts.expected_version,
          ] as InValue[],
        });

        if (updateRs.rowsAffected === 0) {
          // Row exists (checked above) but version didn't match — re-read actual
          const actualRs = await this.client.execute({
            sql: "SELECT version FROM docs WHERE id = ?",
            args: [id],
          });
          const actualRow = actualRs.rows[0];

          if (!actualRow) {
            // Deleted between our SELECT and UPDATE (race)
            return err({ code: "DOC_NOT_FOUND", id });
          }

          return err({
            code: "STALE_VERSION",
            id,
            expected: opts.expected_version,
            actual: rowNum(actualRow, "version"),
          });
        }

        return ok(updated);
      }

      // Unconditional UPDATE — backward-compatible path
      await this.client.execute({
        sql: `UPDATE docs SET
               slug = ?, type = ?, role = ?, title = ?, status = ?,
               priority = ?, content = ?, parent_id = ?, extra = ?,
               tags = ?, version = ?, created_at = ?, updated_at = ?,
               created_by = ?, deleted_at = ?, fts_title = ?, fts_content = ?,
               fts_tags = ?
             WHERE id = ?`,
        args: [
          updated.slug,
          updated.type,
          updated.role,
          updated.title,
          updated.status,
          updated.priority,
          updated.content,
          updated.parent_id ?? null,
          JSON.stringify(updated.extra),
          updatedTagsJson,
          updated.version,
          updated.created_at,
          updated.updated_at,
          updated.created_by,
          updated.deleted_at ?? null,
          shadow.fts_title,
          shadow.fts_content,
          shadow.fts_tags,
          id,
        ] as InValue[],
      });

      return ok(updated);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async softDelete(id: DocId): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();

      const existingRs = await this.client.execute({
        sql: "SELECT id FROM docs WHERE id = ?",
        args: [id],
      });

      if (!existingRs.rows[0]) {
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const now = new Date().toISOString();
      await this.client.execute({
        sql: "UPDATE docs SET deleted_at = ? WHERE id = ?",
        args: [now, id],
      });

      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * SPEC-079 G3 — the async-transaction analog of SQLiteStore's synchronous
   * `appendAuditEntrySync`: reads the current chain head (`entry_hash` of
   * the highest-`id` row, or `""` if the table is empty) via `tx`, computes
   * this entry's `entry_hash` (`computeAuditEntryHash`), and inserts the
   * chained row — all through the SAME already-open `tx`. MUST be called
   * with a transaction already open (either `appendAuditEntry`'s own
   * standalone wrapper below, or the outer transaction one of the three
   * `*WithProvenance` methods already holds) so the head-read and insert are
   * atomic against a concurrent writer's OWN transaction (libsql's
   * `"write"` transaction mode serializes concurrent writers at the
   * client/connection level — a second `transaction("write")` blocks until
   * this one commits or rolls back). Throws on failure like every other
   * `tx.execute` call in this file — callers already wrap this in their own
   * try/catch with a rollback-on-catch.
   */
  private async appendAuditEntryTx(tx: Transaction, entry: AuditEntry): Promise<void> {
    const headRs = await tx.execute("SELECT entry_hash FROM audit ORDER BY id DESC LIMIT 1");
    const headRow = headRs.rows[0];
    const prevHash = headRow ? (rowStrOrNull(headRow, "entry_hash") ?? "") : "";
    const entryHash = computeAuditEntryHash(entry, prevHash);
    await tx.execute({
      sql: `INSERT INTO audit
             (timestamp, actor, session_id, action, doc_id, details, prev_hash, entry_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.timestamp,
        entry.actor,
        entry.session_id,
        entry.action,
        entry.doc_id ?? null,
        JSON.stringify(entry.details ?? {}),
        prevHash,
        entryHash,
      ] as InValue[],
    });
  }

  // ── Provenance-atomic composite writes (BUG-002) ─────────────────────────
  //
  // Unlike SQLiteStore (BEGIN IMMEDIATE/COMMIT/ROLLBACK strings run through
  // db.exec), @libsql/client exposes a real interactive Transaction object
  // (`client.transaction("write")` → BEGIN IMMEDIATE under the hood — see
  // @libsql/core's transactionModeToBegin) with its own execute/commit/
  // rollback/close — no @libsql/client version gap or missing-API fallback
  // was needed; researched against the installed 0.17.3 client's
  // lib-esm/sqlite3.d.ts + sqlite3.js before choosing this approach over a
  // "loud-partial" degrade (BUG-002 AC-1's escape hatch, not needed here).
  // `tx.close()` is idempotent (a no-op once `commit`/`rollback` already ran
  // — verified against the client's own `close()` impl, which checks
  // `database.inTransaction`), so it is always safe in a `finally`.

  /**
   * @see StoreInterface.insertWithProvenance
   */
  async insertWithProvenance(
    doc: DocRecord,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    await this.ensureReady();
    const tx = await this.client.transaction("write");
    try {
      const tagsJson = JSON.stringify(doc.tags);
      // reason: same shadow-column obligation as insert() — mirrors
      // SQLiteStore.insertDocSync (insertWithProvenance there also delegates
      // to the same private sync helper insert() uses).
      const shadow = computeFtsShadowValues(doc.title, doc.content, tagsJson);
      await tx.execute({
        sql: `INSERT INTO docs
               (id, slug, type, role, title, status, priority, content,
                parent_id, extra, tags, version, created_at, updated_at,
                created_by, deleted_at, fts_title, fts_content, fts_tags)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          doc.id,
          doc.slug,
          doc.type,
          doc.role,
          doc.title,
          doc.status,
          doc.priority,
          doc.content,
          doc.parent_id ?? null,
          JSON.stringify(doc.extra),
          tagsJson,
          doc.version,
          doc.created_at,
          doc.updated_at,
          doc.created_by,
          doc.deleted_at ?? null,
          shadow.fts_title,
          shadow.fts_content,
          shadow.fts_tags,
        ] as InValue[],
      });

      await tx.execute({
        sql: `INSERT INTO versions
               (doc_id, version, content, extra, status, title,
                action, created_at, created_by, change_summary, slug)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          version.doc_id,
          version.version,
          version.content,
          JSON.stringify(version.extra),
          version.status,
          version.title,
          version.action,
          version.created_at,
          version.created_by,
          version.change_summary ?? null,
          version.slug ?? null,
        ] as InValue[],
      });

      await this.appendAuditEntryTx(tx, audit);

      await tx.commit();
      return ok(doc);
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: rollback throws only when the transaction is already
        // closed (e.g. a prior commit/rollback already ran) — safe to
        // ignore, `e` below is what the caller needs.
      }
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("UNIQUE constraint failed: docs.slug")) {
        // ⛔ `this.client`, NOT `tx`: the rollback above already ran and the
        // `finally` below closes the transaction, so `tx` is unusable by the
        // time the error is inspected. Reading through the client is correct
        // regardless — the row holding the slug is committed data written by
        // another writer (this transaction inserted `doc` exactly once, so it
        // cannot be conflicting with itself).
        return err(await this.getDuplicateSlugErrorFor(this.client, doc.slug, e));
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  /**
   * @see StoreInterface.insertWithAllocatedOrdinalAndProvenance
   *
   * Combines {@link insertWithAllocatedOrdinal}'s MAX+1/bounded-retry
   * allocation with {@link insertWithProvenance}'s doc+version+audit
   * atomicity — ONE interactive `client.transaction("write")` wraps the MAX
   * query, the bounded-retry insert loop, and the subsequent version/audit
   * inserts. A version or audit failure rolls back the WHOLE transaction,
   * including the just-succeeded ordinal-numbered doc insert — the ordinal
   * candidate is therefore never burned (a retry of this same call
   * recomputes the identical `MAX(ordinal)+1`, since the rolled-back row
   * never raised that type's MAX).
   */
  async insertWithAllocatedOrdinalAndProvenance(
    doc: DocRecord,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    await this.ensureReady();
    const tx = await this.client.transaction("write");
    try {
      const maxRs = await tx.execute({
        sql: "SELECT MAX(ordinal) as maxOrdinal FROM docs WHERE type = ?",
        args: [doc.type] as InValue[],
      });
      const maxRow = maxRs.rows[0];
      const base = maxRow ? rowNumOrNull(maxRow, "maxOrdinal") ?? 0 : 0;

      const tagsJson = JSON.stringify(doc.tags);
      const shadow = computeFtsShadowValues(doc.title, doc.content, tagsJson);

      const allocResult = await allocateWithBoundedRetry<DocRecord>(base, doc.type, async (candidate) => {
        try {
          await tx.execute({
            sql: `INSERT INTO docs
                   (id, slug, type, role, title, status, priority, content,
                    parent_id, extra, tags, version, created_at, updated_at,
                    created_by, deleted_at, fts_title, fts_content, fts_tags, ordinal)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              doc.id,
              doc.slug,
              doc.type,
              doc.role,
              doc.title,
              doc.status,
              doc.priority,
              doc.content,
              doc.parent_id ?? null,
              JSON.stringify(doc.extra),
              tagsJson,
              doc.version,
              doc.created_at,
              doc.updated_at,
              doc.created_by,
              doc.deleted_at ?? null,
              shadow.fts_title,
              shadow.fts_content,
              shadow.fts_tags,
              candidate,
            ] as InValue[],
          });
          return { kind: "success", value: { ...doc, ordinal: candidate } };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (msg.includes("UNIQUE constraint failed: docs.slug")) {
            // `tx` is still open inside this retry closure — see
            // `insertWithAllocatedOrdinal`'s identical branch for why a failed
            // statement leaves a libsql transaction usable.
            return { kind: "error", error: await this.getDuplicateSlugErrorFor(tx, doc.slug, e) };
          }
          if (isOrdinalUniqueViolationMessage(msg)) {
            return { kind: "collision" };
          }
          return { kind: "error", error: toStoreError(e) };
        }
      });

      if (!allocResult.ok) {
        await tx.rollback();
        return allocResult;
      }

      await tx.execute({
        sql: `INSERT INTO versions
               (doc_id, version, content, extra, status, title,
                action, created_at, created_by, change_summary, slug)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          version.doc_id,
          version.version,
          version.content,
          JSON.stringify(version.extra),
          version.status,
          version.title,
          version.action,
          version.created_at,
          version.created_by,
          version.change_summary ?? null,
          version.slug ?? null,
        ] as InValue[],
      });

      await this.appendAuditEntryTx(tx, audit);

      await tx.commit();
      return ok(allocResult.value);
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: rollback throws only when the transaction is already
        // closed — safe to ignore, `e` below is what the caller needs.
        // Mirrors insertWithProvenance's identical guard.
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  /**
   * @see StoreInterface.updateWithProvenance
   */
  async updateWithProvenance(
    id: DocId,
    patch: Partial<DocRecord>,
    opts: UpdateOpts | undefined,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    await this.ensureReady();
    const tx = await this.client.transaction("write");
    try {
      const existingRs = await tx.execute({
        sql: "SELECT * FROM docs WHERE id = ?",
        args: [id],
      });
      const existingRow = existingRs.rows[0];

      if (!existingRow) {
        await tx.rollback();
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const current = rowToDocRecord(libsqlRowToDocRow(existingRow));
      const updated: DocRecord = {
        ...current,
        ...patch,
        id: current.id, // id is immutable
      };
      const updatedTagsJson = JSON.stringify(updated.tags);
      // reason: same shadow-column obligation as update() — mirrors
      // SQLiteStore.updateDocSync (updateWithProvenance there also
      // delegates to the same private sync helper update() uses).
      const shadow = computeFtsShadowValues(updated.title, updated.content, updatedTagsJson);

      if (opts?.expected_version !== undefined) {
        const updateRs = await tx.execute({
          sql: `UPDATE docs SET
                 slug = ?, type = ?, role = ?, title = ?, status = ?,
                 priority = ?, content = ?, parent_id = ?, extra = ?,
                 tags = ?, version = ?, created_at = ?, updated_at = ?,
                 created_by = ?, deleted_at = ?, fts_title = ?, fts_content = ?,
                 fts_tags = ?
               WHERE id = ? AND version = ?`,
          args: [
            updated.slug,
            updated.type,
            updated.role,
            updated.title,
            updated.status,
            updated.priority,
            updated.content,
            updated.parent_id ?? null,
            JSON.stringify(updated.extra),
            updatedTagsJson,
            updated.version,
            updated.created_at,
            updated.updated_at,
            updated.created_by,
            updated.deleted_at ?? null,
            shadow.fts_title,
            shadow.fts_content,
            shadow.fts_tags,
            id,
            opts.expected_version,
          ] as InValue[],
        });

        if (updateRs.rowsAffected === 0) {
          const actualRs = await tx.execute({
            sql: "SELECT version FROM docs WHERE id = ?",
            args: [id],
          });
          const actualRow = actualRs.rows[0];
          await tx.rollback();

          if (!actualRow) {
            // Deleted between our SELECT and UPDATE (race)
            return err({ code: "DOC_NOT_FOUND", id });
          }

          return err({
            code: "STALE_VERSION",
            id,
            expected: opts.expected_version,
            actual: rowNum(actualRow, "version"),
          });
        }
      } else {
        // Unconditional UPDATE — backward-compatible path
        await tx.execute({
          sql: `UPDATE docs SET
                 slug = ?, type = ?, role = ?, title = ?, status = ?,
                 priority = ?, content = ?, parent_id = ?, extra = ?,
                 tags = ?, version = ?, created_at = ?, updated_at = ?,
                 created_by = ?, deleted_at = ?, fts_title = ?, fts_content = ?,
                 fts_tags = ?
               WHERE id = ?`,
          args: [
            updated.slug,
            updated.type,
            updated.role,
            updated.title,
            updated.status,
            updated.priority,
            updated.content,
            updated.parent_id ?? null,
            JSON.stringify(updated.extra),
            updatedTagsJson,
            updated.version,
            updated.created_at,
            updated.updated_at,
            updated.created_by,
            updated.deleted_at ?? null,
            shadow.fts_title,
            shadow.fts_content,
            shadow.fts_tags,
            id,
          ] as InValue[],
        });
      }

      await tx.execute({
        sql: `INSERT INTO versions
               (doc_id, version, content, extra, status, title,
                action, created_at, created_by, change_summary, slug)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          version.doc_id,
          version.version,
          version.content,
          JSON.stringify(version.extra),
          version.status,
          version.title,
          version.action,
          version.created_at,
          version.created_by,
          version.change_summary ?? null,
          version.slug ?? null,
        ] as InValue[],
      });

      await this.appendAuditEntryTx(tx, audit);

      await tx.commit();
      return ok(updated);
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: same as insertWithProvenance — safe to ignore, see above.
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  /**
   * @see StoreInterface.softDeleteWithProvenance
   */
  async softDeleteWithProvenance(
    id: DocId,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<void, LoreError>> {
    await this.ensureReady();
    const tx = await this.client.transaction("write");
    try {
      const existingRs = await tx.execute({
        sql: "SELECT id FROM docs WHERE id = ?",
        args: [id],
      });

      if (!existingRs.rows[0]) {
        await tx.rollback();
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const now = new Date().toISOString();
      await tx.execute({
        sql: "UPDATE docs SET deleted_at = ? WHERE id = ?",
        args: [now, id],
      });

      await tx.execute({
        sql: `INSERT INTO versions
               (doc_id, version, content, extra, status, title,
                action, created_at, created_by, change_summary, slug)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          version.doc_id,
          version.version,
          version.content,
          JSON.stringify(version.extra),
          version.status,
          version.title,
          version.action,
          version.created_at,
          version.created_by,
          version.change_summary ?? null,
          version.slug ?? null,
        ] as InValue[],
      });

      await this.appendAuditEntryTx(tx, audit);

      await tx.commit();
      return ok(undefined);
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: same as insertWithProvenance — safe to ignore, see above.
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  // ── Links ─────────────────────────────────────────────────────────────

  async addLink(link: LinkRecord): Promise<Result<LinkRecord, LoreError>> {
    try {
      await this.ensureReady();

      if (link.link_type === "parent") {
        const cycleResult = await this.detectParentCycle(link.from_id, link.to_id);
        if (!cycleResult.ok) return cycleResult;
      }

      await this.client.execute({
        sql: `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
               VALUES (?, ?, ?, ?, ?)`,
        args: [link.from_id, link.to_id, link.link_type, link.created_at, link.created_by],
      });

      return ok(link);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("UNIQUE constraint failed: links.")) {
        return err({
          code: "DUPLICATE_LINK",
          from: link.from_id,
          to: link.to_id,
          type: link.link_type,
        });
      }
      return wrapStoreError(e);
    }
  }

  /**
   * Detect whether adding from_id → to_id parent link would create a cycle.
   * Delegates to {@link detectParentCycleViaAncestry} (store-shared.ts) for the
   * walk/depth-cap/self-link logic; this store's per-hop lookup resolves each
   * node's "effective parent" as the `links` table's outgoing `parent` edge
   * when one exists, falling back to `docs.parent_id` otherwise.
   *
   * @remark Both sources must be consulted. `addLink` itself (this method)
   *   never writes `docs.parent_id` — only `CorpusService._linkImpl` does,
   *   in a SEPARATE `store.update` call after `addLink` succeeds — so a
   *   chain built purely via `addLink` (e.g. this file's own
   *   AC-STORE-005.03/.04 tests) has NO `parent_id` to walk; the `links`
   *   branch handles that. Conversely, `CorpusService.create`'s `--parent`
   *   path writes ONLY `docs.parent_id`, never an `addLink` call — the
   *   `parent_id` fallback branch handles THAT (spec-corpus-schema §4.3
   *   audit finding: the old links-only walk was blind to exactly this
   *   edge, letting `lore link <root> <child> --type parent` silently
   *   persist a cycle when `child` was already `root`'s descendant purely
   *   via `parent_id`). The single `COALESCE` query below tries `links`
   *   first (preserving pre-fix behavior for links-only chains) and only
   *   reads `docs.parent_id` when no `links` edge exists for that node.
   */
  private async detectParentCycle(
    fromId: DocId,
    toId: DocId,
  ): Promise<Result<void, LoreError>> {
    return detectParentCycleViaAncestry(fromId, toId, async (id) => {
      const rs = await this.client.execute({
        sql: `SELECT COALESCE(
                (SELECT to_id FROM links WHERE from_id = docs.id AND link_type = 'parent' LIMIT 1),
                docs.parent_id
              ) AS parent_id
              FROM docs WHERE docs.id = ?`,
        args: [id],
      });
      const row = rs.rows[0];
      if (!row) return null;
      return rowStrOrNull(row, "parent_id");
    });
  }

  async removeLink(
    fromId: DocId,
    toId: DocId,
    linkType: LinkType,
  ): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({
        sql: "DELETE FROM links WHERE from_id = ? AND to_id = ? AND link_type = ?",
        args: [fromId, toId, linkType],
      });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findLinks(
    docId: DocId,
    direction: "in" | "out" | "both",
  ): Promise<Result<LinkRecord[], LoreError>> {
    try {
      await this.ensureReady();

      let rs;
      if (direction === "out") {
        rs = await this.client.execute({
          sql: "SELECT * FROM links WHERE from_id = ?",
          args: [docId],
        });
      } else if (direction === "in") {
        rs = await this.client.execute({
          sql: "SELECT * FROM links WHERE to_id = ?",
          args: [docId],
        });
      } else {
        rs = await this.client.execute({
          sql: "SELECT * FROM links WHERE from_id = ? OR to_id = ?",
          args: [docId, docId],
        });
      }

      return ok(rs.rows.map((row) => rowToLinkRecord(libsqlRowToLinkRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findLinksByToIds(
    toIds: DocId[],
    linkType: LinkType,
  ): Promise<Result<LinkRecord[], LoreError>> {
    if (toIds.length === 0) return ok([]);
    try {
      await this.ensureReady();
      const placeholders = toIds.map(() => "?").join(", ");
      const rs = await this.client.execute({
        sql: `SELECT * FROM links WHERE to_id IN (${placeholders}) AND link_type = ?`,
        args: [...(toIds as InValue[]), linkType],
      });
      return ok(rs.rows.map((row) => rowToLinkRecord(libsqlRowToLinkRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async countLinksByToIds(toIds: DocId[]): Promise<Result<Map<DocId, number>, LoreError>> {
    const counts = new Map<DocId, number>();
    if (toIds.length === 0) return ok(counts);
    try {
      await this.ensureReady();
      const placeholders = toIds.map(() => "?").join(", ");
      const rs = await this.client.execute({
        sql: `SELECT to_id, COUNT(*) AS cnt FROM links WHERE to_id IN (${placeholders}) GROUP BY to_id`,
        args: [...(toIds as InValue[])],
      });
      for (const row of rs.rows) {
        counts.set(rowStr(row, "to_id"), rowNum(row, "cnt"));
      }
      return ok(counts);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findLinksByFromIds(
    fromIds: DocId[],
    _direction: "out" = "out",
  ): Promise<Result<Map<DocId, LinkRecord[]>, LoreError>> {
    const byFromId = new Map<DocId, LinkRecord[]>();
    if (fromIds.length === 0) return ok(byFromId);
    try {
      await this.ensureReady();
      const placeholders = fromIds.map(() => "?").join(", ");
      const rs = await this.client.execute({
        sql: `SELECT * FROM links WHERE from_id IN (${placeholders})`,
        args: [...(fromIds as InValue[])],
      });
      for (const row of rs.rows) {
        const link = rowToLinkRecord(libsqlRowToLinkRow(row));
        const bucket = byFromId.get(link.from_id);
        if (bucket === undefined) {
          byFromId.set(link.from_id, [link]);
        } else {
          bucket.push(link);
        }
      }
      return ok(byFromId);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Search ────────────────────────────────────────────────────────────

  async search(
    query: string,
    filters?: StoreFilters,
  ): Promise<Result<SearchHit[], LoreError>> {
    try {
      await this.ensureReady();

      const safeQuery = escapeFtsQuery(query);
      // reason: FTS5 MATCH errors on empty expression — short-circuit here so
      // we never pass an empty string to libsql. Callers expect empty query →
      // zero results, not an error. See SPEC-013 §3.5.
      if (safeQuery === "") return ok([]);

      const excludeDeleted = filters?.exclude_deleted !== false;
      const docClauses: string[] = [];
      const docParams: InValue[] = [SNIPPET_MARK_OPEN, SNIPPET_MARK_CLOSE, safeQuery];

      if (excludeDeleted) {
        docClauses.push("d.deleted_at IS NULL");
      }
      if (filters?.type !== undefined) {
        docClauses.push("d.type = ?");
        docParams.push(filters.type);
      }
      if (filters?.status !== undefined) {
        docClauses.push("d.status = ?");
        docParams.push(filters.status);
      }
      // reason: mirrors SQLiteStore.search's identical json_extract predicate —
      // the narrowing rides the FTS5→docs join's WHERE, never a post-fetch filter
      // over the hit list. See StoreFilters.sub_type.
      if (filters?.sub_type !== undefined) {
        docClauses.push("json_extract(d.extra, '$.sub_type') = ?");
        docParams.push(filters.sub_type);
      }

      const docWhere = docClauses.length > 0 ? `AND ${docClauses.join(" AND ")}` : "";

      const sql = `
        SELECT
          d.id,
          d.slug,
          d.title,
          snippet(docs_fts, 1, ?, ?, '...', 32) AS snippet,
          f.rank,
          d.type,
          d.status,
          d.created_at,
          d.extra
        FROM docs_fts f
        JOIN docs d ON d.rowid = f.rowid
        WHERE docs_fts MATCH ?
          ${docWhere}
        ORDER BY f.rank
      `;

      const rs = await this.client.execute({ sql, args: docParams });
      // SPEC-043 D3 — rowToSearchHit also populates created_at + the narrow
      // validity projection (review S3, zero N+1 per-hit fetches).
      const hits: SearchHit[] = rs.rows.map((row) => rowToSearchHit(libsqlRowToFtsRow(row)));

      // Tags filter applied in-memory if needed
      if (filters?.tags && filters.tags.length > 0) {
        const requiredTags = filters.tags;
        const filtered: SearchHit[] = [];
        for (const hit of hits) {
          const docResult = await this.find(hit.id);
          if (!docResult.ok) continue;
          const doc = docResult.value;
          if (!doc) continue;
          if (requiredTags.every((tag) => doc.tags.includes(tag))) {
            filtered.push(hit);
          }
        }
        return ok(filtered);
      }

      return ok(hits);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Versions ──────────────────────────────────────────────────────────

  async insertVersion(version: VersionRecord): Promise<Result<VersionRecord, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({
        sql: `INSERT INTO versions
               (doc_id, version, content, extra, status, title,
                action, created_at, created_by, change_summary, slug)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          version.doc_id,
          version.version,
          version.content,
          JSON.stringify(version.extra),
          version.status,
          version.title,
          version.action,
          version.created_at,
          version.created_by,
          version.change_summary ?? null,
          version.slug ?? null,
        ] as InValue[],
      });
      return ok(version);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findVersions(
    docId: DocId,
    opts?: { limit?: number; offset?: number },
  ): Promise<Result<VersionRecord[], LoreError>> {
    try {
      await this.ensureReady();
      const limit = opts?.limit ?? 100;
      const offset = opts?.offset ?? 0;
      const rs = await this.client.execute({
        sql: `SELECT * FROM versions
               WHERE doc_id = ?
               ORDER BY version DESC
               LIMIT ? OFFSET ?`,
        args: [docId, limit, offset],
      });
      return ok(rs.rows.map((row) => rowToVersionRecord(libsqlRowToVersionRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listAllVersions(since?: string): Promise<Result<VersionRecord[], LoreError>> {
    try {
      await this.ensureReady();
      const rs =
        since !== undefined
          ? await this.client.execute({
              sql: `SELECT * FROM versions WHERE created_at >= ? ORDER BY created_at ASC`,
              args: [since] as InValue[],
            })
          : await this.client.execute(`SELECT * FROM versions ORDER BY created_at ASC`);
      return ok(rs.rows.map((row) => rowToVersionRecord(libsqlRowToVersionRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Audit ─────────────────────────────────────────────────────────────

  /**
   * @see StoreInterface.appendAuditEntry
   *
   * Opens its OWN `"write"` transaction around {@link appendAuditEntryTx} —
   * unlike the three `*WithProvenance` methods (which already hold an outer
   * transaction when they call that helper), a standalone `appendAuditEntry`
   * call has no existing transaction, so the head-read + insert atomicity
   * that helper's JSDoc describes needs one opened here.
   */
  async appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      const tx = await this.client.transaction("write");
      try {
        await this.appendAuditEntryTx(tx, entry);
        await tx.commit();
        return ok(undefined);
      } catch (e) {
        try {
          await tx.rollback();
        } catch {
          // reason: rollback throws only when the transaction is already
          // closed — safe to ignore, `e` below is what the caller needs.
        }
        throw e;
      } finally {
        tx.close();
      }
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async queryAudit(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>> {
    try {
      await this.ensureReady();

      const clauses: string[] = [];
      const params: InValue[] = [];

      if (filters.doc_id !== undefined) {
        clauses.push("doc_id = ?");
        params.push(filters.doc_id);
      }
      if (filters.actor !== undefined) {
        clauses.push("actor = ?");
        params.push(filters.actor);
      }
      if (filters.action !== undefined) {
        clauses.push("action = ?");
        params.push(filters.action);
      }
      if (filters.since !== undefined) {
        clauses.push("timestamp >= ?");
        params.push(filters.since);
      }

      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      // reason: LIMIT is parameter-bound (never string-interpolated) even
      // though `filters.limit` is a caller-controlled number, not raw user
      // text — the bind protocol is the only non-negotiable boundary for
      // the value entering the SQL string.
      const limitClause = filters.limit !== undefined ? "LIMIT ?" : "";
      if (filters.limit !== undefined) {
        params.push(filters.limit);
      }
      const sql = `SELECT * FROM audit ${whereClause} ORDER BY timestamp DESC ${limitClause}`;

      const rs = await this.client.execute({ sql, args: params });
      return ok(rs.rows.map((row) => rowToAuditEntry(libsqlRowToAuditRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.listAuditChain
   */
  async listAuditChain(): Promise<Result<AuditChainEntry[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute("SELECT * FROM audit ORDER BY id ASC");
      return ok(rs.rows.map((row) => rowToAuditChainEntry(libsqlRowToAuditChainRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Trace Events (SPEC-102) ──────────────────────────────────────────────
  // reason: local-only by design (D3) — this class's `trace_events` methods
  // exist for StoreInterface conformance/tests; production trace writes route
  // through a SEPARATE local bun:sqlite handle on the replica file (`app.ts`'s
  // composition root, ApiKeyStore precedent), never through `this.client`.
  // `trace_events` is absent from `sync-push.ts`'s REPLICATED_TABLES either way.

  async insertTraceEvent(event: TraceEventInput): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({
        sql: `INSERT INTO trace_events (ts, actor, surface, session_id, kind, doc_id, checkpoint, hit_count, details)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          event.ts,
          event.actor,
          event.surface,
          event.session_id,
          event.kind,
          event.doc_id ?? null,
          event.checkpoint ?? null,
          event.hit_count ?? null,
          JSON.stringify(event.details ?? {}),
        ] as InValue[],
      });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async countTraceEventsByKind(window: TraceStatsWindow): Promise<Result<Record<string, number>, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT kind, COUNT(*) as count FROM trace_events WHERE ts >= ? GROUP BY kind",
        args: [window.since],
      });
      const counts: Record<string, number> = {};
      for (const row of rs.rows) counts[rowStr(row, "kind")] = rowNum(row, "count");
      return ok(counts);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async countTraceDenyByCheckpoint(
    window: TraceStatsWindow,
  ): Promise<Result<TraceDenyByCheckpoint[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: `SELECT checkpoint, json_extract(details, '$.layer') as layer, COUNT(*) as count
              FROM trace_events
              WHERE kind = 'gate_deny' AND ts >= ?
              GROUP BY checkpoint, layer`,
        args: [window.since],
      });
      return ok(
        rs.rows.map((row) => ({
          checkpoint: rowStrOrNull(row, "checkpoint") ?? "unknown",
          layer: rowStrOrNull(row, "layer") ?? "unknown",
          count: rowNum(row, "count"),
        })),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listTraceZeroHitSearches(
    window: TraceStatsWindow,
    opts?: TraceZeroHitListOpts,
  ): Promise<Result<TraceZeroHitSearch[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: `SELECT ts, actor, details FROM trace_events
              WHERE kind = 'search' AND hit_count = 0 AND ts >= ?
              ORDER BY ts DESC, id DESC`,
        args: [window.since],
      });
      // reason: the `query` KEY is omitted entirely when raw queries were not
      // requested — see SQLiteStore.listTraceZeroHitSearches's own note; both
      // stores must project the SAME absent-vs-empty distinction.
      const includeRawQueries = opts?.includeRawQueries === true;
      return ok(
        rs.rows.map((row) => ({
          ts: rowStr(row, "ts"),
          actor: rowStr(row, "actor"),
          ...(includeRawQueries
            ? {
                query:
                  parseJson<{ query?: string }>(rowStr(row, "details") || "{}", {}).query ?? "",
              }
            : {}),
        })),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listNeverReadDocs(window: TraceStatsWindow): Promise<Result<NeverReadDoc[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: `SELECT id, slug FROM docs
              WHERE deleted_at IS NULL
              AND id NOT IN (
                SELECT DISTINCT doc_id FROM trace_events
                WHERE kind = 'get' AND doc_id IS NOT NULL AND ts >= ?
              )
              ORDER BY slug ASC, id ASC`,
        args: [window.since],
      });
      return ok(rs.rows.map((row) => ({ id: rowStr(row, "id"), slug: rowStr(row, "slug") })));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async countTraceZeroHitSearches(window: TraceStatsWindow): Promise<Result<number, LoreError>> {
    // reason: DERIVED from the member list, never a second COUNT(*) — see
    // StoreInterface.countTraceZeroHitSearches's own ⛔ note.
    const listResult = await this.listTraceZeroHitSearches(window);
    if (!listResult.ok) return listResult;
    return ok(listResult.value.length);
  }

  async countNeverReadDocs(window: TraceStatsWindow): Promise<Result<number, LoreError>> {
    // reason: DERIVED from the member list — see listNeverReadDocs above.
    const listResult = await this.listNeverReadDocs(window);
    if (!listResult.ok) return listResult;
    return ok(listResult.value.length);
  }

  async listTraceGateDenies(window: TraceStatsWindow): Promise<Result<TraceGateDenyEvent[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT ts, actor, checkpoint FROM trace_events WHERE kind = 'gate_deny' AND ts >= ? ORDER BY ts ASC",
        args: [window.since],
      });
      return ok(
        rs.rows.map((row) => ({
          ts: rowStr(row, "ts"),
          actor: rowStr(row, "actor"),
          checkpoint: rowStrOrNull(row, "checkpoint") ?? "unknown",
        })),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listTraceRawSearchQueries(
    window: TraceStatsWindow,
  ): Promise<Result<TraceRawSearchQuery[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT ts, actor, details FROM trace_events WHERE kind = 'search' AND ts >= ? ORDER BY ts DESC",
        args: [window.since],
      });
      return ok(
        rs.rows.map((row) => ({
          ts: rowStr(row, "ts"),
          actor: rowStr(row, "actor"),
          query: parseJson<{ query?: string }>(rowStr(row, "details") || "{}", {}).query ?? "",
        })),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async pruneTraceEvents(cutoffIso: string, batchSize = 50_000): Promise<Result<number, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "DELETE FROM trace_events WHERE id IN (SELECT id FROM trace_events WHERE ts < ? LIMIT ?)",
        args: [cutoffIso, batchSize],
      });
      return ok(Number(rs.rowsAffected));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Review Judgments ────────────────────────────────────────────────────

  async insertJudgment(judgment: ReviewJudgment): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({
        sql: `INSERT INTO review_judgments
               (id, doc_id, doc_version, decision, confidence, reasons, checks,
                blocking_questions, judge_provider, judge_model, judge_prompt_version,
                kind, superseded_candidate, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          judgment.id,
          judgment.doc_id,
          judgment.doc_version,
          judgment.decision,
          judgment.confidence,
          JSON.stringify(judgment.reasons),
          JSON.stringify(judgment.checks),
          JSON.stringify(judgment.blocking_questions),
          judgment.judge.provider,
          judgment.judge.model,
          judgment.judge.prompt_version,
          judgment.kind ?? "review",
          judgment.superseded_candidate !== undefined ? JSON.stringify(judgment.superseded_candidate) : null,
          judgment.created_at,
          judgment.created_by,
        ] as InValue[],
      });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findJudgments(docId: DocId, kind?: ReviewJudgmentKind): Promise<Result<ReviewJudgment[], LoreError>> {
    try {
      await this.ensureReady();
      const rs =
        kind !== undefined
          ? await this.client.execute({
              sql: "SELECT * FROM review_judgments WHERE doc_id = ? AND kind = ? ORDER BY created_at DESC",
              args: [docId, kind],
            })
          : await this.client.execute({
              sql: "SELECT * FROM review_judgments WHERE doc_id = ? ORDER BY created_at DESC",
              args: [docId],
            });
      return ok(rs.rows.map((row) => rowToReviewJudgment(libsqlRowToJudgmentRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async latestJudgment(
    docId: DocId,
    kind?: ReviewJudgmentKind,
  ): Promise<Result<ReviewJudgment | null, LoreError>> {
    try {
      await this.ensureReady();
      const rs =
        kind !== undefined
          ? await this.client.execute({
              sql: "SELECT * FROM review_judgments WHERE doc_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1",
              args: [docId, kind],
            })
          : await this.client.execute({
              sql: "SELECT * FROM review_judgments WHERE doc_id = ? ORDER BY created_at DESC LIMIT 1",
              args: [docId],
            });
      const row = rs.rows[0];
      return ok(row ? rowToReviewJudgment(libsqlRowToJudgmentRow(row)) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async latestJudgmentsByDocIds(
    docIds: DocId[],
    kind: ReviewJudgmentKind,
  ): Promise<Result<Map<DocId, ReviewJudgment>, LoreError>> {
    const result = new Map<DocId, ReviewJudgment>();
    if (docIds.length === 0) return ok(result);
    try {
      await this.ensureReady();
      const placeholders = docIds.map(() => "?").join(", ");
      const rs = await this.client.execute({
        sql: `SELECT rj.* FROM review_judgments rj
              INNER JOIN (
                SELECT doc_id, MAX(created_at) AS max_created_at
                FROM review_judgments
                WHERE doc_id IN (${placeholders}) AND kind = ?
                GROUP BY doc_id
              ) latest ON rj.doc_id = latest.doc_id AND rj.created_at = latest.max_created_at
              WHERE rj.kind = ?`,
        args: [...(docIds as InValue[]), kind, kind],
      });
      for (const row of rs.rows) {
        const judgment = rowToReviewJudgment(libsqlRowToJudgmentRow(row));
        if (!result.has(judgment.doc_id)) result.set(judgment.doc_id, judgment);
      }
      return ok(result);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Calibration Records ──────────────────────────────────────────────────

  async insertCalibrationRecord(record: CalibrationRecord): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({
        sql: `INSERT INTO calibration_records
               (id, judgment_id, doc_id, doc_type, human_outcome, delta_reasons, actor, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          record.id,
          record.judgment_id,
          record.doc_id,
          record.doc_type,
          record.human_outcome,
          JSON.stringify(record.delta_reasons),
          record.actor,
          record.created_at,
        ] as InValue[],
      });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async queryCalibrationWindow(
    filter: CalibrationWindowFilter,
  ): Promise<Result<CalibrationRecordWithPromptVersion[], LoreError>> {
    try {
      await this.ensureReady();

      // reason: the JOIN to review_judgments is now UNCONDITIONAL (not just when
      // filter.prompt_version is pinned) — every returned record must carry the
      // judgment's real judge_prompt_version so JudgmentService.computeCalibrationStats
      // can group by the actual (doc_type, prompt_version) pair instead of falling back
      // to an unpinned "*" sentinel. Still one indexed statement, not an N+1 fan-out.
      // See SPEC-034 §3 / SPEC-035 calibration disaggregation follow-up.
      const clauses: string[] = [];
      const params: InValue[] = [];

      if (filter.doc_type !== undefined) {
        clauses.push("c.doc_type = ?");
        params.push(filter.doc_type);
      }
      if (filter.prompt_version !== undefined) {
        clauses.push("j.judge_prompt_version = ?");
        params.push(filter.prompt_version);
      }

      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const sql = `
        SELECT c.*, j.judge_prompt_version AS judge_prompt_version, j.kind AS judge_kind
        FROM calibration_records c
        JOIN review_judgments j ON j.id = c.judgment_id
        ${whereClause}
        ORDER BY c.created_at DESC
        LIMIT ?
      `;
      params.push(filter.limit);

      const rs = await this.client.execute({ sql, args: params });
      return ok(
        rs.rows.map((row) => rowToCalibrationRecordWithPromptVersion(libsqlRowToCalibrationRowWithPromptVersion(row))),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Sync ──────────────────────────────────────────────────────────────

  /**
   * Sync embedded replica with remote Turso.
   * File-only mode (no remoteUrl): always returns STORE_ERROR — sync not supported.
   * With remoteUrl: calls client.sync() and returns frame metadata.
   */
  async sync(): Promise<Result<{ frameNo: number; framesSynced: number } | void, LoreError>> {
    if (!this.hasRemote) {
      return err({
        code: "STORE_ERROR",
        message: "sync is not supported in file-only mode (no remoteUrl configured)",
      });
    }

    try {
      await this.ensureReady();
      const replicated = await this.client.sync();
      if (replicated) {
        return ok({ frameNo: replicated.frame_no, framesSynced: replicated.frames_synced });
      }
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  close(): void {
    this.client.close();
  }

  async dbSizeBytes(): Promise<Result<number, LoreError>> {
    try {
      await this.ensureReady();
      const pageCountRs = await this.client.execute("PRAGMA page_count");
      const pageSizeRs = await this.client.execute("PRAGMA page_size");
      const pageCount = pageCountRs.rows[0] ? rowNum(pageCountRs.rows[0], "page_count") : 0;
      const pageSize = pageSizeRs.rows[0] ? rowNum(pageSizeRs.rows[0], "page_size") : 0;
      return ok(pageCount * pageSize);
    } catch (e) {
      return wrapStoreError(e);
    }
  }
}
