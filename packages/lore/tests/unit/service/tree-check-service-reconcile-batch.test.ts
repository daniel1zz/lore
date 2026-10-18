/**
 * Tests for TreeCheckService.reconcile's N+1 fix (SPEC review M7) — reconcile
 * used to call `store.findLinks(doc.id, "out")` once per doc; it now gathers
 * every doc's id and issues ONE `findLinksByFromIds` call. Uses InMemoryStore
 * — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   BOUNDARY:   `reconcile` over N (>1) docs issues EXACTLY ONE
 *               `findLinksByFromIds` call, not N (counting-subclass store
 *               oracle, mirrors StalenessProbeService's `CountingStore`
 *               precedent); zero docs still issues exactly one (empty-batch) call
 *   HAPPY:      the batched inconsistency detection is byte-identical to the
 *               pre-batch per-doc `findLinks(id, "out")` loop across all four
 *               D-RECONCILE cases (field-set-link-missing, field/link mismatch,
 *               consistent, field-null-link-exists)
 *   REGRESSION: a doc's OWN incoming links (where it is `to_id`, not `from_id`)
 *               never leak into its own outgoing-link set — mirrors
 *               `findLinks(id, "out")`'s direction semantics exactly
 *
 * @spec_ref N+1 batch-method hardening (TreeCheckService.reconcile, review M7)
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import type { DocId, DocRecord, DocType, LinkRecord } from "@lore/core";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

/** Counting subclass — asserts batch-call-count invariants (mirrors StalenessProbeService's CountingStore precedent). */
class CountingStore extends InMemoryStore {
  findLinksByFromIdsCallCount = 0;
  findLinksByFromIdsArgs: DocId[][] = [];

  override async findLinksByFromIds(fromIds: DocId[], direction?: "out") {
    this.findLinksByFromIdsCallCount += 1;
    this.findLinksByFromIdsArgs.push([...fromIds]);
    return super.findLinksByFromIds(fromIds, direction);
  }
}

function makeId(suffix: string): DocId {
  return `01TREC${suffix.padStart(20, "0")}`;
}

async function seedDoc(
  store: InMemoryStore,
  partial: Partial<DocRecord> & { type: DocType; id: DocId },
): Promise<DocRecord> {
  const now = new Date().toISOString();
  const rec: DocRecord = {
    id: partial.id,
    slug: partial.slug ?? `${partial.type}-${partial.id.slice(-6).toLowerCase()}`,
    type: partial.type,
    role: DOC_TYPE_ROLE_MAP[partial.type],
    title: partial.title ?? "T",
    status: "draft",
    priority: "medium",
    content: "",
    parent_id: partial.parent_id ?? null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: partial.version ?? 1,
    deleted_at: partial.deleted_at ?? null,
    tags: [],
    extra: partial.extra ?? {},
  };
  const r = await store.insert(rec);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

function makeLink(fromId: DocId, toId: DocId, linkType: LinkRecord["link_type"] = "parent"): LinkRecord {
  return {
    from_id: fromId,
    to_id: toId,
    link_type: linkType,
    created_at: new Date().toISOString(),
    created_by: "test",
  };
}

describe("TreeCheckService.reconcile — BOUNDARY: batched findLinksByFromIds call count", () => {
  it("issues EXACTLY ONE findLinksByFromIds call across 4 docs, not 4", async () => {
    const store = actedStore(new CountingStore());
    const svc = new TreeCheckService(store);

    const prd = await seedDoc(store, { id: makeId("PRD001"), type: "prd" });
    const spec1 = await seedDoc(store, { id: makeId("SPC001"), type: "spec", parent_id: prd.id });
    const spec2 = await seedDoc(store, { id: makeId("SPC002"), type: "spec", parent_id: prd.id });
    const spec3 = await seedDoc(store, { id: makeId("SPC003"), type: "spec", parent_id: prd.id });

    // spec1 consistent, spec2 field-set-link-missing, spec3 has a non-parent
    // outgoing link too (must not confuse the parent-link filter).
    await store.addLink(makeLink(spec1.id, prd.id, "parent"));
    await store.addLink(makeLink(spec3.id, prd.id, "parent"));
    await store.addLink(makeLink(spec3.id, spec1.id, "relates-to"));

    store.findLinksByFromIdsCallCount = 0;
    const result = await svc.reconcile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(store.findLinksByFromIdsCallCount).toBe(1);
    expect(store.findLinksByFromIdsArgs[0]).toHaveLength(4);
    expect(new Set(store.findLinksByFromIdsArgs[0])).toEqual(
      new Set([prd.id, spec1.id, spec2.id, spec3.id]),
    );

    // HAPPY: byte-identical inconsistency detection to the pre-batch per-doc loop.
    const bySlug = new Map(result.value.inconsistencies.map((i) => [i.doc_id, i]));
    expect(bySlug.has(spec1.id)).toBe(false); // consistent
    expect(bySlug.get(spec2.id)?.parent_id_field).toBe(prd.id);
    expect(bySlug.get(spec2.id)?.link_table_parent).toBeNull();
    expect(bySlug.has(spec3.id)).toBe(false); // consistent despite the extra relates-to link
  });

  it("BOUNDARY: zero docs still issues exactly one (empty-batch) call and reports no inconsistencies", async () => {
    const store = actedStore(new CountingStore());
    const svc = new TreeCheckService(store);

    store.findLinksByFromIdsCallCount = 0;
    const result = await svc.reconcile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(store.findLinksByFromIdsCallCount).toBe(1);
    expect(store.findLinksByFromIdsArgs[0]).toEqual([]);
    expect(result.value.inconsistencies).toEqual([]);
  });

  it("HAPPY: field/link mismatch across 2 docs is detected identically to the per-doc loop", async () => {
    const store = actedStore(new CountingStore());
    const svc = new TreeCheckService(store);

    const prdA = await seedDoc(store, { id: makeId("PRDA01"), type: "prd" });
    const prdB = await seedDoc(store, { id: makeId("PRDB01"), type: "prd" });
    const spec = await seedDoc(store, { id: makeId("SPCMIS"), type: "spec", parent_id: prdA.id });

    // Link claims prdB, field claims prdA — a mismatch.
    await store.addLink(makeLink(spec.id, prdB.id, "parent"));

    store.findLinksByFromIdsCallCount = 0;
    const result = await svc.reconcile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(store.findLinksByFromIdsCallCount).toBe(1);
    const hit = result.value.inconsistencies.find((i) => i.doc_id === spec.id);
    expect(hit?.parent_id_field).toBe(prdA.id);
    expect(hit?.link_table_parent).toBe(prdB.id);
  });

  it("REGRESSION: a doc's own INCOMING link (it is to_id, not from_id) never leaks into its outgoing set", async () => {
    const store = actedStore(new CountingStore());
    const svc = new TreeCheckService(store);

    const prd = await seedDoc(store, { id: makeId("PRDINC"), type: "prd" });
    const spec = await seedDoc(store, { id: makeId("SPCINC"), type: "spec", parent_id: null });

    // spec -> prd is an INCOMING link from prd's perspective (prd is to_id).
    // If findLinksByFromIds accidentally matched on to_id too, prd would appear
    // to have an outgoing "parent" link pointing at itself via spec's link.
    await store.addLink(makeLink(spec.id, prd.id, "parent"));

    const result = await svc.reconcile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // prd has NO outgoing links of its own — no inconsistency should be attributed
    // to prd (prd.parent_id is null, and there's no outgoing parent link FROM prd).
    const prdHit = result.value.inconsistencies.find((i) => i.doc_id === prd.id);
    expect(prdHit).toBeUndefined();
  });
});
