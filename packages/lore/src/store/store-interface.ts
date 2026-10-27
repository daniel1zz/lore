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
  KnowledgeSubType,
  LinkRecord,
  LinkType,
  ReviewJudgment,
  ReviewJudgmentKind,
  RuleIdPrefix,
  RuleRegistryState,
  RunId,
  RunRecord,
  SearchHit,
  Slug,
  VersionRecord,
} from "@lore/core";
import type { DecisionRecord, LoreError, Result } from "@lore/core";
import type { AuditChainEntry } from "./store-shared.js";
import type { DecisionLogRow, DecisionRecordInput } from "./decision-log.js";

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

/**
 * The four columns of a versions row that {@link AuditService.verify}'s completeness join reads — the whole of
 * {@link StoreInterface.listVersionKeys}'s row. Deliberately carries no `content`/`extra`/`status`/`title`.
 */
export type VersionKey = Pick<VersionRecord, "doc_id" | "version" | "action" | "created_at">;

/** One (class, subject, version) triple — the unit the effective decision verdict is computed over. */
export interface DecisionSubjectKey {
  readonly class: string;
  readonly subject_id: string;
  readonly subject_version: string;
}
export type { DecisionLogRow, DecisionRecordInput };

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

/**
 * A run's end state (migration-017). `endedAt === null` = the run is open. Kept OFF {@link RunRecord}: a run's
 * registered identity is frozen (BR-1029), whereas ending / reopening it is a lifecycle fact.
 */
export interface RunEndState {
  readonly endedAt: string | null;
  readonly endReason: string | null;
}

/**
 * The OS process a run lives in (migration-021). `pid` and `startTime` (ISO 8601, second precision, the pid-reuse
 * defence) are both set or both null; `worktree` is the checkout directory the registering command ran in, or null.
 */
export interface RunProcessRecord {
  readonly pid: number | null;
  readonly startTime: string | null;
  readonly worktree: string | null;
}

/** One run with everything `lore run reap` needs: identity, lifetime and recorded process. A legacy run has `process.pid === null`. */
export interface RunLifecycle {
  readonly id: RunId;
  readonly registeredAt: string;
  readonly endedAt: string | null;
  readonly endReason: string | null;
  readonly parentRunId: RunId | null;
  readonly agentRef: string | null;
  readonly process: RunProcessRecord;
}

/** Outcome of {@link StoreInterface.endRun}: `unknown-run` writes nothing; `already-ended` keeps the FIRST end. */
export type RunEndOutcome = "ended" | "already-ended" | "unknown-run";

/** Result of {@link StoreInterface.countAttributedWrites}. */
export interface AttributedWriteCount {
  total: number;
  attested: number;
}

/**
 * Extras for {@link StoreInterface.updateWithProvenance}, honoured INSIDE its single write transaction.
 * The citation gate's liveness read must share the citing write's transaction, or a concurrent retire
 * can commit between the check and the write (spec-baseline-slice-2 §C4/D6, QA-2).
 */
/**
 * One more doc update committed in the SAME transaction as the primary {@link StoreInterface.updateWithProvenance}
 * write, with its own version row and audit row. All of them land or none do (BR-1307: deprecating a spec and
 * retiring its proposed rule ids on the baseline leaves are one outcome).
 */
export interface CompanionDocWrite {
  /** The doc to update (a baseline leaf for a rule retirement). */
  readonly id: DocId;
  /** The patch, applied exactly as the primary one is. */
  readonly patch: Partial<DocRecord>;
  /** CAS base: a version miss fails the whole transaction with `STALE_VERSION`. */
  readonly opts: UpdateOpts;
  /** The version row of this doc's write (inserted only when `snapshot` is true). */
  readonly version: VersionRecord;
  /**
   * Whether this doc's write adds a `versions` row. REQUIRED, no default: the caller (the service) decides, the store
   * obeys. `false`: the doc version still rises by one under the same CAS and the audit row is still written.
   */
  readonly snapshot: boolean;
  /** The audit row of this doc's write. */
  readonly audit: AuditEntry;
  /**
   * Rule ids whose registry row goes back to `proposed` in the same transaction (owned by this doc, which no longer
   * lists them: the reverse of a "never landed" retirement, BR-1307). Absent: the registry follows the leaf.
   */
  readonly propose_rules?: readonly string[];
}

export interface ProvenanceWriteExtras {
  /**
   * Further doc updates (each with its version and audit row) committed in the SAME transaction, after the primary
   * write. Any failure rolls back the primary write and every companion. InMemoryStore restores its snapshots.
   */
  also_update?: readonly CompanionDocWrite[];
  /**
   * Rule ids that MUST be `live` when the write commits. Read from `rule_registry.lifecycle`
   * (migration-014) in the SAME transaction as the doc write (InMemoryStore: the baseline leaf docs).
   * A non-live id returns `AC_CITE_REQUIRED` (its violations name the ids) and NOTHING is written.
   */
  require_live_rules?: readonly string[];
  /** Further audit entries appended in the SAME transaction (e.g. the gate's would-refuse row). */
  also_audit?: readonly AuditEntry[];
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
  /**
   * A `knowledge` document's `extra.sub_type`, as a RETRIEVAL predicate —
   * surfaced as `lore list --sub-type <v>` / `lore search --sub-type <v>` and
   * the matching HTTP fields.
   *
   * ⛔ **Every implementation MUST apply this IN THE QUERY, never as a filter
   * over already-fetched rows.** `sub_type` lives in the untyped `extra` JSON
   * column, so SQLite/libsql express it as
   * `json_extract(extra, '$.sub_type') = ?` — BOUND as a parameter, never
   * string-interpolated (the same non-negotiable bind-protocol rule
   * {@link StoreFilters.limit} and {@link AuditFilters.limit} document).
   * A predicate applied AFTER the {@link limit}/{@link offset} window would
   * return fewer rows than `limit` asked for while more matches sat past the
   * offset — the paging bug the SQL-side `tags` guard in `findMany` exists to
   * avoid, and the exact mistake AC-RR-5's `--limit 1 --offset 1` oracle is
   * built to fail.
   *
   * @remarks Only `knowledge` docs ever carry `extra.sub_type`, so this
   *   composes with `type: "knowledge"`; the CLI surface REFUSES it
   *   alongside any other `type` (usage error, exit 2) rather than returning a
   *   silently empty set. The store layer itself applies no such cross-field
   *   rule — it is a pure column predicate here, and a caller pairing it with
   *   another type legitimately gets zero rows.
   * @remarks A row whose `extra` is not valid JSON makes `json_extract` raise,
   *   surfacing as `STORE_ERROR`. That is deliberate: a corrupt row is reported
   *   loudly rather than silently excluded from a filtered listing.
   * @see spec-a-write-side-fact-with-no-read-side-address-counts-with-no §Scope M3
   */
  sub_type?: KnowledgeSubType;
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

// ─── Trace Events (SPEC-102) ────────────────────────────────────────────────
// Domain shapes live in store-shared.ts (mirrors AuditChainEntry — the SSOT
// for a row-shape-adjacent type shared by SQLiteStore/TursoStore/InMemoryStore
// is store-shared.ts; this module re-exports so a consumer of
// StoreInterface's trace methods has ONE import surface for both).
export type {
  CheckOutcomeInput,
  CheckOutcomeKind,
  CheckOutcomeStat,
  LeaseAcquisition,
  LeaseRecord,
  PendingAskInput,
  PendingAskRecord,
  TraceDenyByCheckpoint,
  TraceEventInput,
  TraceEventRecord,
  ReadDayCount,
  TraceGateDenyEvent,
  TraceRawSearchQuery,
  TraceStatsWindow,
} from "./store-shared.js";
import type {
  CheckOutcomeInput,
  CheckOutcomeStat,
  LeaseAcquisition,
  LeaseRecord,
  PendingAskInput,
  PendingAskRecord,
  ReadDayCount,
  TraceDenyByCheckpoint,
  TraceEventInput,
  TraceGateDenyEvent,
  TraceRawSearchQuery,
  TraceStatsWindow,
} from "./store-shared.js";

/**
 * One zero-hit search row, as returned by
 * {@link StoreInterface.listTraceZeroHitSearches}.
 *
 * @invariant `query` is ABSENT (the key itself, not an empty string) unless the
 *   caller explicitly opted in via {@link TraceZeroHitListOpts.includeRawQueries}
 *   — the default is the PRIVATE one, so a caller that forgets the option cannot
 *   leak literal search text (SPEC-102 §Security & Privacy, surfaced as
 *   `lore trace stats --raw-queries`). `ts` + `actor` keep every withheld row
 *   addressable by when and who.
 */
export interface TraceZeroHitSearch {
  ts: string;
  actor: string;
  query?: string;
}

/** Options for {@link StoreInterface.listTraceZeroHitSearches}. */
export interface TraceZeroHitListOpts {
  /**
   * `true` includes each row's literal `details.query` text. Absent/`false`
   * withholds it — ⛔ never invert this default; see
   * {@link TraceZeroHitSearch}'s `query` invariant.
   */
  includeRawQueries?: boolean;
}

// ─── Rule registry (migration-013, spec C2) ────────────────────────────────

/**
 * One row of the permanent baseline rule-id registry. `id` is `"<prefix>-<n>"` with prefix
 * `BR` (business rule), `AS` (architecture standard rule) or `AD` (architecture debt entry);
 * `n` is UNIQUE per prefix, strictly increasing within it and never reissued — rows are never
 * deleted, so an id stays burned after its rule is deprecated, retired or its
 * leaf is soft-deleted.
 */
export interface RuleRegistryRow {
  id: string;
  n: number;
  /** Current owning leaf doc id (updated by {@link StoreInterface.moveRule}). */
  leaf_doc_id: DocId;
  /** ISO 8601 allocation time. */
  allocated_at: string;
  /** Actor identity that allocated the id. */
  allocated_by: string;
  /**
   * The rule's state: its lifecycle in its owning leaf (migration-014, kept in the same transaction as the leaf
   * write), or `proposed` (migration-018) — reserved by a spec's change set, listed by no leaf.
   */
  lifecycle: RuleRegistryState;
  /** The owning leaf doc's `version` (migration-014); kept in the same transaction as the leaf write. */
  version: number;
}

/** One `ac_exemptions` row (migration-014): criterion `ac_id` of spec `doc_id` is excused from the citation gate. */
export interface AcExemptionRow {
  doc_id: DocId;
  ac_id: string;
  /** Non-blank justification. */
  reason: string;
  /** ISO 8601 (`toISOString()` form) instant at which the exemption stops counting as active. */
  expires_at: string;
  /** Actor identity that granted it. */
  granted_by: string;
  /** ISO 8601 grant time. */
  granted_at: string;
}

/** Cap input of {@link StoreInterface.insertAcExemptionCapped}. */
export interface AcExemptionCap {
  /** Live criteria count the cap was derived from (named in the refusal message). */
  liveCriteria: number;
  /** Largest number of ACTIVE (unexpired) exemptions allowed after the insert. */
  maxActive: number;
  /** ISO 8601 instant: a row is active iff `expires_at > now` and it is not in `satisfied`. */
  now: string;
  /**
   * `exemptionKey`s of exemptions whose criterion now cites a live rule (state `satisfied`, not counted
   * against the cap). Absent = none known; production callers always pass it (see `loadExemptionContext`).
   */
  satisfied?: ReadonlySet<string>;
}

/** One `ac_exemptions` row (migration-014): criterion `ac_id` of spec `doc_id` is excused from the citation gate. */
export interface AcExemptionRow {
  doc_id: DocId;
  ac_id: string;
  /** Non-blank justification. */
  reason: string;
  /** ISO 8601 (`toISOString()` form) instant at which the exemption stops counting as active. */
  expires_at: string;
  /** Actor identity that granted it. */
  granted_by: string;
  /** ISO 8601 grant time. */
  granted_at: string;
}

/** Cap input of {@link StoreInterface.insertAcExemptionCapped}. */
export interface AcExemptionCap {
  /** Live criteria count the cap was derived from (named in the refusal message). */
  liveCriteria: number;
  /** Largest number of ACTIVE (unexpired) exemptions allowed after the insert. */
  maxActive: number;
  /** ISO 8601 instant: a row is active iff `expires_at > now` and it is not in `satisfied`. */
  now: string;
  /**
   * `exemptionKey`s of exemptions whose criterion now cites a live rule (state `satisfied`, not counted
   * against the cap). Absent = none known; production callers always pass it (see `loadExemptionContext`).
   */
  satisfied?: ReadonlySet<string>;
}

/** One `ac_cites` index row (migration-014): spec `doc_id`'s criterion `ac_id` cites rule `rule_id`. */
export interface AcCiteRow {
  doc_id: DocId;
  ac_id: string;
  rule_id: string;
}

/** One `rule_depends` index row (migration-014): baseline leaf `leaf_id` depends on rule `rule_id`. */
export interface RuleDependsRow {
  leaf_id: DocId;
  rule_id: string;
}

/** One leaf's CAS patch for {@link StoreInterface.moveRule}. */
export interface RuleLeafPatch {
  id: DocId;
  /** CAS guard: the leaf's `version` the caller read. */
  expectedVersion: number;
  /** The leaf's NEW `extra` (already reflecting the removal / append). */
  extra: Record<string, unknown>;
  /**
   * Harness run stamped on the leaf's `action: "update"` version row (migration-016); absent/null =
   * unattested. Set by `withWriteContext` — never by a service (the store builds this version row
   * itself, so the decorator cannot reach it through a `VersionRecord` argument).
   */
  harness_run?: string | null;
  /** New status of the written doc (a spec demoted by a contract edit); absent = unchanged. */
  status?: DocStatus;
  /** `change_summary` of the `action: "update"` version row; absent = none. */
  change_summary?: string;
  /** The DecisionRecord stored on that version row (migration-041); absent = none. */
  decision?: DecisionRecord;
}

/**
 * The spec write that {@link StoreInterface.reserveProposedRuleAndUpdateSpec} commits together with the
 * reservation of a `proposed` rule id.
 */
export interface ProposedRuleWrite {
  /** The SPEC whose `extra.rule_changes` receives the new `add` entry. */
  specId: DocId;
  /** CAS guard: the spec's `version` the caller read. */
  expectedVersion: number;
  /** Pure builder of the spec's new `extra` given the reserved id. */
  buildExtra: (ruleId: string) => Record<string, unknown>;
  /** The leaf the rule will land on at apply time; stored as the registry row's `leaf_doc_id`. */
  ownerLeafId: DocId;
  /** New spec status (e.g. approved -> draft demotion); absent = unchanged. */
  status?: DocStatus;
  /** `change_summary` of the spec's version row. */
  changeSummary?: string;
  /** The DecisionRecord stored on the spec's version row (migration-041); absent = none. */
  decision?: DecisionRecord;
}

/**
 * The spec write that {@link StoreInterface.repointProposedRuleAndUpdateSpec} commits together with moving a
 * `proposed` rule id's registry row to another leaf.
 */
export interface ProposedRuleRepointWrite {
  /** The SPEC whose `extra.rule_changes` entry names the new leaf. */
  specId: DocId;
  /** CAS guard: the spec's `version` the caller read. */
  expectedVersion: number;
  /** The spec's new `extra` (already carrying the entry's new leaf). */
  extra: Record<string, unknown>;
  /** The `proposed` rule id whose registry row moves. */
  ruleId: string;
  /** The leaf the rule will now land on; becomes the registry row's `leaf_doc_id`. */
  toLeafId: DocId;
  /** New spec status (e.g. approved -> draft demotion); absent = unchanged. */
  status?: DocStatus;
  /** `change_summary` of the spec's version row. */
  changeSummary?: string;
  /** The DecisionRecord stored on the spec's version row (migration-041); absent = none. */
  decision?: DecisionRecord;
}

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
   * CLI/HTTP and not for any other caller — `insertWithAllocatedOrdinal`/
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

  /**
   * {@link assignOrdinalForRepair} in ONE transaction with the version row and the audit row it owes
   * (spec-no-module-writes-around-the-write-path D3): a failure of the version or audit insert rolls the
   * ordinal write back, so the doc keeps its previous ordinal and version. A same-value repeat is the same
   * idempotent no-op as the bare method (nothing written, the doc returned unchanged). `version.version` must
   * be the stored version + 1, else `STALE_VERSION` and nothing is written.
   *
   * @param id - Doc id to assign an ordinal to.
   * @param ordinal - The EXACT target value.
   * @param version - The post-assignment version snapshot (`doc.version + 1`).
   * @param audit - The audit entry of the assignment.
   */
  assignOrdinalForRepairWithProvenance(
    id: DocId,
    ordinal: number,
    version: VersionRecord,
    audit: AuditEntry,
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
   * @param snapshot - REQUIRED, no default. `true`: insert `version` as a `versions` row. `false`: same CAS, same
   *   version raise, same audit row, but NO `versions` row (a working-state-only write; the caller decides, the
   *   store never classifies content — adr-a-history-entry-records-content-working-state-is-recorded D1/D3).
   *   Everything lands in the one transaction either way.
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
    snapshot: boolean,
    extras?: ProvenanceWriteExtras,
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

  // ── Rule registry (migration-013, spec C2) ─────────────────────────────

  /**
   * Allocate the next permanent rule id of family `prefix` AND write it into the leaf in ONE
   * write transaction: `n = COALESCE(MAX(n),0)+1` over that prefix's rows (read INSIDE the
   * transaction), insert the registry row, CAS-update the leaf's `extra` to
   * `buildExtra(id)` with `version = expectedVersion + 1`, and insert the
   * matching `action: "update"` version row.
   *
   * Any failure rolls EVERYTHING back — a CAS miss never burns an id.
   *
   * @param leafId - Leaf doc to receive the rule; unknown or soft-deleted → `DOC_NOT_FOUND`.
   * @param expectedVersion - CAS guard; mismatch → `STALE_VERSION`.
   * @param buildExtra - Pure builder of the leaf's new `extra` given the allocated id.
   * @param actor - Recorded as `allocated_by` and the version row's `created_by`.
   * @param prefix - The id family (`BR` business leaf, `AS` architecture standard, `AD` debt registry);
   *   each family numbers from 1 independently (migration-015). Defaults to `BR`, the original family.
   * @param harnessRun - Harness run stamped on the leaf's version row (migration-016); absent/null = unattested.
   *   Supplied only by `withWriteContext`.
   * @param decision - The DecisionRecord stored on the leaf's version row (migration-041); absent/null = none.
   * @returns `{ ruleId, doc }` (the updated leaf) or a loud error; never a duplicate id.
   */
  allocateRuleAndUpdateLeaf(
    leafId: DocId,
    expectedVersion: number,
    buildExtra: (ruleId: string) => Record<string, unknown>,
    actor: string,
    prefix?: RuleIdPrefix,
    harnessRun?: string | null,
    decision?: DecisionRecord | null,
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>>;

  /**
   * Reserve the next permanent rule id of family `prefix` in registry state `proposed` AND write it into a
   * SPEC's change set in ONE write transaction (spec-a-spec-carries-its-rule-changes-the-baseline-takes-them):
   * `n = COALESCE(MAX(n),0)+1` over that prefix's rows (read INSIDE the transaction), CAS-update the spec's
   * `extra` to `write.buildExtra(id)` (+ optional status), insert the spec's `action: "update"` version row,
   * insert the registry row with `lifecycle = 'proposed'`, `leaf_doc_id = write.ownerLeafId`. NO leaf is
   * touched. Any failure rolls EVERYTHING back — a CAS miss never burns an id.
   *
   * @param write - the spec write and the leaf the rule will land on; unknown/soft-deleted spec → `DOC_NOT_FOUND`;
   *   version mismatch → `STALE_VERSION`.
   * @param actor - Recorded as `allocated_by` and the version row's `created_by`.
   * @param prefix - id family; the change set is business-only today, so callers pass `BR` (the default).
   * @param harnessRun - Harness run stamped on the spec's version row (migration-016); supplied only by `withWriteContext`.
   * @returns `{ ruleId, doc }` (the updated spec) or a loud error; never a duplicate id.
   */
  reserveProposedRuleAndUpdateSpec(
    write: ProposedRuleWrite,
    actor: string,
    prefix?: RuleIdPrefix,
    harnessRun?: string | null,
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>>;

  /**
   * Re-point a `proposed` rule id at another leaf AND write the spec's change set in ONE write transaction:
   * CAS-update the spec's `extra` to `write.extra` (+ optional status), insert its `action: "update"` version
   * row, set `rule_registry.leaf_doc_id = write.toLeafId` (and `version` to that leaf's current one). NO leaf is
   * touched. Any failure rolls EVERYTHING back.
   *
   * @param write - the spec write and the new owner leaf; unknown/soft-deleted spec or target leaf, or an id with
   *   no registry row → `DOC_NOT_FOUND`; a registry row that is not `proposed` → `VALIDATION_ERROR`; version
   *   mismatch → `STALE_VERSION`.
   * @param actor - Recorded as the version row's `created_by`.
   * @param harnessRun - Harness run stamped on the spec's version row; supplied only by `withWriteContext`.
   * @returns the updated spec, or a loud error.
   */
  repointProposedRuleAndUpdateSpec(
    write: ProposedRuleRepointWrite,
    actor: string,
    harnessRun?: string | null,
  ): Promise<Result<DocRecord, LoreError>>;

  /**
   * Move a rule between leaves in ONE write transaction: CAS-update both
   * leaves (one `action: "update"` version row each) and set
   * `rule_registry.leaf_doc_id = toLeaf.id`. Id and `n` are unchanged. Any
   * failure (either CAS, a version-row insert, unknown `ruleId` →
   * `DOC_NOT_FOUND`) leaves both leaves and the registry row exactly as before.
   */
  /** @lore-site BR-647 */
  moveRule(
    ruleId: string,
    fromLeaf: RuleLeafPatch,
    toLeaf: RuleLeafPatch,
    actor: string,
  ): Promise<Result<{ from: DocRecord; to: DocRecord }, LoreError>>;

  /** All registry rows ordered by `n` ASC. There is deliberately no delete method. */
  listRuleRegistry(): Promise<Result<RuleRegistryRow[], LoreError>>;

  /**
   * Every `ac_cites` row (migration-014), sorted by (doc_id, ac_id, rule_id). Written in the SAME
   * transaction as the citing spec; `InMemoryStore` serves the equivalent computed view. The citation
   * gate and `computeBaselineStatus` (`index_mismatch`) read this — never repaired on read.
   */
  listAcCites(): Promise<Result<AcCiteRow[], LoreError>>;

  /** Every `rule_depends` row (migration-014), sorted by (leaf_id, rule_id); same contract as {@link listAcCites}. */
  listRuleDepends(): Promise<Result<RuleDependsRow[], LoreError>>;

  /**
   * Insert one `ac_exemptions` row under the cap in ONE write transaction (count active rows, then
   * insert only if `count < cap.maxActive`), so concurrent grants never exceed the cap. An EXPIRED row
   * for the same (doc_id, ac_id) is replaced (renewal); an ACTIVE one is refused.
   *
   * @returns the inserted row; `VALIDATION_ERROR` (message names the 10% cap) when full or already active.
   */
  insertAcExemptionCapped(row: AcExemptionRow, cap: AcExemptionCap): Promise<Result<AcExemptionRow, LoreError>>;

  /** Every `ac_exemptions` row (active and expired), sorted by (doc_id, ac_id). */
  listAcExemptions(): Promise<Result<AcExemptionRow[], LoreError>>;

  /**
   * Insert one `ac_exemptions` row under the cap in ONE write transaction (count active rows, then
   * insert only if `count < cap.maxActive`), so concurrent grants never exceed the cap. An EXPIRED row
   * for the same (doc_id, ac_id) is replaced (renewal); an ACTIVE one is refused.
   *
   * @returns the inserted row; `VALIDATION_ERROR` (message names the 10% cap) when full or already active.
   */
  insertAcExemptionCapped(row: AcExemptionRow, cap: AcExemptionCap): Promise<Result<AcExemptionRow, LoreError>>;

  /** Every `ac_exemptions` row (active and expired), sorted by (doc_id, ac_id). */
  listAcExemptions(): Promise<Result<AcExemptionRow[], LoreError>>;

  // ── Links ──────────────────────────────────────────────────────────────

  /**
   * Add a directed link.
   * Fails with DUPLICATE_LINK if (from_id, to_id, link_type) already exists.
   * For link_type='parent': validates no cycle in the parent tree.
   */
  addLink(link: LinkRecord): Promise<Result<LinkRecord, LoreError>>;

  /**
   * Atomically add a directed link, apply the link's `docs.parent_id` side effect, and append its
   * {@link AuditEntry} — all-or-none (#123 / debt AD-13; `CorpusService._linkImpl`'s write).
   *
   * Replaces the pre-existing three-independent-`await` sequence (`addLink` → `update` →
   * `appendAuditEntry`): a failure on step 2 or 3 left the link row (and `parent_id`) persisted while
   * the command reported an error. On ANY failure nothing is observable afterward — the link table,
   * the from-doc's `parent_id`/`updated_at` and the audit log are exactly as before, and the SAME error
   * the individual writes return comes back (`LINK_CYCLE`, `DUPLICATE_LINK`, `DOC_NOT_FOUND`,
   * `STORE_ERROR`) — never a new error shape.
   *
   * For `link_type === "parent"` the from-doc's `parent_id` becomes `link.to_id` and its `updated_at`
   * becomes `link.created_at` (the same patch the service wrote itself before); for every other link
   * type only the link row and the audit entry are written. A link is audit-only — no `versions` row.
   * {@link addLink} stays independently callable (unchanged contract) for `TreeCheckService`'s
   * reconciliation.
   *
   * @param link - The link to add (same contract as {@link addLink})
   * @param audit - The `action: "link"` audit entry (same contract as {@link appendAuditEntry})
   * @returns `ok(link)` on success
   */
  addLinkWithProvenance(link: LinkRecord, audit: AuditEntry): Promise<Result<LinkRecord, LoreError>>;

  /**
   * Set or clear a doc's `parent_id` and append ONE audit entry, all in a single write transaction
   * (BR-1009: the spec-parent migration and its revert). Either every step lands or none does.
   *
   * With `parentId === null` the doc's outgoing `parent` link row (if any) is deleted in the same
   * transaction, so the column and the link table never disagree. With a non-null `parentId` only the
   * column is written (a revert restores the column; link rows are never recreated here — use
   * {@link addLinkWithProvenance} for that). The doc's `updated_at` becomes `audit.timestamp`; its
   * `version`, `status`, content and judgments are untouched and NO `versions` row is written — an
   * approved doc stays approved and its review judgment stays current.
   *
   * @param id - The doc whose parent changes
   * @param parentId - The new parent id, or `null` to clear it
   * @param audit - The single audit entry to append (e.g. `migrate_spec_parent`)
   * @returns `ok(updatedDoc)`; `DOC_NOT_FOUND` when `id` is absent (nothing written); `STORE_ERROR` otherwise
   */
  /** @lore-site BR-1009 */
  setDocParentWithProvenance(
    id: DocId,
    parentId: DocId | null,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>>;

  /** Remove a specific directed link by composite key. */
  /** @lore-site BR-763 */
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
  /** @lore-site BR-749 */
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
   * @param since - ISO 8601; omit for no lower bound (all versions ever)
   * @see PLAN task D (SPEC-035) — audit surface
   */
  listAllVersions(since?: string): Promise<Result<VersionRecord[], LoreError>>;

  /**
   * The narrow twin of {@link listAllVersions} for {@link AuditService.verify}'s completeness join: only the four
   * columns the join uses — `(doc_id, version, action, created_at)` — for every version row with
   * `created_at >= since`, oldest first. A versions row stores its full `content` and `extra` snapshot, which the
   * join never reads; this read never touches them, so its cost does not grow with how large the stored documents
   * are. SQLite stores answer it from the covering index of migration-025.
   *
   * @param since - ISO 8601 inclusive lower bound; omit for every version row
   */
  listVersionKeys(since?: string): Promise<Result<VersionKey[], LoreError>>;

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

  /**
   * Append ONE autonomy decision record (AC-AU-2). The store reads the chain head and inserts the row inside
   * ONE write transaction, so two processes appending at once both land and the chain stays intact; hashes are
   * computed here, never supplied by the caller. Append-only: no update or delete method exists.
   */
  appendDecisionRecord(input: DecisionRecordInput): Promise<Result<DecisionLogRow, LoreError>>;

  /**
   * Decision-log rows in `id` ASC order, WITH hash fields. Optional `subject` narrows to one
   * (class, subject_id, subject_version) — chain verification must call it WITHOUT a filter.
   */
  listDecisionLog(subject?: DecisionSubjectKey): Promise<Result<DecisionLogRow[], LoreError>>;

  /**
   * The ONE governed autonomy threshold record (migration-022, AC-AU-9), or null when it was never written. `content`
   * is the exact canonical JSON text that was hashed into the decision log; it is never re-serialised on read.
   */
  readAutonomyThresholds(): Promise<Result<{ readonly content: string; readonly updated_at: string } | null, LoreError>>;

  /**
   * Replace the governed record's text. ONLY service/autonomy-threshold-service.ts calls this, and only right after it
   * appended the decision-log row that carries this content's hash — a caller that skips that step produces exactly
   * the mismatch the integrity check reports.
   */
  writeAutonomyThresholds(content: string, updatedAt: string): Promise<Result<void, LoreError>>;

  /**
   * Every audit row whose `action` equals `action` (optionally only for one doc), in `id` ASC
   * order, WITH its `id` — the read the state-binding arming cutoff and the per-row evidence
   * audit join are built on (SPEC-143 AC-CT-3). Narrow on purpose: {@link listAuditChain} reads
   * the whole table and {@link queryAudit} drops the `id`.
   */
  listAuditRowsByAction(action: string, docId?: DocId): Promise<Result<AuditChainEntry[], LoreError>>;

  /**
   * `MAX(audit.id)`, or `0` for an empty audit table — the corpus state an evidence row is
   * written against (`recorded_corpus_rev`, SPEC-143 AC-CT-3). A rightmost-B-tree read, free
   * regardless of corpus size.
   */
  getAuditHeadId(): Promise<Result<number, LoreError>>;

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
  /** @lore-site BR-277 */
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
  /** @lore-site BR-556 */
  queryCalibrationWindow(
    filter: CalibrationWindowFilter,
  ): Promise<Result<CalibrationRecordWithPromptVersion[], LoreError>>;

  // ── Trace Events (SPEC-102) ─────────────────────────────────────────────
  // Fire-and-forget contract: `insertTraceEvent`'s Result IS returned (never
  // silently swallowed by the store itself — StoreInterface methods always
  // report their outcome), but the CALLER (`TraceRecorder`, a later task) is
  // the one that ignores a failed write rather than propagating it into the
  // traced operation's own Result. Never hash-chained (unlike `audit`), never
  // replicated to Turso (D3 — absent from `sync-push.ts`'s REPLICATED_TABLES).

  /** Insert one trace_events row. Never fails the caller's traced operation — see the section header. */
  insertTraceEvent(event: TraceEventInput): Promise<Result<void, LoreError>>;

  /** Row counts grouped by `kind`, since `window.since` (idx_trace_kind_ts). Absent kinds are omitted (never present with 0). */
  countTraceEventsByKind(window: TraceStatsWindow): Promise<Result<Record<string, number>, LoreError>>;

  /** `gate_deny` row counts grouped by `(checkpoint, details.layer)`, since `window.since` (idx_trace_kind_ts + checkpoint column; SPEC-102 D7 layer disambiguation). */
  countTraceDenyByCheckpoint(window: TraceStatsWindow): Promise<Result<TraceDenyByCheckpoint[], LoreError>>;

  /**
   * Every `kind='search'` row with `hit_count = 0` since `window.since`
   * (idx_trace_kind_ts), newest first — the MEMBER LIST behind
   * `lore trace stats`'s `zero_hit_search_count`.
   *
   * @param opts - Privacy control; ⛔ omitting it WITHHOLDS literal query text
   *   (see {@link TraceZeroHitListOpts}).
   * @see spec-a-write-side-fact-with-no-read-side-address-counts-with-no §Scope M1
   */
  listTraceZeroHitSearches(
    window: TraceStatsWindow,
    opts?: TraceZeroHitListOpts,
  ): Promise<Result<TraceZeroHitSearch[], LoreError>>;

  /**
   * Count of `kind='search'` rows with `hit_count = 0`, since `window.since`.
   *
   * ⛔ DERIVED from {@link listTraceZeroHitSearches}'s length in EVERY
   * implementation — never a second `COUNT(*)`. A count computed independently
   * of the list it summarises can drift from that list and nothing would
   * notice, which is the exact defect M1 removes; keep the derivation.
   */
  countTraceZeroHitSearches(window: TraceStatsWindow): Promise<Result<number, LoreError>>;

  /**
   * Add one read to the per-day counter for `day` (`YYYY-MM-DD`, UTC) with ONE atomic upsert
   * (`INSERT ... ON CONFLICT(day) DO UPDATE SET count = count + 1`), so concurrent readers lose nothing.
   * A read writes no `trace_events` row (BR-1373).
   */
  incrementReadCount(day: string): Promise<Result<void, LoreError>>;

  /** Per-day read counts for days at/after `sinceDay` (`YYYY-MM-DD`), oldest day first. Days with no reads are absent. */
  listReadCounts(sinceDay: string): Promise<Result<ReadDayCount[], LoreError>>;

  /**
   * Takes the named lease for `holder` with ONE atomic upsert that succeeds only when no row exists, the row has
   * expired (`expires_at <= nowIso`) or the row is already `holder`'s (BR-1379 review batch lease). `tookOver` is
   * true when an expired row of another holder was replaced. A live lease of another holder is `acquired: false`.
   */
  acquireLease(name: string, holder: string, nowIso: string, expiresAtIso: string): Promise<Result<LeaseAcquisition, LoreError>>;

  /** Moves `holder`'s lease expiry forward; `ok(false)` when the row is no longer `holder`'s (it expired and was taken over). */
  renewLease(name: string, holder: string, expiresAtIso: string): Promise<Result<boolean, LoreError>>;

  /** Deletes `holder`'s lease row (a no-op when it is not the holder's). */
  releaseLease(name: string, holder: string): Promise<Result<void, LoreError>>;

  /** The lease row as stored, expired or not; `null` when absent. */
  readLease(name: string): Promise<Result<LeaseRecord | null, LoreError>>;

  /**
   * Append one `check_outcomes` row per element of `rows` in ONE write (migration-033, BR-1373). Append-only:
   * there is no update or delete. An empty array writes nothing.
   */
  appendCheckOutcomes(rows: readonly CheckOutcomeInput[]): Promise<Result<void, LoreError>>;

  /** One aggregate per check id (runs, denials, errors, first/last run, last denial), ordered by check id. */
  listCheckOutcomeStats(): Promise<Result<CheckOutcomeStat[], LoreError>>;

  /**
   * Record the question lore issued for a pending decision with its single-use nonce (migration-034, BR-1374).
   * Append-only; a duplicate nonce is a STORE_ERROR (the nonce column is UNIQUE).
   */
  issuePendingAsk(input: PendingAskInput): Promise<Result<void, LoreError>>;

  /** The ask issued under `nonce`, or null when none exists. `is_latest` is computed against the decision's newest ask. */
  readPendingAsk(nonce: string): Promise<Result<PendingAskRecord | null, LoreError>>;

  /**
   * Marks the ask under `nonce` used at `usedAt` iff it was not used yet. Resolves true when THIS call consumed it,
   * false when it was already used or does not exist (single use, safe against a concurrent second hook run).
   */
  consumePendingAsk(nonce: string, usedAt: string): Promise<Result<boolean, LoreError>>;

  /** Every `gate_deny` row since `window.since`, for the deny→retry-success gap's read-side audit join (idx_trace_kind_actor). Computed by the caller — never stored. */
  listTraceGateDenies(window: TraceStatsWindow): Promise<Result<TraceGateDenyEvent[], LoreError>>;

  /** Raw `details.query` text for every `kind='search'` row since `window.since` — ONLY consulted behind `--raw-queries` (SPEC-102 §Security & Privacy). */
  listTraceRawSearchQueries(window: TraceStatsWindow): Promise<Result<TraceRawSearchQuery[], LoreError>>;

  /**
   * One BOUNDED batch delete of rows older than `cutoffIso`
   * (`DELETE WHERE id IN (SELECT id FROM trace_events WHERE ts < ? LIMIT
   * batchSize)`, idx_trace_ts) — the CALLER loops this until it returns 0
   * (SPEC-102 §Migration Strategy "retention prune"), this method itself
   * runs exactly one batch, never an unbounded DELETE.
   *
   * @param cutoffIso - ISO 8601; rows with `ts < cutoffIso` are eligible.
   * @param batchSize - Max rows deleted by this call. Default 50000.
   * @returns `ok(count)` — rows actually deleted by this one batch (0 means
   *   nothing left to prune, the caller's loop-termination signal).
   */
  pruneTraceEvents(cutoffIso: string, batchSize?: number): Promise<Result<number, LoreError>>;

  // ── Runs (migration-016, spec-run-identity-slice-1 D3/D4) ───────────────

  /**
   * Register a harness run. IDEMPOTENT and FIRST-WINS: a second call with the same `run.id` returns
   * `ok` and changes nothing — every column keeps the first call's value (a re-registration with a
   * different parent or branch must never rewrite history).
   */
  /** @lore-site BR-1029 */
  insertRun(run: RunRecord): Promise<Result<void, LoreError>>;

  /** The registered run, or `ok(null)` for an unknown id (same shape as `find`; never a fabricated record). */
  getRun(id: RunId): Promise<Result<RunRecord | null, LoreError>>;

  /**
   * Every registered run whose `agent_ref` equals `agentRef` (a resumed agent can register more than one run id
   * across sessions), newest `registered_at` first, ties broken by `id` ASC. `ok([])` when none. Consumed by
   * `RunService.occupancy` (spec-worktree-removal-is-decided-by-who-is-inside-not-by-how D1).
   */
  listRunsByAgentRef(agentRef: string): Promise<Result<RunRecord[], LoreError>>;

  /**
   * Mark a run ended (migration-017). FIRST END WINS: a run already ended keeps its `ended_at` / `end_reason`
   * (`already-ended`); an unregistered id writes nothing (`unknown-run`, normal for SubagentStop of an
   * internal agent).
   */
  /** @lore-site BR-1215 */
  endRun(id: RunId, endedAt: string, reason: string): Promise<Result<RunEndOutcome, LoreError>>;

  /** Clear `ended_at` / `end_reason` (a resumed helper registered again). `ok(true)` iff the run WAS ended. */
  /** @lore-site BR-1029 */
  reopenRun(id: RunId): Promise<Result<boolean, LoreError>>;

  /** The run's end state, or `ok(null)` for an unregistered id. */
  getRunEnd(id: RunId): Promise<Result<RunEndState | null, LoreError>>;

  /**
   * Record the OS process a run lives in (migration-021). NEWEST WINS — unlike the identity columns, a resumed run
   * lives in a NEW process, so a re-registration overwrites the previous pid. `ok(false)` for an unregistered id.
   */
  recordRunProcess(id: RunId, process: RunProcessRecord): Promise<Result<boolean, LoreError>>;

  /**
   * Record the address another session can message a run at (migration-030, BR-1360). UNCONDITIONAL and NEWEST WINS:
   * called on EVERY register, so a resume replaces the address and an absent one (`null`) clears it. Never part of
   * {@link StoreInterface.insertRun} (first wins). `ok(false)` for an unregistered id.
   */
  recordRunAddress(id: RunId, address: string | null): Promise<Result<boolean, LoreError>>;

  /** Every registered run, oldest `registered_at` first (ties by id), with its end state and recorded process. */
  listRunLifecycles(): Promise<Result<RunLifecycle[], LoreError>>;

  /**
   * Count audit rows with `timestamp >= windowStart` (INCLUSIVE, ISO 8601) whose `action` is one of
   * `kinds`, split into `total` and `attested` (`harness_run IS NOT NULL`). Consumed by the attribution
   * share in `lore status` (AC-RID-11). Empty `kinds` → `VALIDATION_ERROR` (a count over nothing is a
   * caller bug, never a silent zero).
   */
  countAttributedWrites(
    windowStart: string,
    kinds: readonly string[],
  ): Promise<Result<AttributedWriteCount, LoreError>>;

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

  /**
   * Highest `version` among live (non-soft-deleted) docs of ANY type; `0` for an
   * empty corpus.
   *
   * A pure aggregate (`SELECT MAX(version)` in the SQL stores) that parses no
   * document. `RuleStateService` uses it for `computed_from.corpus_version` so its
   * snapshot can skip fetching knowledge docs without changing that field's meaning.
   */
  /** @lore-site BR-669 */
  maxDocVersion(): Promise<Result<number, LoreError>>;
}
