/**
 * Shared cross-store parity suite for `StoreInterface.findMany`'s `limit`/`offset`
 * paging fields (added to `StoreFilters` alongside the pre-existing filter columns).
 *
 * This module is NOT itself a test file (no `.test.ts` / `.bun.test.ts` suffix —
 * neither the vitest `include` glob nor `bun test`'s filename filter picks it up
 * directly). It exports ONE suite-defining function, invoked with the SAME
 * assertions against `SQLiteStore`, `TursoStore` (both `.bun.test.ts`, `bun test`
 * only) and `InMemoryStore` (`.test.ts`, vitest) — mirrors
 * `batch-methods.shared.ts`'s cross-store parity pattern.
 *
 * Six-dimension coverage:
 *   HAPPY:      {limit:2} returns the first 2 rows in deterministic order;
 *               {limit:2, offset:2} returns the next 2 — no overlap, no gap.
 *   NEGATIVE:   n/a (no error-shaped input for a plain numeric filter).
 *   BOUNDARY:   limit 0 → empty array, no error. offset beyond total row count →
 *               empty array, no error.
 *   ERROR:      n/a — findMany never errors on valid limit/offset values.
 *   STATE:      absent limit/offset → ALL matching rows returned, byte-identical
 *               order to the pre-paging behavior (REGRESSION).
 *   REGRESSION: ordering is deterministic even when every doc shares the exact
 *               same `updated_at` timestamp (a real pre-existing gap — `ORDER BY
 *               updated_at DESC` alone ties without a secondary sort key) —
 *               proves the `id` tiebreaker is actually wired, not just present
 *               in rows that happen to differ.
 *
 * @spec_ref pagination hardening (list/findMany read path, unbounded-payload review)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocRecord } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(prefix = "01HPAGE"): string {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return `${prefix}${padded}`;
}

/**
 * @param updatedAt - Distinct-by-default ISO timestamp so `ORDER BY updated_at
 *   DESC` alone already yields a deterministic order; tests targeting the `id`
 *   tiebreaker pass the SAME timestamp for every doc instead.
 */
function makeDoc(updatedAt: string, overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const id = nextId();
  return {
    id,
    slug: `knowledge-paging-fixture-${_counter}`,
    type: "knowledge",
    role: "knowledge",
    title: `Paging Fixture ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "Fixture body",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: updatedAt,
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

export interface PagingStoreSuiteOpts {
  /** Store implementation name — becomes the outer `describe` label. */
  label: string;
  /** Constructs a fresh, empty store for each test. */
  createStore: () => StoreInterface | Promise<StoreInterface>;
  /** Releases any resources (connection close, temp dir cleanup) after each test. */
  destroyStore: (store: StoreInterface) => void | Promise<void>;
}

export function runPagingStoreSuite(opts: PagingStoreSuiteOpts): void {
  const { label, createStore, destroyStore } = opts;

  describe(`${label} — findMany limit/offset paging`, () => {
    let store: StoreInterface;

    beforeEach(async () => {
      store = await createStore();
    });

    afterEach(async () => {
      await destroyStore(store);
    });

    async function insertFive(): Promise<DocRecord[]> {
      // Distinct updated_at, ascending — DESC order means doc5 is first, doc1 is last.
      const docs = [1, 2, 3, 4, 5].map((n) =>
        makeDoc(`2026-07-0${n}T00:00:00.000Z`, { title: `Doc ${n}` }),
      );
      for (const doc of docs) {
        const insertResult = await store.insert(doc);
        expect(insertResult.ok).toBe(true);
      }
      return docs;
    }

    it("STATE (REGRESSION) — absent limit/offset returns ALL rows, unpaged", async () => {
      await insertFive();
      const result = await store.findMany({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(5);
    });

    it("HAPPY — {limit:2} returns the first 2 rows in deterministic (updated_at DESC) order", async () => {
      await insertFive();
      const result = await store.findMany({ limit: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value.map((d) => d.title)).toEqual(["Doc 5", "Doc 4"]);
    });

    it("HAPPY — {limit:2, offset:2} returns the next page, no overlap/gap with page 1", async () => {
      await insertFive();
      const page1 = await store.findMany({ limit: 2 });
      const page2 = await store.findMany({ limit: 2, offset: 2 });
      expect(page1.ok).toBe(true);
      expect(page2.ok).toBe(true);
      if (!page1.ok || !page2.ok) return;

      expect(page2.value).toHaveLength(2);
      expect(page2.value.map((d) => d.title)).toEqual(["Doc 3", "Doc 2"]);

      const page1Ids = new Set(page1.value.map((d) => d.id));
      const page2Ids = new Set(page2.value.map((d) => d.id));
      const intersection = [...page1Ids].filter((id) => page2Ids.has(id));
      expect(intersection).toHaveLength(0);
    });

    it("HAPPY — paging through every row with limit:2 covers the full set exactly once", async () => {
      await insertFive();
      const page1 = await store.findMany({ limit: 2, offset: 0 });
      const page2 = await store.findMany({ limit: 2, offset: 2 });
      const page3 = await store.findMany({ limit: 2, offset: 4 });
      expect(page1.ok && page2.ok && page3.ok).toBe(true);
      if (!page1.ok || !page2.ok || !page3.ok) return;

      const allTitles = [...page1.value, ...page2.value, ...page3.value].map((d) => d.title);
      expect(allTitles).toEqual(["Doc 5", "Doc 4", "Doc 3", "Doc 2", "Doc 1"]);
    });

    it("BOUNDARY — limit 0 returns an empty array, no error", async () => {
      await insertFive();
      const result = await store.findMany({ limit: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it("BOUNDARY — offset beyond the row count returns an empty array, no error", async () => {
      await insertFive();
      const result = await store.findMany({ limit: 10, offset: 100 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it("BOUNDARY — offset without limit skips the given number of rows, returns the rest", async () => {
      await insertFive();
      const result = await store.findMany({ offset: 3 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((d) => d.title)).toEqual(["Doc 2", "Doc 1"]);
    });

    it("REGRESSION — identical updated_at timestamps still page deterministically via the id tiebreaker", async () => {
      const sameTs = "2026-07-01T00:00:00.000Z";
      const docs = [1, 2, 3, 4].map((n) => makeDoc(sameTs, { title: `Tied ${n}` }));
      for (const doc of docs) {
        const insertResult = await store.insert(doc);
        expect(insertResult.ok).toBe(true);
      }
      const expectedOrder = [...docs].sort((a, b) => a.id.localeCompare(b.id)).map((d) => d.title);

      const full = await store.findMany({});
      expect(full.ok).toBe(true);
      if (!full.ok) return;
      expect(full.value.map((d) => d.title)).toEqual(expectedOrder);

      const page1 = await store.findMany({ limit: 2 });
      const page2 = await store.findMany({ limit: 2, offset: 2 });
      expect(page1.ok && page2.ok).toBe(true);
      if (!page1.ok || !page2.ok) return;
      expect([...page1.value, ...page2.value].map((d) => d.title)).toEqual(expectedOrder);
    });

    it("STATE — limit/offset compose with a type filter (WHERE + LIMIT together)", async () => {
      const knowledgeDocs = [1, 2, 3].map((n) =>
        makeDoc(`2026-07-0${n}T00:00:00.000Z`, { type: "knowledge", role: "knowledge", title: `K${n}` }),
      );
      const adrDoc = makeDoc("2026-07-09T00:00:00.000Z", {
        type: "adr",
        role: "decision",
        title: "An ADR",
        extra: { decision_status: "accepted" },
      });
      for (const doc of [...knowledgeDocs, adrDoc]) {
        const insertResult = await store.insert(doc);
        expect(insertResult.ok).toBe(true);
      }

      const result = await store.findMany({ type: "knowledge", limit: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value.every((d) => d.type === "knowledge")).toBe(true);
      expect(result.value.map((d) => d.title)).toEqual(["K3", "K2"]);
    });
  });
}
