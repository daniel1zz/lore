/**
 * Tests for CorpusService.getReviewBundle (SPEC-034 §1, §4).
 * Uses InMemoryStore — no file I/O, no SQLite dependency.
 * Mirrors corpus-service-get-plan-bundle.test.ts's structure/style for the sibling
 * getPlanBundle method.
 *
 * Spec-first expectations (SPEC-034 §1, §4):
 *   - doc with a live parent → bundle.parent is that parent DocRecord, key present
 *   - root doc (no parent_id) → bundle.parent is ABSENT (not null, not present-undefined)
 *   - doc whose parent_id points at a SINCE-DELETED doc → bundle.parent is ABSENT, same
 *     degrade-to-"no parent modeled" behavior as a root doc
 *   - links with all live targets → brokenLinkTargets is ABSENT (not an empty array present)
 *   - a link whose other endpoint no longer resolves (missing or soft-deleted) →
 *     brokenLinkTargets is PRESENT and contains exactly that id
 *   - blueprint passed through verbatim when supplied; ABSENT when omitted
 *   - a nonexistent id/slug → DOC_NOT_FOUND
 *   - links[] is always present, even when empty
 *
 * Six-dimension coverage:
 *   HAPPY:      doc with live parent; blueprint passed through; links all resolve
 *   NEGATIVE:   n/a beyond ERROR dimension for this method (no "wrong type" concept the way
 *               getPlanBundle has — getReviewBundle accepts any doc type)
 *   BOUNDARY:   zero links → links: [], brokenLinkTargets absent; root doc → parent absent
 *   ERROR:      nonexistent id/slug → DOC_NOT_FOUND
 *   STATE:      a parent that existed at link-time but was later soft-deleted degrades
 *               bundle.parent to absent, not a stale/dangling reference
 *   REGRESSION: absent means the KEY itself is missing from the object (`"parent" in
 *               bundle.value === false`), never a fabricated `null` or `undefined`-but-present
 *
 * @spec_ref SPEC-034 §1, §4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput, TreeBlueprint } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
function makeService() {
  const store = actedStore(new InMemoryStore());
  return { service: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))), store };
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────

describe("getReviewBundle — HAPPY (doc with a live parent)", () => {
  it("a plan parented under a prd returns { doc, parent, links: [] }, parent populated", async () => {
    const { service } = makeService();
    const prd = await service.create({ type: "prd", title: "Root PRD", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");
    const spec = await service.create({
      type: "plan",
      title: "Child Plan",
      parent_id: prd.value.id,
      content: "plan body",
    } as CreateDocInput);
    if (!spec.ok) throw new Error("plan failed");

    const bundleResult = await service.getReviewBundle(spec.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.doc.id).toBe(spec.value.id);
    expect(bundleResult.value.parent?.id).toBe(prd.value.id);
    expect(bundleResult.value.links).toEqual([]);
  });

  it("resolving by slug works the same as resolving by id", async () => {
    const { service } = makeService();
    const prd = await service.create({ type: "prd", title: "Slug Root", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");

    const bundleResult = await service.getReviewBundle(prd.value.slug);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.doc.id).toBe(prd.value.id);
  });

  it("blueprint, when supplied, is passed through VERBATIM onto the bundle", async () => {
    const { service } = makeService();
    const prd = await service.create({ type: "prd", title: "Blueprint PRD", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");

    const blueprint: TreeBlueprint = {
      version: 1,
      root: { type: "prd", min: 0, max: null, children: [] },
    };

    const bundleResult = await service.getReviewBundle(prd.value.id, blueprint);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.blueprint).toEqual(blueprint);
    expect(bundleResult.value.blueprint).toBe(blueprint); // same reference, not a deep clone
  });

  it("links with all live targets → brokenLinkTargets is ABSENT (key not present)", async () => {
    const { service } = makeService();
    const prd = await service.create({ type: "prd", title: "Linked PRD", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");
    const knowledge = await service.create({
      parent_id: await ensureRequirementsDocId(service), type: "knowledge",
      title: "Related Knowledge",
      content: "x",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    if (!knowledge.ok) throw new Error("knowledge failed");

    const linkResult = await service.link(prd.value.id, knowledge.value.id, "relates-to");
    if (!linkResult.ok) throw new Error("link failed");

    const bundleResult = await service.getReviewBundle(prd.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.links).toHaveLength(1);
    expect("brokenLinkTargets" in bundleResult.value).toBe(false);
  });
});

// ─── BOUNDARY: root doc / no parent ──────────────────────────────────────────

describe("getReviewBundle — BOUNDARY (root doc, no parent_id)", () => {
  it("a root prd (no parent_id) → bundle.parent key is ABSENT, not null", async () => {
    const { service } = makeService();
    const prd = await service.create({ type: "prd", title: "Root Only", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");

    const bundleResult = await service.getReviewBundle(prd.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.parent).toBeUndefined();
    expect("parent" in bundleResult.value).toBe(false);
  });

  it("a doc with zero links → links: [], brokenLinkTargets is ABSENT", async () => {
    const { service } = makeService();
    const prd = await service.create({ type: "prd", title: "No Links PRD", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");

    const bundleResult = await service.getReviewBundle(prd.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.links).toEqual([]);
    expect("brokenLinkTargets" in bundleResult.value).toBe(false);
  });

  it("blueprint omitted → bundle.blueprint key is ABSENT, not undefined-but-present", async () => {
    const { service } = makeService();
    const prd = await service.create({ type: "prd", title: "No Blueprint PRD", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");

    const bundleResult = await service.getReviewBundle(prd.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.blueprint).toBeUndefined();
    expect("blueprint" in bundleResult.value).toBe(false);
  });
});

// ─── STATE: since-deleted parent ─────────────────────────────────────────────

describe("getReviewBundle — STATE (parent existed, then soft-deleted)", () => {
  it("a doc whose parent_id points at a soft-deleted doc → parent is ABSENT, degrades like no parent", async () => {
    const { service, store } = makeService();
    const prd = await service.create({ type: "prd", title: "Parent To Be Deleted", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");
    const spec = await service.create({
      type: "spec",
      title: "Orphaned-Soon Spec",
      content: "x",
    } as CreateDocInput);
    if (!spec.ok) throw new Error("spec failed");

    const deleteResult = await store.softDelete(prd.value.id);
    if (!deleteResult.ok) throw new Error("softDelete failed");

    const bundleResult = await service.getReviewBundle(spec.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.parent).toBeUndefined();
    expect("parent" in bundleResult.value).toBe(false);
  });
});

// ─── NEGATIVE: broken link targets ───────────────────────────────────────────

describe("getReviewBundle — NEGATIVE (broken link targets)", () => {
  it("a link pointing at a nonexistent doc id → brokenLinkTargets present, containing exactly that id", async () => {
    const { service, store } = makeService();
    const prd = await service.create({ type: "prd", title: "Broken Link PRD", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");

    const phantomId = "01ARZ3PHANTOM000000000001";
    const addResult = await store.addLink({
      from_id: prd.value.id,
      to_id: phantomId,
      link_type: "relates-to",
      created_at: new Date().toISOString(),
      created_by: "test",
    });
    if (!addResult.ok) throw new Error("addLink failed");

    const bundleResult = await service.getReviewBundle(prd.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.brokenLinkTargets).toEqual([phantomId]);
  });

  it("a link pointing at a doc that existed but was then soft-deleted → also reported broken", async () => {
    const { service, store } = makeService();
    const prd = await service.create({ type: "prd", title: "Link Source PRD", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");
    const knowledge = await service.create({
      parent_id: await ensureRequirementsDocId(service), type: "knowledge",
      title: "Soon Gone Knowledge",
      content: "x",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    if (!knowledge.ok) throw new Error("knowledge failed");

    const linkResult = await service.link(prd.value.id, knowledge.value.id, "relates-to");
    if (!linkResult.ok) throw new Error("link failed");

    const deleteResult = await store.softDelete(knowledge.value.id);
    if (!deleteResult.ok) throw new Error("softDelete failed");

    const bundleResult = await service.getReviewBundle(prd.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.brokenLinkTargets).toEqual([knowledge.value.id]);
  });

  it("a mix of one live link and one broken link reports ONLY the broken one", async () => {
    const { service, store } = makeService();
    const prd = await service.create({ type: "prd", title: "Mixed Links PRD", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");
    const liveKnowledge = await service.create({
      parent_id: await ensureRequirementsDocId(service), type: "knowledge",
      title: "Still Alive Knowledge",
      content: "x",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    if (!liveKnowledge.ok) throw new Error("knowledge failed");

    const liveLinkResult = await service.link(prd.value.id, liveKnowledge.value.id, "relates-to");
    if (!liveLinkResult.ok) throw new Error("link failed");

    const phantomId = "01ARZ3PHANTOM000000000002";
    const addResult = await store.addLink({
      from_id: prd.value.id,
      to_id: phantomId,
      link_type: "relates-to",
      created_at: new Date().toISOString(),
      created_by: "test",
    });
    if (!addResult.ok) throw new Error("addLink failed");

    const bundleResult = await service.getReviewBundle(prd.value.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.links).toHaveLength(2);
    expect(bundleResult.value.brokenLinkTargets).toEqual([phantomId]);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────

describe("getReviewBundle — ERROR (nonexistent doc)", () => {
  it("a nonexistent slug → DOC_NOT_FOUND", async () => {
    const { service } = makeService();
    const bundleResult = await service.getReviewBundle("spec-does-not-exist-anywhere");
    expect(bundleResult.ok).toBe(false);
    if (bundleResult.ok) return;
    expect(bundleResult.error.code).toBe("DOC_NOT_FOUND");
  });

  it("a nonexistent ULID-shaped id → DOC_NOT_FOUND", async () => {
    const { service } = makeService();
    const bundleResult = await service.getReviewBundle("01ARZ3NOTREAL0000000000001");
    expect(bundleResult.ok).toBe(false);
    if (bundleResult.ok) return;
    expect(bundleResult.error.code).toBe("DOC_NOT_FOUND");
  });

  it("a soft-deleted doc itself → DOC_NOT_FOUND, not a bundle over a dead doc", async () => {
    const { service, store } = makeService();
    const prd = await service.create({ type: "prd", title: "Will Be Deleted", content: "x" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd failed");
    const deleteResult = await store.softDelete(prd.value.id);
    if (!deleteResult.ok) throw new Error("softDelete failed");

    const bundleResult = await service.getReviewBundle(prd.value.id);
    expect(bundleResult.ok).toBe(false);
    if (bundleResult.ok) return;
    expect(bundleResult.error.code).toBe("DOC_NOT_FOUND");
  });
});
