/**
 * Shared cross-store parity suite for `StoreInterface.findByIds` and
 * `StoreInterface.findLinksByFromIds` — the two batch methods added to close
 * the M6 (`CorpusService._getImpl` related-doc resolution) and M7
 * (`TreeCheckService.reconcile`) N+1 patterns.
 *
 * This module is NOT itself a test file (no `.test.ts` / `.bun.test.ts`
 * suffix — neither the vitest `include` glob nor `bun test .bun.test`'s
 * filename filter picks it up directly). It exports ONE suite-defining
 * function, invoked with the SAME assertions against `SQLiteStore`,
 * `TursoStore` (both `.bun.test.ts`, `bun test` only — `bun:sqlite`/
 * `@libsql/client` file mode), and `InMemoryStore` (plain `.test.ts`,
 * vitest) — the codebase's existing convention for avoiding the
 * store-implementation divergence class documented in `store/CLAUDE.md`
 * ("InMemoryStore mirrors SQLiteStore semantics... substring scoring
 * differs intentionally" — batch-method Map semantics must NOT differ).
 *
 * Six-dimension coverage per method:
 *   BOUNDARY:   empty ids array → ok(empty Map), no malformed `WHERE id IN ()`
 *               query issued; a single id → exactly one Map entry
 *   HAPPY:      multiple ids → Map keyed by id/from_id with the matching rows
 *   NEGATIVE:   an unknown id is ABSENT from the Map (never present with
 *               null/undefined/[]); an id with zero results is likewise absent
 *   REGRESSION: `findByIds` applies the SAME (i.e. no) soft-delete filter as
 *               `find` — a soft-deleted doc is still returned when requested
 *               directly; `findLinksByFromIds` never leaks an INCOMING-only
 *               link (to_id matches but from_id doesn't) into the result
 *
 * @spec_ref N+1 batch-method hardening (store-layer review M5/M6/M7)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocRecord, LinkRecord } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(prefix = "01HBATCH"): string {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return `${prefix}${padded}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const id = nextId();
  return {
    id,
    slug: `knowledge-batch-fixture-${_counter}`,
    type: "knowledge",
    role: "knowledge",
    title: `Batch Fixture ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "Fixture body",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

function makeLink(
  fromId: string,
  toId: string,
  linkType: LinkRecord["link_type"] = "blocks",
): LinkRecord {
  return {
    from_id: fromId,
    to_id: toId,
    link_type: linkType,
    created_at: "2026-07-01T00:00:00.000Z",
    created_by: "agent:test",
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

export interface BatchStoreMethodsSuiteOpts {
  /** Store implementation name — becomes the outer `describe` label. */
  label: string;
  /** Constructs a fresh, empty store for each test. */
  createStore: () => StoreInterface | Promise<StoreInterface>;
  /** Releases any resources (connection close, temp dir cleanup) after each test. */
  destroyStore: (store: StoreInterface) => void | Promise<void>;
}

export function runBatchStoreMethodsSuite(opts: BatchStoreMethodsSuiteOpts): void {
  const { label, createStore, destroyStore } = opts;

  describe(`${label} — findByIds / findLinksByFromIds (N+1 batch methods)`, () => {
    let store: StoreInterface;

    beforeEach(async () => {
      store = await createStore();
    });

    afterEach(async () => {
      await destroyStore(store);
    });

    // ── findByIds ────────────────────────────────────────────────────────

    describe("findByIds", () => {
      it("BOUNDARY — empty ids array returns ok(empty Map) without issuing a malformed query", async () => {
        const a = makeDoc();
        await store.insert(a);

        const result = await store.findByIds([]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.size).toBe(0);
      });

      it("BOUNDARY — a single id returns a Map with exactly one entry", async () => {
        const a = makeDoc({ title: "Solo Doc" });
        await store.insert(a);

        const result = await store.findByIds([a.id]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.size).toBe(1);
        expect(result.value.get(a.id)?.title).toBe("Solo Doc");
      });

      it("HAPPY — multiple ids returns a Map keyed by id with the matching docs, excluding non-requested ids", async () => {
        const a = makeDoc({ title: "Doc A" });
        const b = makeDoc({ title: "Doc B" });
        const c = makeDoc({ title: "Doc C" });
        await store.insert(a);
        await store.insert(b);
        await store.insert(c);

        const result = await store.findByIds([a.id, b.id]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.size).toBe(2);
        expect(result.value.get(a.id)?.title).toBe("Doc A");
        expect(result.value.get(b.id)?.title).toBe("Doc B");
        expect(result.value.has(c.id)).toBe(false);
      });

      it("NEGATIVE — an unknown id is absent from the Map, not present as null/undefined", async () => {
        const a = makeDoc();
        await store.insert(a);
        const unknownId = nextId("01HMISS");

        const result = await store.findByIds([a.id, unknownId]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.size).toBe(1);
        expect(result.value.has(unknownId)).toBe(false);
        expect(result.value.get(unknownId)).toBeUndefined();
      });

      it("NEGATIVE — all-unknown ids returns ok(empty Map), not an error", async () => {
        const result = await store.findByIds([nextId("01HMISS"), nextId("01HMISS")]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.size).toBe(0);
      });

      it("REGRESSION — a soft-deleted doc is still returned (matches find()'s no-soft-delete-filter default)", async () => {
        const a = makeDoc();
        await store.insert(a);
        const deleteResult = await store.softDelete(a.id);
        expect(deleteResult.ok).toBe(true);

        const result = await store.findByIds([a.id]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.has(a.id)).toBe(true);
        expect(result.value.get(a.id)?.deleted_at).not.toBeNull();
      });
    });

    // ── findLinksByFromIds ───────────────────────────────────────────────

    describe("findLinksByFromIds", () => {
      it("BOUNDARY — empty fromIds array returns ok(empty Map) without issuing a malformed query", async () => {
        const a = makeDoc();
        const b = makeDoc();
        await store.insert(a);
        await store.insert(b);
        await store.addLink(makeLink(a.id, b.id, "blocks"));

        const result = await store.findLinksByFromIds([]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.size).toBe(0);
      });

      it("BOUNDARY — a single fromId returns a Map with exactly one entry", async () => {
        const a = makeDoc();
        const b = makeDoc();
        await store.insert(a);
        await store.insert(b);
        await store.addLink(makeLink(a.id, b.id, "blocks"));

        const result = await store.findLinksByFromIds([a.id]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.size).toBe(1);
        expect(result.value.get(a.id)).toHaveLength(1);
      });

      it("HAPPY — multiple fromIds returns a Map grouping ALL outgoing link types per from_id, excluding unrelated ids", async () => {
        const a = makeDoc();
        const b = makeDoc();
        const c = makeDoc();
        const d = makeDoc();
        await store.insert(a);
        await store.insert(b);
        await store.insert(c);
        await store.insert(d);

        // a has two DIFFERENT outgoing link types — findLinksByFromIds must not
        // filter by link_type (mirrors findLinks(id, "out")'s no-filter contract).
        await store.addLink(makeLink(a.id, b.id, "blocks"));
        await store.addLink(makeLink(a.id, c.id, "relates-to"));
        await store.addLink(makeLink(b.id, d.id, "blocks"));
        // c's outgoing link must NOT leak into the result — c is not a requested fromId.
        await store.addLink(makeLink(c.id, d.id, "blocks"));

        const result = await store.findLinksByFromIds([a.id, b.id]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.size).toBe(2);

        const aLinks = result.value.get(a.id) ?? [];
        expect(aLinks).toHaveLength(2);
        expect(aLinks.map((l) => l.link_type).sort()).toEqual(["blocks", "relates-to"]);
        expect(aLinks.every((l) => l.from_id === a.id)).toBe(true);

        const bLinks = result.value.get(b.id) ?? [];
        expect(bLinks).toHaveLength(1);
        expect(bLinks[0]?.to_id).toBe(d.id);

        expect(result.value.has(c.id)).toBe(false);
      });

      it("NEGATIVE — a fromId with zero outgoing links is ABSENT from the Map, never present with []", async () => {
        const lonely = makeDoc();
        await store.insert(lonely);

        const result = await store.findLinksByFromIds([lonely.id]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.has(lonely.id)).toBe(false);
        expect(result.value.get(lonely.id)).toBeUndefined();
      });

      it("REGRESSION — an INCOMING-only link (to_id matches, from_id doesn't) never leaks into the result", async () => {
        const a = makeDoc();
        const b = makeDoc();
        await store.insert(a);
        await store.insert(b);
        // b -> a: a is the LINK TARGET here, never the source.
        await store.addLink(makeLink(b.id, a.id, "blocks"));

        const result = await store.findLinksByFromIds([a.id]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.has(a.id)).toBe(false);
      });

      it("NEGATIVE — all-unmatched fromIds returns ok(empty Map), not an error", async () => {
        const result = await store.findLinksByFromIds([nextId("01HMISS"), nextId("01HMISS")]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.size).toBe(0);
      });
    });
  });
}
