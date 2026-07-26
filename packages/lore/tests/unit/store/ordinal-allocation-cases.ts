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
 * ─── Design note: how "forced collision" / "retry exhaustion" are forced ───
 * bun:sqlite is a single connection — there is no way to inject a genuine
 * concurrent writer between this call's internal MAX-read and its INSERT
 * (SPEC-084's own text: "the DB constraint IS the race oracle — honest under
 * bun:sqlite's single-connection model, no fake concurrency"). For a
 * DB-constraint violation to be forceable AT ALL from outside the atomic
 * `insertWithAllocatedOrdinal` call, its bounded-retry loop must compute its
 * starting candidate ONCE (`MAX(ordinal) + 1` over ALL rows for that type,
 * including soft-deleted ones per the partial-unique-index design) and then
 * try successive candidates (`+1` each retry) WITHOUT re-querying the table —
 * otherwise a fresh per-attempt MAX query would always self-heal around any
 * pre-inserted row and no violation could ever be observed, no matter how
 * many rows are pre-occupied. This case table's `preInsertOrdinals`/
 * expectations encode exactly that black-box contract:
 *   - pre-occupy 1 slot at (current-max + 1) → first attempt collides,
 *     second attempt (current-max + 2) succeeds → NOT an exhaustion.
 *   - pre-occupy 3 consecutive slots at (current-max + 1..3) → all 3
 *     bounded attempts collide → `ORDINAL_ALLOCATION_EXHAUSTED`.
 * Both contract test files pre-insert these rows via the store's PLAIN
 * `insert()` (bypassing the allocator entirely — simulating rows that exist
 * for reasons other than this allocator call, e.g. the repair migration or a
 * prior allocator call), then call `insertWithAllocatedOrdinal`/
 * `allocateOrdinalForExisting` and assert on the OBSERVABLE result only.
 *
 * @spec_ref AC-084-1, AC-084-2 (SPEC-084 §Test Plan "Contract suite")
 */

/** The two `ORDINAL_REGISTRY`-numbered doc types this suite exercises. */
export type OrdinalCaseDocType = "spec" | "adr";

export type OrdinalAllocationCaseKind =
  /** Pre-insert ONE colliding slot → the allocator lands on the next free ordinal. */
  | "forced_collision_lands_next_free"
  /** Pre-insert THREE consecutive colliding slots → bounded retries exhaust loudly. */
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
    name: "retry exhaustion: three consecutive pre-inserted (adr, N..N+2) rows exhaust the bounded retry budget → err(STORE_ERROR) containing ORDINAL_ALLOCATION_EXHAUSTED",
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
