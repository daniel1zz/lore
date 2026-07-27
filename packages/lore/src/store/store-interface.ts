/**
 * StoreInterface — storage abstraction for the Lore corpus.
 * All methods return Promise<Result<T, LoreError>> for Turso/libSQL async compatibility.
 * SQLiteStore wraps sync bun:sqlite calls in async methods.
 * Source: SPEC-001 §4, adapted to use Result<T, LoreError> per task spec.
 */

import type {
  AuditEntry,
  CalibrationRecord,
  DocId,
  DocRecord,
  DocStatus,
  DocType,
  LinkRecord,
  LinkType,
  ReviewJudgment,
  ReviewJudgmentKind,
  SearchHit,
  Slug,
  VersionRecord,
} from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import type { AuditChainEntry } from "./store-shared.js";

/**
 * Re-exported for backward compatibility — every store + the service layer
 * imports `SearchHit` from this module. `@lore/core` is the SSOT (SPEC-037
 * §2): the dashboard also needs the type/status-carrying shape and can only
 * import the browser-safe `@lore/core` barrel, never this Node-adjacent
 * module.
 */
export type { SearchHit };

/**
 * Re-exported so consumers of {@link StoreInterface.listAuditChain} (e.g. a
 * future `lore audit --verify` chain-walk service) have a single import
 * surface — `StoreInterface` and the type its own method returns living in
 * the same module, mirroring the `SearchHit` precedent above.
 */
export type { AuditChainEntry };

// ─── Update Options ────────────────────────────────────────────────────────

/**
 * Options for {@link StoreInterface.update}.
 *
 * When `expected_version` is provided the storage layer MUST perform a
 * conditional UPDATE (`WHERE id = ? AND version = ?`).  If zero rows are
 * affected (because the stored version no longer matches) the call MUST
 * return a {@link LoreError} with code `STALE_VERSION` carrying
 * `{ id, expected: expected_version, actual: <current stored version> }`.
 *
 * When omitted the existing unconditional UPDATE semantics are preserved,
 * keeping all current callers backward-compatible.
 *
 * @see PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC phase 1a — CAS/conditional-UPDATE
 *      implementation lands there.
 */
export interface UpdateOpts {
  /** Guard version. When set, update is conditional on this matching the stored value. */
  expected_version?: number;
}

// ─── Filter Types ──────────────────────────────────────────────────────────

export interface StoreFilters {
  type?: DocType;
  status?: DocStatus;
  parent_id?: DocId;
  created_by?: string;
  /** ISO 8601 — only docs updated at or after this timestamp */
  since?: string;
  tags?: string[];
  /** Default: true. When false, soft-deleted docs are included. */
  exclude_deleted?: boolean;
  /**
   * Maximum number of rows {@link StoreInterface.findMany} returns, bound via
   * `LIMIT ?` (never string-interpolated — same non-negotiable bind-protocol
   * rule {@link AuditFilters.limit}'s `reason:` comment documents). Omitted
   * (the default) → no `LIMIT` clause, ALL matching rows returned —
   * byte-identical to pre-pagination behavior. `0` is a valid value (returns
   * `[]`, not an error). Paging correctness depends on `findMany`'s stable
   * `ORDER BY updated_at DESC, id ASC` — the `id` tiebreaker is what keeps
   * offset pages non-overlapping when multiple docs share the same
   * `updated_at`.
   */
  limit?: number;
  /**
   * Rows to skip before returning results, bound via `OFFSET ?`. Works with or
   * without `limit` — an `offset` with no `limit` is still bounded via a
   * `LIMIT -1` (SQLite/libsql "unlimited") sentinel so the two stay
   * independently combinable, matching {@link StoreInterface.findVersions}'s
   * existing `limit?`/`offset?` pairing. Omitted → no `OFFSET` clause (skip
   * nothing).
   */
  offset?: number;
}

export interface AuditFilters {
  doc_id?: DocId;
  actor?: string;
  action?: string;
  /** ISO 8601 */
  since?: string;
  limit?: number;
}

/**
 * Filter for {@link StoreInterface.queryCalibrationWindow}.
 * `limit` is required — the window is always bounded (never an unbounded scan).
 */
export interface CalibrationWindowFilter {
  doc_type?: DocType;
  /**
   * Filters by the prompt_version of the judgment each calibration record
   * points at. Requires a join to `review_judgments` (kept as one indexed
   * SQL statement — see SQLiteStore.queryCalibrationWindow).
   */
  prompt_version?: string;
  limit: number;
}

/**
 * A {@link CalibrationRecord} augmented with `judge_prompt_version` — the
 * `prompt_version` of the judgment it's FK'd to, projected onto the row by
 * {@link StoreInterface.queryCalibrationWindow}'s join to `review_judgments`.
 * `CalibrationRecord` itself (the `calibrationRecordSchema`-validated persisted
 * shape) intentionally does NOT carry `prompt_version` — only the judgment
 * does — so this is a store-layer read projection, not a schema change.
 */
export type CalibrationRecordWithPromptVersion = CalibrationRecord & {
  judge_prompt_version: string;
  /**
   * `kind` of the judgment this calibration record is FK'd to (SPEC-044 D12/AC-SP-11) —
   * projected by the SAME unconditional join that already projects `judge_prompt_version`.
   * `JudgmentService.computeCalibrationStats` groups by `(doc_type, judge_prompt_version,
   * judge_kind)` so review and staleness calibrations never pool into one Wilson bound
   * even when both prompt versions are the literal `"v1"` (review S5).
   */
  judge_kind: ReviewJudgmentKind;
};

// ─── Interface ─────────────────────────────────────────────────────────────

/**
 * Async storage interface.
 * SQLiteStore implements this via bun:sqlite (sync internally, wrapped in async).
 * TursoStore will implement this via @libsql/client (natively async).
 * InMemoryStore implements this for unit tests.
 */
export interface StoreInterface {
  // ── Document CRUD ──────────────────────────────────────────────────────

  /** Insert a new doc. Fails with DUPLICATE_SLUG if slug already exists. */
  insert(doc: DocRecord): Promise<Result<DocRecord, LoreError>>;

  /**
   * Atomically allocate the next free display ordinal for `doc.type` and
   * insert it — the SOLE insert-scoped ordinal-allocation site (SPEC-084 D1;
   * the sibling {@link allocateOrdinalForExisting} is the UPDATE-scoped one
   * for the exempt→numbered kind-flip transition — never use one where the
   * other belongs).
   *
   * Transaction-scoped: `SELECT MAX(ordinal)+1 WHERE type=?` computed ONCE,
   * then insert; on a `(type, ordinal)` UNIQUE-index violation, retry up to
   * 3 bounded attempts with the next successive candidate (never
   * re-querying MAX mid-loop — a fresh per-attempt query would self-heal
   * around any pre-existing row and could never surface a genuine
   * collision under a single-connection store). `doc.ordinal` on the INPUT
   * is ignored/overwritten — callers pass a doc whose type is eligible for
   * numbering (per `ORDINAL_REGISTRY`, out of this method's concern — the
   * SERVICE layer decides WHETHER to call this at all).
   *
   * @returns `ok(insertedDoc)` with `ordinal` populated on success; the SAME
   *   `DUPLICATE_SLUG`/`STORE_ERROR` shapes {@link insert} would return for a
   *   non-ordinal failure (propagated immediately, never retried); on
   *   retry-budget exhaustion, `err(STORE_ERROR)` whose `message` contains
   *   the literal token `ORDINAL_ALLOCATION_EXHAUSTED` — never a silent NULL
   *   ordinal.
   * @see SPEC-084 §Module Boundary, §Retry-exhaustion failure shape
   */
  insertWithAllocatedOrdinal(doc: DocRecord): Promise<Result<DocRecord, LoreError>>;

  /**
   * Atomically allocate the next free display ordinal for an EXISTING doc
   * and persist it via a CAS-guarded UPDATE — the exempt→numbered kind-flip
   * sibling of {@link insertWithAllocatedOrdinal} (SPEC-084 D1). Refuses a
   * row that ALREADY carries a non-null `ordinal` (checked before the CAS
   * comparison, so an already-numbered row is refused regardless of whether
   * `expectedVersion` happens to match the row's current version — ordinals
   * are immutable once assigned) and bumps `version` by exactly 1 on
   * success, mirroring {@link update}'s optimistic-locking contract.
   *
   * Same bounded-retry/exhaustion shape as {@link insertWithAllocatedOrdinal}
   * (MAX+1 computed once, ≤3 successive candidates on a UNIQUE violation).
   *
   * @param id - Doc id to allocate an ordinal for (must currently have
   *   `ordinal: null`).
   * @param expectedVersion - CAS guard; mismatch (and `ordinal` is still
   *   null) returns `{code: "STALE_VERSION", id, expected, actual}`.
   * @returns `ok(updatedDoc)` with `ordinal` populated and `version`
   *   incremented; `DOC_NOT_FOUND` if `id` doesn't exist; the "already
   *   carries an ordinal" refusal (`STORE_ERROR`) if it does; `STALE_VERSION`
   *   on a version mismatch; or the SAME `ORDINAL_ALLOCATION_EXHAUSTED`
   *   shape as {@link insertWithAllocatedOrdinal} on retry-budget exhaustion.
   * @see SPEC-084 §Changed semantics "Kind-flip semantics"
   */
  allocateOrdinalForExisting(
    id: DocId,
    expectedVersion: number,
  ): Promise<Result<DocRecord, LoreError>>;

  /**
   * Directly assigns the EXACT `ordinal` value passed in — the ONLY store
   * write path that does NOT compute `MAX(ordinal)+1` (SPEC-084 D7: "repair
   * migration uses an internal store path"). Deliberately NOT exposed via
   * CLI/MCP/HTTP and not for any other caller — `insertWithAllocatedOrdinal`/
   * `allocateOrdinalForExisting` remain the only two ALLOCATION sites (Plan
   * Invariant 2); this is a distinct, sanctioned TARGETED-ASSIGNMENT path
   * used exclusively by `OrdinalMigrationService`'s one-shot repair, whose
   * own dry-run-computed target must reproduce byte-identically once
   * applied, on any claimed-number topology (including one with real
   * historical gaps a MAX+1 sweep could never reconstruct).
   *
   * No bounded retry: a repair target colliding with a live row means the
   * migration's OWN plan is wrong (its `taken` bookkeeping already computed
   * the target to be collision-free against the current corpus state), not
   * a transient race worth retrying around — the partial `(type, ordinal)`
   * UNIQUE index remains the sole uniqueness authority, and any violation
   * propagates loud and immediate. No CAS `expectedVersion` parameter
   * either — the repair migration is a single-process, non-concurrent
   * sweep (the same argument `insertWithAllocatedOrdinal`'s own JSDoc
   * makes), and its own `versionByDocId` bookkeeping already sequences
   * this write before any later title-strip write on the same doc.
   *
   * @param id - Doc id to assign an ordinal to.
   * @param ordinal - The EXACT target value (never MAX+1-derived by this
   *   method itself — the caller has already resolved it).
   * @returns `ok(doc)` with `ordinal` populated, `version` incremented by 1,
   *   on a fresh assignment; `ok(doc)` UNCHANGED (no write) when `doc`
   *   already carries this SAME value (idempotent no-op — a repeat repair
   *   call); `DOC_NOT_FOUND` if `id` doesn't exist; `STORE_ERROR` if the doc
   *   already carries a DIFFERENT ordinal, if `doc.type` is not an
   *   ordinal-registered type, or on a genuine `(type, ordinal)` collision.
   * @see SPEC-084 §Module Boundary D7
   */
  assignOrdinalForRepair(
    id: DocId,
    ordinal: number,
  ): Promise<Result<DocRecord, LoreError>>;

  /** Find doc by ULID. Returns null (not error) if not found. */
  find(id: DocId): Promise<Result<DocRecord | null, LoreError>>;

  /** Find doc by slug. Returns null (not error) if not found. */
  findBySlug(slug: Slug): Promise<Result<DocRecord | null, LoreError>>;

  /**
   * Find every doc whose `id` starts with `prefix`, for unique ID-prefix
   * resolution (SPEC-065 D1/D2) — `resolveDoc` calls this ONLY after an exact
   * `find`/`findBySlug` lookup misses, so a full-ULID prefix collision with a
   * REAL other doc's id is the only case this method needs to disambiguate.
   *
   * Matching is case-INSENSITIVE (mirrors the caller's `/i`-flagged prefix
   * regex — a copy-pasted 10-char prefix should resolve the same whether the
   * terminal preserved case or not); implementations MAY rely on the storage
   * engine's native case-insensitive `LIKE` (SQLite/libSQL) or perform an
   * explicit uppercase compare (InMemoryStore).
   *
   * UNLIKE {@link find}/{@link findByIds} (direct-address lookups that
   * deliberately do NOT filter soft-deleted rows), this is a discovery-shaped
   * query — it EXCLUDES soft-deleted docs (`deleted_at IS NULL`), same
   * default `findMany` applies, so a prefix that only matches a deleted doc
   * resolves as zero candidates (falls through to the NOT_FOUND path with the
   * truncation diagnostic), not a phantom match on a doc no surface can act
   * on anymore.
   *
   * @param prefix - a candidate ID prefix, 6-25 chars (caller-validated via
   *   the `ID_PREFIX_REGEX` in `resolve.ts`; this method does not re-validate
   *   length/charset — an empty or malformed prefix is a caller bug).
   * @returns every non-deleted doc whose id starts with `prefix`, in NO
   *   particular guaranteed order (the caller only branches on `length`).
   */
  findByIdPrefix(prefix: string): Promise<Result<DocRecord[], LoreError>>;

  /**
   * Find the doc whose `(type, ordinal)` pair matches — the read side of
   * SPEC-084's store-allocated ordinal identity, feeding `resolveDoc`'s
   * ordinal-ref resolution step (`parseOrdinalRef` match, e.g. `"SPEC-84"` →
   * `{type: "spec", ordinal: 84}`, out of this method's concern). Same
   * 3-impl shape as {@link findByIdPrefix} (SPEC-065 precedent).
   *
   * UNLIKE {@link findByIdPrefix} (discovery-shaped, excludes soft-deleted),
   * this is a direct-address lookup by a UNIQUE key (the partial index
   * enforces at most one row per `(type, ordinal)` pair INCLUDING
   * soft-deleted rows, SPEC-084 D9) — it does NOT filter `deleted_at`,
   * mirroring {@link find}/{@link findByIds}'s direct-address contract: a
   * soft-deleted doc's ordinal still resolves to it (the number is never
   * reassigned to a different doc), consistent with "never reused."
   *
   * @param type - Doc type to scope the lookup to (an `ORDINAL_REGISTRY` key).
   * @param ordinal - The numeric ordinal to look up (no zero-padding at this
   *   layer — callers normalize via `parseOrdinalRef` first).
   * @returns `ok(doc)` if a match exists, `ok(null)` otherwise (never an
   *   error for "not found" — mirrors {@link find}/{@link findBySlug}).
   * @see SPEC-084 §Module Boundary
   */
  findByTypeOrdinal(type: DocType, ordinal: number): Promise<Result<DocRecord | null, LoreError>>;

  /**
   * Batch-find docs by id, in ONE round trip. `WHERE id IN (...)` — avoids the N+1
   * pattern of calling {@link find} once per "other side of a link" id, e.g.
   * `CorpusService`'s `related` resolution over a doc's non-parent links.
   *
   * Applies the SAME soft-delete default as {@link find} — i.e. NONE: a
   * soft-deleted doc is still returned if its id is requested (find/findByIds
   * are direct-address lookups, not list-shaped reads; `exclude_deleted`
   * filtering is `findMany`'s concern only).
   *
   * @param ids - Doc ids to fetch
   * @returns Map keyed by doc id; an id with no matching doc is ABSENT from the
   *   map (never present with `null` or `undefined`) — mirrors
   *   {@link findLinksByToIds}'s "absent means none" convention. `ok(new Map())`
   *   immediately when `ids` is empty (no query issued, never a malformed
   *   `WHERE id IN ()`).
   */
  findByIds(ids: DocId[]): Promise<Result<Map<DocId, DocRecord>, LoreError>>;

  /**
   * Find multiple docs matching filters, ordered `updated_at DESC, id ASC`
   * (a stable secondary tiebreaker — required for deterministic `limit`/
   * `offset` paging, see {@link StoreFilters.limit}).
   * By default excludes soft-deleted docs (exclude_deleted defaults to true).
   */
  findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>>;

  /**
   * Apply a partial patch to an existing doc.
   * Returns `DOC_NOT_FOUND` if `id` is missing.
   *
   * **Optimistic locking** — when `opts.expected_version` is provided the
   * storage layer MUST perform a conditional UPDATE (`WHERE id = ? AND version = ?`).
   * If the stored version no longer matches, the call MUST return
   * `{ code: "STALE_VERSION", id, expected: opts.expected_version, actual: <stored> }`.
   * When `opts` is omitted the unconditional UPDATE behaviour is preserved
   * (backward-compatible — all existing callers are unaffected).
   *
   * @see PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC phase 1a — CAS implementation
   */
  update(
    id: DocId,
    patch: Partial<DocRecord>,
    opts?: UpdateOpts,
  ): Promise<Result<DocRecord, LoreError>>;

  /**
   * Set deleted_at to current ISO timestamp.
   * Doc remains in DB but excluded from findMany by default.
   */
  softDelete(id: DocId): Promise<Result<void, LoreError>>;

  // ── Provenance-atomic composite writes (BUG-002) ───────────────────────

  /**
   * Atomically insert a new doc together with its creation {@link VersionRecord}
   * and {@link AuditEntry}. Replaces the pre-existing three-independent-`await`
   * sequence (`insert` → `insertVersion` → `appendAuditEntry`) `CorpusService`
   * used to run — a failure on step 2 or 3 left the doc PERSISTED with zero
   * version/audit rows and no signal to the caller that partial state landed.
   * All three writes commit or roll back together: on any failure the doc row
   * (and any version/audit row already written by this call) MUST NOT be
   * observable afterward — `find(doc.id)` returns `null`.
   *
   * `insert`/`insertVersion`/`appendAuditEntry` remain independently callable
   * (unchanged contracts) for callers that don't need the composite guarantee
   * (e.g. `MigrationService`'s intentionally-ungated raw `insert` bypass).
   *
   * @param doc - The doc row to insert (same contract as {@link insert})
   * @param version - The version-1 snapshot (same contract as {@link insertVersion})
   * @param audit - The `action: "create"` audit entry (same contract as {@link appendAuditEntry})
   * @returns `ok(doc)` on success (mirrors `insert`'s return shape); on failure,
   *   the SAME error `insert`/`insertVersion`/`appendAuditEntry` would have
   *   individually returned for the step that failed (`DUPLICATE_SLUG` from
   *   step 1, `STORE_ERROR`/schema violations from steps 2-3) — never a new
   *   error shape.
   * @see BUG-002 (audit finding) — corpus-service.ts `_createImpl`
   */
  insertWithProvenance(
    doc: DocRecord,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>>;

  /**
   * The ordinal-aware sibling of {@link insertWithProvenance} — atomically
   * ALLOCATES a store-computed display ordinal for `doc.type` (the SAME
   * `MAX(ordinal)+1` + bounded-retry mechanics {@link insertWithAllocatedOrdinal}
   * uses, delegated to the shared `allocateWithBoundedRetry` seam,
   * `store-shared.ts`) AND writes the resulting doc together with its
   * creation {@link VersionRecord} and {@link AuditEntry} — all in ONE
   * transaction (BUG-002 window closure for `CorpusService._createImpl`'s
   * numbered path, SPEC-084 follow-up).
   *
   * Before this method existed, the numbered-type create path ran
   * `insertWithAllocatedOrdinal` (insert-only) followed by two independent
   * `await`s (`insertVersion`, `appendAuditEntry`) — reintroducing the exact
   * partial-write window BUG-002 closed for the non-numbered path (a crash
   * or failure between those awaits left a doc row with an allocated ordinal
   * but zero version/audit history). This method closes that window the same
   * way {@link insertWithProvenance} closed it for non-numbered types: on ANY
   * failure (ordinal-allocation exhaustion, a non-ordinal insert failure, a
   * version-insert failure, or an audit-append failure), NOTHING is
   * observable afterward — `find(doc.id)` returns `null`, and the allocated
   * ordinal candidate is NOT burned (a subsequent successful call for the
   * same `doc.type` computes the SAME `MAX(ordinal)+1` candidate again,
   * since the failed attempt's row never committed and therefore never
   * raised that type's `MAX(ordinal)`).
   *
   * `doc.ordinal` on the INPUT is ignored/overwritten, identically to
   * {@link insertWithAllocatedOrdinal} — callers pass a doc whose type is
   * ordinal-eligible per `ORDINAL_REGISTRY` (the SERVICE layer's concern,
   * not this method's).
   *
   * @param doc - The doc row to insert (ordinal candidate is store-computed;
   *   same contract as {@link insertWithAllocatedOrdinal} otherwise)
   * @param version - The version-1 snapshot (same contract as {@link insertVersion})
   * @param audit - The `action: "create"` audit entry (same contract as {@link appendAuditEntry})
   * @returns `ok(insertedDoc)` with `ordinal` populated on success; on
   *   failure, the SAME error shapes {@link insertWithAllocatedOrdinal} or
   *   {@link insertWithProvenance} would individually return for the step
   *   that failed (`DUPLICATE_SLUG`, a version/audit `STORE_ERROR`, or the
   *   `ORDINAL_ALLOCATION_EXHAUSTED` retry-budget message) — never a new
   *   error shape.
   * @see SPEC-084 §Module Boundary; BUG-002 (audit finding) — corpus-service.ts `_createImpl`
   */
  insertWithAllocatedOrdinalAndProvenance(
    doc: DocRecord,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>>;

  /**
   * Atomically apply a patch to an existing doc together with its update
   * {@link VersionRecord} and {@link AuditEntry} — the composite analog of
   * {@link update} for `CorpusService.set`'s write path (BUG-002).
   *
   * `opts` carries the SAME `UpdateOpts` contract as {@link update} — when
   * `opts.expected_version` is set, the doc write is a conditional CAS UPDATE;
   * zero affected rows (version mismatch) returns `STALE_VERSION` and the
   * version/audit inserts never run (nothing to roll back — the doc write
   * itself is the first statement and it never touched a row). When the doc
   * CAS/write succeeds but EITHER the version or audit insert fails, ALL
   * THREE writes roll back together — the doc row reverts to its
   * pre-call state, observable via a subsequent `find`.
   *
   * @param id - Doc id to update (same contract as {@link update})
   * @param patch - Partial patch (same contract as {@link update})
   * @param opts - Same {@link UpdateOpts} contract as {@link update}
   * @param version - The post-patch version snapshot (same contract as {@link insertVersion})
   * @param audit - The audit entry for this update (same contract as {@link appendAuditEntry})
   * @returns `ok(updatedDoc)` on success (mirrors `update`'s return shape);
   *   `DOC_NOT_FOUND` / `STALE_VERSION` from the doc write step, or the
   *   version/audit step's own error, on failure — never a new error shape.
   * @see BUG-002 (audit finding) — corpus-service.ts `set`
   */
  updateWithProvenance(
    id: DocId,
    patch: Partial<DocRecord>,
    opts: UpdateOpts | undefined,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>>;

  /**
   * Atomically soft-delete a doc together with its `action: "delete"`
   * {@link VersionRecord} sentinel and {@link AuditEntry} — the composite
   * analog of {@link softDelete} for `CorpusService.delete`'s write path
   * (BUG-002). Same all-or-nothing guarantee as {@link updateWithProvenance}:
   * a version/audit failure rolls back the soft-delete (`deleted_at` reverts
   * to `null`).
   *
   * @param id - Doc id to soft-delete (same contract as {@link softDelete})
   * @param version - The `version: 0` delete sentinel (same contract as {@link insertVersion})
   * @param audit - The `action: "delete"` audit entry (same contract as {@link appendAuditEntry})
   * @returns `ok(undefined)` on success; `DOC_NOT_FOUND` from the soft-delete
   *   step, or the version/audit step's own error, on failure.
   * @see BUG-002 (audit finding) — corpus-service.ts `delete`
   */
  softDeleteWithProvenance(
    id: DocId,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<void, LoreError>>;

  // ── Links ──────────────────────────────────────────────────────────────

  /**
   * Add a directed link.
   * Fails with DUPLICATE_LINK if (from_id, to_id, link_type) already exists.
   * For link_type='parent': validates no cycle in the parent tree.
   */
  addLink(link: LinkRecord): Promise<Result<LinkRecord, LoreError>>;

  /** Remove a specific directed link by composite key. */
  removeLink(
    fromId: DocId,
    toId: DocId,
    linkType: LinkType,
  ): Promise<Result<void, LoreError>>;

  /** Find all links for a doc, filtered by direction. */
  findLinks(
    docId: DocId,
    direction: "in" | "out" | "both",
  ): Promise<Result<LinkRecord[], LoreError>>;

  /**
   * Batch-find links of a given type whose `to_id` is in `toIds`, in one round trip.
   * `WHERE to_id IN (...) AND link_type = ?` — avoids the N+1 pattern of calling
   * {@link findLinks} once per task when computing readiness over a whole plan.
   * Returns `ok([])` immediately when `toIds` is empty (no query issued).
   *
   * @param toIds - Target doc ids to match on the `to_id` side of the link
   * @param linkType - Link type to filter on (readiness uses "blocks")
   * @see PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC / SPEC-025 §3 D7
   */
  findLinksByToIds(
    toIds: DocId[],
    linkType: LinkType,
  ): Promise<Result<LinkRecord[], LoreError>>;

  /**
   * Batch-count ALL incoming link rows (every link type — unlike {@link findLinksByToIds},
   * which is single-`linkType`-scoped and cannot express this) whose `to_id` is in `toIds`,
   * in ONE round trip. The staleness-probe pure layer's `in_degree` input (SPEC-044 D1;
   * `findLinksByToIds` cannot express an all-link-types count — review S1).
   *
   * @param toIds - Target doc ids to count incoming links for
   * @returns Map keyed by doc id; a doc id with ZERO incoming links of any type is
   *   ABSENT from the map (never present with value 0) — callers default via `?? 0`.
   *   `ok(new Map())` immediately when `toIds` is empty (no query issued).
   * @see SPEC-044 §Design Decisions D1
   */
  countLinksByToIds(toIds: DocId[]): Promise<Result<Map<DocId, number>, LoreError>>;

  /**
   * Batch-find OUTGOING links grouped by `from_id`, in ONE round trip — the
   * outgoing-link analog of {@link findLinksByToIds}, keyed the opposite
   * direction. `WHERE from_id IN (...)`, grouped in the returned Map so
   * callers never need a manual per-doc slice pass.
   *
   * Mirrors {@link findLinks}'s `"out"` direction EXACTLY — no `link_type`
   * filter is applied (unlike {@link findLinksByToIds}, which IS
   * `linkType`-scoped): every outgoing link row is returned, of any type.
   * This makes `findLinksByFromIds(ids)` behavior-identical to calling
   * `findLinks(id, "out")` once per id and grouping the results yourself —
   * the N+1 pattern this method exists to replace
   * (`TreeCheckService.reconcile`, SPEC review M7).
   *
   * @param fromIds - Source doc ids to match on the `from_id` side of the link
   * @param direction - Reserved for signature symmetry with {@link findLinks};
   *   currently the ONLY supported value is `"out"` (the default) — grouping by
   *   `from_id` is inherently an outgoing-link concept, so no other direction
   *   has a well-defined meaning here. Typed as the single literal rather than
   *   the `"in" | "out" | "both"` union to make that a compile-time fact, not
   *   a runtime one.
   * @returns Map keyed by `from_id`; a doc id with zero outgoing links is
   *   ABSENT from the map (never present with `[]`) — same "absent means
   *   none" convention as {@link countLinksByToIds}. `ok(new Map())`
   *   immediately when `fromIds` is empty (no query issued).
   */
  findLinksByFromIds(
    fromIds: DocId[],
    direction?: "out",
  ): Promise<Result<Map<DocId, LinkRecord[]>, LoreError>>;

  // ── Search ─────────────────────────────────────────────────────────────

  /**
   * Full-text search via FTS5.
   * Returns ranked results with BM25 score and content snippets.
   * Filters applied as post-FTS WHERE clauses on joined docs table.
   */
  search(query: string, filters?: StoreFilters): Promise<Result<SearchHit[], LoreError>>;

  // ── Versions ───────────────────────────────────────────────────────────

  /** Insert a new version snapshot. */
  insertVersion(version: VersionRecord): Promise<Result<VersionRecord, LoreError>>;

  /** Return version history for a doc, newest first. */
  findVersions(
    docId: DocId,
    opts?: { limit?: number; offset?: number },
  ): Promise<Result<VersionRecord[], LoreError>>;

  /**
   * Return version rows across ALL docs, optionally bounded by a `since` watermark
   * (`created_at >= since`), unordered otherwise. This is the read path for
   * {@link AuditService.verify}'s versions⋈audit reconcile walk (SPEC-035 §2 D5) —
   * `findVersions` is per-doc only, and the completeness oracle needs every version
   * row corpus-wide since the watermark, not one doc at a time.
   *
   * @param since - ISO 8601; omit for no lower bound (all versions ever, used only
   *   by tests — production callers always pass the resolved `audit.verify_since`)
   * @see PLAN task D (SPEC-035) — audit surface
   */
  listAllVersions(since?: string): Promise<Result<VersionRecord[], LoreError>>;

  // ── Audit ──────────────────────────────────────────────────────────────

  /**
   * Append an immutable audit entry — extends the SPEC-079 G3 tamper-evident
   * hash chain. Implementations MUST read the current chain head (the
   * highest-`id` row's `entry_hash`, or `""` if the table is empty) and
   * compute this entry's `entry_hash` (`computeAuditEntryHash`,
   * `store-shared.ts`) INSIDE the same transaction/serialized write as the
   * insert itself — concurrent writers reading a stale head and both
   * extending from it would fork the chain into two branches, silently
   * defeating the tamper-evidence property.
   */
  appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>>;

  /** Query audit log with filters. */
  queryAudit(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>>;

  /**
   * Return every audit row in `id` ASC order, INCLUDING its hash-chain
   * fields (`id`/`prev_hash`/`entry_hash`) — the read surface `lore audit
   * --verify`'s chain walk (a separate task) recomputes and validates
   * against. Unlike {@link queryAudit} (timestamp DESC, filtered, and
   * deliberately silent about hash fields so no caller can ever forge one),
   * this is the ONLY place `prev_hash`/`entry_hash` are readable. `id` ASC
   * is the canonical chain-construction order — the SAME order
   * migration-009's backfill and every live `appendAuditEntry` extend the
   * chain in. A NULL `prev_hash`/`entry_hash` pair on any returned row is a
   * verify-time finding (`"unchained_row"`), never legal post-migration-009
   * steady state (see migration-009.ts's module JSDoc).
   */
  listAuditChain(): Promise<Result<AuditChainEntry[], LoreError>>;

  // ── Review Judgments ───────────────────────────────────────────────────
  // SPEC-034 §2, §3. Dual use: production write path for JudgmentService
  // (not yet implemented — this task lands the data layer only) AND the test
  // seeding path for calibration/triage scenarios, mirroring insertVersion's
  // precedent of one write method serving both roles.

  /**
   * Insert a new review judgment row. The caller (JudgmentService) is
   * responsible for Zod-validating the shape via `reviewJudgmentSchema`
   * before calling — this method does not re-validate, matching `insert`'s
   * contract for DocRecord.
   */
  insertJudgment(judgment: ReviewJudgment): Promise<Result<void, LoreError>>;

  /**
   * All judgments for a doc, newest first (`created_at DESC`).
   *
   * @param kind - When provided, only rows whose `kind` matches (SPEC-044 D3) —
   *   omitted rows read as `'review'` via `??`, never strict equality (S10). When
   *   OMITTED entirely, returns judgments of ANY kind (the pre-SPEC-044 behavior) —
   *   `JudgmentService.listFor` is what defaults this to `'review'` for every existing
   *   caller (D3); the store layer itself applies no default.
   */
  findJudgments(docId: DocId, kind?: ReviewJudgmentKind): Promise<Result<ReviewJudgment[], LoreError>>;

  /**
   * Most recent judgment for a doc, or `null` if none exists yet.
   *
   * @param kind - Same optional kind filter as {@link findJudgments} — omitted means
   *   "any kind" at the store layer; `JudgmentService.latestFor` defaults it to
   *   `'review'`. Without this filter, a staleness "holds" row (persisted
   *   `decision: 'approve'`) could become a doc's latest judgment and masquerade as a
   *   real review approval in `lore pending` (review S2).
   */
  latestJudgment(docId: DocId, kind?: ReviewJudgmentKind): Promise<Result<ReviewJudgment | null, LoreError>>;

  /**
   * Batch-fetch each doc's LATEST judgment of a given kind, in ONE round trip — the
   * staleness-probe pure layer's `latest_holds_probe_at` input needs this per candidate
   * (SPEC-044 D2); an N+1 per-candidate `latestJudgment` call is explicitly rejected
   * (review T6).
   *
   * @param docIds - Doc ids to fetch the latest matching-kind judgment for
   * @param kind - REQUIRED (unlike the single-doc methods above) — every real caller
   *   (StalenessProbeService) always wants ONE specific kind for this batch shape;
   *   there is no legitimate "any kind" batch use case today
   * @returns Map keyed by doc id; a doc with NO judgment of that kind is ABSENT from
   *   the map (never present with `null`). `ok(new Map())` immediately when `docIds`
   *   is empty (no query issued).
   * @see SPEC-044 §Design Decisions D2
   */
  latestJudgmentsByDocIds(
    docIds: DocId[],
    kind: ReviewJudgmentKind,
  ): Promise<Result<Map<DocId, ReviewJudgment>, LoreError>>;

  // ── Calibration Records ────────────────────────────────────────────────

  /** Insert a new calibration record (human confirm/override of a judgment). */
  insertCalibrationRecord(record: CalibrationRecord): Promise<Result<void, LoreError>>;

  /**
   * Bounded, indexed window of calibration records, newest first
   * (`created_at DESC`), optionally filtered by `doc_type` and/or the
   * `prompt_version` of the judgment each record points at. The join to
   * `review_judgments` is UNCONDITIONAL (not just when `filter.prompt_version`
   * is pinned) — every returned record carries the judgment's real
   * `judge_prompt_version`, so callers (`JudgmentService.computeCalibrationStats`)
   * can group by the actual (doc_type, prompt_version) pair instead of an
   * unpinned `"*"` sentinel.
   */
  queryCalibrationWindow(
    filter: CalibrationWindowFilter,
  ): Promise<Result<CalibrationRecordWithPromptVersion[], LoreError>>;

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Close the underlying database connection. Flushes WAL. */
  close(): void;

  /**
   * Report the on-disk size of the underlying database, in bytes.
   *
   * `SQLiteStore` / `TursoStore` compute `PRAGMA page_count * PRAGMA page_size`
   * against the local file (for `TursoStore`, the embedded replica file).
   * `InMemoryStore` has no disk footprint and always returns `ok(0)`.
   */
  dbSizeBytes(): Promise<Result<number, LoreError>>;
}
