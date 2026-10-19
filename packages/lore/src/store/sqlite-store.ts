/**
 * SQLiteStore — bun:sqlite implementation of StoreInterface.
 * Methods are async to satisfy the async StoreInterface contract,
 * but internally use synchronous bun:sqlite operations.
 * Source: SPEC-002 §7.1, §7.2, §7.3; SPEC-001 §4.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
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
import { MIGRATION_013_SQL } from "./migrations/migration-013.js";
import { MIGRATION_014_SQL } from "./migrations/migration-014.js";
import { MIGRATION_016_ADD_COLUMNS, MIGRATION_016_SQL } from "./migrations/migration-016.js";
import { MIGRATION_017_ADD_COLUMNS, MIGRATION_017_SQL } from "./migrations/migration-017.js";
import { MIGRATION_015_SQL } from "./migrations/migration-015.js";
import { MIGRATION_018_SQL } from "./migrations/migration-018.js";
import { MIGRATION_019_ADD_COLUMNS, MIGRATION_019_SQL } from "./migrations/migration-019.js";
// Re-exported here (beside the migration chain it describes) from a
// bun:sqlite-free sibling module so bun-only readonly-probe callers (e.g.
// store/schema-probe.ts's `probeSchemaVersion`, consumed by
// mount/mount-registry.ts) import the version ceiling from the SAME module
// they already import SQLiteStore from, while any genuinely vitest-reachable
// caller can import it from schema-version.ts directly without pulling
// bun:sqlite into the vitest module graph. See schema-version.ts's own
// JSDoc for the bump-together invariant.
import { LATEST_SCHEMA_VERSION } from "./schema-version.js";
export { LATEST_SCHEMA_VERSION } from "./schema-version.js";
import type {
  AuditEntry,
  CalibrationRecord,
  DocId,
  DocRecord,
  DocStatus,
  DocType,
  LinkRecord,
  LinkType,
  OrdinalDocType,
  ReviewJudgment,
  ReviewJudgmentKind,
  RunId,
  RunRecord,
  Slug,
  VersionRecord,
} from "@lore/core";
import {
  DEFAULT_WRITE_WAIT_MS,
  err,
  ok,
  ORDINAL_REGISTERED_TYPES,
  SNIPPET_MARK_CLOSE,
  SNIPPET_MARK_OPEN,
  type LoreError,
  type Result,
} from "@lore/core";
import type { RuleIdPrefix } from "@lore/core";
import { listedRuleLifecycle } from "./index-rows.js";
import type {
  AcCiteRow,
  RuleDependsRow,
  AuditChainEntry,
  AuditFilters,
  CalibrationRecordWithPromptVersion,
  CalibrationWindowFilter,
  NeverReadDoc,
  SearchHit,
  ProposedRuleWrite,
  RuleLeafPatch,
  RuleRegistryRow,
  AcExemptionRow,
  AcExemptionCap,
  StoreFilters,
  AttributedWriteCount,
  StoreInterface,
  TraceDenyByCheckpoint,
  TraceEventInput,
  TraceGateDenyEvent,
  TraceRawSearchQuery,
  TraceStatsWindow,
  TraceZeroHitListOpts,
  TraceZeroHitSearch,
  UpdateOpts,
  ProvenanceWriteExtras,
  RunEndOutcome,
  RunEndState,
  RunLifecycle,
  RunProcessRecord,
  VersionKey,
} from "./store-interface.js";
import {
  type AuditChainRow,
  type AuditRow,
  type CalibrationRowWithPromptVersion,
  type DocRow,
  type FtsRow,
  type JudgmentRow,
  type LinkRow,
  type VersionRow,
  INSERT_RUN_SQL,
  RUN_LIFECYCLE_SQL,
  type RunLifecycleRow,
  rowToRunLifecycle,
  type RunRow,
  countAttributedWritesSql,
  emptyKindsError,
  rowToRunRecord,
  runRecordToParams,
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
  rowToVersionKey,
  type VersionKeyRow,
  toStoreError,
  wrapStoreError,
  buildAcExemptionAlreadyActiveError,
  buildAcExemptionCapError,
  isExemptionActive,
  NO_SATISFIED_EXEMPTIONS,
  buildNonLiveRuleRefusal,
} from "./store-shared.js";
import { stampAuditSurface } from "./audit-surface.js";
import { MIGRATION_020_SQL } from "./migrations/migration-020.js";
import { MIGRATION_021_ADD_COLUMNS, MIGRATION_021_SQL } from "./migrations/migration-021.js";
import { MIGRATION_022_SQL } from "./migrations/migration-022.js";
import { MIGRATION_023_SQL } from "./migrations/migration-023.js";
import { MIGRATION_024_SQL } from "./migrations/migration-024.js";
import { MIGRATION_025_SQL } from "./migrations/migration-025.js";
import { applyMigration026 } from "./migrations/migration-026.js";
import { DECISION_GENESIS_HASH, computeDecisionEntryHash } from "./decision-log.js";
import type { DecisionLogRow, DecisionRecordInput } from "./decision-log.js";
import type { DecisionSubjectKey } from "./store-interface.js";

// ─── SQLiteStore ─────────────────────────────────────────────────────────────

/**
 * Per-connection knobs a composition root may declare when opening a corpus.
 * Deliberately explicit DI rather than a config read inside the store: the
 * value that gets APPLIED must be the same value the caller can print on
 * expiry (spec-report-issue-has-no-specified-concurrency-contract-ac-072 D4),
 * and a store that silently loaded its own config could drift from whatever the
 * caller believes it declared.
 */
export interface SQLiteStoreOptions {
  /**
   * The DECLARED bounded wait, applied as `PRAGMA busy_timeout` (ms). Absent →
   * {@link DEFAULT_WRITE_WAIT_MS}. Read back via {@link SQLiteStore.writeWaitMs}
   * so a caller reports the bound the connection actually carries.
   */
  readonly writeWaitMs?: number;
  /**
   * Open the file read-only (`SQLITE_OPEN_READONLY`): no journal-mode change, no migration, and any write method
   * fails with a store error. For a reader that must not touch the corpus — the audit-verify worker
   * (`audit-verify-worker.ts`) opens the same file the serving thread owns, so it must never write or migrate it.
   * The file must already exist at the schema the serving thread migrated it to.
   */
  readonly readonly?: true;
  /**
   * Stop migrating at this schema version (default: {@link LATEST_SCHEMA_VERSION}, i.e. migrate fully). Lets a test
   * build a corpus that is GENUINELY one schema behind, whatever the newest migration does; production callers never set it.
   */
  readonly schemaCeiling?: number;
}

export class SQLiteStore implements StoreInterface {
  private readonly db: Database;

  /**
   * The bounded wait (ms) THIS connection applied as `PRAGMA busy_timeout` —
   * exposed so the layer that reports a contention refusal surfaces the applied
   * number verbatim instead of re-deriving it from config (D4).
   */
  readonly writeWaitMs: number;

  private readonly schemaCeiling: number;
  /** The corpus file; named by a failed migration (migration-026 fails loud with it). */
  private readonly corpusPath: string;

  constructor(dbPath: string, options?: SQLiteStoreOptions) {
    const declaredWriteWaitMs = options?.writeWaitMs ?? DEFAULT_WRITE_WAIT_MS;
    // reason: fail loud at construction rather than interpolating a
    // non-integer/negative/NaN into the PRAGMA below, where SQLite would report
    // an opaque syntax error — and rather than silently clamping, which would
    // make the bound printed on expiry differ from the bound applied (D4).
    // `typeof x === "number"` (what config resolution can guarantee) still
    // admits NaN and Infinity, so this check is not redundant with the type.
    if (!Number.isInteger(declaredWriteWaitMs) || declaredWriteWaitMs < 0) {
      throw new Error(
        `SQLiteStore: writeWaitMs must be a non-negative integer number of milliseconds, got ${String(declaredWriteWaitMs)} ` +
          "(check feedback.upstream.write_wait_ms in .lore/config.yaml)",
      );
    }
    this.db = options?.readonly === true ? new Database(dbPath, { readonly: true }) : new Database(dbPath);
    this.writeWaitMs = declaredWriteWaitMs;
    this.corpusPath = dbPath;
    this.schemaCeiling = options?.schemaCeiling ?? LATEST_SCHEMA_VERSION;
    try {
      if (options?.readonly === true) this.db.run(`PRAGMA busy_timeout = ${this.writeWaitMs}`);
      else this.init();
    } catch (error) {
      // reason: `init()` can legitimately fail on a corpus another process is
      // writing (`PRAGMA journal_mode = WAL` → SQLITE_BUSY) — and since
      // `buildUpstreamContext` now RECOVERS from that instead of letting it
      // kill the process (task-openvalidatedupstream-lets-a-synchronous-store-
      // init-throw), the half-constructed handle outlives the failure. This
      // object is unreachable once the constructor throws, so nothing else can
      // ever close it: closing here is the only way the fd and any file lock
      // it holds are released before the caller carries on (the report-issue
      // upstream-discovery path probes SEVERAL candidate corpora in one
      // process, so a leaked locked handle per failed candidate is reachable,
      // not theoretical). The original error is re-thrown UNCHANGED — this is
      // resource cleanup, never a swallow or a re-typing.
      this.db.close();
      throw error;
    }
  }

  /**
   * Expose the underlying Database for adapters that need direct SQL access
   * (e.g. ApiKeyStore for the api_keys table).
   * Prefer StoreInterface methods for corpus operations.
   */
  getDatabase(): Database {
    return this.db;
  }

  // ── Initialization ────────────────────────────────────────────────────────

  private init(): void {
    // SPEC-078 D9: without a busy_timeout, a second writer contending for the
    // same corpus file (e.g. a concurrently-mounted dashboard instance) gets an
    // IMMEDIATE `SQLITE_BUSY` throw instead of waiting out the holder — this is
    // per-CONNECTION state (bun:sqlite defaults every new `Database` to 0ms), so
    // it must be set here on every SQLiteStore construction, not once globally.
    // TursoStore is deliberately untouched — libsql's client handles write
    // serialization at the replica-sync layer, not via SQLite's file-level busy
    // handler.
    //
    // The NUMBER moved out of this file (spec-report-issue-has-no-specified-
    // concurrency-contract-ac-072 D4): it is now `DEFAULT_WRITE_WAIT_MS` in
    // `@lore/core`'s config module, overridable per connection via
    // `SQLiteStoreOptions.writeWaitMs`, because the layer that REPORTS an expiry
    // must print the very bound that was applied. Bind parameters are not
    // allowed in a PRAGMA statement, so the value is interpolated — it is a
    // number typed by `SQLiteStoreOptions`, never caller text.
    //
    // ⛔ THIS MUST STAY THE FIRST STATEMENT ON THE CONNECTION (task-
    // openvalidatedupstream-lets-a-synchronous-store-init-throw). It used to
    // run THIRD, after `journal_mode`/`foreign_keys`, which left the bound
    // armed one statement too late to matter: `PRAGMA journal_mode = WAL`
    // below is the first statement that TOUCHES THE FILE (its prepare step
    // reads the schema, which opens the pager and, on a cold WAL corpus with
    // no live `-shm`, can require wal-index recovery), and it ran under
    // bun:sqlite's default `busy_timeout = 0`. A concurrent writer's `BEGIN
    // IMMEDIATE` therefore killed the whole process from inside this
    // constructor with a bare `database is locked` — measured at 92 deaths
    // across ~300 attempts of the SPEC-072 cross-corpus concurrency harness,
    // and reproduced here at 24 throws / 240 cold-open connections, dropping
    // to 0 / 240 with this ordering (negative control: the SAME reorder with
    // the bound set to 0 still throws 31 / 240, so it is the DECLARED BOUND
    // being armed early that fixes it, not the reorder by itself).
    //
    // A `busy_timeout` PRAGMA is pure per-connection VM state — it opens no
    // file and can never fail — so nothing is lost by hoisting it, and this is
    // the same NATIVE busy handler used everywhere else in this codepath,
    // never a JS-level retry/sleep/backoff (`bun run check:no-timer-retry`).
    this.db.run(`PRAGMA busy_timeout = ${this.writeWaitMs}`);
    // Enable WAL for better concurrent read performance
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.runMigrations();
  }

  /**
   * Applies every pending migration in order, gated by `PRAGMA user_version`.
   *
   * @invariant migration-004 is wrapped in its own `BEGIN IMMEDIATE; ... COMMIT;`
   *   (see `migrations/migration-004.ts`'s module JSDoc) — this is the FIRST
   *   migration in the file that needs a transaction wrapper (001-003 are pure
   *   additive `CREATE TABLE/INDEX/VIRTUAL TABLE/TRIGGER IF NOT EXISTS`, safe to
   *   re-run statement-by-statement even half-applied — migration-001 itself was
   *   NOT idempotent before it gained these `IF NOT EXISTS` guards: a process
   *   kill between `db.exec(MIGRATION_001_SQL)` completing its DDL and the
   *   trailing `PRAGMA user_version = 1` landing left `user_version` at 0, so the
   *   next startup re-ran the identical unguarded SQL and threw "table docs
   *   already exists", permanently bricking the corpus). bun:sqlite's `db.exec()` (`Database.exec = Database.run`)
   *   does NOT auto-rollback when a statement inside a multi-statement string
   *   throws — reproduced empirically: after a caught `exec()` error mid an
   *   explicit `BEGIN`, `db.inTransaction` stays `true` until something issues
   *   `ROLLBACK`. Left unhandled, that would wedge this connection in an open
   *   transaction for the rest of the process's lifetime (every subsequent
   *   statement — migrations 1-3 included, and all later CRUD — would silently
   *   execute inside that dangling transaction instead of autocommitting). The
   *   catch below issues an explicit `ROLLBACK` before re-throwing so a failed
   *   migration-004 leaves the connection exactly as unmigrated as it found it.
   */
  private runMigrations(): void {
    const currentVersion = (
      this.db.query("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    const ceiling = this.schemaCeiling;

    if (currentVersion < 1 && 1 <= ceiling) {
      // SQL is inlined as a constant — safe for bun build --compile (no fs access at runtime)
      this.db.exec(MIGRATION_001_SQL);
    }

    if (currentVersion < 2 && 2 <= ceiling) {
      this.db.exec(MIGRATION_002_SQL);
    }

    if (currentVersion < 3 && 3 <= ceiling) {
      this.db.exec(MIGRATION_003_SQL);
    }

    if (currentVersion < 4 && 4 <= ceiling) {
      try {
        this.db.exec(MIGRATION_004_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: ROLLBACK itself throws only when there is no open
          // transaction to roll back (e.g. the migration's own `BEGIN
          // IMMEDIATE` never ran because the syntax error was in the BEGIN
          // statement itself) — safe to ignore; `error` below is what the
          // caller needs to see.
        }
        throw error;
      }
    }

    if (currentVersion < 5 && 5 <= ceiling) {
      // reason: mirrors migration-004's catch/ROLLBACK wrapper (see migration-005.ts's
      // own JSDoc @invariant) — this migration is also multiple DDL statements wrapped
      // in one BEGIN/COMMIT, and bun:sqlite's db.exec() does not auto-rollback a caught
      // mid-string throw.
      try {
        this.db.exec(MIGRATION_005_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 6 && 6 <= ceiling) {
      // reason: mirrors migration-004/005's catch/ROLLBACK wrapper (see
      // migration-006.ts's own JSDoc @invariant) — a `docs` table-recreate,
      // also multiple DDL statements wrapped in one BEGIN/COMMIT.
      try {
        this.db.exec(MIGRATION_006_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005 — safe to ignore, see above.
        }
        // reason: BUG-010 (audit finding) — migration-006's OWN SQL toggles
        // `PRAGMA foreign_keys = OFF` as its FIRST statement, OUTSIDE the
        // `BEGIN IMMEDIATE`/`COMMIT` block it wraps (required for `DROP TABLE
        // docs` to succeed under real FK-referencing data — see
        // migration-006.ts's module JSDoc). That toggle is a CONNECTION-level
        // setting, not part of the transaction, so `ROLLBACK` above does NOT
        // undo it. If the migration throws AFTER the OFF toggle ran but
        // BEFORE reaching its own trailing `PRAGMA foreign_keys = ON;`
        // statement (which sits after `COMMIT` in the SQL string and is thus
        // never reached on any failure inside the transaction), this
        // connection would silently run FK-unenforced for the rest of the
        // process's lifetime — every subsequent INSERT/UPDATE/DELETE on this
        // handle skips foreign-key validation with no error, no log, nothing.
        // Restore it explicitly here so a partially-failed migration-006
        // leaves FK enforcement exactly as it found it (`init()` already set
        // `PRAGMA foreign_keys = ON` before `runMigrations()` ran).
        try {
          this.db.exec("PRAGMA foreign_keys = ON");
        } catch {
          // reason: a PRAGMA toggle only throws on a closed/broken
          // connection — at that point the process is already going to
          // surface `error` below and this connection is unusable regardless
          // of FK state; safe to ignore.
        }
        throw error;
      }
    }

    if (currentVersion < 7 && 7 <= ceiling) {
      // reason: mirrors migration-005's catch/ROLLBACK wrapper (see
      // migration-007.ts's own JSDoc @invariant) — a plain nullable `ADD
      // COLUMN` plus the trailing `PRAGMA user_version` bump, wrapped in one
      // BEGIN/COMMIT so a crash between them can't leave the column present
      // with a stale version number.
      try {
        this.db.exec(MIGRATION_007_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 8 && 8 <= ceiling) {
      // reason: migration-008 is a THREE-PHASE sequence (ADD COLUMN → JS
      // per-row CJK bigram backfill → docs_fts drop/recreate + rebuild),
      // NOT a single self-contained SQL string like migrations 004-007 — see
      // migration-008.ts's module JSDoc for why. This block owns the
      // transaction wrapper (BEGIN IMMEDIATE .. COMMIT around all three
      // phases) that the SQL constants deliberately do NOT embed themselves,
      // mirroring migration-004/005/006/007's identical catch/ROLLBACK
      // rethrow shape for the "bun:sqlite doesn't auto-rollback a caught
      // mid-transaction throw" reason documented on this method's own JSDoc.
      try {
        this.db.run("BEGIN IMMEDIATE");
        this.db.exec(MIGRATION_008_ADD_COLUMNS_SQL);

        const rows = this.db
          .query("SELECT id, title, content, tags FROM docs")
          .all() as { id: string; title: string; content: string; tags: string }[];
        const backfillStmt = this.db.prepare(
          "UPDATE docs SET fts_title = ?, fts_content = ?, fts_tags = ? WHERE id = ?",
        );
        for (const row of rows) {
          const shadow = computeFtsShadowValues(row.title, row.content, row.tags);
          backfillStmt.run(shadow.fts_title, shadow.fts_content, shadow.fts_tags, row.id);
        }

        this.db.exec(MIGRATION_008_FTS_REBUILD_SQL);
        this.db.run("COMMIT");
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006/007 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 9 && 9 <= ceiling) {
      // reason: migration-009 is a THREE-PHASE sequence (ADD COLUMN → JS
      // per-row hash-chain backfill → PRAGMA user_version bump), NOT a
      // single self-contained SQL string — mirrors migration-008's shape
      // exactly (see migration-009.ts's module JSDoc for why). This block
      // owns the transaction wrapper the SQL constants deliberately do NOT
      // embed themselves, same catch/ROLLBACK rethrow shape as every
      // migration above for the "bun:sqlite doesn't auto-rollback a caught
      // mid-transaction throw" reason documented on this method's own JSDoc.
      try {
        this.db.run("BEGIN IMMEDIATE");
        this.db.exec(MIGRATION_009_ADD_COLUMNS_SQL);

        const rows = this.db
          .query(
            "SELECT id, timestamp, actor, session_id, action, doc_id, details FROM audit ORDER BY id ASC",
          )
          .all() as {
          id: number;
          timestamp: string;
          actor: string;
          session_id: string;
          action: string;
          doc_id: string | null;
          details: string;
        }[];
        const backfillStmt = this.db.prepare(
          "UPDATE audit SET prev_hash = ?, entry_hash = ? WHERE id = ?",
        );
        // reason: threads a running prevHash through the whole legacy
        // table in id ASC order — the SAME chain-construction order every
        // future appendAuditEntrySync extends (see migration-009.ts's
        // module JSDoc). Genesis prevHash is "" for the table's very first
        // row (or the whole loop is a no-op on a fresh empty table).
        let prevHash = "";
        for (const row of rows) {
          const entry = {
            timestamp: row.timestamp,
            actor: row.actor,
            session_id: row.session_id,
            action: row.action,
            ...(row.doc_id !== null ? { doc_id: row.doc_id } : {}),
            details: parseJson<Record<string, unknown>>(row.details, {}),
          };
          const entryHash = computeAuditEntryHash(entry, prevHash);
          backfillStmt.run(prevHash, entryHash, row.id);
          prevHash = entryHash;
        }

        this.db.exec(MIGRATION_009_FINALIZE_SQL);
        this.db.run("COMMIT");
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006/007/008 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 10 && 10 <= ceiling) {
      // reason: mirrors migration-007's catch/ROLLBACK wrapper (see
      // migration-010.ts's own JSDoc @invariant) — a plain nullable `ADD
      // COLUMN` plus a `CREATE UNIQUE INDEX` plus the trailing `PRAGMA
      // user_version` bump, wrapped in one BEGIN/COMMIT so a crash between
      // them can't leave the corpus with the column but not the index (or
      // vice versa) while user_version already reads 10.
      try {
        this.db.exec(MIGRATION_010_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006/007/008/009 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 11 && 11 <= ceiling) {
      // reason: mirrors migration-001/002/003's UN-wrapped shape (see
      // migration-011.ts's own JSDoc @invariant) — pure additive `CREATE
      // TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`, no ALTER on any
      // existing table, safe to re-run statement-by-statement even
      // half-applied. No BEGIN IMMEDIATE/catch/ROLLBACK wrapper needed.
      this.db.exec(MIGRATION_011_SQL);
    }

    if (currentVersion < 12 && 12 <= ceiling) {
      // reason: mirrors migration-004's catch/ROLLBACK wrapper (see
      // migration-012.ts's own JSDoc @invariant) — a `links` table-recreate
      // widening the link_type CHECK constraint to accept "resolves", same
      // shape as migration-004's "governs" widening.
      try {
        this.db.exec(MIGRATION_012_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006/007/008/009/010 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 13 && 13 <= ceiling) {
      // reason: mirrors migration-006's catch/ROLLBACK/FK-restore wrapper (see
      // migration-013.ts's module JSDoc) — a `docs` table-recreate widening
      // the type CHECK to accept 'baseline', plus the rule_registry table, in
      // one BEGIN/COMMIT with `PRAGMA foreign_keys` toggled OUTSIDE it.
      try {
        this.db.exec(MIGRATION_013_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        // reason: BUG-010 — the SQL's `PRAGMA foreign_keys = OFF` is a
        // connection-level toggle that ROLLBACK does not undo; restore it so a
        // failed migration never leaves this handle FK-unenforced (identical
        // to the migration-006 branch above).
        try {
          this.db.exec("PRAGMA foreign_keys = ON");
        } catch {
          // reason: only throws on a closed/broken connection, where `error`
          // below is what the caller needs anyway.
        }
        throw error;
      }
    }

    if (currentVersion < 14 && 14 <= ceiling) {
      // reason: migration-014 (rule_registry lifecycle/version, ac_cites, rule_depends,
      // ac_exemptions + the docs_idx_* triggers) is one BEGIN/COMMIT with no PRAGMA toggles, so a
      // failure only needs ROLLBACK (see migration-014.ts's module JSDoc).
      try {
        this.db.exec(MIGRATION_014_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 15 && 15 <= ceiling) {
      // reason: migration-015 (rule_registry rebuilt with prefix + UNIQUE(prefix, n), triggers
      // re-created) is one BEGIN/COMMIT with no PRAGMA toggles — a failure only needs ROLLBACK.
      try {
        this.db.exec(MIGRATION_015_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 16 && 16 <= ceiling) {
      // reason: migration-016 is two-phase (see migration-016.ts's module JSDoc): the nullable
      // `harness_run` columns are added only where `PRAGMA table_info` lacks them (SQLite has no
      // ADD COLUMN IF NOT EXISTS), then one BEGIN/COMMIT string creates `runs` and bumps user_version.
      try {
        for (const { table, column, ddl } of MIGRATION_016_ADD_COLUMNS) {
          const cols = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
          if (!cols.some((c) => c.name === column)) this.db.exec(ddl);
        }
        this.db.exec(MIGRATION_016_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 17 && 17 <= ceiling) {
      // reason: migration-017 is two-phase like 016 (see migration-017.ts's module JSDoc): `runs.ended_at` /
      // `runs.end_reason` are added only where `PRAGMA table_info` lacks them, then one BEGIN/COMMIT bumps user_version.
      try {
        for (const { table, column, ddl } of MIGRATION_017_ADD_COLUMNS) {
          const cols = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
          if (!cols.some((c) => c.name === column)) this.db.exec(ddl);
        }
        this.db.exec(MIGRATION_017_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 18 && 18 <= ceiling) {
      // reason: migration-018 (rule_registry rebuilt so lifecycle may be 'proposed', triggers re-created) is one
      // BEGIN/COMMIT with no PRAGMA toggles, like 015 — a failure only needs ROLLBACK.
      try {
        this.db.exec(MIGRATION_018_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 19 && 19 <= ceiling) {
      // reason: migration-019 is two-phase like 017 (see migration-019.ts's module JSDoc): the nullable
      // `review_judgments.truncated` / `.truncation` columns are added only where `PRAGMA table_info` lacks
      // them, then one BEGIN/COMMIT bumps user_version.
      try {
        for (const { table, column, ddl } of MIGRATION_019_ADD_COLUMNS) {
          const cols = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
          if (!cols.some((c) => c.name === column)) this.db.exec(ddl);
        }
        this.db.exec(MIGRATION_019_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 20 && 20 <= ceiling) {
      // reason: migration-020 (decision_log + append-only triggers) is one idempotent BEGIN/COMMIT string.
      try {
        this.db.exec(MIGRATION_020_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 21 && 21 <= ceiling) {
      // reason: migration-021 is two-phase like 017/019 (see migration-021.ts's module JSDoc): the nullable
      // `runs.harness_pid` / `.harness_pid_start` / `.worktree` columns are added only where `PRAGMA table_info`
      // lacks them, then one BEGIN/COMMIT bumps user_version.
      try {
        for (const { table, column, ddl } of MIGRATION_021_ADD_COLUMNS) {
          const cols = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
          if (!cols.some((c) => c.name === column)) this.db.exec(ddl);
        }
        this.db.exec(MIGRATION_021_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 22 && 22 <= ceiling) {
      // reason: migration-022 (autonomy_thresholds) is one idempotent BEGIN/COMMIT string.
      try {
        this.db.exec(MIGRATION_022_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 23 && 23 <= ceiling) {
      // reason: migration-023 rebuilds decision_log with the widened verdict CHECK in ONE BEGIN/COMMIT string.
      try {
        this.db.exec(MIGRATION_023_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: same as migration-004/005/006 — safe to ignore, see above.
        }
        throw error;
      }
    }

    if (currentVersion < 24 && 24 <= ceiling) {
      // reason: migration-024 adds the nullable decision_log.detail column (plain ADD COLUMN; hashes stay valid).
      this.db.exec(MIGRATION_024_SQL);
    }

    if (currentVersion < 25 && 25 <= ceiling) {
      // reason: migration-025 adds the covering index AuditService.verify's narrow key read (listVersionKeys) is answered from.
      this.db.exec(MIGRATION_025_SQL);
    }

    if (currentVersion < 26 && 26 <= ceiling) {
      // reason: migration-026 rebuilds `versions` in ONE transaction so its action CHECK admits 'undelete'; a failed
      // step rolls back, leaves schema 25 and throws MigrationFailedError naming the step and this corpus path.
      applyMigration026(this.db, this.corpusPath);
    }
  }

  // ── Document CRUD ─────────────────────────────────────────────────────────

  /**
   * Synchronous core of {@link insert} — a single raw `INSERT` statement, no
   * transaction management. Extracted so {@link insertWithProvenance} can run
   * it inside its OWN `BEGIN IMMEDIATE`/`COMMIT` block without duplicating the
   * SQL literal (bun:sqlite is synchronous internally regardless of the async
   * public method signature, so a private sync helper composes cleanly with
   * either "no wrapper" (`insert`) or "wrapped in a bigger transaction"
   * (`insertWithProvenance`) callers).
   */
  private insertDocSync(doc: DocRecord): Result<DocRecord, LoreError> {
    try {
      const tagsJson = JSON.stringify(doc.tags);
      // reason: fts_title/fts_content/fts_tags (migration-008) are the CJK
      // bigram shadow columns docs_fts actually indexes — every INSERT MUST
      // compute and persist them alongside the real columns, or this doc is
      // silently unsearchable by CJK query bigrams until its next update.
      const shadow = computeFtsShadowValues(doc.title, doc.content, tagsJson);
      this.db
        .prepare(
          `INSERT INTO docs
             (id, slug, type, role, title, status, priority, content,
              parent_id, extra, tags, version, created_at, updated_at,
              created_by, deleted_at, fts_title, fts_content, fts_tags, ordinal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
        );
      return ok(doc);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("UNIQUE constraint failed: docs.slug")) {
        // The ONLY DUPLICATE_SLUG construction site in this file — every
        // public insert entry point (`insert`, `insertWithAllocatedOrdinal`,
        // `insertWithProvenance`, `insertWithAllocatedOrdinalAndProvenance`)
        // reaches the UNIQUE violation through this one helper, so the
        // conflict lookup below serves all four.
        const winnerId = this.findSlugConflictIdSync(doc.slug);
        if (winnerId === null) {
          // reason: the UNIQUE index just refused this INSERT, so at that
          // instant a row held `doc.slug`; finding none now means a
          // concurrent writer removed or renamed it between the refusal and
          // this lookup. ⛔ Never fall back to `doc.id` here — that WAS the
          // defect (`existing_id` named the rejected, never-persisted doc, so
          // every `get(existing_id)` answered DOC_NOT_FOUND). `existing_id`
          // is typed non-optional (`packages/core/src/errors.ts:15`), so a
          // conflict whose holder has vanished cannot be reported honestly
          // under DUPLICATE_SLUG at all; it is reported loudly as a
          // STORE_ERROR naming the race instead.
          return err({
            code: "STORE_ERROR",
            message:
              `slug '${doc.slug}' was refused by the docs.slug UNIQUE constraint, but no row holds ` +
              `it now — its holder was removed or renamed concurrently between the refusal and ` +
              `SQLiteStore.findSlugConflictIdSync's lookup. Retry the insert.`,
            // `exactOptionalPropertyTypes` — `cause` is `cause?: Error`, so a
            // non-Error throw must OMIT the key rather than set it undefined.
            ...(e instanceof Error ? { cause: e } : {}),
          });
        }
        return err({
          code: "DUPLICATE_SLUG",
          slug: doc.slug,
          existing_id: winnerId,
        });
      }
      return wrapStoreError(e);
    }
  }

  /**
   * Id of the doc that ALREADY holds `slug`, or `null` when no row does.
   *
   * Sole caller: {@link insertDocSync}'s `DUPLICATE_SLUG` branch, which needs
   * the WINNER's id — the field `existing_id` has always promised and, before
   * task-skill-implement-duplicate-slug-existing-id-names-the, never carried.
   * Sync (like every other query in this class) so `insertDocSync` can stay
   * sync and keep composing inside its callers' `BEGIN IMMEDIATE` blocks.
   *
   * ⛔ Deliberately does NOT filter `deleted_at`: `docs.slug` is UNIQUE at the
   * COLUMN level (`migrations/migration-006.ts:103`), not a partial index over
   * live rows, so a soft-deleted row still holds its slug and still raises the
   * violation. Adding `WHERE deleted_at IS NULL` would make this return `null`
   * while the INSERT is still refused, turning an honest DUPLICATE_SLUG into
   * the STORE_ERROR race branch. Locked by `AC-1.05 BOUNDARY` in
   * `tests/unit/store/sqlite-store.bun.test.ts`.
   *
   * Cross-store parity: {@link InMemoryStore.findSlugConflict} (`store/
   * in-memory-store.ts`) scans every doc including soft-deleted ones, and
   * `TursoStore.findSlugConflictId` issues this same unfiltered SELECT.
   */
  private findSlugConflictIdSync(slug: Slug): DocId | null {
    const row = this.db
      .prepare("SELECT id FROM docs WHERE slug = ?")
      .get(slug) as { id: string } | null;
    return row === null ? null : (row.id as DocId);
  }

  async insert(doc: DocRecord): Promise<Result<DocRecord, LoreError>> {
    return this.insertDocSync(doc);
  }

  /**
   * @see StoreInterface.insertWithAllocatedOrdinal
   *
   * Transaction-scoped: `SELECT MAX(ordinal)+1 WHERE type=?` computed ONCE,
   * then delegated to the shared {@link allocateWithBoundedRetry} seam
   * (`store-shared.ts`) for the bounded-attempt/exhaustion mechanics — see
   * that function's JSDoc for why the base is computed once and never
   * re-queried mid-loop. `BEGIN IMMEDIATE` gets its own try/catch (mirrors
   * `insertWithProvenance`'s identical split) so a synchronous
   * open-transaction throw returns `err(STORE_ERROR)` without attempting a
   * ROLLBACK on a transaction that never opened.
   */
  async insertWithAllocatedOrdinal(doc: DocRecord): Promise<Result<DocRecord, LoreError>> {
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const maxRow = this.db
        .prepare("SELECT MAX(ordinal) as maxOrdinal FROM docs WHERE type = ?")
        .get(doc.type) as { maxOrdinal: number | bigint | null };
      const base = maxRow.maxOrdinal === null ? 0 : Number(maxRow.maxOrdinal);

      const result = await allocateWithBoundedRetry<DocRecord>(base, doc.type, async (candidate) => {
        const insertResult = this.insertDocSync({ ...doc, ordinal: candidate });
        if (insertResult.ok) {
          return { kind: "success", value: insertResult.value };
        }
        if (
          insertResult.error.code === "STORE_ERROR" &&
          isOrdinalUniqueViolationMessage(insertResult.error.message)
        ) {
          return { kind: "collision" };
        }
        // reason: a non-ordinal failure (e.g. DUPLICATE_SLUG, or a driver
        // error unrelated to the ordinal index) must propagate immediately
        // — retrying with a different ordinal candidate would never fix it.
        return { kind: "error", error: insertResult.error };
      });

      if (result.ok) {
        this.db.run("COMMIT");
      } else {
        this.db.run("ROLLBACK");
      }
      return result;
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: ROLLBACK itself throws only when there is no open
        // transaction to roll back — safe to ignore, `e` below is what the
        // caller needs. Mirrors insertWithProvenance's identical guard.
      }
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.allocateOrdinalForExisting
   *
   * The UPDATE-scoped sibling of {@link insertWithAllocatedOrdinal} — refuses
   * a row that already carries an ordinal (checked BEFORE the CAS version
   * comparison, so an already-numbered row is refused regardless of whether
   * `expectedVersion` happens to match — SPEC-084's "the store method itself
   * refuses a row that already has one" immutability guard), then CAS-guards
   * on `expectedVersion` (mismatch → `STALE_VERSION`), then delegates to the
   * SAME shared {@link allocateWithBoundedRetry} seam via a conditional
   * `UPDATE ... WHERE id = ? AND version = ? AND ordinal IS NULL`.
   */
  async allocateOrdinalForExisting(
    id: DocId,
    expectedVersion: number,
  ): Promise<Result<DocRecord, LoreError>> {
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const existingRow = this.db
        .prepare("SELECT * FROM docs WHERE id = ?")
        .get(id) as DocRow | null;

      if (!existingRow) {
        this.db.run("ROLLBACK");
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const current = rowToDocRecord(existingRow);
      if (current.ordinal !== null && current.ordinal !== undefined) {
        this.db.run("ROLLBACK");
        return err({
          code: "STORE_ERROR",
          message: `doc ${id} already carries ordinal ${current.ordinal}; allocateOrdinalForExisting refuses to overwrite an already-allocated ordinal`,
        });
      }

      if (current.version !== expectedVersion) {
        this.db.run("ROLLBACK");
        return err({
          code: "STALE_VERSION",
          id,
          expected: expectedVersion,
          actual: current.version,
        });
      }

      const maxRow = this.db
        .prepare("SELECT MAX(ordinal) as maxOrdinal FROM docs WHERE type = ?")
        .get(current.type) as { maxOrdinal: number | bigint | null };
      const base = maxRow.maxOrdinal === null ? 0 : Number(maxRow.maxOrdinal);
      const newVersion = expectedVersion + 1;

      const result = await allocateWithBoundedRetry<DocRecord>(
        base,
        current.type,
        async (candidate) => {
          try {
            const updateResult = this.db
              .prepare(
                "UPDATE docs SET ordinal = ?, version = ? WHERE id = ? AND version = ? AND ordinal IS NULL",
              )
              .run(candidate, newVersion, id, expectedVersion);

            if (updateResult.changes > 0) {
              return {
                kind: "success",
                value: { ...current, ordinal: candidate, version: newVersion },
              };
            }
            // reason: zero rows affected under an already-open BEGIN
            // IMMEDIATE transaction (which holds the write lock for this
            // connection's whole call) means the row changed between our
            // SELECT and this UPDATE only if some OTHER code path mutated
            // it — unreachable in practice on a single-connection store,
            // but treated as a stale read rather than silently retried
            // forever.
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
        this.db.run("COMMIT");
      } else {
        this.db.run("ROLLBACK");
      }
      return result;
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: same as insertWithAllocatedOrdinal — safe to ignore, see above.
      }
      return wrapStoreError(e);
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
    return this.assignOrdinalForRepairTx(id, ordinal, undefined);
  }

  /**
   * @see StoreInterface.assignOrdinalForRepairWithProvenance
   * The same transaction as {@link assignOrdinalForRepair}, with the version row and audit row inside it: a
   * failure of either (a version-key collision, an audit-chain error) rolls the ordinal write back too.
   */
  async assignOrdinalForRepairWithProvenance(
    id: DocId,
    ordinal: number,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    return this.assignOrdinalForRepairTx(id, ordinal, { version, audit });
  }

  private async assignOrdinalForRepairTx(
    id: DocId,
    ordinal: number,
    provenance: { readonly version: VersionRecord; readonly audit: AuditEntry } | undefined,
  ): Promise<Result<DocRecord, LoreError>> {
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const existingRow = this.db
        .prepare("SELECT * FROM docs WHERE id = ?")
        .get(id) as DocRow | null;

      if (!existingRow) {
        this.db.run("ROLLBACK");
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const current = rowToDocRecord(existingRow);

      if (!ORDINAL_REGISTERED_TYPES.includes(current.type as OrdinalDocType)) {
        this.db.run("ROLLBACK");
        return err({
          code: "STORE_ERROR",
          message: `assignOrdinalForRepair refuses doc ${id}: type "${current.type}" is not an ordinal-registered type`,
        });
      }

      if (current.ordinal !== null && current.ordinal !== undefined) {
        if (current.ordinal === ordinal) {
          // Idempotent no-op — a repeat repair call at the SAME target
          // succeeds without touching the row (mirrors migration
          // idempotency elsewhere in this codebase).
          this.db.run("ROLLBACK");
          return ok(current);
        }
        this.db.run("ROLLBACK");
        return err({
          code: "STORE_ERROR",
          message: `doc ${id} already carries ordinal ${current.ordinal}; assignOrdinalForRepair refuses to overwrite it with a DIFFERENT value ${ordinal}`,
        });
      }

      const newVersion = current.version + 1;
      try {
        this.db
          .prepare("UPDATE docs SET ordinal = ?, version = ? WHERE id = ? AND ordinal IS NULL")
          .run(ordinal, newVersion, id);
      } catch (e) {
        this.db.run("ROLLBACK");
        return wrapStoreError(e);
      }

      if (provenance !== undefined) {
        if (provenance.version.version !== newVersion) {
          this.db.run("ROLLBACK");
          return err({ code: "STALE_VERSION", id, expected: provenance.version.version - 1, actual: current.version });
        }
        const versionResult = this.insertVersionSync(provenance.version);
        if (!versionResult.ok) {
          this.db.run("ROLLBACK");
          return versionResult;
        }
        const auditResult = this.appendAuditEntrySync(provenance.audit);
        if (!auditResult.ok) {
          this.db.run("ROLLBACK");
          return auditResult;
        }
      }

      this.db.run("COMMIT");
      return ok({ ...current, ordinal, version: newVersion });
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: ROLLBACK itself throws only when there is no open
        // transaction to roll back — safe to ignore (mirrors
        // insertWithAllocatedOrdinal's identical guard).
      }
      return wrapStoreError(e);
    }
  }

  async find(id: DocId): Promise<Result<DocRecord | null, LoreError>> {
    try {
      const row = this.db
        .prepare("SELECT * FROM docs WHERE id = ?")
        .get(id) as DocRow | null;
      return ok(row ? rowToDocRecord(row) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findBySlug(slug: Slug): Promise<Result<DocRecord | null, LoreError>> {
    try {
      const row = this.db
        .prepare("SELECT * FROM docs WHERE slug = ?")
        .get(slug) as DocRow | null;
      return ok(row ? rowToDocRecord(row) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.findByIdPrefix
   * SQLite's `LIKE` is case-insensitive for ASCII by default, which is the
   * exact matching semantics the interface contract asks for — no manual
   * `UPPER()` needed. `prefix` is never string-interpolated (bound param);
   * no escaping of `%`/`_` wildcard chars is needed either since a real ULID
   * only ever contains Crockford base32 chars, which can't smuggle a
   * wildcard even from an attacker-controlled prefix.
   */
  async findByIdPrefix(prefix: string): Promise<Result<DocRecord[], LoreError>> {
    try {
      const rows = this.db
        .prepare("SELECT * FROM docs WHERE id LIKE ? AND deleted_at IS NULL")
        .all(`${prefix}%`) as DocRow[];
      return ok(rows.map(rowToDocRecord));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.findByTypeOrdinal
   * Direct-address lookup — deliberately does NOT filter `deleted_at`
   * (mirrors `find`/`findByIds`), unlike the discovery-shaped
   * {@link findByIdPrefix} above.
   */
  async findByTypeOrdinal(
    type: DocType,
    ordinal: number,
  ): Promise<Result<DocRecord | null, LoreError>> {
    try {
      const row = this.db
        .prepare("SELECT * FROM docs WHERE type = ? AND ordinal = ?")
        .get(type, ordinal) as DocRow | null;
      return ok(row ? rowToDocRecord(row) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findByIds(ids: DocId[]): Promise<Result<Map<DocId, DocRecord>, LoreError>> {
    const byId = new Map<DocId, DocRecord>();
    if (ids.length === 0) return ok(byId);
    try {
      const placeholders = ids.map(() => "?").join(", ");
      const rows = this.db
        .prepare(`SELECT * FROM docs WHERE id IN (${placeholders})`)
        .all(...(ids as SQLQueryBindings[])) as DocRow[];
      for (const row of rows) {
        const doc = rowToDocRecord(row);
        byId.set(doc.id, doc);
      }
      return ok(byId);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>> {
    try {
      const clauses: string[] = [];
      const params: SQLQueryBindings[] = [];
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
      // reason: `sub_type` lives in the `extra` JSON column, so it needs
      // json_extract rather than a bare column compare — but it belongs in the
      // SQL WHERE clause, NOT in an in-memory pass like `tags` below, because it
      // must narrow the row set BEFORE LIMIT/OFFSET binds the page window.
      // Filtering after the window would return fewer rows than `limit` asked
      // for while more matches sat past the offset (StoreFilters.sub_type's own
      // ⛔ note). Bound as a parameter, never interpolated.
      if (filters.sub_type !== undefined) {
        clauses.push("json_extract(extra, '$.sub_type') = ?");
        params.push(filters.sub_type);
      }

      const whereClause =
        clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

      // reason: `tags` is filtered IN-MEMORY below (JSON-stored column, no SQL
      // index) — pushing LIMIT/OFFSET into SQL while a tags filter is active
      // would apply the page boundary BEFORE the tags filter narrows the row
      // set, silently truncating or misaligning pages. Only push LIMIT/OFFSET
      // into SQL when the WHERE clause alone determines row membership; when
      // tags are involved, paging is re-applied in-memory after the tags
      // filter runs (see below).
      const limitParts: string[] = [];
      if (!hasTagsFilter) {
        if (filters.limit !== undefined) {
          limitParts.push("LIMIT ?");
          params.push(filters.limit);
        } else if (filters.offset !== undefined) {
          // reason: SQLite requires a LIMIT to use OFFSET; -1 means "no limit"
          // (offset-only paging, e.g. StoreFilters.offset without .limit).
          limitParts.push("LIMIT -1");
        }
        if (filters.offset !== undefined) {
          limitParts.push("OFFSET ?");
          params.push(filters.offset);
        }
      }
      const limitClause = limitParts.join(" ");

      const sql = `SELECT * FROM docs ${whereClause} ORDER BY updated_at DESC, id ASC ${limitClause}`;
      const rows = this.db.prepare(sql).all(...params) as DocRow[];
      let records = rows.map(rowToDocRecord);

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
   * Synchronous core of {@link update} — see {@link insertDocSync}'s JSDoc for
   * why this split exists ({@link updateWithProvenance} reuses it inside a
   * transaction). Behavior is otherwise byte-identical to the pre-split
   * `update` body.
   *
   * Apply a partial patch to an existing doc.
   * When opts.expected_version is provided, the UPDATE includes AND version = ?
   * (conditional CAS). If zero rows are affected:
   *   - row absent → DOC_NOT_FOUND
   *   - row present with different version → STALE_VERSION{id, expected, actual}
   * When opts is omitted or expected_version is not set, unconditional update.
   * @see UpdateOpts for full contract.
   */
  private updateDocSync(
    id: DocId,
    patch: Partial<DocRecord>,
    opts?: UpdateOpts,
  ): Result<DocRecord, LoreError> {
    try {
      const existingRow = this.db
        .prepare("SELECT * FROM docs WHERE id = ?")
        .get(id) as DocRow | null;

      if (!existingRow) {
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const current = rowToDocRecord(existingRow);
      const updated: DocRecord = {
        ...current,
        ...patch,
        id: current.id, // id is immutable
      };
      const updatedTagsJson = JSON.stringify(updated.tags);
      // reason: same shadow-column obligation as insertDocSync — an UPDATE
      // that skips this leaves fts_title/fts_content/fts_tags reflecting the
      // PRE-patch text, so CJK search on the new title/content silently
      // misses until some LATER write happens to touch this doc again.
      const shadow = computeFtsShadowValues(updated.title, updated.content, updatedTagsJson);

      if (opts?.expected_version !== undefined) {
        // Conditional UPDATE: only affects the row if version still matches
        const result = this.db
          .prepare(
            `UPDATE docs SET
               slug = ?, type = ?, role = ?, title = ?, status = ?,
               priority = ?, content = ?, parent_id = ?, extra = ?,
               tags = ?, version = ?, created_at = ?, updated_at = ?,
               created_by = ?, deleted_at = ?, fts_title = ?, fts_content = ?,
               fts_tags = ?
             WHERE id = ? AND version = ?`,
          )
          .run(
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
          );

        if (result.changes === 0) {
          // Row exists (checked above) but version didn't match — re-read actual version
          const actualRow = this.db
            .prepare("SELECT version FROM docs WHERE id = ?")
            .get(id) as { version: number } | null;

          if (!actualRow) {
            // Deleted between our SELECT and the UPDATE (race) — treat as not found
            return err({ code: "DOC_NOT_FOUND", id });
          }

          return err({
            code: "STALE_VERSION",
            id,
            expected: opts.expected_version,
            actual: actualRow.version,
          });
        }

        return ok(updated);
      }

      // Unconditional UPDATE — backward-compatible path
      this.db
        .prepare(
          `UPDATE docs SET
             slug = ?, type = ?, role = ?, title = ?, status = ?,
             priority = ?, content = ?, parent_id = ?, extra = ?,
             tags = ?, version = ?, created_at = ?, updated_at = ?,
             created_by = ?, deleted_at = ?, fts_title = ?, fts_content = ?,
             fts_tags = ?
           WHERE id = ?`,
        )
        .run(
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
        );

      return ok(updated);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async update(
    id: DocId,
    patch: Partial<DocRecord>,
    opts?: UpdateOpts,
  ): Promise<Result<DocRecord, LoreError>> {
    return this.updateDocSync(id, patch, opts);
  }

  /**
   * Synchronous core of {@link softDelete} — see {@link insertDocSync}'s
   * JSDoc for why this split exists ({@link softDeleteWithProvenance} reuses
   * it inside a transaction).
   */
  private softDeleteDocSync(id: DocId): Result<void, LoreError> {
    try {
      const existing = this.db
        .prepare("SELECT id FROM docs WHERE id = ?")
        .get(id) as { id: string } | null;

      if (!existing) {
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE docs SET deleted_at = ? WHERE id = ?")
        .run(now, id);

      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async softDelete(id: DocId): Promise<Result<void, LoreError>> {
    return this.softDeleteDocSync(id);
  }

  // ── Links ─────────────────────────────────────────────────────────────────

  async addLink(link: LinkRecord): Promise<Result<LinkRecord, LoreError>> {
    try {
      if (link.link_type === "parent") {
        const cycleResult = await this.detectParentCycle(link.from_id, link.to_id);
        if (!cycleResult.ok) return cycleResult;
      }

      this.db
        .prepare(
          `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          link.from_id,
          link.to_id,
          link.link_type,
          link.created_at,
          link.created_by,
        );

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
   * Synchronous core of {@link addLink}'s INSERT — see {@link insertDocSync}'s JSDoc for why this
   * split exists ({@link addLinkWithProvenance} reuses it inside a transaction). The cycle check is
   * NOT here: it is async (shared walk) and must run before a transaction opens.
   */
  private insertLinkSync(link: LinkRecord): Result<LinkRecord, LoreError> {
    try {
      this.db
        .prepare(
          `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(link.from_id, link.to_id, link.link_type, link.created_at, link.created_by);
      return ok(link);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("UNIQUE constraint failed: links.")) {
        return err({ code: "DUPLICATE_LINK", from: link.from_id, to: link.to_id, type: link.link_type });
      }
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.addLinkWithProvenance
   */
  async addLinkWithProvenance(
    link: LinkRecord,
    audit: AuditEntry,
  ): Promise<Result<LinkRecord, LoreError>> {
    // reason: the cycle walk is async (shared with TursoStore) so it runs BEFORE BEGIN IMMEDIATE — an
    // `await` inside the transaction would let another caller's statements interleave on this one
    // connection. Same ordering `addLink` always had (check, then write).
    if (link.link_type === "parent") {
      const cycleResult = await this.detectParentCycle(link.from_id, link.to_id);
      if (!cycleResult.ok) return cycleResult;
    }
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const linkResult = this.insertLinkSync(link);
      if (!linkResult.ok) {
        this.db.run("ROLLBACK");
        return linkResult;
      }

      if (link.link_type === "parent") {
        const updateResult = this.updateDocSync(link.from_id, {
          parent_id: link.to_id,
          updated_at: link.created_at,
        });
        if (!updateResult.ok) {
          this.db.run("ROLLBACK");
          return updateResult;
        }
      }

      const auditResult = this.appendAuditEntrySync(audit);
      if (!auditResult.ok) {
        this.db.run("ROLLBACK");
        return auditResult;
      }

      this.db.run("COMMIT");
      return ok(link);
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: same as updateWithProvenance — ROLLBACK throws only when the transaction is already gone.
      }
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.setDocParentWithProvenance
   */
  async setDocParentWithProvenance(
    id: DocId,
    parentId: DocId | null,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const updateResult = this.updateDocSync(id, { parent_id: parentId, updated_at: audit.timestamp });
      if (!updateResult.ok) {
        this.db.run("ROLLBACK");
        return updateResult;
      }
      if (parentId === null) {
        this.db.prepare("DELETE FROM links WHERE from_id = ? AND link_type = 'parent'").run(id);
      }
      const auditResult = this.appendAuditEntrySync(audit);
      if (!auditResult.ok) {
        this.db.run("ROLLBACK");
        return auditResult;
      }
      this.db.run("COMMIT");
      return updateResult;
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: same as addLinkWithProvenance — ROLLBACK throws only when the transaction is already gone.
      }
      return wrapStoreError(e);
    }
  }

  /**
   * Detect whether adding a parent link from_id → to_id would create a cycle.
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
      const row = this.db
        .prepare(
          `SELECT COALESCE(
             (SELECT to_id FROM links WHERE from_id = docs.id AND link_type = 'parent' LIMIT 1),
             docs.parent_id
           ) AS parent_id
           FROM docs WHERE docs.id = ?`,
        )
        .get(id) as { parent_id: string | null } | null;
      return row?.parent_id ?? null;
    });
  }

  async removeLink(
    fromId: DocId,
    toId: DocId,
    linkType: LinkType,
  ): Promise<Result<void, LoreError>> {
    try {
      this.db
        .prepare(
          "DELETE FROM links WHERE from_id = ? AND to_id = ? AND link_type = ?",
        )
        .run(fromId, toId, linkType);
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
      let rows: LinkRow[];

      if (direction === "out") {
        rows = this.db
          .prepare("SELECT * FROM links WHERE from_id = ?")
          .all(docId) as LinkRow[];
      } else if (direction === "in") {
        rows = this.db
          .prepare("SELECT * FROM links WHERE to_id = ?")
          .all(docId) as LinkRow[];
      } else {
        rows = this.db
          .prepare("SELECT * FROM links WHERE from_id = ? OR to_id = ?")
          .all(docId, docId) as LinkRow[];
      }

      return ok(rows.map(rowToLinkRecord));
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
      const placeholders = toIds.map(() => "?").join(", ");
      const rows = this.db
        .prepare(
          `SELECT * FROM links WHERE to_id IN (${placeholders}) AND link_type = ?`,
        )
        .all(...(toIds as SQLQueryBindings[]), linkType) as LinkRow[];
      return ok(rows.map(rowToLinkRecord));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async countLinksByToIds(toIds: DocId[]): Promise<Result<Map<DocId, number>, LoreError>> {
    const counts = new Map<DocId, number>();
    if (toIds.length === 0) return ok(counts);
    try {
      const placeholders = toIds.map(() => "?").join(", ");
      const rows = this.db
        .prepare(
          `SELECT to_id, COUNT(*) AS cnt FROM links WHERE to_id IN (${placeholders}) GROUP BY to_id`,
        )
        .all(...(toIds as SQLQueryBindings[])) as { to_id: string; cnt: number | bigint }[];
      for (const row of rows) {
        counts.set(row.to_id, Number(row.cnt));
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
      const placeholders = fromIds.map(() => "?").join(", ");
      const rows = this.db
        .prepare(`SELECT * FROM links WHERE from_id IN (${placeholders})`)
        .all(...(fromIds as SQLQueryBindings[])) as LinkRow[];
      for (const row of rows) {
        const link = rowToLinkRecord(row);
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

  // ── Search ────────────────────────────────────────────────────────────────

  async search(
    query: string,
    filters?: StoreFilters,
  ): Promise<Result<SearchHit[], LoreError>> {
    try {
      const safeQuery = escapeFtsQuery(query);
      // reason: FTS5 MATCH errors on empty expression — short-circuit here so
      // we never pass an empty string to SQLite. Callers expect empty query →
      // zero results, not an error. See SPEC-013 §3.5.
      if (safeQuery === "") return ok([]);

      const excludeDeleted = filters?.exclude_deleted !== false;

      // Build WHERE clause for docs table join
      const docClauses: string[] = [];
      const docParams: SQLQueryBindings[] = [];

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
      // reason: same store-level predicate findMany applies (see its
      // json_extract comment) — the FTS5 MATCH joins the `docs` table, so the
      // sub_type narrowing rides that join's WHERE rather than filtering the hit
      // list afterwards. `lore search --limit` is a post-fetch slice in the CLI,
      // so an adapter-side filter would cut the ranked hits to N rows and only
      // THEN drop the non-matching ones (AC-RR-7's --limit 1 oracle fails that).
      if (filters?.sub_type !== undefined) {
        docClauses.push("json_extract(d.extra, '$.sub_type') = ?");
        docParams.push(filters.sub_type);
      }

      const docWhere =
        docClauses.length > 0 ? `AND ${docClauses.join(" AND ")}` : "";

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

      const rows = this.db
        .prepare(sql)
        .all(
          SNIPPET_MARK_OPEN,
          SNIPPET_MARK_CLOSE,
          safeQuery,
          ...docParams,
        ) as FtsRow[];

      // SPEC-043 D3 — rowToSearchHit also populates created_at + the narrow
      // validity projection (review S3, zero N+1 per-hit fetches).
      const hits: SearchHit[] = rows.map(rowToSearchHit);

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

  // ── Versions ──────────────────────────────────────────────────────────────

  /**
   * Synchronous core of {@link insertVersion} — see {@link insertDocSync}'s
   * JSDoc for why this split exists (both composite provenance methods reuse
   * it inside a transaction).
   */
  private insertVersionSync(version: VersionRecord): Result<VersionRecord, LoreError> {
    try {
      this.db
        .prepare(
          `INSERT INTO versions
             (doc_id, version, content, extra, status, title,
              action, created_at, created_by, change_summary, slug, harness_run)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
          version.harness_run ?? null,
        );
      return ok(version);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async insertVersion(version: VersionRecord): Promise<Result<VersionRecord, LoreError>> {
    return this.insertVersionSync(version);
  }

  async findVersions(
    docId: DocId,
    opts?: { limit?: number; offset?: number },
  ): Promise<Result<VersionRecord[], LoreError>> {
    try {
      const limit = opts?.limit ?? 100;
      const offset = opts?.offset ?? 0;
      const rows = this.db
        .prepare(
          `SELECT * FROM versions
           WHERE doc_id = ?
           ORDER BY version DESC
           LIMIT ? OFFSET ?`,
        )
        .all(docId, limit, offset) as VersionRow[];
      return ok(rows.map(rowToVersionRecord));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listAllVersions(since?: string): Promise<Result<VersionRecord[], LoreError>> {
    try {
      const rows =
        since !== undefined
          ? (this.db
              .prepare(`SELECT * FROM versions WHERE created_at >= ? ORDER BY created_at ASC`)
              .all(since) as VersionRow[])
          : (this.db.prepare(`SELECT * FROM versions ORDER BY created_at ASC`).all() as VersionRow[]);
      return ok(rows.map(rowToVersionRecord));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listVersionKeys(since?: string): Promise<Result<VersionKey[], LoreError>> {
    try {
      // reason: the four selected columns are exactly the columns of idx_versions_keys (migration-025), so SQLite
      // answers this from the index alone and never reads a versions row's content/extra pages.
      const rows =
        since !== undefined
          ? (this.db
              .prepare(`SELECT doc_id, version, action, created_at FROM versions WHERE created_at >= ? ORDER BY created_at ASC`)
              .all(since) as VersionKeyRow[])
          : (this.db.prepare(`SELECT doc_id, version, action, created_at FROM versions ORDER BY created_at ASC`).all() as VersionKeyRow[]);
      return ok(rows.map(rowToVersionKey));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  /**
   * Synchronous core of {@link appendAuditEntry} — see {@link insertDocSync}'s
   * JSDoc for why this split exists (both composite provenance methods reuse
   * it inside a transaction).
   *
   * SPEC-079 G3 — reads the current chain head (`entry_hash` of the highest
   * `id` row, or `""` if the table is empty) and computes this entry's own
   * `entry_hash` via {@link computeAuditEntryHash} BEFORE inserting, so
   * `prev_hash`/`entry_hash` are always populated together with the row
   * itself. This method assumes it runs INSIDE an already-open transaction
   * (either {@link appendAuditEntry}'s own `BEGIN IMMEDIATE` wrapper for a
   * standalone call, or the outer transaction one of the three
   * `*WithProvenance` methods already holds) — the head-read and the insert
   * happen back-to-back with no intervening `await` on this single
   * synchronous `bun:sqlite` connection, and the surrounding transaction is
   * what makes that atomic against a second PROCESS writing the same file
   * concurrently (bun:sqlite's `BEGIN IMMEDIATE` takes the write lock
   * immediately, so a second writer's own `BEGIN IMMEDIATE` blocks — up to
   * `PRAGMA busy_timeout` — until this one commits or rolls back).
   */
  private appendAuditEntrySync(rawEntry: AuditEntry): Result<void, LoreError> {
    try {
      const entry = stampAuditSurface(rawEntry);
      const headRow = this.db
        .query("SELECT entry_hash FROM audit ORDER BY id DESC LIMIT 1")
        .get() as { entry_hash: string | null } | null;
      const prevHash = headRow?.entry_hash ?? "";
      const entryHash = computeAuditEntryHash(entry, prevHash);
      this.db
        .prepare(
          `INSERT INTO audit
             (timestamp, actor, session_id, action, doc_id, details, prev_hash, entry_hash, harness_run)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.timestamp,
          entry.actor,
          entry.session_id,
          entry.action,
          entry.doc_id ?? null,
          JSON.stringify(entry.details ?? {}),
          prevHash,
          entryHash,
          entry.harness_run ?? null,
        );
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.appendAuditEntry
   *
   * Wraps {@link appendAuditEntrySync} in its OWN `BEGIN IMMEDIATE`/`COMMIT`
   * — unlike the three `*WithProvenance` methods (which already hold an
   * outer transaction when they call the sync helper), a standalone
   * `appendAuditEntry` call has no existing transaction, so the head-read +
   * insert sequencing this method's JSDoc describes needs one opened here.
   */
  async appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>> {
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const result = this.appendAuditEntrySync(entry);
      if (!result.ok) {
        this.db.run("ROLLBACK");
        return result;
      }
      this.db.run("COMMIT");
      return result;
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: ROLLBACK itself throws only when there is no open
        // transaction to roll back — safe to ignore, `e` below is what the
        // caller needs. Mirrors insertWithProvenance's identical guard.
      }
      return wrapStoreError(e);
    }
  }

  // ── Provenance-atomic composite writes (BUG-002) ──────────────────────────

  /**
   * @see StoreInterface.insertWithProvenance
   */
  async insertWithProvenance(
    doc: DocRecord,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    // `BEGIN IMMEDIATE` gets its OWN try/catch, separate from the body below:
    // a synchronous bun:sqlite throw here (e.g. SQLITE_IOERR_VNODE on a
    // corpus file deleted out from under an open handle — observed live via
    // SPEC-078 T2's multi-project mount probe) means no transaction was ever
    // opened, so the body's ROLLBACK-on-catch must NOT run for it (ROLLBACK
    // with nothing open is itself an error bun:sqlite would throw).
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const insertResult = this.insertDocSync(doc);
      if (!insertResult.ok) {
        this.db.run("ROLLBACK");
        return insertResult;
      }

      const versionResult = this.insertVersionSync(version);
      if (!versionResult.ok) {
        this.db.run("ROLLBACK");
        return versionResult;
      }

      const auditResult = this.appendAuditEntrySync(audit);
      if (!auditResult.ok) {
        this.db.run("ROLLBACK");
        return auditResult;
      }

      this.db.run("COMMIT");
      return ok(insertResult.value);
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: ROLLBACK itself throws only when there is no open
        // transaction to roll back — safe to ignore, `e` below is what the
        // caller needs. Mirrors runMigrations' identical catch/ROLLBACK guard.
      }
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.insertWithAllocatedOrdinalAndProvenance
   *
   * Combines {@link insertWithAllocatedOrdinal}'s MAX+1/bounded-retry
   * allocation with {@link insertWithProvenance}'s doc+version+audit
   * atomicity — ONE `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` block wraps the
   * MAX query, the bounded-retry insert loop (via the shared
   * `allocateWithBoundedRetry` seam), and the subsequent version/audit
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
    // `BEGIN IMMEDIATE` gets its OWN try/catch — see insertWithProvenance's
    // identical split for why (a synchronous open-transaction throw means no
    // transaction was ever opened, so the body's ROLLBACK-on-catch must not
    // run for it).
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const maxRow = this.db
        .prepare("SELECT MAX(ordinal) as maxOrdinal FROM docs WHERE type = ?")
        .get(doc.type) as { maxOrdinal: number | bigint | null };
      const base = maxRow.maxOrdinal === null ? 0 : Number(maxRow.maxOrdinal);

      const allocResult = await allocateWithBoundedRetry<DocRecord>(base, doc.type, async (candidate) => {
        const insertResult = this.insertDocSync({ ...doc, ordinal: candidate });
        if (insertResult.ok) {
          return { kind: "success", value: insertResult.value };
        }
        if (
          insertResult.error.code === "STORE_ERROR" &&
          isOrdinalUniqueViolationMessage(insertResult.error.message)
        ) {
          return { kind: "collision" };
        }
        // reason: a non-ordinal failure (e.g. DUPLICATE_SLUG) must propagate
        // immediately — retrying with a different ordinal candidate would
        // never fix it. Mirrors insertWithAllocatedOrdinal's identical guard.
        return { kind: "error", error: insertResult.error };
      });

      if (!allocResult.ok) {
        this.db.run("ROLLBACK");
        return allocResult;
      }

      const versionResult = this.insertVersionSync(version);
      if (!versionResult.ok) {
        this.db.run("ROLLBACK");
        return versionResult;
      }

      const auditResult = this.appendAuditEntrySync(audit);
      if (!auditResult.ok) {
        this.db.run("ROLLBACK");
        return auditResult;
      }

      this.db.run("COMMIT");
      return ok(allocResult.value);
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: ROLLBACK itself throws only when there is no open
        // transaction to roll back — safe to ignore, `e` below is what the
        // caller needs. Mirrors insertWithProvenance's identical catch/ROLLBACK guard.
      }
      return wrapStoreError(e);
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
    extras?: ProvenanceWriteExtras,
  ): Promise<Result<DocRecord, LoreError>> {
    // See insertWithProvenance's identical split above: BEGIN IMMEDIATE gets
    // its own try/catch so a synchronous open-transaction throw returns
    // err(STORE_ERROR) without attempting a ROLLBACK on a transaction that
    // never opened.
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      // reason: D6 / QA-2 — the citation gate's liveness read MUST run after BEGIN IMMEDIATE (the
      // write lock is held), so a concurrent retire either committed before this read (we see
      // `retired` and refuse) or waits for this commit. Hoisting this above the BEGIN reopens the
      // check-then-write window (cite-retire-race.bun.test.ts goes red).
      if (extras?.require_live_rules !== undefined && extras.require_live_rules.length > 0) {
        const refusal = buildNonLiveRuleRefusal(
          id,
          extras.require_live_rules.map((ruleId) => ({
            rule_id: ruleId,
            lifecycle: this.readRegistryLifecycleSync(ruleId),
          })),
        );
        if (refusal !== null) {
          this.db.run("ROLLBACK");
          return err(refusal);
        }
      }
      const updateResult = this.updateDocSync(id, patch, opts);
      if (!updateResult.ok) {
        // reason: DOC_NOT_FOUND / STALE_VERSION — the doc write touched zero
        // rows, so there is nothing to roll back beyond releasing the
        // transaction started above.
        this.db.run("ROLLBACK");
        return updateResult;
      }

      const versionResult = this.insertVersionSync(version);
      if (!versionResult.ok) {
        this.db.run("ROLLBACK");
        return versionResult;
      }

      const auditResult = this.appendAuditEntrySync(audit);
      if (!auditResult.ok) {
        this.db.run("ROLLBACK");
        return auditResult;
      }

      for (const extraAudit of extras?.also_audit ?? []) {
        const extraResult = this.appendAuditEntrySync(extraAudit);
        if (!extraResult.ok) {
          this.db.run("ROLLBACK");
          return extraResult;
        }
      }

      // reason: BR-1307 — companion doc writes (a spec's rule retirements on its baseline leaves) share this
      // transaction; the registry rows follow the leaf writes through the docs triggers.
      for (const companion of extras?.also_update ?? []) {
        const companionUpdate = this.updateDocSync(companion.id, companion.patch, companion.opts);
        if (!companionUpdate.ok) {
          this.db.run("ROLLBACK");
          return companionUpdate;
        }
        const companionVersion = this.insertVersionSync(companion.version);
        if (!companionVersion.ok) {
          this.db.run("ROLLBACK");
          return companionVersion;
        }
        const companionAudit = this.appendAuditEntrySync(companion.audit);
        if (!companionAudit.ok) {
          this.db.run("ROLLBACK");
          return companionAudit;
        }
      }

      this.db.run("COMMIT");
      return ok(updateResult.value);
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: same as insertWithProvenance — safe to ignore, see above.
      }
      return wrapStoreError(e);
    }
  }

  /**
   * One rule's `rule_registry.lifecycle` (migration-014), or `null` when no registry row exists.
   * Synchronous so it can run inside an open transaction; callers hold the write lock.
   */
  private readRegistryLifecycleSync(ruleId: string): string | null {
    const row = this.db
      .prepare("SELECT lifecycle FROM rule_registry WHERE id = ?")
      .get(ruleId) as { lifecycle: string } | null;
    return row === null ? null : row.lifecycle;
  }

  /**
   * The `version` of a live doc, read inside the caller's open transaction; `null` for a missing or soft-deleted
   * doc (the proposed-id reservation then rolls back rather than register an id against a leaf that is gone).
   */
  private readDocVersionSync(docId: DocId): number | null {
    const row = this.db
      .prepare("SELECT version, deleted_at FROM docs WHERE id = ?")
      .get(docId) as { version: number; deleted_at: string | null } | null;
    return row === null || row.deleted_at !== null ? null : Number(row.version);
  }

  /**
   * @see StoreInterface.softDeleteWithProvenance
   */
  async softDeleteWithProvenance(
    id: DocId,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<void, LoreError>> {
    // See insertWithProvenance's identical split above: BEGIN IMMEDIATE gets
    // its own try/catch so a synchronous open-transaction throw returns
    // err(STORE_ERROR) without attempting a ROLLBACK on a transaction that
    // never opened.
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const deleteResult = this.softDeleteDocSync(id);
      if (!deleteResult.ok) {
        this.db.run("ROLLBACK");
        return deleteResult;
      }

      const versionResult = this.insertVersionSync(version);
      if (!versionResult.ok) {
        this.db.run("ROLLBACK");
        return versionResult;
      }

      const auditResult = this.appendAuditEntrySync(audit);
      if (!auditResult.ok) {
        this.db.run("ROLLBACK");
        return auditResult;
      }

      this.db.run("COMMIT");
      return ok(undefined);
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: same as insertWithProvenance — safe to ignore, see above.
      }
      return wrapStoreError(e);
    }
  }

  // ── Rule registry (migration-013, spec C2) ─────────────────────────────────

  /**
   * CAS-update one rule-bearing leaf's `extra` and insert its `action: "update"`
   * version row, INSIDE the caller's already-open write transaction. Shared by
   * {@link allocateRuleAndUpdateLeaf} and {@link moveRule}. A missing or
   * soft-deleted leaf is `DOC_NOT_FOUND` (the registry never writes into a
   * deleted leaf). Never opens or closes a transaction itself.
   */
  private applyRuleLeafPatchSync(
    patch: RuleLeafPatch,
    actor: string,
    nowIso: string,
  ): Result<DocRecord, LoreError> {
    const row = this.db
      .prepare("SELECT * FROM docs WHERE id = ?")
      .get(patch.id) as DocRow | null;
    if (!row || row.deleted_at !== null) {
      return err({ code: "DOC_NOT_FOUND", id: patch.id });
    }
    // reason: the CAS is checked HERE against the row read under this
    // transaction's write lock (BEGIN IMMEDIATE — no writer can change it
    // between this read and the UPDATE below) instead of trusting
    // `updateDocSync`'s `result.changes === 0` miss detection. Measured under
    // bun 1.3.10: `Statement.run().changes` after a ZERO-row UPDATE reports
    // the FTS-trigger row count of an EARLIER write in the same transaction
    // (4 for a miss that follows a hit), so a second CAS in one transaction —
    // `moveRule`'s target leaf — silently "succeeds" without writing. The
    // single-CAS-per-transaction callers never hit it.
    if (Number(row.version) !== patch.expectedVersion) {
      return err({
        code: "STALE_VERSION",
        id: patch.id,
        expected: patch.expectedVersion,
        actual: Number(row.version),
      });
    }
    const updated = this.updateDocSync(
      patch.id,
      {
        extra: patch.extra,
        version: patch.expectedVersion + 1,
        updated_at: nowIso,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      },
      { expected_version: patch.expectedVersion },
    );
    if (!updated.ok) return updated;
    const versionResult = this.insertVersionSync({
      doc_id: updated.value.id,
      version: updated.value.version,
      content: updated.value.content,
      extra: updated.value.extra,
      status: updated.value.status,
      title: updated.value.title,
      action: "update",
      created_at: nowIso,
      created_by: actor,
      ...(patch.change_summary !== undefined ? { change_summary: patch.change_summary } : {}),
      slug: updated.value.slug,
      harness_run: patch.harness_run ?? null,
    });
    if (!versionResult.ok) return versionResult;
    return updated;
  }

  /**
   * @see StoreInterface.allocateRuleAndUpdateLeaf
   *
   * reason: `BEGIN IMMEDIATE` takes the write lock BEFORE `MAX(n)` is read, so
   * the read-then-insert is serialised across connections/processes — moving
   * the MAX(n) read above the BEGIN reopens the duplicate-id race (QA-1,
   * AC-BLS1-1; falsifier recorded on task-skill-implement-store-rule-registry-migration).
   */
  async allocateRuleAndUpdateLeaf(
    leafId: DocId,
    expectedVersion: number,
    buildExtra: (ruleId: string) => Record<string, unknown>,
    actor: string,
    prefix: RuleIdPrefix = "BR",
    harnessRun: string | null = null,
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>> {
    return this.allocateRuleCore(
      { docId: leafId, expectedVersion, buildExtra, harnessRun },
      { ownerDocId: leafId, proposed: false },
      actor,
      prefix,
    );
  }

  /** @see StoreInterface.reserveProposedRuleAndUpdateSpec */
  async reserveProposedRuleAndUpdateSpec(
    write: ProposedRuleWrite,
    actor: string,
    prefix: RuleIdPrefix = "BR",
    harnessRun: string | null = null,
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>> {
    return this.allocateRuleCore(
      {
        docId: write.specId,
        expectedVersion: write.expectedVersion,
        buildExtra: write.buildExtra,
        harnessRun,
        ...(write.status !== undefined ? { status: write.status } : {}),
        ...(write.changeSummary !== undefined ? { changeSummary: write.changeSummary } : {}),
      },
      { ownerDocId: write.ownerLeafId, proposed: true },
      actor,
      prefix,
    );
  }

  /**
   * One write transaction shared by {@link allocateRuleAndUpdateLeaf} (a rule written into its leaf, state read
   * from the leaf) and {@link reserveProposedRuleAndUpdateSpec} (a `proposed` id reserved while the SPEC is
   * written). `BEGIN IMMEDIATE` stays BEFORE the `MAX(n)` read (see the first method's reason).
   */
  private allocateRuleCore(
    doc: {
      docId: DocId;
      expectedVersion: number;
      buildExtra: (ruleId: string) => Record<string, unknown>;
      harnessRun: string | null;
      status?: DocStatus;
      changeSummary?: string;
    },
    registry: { ownerDocId: DocId; proposed: boolean },
    actor: string,
    prefix: RuleIdPrefix,
  ): Result<{ ruleId: string; doc: DocRecord }, LoreError> {
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const nextRow = this.db
        .prepare("SELECT COALESCE(MAX(n), 0) + 1 AS next_n FROM rule_registry WHERE prefix = ?")
        .get(prefix) as { next_n: number };
      const ruleId = `${prefix}-${nextRow.next_n}`;
      const nowIso = new Date().toISOString();
      const written = this.applyRuleLeafPatchSync(
        {
          id: doc.docId,
          expectedVersion: doc.expectedVersion,
          extra: doc.buildExtra(ruleId),
          harness_run: doc.harnessRun,
          ...(doc.status !== undefined ? { status: doc.status } : {}),
          ...(doc.changeSummary !== undefined ? { change_summary: doc.changeSummary } : {}),
        },
        actor,
        nowIso,
      );
      if (!written.ok) {
        this.db.run("ROLLBACK");
        return written;
      }
      // A proposed id is listed by NO leaf: its state is 'proposed' and its version is the owner leaf's current
      // one (the leaf is not written); a missing/deleted owner aborts the reservation.
      const registryVersion = registry.proposed ? this.readDocVersionSync(registry.ownerDocId) : written.value.version;
      if (registryVersion === null) {
        this.db.run("ROLLBACK");
        return err({ code: "DOC_NOT_FOUND", id: registry.ownerDocId });
      }
      this.db
        .prepare(
          "INSERT INTO rule_registry (id, prefix, n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        // reason: the docs_idx_baseline_au trigger already ran (inside the leaf UPDATE above) BEFORE
        // this row existed, so lifecycle/version are written explicitly here, in the same transaction.
        // 'live' is the fallback only for a `buildExtra` that does not list the new rule (test stubs).
        .run(
          ruleId,
          prefix,
          nextRow.next_n,
          registry.ownerDocId,
          nowIso,
          actor,
          registry.proposed ? "proposed" : (listedRuleLifecycle(written.value.extra, ruleId) ?? "live"),
          registryVersion,
        );
      this.db.run("COMMIT");
      return ok({ ruleId, doc: written.value });
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: same as updateWithProvenance — ROLLBACK throws only when the
        // transaction is already closed; `e` below is what the caller needs.
      }
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.moveRule
   */
  async moveRule(
    ruleId: string,
    fromLeaf: RuleLeafPatch,
    toLeaf: RuleLeafPatch,
    actor: string,
  ): Promise<Result<{ from: DocRecord; to: DocRecord }, LoreError>> {
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const registryRow = this.db
        .prepare("SELECT leaf_doc_id FROM rule_registry WHERE id = ?")
        .get(ruleId) as { leaf_doc_id: string } | null;
      if (!registryRow) {
        this.db.run("ROLLBACK");
        return err({ code: "DOC_NOT_FOUND", id: ruleId });
      }
      if (registryRow.leaf_doc_id !== fromLeaf.id) {
        this.db.run("ROLLBACK");
        return err({
          code: "VALIDATION_ERROR",
          field: "fromLeaf.id",
          message: `rule ${ruleId} is registered to leaf ${registryRow.leaf_doc_id}, not ${fromLeaf.id}`,
          value: fromLeaf.id,
        });
      }
      const nowIso = new Date().toISOString();
      const from = this.applyRuleLeafPatchSync(fromLeaf, actor, nowIso);
      if (!from.ok) {
        this.db.run("ROLLBACK");
        return from;
      }
      const to = this.applyRuleLeafPatchSync(toLeaf, actor, nowIso);
      if (!to.ok) {
        this.db.run("ROLLBACK");
        return to;
      }
      // reason: both leaf UPDATEs fired their docs_idx_baseline_au trigger while the row still named the
      // source leaf, so owner + lifecycle + version are re-pointed here at the destination leaf.
      this.db
        .prepare("UPDATE rule_registry SET leaf_doc_id = ?, lifecycle = ?, version = ? WHERE id = ?")
        .run(toLeaf.id, listedRuleLifecycle(to.value.extra, ruleId) ?? "live", to.value.version, ruleId);
      this.db.run("COMMIT");
      return ok({ from: from.value, to: to.value });
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: same as allocateRuleAndUpdateLeaf — safe to ignore.
      }
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.listRuleRegistry
   */
  async listRuleRegistry(): Promise<Result<RuleRegistryRow[], LoreError>> {
    try {
      const rows = this.db
        .prepare(
          "SELECT id, n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version FROM rule_registry ORDER BY n ASC, prefix ASC",
        )
        .all() as RuleRegistryRow[];
      return ok(rows);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.insertAcExemptionCapped
   *
   * reason: `BEGIN IMMEDIATE` takes the write lock BEFORE the active count is read, and the INSERT
   * itself is `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?`, so count-then-insert is one
   * serialised step across connections/processes (AC-BLS2-10). Do not split the count into its own read.
   */
  async insertAcExemptionCapped(
    row: AcExemptionRow,
    cap: AcExemptionCap,
  ): Promise<Result<AcExemptionRow, LoreError>> {
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const existing = this.db
        .prepare("SELECT expires_at FROM ac_exemptions WHERE doc_id = ? AND ac_id = ?")
        .get(row.doc_id, row.ac_id) as { expires_at: string } | null;
      const satisfied = cap.satisfied ?? NO_SATISFIED_EXEMPTIONS;
      if (
        existing !== null &&
        isExemptionActive({ doc_id: row.doc_id, ac_id: row.ac_id, expires_at: existing.expires_at }, cap.now, satisfied)
      ) {
        this.db.run("ROLLBACK");
        return err(buildAcExemptionAlreadyActiveError(row.doc_id, row.ac_id));
      }
      if (existing !== null) {
        this.db.prepare("DELETE FROM ac_exemptions WHERE doc_id = ? AND ac_id = ?").run(row.doc_id, row.ac_id);
      }
      // reason: the active count applies the shared predicate in TS (cite-satisfaction is not a SQL fact);
      // BEGIN IMMEDIATE already holds the write lock, so count-then-insert stays one serialised step.
      const unexpired = this.db
        .prepare("SELECT doc_id, ac_id, expires_at FROM ac_exemptions WHERE expires_at > ?")
        .all(cap.now) as Array<{ doc_id: string; ac_id: string; expires_at: string }>;
      const activeCount = unexpired.filter((r) => isExemptionActive(r, cap.now, satisfied)).length;
      if (activeCount >= cap.maxActive) {
        this.db.run("ROLLBACK");
        return err(buildAcExemptionCapError(activeCount, cap.liveCriteria, cap.maxActive));
      }
      this.db
        .prepare(
          `INSERT INTO ac_exemptions (doc_id, ac_id, reason, expires_at, granted_by, granted_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(row.doc_id, row.ac_id, row.reason, row.expires_at, row.granted_by, row.granted_at);
      this.db.run("COMMIT");
      return ok({ ...row });
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: same as allocateRuleAndUpdateLeaf — ROLLBACK throws only when the transaction is
        // already closed; `e` below is what the caller needs.
      }
      return wrapStoreError(e);
    }
  }

  /** @see StoreInterface.listAcExemptions */
  async listAcExemptions(): Promise<Result<AcExemptionRow[], LoreError>> {
    try {
      const rows = this.db
        .prepare(
          "SELECT doc_id, ac_id, reason, expires_at, granted_by, granted_at FROM ac_exemptions ORDER BY doc_id, ac_id",
        )
        .all() as AcExemptionRow[];
      return ok(rows);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /** @see StoreInterface.listAcCites */
  async listAcCites(): Promise<Result<AcCiteRow[], LoreError>> {
    try {
      const rows = this.db
        .prepare("SELECT doc_id, ac_id, rule_id FROM ac_cites ORDER BY doc_id, ac_id, rule_id")
        .all() as AcCiteRow[];
      return ok(rows);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /** @see StoreInterface.listRuleDepends */
  async listRuleDepends(): Promise<Result<RuleDependsRow[], LoreError>> {
    try {
      const rows = this.db
        .prepare("SELECT leaf_id, rule_id FROM rule_depends ORDER BY leaf_id, rule_id")
        .all() as RuleDependsRow[];
      return ok(rows);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async queryAudit(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>> {
    try {
      const clauses: string[] = [];
      const params: SQLQueryBindings[] = [];

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

      const whereClause =
        clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      // reason: LIMIT is parameter-bound (never string-interpolated) even
      // though `filters.limit` is a caller-controlled number, not raw user
      // text — SQLite's bind protocol is the only non-negotiable boundary
      // for the value entering the SQL string.
      const limitClause = filters.limit !== undefined ? "LIMIT ?" : "";
      if (filters.limit !== undefined) {
        params.push(filters.limit);
      }
      const sql = `SELECT * FROM audit ${whereClause} ORDER BY timestamp DESC ${limitClause}`;

      const rows = this.db.prepare(sql).all(...params) as AuditRow[];
      return ok(rows.map(rowToAuditEntry));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.listAuditChain
   */
  async listAuditChain(): Promise<Result<AuditChainEntry[], LoreError>> {
    try {
      const rows = this.db
        .query("SELECT * FROM audit ORDER BY id ASC")
        .all() as AuditChainRow[];
      return ok(rows.map(rowToAuditChainEntry));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.listAuditRowsByAction
   */
  async listAuditRowsByAction(action: string, docId?: DocId): Promise<Result<AuditChainEntry[], LoreError>> {
    try {
      const rows =
        docId === undefined
          ? (this.db.prepare("SELECT * FROM audit WHERE action = ? ORDER BY id ASC").all(action) as AuditChainRow[])
          : (this.db
              .prepare("SELECT * FROM audit WHERE action = ? AND doc_id = ? ORDER BY id ASC")
              .all(action, docId) as AuditChainRow[]);
      return ok(rows.map(rowToAuditChainEntry));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.appendDecisionRecord
   *
   * Head-read + insert inside ONE `BEGIN IMMEDIATE` (same reasoning as {@link appendAuditEntry}): a second
   * process's own `BEGIN IMMEDIATE` blocks on the native busy handler until this commits, so the chain cannot fork.
   */
  async appendDecisionRecord(input: DecisionRecordInput): Promise<Result<DecisionLogRow, LoreError>> {
    try {
      this.db.run("BEGIN IMMEDIATE");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const head = this.db.query("SELECT entry_hash FROM decision_log ORDER BY id DESC LIMIT 1").get() as
        | { entry_hash: string }
        | null;
      const prevHash = head?.entry_hash ?? DECISION_GENESIS_HASH;
      const entryHash = computeDecisionEntryHash(input, prevHash);
      this.db
        .prepare(
          `INSERT INTO decision_log
             (ts, class, subject_id, subject_version, facts, factors, score, threshold, verdict, reasons,
              executor_run, channel, prev_hash, entry_hash, detail)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.ts,
          input.class,
          input.subject_id,
          input.subject_version,
          input.facts,
          input.factors,
          input.score,
          input.threshold,
          input.verdict,
          input.reasons,
          input.executor_run,
          input.channel,
          prevHash,
          entryHash,
          input.detail ?? null,
        );
      const idRow = this.db.query("SELECT last_insert_rowid() AS id").get() as { id: number };
      this.db.run("COMMIT");
      return ok({ ...input, detail: input.detail ?? null, id: Number(idRow.id), prev_hash: prevHash, entry_hash: entryHash });
    } catch (e) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        // reason: ROLLBACK throws only when no transaction is open — `e` is what the caller needs.
      }
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.listDecisionLog
   */
  async listDecisionLog(subject?: DecisionSubjectKey): Promise<Result<DecisionLogRow[], LoreError>> {
    try {
      const rows =
        subject === undefined
          ? (this.db.query("SELECT * FROM decision_log ORDER BY id ASC").all() as DecisionLogRow[])
          : (this.db
              .prepare(
                "SELECT * FROM decision_log WHERE class = ? AND subject_id = ? AND subject_version = ? ORDER BY id ASC",
              )
              .all(subject.class, subject.subject_id, subject.subject_version) as DecisionLogRow[]);
      return ok(rows.map((r) => ({ ...r, id: Number(r.id) })));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.readAutonomyThresholds
   */
  async readAutonomyThresholds(): Promise<Result<{ readonly content: string; readonly updated_at: string } | null, LoreError>> {
    try {
      const row = this.db.query("SELECT content, updated_at FROM autonomy_thresholds WHERE id = 1").get() as
        | { content: string; updated_at: string }
        | null;
      return ok(row === null ? null : { content: row.content, updated_at: row.updated_at });
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.writeAutonomyThresholds
   */
  async writeAutonomyThresholds(content: string, updatedAt: string): Promise<Result<void, LoreError>> {
    try {
      this.db
        .prepare(
          "INSERT INTO autonomy_thresholds (id, content, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
        )
        .run(content, updatedAt);
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.getAuditHeadId
   */
  async getAuditHeadId(): Promise<Result<number, LoreError>> {
    try {
      const row = this.db.query("SELECT MAX(id) AS head FROM audit").get() as { head: number | null } | null;
      const head = row?.head;
      return ok(head === null || head === undefined ? 0 : Number(head));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Review Judgments ───────────────────────────────────────────────────────

  async insertJudgment(judgment: ReviewJudgment): Promise<Result<void, LoreError>> {
    try {
      this.db
        .prepare(
          `INSERT INTO review_judgments
             (id, doc_id, doc_version, decision, confidence, reasons, checks,
              blocking_questions, judge_provider, judge_model, judge_prompt_version,
              kind, superseded_candidate, truncated, truncation, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
          judgment.truncated === true ? 1 : null,
          judgment.truncation !== undefined ? JSON.stringify(judgment.truncation) : null,
          judgment.created_at,
          judgment.created_by,
        );
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findJudgments(docId: DocId, kind?: ReviewJudgmentKind): Promise<Result<ReviewJudgment[], LoreError>> {
    try {
      const rows = (
        kind !== undefined
          ? this.db
              .prepare("SELECT * FROM review_judgments WHERE doc_id = ? AND kind = ? ORDER BY created_at DESC")
              .all(docId, kind)
          : this.db
              .prepare("SELECT * FROM review_judgments WHERE doc_id = ? ORDER BY created_at DESC")
              .all(docId)
      ) as JudgmentRow[];
      return ok(rows.map(rowToReviewJudgment));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async latestJudgment(docId: DocId, kind?: ReviewJudgmentKind): Promise<Result<ReviewJudgment | null, LoreError>> {
    try {
      const row = (
        kind !== undefined
          ? this.db
              .prepare(
                "SELECT * FROM review_judgments WHERE doc_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1",
              )
              .get(docId, kind)
          : this.db
              .prepare("SELECT * FROM review_judgments WHERE doc_id = ? ORDER BY created_at DESC LIMIT 1")
              .get(docId)
      ) as JudgmentRow | null;
      return ok(row ? rowToReviewJudgment(row) : null);
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
      const placeholders = docIds.map(() => "?").join(", ");
      const rows = this.db
        .prepare(
          `SELECT rj.* FROM review_judgments rj
           INNER JOIN (
             SELECT doc_id, MAX(created_at) AS max_created_at
             FROM review_judgments
             WHERE doc_id IN (${placeholders}) AND kind = ?
             GROUP BY doc_id
           ) latest ON rj.doc_id = latest.doc_id AND rj.created_at = latest.max_created_at
           WHERE rj.kind = ?`,
        )
        .all(...(docIds as SQLQueryBindings[]), kind, kind) as JudgmentRow[];
      for (const row of rows) {
        const judgment = rowToReviewJudgment(row);
        if (!result.has(judgment.doc_id)) result.set(judgment.doc_id, judgment);
      }
      return ok(result);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Calibration Records ─────────────────────────────────────────────────────

  async insertCalibrationRecord(record: CalibrationRecord): Promise<Result<void, LoreError>> {
    try {
      this.db
        .prepare(
          `INSERT INTO calibration_records
             (id, judgment_id, doc_id, doc_type, human_outcome, delta_reasons, actor, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          record.judgment_id,
          record.doc_id,
          record.doc_type,
          record.human_outcome,
          JSON.stringify(record.delta_reasons),
          record.actor,
          record.created_at,
        );
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async queryCalibrationWindow(
    filter: CalibrationWindowFilter,
  ): Promise<Result<CalibrationRecordWithPromptVersion[], LoreError>> {
    try {
      // reason: the JOIN to review_judgments is now UNCONDITIONAL (not just when
      // filter.prompt_version is pinned) — every returned record must carry the
      // judgment's real judge_prompt_version so JudgmentService.computeCalibrationStats
      // can group by the actual (doc_type, prompt_version) pair instead of falling back
      // to an unpinned "*" sentinel. Still one indexed statement, not an N+1 fan-out.
      // See SPEC-034 §3 / SPEC-035 calibration disaggregation follow-up.
      const clauses: string[] = [];
      const params: SQLQueryBindings[] = [];

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

      const rows = this.db.prepare(sql).all(...params) as CalibrationRowWithPromptVersion[];
      return ok(rows.map(rowToCalibrationRecordWithPromptVersion));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Trace Events (SPEC-102) ─────────────────────────────────────────────

  async insertTraceEvent(event: TraceEventInput): Promise<Result<void, LoreError>> {
    try {
      this.db.run(
        `INSERT INTO trace_events (ts, actor, surface, session_id, kind, doc_id, checkpoint, hit_count, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.ts,
          event.actor,
          event.surface,
          event.session_id,
          event.kind,
          event.doc_id ?? null,
          event.checkpoint ?? null,
          event.hit_count ?? null,
          JSON.stringify(event.details ?? {}),
        ],
      );
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async countTraceEventsByKind(window: TraceStatsWindow): Promise<Result<Record<string, number>, LoreError>> {
    try {
      const rows = this.db
        .query("SELECT kind, COUNT(*) as count FROM trace_events WHERE ts >= ? GROUP BY kind")
        .all(window.since) as { kind: string; count: number | bigint }[];
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.kind] = Number(row.count);
      return ok(counts);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async countTraceDenyByCheckpoint(
    window: TraceStatsWindow,
  ): Promise<Result<TraceDenyByCheckpoint[], LoreError>> {
    try {
      // reason: json_extract(details, '$.layer') pulls SPEC-102 D7's layer
      // discriminator out of the JSON details blob — GROUP BY on both
      // checkpoint and the extracted layer keeps hook-layer and
      // service-layer denies for the SAME checkpoint from double-counting
      // into one bucket.
      const rows = this.db
        .query(
          `SELECT checkpoint, json_extract(details, '$.layer') as layer, COUNT(*) as count
           FROM trace_events
           WHERE kind = 'gate_deny' AND ts >= ?
           GROUP BY checkpoint, layer`,
        )
        .all(window.since) as { checkpoint: string | null; layer: string | null; count: number | bigint }[];
      return ok(
        rows.map((row) => ({
          checkpoint: row.checkpoint ?? "unknown",
          layer: row.layer ?? "unknown",
          count: Number(row.count),
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
      const rows = this.db
        .query(
          `SELECT ts, actor, details FROM trace_events
           WHERE kind = 'search' AND hit_count = 0 AND ts >= ?
           ORDER BY ts DESC, id DESC`,
        )
        .all(window.since) as { ts: string; actor: string; details: string }[];
      // reason: the `query` KEY is omitted entirely (conditional spread) rather
      // than set to "" when raw queries were not requested — under
      // exactOptionalPropertyTypes an absent key is observably different from an
      // empty string, and only absence proves to a reader (and to AC-RR-3's
      // oracle) that no literal search text was ever projected out of the row.
      const includeRawQueries = opts?.includeRawQueries === true;
      return ok(
        rows.map((row) => ({
          ts: row.ts,
          actor: row.actor,
          ...(includeRawQueries
            ? { query: parseJson<{ query?: string }>(row.details, {}).query ?? "" }
            : {}),
        })),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listNeverReadDocs(window: TraceStatsWindow): Promise<Result<NeverReadDoc[], LoreError>> {
    try {
      // reason: SPEC-102 §Access Patterns "never-read docs" — non-deleted
      // docs with no kind='get' trace row since the window start. idx_trace_doc
      // (partial, doc_id IS NOT NULL) backs the inner subquery. ORDER BY slug
      // (unique, id-tiebroken) makes the member list diff-stable across runs.
      const rows = this.db
        .query(
          `SELECT id, slug FROM docs
           WHERE deleted_at IS NULL
           AND id NOT IN (
             SELECT DISTINCT doc_id FROM trace_events
             WHERE kind = 'get' AND doc_id IS NOT NULL AND ts >= ?
           )
           ORDER BY slug ASC, id ASC`,
        )
        .all(window.since) as { id: string; slug: string }[];
      return ok(rows.map((row) => ({ id: row.id, slug: row.slug })));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async countTraceZeroHitSearches(window: TraceStatsWindow): Promise<Result<number, LoreError>> {
    // reason: DERIVED from the member list, never a second COUNT(*) — see
    // StoreInterface.countTraceZeroHitSearches's own ⛔ note. The privacy
    // default is deliberate: a length needs no query text at all.
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
      const rows = this.db
        .query(
          "SELECT ts, actor, checkpoint FROM trace_events WHERE kind = 'gate_deny' AND ts >= ? ORDER BY ts ASC",
        )
        .all(window.since) as { ts: string; actor: string; checkpoint: string | null }[];
      return ok(
        rows.map((row) => ({ ts: row.ts, actor: row.actor, checkpoint: row.checkpoint ?? "unknown" })),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listTraceRawSearchQueries(
    window: TraceStatsWindow,
  ): Promise<Result<TraceRawSearchQuery[], LoreError>> {
    try {
      const rows = this.db
        .query(
          "SELECT ts, actor, details FROM trace_events WHERE kind = 'search' AND ts >= ? ORDER BY ts DESC",
        )
        .all(window.since) as { ts: string; actor: string; details: string }[];
      return ok(
        rows.map((row) => ({
          ts: row.ts,
          actor: row.actor,
          query: parseJson<{ query?: string }>(row.details, {}).query ?? "",
        })),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async pruneTraceEvents(cutoffIso: string, batchSize = 50_000): Promise<Result<number, LoreError>> {
    try {
      const result = this.db.run(
        "DELETE FROM trace_events WHERE id IN (SELECT id FROM trace_events WHERE ts < ? LIMIT ?)",
        [cutoffIso, batchSize],
      );
      return ok(result.changes);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Runs (migration-016) ──────────────────────────────────────────────────

  async insertRun(run: RunRecord): Promise<Result<void, LoreError>> {
    try {
      // reason: INSERT OR IGNORE makes registration idempotent and first-wins (the id is the PK).
      this.db.prepare(INSERT_RUN_SQL).run(...runRecordToParams(run));
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async getRun(id: RunId): Promise<Result<RunRecord | null, LoreError>> {
    try {
      const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | null;
      return ok(row === null ? null : rowToRunRecord(row));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listRunsByAgentRef(agentRef: string): Promise<Result<RunRecord[], LoreError>> {
    try {
      const rows = this.db
        .prepare("SELECT * FROM runs WHERE agent_ref = ? ORDER BY registered_at DESC, id ASC")
        .all(agentRef) as RunRow[];
      return ok(rows.map(rowToRunRecord));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async endRun(id: RunId, endedAt: string, reason: string): Promise<Result<RunEndOutcome, LoreError>> {
    try {
      // reason: `ended_at IS NULL` in the WHERE makes the FIRST end win and the call idempotent.
      const updated = this.db
        .prepare("UPDATE runs SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL")
        .run(endedAt, reason, id);
      if (updated.changes > 0) return ok("ended");
      const row = this.db.prepare("SELECT id FROM runs WHERE id = ?").get(id) as { id: string } | null;
      return ok(row === null ? "unknown-run" : "already-ended");
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async reopenRun(id: RunId): Promise<Result<boolean, LoreError>> {
    try {
      const updated = this.db
        .prepare("UPDATE runs SET ended_at = NULL, end_reason = NULL WHERE id = ? AND ended_at IS NOT NULL")
        .run(id);
      return ok(updated.changes > 0);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async getRunEnd(id: RunId): Promise<Result<RunEndState | null, LoreError>> {
    try {
      const row = this.db.prepare("SELECT ended_at, end_reason FROM runs WHERE id = ?").get(id) as
        | { ended_at: string | null; end_reason: string | null }
        | null;
      return ok(row === null ? null : { endedAt: row.ended_at, endReason: row.end_reason });
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async recordRunProcess(id: RunId, proc: RunProcessRecord): Promise<Result<boolean, LoreError>> {
    try {
      // reason: the NEWEST registration wins here (unlike the identity columns): a resumed run lives in a new process.
      const updated = this.db
        .prepare("UPDATE runs SET harness_pid = ?, harness_pid_start = ?, worktree = ? WHERE id = ?")
        .run(proc.pid, proc.startTime, proc.worktree, id);
      return ok(updated.changes > 0);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listRunLifecycles(): Promise<Result<RunLifecycle[], LoreError>> {
    try {
      const rows = this.db.prepare(RUN_LIFECYCLE_SQL).all() as RunLifecycleRow[];
      return ok(rows.map(rowToRunLifecycle));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async countAttributedWrites(
    windowStart: string,
    kinds: readonly string[],
  ): Promise<Result<AttributedWriteCount, LoreError>> {
    if (kinds.length === 0) return emptyKindsError();
    try {
      const row = this.db
        .prepare(countAttributedWritesSql(kinds.length))
        .get(windowStart, ...kinds) as { total: number | bigint; attested: number | bigint };
      return ok({ total: Number(row.total), attested: Number(row.attested) });
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  async maxDocVersion(): Promise<Result<number, LoreError>> {
    try {
      const row = this.db
        .query("SELECT MAX(version) AS max_version FROM docs WHERE deleted_at IS NULL")
        .get() as { max_version: number | null };
      return ok(row.max_version ?? 0);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async dbSizeBytes(): Promise<Result<number, LoreError>> {
    try {
      const { page_count: pageCount } = this.db
        .query("PRAGMA page_count")
        .get() as { page_count: number };
      const { page_size: pageSize } = this.db
        .query("PRAGMA page_size")
        .get() as { page_size: number };
      return ok(pageCount * pageSize);
    } catch (e) {
      return wrapStoreError(e);
    }
  }
}
