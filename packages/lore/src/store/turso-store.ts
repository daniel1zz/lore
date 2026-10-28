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
import { isSchemaBehind, SchemaBehindError } from "./schema-behind.js";
import { LATEST_SCHEMA_VERSION } from "./schema-version.js";
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
import { MIGRATION_041_ADD_COLUMNS, MIGRATION_041_SQL } from "./migrations/migration-041.js";
import { MIGRATION_042_ADD_COLUMNS, MIGRATION_042_SQL } from "./migrations/migration-042.js";
import { MIGRATION_017_ADD_COLUMNS, MIGRATION_017_SQL } from "./migrations/migration-017.js";
import { MIGRATION_015_SQL } from "./migrations/migration-015.js";
import { MIGRATION_018_SQL } from "./migrations/migration-018.js";
import { MIGRATION_019_ADD_COLUMNS, MIGRATION_019_SQL } from "./migrations/migration-019.js";
import { MIGRATION_020_SQL } from "./migrations/migration-020.js";
import { MIGRATION_021_ADD_COLUMNS, MIGRATION_021_SQL } from "./migrations/migration-021.js";
import { MIGRATION_022_SQL } from "./migrations/migration-022.js";
import { MIGRATION_023_SQL } from "./migrations/migration-023.js";
import { MIGRATION_024_SQL } from "./migrations/migration-024.js";
import { MIGRATION_025_SQL } from "./migrations/migration-025.js";
import { MIGRATION_026_SQL, MigrationFailedError } from "./migrations/migration-026.js";
import { MIGRATION_027_SQL } from "./migrations/migration-027.js";
import {
  auditBindings,
  conversionAuditEntry,
  conversionVersionBindings,
  convertedNodeBindings,
  INSERT_AUDIT_SQL,
  INSERT_CONVERSION_VERSION_SQL,
  MIGRATION_028_SQL,
  planBaselineItemConversion,
  PROPOSE_RULE_SQL,
  requireMigrationActor,
  SELECT_AUDIT_HEAD_SQL,
  SELECT_BASELINE_NODES_SQL,
  SELECT_LAST_APPROVED_SQL,
  UPDATE_CONVERTED_NODE_SQL,
  type ApprovedVersionRow,
  type BaselineNodeRow,
} from "./migrations/migration-028.js";
import {
  collectLandedChanges,
  MIGRATION_029_SQL,
  planLandedPromotion,
  promotedNodeBindings,
  promotedVersionBindings,
  promotionAuditEntry,
  DOCS_TABLE_INFO_SQL,
  specExtrasSqlFor,
} from "./migrations/migration-029.js";
import { MIGRATION_030_ADD_COLUMNS, MIGRATION_030_SQL } from "./migrations/migration-030.js";
import { MIGRATION_031_SQL } from "./migrations/migration-031.js";
import { MIGRATION_032_SQL } from "./migrations/migration-032.js";
import { MIGRATION_033_SQL } from "./migrations/migration-033.js";
import { MIGRATION_034_SQL } from "./migrations/migration-034.js";
import { MIGRATION_035_SQL } from "./migrations/migration-035.js";
import { MIGRATION_036_SQL } from "./migrations/migration-036.js";
import { MIGRATION_037_SQL } from "./migrations/migration-037.js";
import {
  convertedPlanAuditEntry,
  convertedPlanBindings,
  convertedPlanVersionBindings,
  describeUnconvertible,
  MIGRATION_038_SQL,
  planKnownDefectConversion,
  planWrites,
  requireConversionActor,
  SELECT_KNOWN_DEFECT_LINKS_SQL,
  SELECT_PLAN_ROW_SQL,
  type KnownDefectLinkRow,
} from "./migrations/migration-038.js";
import {
  MIGRATION_039_SQL,
  planLandingBackfill,
  SELECT_TASK_ROWS_SQL,
  taskAuditEntry,
  taskVersionBindings,
  taskWriteBindings,
} from "./migrations/migration-039.js";
import {
  MIGRATION_040_SQL,
  planUnrecoverableClaims,
  SELECT_CLAIM_AUDIT_ROWS_SQL,
  SELECT_TASK_CLAIM_HOLDERS_SQL,
  unrecoverableClaimAuditEntry,
} from "./migrations/migration-040.js";
import { DECISION_GENESIS_HASH, computeDecisionEntryHash } from "./decision-log.js";
import type { DecisionLogRow, DecisionRecordInput } from "./decision-log.js";
import type { DecisionSubjectKey, DecisionVersionQuery } from "./store-interface.js";
import type { DecisionRecord, RuleIdPrefix } from "@lore/core";
import { listedRuleLifecycle } from "./index-rows.js";
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
  err,
  ok,
  ORDINAL_REGISTERED_TYPES,
  SNIPPET_MARK_CLOSE,
  SNIPPET_MARK_OPEN,
  type LoreError,
  type Result,
} from "@lore/core";
import type {
  AcCiteRow,
  RuleDependsRow,
  AuditChainEntry,
  AuditFilters,
  CalibrationRecordWithPromptVersion,
  CalibrationWindowFilter,
  SearchHit,
  ProposedRuleRepointWrite,
  ProposedRuleWrite,
  RuleLeafPatch,
  RuleRegistryRow,
  AcExemptionRow,
  AcExemptionCap,
  StoreFilters,
  AttributedWriteCount,
  StoreInterface,
  TraceDenyByCheckpoint,
  CheckOutcomeInput,
  CheckOutcomeStat,
  PendingAskInput,
  PendingAskRecord,
  LeaseAcquisition,
  LeaseRecord,
  ReadDayCount,
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
  allocateWithBoundedRetry,
  computeAuditEntryHash,
  computeFtsShadowValues,
  decisionToColumn,
  AC_EXEMPTION_COLUMNS,
  rowToAcExemption,
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
  INSERT_RUN_SQL,
  RUN_LIFECYCLE_SQL,
  type RunLifecycleRow,
  rowToRunLifecycle,
  type RunRow,
  countAttributedWritesSql,
  emptyKindsError,
  rowToRunRecord,
  runRecordToParams,
  buildAcExemptionAlreadyActiveError,
  buildAcExemptionCapError,
  isExemptionActive,
  NO_SATISFIED_EXEMPTIONS,
  buildNonLiveRuleRefusal,
} from "./store-shared.js";
import {
  PLAN_MEMBERS_SQL,
  buildPlanProgressWrite,
  keepStoredPlanProgress,
  planIdsAffectedBy,
  refuseArchivedTerminal,
  withInitialPlanProgress,
} from "./plan-progress.js";
import { stampAuditSurface } from "./audit-surface.js";

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

/**
 * Resolves `@libsql/client` through the literal-specifier dynamic `import()` and hands the module to the
 * synchronous construction path below, so a SYNCHRONOUS `new TursoStore(...)` works from the compiled binary too
 * (spec-defect-clusters-round-2-part-c-criterion-data-demotion D22). This is how `createApp`'s Turso branch stays
 * synchronous without `createRequire`: an entry that is about to open a sync-enabled corpus awaits this once,
 * before `createApp`. A project with `sync.enabled` off never calls it, so the native load stays lazy.
 *
 * @returns resolves once the module is cached; rejects when `@libsql/client` cannot be loaded
 */
export async function primeLibsqlClientForSyncConstruction(): Promise<void> {
  if (cachedLibsqlModuleSync === null) cachedLibsqlModuleSync = await loadLibsqlClientModule();
}

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
 * @param env - the invocation's environment (`Invocation.env`)
 * @returns `null` when TMPDIR is absent, empty, or a writable directory;
 *   otherwise a `STORE_ERROR` `LoreError` whose message's FIRST LINE names
 *   `TMPDIR` and the offending value verbatim, followed by a remediation line
 *   containing the literal substring `export TMPDIR=` (AC-LL-4's four
 *   substring rules).
 */
export function probeTmpdirUsability(env: Readonly<Record<string, string | undefined>>): LoreError | null {
  const tmpdir = env["TMPDIR"];
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
  /** Permit upgrading an older corpus (same meaning as `SQLiteStoreOptions.migrate`); absent → refuse with `SchemaBehindError`. */
  migrate?: true;
  /** Author of the migration's data-conversion writes (same meaning as `SQLiteStoreOptions.migrationActor`). */
  migrationActor?: string;
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

/** Maps one libsql `ac_exemptions` row (selected with `AC_EXEMPTION_COLUMNS`) to an `AcExemptionRow`. */
function libsqlRowToAcExemption(row: Row): AcExemptionRow {
  return rowToAcExemption({
    doc_id: rowStr(row, "doc_id"),
    ac_id: rowStr(row, "ac_id"),
    reason: rowStr(row, "reason"),
    expires_at: rowStr(row, "expires_at"),
    granted_by: rowStr(row, "granted_by"),
    granted_at: rowStr(row, "granted_at"),
    decision: rowStrOrNull(row, "decision"),
    harness_run: rowStrOrNull(row, "harness_run"),
  });
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
    harness_run: rowStrOrNull(row, "harness_run"),
    decision: rowStrOrNull(row, "decision"),
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
    harness_run: rowStrOrNull(row, "harness_run"),
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
    truncated: row["truncated"] === null || row["truncated"] === undefined ? null : Number(row["truncated"]),
    truncation: rowStrOrNull(row, "truncation"),
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
  /** The local corpus file; named by a failed migration. */
  private readonly localPath: string;
  /** True only when the config carries `migrate: true`; see {@link TursoConfig.migrate}. */
  private readonly migrateAllowed: boolean;
  /** See {@link TursoConfig.migrationActor}. */
  private readonly migrationActor: string | undefined;

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
    this.localPath = config.localPath;
    this.migrateAllowed = config.migrate === true;
    this.migrationActor = config.migrationActor;
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

      // reason: a corpus upgrade runs only through `lore migrate schema` (SQLiteStore over the same local file); this
      // store never rewrites an older corpus as a side effect of opening it. Surfaces as STORE_ERROR via ensureReady().
      if (!this.migrateAllowed && isSchemaBehind(currentVersion, LATEST_SCHEMA_VERSION)) {
        throw new SchemaBehindError(this.localPath, currentVersion, LATEST_SCHEMA_VERSION);
      }

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

      if (currentVersion < 13) {
        // reason: migration-013 (widen docs.type CHECK to accept 'baseline' +
        // rule_registry) is a `docs` table-recreate, same shape as
        // migration-006 which this file also applies via a plain
        // `executeMultiple`. Idempotent on re-run: DROP TABLE IF EXISTS
        // docs_new first, CREATE TABLE IF NOT EXISTS rule_registry — see
        // migration-013.ts's module JSDoc.
        await this.client.executeMultiple(MIGRATION_013_SQL);
      }

      if (currentVersion < 14) {
        // reason: migration-014 (rule_registry lifecycle/version, ac_cites, rule_depends,
        // ac_exemptions + docs_idx_* triggers) is one BEGIN/COMMIT string, idempotent on re-run
        // (rebuild-from-docs + DROP/CREATE TRIGGER) — `executeMultiple`, same as 012/013.
        await this.client.executeMultiple(MIGRATION_014_SQL);
      }

      if (currentVersion < 15) {
        // reason: migration-015 (rule_registry prefix + UNIQUE(prefix, n), triggers re-created) is one
        // BEGIN/COMMIT string rebuilt via rule_registry_new — `executeMultiple`, same as 012-014.
        await this.client.executeMultiple(MIGRATION_015_SQL);
      }

      if (currentVersion < 16) {
        // reason: migration-016 is two-phase (see migration-016.ts's module JSDoc): the nullable
        // `harness_run` columns are added only where `PRAGMA table_info` lacks them, then one
        // BEGIN/COMMIT string creates `runs` and bumps user_version — same SQL block as SQLiteStore.
        for (const { table, column, ddl } of MIGRATION_016_ADD_COLUMNS) {
          const info = await this.client.execute(`PRAGMA table_info(${table})`);
          if (!info.rows.some((r) => rowStr(r, "name") === column)) await this.client.execute(ddl);
        }
        await this.client.executeMultiple(MIGRATION_016_SQL);
      }

      if (currentVersion < 17) {
        // reason: migration-017 is two-phase like 016 (see migration-017.ts's module JSDoc): `runs.ended_at` /
        // `runs.end_reason` are added only where `PRAGMA table_info` lacks them, then one BEGIN/COMMIT bumps user_version.
        for (const { table, column, ddl } of MIGRATION_017_ADD_COLUMNS) {
          const info = await this.client.execute(`PRAGMA table_info(${table})`);
          if (!info.rows.some((r) => rowStr(r, "name") === column)) await this.client.execute(ddl);
        }
        await this.client.executeMultiple(MIGRATION_017_SQL);
      }

      if (currentVersion < 18) {
        // reason: migration-018 (rule_registry rebuilt so lifecycle may be 'proposed', triggers re-created) is one
        // BEGIN/COMMIT string rebuilt via rule_registry_new — `executeMultiple`, same as 015.
        await this.client.executeMultiple(MIGRATION_018_SQL);
      }

      if (currentVersion < 19) {
        // reason: migration-019 is two-phase like 017 (see migration-019.ts's module JSDoc): nullable
        // `review_judgments.truncated` / `.truncation` added only where `PRAGMA table_info` lacks them.
        for (const { table, column, ddl } of MIGRATION_019_ADD_COLUMNS) {
          const info = await this.client.execute(`PRAGMA table_info(${table})`);
          if (!info.rows.some((r) => rowStr(r, "name") === column)) await this.client.execute(ddl);
        }
        await this.client.executeMultiple(MIGRATION_019_SQL);
      }

      if (currentVersion < 20) {
        // reason: migration-020 (decision_log + append-only triggers) is one idempotent BEGIN/COMMIT string.
        await this.client.executeMultiple(MIGRATION_020_SQL);
      }

      if (currentVersion < 21) {
        // reason: migration-021 is two-phase like 017/019 (see migration-021.ts's module JSDoc): nullable
        // `runs.harness_pid` / `.harness_pid_start` / `.worktree` added only where `PRAGMA table_info` lacks them.
        for (const { table, column, ddl } of MIGRATION_021_ADD_COLUMNS) {
          const info = await this.client.execute(`PRAGMA table_info(${table})`);
          if (!info.rows.some((r) => rowStr(r, "name") === column)) await this.client.execute(ddl);
        }
        await this.client.executeMultiple(MIGRATION_021_SQL);
      }

      if (currentVersion < 22) {
        // reason: migration-022 (autonomy_thresholds) is one idempotent BEGIN/COMMIT string.
        await this.client.executeMultiple(MIGRATION_022_SQL);
      }

      if (currentVersion < 23) {
        // reason: migration-023 rebuilds decision_log with the widened verdict CHECK in ONE BEGIN/COMMIT string.
        await this.client.executeMultiple(MIGRATION_023_SQL);
      }

      if (currentVersion < 24) {
        // reason: migration-024 adds the nullable decision_log.detail column (plain ADD COLUMN; hashes stay valid).
        await this.client.executeMultiple(MIGRATION_024_SQL);
      }

      if (currentVersion < 25) {
        // reason: migration-025 adds the covering index AuditService.verify's narrow key read (listVersionKeys) is answered from.
        await this.client.executeMultiple(MIGRATION_025_SQL);
      }

      if (currentVersion < 26) {
        // reason: migration-026 rebuilds `versions` (one BEGIN/COMMIT string) so its action CHECK admits 'undelete'.
        try {
          await this.client.executeMultiple(MIGRATION_026_SQL);
        } catch (error) {
          // reason: executeMultiple rolls the open transaction back on error (see migration-004's note), so the
          // corpus stays at 25; the step is unknown here (one script), so say so rather than guess.
          throw new MigrationFailedError(26, "executeMultiple (single transaction)", this.localPath, error);
        }
      }

      if (currentVersion < 27) {
        // reason: migration-027 only moves user_version (see migration-027.ts).
        await this.client.executeMultiple(MIGRATION_027_SQL);
      }

      if (currentVersion < 28) {
        // reason: migration-028 converts every baseline node to approved + pending items (BR-1341), planned by the
        // same pure function the SQLite store runs, in ONE interactive transaction with the version bump.
        let step = "begin transaction";
        const tx = await this.client.transaction("write");
        try {
          const nodes = await tx.execute(SELECT_BASELINE_NODES_SQL);
          for (const row of nodes.rows) {
            const node: BaselineNodeRow = {
              id: rowStr(row, "id"),
              slug: rowStr(row, "slug"),
              title: rowStr(row, "title"),
              content: rowStr(row, "content"),
              status: rowStr(row, "status"),
              extra: rowStr(row, "extra"),
              tags: rowStr(row, "tags"),
              version: rowNum(row, "version"),
            };
            step = `convert baseline node ${node.slug}`;
            const approvedRs = await tx.execute({ sql: SELECT_LAST_APPROVED_SQL, args: [node.id] as InValue[] });
            const approvedRow = approvedRs.rows[0];
            const lastApproved: ApprovedVersionRow | undefined =
              approvedRow === undefined
                ? undefined
                : { title: rowStr(approvedRow, "title"), content: rowStr(approvedRow, "content"), extra: rowStr(approvedRow, "extra") };
            const conversion = planBaselineItemConversion(node, lastApproved);
            if (conversion === undefined) continue;
            const by = requireMigrationActor(this.migrationActor, node.slug);
            const now = new Date().toISOString();
            await tx.execute({ sql: UPDATE_CONVERTED_NODE_SQL, args: convertedNodeBindings(node, conversion, now) as InValue[] });
            await tx.execute({ sql: INSERT_CONVERSION_VERSION_SQL, args: conversionVersionBindings(node, conversion, by, now) as InValue[] });
            const headRs = await tx.execute(SELECT_AUDIT_HEAD_SQL);
            const headRow = headRs.rows[0];
            const prevHash = headRow ? (rowStrOrNull(headRow, "entry_hash") ?? "") : "";
            await tx.execute({ sql: INSERT_AUDIT_SQL, args: auditBindings(conversionAuditEntry(node, conversion, by, now), prevHash) as InValue[] });
            for (const ruleId of conversion.proposedRuleIds) {
              await tx.execute({ sql: PROPOSE_RULE_SQL, args: [ruleId, node.id] as InValue[] });
            }
          }
          step = "set user_version 28";
          await tx.execute(MIGRATION_028_SQL);
          step = "commit";
          await tx.commit();
        } catch (error) {
          try {
            await tx.rollback();
          } catch {
            // reason: rollback throws only when the transaction is already closed — the failure below is what to report.
          }
          throw new MigrationFailedError(28, step, this.localPath, error);
        } finally {
          tx.close();
        }
      }

      if (currentVersion < 29) {
        // reason: migration-029 promotes pending rule revisions that a landed spec change set accounts for (#323),
        // planned by the same pure function the SQLite store runs, in ONE interactive transaction with the bump.
        let step = "begin transaction";
        const tx = await this.client.transaction("write");
        try {
          const docsInfo = await tx.execute(DOCS_TABLE_INFO_SQL);
          const specRs = await tx.execute(specExtrasSqlFor(docsInfo.rows.some((r) => rowStr(r, "name") === "deleted_at")));
          const landed = collectLandedChanges(specRs.rows.map((row) => ({ slug: rowStr(row, "slug"), extra: rowStr(row, "extra") })));
          const nodes = await tx.execute(SELECT_BASELINE_NODES_SQL);
          for (const row of nodes.rows) {
            const node: BaselineNodeRow = {
              id: rowStr(row, "id"),
              slug: rowStr(row, "slug"),
              title: rowStr(row, "title"),
              content: rowStr(row, "content"),
              status: rowStr(row, "status"),
              extra: rowStr(row, "extra"),
              tags: rowStr(row, "tags"),
              version: rowNum(row, "version"),
            };
            step = `promote landed changes on baseline node ${node.slug}`;
            const plan = planLandedPromotion(node, landed);
            if (plan === undefined) continue;
            const by = requireMigrationActor(this.migrationActor, node.slug);
            const now = new Date().toISOString();
            await tx.execute({ sql: UPDATE_CONVERTED_NODE_SQL, args: promotedNodeBindings(node, plan, now) as InValue[] });
            await tx.execute({ sql: INSERT_CONVERSION_VERSION_SQL, args: promotedVersionBindings(node, plan, by, now) as InValue[] });
            const headRs = await tx.execute(SELECT_AUDIT_HEAD_SQL);
            const headRow = headRs.rows[0];
            const prevHash = headRow ? (rowStrOrNull(headRow, "entry_hash") ?? "") : "";
            await tx.execute({ sql: INSERT_AUDIT_SQL, args: auditBindings(promotionAuditEntry(node, plan, by, now), prevHash) as InValue[] });
          }
          step = "set user_version 29";
          await tx.execute(MIGRATION_029_SQL);
          step = "commit";
          await tx.commit();
        } catch (error) {
          try {
            await tx.rollback();
          } catch {
            // reason: rollback throws only when the transaction is already closed — the failure below is what to report.
          }
          throw new MigrationFailedError(29, step, this.localPath, error);
        } finally {
          tx.close();
        }
      }

      if (currentVersion < 30) {
        // reason: migration-030 is two-phase like 021 (see migration-030.ts's module JSDoc): the nullable
        // `runs.message_address` column is added only where `PRAGMA table_info` lacks it.
        for (const { table, column, ddl } of MIGRATION_030_ADD_COLUMNS) {
          const info = await this.client.execute(`PRAGMA table_info(${table})`);
          if (!info.rows.some((r) => rowStr(r, "name") === column)) await this.client.execute(ddl);
        }
        await this.client.executeMultiple(MIGRATION_030_SQL);
      }

      if (currentVersion < 31) {
        // reason: migration-031 creates the per-day read counter and deletes every per-read `get` trace row (BR-1373).
        await this.client.executeMultiple(MIGRATION_031_SQL);
      }

      if (currentVersion < 32) {
        // reason: migration-032 rebuilds decision_log with the verdict CHECK widened to 'milestone' (BR-1370, AC-LG-8).
        await this.client.executeMultiple(MIGRATION_032_SQL);
      }

      if (currentVersion < 33) {
        // reason: migration-033 creates check_outcomes (one row per gate/hook run, BR-1373).
        await this.client.executeMultiple(MIGRATION_033_SQL);
      }

      if (currentVersion < 34) {
        // reason: migration-034 creates pending_asks (the lore-written question bound to a single-use nonce, BR-1374).
        await this.client.executeMultiple(MIGRATION_034_SQL);
      }

      if (currentVersion < 35) {
        // reason: migration-035 backfills `extra.progress` on every plan (BR-1379).
        await this.client.executeMultiple(MIGRATION_035_SQL);
      }

      if (currentVersion < 36) {
        // reason: migration-036 creates review_leases (the review batch's expiring lease, BR-1379).
        await this.client.executeMultiple(MIGRATION_036_SQL);
      }

      if (currentVersion < 37) {
        // reason: migration-037 widens links.link_type to 'known-defect' and converts the batch's links (#404).
        await this.client.executeMultiple(MIGRATION_037_SQL);
      }

      if (currentVersion < 38) {
        // reason: migration-038 converts every known-defect link into the plan's extra.known_defects and removes the link
        // type (BR-1421), planned by the same pure function the SQLite store runs, in ONE interactive transaction.
        let step = "begin transaction";
        const tx = await this.client.transaction("write");
        try {
          step = "plan known-defect link conversion";
          const linkRs = await tx.execute(SELECT_KNOWN_DEFECT_LINKS_SQL);
          const rows: KnownDefectLinkRow[] = linkRs.rows.map((row) => ({
            from_id: rowStr(row, "from_id"),
            to_id: rowStr(row, "to_id"),
            from_slug: rowStr(row, "from_slug"),
            from_type: rowStr(row, "from_type"),
            to_slug: rowStrOrNull(row, "to_slug"),
            to_extra: rowStrOrNull(row, "to_extra"),
            to_content: rowStrOrNull(row, "to_content"),
          }));
          const plan = planKnownDefectConversion(rows);
          if (plan.unconvertible.length > 0) throw new Error(describeUnconvertible(plan.unconvertible));
          const planRows = new Map<string, BaselineNodeRow>();
          for (const id of new Set(plan.conversions.map((c) => c.planId))) {
            const rs = await tx.execute({ sql: SELECT_PLAN_ROW_SQL, args: [id] });
            const row = rs.rows[0];
            if (row === undefined) throw new Error(`plan ${id} not found`);
            planRows.set(id, {
              id: rowStr(row, "id"),
              slug: rowStr(row, "slug"),
              title: rowStr(row, "title"),
              content: rowStr(row, "content"),
              status: rowStr(row, "status"),
              extra: rowStr(row, "extra"),
              tags: rowStr(row, "tags"),
              version: rowNum(row, "version"),
            });
          }
          for (const write of planWrites(plan, (id) => planRows.get(id)?.extra ?? "{}")) {
            const row = planRows.get(write.planId);
            if (row === undefined || write.addedKeys === 0) continue;
            step = `record known defects on plan ${row.slug}`;
            const by = requireConversionActor(this.migrationActor, row.slug);
            const now = new Date().toISOString();
            await tx.execute({ sql: UPDATE_CONVERTED_NODE_SQL, args: convertedPlanBindings(row, write, now) as InValue[] });
            await tx.execute({ sql: INSERT_CONVERSION_VERSION_SQL, args: convertedPlanVersionBindings(row, write, by, now) as InValue[] });
            const headRs = await tx.execute(SELECT_AUDIT_HEAD_SQL);
            const headRow = headRs.rows[0];
            const prevHash = headRow ? (rowStrOrNull(headRow, "entry_hash") ?? "") : "";
            await tx.execute({ sql: INSERT_AUDIT_SQL, args: auditBindings(convertedPlanAuditEntry(row, write, by, now), prevHash) as InValue[] });
          }
          step = "delete links, remove the link type, set user_version 38";
          await tx.executeMultiple(MIGRATION_038_SQL);
          step = "commit";
          await tx.commit();
        } catch (error) {
          try {
            await tx.rollback();
          } catch {
            // reason: rollback throws only when the transaction is already closed — the failure below is what to report.
          }
          throw new MigrationFailedError(38, step, this.localPath, error);
        } finally {
          tx.close();
        }
      }

      if (currentVersion < 39) {
        // reason: migration-039 back-fills landing.kind and the claims' start_head once (D7, #422), planned by the same pure
        // function the SQLite store runs; the rows are read inside the write transaction (re-read under the lock).
        let step = "begin transaction";
        const tx = await this.client.transaction("write");
        try {
          step = "plan the landing back-fill";
          const rs = await tx.execute(SELECT_TASK_ROWS_SQL);
          const rows: BaselineNodeRow[] = rs.rows.map((row) => ({
            id: rowStr(row, "id"),
            slug: rowStr(row, "slug"),
            title: rowStr(row, "title"),
            content: rowStr(row, "content"),
            status: rowStr(row, "status"),
            extra: rowStr(row, "extra"),
            tags: rowStr(row, "tags"),
            version: rowNum(row, "version"),
          }));
          for (const write of planLandingBackfill(rows, this.localPath).writes) {
            step = `back-fill task ${write.row.slug}`;
            const by = requireMigrationActor(this.migrationActor, write.row.slug);
            const now = new Date().toISOString();
            await tx.execute({ sql: UPDATE_CONVERTED_NODE_SQL, args: taskWriteBindings(write, now) as InValue[] });
            await tx.execute({ sql: INSERT_CONVERSION_VERSION_SQL, args: taskVersionBindings(write, by, now) as InValue[] });
            const headRs = await tx.execute(SELECT_AUDIT_HEAD_SQL);
            const headRow = headRs.rows[0];
            const prevHash = headRow ? (rowStrOrNull(headRow, "entry_hash") ?? "") : "";
            await tx.execute({ sql: INSERT_AUDIT_SQL, args: auditBindings(taskAuditEntry(write, by, now), prevHash) as InValue[] });
          }
          step = "set user_version 39";
          await tx.executeMultiple(MIGRATION_039_SQL);
          step = "commit";
          await tx.commit();
        } catch (error) {
          try {
            await tx.rollback();
          } catch {
            // reason: rollback throws only when the transaction is already closed — the failure below is what to report.
          }
          throw new MigrationFailedError(39, step, this.localPath, error);
        } finally {
          tx.close();
        }
      }

      if (currentVersion < 40) {
        // reason: migration-040 marks released pre-#356 claims that hold neither start_head nor end_tip unrecoverable (#473),
        // planned by the same pure function the SQLite store runs. It reads NO git, so a replica with no checkout applies it.
        let step = "begin transaction";
        const tx = await this.client.transaction("write");
        try {
          step = "plan the unrecoverable-claim markers";
          const taskRs = await tx.execute(SELECT_TASK_CLAIM_HOLDERS_SQL);
          const tasks = taskRs.rows.map((row) => ({ id: rowStr(row, "id"), slug: rowStr(row, "slug"), extra: rowStr(row, "extra") }));
          const auditRs = await tx.execute(SELECT_CLAIM_AUDIT_ROWS_SQL);
          const auditRows = auditRs.rows.map((row) => ({
            id: rowNum(row, "id"),
            timestamp: rowStr(row, "timestamp"),
            action: rowStr(row, "action"),
            doc_id: rowStr(row, "doc_id"),
            details: rowStr(row, "details"),
          }));
          for (const mark of planUnrecoverableClaims(tasks, auditRows)) {
            step = `mark the claim of ${mark.slug} on ${mark.branch}`;
            const by = requireMigrationActor(this.migrationActor, mark.slug);
            const headRs = await tx.execute(SELECT_AUDIT_HEAD_SQL);
            const headRow = headRs.rows[0];
            const prevHash = headRow ? (rowStrOrNull(headRow, "entry_hash") ?? "") : "";
            const entry = unrecoverableClaimAuditEntry(mark, by, new Date().toISOString());
            await tx.execute({ sql: INSERT_AUDIT_SQL, args: auditBindings(entry, prevHash) as InValue[] });
          }
          step = "set user_version 40";
          await tx.executeMultiple(MIGRATION_040_SQL);
          step = "commit";
          await tx.commit();
        } catch (error) {
          try {
            await tx.rollback();
          } catch {
            // reason: rollback throws only when the transaction is already closed — the failure below is what to report.
          }
          throw new MigrationFailedError(40, step, this.localPath, error);
        } finally {
          tx.close();
        }
      }

      if (currentVersion < 41) {
        // reason: migration-041 is two-phase like 016/030 (see migration-041.ts's module JSDoc): the nullable `versions.decision`
        // column is added only where `PRAGMA table_info` lacks it, then one BEGIN/COMMIT string bumps user_version.
        for (const { table, column, ddl } of MIGRATION_041_ADD_COLUMNS) {
          const info = await this.client.execute(`PRAGMA table_info(${table})`);
          if (!info.rows.some((r) => rowStr(r, "name") === column)) await this.client.execute(ddl);
        }
        await this.client.executeMultiple(MIGRATION_041_SQL);
      }

      if (currentVersion < 42) {
        // reason: migration-042 is two-phase like 041: the nullable `ac_exemptions.decision` / `harness_run` columns are added only
        // where `PRAGMA table_info` lacks them, then one BEGIN/COMMIT string bumps user_version.
        for (const { table, column, ddl } of MIGRATION_042_ADD_COLUMNS) {
          const info = await this.client.execute(`PRAGMA table_info(${table})`);
          if (!info.rows.some((r) => rowStr(r, "name") === column)) await this.client.execute(ddl);
        }
        await this.client.executeMultiple(MIGRATION_042_SQL);
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
        return err({ code: "DOC_NOT_FOUND", id, rule: "BR-949" });
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
              sql: "UPDATE docs SET ordinal = ?, version = ? WHERE id = ? AND version = ? AND ordinal IS NULL RETURNING id",
              args: [candidate, newVersion, id, expectedVersion] as InValue[],
            });
            // reason: outcomes are decided from RETURNING rows, never the driver's affected-row count
            // (task-a-version-guarded-store-update-decides-its-outcome-from; same contract as SQLiteStore).
            if (updateRs.rows.length > 0) {
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
    return this.assignOrdinalForRepairTx(id, ordinal, undefined);
  }

  /**
   * @see StoreInterface.assignOrdinalForRepairWithProvenance
   * The same transaction as {@link assignOrdinalForRepair}, with the version row and audit row inside it.
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

      if (provenance !== undefined) {
        if (provenance.version.version !== newVersion) {
          await tx.rollback();
          return err({ code: "STALE_VERSION", id, expected: provenance.version.version - 1, actual: current.version });
        }
        const v = provenance.version;
        await tx.execute({
          sql: `INSERT INTO versions
                 (doc_id, version, content, extra, status, title,
                  action, created_at, created_by, change_summary, slug, harness_run, decision)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            v.doc_id,
            v.version,
            v.content,
            JSON.stringify(v.extra),
            v.status,
            v.title,
            v.action,
            v.created_at,
            v.created_by,
            v.change_summary ?? null,
            v.slug ?? null,
            v.harness_run ?? null,
            decisionToColumn(v.decision),
          ] as InValue[],
        });
        await this.appendAuditEntryTx(tx, provenance.audit);
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
        return err({ code: "DOC_NOT_FOUND", id, rule: "BR-949" });
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
               WHERE id = ? AND version = ? RETURNING id`,
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

        if (updateRs.rows.length === 0) {
          // Row exists (checked above) but version didn't match — re-read actual
          const actualRs = await this.client.execute({
            sql: "SELECT version FROM docs WHERE id = ?",
            args: [id],
          });
          const actualRow = actualRs.rows[0];

          if (!actualRow) {
            // Deleted between our SELECT and UPDATE (race)
            return err({ code: "DOC_NOT_FOUND", id, rule: "BR-949" });
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
  private async appendAuditEntryTx(tx: Transaction, rawEntry: AuditEntry): Promise<void> {
    const entry = stampAuditSurface(rawEntry);
    const headRs = await tx.execute("SELECT entry_hash FROM audit ORDER BY id DESC LIMIT 1");
    const headRow = headRs.rows[0];
    const prevHash = headRow ? (rowStrOrNull(headRow, "entry_hash") ?? "") : "";
    const entryHash = computeAuditEntryHash(entry, prevHash);
    await tx.execute({
      sql: `INSERT INTO audit
             (timestamp, actor, session_id, action, doc_id, details, prev_hash, entry_hash, harness_run)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.timestamp,
        entry.actor,
        entry.session_id,
        entry.action,
        entry.doc_id ?? null,
        JSON.stringify(entry.details ?? {}),
        prevHash,
        entryHash,
        entry.harness_run ?? null,
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
    rawDoc: DocRecord,
    rawVersion: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    // reason: BR-1379 — a plan is born with `extra.progress` (no member yet); applied to doc and v1 snapshot together.
    const { doc, version } = withInitialPlanProgress(rawDoc, rawVersion);
    await this.ensureReady();
    const tx = await this.client.transaction("write");
    try {
      const terminal = refuseArchivedTerminal(null, doc, await this.readPlanStatusTx(tx, doc));
      if (terminal !== null) {
        await tx.rollback();
        return err(terminal);
      }
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
                action, created_at, created_by, change_summary, slug, harness_run, decision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          version.harness_run ?? null,
          decisionToColumn(version.decision),
        ] as InValue[],
      });

      await this.appendAuditEntryTx(tx, audit);

      const progressResult = await this.reconcilePlanProgressTx(tx, planIdsAffectedBy(null, doc), version, doc.id);
      if (!progressResult.ok) {
        await tx.rollback();
        return progressResult;
      }

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
    rawDoc: DocRecord,
    rawVersion: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    // reason: BR-1379 — see insertWithProvenance.
    const { doc, version } = withInitialPlanProgress(rawDoc, rawVersion);
    await this.ensureReady();
    const tx = await this.client.transaction("write");
    try {
      const terminal = refuseArchivedTerminal(null, doc, await this.readPlanStatusTx(tx, doc));
      if (terminal !== null) {
        await tx.rollback();
        return err(terminal);
      }
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
                action, created_at, created_by, change_summary, slug, harness_run, decision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          version.harness_run ?? null,
          decisionToColumn(version.decision),
        ] as InValue[],
      });

      await this.appendAuditEntryTx(tx, audit);

      const progressResult = await this.reconcilePlanProgressTx(
        tx,
        planIdsAffectedBy(null, allocResult.value),
        version,
        doc.id,
      );
      if (!progressResult.ok) {
        await tx.rollback();
        return progressResult;
      }

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
    rawPatch: Partial<DocRecord>,
    opts: UpdateOpts | undefined,
    rawVersion: VersionRecord,
    audit: AuditEntry,
    snapshot: boolean,
    extras?: ProvenanceWriteExtras,
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
        return err({ code: "DOC_NOT_FOUND", id, rule: "BR-949" });
      }

      // reason: D6 / QA-2 — liveness is read INSIDE the write transaction (see SQLiteStore's twin).
      if (extras?.require_live_rules !== undefined && extras.require_live_rules.length > 0) {
        const lifecycles: Array<{ rule_id: string; lifecycle: string | null }> = [];
        for (const ruleId of extras.require_live_rules) {
          const rs = await tx.execute({ sql: "SELECT lifecycle FROM rule_registry WHERE id = ?", args: [ruleId] });
          const row = rs.rows[0];
          lifecycles.push({ rule_id: ruleId, lifecycle: row ? rowStr(row, "lifecycle") : null });
        }
        const refusal = buildNonLiveRuleRefusal(id, lifecycles);
        if (refusal !== null) {
          await tx.rollback();
          /** @lore-site BR-260 */
          return err(refusal);
        }
      }

      const current = rowToDocRecord(libsqlRowToDocRow(existingRow));
      // reason: BR-1379 — the stored row, read inside this transaction, judges the write: archived-terminal refusal,
      // progress kept across a plan edit, and the plans whose progress this write changes.
      const { patch, version } = keepStoredPlanProgress(current, rawPatch, rawVersion);
      const terminal = refuseArchivedTerminal(current, { ...current, ...patch }, null);
      if (terminal !== null) {
        await tx.rollback();
        return err(terminal);
      }
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
               WHERE id = ? AND version = ? RETURNING id`,
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

        if (updateRs.rows.length === 0) {
          const actualRs = await tx.execute({
            sql: "SELECT version FROM docs WHERE id = ?",
            args: [id],
          });
          const actualRow = actualRs.rows[0];
          await tx.rollback();

          if (!actualRow) {
            // Deleted between our SELECT and UPDATE (race)
            return err({ code: "DOC_NOT_FOUND", id, rule: "BR-949" });
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

      // reason: snapshot=false is a working-state-only write (ADR D1/D3): version raise + audit row commit, the
      // versions row is withheld. The caller decides; never infer here (SQLiteStore twin).
      if (snapshot) {
        await tx.execute({
          sql: `INSERT INTO versions
                 (doc_id, version, content, extra, status, title,
                  action, created_at, created_by, change_summary, slug, harness_run, decision)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            version.harness_run ?? null,
            decisionToColumn(version.decision),
          ] as InValue[],
        });
      }

      await this.appendAuditEntryTx(tx, audit);
      for (const extraAudit of extras?.also_audit ?? []) {
        await this.appendAuditEntryTx(tx, extraAudit);
      }

      // reason: BR-1307 — companion doc writes (a spec's rule retirements on its baseline leaves) share this
      // write transaction; each is version-guarded and decided from RETURNING rows, and the registry rows follow
      // the leaf writes through the docs triggers. Any failure rolls back the primary write too.
      for (const companion of extras?.also_update ?? []) {
        const companionRs = await tx.execute({ sql: "SELECT * FROM docs WHERE id = ?", args: [companion.id] });
        const companionRow = companionRs.rows[0];
        if (!companionRow) {
          await tx.rollback();
          return err({ code: "DOC_NOT_FOUND", id: companion.id });
        }
        const companionCurrent = rowToDocRecord(libsqlRowToDocRow(companionRow));
        const merged: DocRecord = { ...companionCurrent, ...companion.patch, id: companionCurrent.id };
        const mergedTagsJson = JSON.stringify(merged.tags);
        const mergedShadow = computeFtsShadowValues(merged.title, merged.content, mergedTagsJson);
        const expectedVersion = companion.opts.expected_version;
        const companionUpdateRs = await tx.execute({
          sql: `UPDATE docs SET
                 slug = ?, type = ?, role = ?, title = ?, status = ?,
                 priority = ?, content = ?, parent_id = ?, extra = ?,
                 tags = ?, version = ?, created_at = ?, updated_at = ?,
                 created_by = ?, deleted_at = ?, fts_title = ?, fts_content = ?,
                 fts_tags = ?
               WHERE id = ?${expectedVersion !== undefined ? " AND version = ?" : ""} RETURNING id`,
          args: [
            merged.slug,
            merged.type,
            merged.role,
            merged.title,
            merged.status,
            merged.priority,
            merged.content,
            merged.parent_id ?? null,
            JSON.stringify(merged.extra),
            mergedTagsJson,
            merged.version,
            merged.created_at,
            merged.updated_at,
            merged.created_by,
            merged.deleted_at ?? null,
            mergedShadow.fts_title,
            mergedShadow.fts_content,
            mergedShadow.fts_tags,
            companion.id,
            ...(expectedVersion !== undefined ? [expectedVersion] : []),
          ] as InValue[],
        });
        if (companionUpdateRs.rows.length === 0) {
          await tx.rollback();
          return err({
            code: "STALE_VERSION",
            id: companion.id,
            expected: expectedVersion ?? companionCurrent.version,
            actual: companionCurrent.version,
          });
        }
        if (companion.snapshot) {
          await tx.execute({
            sql: `INSERT INTO versions
                   (doc_id, version, content, extra, status, title,
                    action, created_at, created_by, change_summary, slug, harness_run, decision)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              companion.version.doc_id,
              companion.version.version,
              companion.version.content,
              JSON.stringify(companion.version.extra),
              companion.version.status,
              companion.version.title,
              companion.version.action,
              companion.version.created_at,
              companion.version.created_by,
              companion.version.change_summary ?? null,
              companion.version.slug ?? null,
              companion.version.harness_run ?? null,
              decisionToColumn(companion.version.decision),
            ] as InValue[],
          });
        }
        await this.appendAuditEntryTx(tx, companion.audit);
        // reason: the docs triggers keep a registry lifecycle the leaf no longer lists; see SQLiteStore's twin.
        for (const ruleId of companion.propose_rules ?? []) {
          await tx.execute({
            sql: "UPDATE rule_registry SET lifecycle = 'proposed' WHERE id = ? AND leaf_doc_id = ?",
            args: [ruleId, companion.id] as InValue[],
          });
        }
      }

      const progressResult = await this.reconcilePlanProgressTx(tx, planIdsAffectedBy(current, updated), version, id);
      if (!progressResult.ok) {
        await tx.rollback();
        return progressResult;
      }

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
        sql: "SELECT * FROM docs WHERE id = ?",
        args: [id],
      });
      const existingRow = existingRs.rows[0];

      if (!existingRow) {
        await tx.rollback();
        return err({ code: "DOC_NOT_FOUND", id });
      }
      const stored = rowToDocRecord(libsqlRowToDocRow(existingRow));

      const now = new Date().toISOString();
      await tx.execute({
        sql: "UPDATE docs SET deleted_at = ? WHERE id = ?",
        args: [now, id],
      });

      await tx.execute({
        sql: `INSERT INTO versions
               (doc_id, version, content, extra, status, title,
                action, created_at, created_by, change_summary, slug, harness_run, decision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          version.harness_run ?? null,
          decisionToColumn(version.decision),
        ] as InValue[],
      });

      await this.appendAuditEntryTx(tx, audit);

      const progressResult = await this.reconcilePlanProgressTx(tx, planIdsAffectedBy(stored, null), version, id);
      if (!progressResult.ok) {
        await tx.rollback();
        return progressResult;
      }

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

  /** The status of the live plan a task/phase `doc` is being filed under, or `null` when it has no live plan. */
  private async readPlanStatusTx(tx: Transaction, doc: DocRecord): Promise<DocRecord["status"] | null> {
    const planId = planIdsAffectedBy(null, doc)[0];
    if (planId === undefined) return null;
    const rs = await tx.execute({
      sql: "SELECT status FROM docs WHERE id = ? AND type = 'plan' AND deleted_at IS NULL",
      args: [planId],
    });
    const row = rs.rows[0];
    return row ? (rowStr(row, "status") as DocRecord["status"]) : null;
  }

  /**
   * BR-1379 — recompute `extra.progress` of each plan in `planIds` from its member rows and, when it changed, write the
   * plan (CAS on the version read here, version row, audit row) INSIDE the caller's open write transaction (twin of
   * `SQLiteStore.reconcilePlanProgressSync`). Returns the refusal; the caller rolls back.
   */
  private async reconcilePlanProgressTx(
    tx: Transaction,
    planIds: readonly DocId[],
    primaryVersion: VersionRecord,
    causeDocId: DocId,
  ): Promise<Result<void, LoreError>> {
    for (const planId of planIds) {
      const planRs = await tx.execute({ sql: "SELECT * FROM docs WHERE id = ?", args: [planId] });
      const planRow = planRs.rows[0];
      if (!planRow) continue;
      const plan = rowToDocRecord(libsqlRowToDocRow(planRow));
      if (plan.type !== "plan" || plan.deleted_at !== null) continue;
      const membersRs = await tx.execute({ sql: PLAN_MEMBERS_SQL, args: [planId, planId] as InValue[] });
      const members = membersRs.rows.map((row) => ({ status: rowStr(row, "status") as DocRecord["status"] }));
      const write = buildPlanProgressWrite(plan, members, {
        now: primaryVersion.created_at,
        actor: primaryVersion.created_by,
        harnessRun: primaryVersion.harness_run ?? null,
        causeDocId,
      });
      if (write === null) continue;
      const updateRs = await tx.execute({
        sql: "UPDATE docs SET extra = ?, version = ?, updated_at = ? WHERE id = ? AND version = ? RETURNING id",
        args: [
          JSON.stringify(write.patch.extra),
          write.patch.version,
          write.patch.updated_at,
          planId,
          write.expectedVersion,
        ] as InValue[],
      });
      if (updateRs.rows.length === 0) {
        return err({ code: "STALE_VERSION", id: planId, expected: write.expectedVersion, actual: plan.version });
      }
      const version = write.version;
      await tx.execute({
        sql: `INSERT INTO versions
               (doc_id, version, content, extra, status, title,
                action, created_at, created_by, change_summary, slug, harness_run, decision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          version.harness_run ?? null,
          decisionToColumn(version.decision),
        ] as InValue[],
      });
      await this.appendAuditEntryTx(tx, write.audit);
    }
    return ok(undefined);
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
          rule: "BR-949",
        });
      }
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.addLinkWithProvenance
   *
   * One `client.transaction("write")` around the link INSERT, the parent_id patch and the audit append
   * (the same interactive-transaction shape `updateWithProvenance` uses). The cycle walk runs BEFORE the
   * transaction opens — same check-then-write order `addLink` always had.
   */
  async addLinkWithProvenance(
    link: LinkRecord,
    audit: AuditEntry,
  ): Promise<Result<LinkRecord, LoreError>> {
    try {
      await this.ensureReady();
      if (link.link_type === "parent") {
        const cycleResult = await this.detectParentCycle(link.from_id, link.to_id);
        if (!cycleResult.ok) return cycleResult;
      }
    } catch (e) {
      return wrapStoreError(e);
    }

    let tx: Transaction;
    try {
      tx = await this.client.transaction("write");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      try {
        await tx.execute({
          sql: `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
                 VALUES (?, ?, ?, ?, ?)`,
          args: [link.from_id, link.to_id, link.link_type, link.created_at, link.created_by],
        });
      } catch (e) {
        await tx.rollback();
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("UNIQUE constraint failed: links.")) {
          return err({ code: "DUPLICATE_LINK", from: link.from_id, to: link.to_id, type: link.link_type });
        }
        return wrapStoreError(e);
      }

      if (link.link_type === "parent") {
        const updateRs = await tx.execute({
          sql: "UPDATE docs SET parent_id = ?, updated_at = ? WHERE id = ? RETURNING id",
          args: [link.to_id, link.created_at, link.from_id],
        });
        if (updateRs.rows.length === 0) {
          await tx.rollback();
          return err({ code: "DOC_NOT_FOUND", id: link.from_id, rule: "BR-550" });
        }
      }

      await this.appendAuditEntryTx(tx, audit);
      await tx.commit();
      return ok(link);
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: same as updateWithProvenance — rollback throws only when the transaction is already gone.
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  /**
   * @see StoreInterface.setDocParentWithProvenance
   *
   * One `client.transaction("write")` around the parent_id UPDATE, the parent-link DELETE (clear case
   * only) and the audit append — same interactive-transaction shape `addLinkWithProvenance` uses.
   */
  async setDocParentWithProvenance(
    id: DocId,
    parentId: DocId | null,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    try {
      await this.ensureReady();
    } catch (e) {
      return wrapStoreError(e);
    }
    let tx: Transaction;
    try {
      tx = await this.client.transaction("write");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const updateRs = await tx.execute({
        sql: "UPDATE docs SET parent_id = ?, updated_at = ? WHERE id = ? RETURNING id",
        args: [parentId, audit.timestamp, id] as InValue[],
      });
      if (updateRs.rows.length === 0) {
        await tx.rollback();
        return err({ code: "DOC_NOT_FOUND", id });
      }
      if (parentId === null) {
        await tx.execute({
          sql: "DELETE FROM links WHERE from_id = ? AND link_type = 'parent'",
          args: [id],
        });
      }
      await this.appendAuditEntryTx(tx, audit);
      const rowRs = await tx.execute({ sql: "SELECT * FROM docs WHERE id = ?", args: [id] });
      const row = rowRs.rows[0];
      if (!row) {
        await tx.rollback();
        return err({ code: "DOC_NOT_FOUND", id });
      }
      await tx.commit();
      return ok(rowToDocRecord(libsqlRowToDocRow(row)));
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: same as addLinkWithProvenance — rollback throws only when the transaction is already gone.
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
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
                action, created_at, created_by, change_summary, slug, harness_run, decision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          version.harness_run ?? null,
          decisionToColumn(version.decision),
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

  async listDecisionVersions(query: DecisionVersionQuery): Promise<Result<VersionRecord[], LoreError>> {
    try {
      await this.ensureReady();
    const clauses: string[] = [];
    const args: (string)[] = [];
    if (query.docIds.length > 0) {
      clauses.push(`doc_id IN (${query.docIds.map(() => "?").join(", ")})`);
      args.push(...query.docIds);
    }
    for (const w of query.windows) {
      clauses.push(w.to === undefined ? `(harness_run = ? AND created_at >= ?)` : `(harness_run = ? AND created_at >= ? AND created_at <= ?)`);
      args.push(w.run, w.from, ...(w.to === undefined ? [] : [w.to]));
    }
    if (clauses.length === 0) return ok([]);
    const sql = `SELECT * FROM versions WHERE decision IS NOT NULL AND (${clauses.join(" OR ")}) ORDER BY created_at ASC, doc_id ASC, version ASC`;
      const rs = await this.client.execute({ sql, args: args as InValue[] });
      return ok(rs.rows.map((row) => rowToVersionRecord(libsqlRowToVersionRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listRecordedDecisions(since?: string): Promise<Result<VersionRecord[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute(
        since !== undefined
          ? { sql: `SELECT * FROM versions WHERE decision IS NOT NULL AND created_at >= ? ORDER BY created_at ASC, doc_id ASC, version ASC`, args: [since] }
          : { sql: `SELECT * FROM versions WHERE decision IS NOT NULL ORDER BY created_at ASC, doc_id ASC, version ASC`, args: [] },
      );
      return ok(rs.rows.map((row) => rowToVersionRecord(libsqlRowToVersionRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listVersionKeys(since?: string): Promise<Result<VersionKey[], LoreError>> {
    try {
      await this.ensureReady();
      // reason: the four selected columns are exactly the columns of idx_versions_keys (migration-025), so the
      // index alone answers this and a versions row's content/extra pages are never read.
      const rs =
        since !== undefined
          ? await this.client.execute({
              sql: `SELECT doc_id, version, action, created_at FROM versions WHERE created_at >= ? ORDER BY created_at ASC`,
              args: [since] as InValue[],
            })
          : await this.client.execute(`SELECT doc_id, version, action, created_at FROM versions ORDER BY created_at ASC`);
      return ok(
        rs.rows.map((row) =>
          rowToVersionKey({
            doc_id: String(row["doc_id"]),
            version: Number(row["version"]),
            action: String(row["action"]),
            created_at: String(row["created_at"]),
          }),
        ),
      );
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

  // ── Decision log (migration-020, AC-AU-2) ──────────────────────────────

  /**
   * @see StoreInterface.appendDecisionRecord
   *
   * Head-read + insert through ONE `transaction("write")` (libsql serializes concurrent writers on it), same
   * shape as {@link appendAuditEntryTx}.
   */
  async appendDecisionRecord(input: DecisionRecordInput): Promise<Result<DecisionLogRow, LoreError>> {
    try {
      await this.ensureReady();
      const tx = await this.client.transaction("write");
      try {
        const headRs = await tx.execute("SELECT entry_hash FROM decision_log ORDER BY id DESC LIMIT 1");
        const headRow = headRs.rows[0];
        const prevHash = headRow ? rowStr(headRow, "entry_hash") : DECISION_GENESIS_HASH;
        const entryHash = computeDecisionEntryHash(input, prevHash);
        const rs = await tx.execute({
          sql: `INSERT INTO decision_log
                  (ts, class, subject_id, subject_version, facts, factors, score, threshold, verdict, reasons,
                   executor_run, channel, prev_hash, entry_hash, detail)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
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
          ] as InValue[],
        });
        await tx.commit();
        return ok({ ...input, detail: input.detail ?? null, id: Number(rs.lastInsertRowid), prev_hash: prevHash, entry_hash: entryHash });
      } catch (e) {
        try {
          await tx.rollback();
        } catch {
          // reason: rollback throws only when the transaction is already closed — `e` is what the caller needs.
        }
        throw e;
      } finally {
        tx.close();
      }
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.readAutonomyThresholds
   */
  async readAutonomyThresholds(): Promise<Result<{ readonly content: string; readonly updated_at: string } | null, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute("SELECT content, updated_at FROM autonomy_thresholds WHERE id = 1");
      const row = rs.rows[0];
      return ok(row === undefined ? null : { content: rowStr(row, "content"), updated_at: rowStr(row, "updated_at") });
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.writeAutonomyThresholds
   */
  async writeAutonomyThresholds(content: string, updatedAt: string): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({
        sql: "INSERT INTO autonomy_thresholds (id, content, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
        args: [content, updatedAt],
      });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.listDecisionLog
   */
  async listDecisionLog(subject?: DecisionSubjectKey): Promise<Result<DecisionLogRow[], LoreError>> {
    try {
      await this.ensureReady();
      const rs =
        subject === undefined
          ? await this.client.execute("SELECT * FROM decision_log ORDER BY id ASC")
          : await this.client.execute({
              sql: "SELECT * FROM decision_log WHERE class = ? AND subject_id = ? AND subject_version = ? ORDER BY id ASC",
              args: [subject.class, subject.subject_id, subject.subject_version],
            });
      return ok(
        rs.rows.map(
          (row): DecisionLogRow => ({
            id: rowNum(row, "id"),
            ts: rowStr(row, "ts"),
            class: rowStr(row, "class"),
            subject_id: rowStr(row, "subject_id"),
            subject_version: rowStr(row, "subject_version"),
            facts: rowStr(row, "facts"),
            factors: rowStr(row, "factors"),
            score: rowNum(row, "score"),
            threshold: rowNumOrNull(row, "threshold"),
            verdict: rowStr(row, "verdict") as DecisionLogRow["verdict"],
            reasons: rowStr(row, "reasons"),
            executor_run: rowStrOrNull(row, "executor_run"),
            channel: rowStr(row, "channel") as DecisionLogRow["channel"],
            prev_hash: rowStr(row, "prev_hash"),
            entry_hash: rowStr(row, "entry_hash"),
            detail: rowStrOrNull(row, "detail"),
          }),
        ),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Rule registry (migration-013, spec C2) ─────────────────────────────

  /**
   * CAS-update one rule-bearing leaf's `extra` and insert its `action:
   * "update"` version row on the caller's open write transaction. Mirror of
   * `SQLiteStore.applyRuleLeafPatchSync`; a missing/soft-deleted leaf is
   * `DOC_NOT_FOUND`. Never commits, rolls back or closes `tx` — an `err`
   * return tells the caller to roll back; a thrown driver error is caught by
   * the caller's own catch/rollback.
   */
  private async applyRuleLeafPatchTx(
    tx: Transaction,
    patch: RuleLeafPatch,
    actor: string,
    nowIso: string,
  ): Promise<Result<DocRecord, LoreError>> {
    const existingRs = await tx.execute({
      sql: "SELECT * FROM docs WHERE id = ?",
      args: [patch.id],
    });
    const existingRow = existingRs.rows[0];
    if (!existingRow || rowStrOrNull(existingRow, "deleted_at") !== null) {
      return err({ code: "DOC_NOT_FOUND", id: patch.id });
    }
    const current = rowToDocRecord(libsqlRowToDocRow(existingRow));
    const updated: DocRecord = {
      ...current,
      extra: patch.extra,
      version: patch.expectedVersion + 1,
      updated_at: nowIso,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    const tagsJson = JSON.stringify(updated.tags);
    // reason: same shadow-column obligation as update() — an UPDATE that skips
    // fts_* leaves CJK search reflecting pre-patch text.
    const shadow = computeFtsShadowValues(updated.title, updated.content, tagsJson);
    const updateRs = await tx.execute({
      sql: `UPDATE docs SET
             slug = ?, type = ?, role = ?, title = ?, status = ?,
             priority = ?, content = ?, parent_id = ?, extra = ?,
             tags = ?, version = ?, created_at = ?, updated_at = ?,
             created_by = ?, deleted_at = ?, fts_title = ?, fts_content = ?,
             fts_tags = ?
           WHERE id = ? AND version = ? RETURNING id`,
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
        tagsJson,
        updated.version,
        updated.created_at,
        updated.updated_at,
        updated.created_by,
        updated.deleted_at ?? null,
        shadow.fts_title,
        shadow.fts_content,
        shadow.fts_tags,
        patch.id,
        patch.expectedVersion,
      ] as InValue[],
    });
    if (updateRs.rows.length === 0) {
      return err({
        code: "STALE_VERSION",
        id: patch.id,
        expected: patch.expectedVersion,
        actual: current.version,
      });
    }
    await tx.execute({
      sql: `INSERT INTO versions
             (doc_id, version, content, extra, status, title,
              action, created_at, created_by, change_summary, slug, harness_run, decision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        updated.id,
        updated.version,
        updated.content,
        JSON.stringify(updated.extra),
        updated.status,
        updated.title,
        "update",
        nowIso,
        actor,
        patch.change_summary ?? null,
        updated.slug,
        patch.harness_run ?? null,
        decisionToColumn(patch.decision),
      ] as InValue[],
    });
    return ok(updated);
  }

  /**
   * Tail of the in-process queue serialising rule-registry writes.
   *
   * reason: libsql's local-file client opens a fresh connection per
   * `transaction("write")` with a 0ms busy bound, so two overlapping write
   * transactions in ONE process make the second `BEGIN IMMEDIATE` throw
   * SQLITE_BUSY instead of waiting. Queueing the registry writes keeps same-
   * process callers from racing; it is ordering, not a timer/retry.
   * Cross-process contention is not queued and still surfaces as a loud
   * STORE_ERROR (never a duplicate id).
   */
  private ruleWriteTail: Promise<unknown> = Promise.resolve();

  private serializeRuleWrite<T>(run: () => Promise<T>): Promise<T> {
    const result = this.ruleWriteTail.then(run);
    // reason: the tail only orders the NEXT write; this call's own outcome
    // (including a rejection) is returned to its caller via `result`.
    this.ruleWriteTail = result.catch(() => undefined);
    return result;
  }

  /**
   * @see StoreInterface.allocateRuleAndUpdateLeaf
   *
   * reason: `MAX(n)` is read on the SAME write transaction as the registry
   * insert, so the read-then-insert is serialised by the write lock — a
   * pre-read outside the transaction reopens the duplicate-id race (QA-1).
   */
  async allocateRuleAndUpdateLeaf(
    leafId: DocId,
    expectedVersion: number,
    buildExtra: (ruleId: string) => Record<string, unknown>,
    actor: string,
    prefix: RuleIdPrefix = "BR",
    harnessRun: string | null = null,
    decision: DecisionRecord | null = null,
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>> {
    return this.serializeRuleWrite(() =>
      this.allocateRuleSerialized(
        { docId: leafId, expectedVersion, buildExtra, harnessRun, ...(decision !== null ? { decision } : {}) },
        { ownerDocId: leafId, proposed: false },
        actor,
        prefix,
      ),
    );
  }

  /** @see StoreInterface.reserveProposedRuleAndUpdateSpec */
  async reserveProposedRuleAndUpdateSpec(
    write: ProposedRuleWrite,
    actor: string,
    prefix: RuleIdPrefix = "BR",
    harnessRun: string | null = null,
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>> {
    return this.serializeRuleWrite(() =>
      this.allocateRuleSerialized(
        {
          docId: write.specId,
          expectedVersion: write.expectedVersion,
          buildExtra: write.buildExtra,
          harnessRun,
          ...(write.status !== undefined ? { status: write.status } : {}),
          ...(write.changeSummary !== undefined ? { changeSummary: write.changeSummary } : {}),
          ...(write.decision !== undefined ? { decision: write.decision } : {}),
        },
        { ownerDocId: write.ownerLeafId, proposed: true },
        actor,
        prefix,
      ),
    );
  }

  /** @see StoreInterface.repointProposedRuleAndUpdateSpec */
  async repointProposedRuleAndUpdateSpec(
    write: ProposedRuleRepointWrite,
    actor: string,
    harnessRun: string | null = null,
  ): Promise<Result<DocRecord, LoreError>> {
    return this.serializeRuleWrite(() => this.repointProposedRuleSerialized(write, actor, harnessRun));
  }

  /** One write transaction of {@link repointProposedRuleAndUpdateSpec} — mirror of `SQLiteStore.repointProposedRuleAndUpdateSpec`. */
  private async repointProposedRuleSerialized(
    write: ProposedRuleRepointWrite,
    actor: string,
    harnessRun: string | null,
  ): Promise<Result<DocRecord, LoreError>> {
    let tx: Transaction;
    try {
      await this.ensureReady();
      tx = await this.client.transaction("write");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const regRs = await tx.execute({ sql: "SELECT lifecycle FROM rule_registry WHERE id = ?", args: [write.ruleId] });
      const regRow = regRs.rows[0];
      if (!regRow) {
        await tx.rollback();
        return err({ code: "DOC_NOT_FOUND", id: write.ruleId });
      }
      const lifecycle = rowStr(regRow, "lifecycle");
      if (lifecycle !== "proposed") {
        await tx.rollback();
        return err({
          code: "VALIDATION_ERROR",
          field: "id",
          message: `${write.ruleId} is ${lifecycle} in the registry; only a proposed id can be re-pointed`,
          value: write.ruleId,
        });
      }
      const leafRs = await tx.execute({ sql: "SELECT version, deleted_at FROM docs WHERE id = ?", args: [write.toLeafId] });
      const leafRow = leafRs.rows[0];
      if (!leafRow || rowStrOrNull(leafRow, "deleted_at") !== null) {
        await tx.rollback();
        return err({ code: "DOC_NOT_FOUND", id: write.toLeafId });
      }
      const written = await this.applyRuleLeafPatchTx(
        tx,
        {
          id: write.specId,
          expectedVersion: write.expectedVersion,
          extra: write.extra,
          harness_run: harnessRun,
          ...(write.status !== undefined ? { status: write.status } : {}),
          ...(write.changeSummary !== undefined ? { change_summary: write.changeSummary } : {}),
          ...(write.decision !== undefined ? { decision: write.decision } : {}),
        },
        actor,
        new Date().toISOString(),
      );
      if (!written.ok) {
        await tx.rollback();
        return written;
      }
      await tx.execute({
        sql: "UPDATE rule_registry SET leaf_doc_id = ?, version = ? WHERE id = ?",
        args: [write.toLeafId, rowNum(leafRow, "version"), write.ruleId] as InValue[],
      });
      await tx.commit();
      return ok(written.value);
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: rollback throws only when the transaction is already closed — safe to ignore.
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  /**
   * One write transaction shared by {@link allocateRuleAndUpdateLeaf} (a rule written into its leaf) and
   * {@link reserveProposedRuleAndUpdateSpec} (a `proposed` id reserved while the SPEC is written) — mirror of
   * `SQLiteStore.allocateRuleCore`.
   */
  private async allocateRuleSerialized(
    doc: {
      docId: DocId;
      expectedVersion: number;
      buildExtra: (ruleId: string) => Record<string, unknown>;
      harnessRun: string | null;
      decision?: DecisionRecord;
      status?: DocStatus;
      changeSummary?: string;
    },
    registry: { ownerDocId: DocId; proposed: boolean },
    actor: string,
    prefix: RuleIdPrefix,
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>> {
    let tx: Transaction;
    try {
      await this.ensureReady();
      tx = await this.client.transaction("write");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const nextRs = await tx.execute({
        sql: "SELECT COALESCE(MAX(n), 0) + 1 AS next_n FROM rule_registry WHERE prefix = ?",
        args: [prefix],
      });
      const nextN = rowNum(nextRs.rows[0] as Row, "next_n");
      const ruleId = `${prefix}-${nextN}`;
      const nowIso = new Date().toISOString();
      const written = await this.applyRuleLeafPatchTx(
        tx,
        {
          id: doc.docId,
          expectedVersion: doc.expectedVersion,
          extra: doc.buildExtra(ruleId),
          harness_run: doc.harnessRun,
          ...(doc.decision !== undefined ? { decision: doc.decision } : {}),
          ...(doc.status !== undefined ? { status: doc.status } : {}),
          ...(doc.changeSummary !== undefined ? { change_summary: doc.changeSummary } : {}),
        },
        actor,
        nowIso,
      );
      if (!written.ok) {
        await tx.rollback();
        return written;
      }
      let registryVersion = written.value.version;
      if (registry.proposed) {
        // reason: a proposed id is listed by NO leaf and the leaf is not written, so its registry version is the
        // owner leaf's current one; a missing/deleted owner aborts the reservation (rolled back below).
        const ownerRs = await tx.execute({
          sql: "SELECT version, deleted_at FROM docs WHERE id = ?",
          args: [registry.ownerDocId],
        });
        const ownerRow = ownerRs.rows[0];
        if (!ownerRow || rowStrOrNull(ownerRow, "deleted_at") !== null) {
          await tx.rollback();
          return err({ code: "DOC_NOT_FOUND", id: registry.ownerDocId });
        }
        registryVersion = rowNum(ownerRow, "version");
      }
      await tx.execute({
        // reason: the docs_idx_baseline_au trigger ran inside the doc UPDATE BEFORE this row existed,
        // so lifecycle/version are written explicitly (mirrors SQLiteStore.allocateRuleCore).
        sql: "INSERT INTO rule_registry (id, prefix, n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          ruleId,
          prefix,
          nextN,
          registry.ownerDocId,
          nowIso,
          actor,
          registry.proposed ? "proposed" : (listedRuleLifecycle(written.value.extra, ruleId) ?? "live"),
          registryVersion,
        ] as InValue[],
      });
      await tx.commit();
      return ok({ ruleId, doc: written.value });
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: rollback throws only when the transaction is already closed — safe to ignore.
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
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
    return this.serializeRuleWrite(() => this.moveRuleSerialized(ruleId, fromLeaf, toLeaf, actor));
  }

  private async moveRuleSerialized(
    ruleId: string,
    fromLeaf: RuleLeafPatch,
    toLeaf: RuleLeafPatch,
    actor: string,
  ): Promise<Result<{ from: DocRecord; to: DocRecord }, LoreError>> {
    let tx: Transaction;
    try {
      await this.ensureReady();
      tx = await this.client.transaction("write");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const registryRs = await tx.execute({
        sql: "SELECT leaf_doc_id FROM rule_registry WHERE id = ?",
        args: [ruleId],
      });
      const registryRow = registryRs.rows[0];
      if (!registryRow) {
        await tx.rollback();
        return err({ code: "DOC_NOT_FOUND", id: ruleId, rule: "BR-640" });
      }
      const owner = rowStr(registryRow, "leaf_doc_id");
      if (owner !== fromLeaf.id) {
        await tx.rollback();
        return err({
          code: "VALIDATION_ERROR",
          field: "fromLeaf.id",
          message: `rule ${ruleId} is registered to leaf ${owner}, not ${fromLeaf.id}`,
          value: fromLeaf.id,
          rule: "BR-640",
        });
      }
      const nowIso = new Date().toISOString();
      const from = await this.applyRuleLeafPatchTx(tx, fromLeaf, actor, nowIso);
      if (!from.ok) {
        await tx.rollback();
        return from;
      }
      const to = await this.applyRuleLeafPatchTx(tx, toLeaf, actor, nowIso);
      if (!to.ok) {
        await tx.rollback();
        return to;
      }
      await tx.execute({
        // reason: see SQLiteStore.moveRule — owner + lifecycle + version re-pointed at the destination.
        sql: "UPDATE rule_registry SET leaf_doc_id = ?, lifecycle = ?, version = ? WHERE id = ?",
        args: [
          toLeaf.id,
          listedRuleLifecycle(to.value.extra, ruleId) ?? "live",
          to.value.version,
          ruleId,
        ] as InValue[],
      });
      await tx.commit();
      return ok({ from: from.value, to: to.value });
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: same as allocateRuleAndUpdateLeaf — safe to ignore.
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  /**
   * @see StoreInterface.listRuleRegistry
   */
  async listRuleRegistry(): Promise<Result<RuleRegistryRow[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute(
        "SELECT id, n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version FROM rule_registry ORDER BY n ASC, prefix ASC",
      );
      return ok(
        rs.rows.map((row) => ({
          id: rowStr(row, "id"),
          n: rowNum(row, "n"),
          leaf_doc_id: rowStr(row, "leaf_doc_id"),
          allocated_at: rowStr(row, "allocated_at"),
          allocated_by: rowStr(row, "allocated_by"),
          // CHECK(lifecycle IN (...)) in migration-014 guarantees the cast
          lifecycle: rowStr(row, "lifecycle") as RuleRegistryRow["lifecycle"],
          version: rowNum(row, "version"),
        })),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.insertAcExemptionCapped
   *
   * reason: runs on the same write-serialisation tail as the rule writes and inside one write
   * transaction whose INSERT is `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?`, so
   * count-then-insert is atomic in-process and at the database (AC-BLS2-10).
   */
  async insertAcExemptionCapped(
    row: AcExemptionRow,
    cap: AcExemptionCap,
  ): Promise<Result<AcExemptionRow, LoreError>> {
    return this.serializeRuleWrite(() => this.insertAcExemptionCappedSerialized(row, cap));
  }

  private async insertAcExemptionCappedSerialized(
    row: AcExemptionRow,
    cap: AcExemptionCap,
  ): Promise<Result<AcExemptionRow, LoreError>> {
    let tx: Transaction;
    try {
      await this.ensureReady();
      tx = await this.client.transaction("write");
    } catch (e) {
      return wrapStoreError(e);
    }
    try {
      const existing = await tx.execute({
        sql: "SELECT expires_at FROM ac_exemptions WHERE doc_id = ? AND ac_id = ?",
        args: [row.doc_id, row.ac_id],
      });
      const existingRow = existing.rows[0];
      const satisfied = cap.satisfied ?? NO_SATISFIED_EXEMPTIONS;
      if (
        existingRow !== undefined &&
        isExemptionActive(
          { doc_id: row.doc_id, ac_id: row.ac_id, expires_at: rowStr(existingRow, "expires_at") },
          cap.now,
          satisfied,
        )
      ) {
        await tx.rollback();
        return err(buildAcExemptionAlreadyActiveError(row.doc_id, row.ac_id));
      }
      if (existingRow !== undefined) {
        await tx.execute({
          sql: "DELETE FROM ac_exemptions WHERE doc_id = ? AND ac_id = ?",
          args: [row.doc_id, row.ac_id],
        });
      }
      // reason: the active count applies the shared predicate in TS (cite-satisfaction is not a SQL fact);
      // the write transaction serialises count-then-insert.
      const unexpired = await tx.execute({
        sql: "SELECT doc_id, ac_id, expires_at FROM ac_exemptions WHERE expires_at > ?",
        args: [cap.now],
      });
      const activeCount = unexpired.rows.filter((r) =>
        isExemptionActive(
          { doc_id: rowStr(r, "doc_id"), ac_id: rowStr(r, "ac_id"), expires_at: rowStr(r, "expires_at") },
          cap.now,
          satisfied,
        ),
      ).length;
      if (activeCount >= cap.maxActive) {
        await tx.rollback();
        return err(buildAcExemptionCapError(activeCount, cap.liveCriteria, cap.maxActive));
      }
      await tx.execute({
        sql: `INSERT INTO ac_exemptions (doc_id, ac_id, reason, expires_at, granted_by, granted_at, decision, harness_run)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [row.doc_id, row.ac_id, row.reason, row.expires_at, row.granted_by, row.granted_at, decisionToColumn(row.decision), row.harness_run ?? null],
      });
      await tx.commit();
      return ok({ ...row });
    } catch (e) {
      try {
        await tx.rollback();
      } catch {
        // reason: same as allocateRuleAndUpdateLeaf — rollback throws only when the transaction is
        // already closed; `e` below is what the caller needs.
      }
      return wrapStoreError(e);
    } finally {
      tx.close();
    }
  }

  /** @see StoreInterface.listAcExemptions */
  async listAcExemptions(): Promise<Result<AcExemptionRow[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute(`SELECT ${AC_EXEMPTION_COLUMNS} FROM ac_exemptions ORDER BY doc_id, ac_id`);
      return ok(rs.rows.map(libsqlRowToAcExemption));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /** @see StoreInterface.listDecisionExemptions */
  async listDecisionExemptions(query: DecisionVersionQuery): Promise<Result<AcExemptionRow[], LoreError>> {
    try {
      await this.ensureReady();
      const clauses: string[] = [];
      const args: string[] = [];
      if (query.docIds.length > 0) {
        clauses.push(`doc_id IN (${query.docIds.map(() => "?").join(", ")})`);
        args.push(...query.docIds);
      }
      for (const w of query.windows) {
        clauses.push(w.to === undefined ? `(harness_run = ? AND granted_at >= ?)` : `(harness_run = ? AND granted_at >= ? AND granted_at <= ?)`);
        args.push(w.run, w.from, ...(w.to === undefined ? [] : [w.to]));
      }
      if (clauses.length === 0) return ok([]);
      const sql = `SELECT ${AC_EXEMPTION_COLUMNS} FROM ac_exemptions WHERE decision IS NOT NULL AND (${clauses.join(" OR ")}) ORDER BY granted_at ASC, doc_id ASC, ac_id ASC`;
      const rs = await this.client.execute({ sql, args: args as InValue[] });
      return ok(rs.rows.map(libsqlRowToAcExemption));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /** @see StoreInterface.listRecordedExemptionDecisions */
  async listRecordedExemptionDecisions(since?: string): Promise<Result<AcExemptionRow[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute(
        since !== undefined
          ? { sql: `SELECT ${AC_EXEMPTION_COLUMNS} FROM ac_exemptions WHERE decision IS NOT NULL AND granted_at >= ? ORDER BY granted_at ASC, doc_id ASC, ac_id ASC`, args: [since] }
          : { sql: `SELECT ${AC_EXEMPTION_COLUMNS} FROM ac_exemptions WHERE decision IS NOT NULL ORDER BY granted_at ASC, doc_id ASC, ac_id ASC`, args: [] },
      );
      return ok(rs.rows.map(libsqlRowToAcExemption));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /** @see StoreInterface.listAcCites */
  async listAcCites(): Promise<Result<AcCiteRow[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute(
        "SELECT doc_id, ac_id, rule_id FROM ac_cites ORDER BY doc_id, ac_id, rule_id",
      );
      return ok(
        rs.rows.map((row) => ({
          doc_id: rowStr(row, "doc_id"),
          ac_id: rowStr(row, "ac_id"),
          rule_id: rowStr(row, "rule_id"),
        })),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /** @see StoreInterface.listRuleDepends */
  async listRuleDepends(): Promise<Result<RuleDependsRow[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute(
        "SELECT leaf_id, rule_id FROM rule_depends ORDER BY leaf_id, rule_id",
      );
      return ok(
        rs.rows.map((row) => ({
          leaf_id: rowStr(row, "leaf_id"),
          rule_id: rowStr(row, "rule_id"),
        })),
      );
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

  async countTraceZeroHitSearches(window: TraceStatsWindow): Promise<Result<number, LoreError>> {
    // reason: DERIVED from the member list, never a second COUNT(*) — see
    // StoreInterface.countTraceZeroHitSearches's own ⛔ note.
    const listResult = await this.listTraceZeroHitSearches(window);
    if (!listResult.ok) return listResult;
    return ok(listResult.value.length);
  }

  async incrementReadCount(day: string): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      // reason: ONE atomic upsert (BR-1373) — a read-then-write pair would lose concurrent increments.
      await this.client.execute({
        sql: "INSERT INTO trace_read_counts (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1",
        args: [day],
      });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  private async readLeaseRow(name: string): Promise<LeaseRecord | null> {
    const rs = await this.client.execute({ sql: "SELECT name, holder, expires_at FROM review_leases WHERE name = ?", args: [name] });
    const row = rs.rows[0];
    return row === undefined ? null : { name: rowStr(row, "name"), holder: rowStr(row, "holder"), expires_at: rowStr(row, "expires_at") };
  }

  async acquireLease(name: string, holder: string, nowIso: string, expiresAtIso: string): Promise<Result<LeaseAcquisition, LoreError>> {
    try {
      await this.ensureReady();
      const prior = await this.readLeaseRow(name);
      // reason: ONE atomic upsert whose WHERE admits only an absent, expired or own row (BR-1379); the outcome is
      // read from RETURNING rows, never the driver's rowsAffected (see store CLAUDE.md).
      const taken = await this.client.execute({
        sql:
          "INSERT INTO review_leases (name, holder, expires_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at " +
          "WHERE review_leases.expires_at <= ? OR review_leases.holder = excluded.holder RETURNING name",
        args: [name, holder, expiresAtIso, nowIso],
      });
      if (taken.rows.length > 0) return ok({ acquired: true, tookOver: prior !== null && prior.holder !== holder });
      const live = await this.readLeaseRow(name);
      if (live === null) return err({ code: "STORE_ERROR", message: `review lease ${name} vanished during acquire` });
      return ok({ acquired: false, holder: live.holder, expires_at: live.expires_at });
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async renewLease(name: string, holder: string, expiresAtIso: string): Promise<Result<boolean, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({ sql: "UPDATE review_leases SET expires_at = ? WHERE name = ? AND holder = ? RETURNING name", args: [expiresAtIso, name, holder] });
      return ok(rs.rows.length > 0);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async releaseLease(name: string, holder: string): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({ sql: "DELETE FROM review_leases WHERE name = ? AND holder = ? RETURNING name", args: [name, holder] });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async readLease(name: string): Promise<Result<LeaseRecord | null, LoreError>> {
    try {
      await this.ensureReady();
      return ok(await this.readLeaseRow(name));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listReadCounts(sinceDay: string): Promise<Result<ReadDayCount[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT day, count FROM trace_read_counts WHERE day >= ? ORDER BY day ASC",
        args: [sinceDay],
      });
      return ok(rs.rows.map((row) => ({ day: rowStr(row, "day"), count: Number(row["count"]) })));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async appendCheckOutcomes(rows: readonly CheckOutcomeInput[]): Promise<Result<void, LoreError>> {
    if (rows.length === 0) return ok(undefined);
    try {
      await this.ensureReady();
      // reason: one batch (implicit transaction) so an ingest lands whole or not at all.
      await this.client.batch(
        rows.map((row) => ({ sql: "INSERT INTO check_outcomes (check_id, outcome, ts) VALUES (?, ?, ?)", args: [row.check_id, row.outcome, row.ts] })),
        "write",
      );
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async issuePendingAsk(input: PendingAskInput): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({
        sql: "INSERT INTO pending_asks (decision_id, subject_version, nonce, question_hash, issued_at) VALUES (?, ?, ?, ?, ?)",
        args: [input.decision_id, input.subject_version, input.nonce, input.question_hash, input.issued_at],
      });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async readPendingAsk(nonce: string): Promise<Result<PendingAskRecord | null, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: `SELECT a.id, a.decision_id, a.subject_version, a.nonce, a.question_hash, a.issued_at, a.used_at,
                     (a.id = (SELECT MAX(b.id) FROM pending_asks b WHERE b.decision_id = a.decision_id)) AS is_latest
                FROM pending_asks a WHERE a.nonce = ?`,
        args: [nonce],
      });
      const row = rs.rows[0];
      if (row === undefined) return ok(null);
      return ok({
        id: Number(row["id"]),
        decision_id: Number(row["decision_id"]),
        subject_version: rowStr(row, "subject_version"),
        nonce: rowStr(row, "nonce"),
        question_hash: rowStr(row, "question_hash"),
        issued_at: rowStr(row, "issued_at"),
        used_at: row["used_at"] === null || row["used_at"] === undefined ? null : rowStr(row, "used_at"),
        is_latest: Number(row["is_latest"]) === 1,
      });
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async consumePendingAsk(nonce: string, usedAt: string): Promise<Result<boolean, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({ sql: "UPDATE pending_asks SET used_at = ? WHERE nonce = ? AND used_at IS NULL RETURNING id", args: [usedAt, nonce] });
      return ok(rs.rows.length === 1);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listCheckOutcomeStats(): Promise<Result<CheckOutcomeStat[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute(
        `SELECT check_id, COUNT(*) AS runs,
                SUM(CASE WHEN outcome = 'deny' THEN 1 ELSE 0 END) AS denials,
                SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
                MIN(ts) AS first_run, MAX(ts) AS last_run,
                MAX(CASE WHEN outcome = 'deny' THEN ts END) AS last_denial
           FROM check_outcomes GROUP BY check_id ORDER BY check_id ASC`,
      );
      return ok(
        rs.rows.map((row) => ({
          check_id: rowStr(row, "check_id"),
          runs: Number(row["runs"]),
          denials: Number(row["denials"]),
          errors: Number(row["errors"]),
          first_run: rowStr(row, "first_run"),
          last_run: rowStr(row, "last_run"),
          last_denial: row["last_denial"] === null || row["last_denial"] === undefined ? null : rowStr(row, "last_denial"),
        })),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
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
        sql: "DELETE FROM trace_events WHERE id IN (SELECT id FROM trace_events WHERE ts < ? LIMIT ?) RETURNING id",
        args: [cutoffIso, batchSize],
      });
      return ok(rs.rows.length);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Runs (migration-016) ────────────────────────────────────────────────

  async insertRun(run: RunRecord): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      // reason: INSERT OR IGNORE makes registration idempotent and first-wins (the id is the PK).
      await this.client.execute({ sql: INSERT_RUN_SQL, args: runRecordToParams(run) as InValue[] });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async getRun(id: RunId): Promise<Result<RunRecord | null, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({ sql: "SELECT * FROM runs WHERE id = ?", args: [id] });
      const row = rs.rows[0];
      if (!row) return ok(null);
      return ok(
        rowToRunRecord({
          id: rowStr(row, "id"),
          kind: rowStr(row, "kind"),
          harness: rowStr(row, "harness"),
          session_ref: rowStr(row, "session_ref"),
          agent_ref: rowStrOrNull(row, "agent_ref"),
          agent_type: rowStrOrNull(row, "agent_type"),
          parent_run_id: rowStrOrNull(row, "parent_run_id"),
          branch: rowStrOrNull(row, "branch"),
          composition: rowStr(row, "composition"),
          registered_at: rowStr(row, "registered_at"),
          message_address: rowStrOrNull(row, "message_address"),
        } satisfies RunRow),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listRunsByAgentRef(agentRef: string): Promise<Result<RunRecord[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT * FROM runs WHERE agent_ref = ? ORDER BY registered_at DESC, id ASC",
        args: [agentRef],
      });
      return ok(
        rs.rows.map((row) =>
          rowToRunRecord({
            id: rowStr(row, "id"),
            kind: rowStr(row, "kind"),
            harness: rowStr(row, "harness"),
            session_ref: rowStr(row, "session_ref"),
            agent_ref: rowStrOrNull(row, "agent_ref"),
            agent_type: rowStrOrNull(row, "agent_type"),
            parent_run_id: rowStrOrNull(row, "parent_run_id"),
            branch: rowStrOrNull(row, "branch"),
            composition: rowStr(row, "composition"),
            registered_at: rowStr(row, "registered_at"),
            message_address: rowStrOrNull(row, "message_address"),
          } satisfies RunRow),
        ),
      );
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async endRun(id: RunId, endedAt: string, reason: string): Promise<Result<RunEndOutcome, LoreError>> {
    try {
      await this.ensureReady();
      // reason: `ended_at IS NULL` in the WHERE makes the FIRST end win and the call idempotent.
      const updated = await this.client.execute({
        sql: "UPDATE runs SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL RETURNING id",
        args: [endedAt, reason, id],
      });
      if (updated.rows.length > 0) return ok("ended");
      const found = await this.client.execute({ sql: "SELECT id FROM runs WHERE id = ?", args: [id] });
      return ok(found.rows[0] === undefined ? "unknown-run" : "already-ended");
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async reopenRun(id: RunId): Promise<Result<boolean, LoreError>> {
    try {
      await this.ensureReady();
      const updated = await this.client.execute({
        sql: "UPDATE runs SET ended_at = NULL, end_reason = NULL WHERE id = ? AND ended_at IS NOT NULL RETURNING id",
        args: [id],
      });
      return ok(updated.rows.length > 0);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async getRunEnd(id: RunId): Promise<Result<RunEndState | null, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({ sql: "SELECT ended_at, end_reason FROM runs WHERE id = ?", args: [id] });
      const row = rs.rows[0];
      if (!row) return ok(null);
      return ok({ endedAt: rowStrOrNull(row, "ended_at"), endReason: rowStrOrNull(row, "end_reason") });
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async recordRunProcess(id: RunId, proc: RunProcessRecord): Promise<Result<boolean, LoreError>> {
    try {
      await this.ensureReady();
      // reason: the NEWEST registration wins here (unlike the identity columns): a resumed run lives in a new process.
      const updated = await this.client.execute({
        sql: "UPDATE runs SET harness_pid = ?, harness_pid_start = ?, worktree = ? WHERE id = ? RETURNING id",
        args: [proc.pid, proc.startTime, proc.worktree, id],
      });
      return ok(updated.rows.length > 0);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async recordRunAddress(id: RunId, address: string | null): Promise<Result<boolean, LoreError>> {
    try {
      await this.ensureReady();
      // reason: BR-1360 — unconditional, newest registration wins, NULL clears; never part of insertRun (first wins).
      const updated = await this.client.execute({
        sql: "UPDATE runs SET message_address = ? WHERE id = ? RETURNING id",
        args: [address, id],
      });
      return ok(updated.rows.length > 0);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async listRunLifecycles(): Promise<Result<RunLifecycle[], LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute(RUN_LIFECYCLE_SQL);
      return ok(
        rs.rows.map((row) =>
          rowToRunLifecycle({
            id: rowStr(row, "id"),
            registered_at: rowStr(row, "registered_at"),
            ended_at: rowStrOrNull(row, "ended_at"),
            end_reason: rowStrOrNull(row, "end_reason"),
            parent_run_id: rowStrOrNull(row, "parent_run_id"),
            agent_ref: rowStrOrNull(row, "agent_ref"),
            harness_pid: rowNumOrNull(row, "harness_pid"),
            harness_pid_start: rowStrOrNull(row, "harness_pid_start"),
            worktree: rowStrOrNull(row, "worktree"),
          } satisfies RunLifecycleRow),
        ),
      );
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
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: countAttributedWritesSql(kinds.length),
        args: [windowStart, ...kinds] as InValue[],
      });
      const row = rs.rows[0];
      return ok({ total: row ? rowNum(row, "total") : 0, attested: row ? rowNum(row, "attested") : 0 });
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.listAuditRowsByAction
   */
  async listAuditRowsByAction(action: string, docId?: DocId): Promise<Result<AuditChainEntry[], LoreError>> {
    try {
      await this.ensureReady();
      const rs =
        docId === undefined
          ? await this.client.execute({
              sql: "SELECT * FROM audit WHERE action = ? ORDER BY id ASC",
              args: [action],
            })
          : await this.client.execute({
              sql: "SELECT * FROM audit WHERE action = ? AND doc_id = ? ORDER BY id ASC",
              args: [action, docId],
            });
      return ok(rs.rows.map((row) => rowToAuditChainEntry(libsqlRowToAuditChainRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * @see StoreInterface.getAuditHeadId
   */
  async getAuditHeadId(): Promise<Result<number, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute("SELECT MAX(id) AS head FROM audit");
      const head = rs.rows[0]?.["head"];
      return ok(head === null || head === undefined ? 0 : Number(head));
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
                kind, superseded_candidate, truncated, truncation, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          judgment.truncated === true ? 1 : null,
          judgment.truncation !== undefined ? JSON.stringify(judgment.truncation) : null,
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

  async maxDocVersion(): Promise<Result<number, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute(
        "SELECT MAX(version) AS max_version FROM docs WHERE deleted_at IS NULL",
      );
      // MAX() over zero rows yields one row holding NULL; rowNum maps NULL to 0.
      const row = rs.rows[0];
      return ok(row ? rowNum(row, "max_version") : 0);
    } catch (e) {
      return wrapStoreError(e);
    }
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
