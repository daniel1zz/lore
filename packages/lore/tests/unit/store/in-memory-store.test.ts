/** @spec_ref AC-STORE-001 */
/**
 * Tests for InMemoryStore — the adapter-specific cases only. The behaviour every
 * adapter shares (insert/find/update/links/search/versions/audit/CAS/judgments/
 * maxDocVersion …) lives in store-core.shared.ts and store-judgments.shared.ts and
 * is run against InMemoryStore at the bottom of this file, so a StoreInterface
 * consumer gets identical behavior regardless of storage backend.
 *
 * Spec references (SPEC-LORE-STORE-001):
 *   AC-STORE-001: insert + find (by id, by slug)
 *   AC-STORE-002: update + versioning
 *   AC-STORE-003: soft delete lifecycle
 *   AC-STORE-004: duplicate slug rejection
 *   AC-STORE-005: link management + cycle detection
 *   AC-STORE-006: search (substring match)
 *   AC-STORE-007: version history
 *   AC-STORE-008: audit log
 *   AC-STORE-009: findMany filters
 *
 * Test design techniques:
 *   EP: valid/invalid inserts, filter combinations
 *   BVA: empty query, limit/offset boundaries, empty arrays
 *   Decision Table: direction='in'|'out'|'both', exclude_deleted=true|false
 *   State Transition: soft-delete lifecycle, parent-cycle detection
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { makeDoc, makeLink, resetCounter, runStoreCoreSuite } from "./store-core.shared.js";
import { runStoreJudgmentsSuite } from "./store-judgments.shared.js";
import type { DocRecord } from "@lore/core";
import { SNIPPET_MARK_CLOSE, SNIPPET_MARK_OPEN } from "@lore/core";

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("InMemoryStore", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    resetCounter();
    store = new InMemoryStore();
  });

  // ── Happy Path ─────────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("addLink with type=parent creates link record", async () => {
      const parent = makeDoc({ slug: "prd-par" });
      const child = makeDoc({ slug: "spec-child", type: "spec", role: "spec" });
      await store.insert(parent);
      await store.insert(child);

      const result = await store.addLink(makeLink(child.id, parent.id, "parent"));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.link_type).toBe("parent");

      const links = await store.findLinks(child.id, "out");
      expect(links.ok).toBe(true);
      if (!links.ok) return;
      expect(links.value).toHaveLength(1);
      expect(links.value[0]?.link_type).toBe("parent");
    });
  });

  // ── Boundary Values ────────────────────────────────────────────────────────

  describe("boundary values", () => {
    it("search with empty string returns empty array", async () => {
      const doc = makeDoc({ slug: "prd-search-empty", title: "Auth Service" });
      await store.insert(doc);

      const result = await store.search("");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it("findVersions for doc with no versions returns empty array", async () => {
      const result = await store.findVersions("01HNOTEXIST0000000000000");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });



  // ── Search ────────────────────────────────────────────────────────────────

  describe("search (substring)", () => {
    // SPEC-037 D5 — snippet highlight sentinels replace literal '['/']'
    it("AC-37-8: snippet wraps the matched term in the control-char sentinels, not literal brackets", async () => {
      const doc = makeDoc({
        slug: "prd-sentinel-match",
        title: "Sentinel Match Test",
        content:
          "This document explains the retrogradation protocol used by the sync engine.",
      });
      await store.insert(doc);

      const result = await store.search("retrogradation");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const hit = result.value.find((h) => h.id === doc.id);
      expect(hit).toBeDefined();
      expect(hit!.snippet).toBe(
        `This document explains the ${SNIPPET_MARK_OPEN}retrogradation${SNIPPET_MARK_CLOSE} protocol used by the sync engine.`,
      );
      expect(hit!.snippet).not.toContain("[");
      expect(hit!.snippet).not.toContain("]");
    });

    // A document whose body contains literal '[brackets]' must not have them
    // misread as highlight markers — only the real substring match is wrapped.
    it("AC-37-8: literal brackets in doc content are not treated as highlight markers", async () => {
      const doc = makeDoc({
        slug: "prd-literal-brackets",
        title: "Literal Brackets Test",
        content:
          "See the flowchart [figure 3] for the full walkthrough of the system.",
      });
      await store.insert(doc);

      const result = await store.search("walkthrough");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const hit = result.value.find((h) => h.id === doc.id);
      expect(hit).toBeDefined();
      // Literal brackets pass through untouched...
      expect(hit!.snippet).toContain("[figure 3]");
      // ...while only the real match is wrapped in sentinels.
      expect(hit!.snippet).toContain(
        `${SNIPPET_MARK_OPEN}walkthrough${SNIPPET_MARK_CLOSE}`,
      );
    });

    // SPEC-037 §2 — SearchHit now carries type + status (no extra query needed
    // in-memory since the doc is already fully materialized)
    it("search excludes soft-deleted docs by default", async () => {
      const doc = makeDoc({
        slug: "prd-deleted-search",
        title: "Deleted Auth Doc",
        content: "This doc has auth content but is deleted.",
      });
      await store.insert(doc);
      await store.softDelete(doc.id);

      const result = await store.search("auth");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((h) => h.id);
      expect(ids).not.toContain(doc.id);
    });

    it("search is case-insensitive", async () => {
      const doc = makeDoc({
        slug: "prd-case-search",
        title: "AUTHENTICATION System",
        content: "Upper case title.",
      });
      await store.insert(doc);

      const result = await store.search("authentication");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((h) => h.id);
      expect(ids).toContain(doc.id);
    });
  });

  // ── Regression ────────────────────────────────────────────────────────────

  describe("regression", () => {
    it("search finds updated content after update", async () => {
      const doc = makeDoc({
        slug: "prd-search-update",
        title: "Original Title",
        content: "Original content without special keyword.",
      });
      await store.insert(doc);

      await store.update(doc.id, {
        content: "Updated content with unique_search_keyword_xyz.",
        updated_at: "2026-06-08T11:00:00.000Z",
      });

      const result = await store.search("unique_search_keyword_xyz");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((h) => h.id)).toContain(doc.id);
    });

    // Regression: returned records must be independent copies — mutating return
    // value must not affect stored state.
    it("find returns a copy — mutating result does not affect stored doc", async () => {
      const doc = makeDoc({ slug: "prd-copy-check" });
      await store.insert(doc);

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const retrieved = result.value;
      if (retrieved) {
        (retrieved as DocRecord).title = "MUTATED";
      }

      const result2 = await store.find(doc.id);
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;
      expect(result2.value?.title).toBe("Test Document");
    });
  });

  // AC-STORE-010: dbSizeBytes — no disk footprint for in-memory store
  describe("dbSizeBytes", () => {
    it("always reports 0 bytes — no disk-backed storage", async () => {
      const result = await store.dbSizeBytes();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(0);
    });

    it("remains 0 after inserting docs — in-memory has no disk size regardless of content", async () => {
      await store.insert(makeDoc({ slug: "prd-size-check" }));

      const result = await store.dbSizeBytes();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(0);
    });
  });
});

runStoreCoreSuite({
  label: "InMemoryStore",
  createStore: () => new InMemoryStore(),
  destroyStore: (store) => store.close(),
  // N/A: InMemoryStore.detectParentCycle ignores docs.parent_id (see StoreSuiteOptions).
  parentIdOnlyCycleDetection: false,
});

runStoreJudgmentsSuite({
  label: "InMemoryStore",
  createStore: () => new InMemoryStore(),
  destroyStore: (store) => store.close(),
  // N/A: InMemoryStore has no FK constraints; the orphan reference surfaces at query time.
  enforcesForeignKeys: false,
});
