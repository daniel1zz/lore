/**
 * SPEC-084 ordinal-allocation contract suite — InMemoryStore (vitest twin).
 *
 * Runner: vitest — plain JS Map-backed store, no bun:sqlite dependency. This
 * is the mechanical-parity twin of `ordinal-allocation.contract.bun.test.ts`
 * (SQLiteStore, `bun test`): BOTH files import the SAME
 * `ORDINAL_ALLOCATION_CASES` table from `ordinal-allocation-cases.ts` and
 * generate one test per entry via the same loop shape (AC-084-2).
 *
 * AC-084-2's own text: "the vitest suite asserts the imported case count
 * equals the table length, so runner-level drift is structurally
 * impossible" — the `generatedCount === ORDINAL_ALLOCATION_CASES.length`
 * assertion below is that guard; `EXPECTED_ORDINAL_ALLOCATION_CASE_COUNT` is
 * an INDEPENDENT literal (not derived from the table) so a silently-shrunk
 * table trips a real mismatch instead of a vacuous self-comparison.
 *
 * RED STATE (2026-07-26): `StoreInterface.insertWithAllocatedOrdinal` /
 * `allocateOrdinalForExisting` do not exist yet on `InMemoryStore` — every
 * case below MUST fail with a `TypeError: ... is not a function`
 * (missing-method class), never a self-inflicted assertion bug.
 *
 * @spec_ref AC-084-2
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import {
  EXPECTED_ORDINAL_ALLOCATION_CASE_COUNT,
  ORDINAL_ALLOCATION_CASES,
  type OrdinalAllocationCase,
} from "./ordinal-allocation-cases.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(): string {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return `01HORDM${padded}`;
}

/**
 * `ordinal` is NOT yet a field of `DocRecord` (SPEC-084 adds it) — see the
 * matching comment in the SQLiteStore twin for why this casts through
 * `unknown` rather than widening the imported type.
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
    slug: `spec-ordinal-mem-fixture-${_counter}`,
    type: "spec",
    role: ROLE_FOR_TYPE[type] ?? "spec",
    title: `Ordinal Mem Fixture ${_counter}`,
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

describe("InMemoryStore — ordinal-allocation contract (SPEC-084, vitest twin)", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  let generatedCount = 0;

  for (const testCase of ORDINAL_ALLOCATION_CASES) {
    generatedCount += 1;

    it(testCase.name, async () => {
      await runOrdinalAllocationCase(store, testCase);
    });
  }

  it("case-table completeness (AC-084-2) — every imported case generated exactly one test", () => {
    expect(generatedCount).toBe(ORDINAL_ALLOCATION_CASES.length);
    expect(ORDINAL_ALLOCATION_CASES.length).toBe(EXPECTED_ORDINAL_ALLOCATION_CASE_COUNT);
  });
});

// ─── Interpreter (byte-parallel to the SQLiteStore twin's switch) ──────────

async function runOrdinalAllocationCase(
  store: InMemoryStore,
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
      for (const n of [1, 2, 3]) {
        const pre = await store.insert(makeDoc({ type: testCase.docType, ordinal: n }));
        expect(pre.ok).toBe(true);
      }

      const result = await storeAny.insertWithAllocatedOrdinal(
        makeDoc({ type: testCase.docType, ordinal: null }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error?.code).toBe("STORE_ERROR");
      expect(result.error?.message ?? "").toContain("ORDINAL_ALLOCATION_EXHAUSTED");
      break;
    }

    case "soft_deleted_ordinal_never_reused": {
      const firstResult = await storeAny.insertWithAllocatedOrdinal(
        makeDoc({ type: testCase.docType, ordinal: null }),
      );
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok || firstResult.value === undefined) return;
      expect((firstResult.value as unknown as { ordinal: unknown }).ordinal).toBe(1);

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

      const refused = await storeAny.allocateOrdinalForExisting(exempt.value.id, 2);
      expect(refused.ok).toBe(false);

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
