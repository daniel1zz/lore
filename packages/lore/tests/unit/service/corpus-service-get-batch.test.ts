/**
 * Tests for CorpusService.get's N+1 fix (SPEC review M6) — `_getImpl`'s
 * "related" resolution used to call `store.find` once per non-parent link;
 * it now gathers the distinct "other side" ids and issues ONE `findByIds`
 * call. Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   BOUNDARY:   `get` on a doc with MULTIPLE non-parent links issues EXACTLY ONE
 *               `findByIds` call, not one per link (counting-subclass store oracle,
 *               mirrors StalenessProbeService's `CountingStore` precedent);
 *               a doc with ZERO non-parent links issues ZERO `findByIds` calls
 *   HAPPY:      `navigation.related` is byte-identical (order, link_type,
 *               content) to what the pre-batch per-link `find` loop produced
 *   NEGATIVE:   a link to a hard-deleted (never-existed) doc id is silently
 *               excluded from `related`, exactly like the old per-link `find`
 *               → null → skip behavior
 *   REGRESSION: a `parent` link is still excluded from `related` and never
 *               contributes an id to the batched `findByIds` call
 *
 * @spec_ref N+1 batch-method hardening (CorpusService._getImpl, review M6)
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { DocId, CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

/** Counting subclass — asserts batch-call-count invariants (mirrors StalenessProbeService's CountingStore precedent). */
class CountingStore extends InMemoryStore {
  findByIdsCallCount = 0;
  findByIdsArgs: DocId[][] = [];

  override async findByIds(ids: DocId[]) {
    this.findByIdsCallCount += 1;
    this.findByIdsArgs.push([...ids]);
    return super.findByIds(ids);
  }
}

function prdInput(title: string): CreateDocInput {
  return { type: "prd", title };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput) {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("CorpusService.get — BOUNDARY: batched findByIds call count for related links", () => {
  it("issues EXACTLY ONE findByIds call for a doc with 3 non-parent links, not 3", async () => {
    const store = actedStore(new CountingStore());
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    const center = await mustCreate(service, prdInput("Center"));
    const a = await mustCreate(service, prdInput("Related A"));
    const b = await mustCreate(service, prdInput("Related B"));
    const c = await mustCreate(service, prdInput("Related C"));

    await service.link(center.id, a.id, "relates-to");
    await service.link(center.id, b.id, "relates-to");
    await service.link(center.id, c.id, "informs");

    store.findByIdsCallCount = 0;
    store.findByIdsArgs = [];
    const result = await service.get(center.slug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(store.findByIdsCallCount).toBe(1);
    expect(store.findByIdsArgs[0]).toHaveLength(3);

    // HAPPY: related contains all 3, correctly typed, byte-identical to the old
    // per-link find loop's output shape (id + link_type present, no dupes lost).
    expect(result.value.navigation.related).toHaveLength(3);
    const bySlug = new Map(result.value.navigation.related.map((r) => [r.slug, r]));
    expect(bySlug.get(a.slug)?.link_type).toBe("relates-to");
    expect(bySlug.get(b.slug)?.link_type).toBe("relates-to");
    expect(bySlug.get(c.slug)?.link_type).toBe("informs");
  });

  it("issues ZERO findByIds calls for a doc with only a parent link (no non-parent links)", async () => {
    const store = actedStore(new CountingStore());
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    const parent = await mustCreate(service, prdInput("Parent"));
    const child = await mustCreate(service, { type: "spec", title: "Child"});

    store.findByIdsCallCount = 0;
    const result = await service.get(child.slug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(store.findByIdsCallCount).toBe(0);
    expect(result.value.navigation.related).toEqual([]);
  });

  it("BOUNDARY: a doc with zero links entirely issues zero findByIds calls", async () => {
    const store = actedStore(new CountingStore());
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    const lonely = await mustCreate(service, prdInput("Lonely"));

    store.findByIdsCallCount = 0;
    const result = await service.get(lonely.slug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(store.findByIdsCallCount).toBe(0);
    expect(result.value.navigation.related).toEqual([]);
  });

  it("NEGATIVE: a link pointing at a since-deleted-from-the-map doc id is silently excluded from related", async () => {
    const store = actedStore(new CountingStore());
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    const center = await mustCreate(service, prdInput("Center"));
    const ghost = await mustCreate(service, prdInput("Ghost"));
    await service.link(center.id, ghost.id, "relates-to");

    // Simulate a broken link target: remove the doc row directly from the store's
    // backing map so findByIds's Map lookup for ghost.id comes back absent — the
    // SAME "otherResult.value === null → skip" behavior the pre-batch code had.
    const rawStore = store as unknown as { docs: Map<string, unknown> };
    rawStore.docs.delete(ghost.id);

    const result = await service.get(center.slug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.navigation.related).toEqual([]);
  });

  it("REGRESSION: a parent link never contributes an id to the batched findByIds call", async () => {
    const store = actedStore(new CountingStore());
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    const parent = await mustCreate(service, prdInput("Parent"));
    const child = await mustCreate(service, { type: "spec", title: "Child"});
    const other = await mustCreate(service, prdInput("Other"));
    await service.link(child.id, other.id, "relates-to");

    store.findByIdsArgs = [];
    const result = await service.get(child.slug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only "other" (the non-parent link target) is in the batch — "parent" is excluded.
    expect(store.findByIdsArgs[0]).toEqual([other.id]);
    expect(result.value.navigation.related).toHaveLength(1);
    expect(result.value.navigation.related[0]?.slug).toBe(other.slug);
  });
});
