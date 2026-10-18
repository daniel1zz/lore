/**
 * SPEC-084 ordinal-allocation contract suite — SQLiteStore (bun:sqlite).
 *
 * Runner: bun:sqlite — must run under `bun test`, not vitest (see
 * store/CLAUDE.md "bun:sqlite is external to vitest"). The InMemoryStore
 * twin (`ordinal-allocation.contract.test.ts`) iterates the SAME imported
 * case table under vitest (AC-084-2).
 *
 * T2 (schema migration + store-atomic allocation methods) has landed:
 * `SQLiteStore.insertWithAllocatedOrdinal`/`allocateOrdinalForExisting` are
 * real. Five of the six cases below exercise them end-to-end; the
 * `retry_exhaustion` case exercises the shared `allocateWithBoundedRetry`
 * seam (`store-shared.ts`) directly with an injected always-colliding
 * attempt — see `ordinal-allocation-cases.ts`'s design note for why
 * external pre-insertion can never observe a genuine exhaustion (MAX+1 read
 * live over the same partial index the UNIQUE constraint enforces is, by
 * construction, never already taken).
 *
 * @spec_ref AC-084-1
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocRecord } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import {
  allocateWithBoundedRetry,
  ORDINAL_ALLOCATION_MAX_ATTEMPTS,
} from "../../../src/store/store-shared.js";
import {
  EXPECTED_ORDINAL_ALLOCATION_CASE_COUNT,
  ORDINAL_ALLOCATION_CASES,
  type OrdinalAllocationCase,
} from "./ordinal-allocation-cases.js";
import { actedStore } from "../../live-invocation.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(): string {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return `01HORD${padded}`;
}

/**
 * `ordinal` is NOT yet a field of `DocRecord` (SPEC-084 adds it) — cast
 * through `Record<string, unknown>` rather than widening the imported type,
 * so this file's own RED-ness (a schema field that doesn't exist yet) never
 * masquerades as a passing type. `tsc` on this file is expected to be red
 * (AC-084-6 is a separate, later AC) — bun/vitest transpile without
 * type-checking, so this only affects static analysis, never the runtime
 * oracle this file exists to be.
 */
/** DocRole is derived from `type` per `DOC_TYPE_ROLE_MAP` (@lore/core SSOT) — spec→"spec", adr→"decision". */
const ROLE_FOR_TYPE: Record<string, string> = { spec: "spec", adr: "decision" };

function makeDoc(
  overrides: Partial<DocRecord> & { ordinal?: number | null } = {},
): DocRecord {
  _counter += 1;
  const type = overrides.type ?? "spec";
  const doc = {
    id: nextId(),
    slug: `spec-ordinal-fixture-${_counter}`,
    type: "spec",
    role: ROLE_FOR_TYPE[type] ?? "spec",
    title: `Ordinal Fixture ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "Fixture body",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-26T00:00:00.000Z",
    updated_at: "2026-07-26T00:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ordinal: null,
    ...overrides,
  };
  return doc as unknown as DocRecord;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("SQLiteStore — ordinal-allocation contract (SPEC-084)", () => {
  let store: SQLiteStore;

  beforeEach(() => {
    store = actedStore(new SQLiteStore(":memory:"));
  });

  afterEach(() => {
    store.close();
  });

  // ── AC-084-2 mechanical-parity guard: the loop below must generate
  // exactly one test per table entry, never silently filtering. ──────────
  let generatedCount = 0;

  for (const testCase of ORDINAL_ALLOCATION_CASES) {
    generatedCount += 1;

    it(testCase.name, async () => {
      await runOrdinalAllocationCase(store, testCase);
    });
  }

  it("case-table completeness — every imported case generated exactly one test", () => {
    expect(generatedCount).toBe(ORDINAL_ALLOCATION_CASES.length);
    expect(ORDINAL_ALLOCATION_CASES.length).toBe(EXPECTED_ORDINAL_ALLOCATION_CASE_COUNT);
  });
});

// ─── Interpreter ─────────────────────────────────────────────────────────────

async function runOrdinalAllocationCase(
  store: SQLiteStore,
  testCase: OrdinalAllocationCase,
): Promise<void> {
  const storeAny = store as unknown as {
    insertWithAllocatedOrdinal: (doc: DocRecord) => Promise<{
      ok: boolean;
      value?: DocRecord;
      error?: { code: string; message?: string };
    }>;
    allocateOrdinalForExisting: (
      id: string,
      expectedVersion: number,
    ) => Promise<{
      ok: boolean;
      value?: DocRecord;
      error?: { code: string; message?: string };
    }>;
  };

  switch (testCase.kind) {
    case "forced_collision_lands_next_free": {
      // Pre-insert ONE colliding slot via the PLAIN insert path (bypasses
      // the allocator entirely — simulates a row that exists for reasons
      // other than this call, e.g. the repair migration).
      const preInserted = makeDoc({ type: testCase.docType, ordinal: 1 });
      const preInsertResult = await store.insert(preInserted);
      expect(preInsertResult.ok).toBe(true);

      const result = await storeAny.insertWithAllocatedOrdinal(
        makeDoc({ type: testCase.docType, ordinal: null }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok || result.value === undefined) return;
      expect((result.value as unknown as { ordinal: unknown }).ordinal).toBe(2);
      break;
    }

    case "retry_exhaustion": {
      // Honest exhaustion oracle (see ordinal-allocation-cases.ts's design
      // note): external pre-insertion can NEVER force a real collision
      // against a live MAX(ordinal)+1 read, so exhaustion is exercised
      // directly at the shared bounded-retry seam with an injected
      // always-colliding attempt — no fake concurrency, no test-only hook
      // on SQLiteStore's public surface.
      let attempts = 0;
      const result = await allocateWithBoundedRetry<DocRecord>(0, testCase.docType, async () => {
        attempts += 1;
        return { kind: "collision" };
      });
      expect(attempts).toBe(ORDINAL_ALLOCATION_MAX_ATTEMPTS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("STORE_ERROR");
      if (result.error.code !== "STORE_ERROR") return;
      expect(result.error.message).toContain("ORDINAL_ALLOCATION_EXHAUSTED");
      break;
    }

    case "soft_deleted_ordinal_never_reused": {
      const firstResult = await storeAny.insertWithAllocatedOrdinal(
        makeDoc({ type: testCase.docType, ordinal: null }),
      );
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok || firstResult.value === undefined) return;
      const firstOrdinal = (firstResult.value as unknown as { ordinal: unknown }).ordinal;
      expect(firstOrdinal).toBe(1);

      const deleteResult = await store.softDelete(firstResult.value.id);
      expect(deleteResult.ok).toBe(true);

      const secondResult = await storeAny.insertWithAllocatedOrdinal(
        makeDoc({ type: testCase.docType, ordinal: null }),
      );
      expect(secondResult.ok).toBe(true);
      if (!secondResult.ok || secondResult.value === undefined) return;
      const secondOrdinal = (secondResult.value as unknown as { ordinal: unknown }).ordinal;
      expect(secondOrdinal).not.toBe(1);
      expect(secondOrdinal).toBe(2);
      break;
    }

    case "cross_type_coexistence": {
      for (const n of [1, 2, 3, 4]) {
        const preSpec = await store.insert(makeDoc({ type: "spec", ordinal: n }));
        expect(preSpec.ok).toBe(true);
        const preAdr = await store.insert(
          makeDoc({
            type: "adr",
            ordinal: n,
            extra: { decision_status: "proposed" },
          }),
        );
        expect(preAdr.ok).toBe(true);
      }

      const specResult = await storeAny.insertWithAllocatedOrdinal(
        makeDoc({ type: "spec", ordinal: null }),
      );
      expect(specResult.ok).toBe(true);
      if (specResult.ok && specResult.value !== undefined) {
        expect((specResult.value as unknown as { ordinal: unknown }).ordinal).toBe(5);
      }

      const adrResult = await storeAny.insertWithAllocatedOrdinal(
        makeDoc({
          type: "adr",
          ordinal: null,
          extra: { decision_status: "proposed" },
        }),
      );
      expect(adrResult.ok).toBe(true);
      if (adrResult.ok && adrResult.value !== undefined) {
        expect((adrResult.value as unknown as { ordinal: unknown }).ordinal).toBe(5);
      }
      break;
    }

    case "exempt_kind_null_ordinal_no_collision": {
      const first = await store.insert(
        makeDoc({
          type: testCase.docType,
          ordinal: null,
          extra: { spec_kind: "domain-overview" },
        }),
      );
      expect(first.ok).toBe(true);

      const second = await store.insert(
        makeDoc({
          type: testCase.docType,
          ordinal: null,
          extra: { spec_kind: "domain-overview" },
        }),
      );
      expect(second.ok).toBe(true);
      break;
    }

    case "exempt_to_numbered_kind_flip": {
      const exempt = await store.insert(
        makeDoc({
          type: testCase.docType,
          ordinal: null,
          extra: { spec_kind: "domain-overview" },
          version: 1,
        }),
      );
      expect(exempt.ok).toBe(true);
      if (!exempt.ok) return;

      const flipped = await storeAny.allocateOrdinalForExisting(exempt.value.id, 1);
      expect(flipped.ok).toBe(true);
      if (flipped.ok && flipped.value !== undefined) {
        expect((flipped.value as unknown as { ordinal: unknown }).ordinal).toBe(1);
        expect(flipped.value.version).toBe(2);
      }

      // Refuses a row that already carries an ordinal.
      const refused = await storeAny.allocateOrdinalForExisting(exempt.value.id, 2);
      expect(refused.ok).toBe(false);

      // Stale expectedVersion on a SECOND exempt doc → STALE_VERSION.
      const exempt2 = await store.insert(
        makeDoc({
          type: testCase.docType,
          ordinal: null,
          extra: { spec_kind: "domain-overview" },
          version: 1,
        }),
      );
      expect(exempt2.ok).toBe(true);
      if (!exempt2.ok) return;
      const staleResult = await storeAny.allocateOrdinalForExisting(exempt2.value.id, 999);
      expect(staleResult.ok).toBe(false);
      if (staleResult.ok) return;
      expect(staleResult.error?.code).toBe("STALE_VERSION");
      break;
    }

    default: {
      const exhaustive: never = testCase.kind;
      throw new Error(`unhandled ordinal-allocation case kind: ${String(exhaustive)}`);
    }
  }
}
