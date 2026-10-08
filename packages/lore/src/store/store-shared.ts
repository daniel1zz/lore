/**
 * store-shared.ts — SSOT helpers shared by SQLiteStore and TursoStore.
 *
 * Contains:
 *  - Raw DB row interfaces (DocRow, LinkRow, VersionRow, AuditRow, FtsRow)
 *  - Row → domain record mappers (rowToDocRecord, etc.)
 *  - parseJson, wrapStoreError utilities
 *
 * Design contract:
 *  - Both stores share these types/functions — no duplication
 *  - Row types represent the raw column layout from the database
 *  - Mappers are pure functions with no side effects
 *
 * Source: SPEC-002 §7.1; SPEC-009 §3.1
 */

import { createHash } from "node:crypto";
import type {
  AuditEntry,
  CalibrationRecord,
  CheckResult,
  DocRecord,
  DocStatus,
  DocType,
  LinkRecord,
  LinkType,
  ReviewJudgment,
  ReviewJudgmentKind,
  ReviewReason,
  SearchHit,
  SupersededCandidate,
  VersionRecord,
} from "@lore/core";
import {
  err,
  extractValidity,
  ok,
  SNIPPET_MARK_CLOSE,
  SNIPPET_MARK_OPEN,
  type LoreError,
  type Result,
} from "@lore/core";

// ─── Raw DB row types ──────────────────────────────────────────────────────

/**
 * Raw row from the `docs` table.
 * Shared between SQLiteStore (bun:sqlite) and TursoStore (@libsql/client).
 * Numeric fields (version) may be bigint from libsql — callers MUST use Number().
 */
export interface DocRow {
  id: string;
  slug: string;
  type: string;
  role: string;
  title: string;
  status: string;
  priority: string;
  content: string;
  parent_id: string | null;
  extra: string;
  tags: string;
  version: number | bigint;
  created_at: string;
  updated_at: string;
  created_by: string;
  deleted_at: string | null;
  /**
   * SPEC-084 store-allocated display ordinal — nullable at the column level
   * (migration-010 added it nullable, zero backfill). `null` for exempt
   * kinds/types; `number`/`bigint` (libsql) otherwise. Never reused after
   * soft-delete (D9) — callers MUST NOT filter this column by `deleted_at`.
   */
  ordinal: number | bigint | null;
}

export interface LinkRow {
  from_id: string;
  to_id: string;
  link_type: string;
  created_at: string;
  created_by: string;
}

export interface VersionRow {
  doc_id: string;
  version: number | bigint;
  content: string;
  extra: string;
  status: string;
  title: string;
  action: string;
  created_at: string;
  created_by: string;
  change_summary: string | null;
  /** SPEC-072 D2 — nullable; NULL on legacy pre-migration-007 rows. */
  slug: string | null;
}

export interface AuditRow {
  timestamp: string;
  actor: string;
  session_id: string;
  action: string;
  doc_id: string | null;
  details: string;
}

/**
 * Raw row from the `audit` table INCLUDING its SPEC-079 G3 hash-chain
 * columns (`id`, `prev_hash`, `entry_hash`) — a superset of {@link AuditRow}.
 * `id` is the table's own `INTEGER PRIMARY KEY AUTOINCREMENT` (may be
 * `bigint` from libsql; callers MUST `Number()` it, mirroring every other
 * bigint-bearing row type in this file). `prev_hash`/`entry_hash` are
 * nullable at the COLUMN level (migration-009 added them nullable) but are
 * populated for every row from migration-009's backfill onward — a NULL
 * pair on a row read back through this type is itself a tamper/corruption
 * finding for `lore audit --verify`'s chain walk (a separate task), never a
 * legal steady state post-migration.
 */
export interface AuditChainRow extends AuditRow {
  id: number | bigint;
  prev_hash: string | null;
  entry_hash: string | null;
}

/**
 * Raw row from the `docs_fts` search join.
 * `type`/`status` are the docs-table columns joined in alongside id/slug/title
 * (SPEC-037 §2 D5) so `SearchHit` can carry them with zero extra queries.
 * `created_at`/`extra` are the SAME joined-in `docs` columns, added SPEC-043 D3 so
 * `SearchHit.validity` can be computed with zero N+1 per-hit fetches (review S3).
 */
export interface FtsRow {
  id: string;
  slug: string;
  title: string;
  snippet: string;
  rank: number | bigint;
  type: string;
  status: string;
  created_at: string;
  extra: string;
}

/**
 * Raw row from the `review_judgments` table (migration-003.ts, SPEC-034 §3).
 * `judge_provider`/`judge_model`/`judge_prompt_version` are denormalized
 * columns mirroring `ReviewJudgment.judge` — no separate judges table.
 */
export interface JudgmentRow {
  id: string;
  doc_id: string;
  doc_version: number | bigint;
  decision: string;
  confidence: number;
  reasons: string;
  checks: string;
  blocking_questions: string;
  judge_provider: string;
  judge_model: string;
  judge_prompt_version: string;
  /** `'review' | 'staleness'` — NOT NULL DEFAULT 'review' since migration-005.ts (SPEC-044 D3). */
  kind: string;
  /** JSON `SupersededCandidate` or NULL — nullable column since migration-005.ts (SPEC-044 D5/D11). */
  superseded_candidate: string | null;
  created_at: string;
  created_by: string;
}

/** Raw row from the `calibration_records` table (migration-003.ts, SPEC-034 §3). */
export interface CalibrationRow {
  id: string;
  judgment_id: string;
  doc_id: string;
  doc_type: string;
  human_outcome: string;
  delta_reasons: string;
  actor: string;
  created_at: string;
}

/**
 * A {@link CalibrationRow} augmented with `judge_prompt_version` AND `judge_kind`,
 * projected by `queryCalibrationWindow`'s UNCONDITIONAL join to `review_judgments`
 * (see `StoreInterface.CalibrationRecordWithPromptVersion`). `judge_kind` was added
 * SPEC-044 D12/AC-SP-11 — `computeCalibrationStats`'s group key joins on it so review
 * and staleness calibrations never pool into one Wilson bound even under the same
 * `(doc_type, prompt_version)` pair.
 */
export interface CalibrationRowWithPromptVersion extends CalibrationRow {
  judge_prompt_version: string;
  judge_kind: string;
}

// ─── Trace Events (SPEC-102, migration-011) ────────────────────────────────
// SSOT for this store-layer family — mirrors the AuditRow/AuditEntry split
// one section up: a raw DB row type here, a domain input/record pair here
// too (re-exported by store-interface.ts, never redefined there), and a
// pure row→domain mapper beside the other `rowTo*` functions below.

/** Raw row from the `trace_events` table (migration-011.ts, SPEC-102 §Schema). */
export interface TraceEventRow {
  id: number | bigint;
  ts: string;
  actor: string;
  surface: string;
  session_id: string;
  kind: string;
  doc_id: string | null;
  checkpoint: string | null;
  hit_count: number | bigint | null;
  details: string;
}

/**
 * Insert-shape for one `trace_events` row — the seam
 * `StoreInterface.insertTraceEvent` accepts. `ts` is REQUIRED here (the
 * caller — `TraceRecorder`, a later task — resolves `new Date().toISOString()`
 * once per event so store implementations never read the wall clock
 * themselves); `id` is store-assigned (`AUTOINCREMENT`), never supplied by a
 * caller — hence absent from this input shape entirely.
 *
 * `kind`/`surface` are deliberately plain `string`, not a Zod-validated
 * union, AT THIS LAYER (SPEC-102 D2 — no `CHECK` constraint, forward-compat
 * for new kinds without a migration) — `TraceRecorder`'s own Zod schema
 * (`@lore/core`, a later task) is where kind/surface validation actually
 * happens, before a caller ever reaches this store method.
 */
export interface TraceEventInput {
  /** ISO 8601 with ms — resolved by the CALLER, never by the store. */
  ts: string;
  actor: string;
  surface: string;
  /** SAME derivation source as audit writes — never reconstructed here. */
  session_id: string;
  /** e.g. `get`/`search`/`feed`/`context_bundle`/`gate_deny` — no CHECK (D2). */
  kind: string;
  /** `get` rows: the doc read. Absent for every other kind. No FK (D4). */
  doc_id?: string;
  /** `gate_deny`/`feed` rows only. */
  checkpoint?: string;
  /** `search` rows only. */
  hit_count?: number;
  /** JSON-serializable event detail (search→query, feed→docs_served[], gate_deny→predicates_failed/target_slug/layer). Defaults to `{}`. */
  details?: Record<string, unknown>;
}

/** A persisted `trace_events` row — {@link TraceEventInput} plus its store-assigned `id`. */
export interface TraceEventRecord extends TraceEventInput {
  id: number;
}

/**
 * The lower bound every trace-stats query is scoped to (SPEC-102 §Access
 * Patterns & Indexes) — mirrors `CalibrationWindowFilter`'s "always bounded"
 * rule: there is no "all time, unbounded" stats query, `since` is REQUIRED
 * on every read below (never optional — an unbounded full-table scan is not
 * a shape any named query in the spec's access-pattern table needs).
 */
export interface TraceStatsWindow {
  /** ISO 8601 — only rows at/after this timestamp are considered. */
  since: string;
}

/**
 * One row of the deny-by-checkpoint breakdown, LAYER-disambiguated
 * (SPEC-102 D7 — hook-layer `lore gate` denies and service-layer
 * `GateEnforcer` denies are counted separately for the identical checkpoint,
 * since the two layers see different traffic and would otherwise double-count).
 */
export interface TraceDenyByCheckpoint {
  checkpoint: string;
  layer: string;
  count: number;
}

/** One `gate_deny` trace row, projected for the deny→retry-success gap's read-side join against the audit table. */
export interface TraceGateDenyEvent {
  ts: string;
  actor: string;
  checkpoint: string;
}

/** One `search` trace row's raw query text — returned ONLY behind `lore trace stats --raw-queries` (SPEC-102 §Security & Privacy). */
export interface TraceRawSearchQuery {
  ts: string;
  actor: string;
  query: string;
}

// ─── JSON helpers ──────────────────────────────────────────────────────────

export function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Like {@link parseJson} but for an OPTIONAL nullable column (e.g.
 * `review_judgments.superseded_candidate`) — `null`/`undefined`/malformed JSON all
 * degrade to `undefined` rather than a fallback value, matching `extractValidity`'s
 * "absence is not an error" contract.
 */
export function parseJsonOptional<T>(raw: string | null | undefined): T | undefined {
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

// ─── Row mappers ───────────────────────────────────────────────────────────

/**
 * Maps a raw {@link FtsRow} (the `docs_fts ⋈ docs` search join row) to a
 * {@link SearchHit}, including the SPEC-043 D3 narrow `validity` projection —
 * parsed from the SAME joined `extra` JSON column, never a per-hit `store.find`
 * (review S3's "no N+1" constraint). Shared by SQLiteStore and TursoStore so this
 * projection logic exists exactly once.
 */
export function rowToSearchHit(row: FtsRow): SearchHit {
  const extra = parseJson<Record<string, unknown>>(row.extra, {});
  const validity = extractValidity({ extra });
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    // reason: row.snippet is raw snippet() output over the CJK bigram-expanded
    // fts_content/fts_title shadow columns (migration-008) — collapse back to
    // prose for display. See collapseCjkBigramSnippet's JSDoc. ASCII-only
    // snippets short-circuit inside the helper and come back byte-identical.
    snippet: collapseCjkBigramSnippet(row.snippet ?? ""),
    score: typeof row.rank === "bigint" ? Number(row.rank) : row.rank,
    type: row.type as DocType,
    status: row.status as DocStatus,
    created_at: row.created_at,
    ...(validity !== undefined ? { validity } : {}),
  };
}

export function rowToDocRecord(row: DocRow): DocRecord {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type as DocRecord["type"],
    role: row.role as DocRecord["role"],
    title: row.title,
    status: row.status as DocRecord["status"],
    priority: row.priority as DocRecord["priority"],
    content: row.content,
    parent_id: row.parent_id,
    extra: parseJson(row.extra, {}),
    tags: parseJson(row.tags, []),
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    deleted_at: row.deleted_at,
    // reason: SPEC-084 — the column always exists post-migration-010, so
    // (unlike VersionRow.slug's absence-tolerant omission) this key is
    // ALWAYS present on the returned DocRecord, typed `number | null`, never
    // a placeholder. `Number()` normalizes libsql's possible `bigint`.
    ordinal: row.ordinal === null ? null : Number(row.ordinal),
  };
}

export function rowToLinkRecord(row: LinkRow): LinkRecord {
  return {
    from_id: row.from_id,
    to_id: row.to_id,
    link_type: row.link_type as LinkType,
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

export function rowToVersionRecord(row: VersionRow): VersionRecord {
  return {
    doc_id: row.doc_id,
    version: Number(row.version),
    content: row.content,
    extra: parseJson(row.extra, {}),
    status: row.status as VersionRecord["status"],
    title: row.title,
    action: row.action as VersionRecord["action"],
    created_at: row.created_at,
    created_by: row.created_by,
    ...(row.change_summary !== null
      ? { change_summary: row.change_summary }
      : {}),
    // reason: SPEC-072 D1 — absence-tolerant. NULL (legacy row, or a
    // deliberately slug-less sentinel like the delete version-0 row) never
    // becomes a placeholder string; the key is omitted entirely.
    ...(row.slug !== null ? { slug: row.slug } : {}),
  };
}

export function rowToAuditEntry(row: AuditRow): AuditEntry {
  return {
    timestamp: row.timestamp,
    actor: row.actor,
    session_id: row.session_id,
    action: row.action,
    ...(row.doc_id !== null ? { doc_id: row.doc_id } : {}),
    details: parseJson(row.details, {}),
  };
}

/**
 * Maps a raw {@link TraceEventRow} to a {@link TraceEventRecord} — mirrors
 * {@link rowToAuditEntry}'s "nullable column → optional field" shape
 * (`doc_id`/`checkpoint`/`hit_count` are all NULL for kinds that don't
 * populate them; each is omitted from the returned object rather than
 * present with `null`, matching every other optional-field convention in
 * this file). `id`/`hit_count` are `Number()`-coerced since libsql may
 * return either as `bigint`.
 */
export function rowToTraceEvent(row: TraceEventRow): TraceEventRecord {
  return {
    id: Number(row.id),
    ts: row.ts,
    actor: row.actor,
    surface: row.surface,
    session_id: row.session_id,
    kind: row.kind,
    ...(row.doc_id !== null ? { doc_id: row.doc_id } : {}),
    ...(row.checkpoint !== null ? { checkpoint: row.checkpoint } : {}),
    ...(row.hit_count !== null ? { hit_count: Number(row.hit_count) } : {}),
    details: parseJson(row.details, {}),
  };
}

/**
 * A single audit row with its SPEC-079 G3 hash-chain fields attached — the
 * shape {@link StoreInterface.listAuditChain} returns. Deliberately NOT part
 * of the public {@link AuditEntry} write/read contract (`appendAuditEntry`/
 * `queryAudit`): keeping `prev_hash`/`entry_hash` off `AuditEntry` means no
 * caller can ever construct or forge a chain entry — the hashes are
 * computed store-side only, by {@link computeAuditEntryHash}, at insert
 * time. `id` is the row's position in `id ASC` chain-construction order.
 * `prev_hash`/`entry_hash` are typed nullable to mirror the physical column
 * (see {@link AuditChainRow}'s JSDoc) — a null pair is a verify-time finding,
 * not a value any correctly-functioning write path produces.
 */
export interface AuditChainEntry extends AuditEntry {
  id: number;
  prev_hash: string | null;
  entry_hash: string | null;
}

/**
 * Maps a raw {@link AuditChainRow} to an {@link AuditChainEntry} — the
 * hash-chain-aware analog of {@link rowToAuditEntry}, reusing it for the
 * shared `AuditEntry` fields and layering `id`/`prev_hash`/`entry_hash` on
 * top.
 */
export function rowToAuditChainEntry(row: AuditChainRow): AuditChainEntry {
  return {
    id: Number(row.id),
    ...rowToAuditEntry(row),
    prev_hash: row.prev_hash,
    entry_hash: row.entry_hash,
  };
}

/**
 * Maps a raw `review_judgments` row to a ReviewJudgment. Reassembles `judge` from its 3
 * denormalized columns. `kind` reads as `'review'` via `??` when the stored value is
 * undefined (SPEC-044 D3/review S10 — a direct-`insertJudgment` legacy/test fixture that
 * bypasses `reviewJudgmentSchema`'s own `.default("review")`), NEVER a strict-equality
 * check against `'review'` — the DB column itself is `NOT NULL DEFAULT 'review'` post
 * migration-005.ts, so this `??` is defense-in-depth for InMemoryStore/direct-insert
 * paths, not something the SQL layer can actually produce `undefined`/`null` for.
 */
export function rowToReviewJudgment(row: JudgmentRow): ReviewJudgment {
  const supersededCandidate = parseJsonOptional<SupersededCandidate>(row.superseded_candidate);
  return {
    id: row.id,
    doc_id: row.doc_id,
    doc_version: Number(row.doc_version),
    decision: row.decision as ReviewJudgment["decision"],
    confidence: row.confidence,
    reasons: parseJson<ReviewReason[]>(row.reasons, []),
    checks: parseJson<CheckResult[]>(row.checks, []),
    blocking_questions: parseJson<string[]>(row.blocking_questions, []),
    judge: {
      provider: row.judge_provider,
      model: row.judge_model,
      prompt_version: row.judge_prompt_version,
    },
    kind: (row.kind as ReviewJudgmentKind | undefined) ?? "review",
    ...(supersededCandidate !== undefined ? { superseded_candidate: supersededCandidate } : {}),
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

/** Maps a raw `calibration_records` row to a CalibrationRecord. */
export function rowToCalibrationRecord(row: CalibrationRow): CalibrationRecord {
  return {
    id: row.id,
    judgment_id: row.judgment_id,
    doc_id: row.doc_id,
    doc_type: row.doc_type as DocType,
    human_outcome: row.human_outcome as CalibrationRecord["human_outcome"],
    delta_reasons: parseJson<string[]>(row.delta_reasons, []),
    actor: row.actor,
    created_at: row.created_at,
  };
}

/**
 * Maps a raw `calibration_records` ⋈ `review_judgments` row (the projection
 * `queryCalibrationWindow` now always selects) to a CalibrationRecord carrying
 * the judgment's real `judge_prompt_version` — see
 * `StoreInterface.CalibrationRecordWithPromptVersion`. This is what lets
 * `JudgmentService.computeCalibrationStats` group by the actual
 * (doc_type, prompt_version) pair instead of an unpinned `"*"` sentinel.
 */
export function rowToCalibrationRecordWithPromptVersion(
  row: CalibrationRowWithPromptVersion,
): CalibrationRecord & { judge_prompt_version: string; judge_kind: ReviewJudgmentKind } {
  return {
    ...rowToCalibrationRecord(row),
    judge_prompt_version: row.judge_prompt_version,
    // reason: same `?? 'review'` defense-in-depth as rowToReviewJudgment (SPEC-044 D12/S10).
    judge_kind: (row.judge_kind as ReviewJudgmentKind | undefined) ?? "review",
  };
}

// ─── Error helpers ──────────────────────────────────────────────────────────

// ─── SPEC-084 ordinal allocation (shared across all 3 StoreInterface impls) ─
//
// `insertWithAllocatedOrdinal`/`allocateOrdinalForExisting` each compute a
// candidate ordinal via `MAX(ordinal WHERE type=?) + 1` ONCE per call, then
// on a `(type, ordinal)` uniqueness violation try successive `+1` candidates
// WITHOUT re-querying the table. This is the shared contract every impl
// delegates its retry mechanics to (`allocateWithBoundedRetry` below).
//
// Forceability boundary (confirmed by orchestrator adjudication after
// reading SPEC-084 D2/D9): because `base` is `MAX(ordinal)` read live over
// the SAME partial index the UNIQUE constraint enforces (D9: includes
// soft-deleted rows), any row visible to that index is ALSO visible to this
// MAX read — `MAX(ordinal)+1` is by construction never already taken.
// Externally pre-inserting rows via a store's plain `insert()` can
// therefore NEVER force a genuine collision here; exhaustion-by-pre-
// insertion is structurally unobservable under a single connection. This is
// NOT a implementation gap to "fix" by caching/staling `base` — that would
// (a) produce false exhaustion in production against real pre-existing
// corpus data and (b) contradict D2's literal "MAX+1 over the partial
// index" text. See `ordinal-allocation-cases.ts`'s design note for the full
// proof and `allocateWithBoundedRetry`'s own JSDoc for how exhaustion is
// exercised HONESTLY (an injected always-colliding attempt at this exact
// seam) instead.

/** Bounded retry budget for both ordinal-allocation store methods (SPEC-084 §Module Boundary). */
export const ORDINAL_ALLOCATION_MAX_ATTEMPTS = 3;

/**
 * True when a driver-level UNIQUE-constraint error message names the
 * `idx_docs_type_ordinal` partial index's columns — i.e. this failure is an
 * ordinal collision, not some OTHER constraint violation (e.g.
 * `docs.slug`) that must propagate immediately instead of being retried.
 * SQLite/libsql both report `UNIQUE constraint failed: docs.type, docs.ordinal`
 * (table.column form, not the index name) — mirrors the existing
 * `msg.includes("UNIQUE constraint failed: docs.slug")` precedent in both
 * stores' `insert()`.
 */
export function isOrdinalUniqueViolationMessage(message: string): boolean {
  return message.includes("docs.ordinal");
}

/**
 * The literal, assertable exhaustion failure (SPEC-084 §Module Boundary
 * "Retry-exhaustion failure shape") — a named `STORE_ERROR` whose message
 * contains the token `ORDINAL_ALLOCATION_EXHAUSTED`, NEVER a silent NULL
 * ordinal. Shared so the exact wording can't drift between the two
 * allocation methods or the three store implementations.
 */
export function buildOrdinalAllocationExhaustedError(docType: string): LoreError {
  return {
    code: "STORE_ERROR",
    message: `ORDINAL_ALLOCATION_EXHAUSTED: exhausted ${ORDINAL_ALLOCATION_MAX_ATTEMPTS} bounded retry attempts allocating an ordinal for type "${docType}"`,
  };
}

/**
 * Outcome of ONE ordinal-allocation attempt at a specific candidate value —
 * fed to {@link allocateWithBoundedRetry} by each StoreInterface impl's
 * `insertWithAllocatedOrdinal`/`allocateOrdinalForExisting`.
 *
 * - `"success"` — the attempt committed; carries the resulting value.
 * - `"collision"` — a `(type, ordinal)` UNIQUE violation on THIS candidate
 *   only — the loop retries with the next candidate.
 * - `"error"` — any OTHER failure (`DUPLICATE_SLUG`, `STALE_VERSION`, a
 *   driver error unrelated to the ordinal index, etc.) — propagates
 *   immediately, never retried.
 */
export type OrdinalAttemptOutcome<T> =
  | { kind: "success"; value: T }
  | { kind: "collision" }
  | { kind: "error"; error: LoreError };

/**
 * THE single bounded-retry seam for SPEC-084 ordinal allocation (Plan
 * Invariant 2: `insertWithAllocatedOrdinal`/`allocateOrdinalForExisting` are
 * the ONLY two allocation call sites, and BOTH delegate their retry
 * mechanics here — no MAX+1-with-retry arithmetic exists anywhere else in
 * the codebase; the three StoreInterface impls no longer re-derive "how
 * many attempts, what counts as retryable, what does exhaustion look like"
 * independently).
 *
 * Computes each candidate as `base + 1 + attemptIndex` (never re-querying
 * MAX mid-loop — see {@link isOrdinalUniqueViolationMessage}'s JSDoc: a
 * fresh per-attempt MAX query can never observe a genuine collision under a
 * live partial index, because `MAX(ordinal)+1` is by construction never
 * already taken by an existing row — SPEC-084 D2/D9). `tryAttempt` is the
 * ONLY store-specific part (an INSERT for `insertWithAllocatedOrdinal`, a
 * CAS-guarded UPDATE for `allocateOrdinalForExisting`).
 *
 * @remark Forceability boundary (orchestrator adjudication, confirming the
 *   proof in `ordinal-allocation-cases.ts`'s design note): because MAX is
 *   read live over the SAME partial index the UNIQUE constraint enforces
 *   (including soft-deleted rows, D9), any row visible to that index is
 *   ALSO visible to this function's own `base` computation — an externally
 *   pre-inserted row can therefore NEVER force a genuine collision here,
 *   and "exhaustion via pre-insertion" is structurally unobservable under a
 *   single connection. This is deliberately NOT "fixed" by making `base`
 *   stale/cached (that would produce false exhaustion in production against
 *   real pre-existing corpus data, and contradicts D2's "MAX+1 over the
 *   partial index" text). The ordinal-allocation contract suite's
 *   `retry_exhaustion` case therefore exercises exhaustion HONESTLY by
 *   calling this function directly with an injected, always-`"collision"`
 *   `tryAttempt` — the only place a genuine 3-strikes exhaustion can be
 *   observed without fake concurrency or a test-only hook on the store
 *   classes' public surface.
 *
 * @param base - `MAX(ordinal WHERE type=?)` (0 if none), computed ONCE by
 *   the caller before this loop starts.
 * @param docType - fed into {@link buildOrdinalAllocationExhaustedError}'s
 *   message on exhaustion.
 * @param tryAttempt - runs ONE allocation attempt at `candidate`; returns an
 *   {@link OrdinalAttemptOutcome}.
 * @returns `ok(value)` on the first successful attempt; the attempt's OWN
 *   error immediately on a non-collision failure; `err(STORE_ERROR)`
 *   (message containing `ORDINAL_ALLOCATION_EXHAUSTED`) after
 *   {@link ORDINAL_ALLOCATION_MAX_ATTEMPTS} consecutive collisions.
 */
export async function allocateWithBoundedRetry<T>(
  base: number,
  docType: string,
  tryAttempt: (candidate: number) => Promise<OrdinalAttemptOutcome<T>>,
): Promise<Result<T, LoreError>> {
  for (let attempt = 0; attempt < ORDINAL_ALLOCATION_MAX_ATTEMPTS; attempt++) {
    const candidate = base + 1 + attempt;
    const outcome = await tryAttempt(candidate);
    if (outcome.kind === "success") return ok(outcome.value);
    if (outcome.kind === "error") return err(outcome.error);
    // else "collision" — loop retries with the next candidate.
  }
  return err(buildOrdinalAllocationExhaustedError(docType));
}

// ─── Parent-cycle detection (SPEC-002 §4.3 write-time tree constraint) ─────

/**
 * Runaway backstop for {@link detectParentCycleViaAncestry}'s ancestor walk —
 * mirrors `CorpusService.get`'s `ANCESTOR_DEPTH_CAP` (corpus-service.ts).
 * The corpus's own tree contract caps real depth far below this; it only
 * exists to terminate a walk over a pre-existing corrupted `parent_id` chain
 * in stored data (the `seen` guard below catches that case first in
 * practice — this is defense in depth, not the primary guard).
 */
export const PARENT_CYCLE_DEPTH_CAP = 1000;

/**
 * Detects whether adding a `parent`-type link `fromId → toId` would create a
 * cycle in the doc tree, by walking each node's "effective parent" upward
 * from `toId` looking for `fromId`.
 *
 * @remark Source-agnostic by design — this function does not itself decide
 *   what a doc's "parent" is; that is entirely the injected `getParentId`
 *   callback's job. Both stores blend TWO sources per hop (see their own
 *   `detectParentCycle` JSDoc for why): the `links` table's outgoing
 *   `parent` edge when one exists, falling back to `docs.parent_id`
 *   otherwise. The blend closes a spec-corpus-schema §4.3 audit finding —
 *   `CorpusService.create`'s `--parent` path writes ONLY `docs.parent_id`
 *   (no `links` row), so a walk that consulted `links` alone was blind to
 *   cycles closed against a create-time parent edge — while preserving
 *   pre-existing behavior for chains built purely via `addLink` (which does
 *   NOT itself write `docs.parent_id`; only `CorpusService._linkImpl`'s
 *   separate post-`addLink` `store.update` does).
 * @param fromId - the doc that would become the child (link's `from_id`)
 * @param toId - the doc that would become the parent (link's `to_id`)
 * @param getParentId - looks up a doc's current effective parent id (`null`
 *   if the doc has no parent or does not exist). Injected so this same walk
 *   serves both `SQLiteStore` (synchronous `bun:sqlite` read, resolved
 *   instantly as a promise) and `TursoStore` (`@libsql/client`, natively
 *   async).
 * @returns `err(LINK_CYCLE)` with the discovered path (`fromId` first) when
 *   `fromId === toId` (self-link) or `fromId` appears in `toId`'s ancestor
 *   chain; `ok(undefined)` otherwise.
 */
export async function detectParentCycleViaAncestry(
  fromId: string,
  toId: string,
  getParentId: (id: string) => Promise<string | null>,
): Promise<Result<void, LoreError>> {
  if (fromId === toId) {
    return err({ code: "LINK_CYCLE", path: [fromId] });
  }

  const path: string[] = [fromId, toId];
  const seen = new Set<string>([toId]);
  let current = toId;
  let depth = 0;

  while (depth < PARENT_CYCLE_DEPTH_CAP) {
    const parentId = await getParentId(current);
    if (parentId === null) break;

    if (parentId === fromId) {
      return err({ code: "LINK_CYCLE", path: [...path, parentId] });
    }
    // reason: pre-existing corrupted parent_id cycle guard — new writes
    // can no longer create one after this fix, but stored data predating it
    // must not spin this walk forever.
    if (seen.has(parentId)) break;
    seen.add(parentId);
    path.push(parentId);
    current = parentId;
    depth++;
  }

  return ok(undefined);
}

/**
 * Pure core of {@link wrapStoreError} — builds the bare {@link LoreError}
 * without wrapping it in a `Result`. Extracted so callers that already need
 * a plain `LoreError` value (e.g. an {@link OrdinalAttemptOutcome}'s
 * `error` field inside a `catch` block) don't have to unwrap
 * `wrapStoreError`'s `Result<never, LoreError>` return type (whose `ok:
 * true` branch has no `.error` — TS can't narrow it away without an
 * explicit `if`, which would be pure boilerplate at every call site).
 */
export function toStoreError(e: unknown): LoreError {
  const message = e instanceof Error ? e.message : "Unknown store error";
  return e instanceof Error ? { code: "STORE_ERROR", message, cause: e } : { code: "STORE_ERROR", message };
}

export function wrapStoreError(e: unknown): Result<never, LoreError> {
  return err(toStoreError(e));
}

// ─── Tamper-evident audit hash chain (SPEC-079 G3) ─────────────────────────
//
// Every audit row is hash-chained to its predecessor: `entry_hash =
// sha256(canonicalJson({timestamp, actor, session_id, action, doc_id, details,
// prev_hash}))`, genesis `prev_hash = ""`. The pure functions below are
// server-only (import `node:crypto`) and deliberately live here, not in
// `@lore/core` — that package's default barrel must stay browser-safe (see
// this package's own module CLAUDE.md), and `node:crypto` is a Node
// builtin the dashboard bundle must never see. All three stores
// (SQLiteStore, TursoStore, InMemoryStore) call `computeAuditEntryHash` at
// EVERY audit insert point, reading the current chain head inside the same
// transaction/serialized write as the insert so concurrent writers cannot
// fork the chain — see each store's `appendAuditEntrySync`/
// `appendAuditEntryTx`/`appendAuditEntry` for the read-head-then-insert
// sequencing.

/**
 * Recursively sorts the keys of a plain object (and every nested plain
 * object), leaving arrays' ELEMENT ORDER untouched (array order is semantic
 * — sorting it would change meaning, not just serialization — whereas
 * object key order is never semantic in JSON) and primitives unchanged.
 * Used ONLY to canonicalize `AuditEntry.details` before hashing — the outer
 * hash payload's own field order is fixed by {@link canonicalAuditPayload}'s
 * literal object construction, which needs no sorting since it is never
 * caller-supplied.
 */
function sortObjectKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      sorted[key] = sortObjectKeysDeep(val);
    }
    return sorted;
  }
  return value;
}

/**
 * Builds the deterministic canonical JSON string a chain entry's hash is
 * computed over. Field order in the emitted object is FIXED (this function
 * constructs it, never the caller) — only the caller-supplied `details`
 * blob needs {@link sortObjectKeysDeep}, since two semantically-identical
 * `details` objects can differ in property insertion order across call
 * sites (e.g. link-provenance vs actor-fidelity writers).
 *
 * @param entry - The audit entry being chained (hash fields never read from it).
 * @param prevHash - The chain head's `entry_hash` at insert time, or `""` for
 *   the genesis row (the first audit row ever written to this table).
 * @returns A JSON string; feed directly to a hash function or compare
 *   payloads across processes for equality.
 * @example
 *   canonicalAuditPayload(
 *     { timestamp: "2026-01-01T00:00:00.000Z", actor: "agent:x", session_id: "s1",
 *       action: "create", doc_id: "d1", details: { b: 2, a: 1 } },
 *     "",
 *   )
 *   // => '{"timestamp":"2026-01-01T00:00:00.000Z","actor":"agent:x","session_id":"s1","action":"create","doc_id":"d1","details":{"a":1,"b":2},"prev_hash":""}'
 */
export function canonicalAuditPayload(entry: AuditEntry, prevHash: string): string {
  const payload = {
    timestamp: entry.timestamp,
    actor: entry.actor,
    session_id: entry.session_id,
    action: entry.action,
    doc_id: entry.doc_id ?? null,
    details: sortObjectKeysDeep(entry.details ?? {}),
    prev_hash: prevHash,
  };
  return JSON.stringify(payload);
}

/**
 * Computes the sha256 hex digest an audit row's `entry_hash` column stores —
 * the ONLY place a chain hash is ever produced. Every store insert path
 * (`appendAuditEntry` and the three `*WithProvenance` composites) and
 * migration-009's backfill loop call this with the SAME two arguments:
 * the entry being written and the current chain head's hash (or `""` for
 * the genesis row) — never any other input shape, so two independently
 * migrated/live corpora over the identical audit history produce byte-
 * identical chains.
 *
 * @param entry - The audit entry being chained.
 * @param prevHash - The chain head's `entry_hash`, or `""` for genesis.
 * @returns 64-character lowercase hex sha256 digest.
 */
export function computeAuditEntryHash(entry: AuditEntry, prevHash: string): string {
  return createHash("sha256").update(canonicalAuditPayload(entry, prevHash)).digest("hex");
}

// ─── CJK bigram expansion for FTS5 (unicode61 contiguous-run limitation) ───
//
// unicode61 (FTS5's default tokenizer) treats CJK Unified Ideographs as
// token characters, so a contiguous run with no ASCII/whitespace separator
// tokenizes as ONE whole-run token — "量化交易策略" indexes as a single
// 6-char token, not the 2-char words a Chinese query actually types. A
// trigram tokenizer was evaluated and REJECTED (orchestrator decision,
// task-fts5-cjk-search-returns-zero-hits-unicode61-tokenizes): it cannot
// match a 2-char query, and 2-char words are the dominant Chinese query
// shape. Overlapping CJK BIGRAMS, expanded into separate space-delimited
// tokens BEFORE unicode61 ever sees the text, fix this without touching the
// tokenizer: "交易策略" → "交易 易策 策略" indexes as three real tokens,
// each independently matchable.

/**
 * CJK Unified Ideographs range (U+4E00–U+9FFF) — mirrors `@lore/core`'s
 * `CJK_CHAR_PATTERN` (`packages/core/src/slugify-node.ts`, SPEC-068)
 * character-for-character. Deliberately duplicated rather than imported:
 * that constant lives behind the `@lore/core/node` subpath (grouped there
 * because its sibling export `getTransliterateCjk` pulls in the ~931KB
 * `pinyin-pro` dependency), and the store layer — bun-only already, but with
 * no other reason to reach across that subpath boundary — has nothing to
 * gain from taking on that reachability. If the upstream range ever changes,
 * this must change with it; there is no automated parity check between the
 * two, so a maintainer touching one must know to check the other.
 */
const CJK_RUN_PATTERN = /[一-鿿]+/g;

/**
 * Splits a maximal CJK run into overlapping bigrams: `"交易策略"` (4 chars)
 * → `["交易", "易策", "策略"]` (3 bigrams, `run.length - 1`). The overlap is
 * what preserves contiguity information — the SAME sequence of adjacent
 * pairs is produced whether this runs over a document (for indexing) or a
 * query piece (for phrase-matching), so a query phrase built from a
 * sub-sequence of a document's bigrams is guaranteed to appear as a
 * consecutive run in that document's index. Pure/no side effects. Not
 * exported — callers go through {@link expandCjkForFts} or the query-side
 * expansion in {@link escapeFtsQuery}, both of which handle the
 * run.length === 1 case (a lone CJK char never becomes a bigram) before
 * reaching this helper.
 */
function toBigrams(run: string): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < run.length - 1; i++) {
    bigrams.push(run.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * Expands every maximal contiguous CJK run of length ≥2 in `text` into
 * space-separated overlapping bigrams, in place — non-CJK spans (ASCII
 * words, punctuation, whitespace, other scripts) and lone (length-1) CJK
 * runs pass through byte-identical. This is the SHADOW-COLUMN transform:
 * `SQLiteStore`/`TursoStore` compute `expandCjkForFts(title|content|tagsJson)`
 * at every doc INSERT/UPDATE and persist the result into the `fts_title` /
 * `fts_content` / `fts_tags` columns migration-008 adds to `docs` — those
 * shadow columns, not the real `title`/`content`/`tags`, are what
 * `docs_fts`'s external-content binding indexes (see migration-008.ts's
 * module JSDoc for why the FTS5 table itself had to be redefined against
 * them, not just fed different trigger values).
 *
 * A pure-ASCII `text` is returned UNCHANGED (no CJK run exists to expand),
 * which is what keeps ASCII search/ranking byte-identical to pre-migration
 * behavior even though every doc now carries these shadow columns.
 *
 * @param text - Raw title, content, or JSON-stringified tags-array text.
 * @returns `text` with every CJK run of length ≥2 bigram-expanded.
 * @example
 *   expandCjkForFts("量化交易策略")        // => "量化 化交 交易 易策 策略"
 *   expandCjkForFts("SPEC-078 多项目支持") // => "SPEC-078 多项 项目 目支 支持"
 *   expandCjkForFts("交")                  // => "交" (length-1 run, unchanged)
 *   expandCjkForFts("append-only")         // => "append-only" (no CJK, unchanged)
 */
export function expandCjkForFts(text: string): string {
  if (text === "") return text;
  return text.replace(CJK_RUN_PATTERN, (run) =>
    run.length === 1 ? run : toBigrams(run).join(" "),
  );
}

/**
 * Computes the three `fts_*` shadow-column values that MUST accompany every
 * `docs` row INSERT/UPDATE in both `SQLiteStore` and `TursoStore` — see
 * {@link expandCjkForFts}'s JSDoc for the mechanism. Centralized here so the
 * ~6 write sites across both stores (insert/update × conditional/
 * unconditional × provenance-wrapped) compute this identically; a call site
 * that skips this produces silently-stale CJK search for whatever it wrote.
 *
 * `tagsJson` is the ALREADY-`JSON.stringify`-d `tags` column value — both
 * stores compute that once for the real `tags` column already; pass the
 * SAME string here rather than re-stringifying. This mirrors a pre-existing
 * (unrelated to this change) property of the FTS5 setup: the `tags` shadow
 * has always indexed the raw JSON array text, brackets/quotes and all
 * (unicode61 treats them as token separators, so this has always
 * effectively indexed each tag word) — this function preserves that
 * behavior for the CJK-expanded copy rather than redesigning it.
 *
 * @param title - The doc's `title` column value.
 * @param content - The doc's `content` column value.
 * @param tagsJson - The doc's `tags` column value (JSON-stringified array).
 * @returns The three shadow-column values, ready to bind into the SQL INSERT/UPDATE.
 */
export function computeFtsShadowValues(
  title: string,
  content: string,
  tagsJson: string,
): { fts_title: string; fts_content: string; fts_tags: string } {
  return {
    fts_title: expandCjkForFts(title),
    fts_content: expandCjkForFts(content),
    fts_tags: expandCjkForFts(tagsJson),
  };
}

// ─── CJK bigram snippet collapse (inverse of expandCjkForFts, display side) ─
//
// FTS5's `snippet()` returns a slice of the INDEXED column value verbatim —
// since docs_fts indexes the bigram-expanded `fts_*` shadow columns (not the
// real title/content/tags), a CJK hit's snippet renders as the raw shadow
// text: overlapping bigrams joined by literal spaces the indexer inserted
// (`"交易 易策 策略"`), not the original prose (`"交易策略"`). This section
// collapses that back for display — the store-layer inverse of
// {@link expandCjkForFts}, applied only to `snippet()` output, never to the
// real `title`/`content` columns (those are untouched by the shadow scheme).

/** The literal ellipsis text passed as `snippet()`'s 5th argument in both
 *  `sqlite-store.ts` and `turso-store.ts` — duplicated here (not imported;
 *  it's a SQL string literal, not a JS export) so the collapse parser can
 *  recognize truncation markers. If either SQL call site's ellipsis literal
 *  ever changes, this constant must change with it. */
const SNIPPET_ELLIPSIS = "...";

/** Non-global per-character existence probe — `CJK_RUN_PATTERN` is a `/g`
 *  pattern with mutable `lastIndex` state; reusing it for a plain `.test()`
 *  short-circuit would silently skip matches on the second-and-later call. */
const CJK_SINGLE_CHAR_PROBE = /[一-鿿]/;

/** True iff `ch` is a single CJK Unified Ideograph — same range as
 *  {@link CJK_RUN_PATTERN}, tested per-character because the collapse scan
 *  below compares individual neighboring characters, not whole runs. */
function isCjkChar(ch: string): boolean {
  return ch >= "一" && ch <= "鿿";
}

function pushAnnotation(map: Map<number, string[]>, index: number, text: string): void {
  const existing = map.get(index);
  if (existing) existing.push(text);
  else map.set(index, [text]);
}

/** Output of {@link extractDecorations}: the raw indexed shadow-column text
 *  with all `snippet()`-inserted decorations removed, plus WHERE to splice
 *  them back in (keyed by index into `clean`). */
interface DecorationExtraction {
  clean: string;
  before: Map<number, string[]>;
  after: Map<number, string[]>;
}

/**
 * Strips {@link SNIPPET_MARK_OPEN}/{@link SNIPPET_MARK_CLOSE} and the
 * leading/trailing {@link SNIPPET_ELLIPSIS} out of a WHOLE raw `snippet()`
 * result in one left-to-right pass, recording each as a "before this
 * `clean`-index" / "after this `clean`-index" annotation. What remains in
 * `clean` is exactly the raw bigram-expanded shadow-column text FTS5 sliced
 * out — every bigram-joiner space `expandCjkForFts` inserted AND every
 * genuine word-separator space, indistinguishable at this stage.
 * {@link collapseJoinerSpaces} tells them apart next.
 *
 * Ellipsis only ever appears at the OUTERMOST edges of the whole result
 * (`snippet()` splices `...` onto the edges of the selected window, not
 * per-token) — that is why it is handled once globally here, unlike marks,
 * which can appear anywhere a matched token sits (possibly more than once,
 * if the snippet window happens to contain two separate phrase matches).
 */
function extractDecorations(raw: string): DecorationExtraction {
  const before = new Map<number, string[]>();
  const after = new Map<number, string[]>();

  let start = 0;
  if (raw.startsWith(SNIPPET_ELLIPSIS)) {
    pushAnnotation(before, 0, SNIPPET_ELLIPSIS);
    start = SNIPPET_ELLIPSIS.length;
  }
  let end = raw.length;
  let trailingEllipsis = false;
  if (end - start >= SNIPPET_ELLIPSIS.length && raw.endsWith(SNIPPET_ELLIPSIS)) {
    trailingEllipsis = true;
    end -= SNIPPET_ELLIPSIS.length;
  }

  let clean = "";
  for (let i = start; i < end; i++) {
    const ch = raw[i]!;
    if (ch === SNIPPET_MARK_OPEN) {
      pushAnnotation(before, clean.length, SNIPPET_MARK_OPEN);
      continue;
    }
    if (ch === SNIPPET_MARK_CLOSE) {
      // reason: a close mark always follows at least one real char — FTS5
      // never highlights a zero-width match, so clean.length - 1 >= 0 in
      // every real case. The Math.max guard is defensive-only (never lose
      // the mark text if that assumption is ever violated).
      pushAnnotation(after, Math.max(0, clean.length - 1), SNIPPET_MARK_CLOSE);
      continue;
    }
    clean += ch;
  }
  if (trailingEllipsis) {
    pushAnnotation(after, Math.max(0, clean.length - 1), SNIPPET_ELLIPSIS);
  }
  return { clean, before, after };
}

/**
 * Collapses `expandCjkForFts`'s artificial bigram-joiner spaces out of
 * `clean` (see {@link extractDecorations}), producing the original prose,
 * while relocating any `before`/`after` annotation that had targeted a
 * character this collapse removes.
 *
 * A space at index `p` is an artificial joiner iff `clean[p-1]` and
 * `clean[p+1]` are both CJK and EQUAL — exactly the shape
 * `toBigrams(run).join(" ")` produces between two bigrams of the SAME run
 * (consecutive bigrams always share one char). When it fires, both the
 * space (`p`) and the duplicate char (`p+1`) are dropped: `p+1`'s character
 * is identical to `p-1`'s, which is already in the output, so any
 * annotation that had targeted `p` or `p+1` is redirected onto `p-1` — the
 * one surviving occurrence of that shared character — landing in the SAME
 * before/after slot a directly-targeted annotation on `p-1` itself would.
 * `p-1` is always itself a kept (non-redirected) index: it is either
 * index 0, or the char most recently written by this same scan, which by
 * construction is never a dropped duplicate.
 *
 * Operating on the RAW character stream (not on `" "`-split chunks) is what
 * makes this correct for a chunk that itself contains more than one CJK
 * run glued together via non-CJK text with NO space — `expandCjkForFts`
 * never inserts a separator between a run and whatever immediately
 * precedes/follows it (only BETWEEN bigrams of the SAME run), so markdown
 * emphasis or punctuation directly touching two DIFFERENT runs
 * (`...个交易日**（实测边界...`, `...全年（现仅国庆）...`) produces exactly
 * one `" "`-delimited chunk spanning both runs. A chunk-first model can
 * only ever see the FIRST such run and treats the rest as opaque trailing
 * text — invisible to the chain check with the NEXT chunk, so a real
 * overlap goes undetected. Scanning raw characters instead makes every CJK
 * char a chain candidate regardless of which chunk it came from.
 *
 * Two CJK chars separated by a REAL word-boundary space (not a joiner)
 * never satisfy `clean[p-1] === clean[p+1]` by construction — distinct
 * `expandCjkForFts` runs are always divided by at least one non-CJK
 * character (that is what makes them separate `CJK_RUN_PATTERN` matches in
 * the first place), so the equality test cannot accidentally fire across a
 * genuine run boundary. A coincidental REPEATED single CJK char split by a
 * real space (`"本 本"`) is the one class this heuristic cannot distinguish
 * from a joiner — accepted per the task's own definition of correctness:
 * only overlap distinguishes a continued run from separate tokens.
 */
function collapseJoinerSpaces(
  clean: string,
  before: Map<number, string[]>,
  after: Map<number, string[]>,
): string {
  const kept: number[] = [];
  const redirectTo: number[] = new Array(clean.length);
  let i = 0;
  while (i < clean.length) {
    const isJoinerSpace =
      clean[i] === " " &&
      i > 0 &&
      i + 1 < clean.length &&
      isCjkChar(clean[i - 1]!) &&
      isCjkChar(clean[i + 1]!) &&
      clean[i - 1] === clean[i + 1];
    if (isJoinerSpace) {
      const anchor = i - 1;
      redirectTo[i] = anchor;
      redirectTo[i + 1] = anchor;
      i += 2;
      continue;
    }
    redirectTo[i] = i;
    kept.push(i);
    i += 1;
  }

  const newIndexOf = new Map<number, number>();
  kept.forEach((oldIndex, newIndex) => newIndexOf.set(oldIndex, newIndex));

  const finalBefore: string[][] = kept.map(() => []);
  const finalAfter: string[][] = kept.map(() => []);
  for (let oldIndex = 0; oldIndex < clean.length; oldIndex++) {
    const newIndex = newIndexOf.get(redirectTo[oldIndex]!)!;
    const b = before.get(oldIndex);
    if (b) finalBefore[newIndex]!.push(...b);
    const a = after.get(oldIndex);
    if (a) finalAfter[newIndex]!.push(...a);
  }

  let out = "";
  for (let newIndex = 0; newIndex < kept.length; newIndex++) {
    out += finalBefore[newIndex]!.join("") + clean[kept[newIndex]!]! + finalAfter[newIndex]!.join("");
  }
  return out;
}

/**
 * Collapses the overlapping-bigram artifacts a `snippet()` call produces
 * over the CJK bigram-expanded `fts_content`/`fts_title` shadow columns
 * (migration-008) back into ORIGINAL prose for display — the inverse
 * transform of {@link expandCjkForFts}, scoped to `snippet()` output only.
 *
 * `"…同步 步更 更新 新实 实测…"` → `"…同步更新实测…"`. Highlight marks
 * ({@link SNIPPET_MARK_OPEN}/{@link SNIPPET_MARK_CLOSE}) and the ellipsis
 * truncation marker are preserved at the position they annotate, including
 * when a run boundary sits behind a mark or mid-chunk punctuation (see
 * {@link collapseJoinerSpaces}'s JSDoc for the real-corpus cases this
 * covers: `...个交易日**（实测边界...`, `...全年（现仅国庆）...`). Two
 * adjacent CJK chars separated by a genuine word-boundary space (not a
 * bigram joiner) are never merged — see {@link collapseJoinerSpaces} for
 * the exact disambiguation rule.
 *
 * A snippet with no CJK character at all short-circuits before the
 * extraction/collapse machinery runs at all, guaranteeing ASCII output
 * stays byte-identical to the pre-migration-008 behavior.
 *
 * @param snippet - Raw `snippet()` SQL function output (already includes
 *   `SNIPPET_MARK_OPEN`/`CLOSE` highlight marks and `...` truncation text).
 * @returns `snippet` with bigram-expansion artifacts collapsed back to prose.
 * @example
 *   collapseCjkBigramSnippet("同步 步更 更新")        // => "同步更新"
 *   collapseCjkBigramSnippet("append-only version") // => "append-only version" (unchanged)
 */
export function collapseCjkBigramSnippet(snippet: string): string {
  if (!CJK_SINGLE_CHAR_PROBE.test(snippet)) return snippet;
  const { clean, before, after } = extractDecorations(snippet);
  return collapseJoinerSpaces(clean, before, after);
}

/**
 * Wraps `s` as one FTS5 double-quoted phrase, doubling any embedded `"`
 * (FTS5 phrase-escape). Shared by both the plain (byte-identical-to-legacy)
 * ASCII path and the CJK bigram-phrase path in {@link escapeFtsQuery} below
 * so the quoting rule is written exactly once.
 */
function quoteFtsPhrase(s: string): string {
  return `"${s.replaceAll('"', '""')}"`;
}

/**
 * FTS5-ready expression for ONE whitespace-delimited query piece (the unit
 * {@link escapeFtsQuery} splits `raw` into). Walks `piece` run-by-run,
 * alternating non-CJK spans (quoted phrases, byte-identical to the pre-CJK
 * escaping rule) and CJK spans:
 *   - a length-1 CJK run becomes an UNQUOTED prefix bareword (`交*`) — FTS5
 *     prefix syntax is explicitly NOT honored inside quotes (the tokenizer
 *     would consume the literal `*`), and a single character only ever
 *     appears in the bigram index as the leading or trailing half of some
 *     bigram token, so a prefix match is what makes it findable at all;
 *   - a length-≥2 CJK run becomes ONE quoted phrase of its space-joined
 *     bigrams (`"量化 化交 交易"`, same {@link toBigrams} used on the
 *     document side) — FTS5 phrase-query semantics (consecutive tokens, in
 *     order) exactly recovers "these bigrams appeared contiguously", which
 *     is the whole reason the document-side expansion overlaps.
 *
 * A `piece` with NO CJK characters exercises the loop zero times and falls
 * straight to the trailing "remainder" branch, producing
 * `quoteFtsPhrase(piece)` — the EXACT pre-CJK expression. This is what pins
 * pure-ASCII query output byte-identical to the pre-change implementation.
 */
function expandFtsQueryPiece(piece: string): string {
  const segments: string[] = [];
  let consumed = 0;
  for (const match of piece.matchAll(CJK_RUN_PATTERN)) {
    const run = match[0];
    const runStart = match.index;
    if (runStart > consumed) {
      segments.push(quoteFtsPhrase(piece.slice(consumed, runStart)));
    }
    segments.push(run.length === 1 ? `${run}*` : quoteFtsPhrase(toBigrams(run).join(" ")));
    consumed = runStart + run.length;
  }
  if (consumed < piece.length) {
    segments.push(quoteFtsPhrase(piece.slice(consumed)));
  }
  return segments.join(" ");
}

// ─── FTS5 query escape ─────────────────────────────────────────────────────

/**
 * Escape an arbitrary user search string into a FTS5-safe MATCH expression.
 *
 * Algorithm:
 *   1. Trim input. If empty, return "".
 *   2. Split on whitespace (one or more) into pieces.
 *   3. Each piece is expanded via {@link expandFtsQueryPiece} — pure-ASCII
 *      pieces reduce to the ORIGINAL rule (replace internal `"` with `""`,
 *      wrap in `"…"`); pieces containing a CJK run additionally emit a
 *      bigram phrase (or prefix bareword for a lone CJK char) per the CJK
 *      bigram-shadow-index scheme — see {@link expandCjkForFts}'s JSDoc.
 *   4. Join pieces (and, within a mixed piece, its CJK/non-CJK segments)
 *      with single spaces.
 *
 * Semantics: the resulting expression is an AND of phrase/prefix terms (FTS5
 * default boolean operator between bare expressions is AND). Each ASCII
 * phrase is FTS5-tokenized internally — so `"append-only"` matches docs
 * containing the consecutive sequence "append" then "only", which is what
 * users with a hyphenated term in mind almost always want.
 *
 * Returns "" only when input was empty or whitespace-only. Callers MUST treat
 * empty input as a no-results query and short-circuit BEFORE passing to FTS5
 * MATCH — FTS5 errors on an empty MATCH expression.
 *
 * Note: InMemoryStore uses substring-based search and does NOT use this
 * function — its semantics intentionally diverge from FTS5 and are out of scope
 * for this escape mechanism.
 *
 * @example
 *   escapeFtsQuery("")                    === ""
 *   escapeFtsQuery("   ")                 === ""
 *   escapeFtsQuery("service")             === '"service"'
 *   escapeFtsQuery("service layer")       === '"service" "layer"'
 *   escapeFtsQuery("append-only version") === '"append-only" "version"'
 *   escapeFtsQuery('he said "hi"')        === '"he" "said" """hi"""'
 *   escapeFtsQuery("foo*")                === '"foo*"'
 *   escapeFtsQuery("(append)")            === '"(append)"'
 *   escapeFtsQuery("交易")                === '"交易"'   (2-char CJK run → 1 bigram phrase)
 *   escapeFtsQuery("量化交易")            === '"量化 化交 交易"'
 *   escapeFtsQuery("交")                  === '交*'      (lone CJK char → prefix bareword)
 *
 * Source: SPEC-013 §3.5 FTS5-special-token resilience; CJK bigram extension
 * per task-fts5-cjk-search-returns-zero-hits-unicode61-tokenizes.
 */
export function escapeFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  const pieces = trimmed.split(/\s+/);
  const escaped = pieces.map((piece) => expandFtsQueryPiece(piece));
  return escaped.join(" ");
}

// ─── Criterion exemptions (migration-014 `ac_exemptions`, spec C4) ───────────

/** Refusal when the active-exemption cap (10% of live criteria) is already full. Shared by all three stores. */
export function buildAcExemptionCapError(activeCount: number, liveCriteria: number, maxActive: number): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "exemptions",
    message:
      `Exemption cap reached: ${activeCount} active exemption(s) already fill the 10% cap ` +
      `(max ${maxActive} = floor(10% x ${liveCriteria} live criteria)). ` +
      "Cite a baseline rule instead, or wait for an existing exemption to expire.",
  } as LoreError;
}

/** Refusal when (doc_id, ac_id) already carries an ACTIVE exemption. */
export function buildAcExemptionAlreadyActiveError(docId: string, acId: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "ac_id",
    message: `Criterion ${acId} of ${docId} already has an active exemption.`,
    value: acId,
  } as LoreError;
}
