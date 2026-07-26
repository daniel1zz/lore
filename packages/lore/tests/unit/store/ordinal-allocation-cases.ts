/**
 * SHARED case table for the SPEC-084 ordinal-allocation contract suite.
 *
 * This module is NOT itself a test file (no `.test.ts` / `.bun.test.ts`
 * suffix) and imports NOTHING from a test runner — it is plain data, the
 * single SSOT both contract-suite runners iterate:
 *   - `ordinal-allocation.contract.bun.test.ts` (SQLiteStore, `bun test`)
 *   - `ordinal-allocation.contract.test.ts` (InMemoryStore, vitest)
 *
 * Mechanical parity (AC-084-2): both files import `ORDINAL_ALLOCATION_CASES`
 * and generate one `it()` per entry via the SAME loop shape; the vitest twin
 * additionally asserts the number of generated tests equals
 * `ORDINAL_ALLOCATION_CASES.length`, and that length is checked against the
 * independent `EXPECTED_ORDINAL_ALLOCATION_CASE_COUNT` constant below — so a
 * silently-shrunk table (or a silently-filtered iteration loop) fails loud
 * instead of a vacuous 0-cases-passed run.
 *
 * ─── Design note: the TRUE forceability boundary (corrected 2026-07-27) ───
 * An EARLIER version of this note claimed a bounded-retry loop that computes
 * its starting candidate ONCE and never re-queries mid-loop would let a
 * pre-inserted row force an observable collision. That claim was WRONG, and
 * self-contradicted this same file's `cross_type_coexistence` case (SPEC-084
 * D2/D9, confirmed by orchestrator adjudication after re-reading the spec):
 * `base` is `MAX(ordinal WHERE type=?)` read LIVE over the SAME partial
 * index the `(type, ordinal)` UNIQUE constraint enforces (D9: includes
 * soft-deleted rows) — so ANY row visible to that index, including one
 * inserted moments earlier via the store's plain `insert()` bypass, is ALSO
 * visible to this MAX read. `MAX(ordinal)+1` is therefore, BY CONSTRUCTION,
 * NEVER already taken by an existing row of that type. Pre-inserting rows
 * before calling `insertWithAllocatedOrdinal`/`allocateOrdinalForExisting`
 * can shift WHERE the next free slot lands (exercised by
 * `forced_collision_lands_next_free` and `cross_type_coexistence` below,
 * both asserting an OBSERVABLE landing position only) but can NEVER force
 * the bounded retry loop to actually collide — "exhaustion via external
 * pre-insertion" is structurally unobservable under a single connection,
 * confirmed empirically: both runners land at `MAX+1` immediately whenever
 * this was tried, never exhausting.
 *
 * This is deliberately NOT "fixed" by making `base` stale/cached across
 * calls — that would (a) produce FALSE exhaustion in production the moment
 * real pre-existing corpus data occupies the low end of a type's ordinal
 * range, and (b) contradict SPEC-084 D2's literal "MAX+1 over the partial
 * index" text (rejecting a counters-table/cached-sequence design). The
 * store implementation is correct as written; only this design note (and
 * the `retry_exhaustion` case's mechanics below) needed correcting.
 *
 * `retry_exhaustion` therefore exercises the bounded-retry budget and
 * exhaustion shape at the ONLY seam where it is honestly observable: it
 * drives `allocateWithBoundedRetry` (`store-shared.ts`) DIRECTLY with an
 * injected `tryAttempt` that always reports `{kind: "collision"}`, asserts
 * the injected fn was called exactly `ORDINAL_ALLOCATION_MAX_ATTEMPTS`
 * times, and asserts the resulting `err(STORE_ERROR)` whose message
 * contains `ORDINAL_ALLOCATION_EXHAUSTED` — no fake concurrency, no
 * test-only hook added to either store class's public surface. The other
 * five cases still exercise the real `SQLiteStore`/`InMemoryStore` methods
 * end-to-end (they assert landing positions, never exhaustion).
 *
 * @spec_ref AC-084-1, AC-084-2 (SPEC-084 §Test Plan "Contract suite")
 */

/** The two `ORDINAL_REGISTRY`-numbered doc types this suite exercises. */
export type OrdinalCaseDocType = "spec" | "adr";

export type OrdinalAllocationCaseKind =
  /** Pre-insert ONE colliding slot → the allocator lands on the next free ordinal. */
  | "forced_collision_lands_next_free"
  /** Drives `allocateWithBoundedRetry` directly with an injected always-colliding
   *  `tryAttempt` → asserts exactly `ORDINAL_ALLOCATION_MAX_ATTEMPTS` calls and a
   *  loud `ORDINAL_ALLOCATION_EXHAUSTED` error (see this file's design note above
   *  for why external pre-insertion can never observe this). */
  | "retry_exhaustion"
  /** A soft-deleted doc's ordinal is never handed to a later create of the same type. */
  | "soft_deleted_ordinal_never_reused"
  /** SPEC-5 and ADR-5 coexist — the partial unique index is (type, ordinal)-scoped. */
  | "cross_type_coexistence"
  /** Two exempt-kind docs (NULL ordinal) of the same type never collide. */
  | "exempt_kind_null_ordinal_no_collision"
  /** Exempt→numbered kind flip via `allocateOrdinalForExisting`; refuses a row that
   *  already carries an ordinal; CAS mismatch surfaces STALE_VERSION. */
  | "exempt_to_numbered_kind_flip";

export interface OrdinalAllocationCase {
  readonly name: string;
  readonly kind: OrdinalAllocationCaseKind;
  /** Primary doc type this case allocates for. */
  readonly docType: OrdinalCaseDocType;
}

export const ORDINAL_ALLOCATION_CASES: readonly OrdinalAllocationCase[] = [
  {
    name: "forced collision: one pre-inserted (spec, N) row → insertWithAllocatedOrdinal lands at N+1, never reuses N",
    kind: "forced_collision_lands_next_free",
    docType: "spec",
  },
  {
    name: "retry exhaustion: allocateWithBoundedRetry driven directly with an injected always-colliding attempt → exactly 3 attempts, err(STORE_ERROR) containing ORDINAL_ALLOCATION_EXHAUSTED",
    kind: "retry_exhaustion",
    docType: "adr",
  },
  {
    name: "soft-deleted ordinal is never reused by a later create of the same type",
    kind: "soft_deleted_ordinal_never_reused",
    docType: "spec",
  },
  {
    name: "SPEC-5 and ADR-5 coexist — the partial unique index is scoped per (type, ordinal), not global",
    kind: "cross_type_coexistence",
    docType: "spec",
  },
  {
    name: "exempt kind (e.g. domain-overview) — two NULL-ordinal docs of the same type never collide",
    kind: "exempt_kind_null_ordinal_no_collision",
    docType: "spec",
  },
  {
    name: "exempt→numbered kind flip allocates via allocateOrdinalForExisting (UPDATE-scoped, CAS-guarded); refuses a row already carrying an ordinal; stale expectedVersion → STALE_VERSION",
    kind: "exempt_to_numbered_kind_flip",
    docType: "spec",
  },
];

/**
 * Independent redundant expected count — deliberately NOT derived from
 * `ORDINAL_ALLOCATION_CASES.length` itself. A future edit that silently
 * shrinks the table (e.g. an accidental case removal during a merge) must
 * also remember to update this literal, or the vitest twin's count-equality
 * assertion (AC-084-2) fails loud instead of quietly asserting 0 === 0.
 */
export const EXPECTED_ORDINAL_ALLOCATION_CASE_COUNT = 6;
