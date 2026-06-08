/** @spec_ref AC-STORE-001 */
/**
 * Tests for InMemoryStore — adapter independence proof.
 *
 * Same test scenarios as sqlite-store.bun.test.ts, run against InMemoryStore.
 * This proves that any consumer of StoreInterface gets identical behavior
 * regardless of storage backend.
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
import { InMemoryStore } from "@store/in-memory-store";
import type {
  AuditEntry,
  DocRecord,
  LinkRecord,
  VersionRecord,
} from "@core/types";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(): string {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return `01HMEM${padded}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  return {
    id: nextId(),
    slug: `prd-test-${_counter}`,
    type: "prd",
    role: "intent",
    title: "Test Document",
    status: "draft",
    priority: "medium",
    content: "Test content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-06-08T10:00:00.000Z",
    updated_at: "2026-06-08T10:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

function makeLink(
  fromId: string,
  toId: string,
  linkType: LinkRecord["link_type"] = "relates-to",
): LinkRecord {
  return {
    from_id: fromId,
    to_id: toId,
    link_type: linkType,
    created_at: "2026-06-08T10:00:00.000Z",
    created_by: "agent:test",
  };
}

function makeVersion(docId: string, version: number): VersionRecord {
  return {
    doc_id: docId,
    version,
    content: `Content at version ${version}`,
    extra: {},
    status: "draft",
    title: "Test Document",
    action: "create",
    created_at: "2026-06-08T10:00:00.000Z",
    created_by: "agent:test",
  };
}

function makeAuditEntry(docId: string): AuditEntry {
  return {
    timestamp: "2026-06-08T10:00:00.000Z",
    actor: "agent:test",
    session_id: "sess-001",
    action: "create",
    doc_id: docId,
    details: { field: "value" },
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("InMemoryStore", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    _counter = 0;
    store = new InMemoryStore();
  });

  // ── Happy Path ─────────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("AC-STORE-001.01: insert + find by id round-trip", () => {
      const doc = makeDoc({ slug: "prd-hello" });
      const insertResult = store.insert(doc);
      expect(insertResult.ok).toBe(true);

      const findResult = store.find(doc.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;
      expect(findResult.value?.id).toBe(doc.id);
      expect(findResult.value?.slug).toBe("prd-hello");
    });

    it("AC-STORE-001.02: insert + findBySlug round-trip", () => {
      const doc = makeDoc({ slug: "spec-auth-flow" });
      store.insert(doc);

      const result = store.findBySlug("spec-auth-flow");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.id).toBe(doc.id);
    });

    it("tags round-trip: insert doc with tags, retrieve with tags preserved", () => {
      const doc = makeDoc({
        slug: "prd-tags",
        tags: ["auth", "security", "phase-1"],
      });
      store.insert(doc);

      const result = store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.tags).toEqual(["auth", "security", "phase-1"]);
    });

    it("extra round-trip: insert doc with extra, retrieve with extra preserved", () => {
      const doc = makeDoc({
        slug: "adr-test",
        type: "adr",
        role: "decision",
        extra: { decision_status: "proposed", notes: "initial draft" },
      });
      store.insert(doc);

      const result = store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.extra).toEqual({
        decision_status: "proposed",
        notes: "initial draft",
      });
    });

    it("AC-STORE-002.01: update patches doc fields and they persist", () => {
      const doc = makeDoc({ slug: "prd-updateme" });
      store.insert(doc);

      const updateResult = store.update(doc.id, {
        title: "Updated Title",
        status: "in-review",
        version: 2,
        updated_at: "2026-06-08T11:00:00.000Z",
      });
      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;
      expect(updateResult.value.title).toBe("Updated Title");
      expect(updateResult.value.status).toBe("in-review");
      expect(updateResult.value.version).toBe(2);
    });

    it("AC-STORE-002.01: version field incremented on the stored record", () => {
      const doc = makeDoc({ slug: "prd-version" });
      store.insert(doc);

      store.update(doc.id, {
        content: "new content",
        version: 2,
        updated_at: "2026-06-08T11:00:00.000Z",
      });

      const result = store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.version).toBe(2);
    });

    it("AC-STORE-003.01: softDelete sets deleted_at timestamp", () => {
      const doc = makeDoc({ slug: "prd-delete" });
      store.insert(doc);

      const deleteResult = store.softDelete(doc.id);
      expect(deleteResult.ok).toBe(true);

      // find() still returns the doc (soft delete preserved in storage)
      const found = store.find(doc.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value?.deleted_at).not.toBeNull();
    });

    it("AC-STORE-003.02: findMany(default) excludes soft-deleted docs", () => {
      const doc = makeDoc({ slug: "prd-exclude", type: "prd" });
      store.insert(doc);
      store.softDelete(doc.id);

      const result = store.findMany({ type: "prd" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((d) => d.id);
      expect(ids).not.toContain(doc.id);
    });

    it("AC-STORE-005.01: addLink creates a link record", () => {
      const docA = makeDoc({ slug: "prd-link-a" });
      const docB = makeDoc({ slug: "prd-link-b" });
      store.insert(docA);
      store.insert(docB);

      const link = makeLink(docA.id, docB.id, "relates-to");
      const result = store.addLink(link);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.from_id).toBe(docA.id);
      expect(result.value.link_type).toBe("relates-to");
    });

    it("AC-STORE-005.06: findLinks(out) returns outbound links", () => {
      const a = makeDoc({ slug: "prd-fl-a" });
      const b = makeDoc({ slug: "prd-fl-b" });
      store.insert(a);
      store.insert(b);
      store.addLink(makeLink(a.id, b.id, "informs"));

      const result = store.findLinks(a.id, "out");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.to_id).toBe(b.id);
    });

    it("AC-STORE-005.07: findLinks(in) returns inbound links", () => {
      const a = makeDoc({ slug: "prd-in-a" });
      const b = makeDoc({ slug: "prd-in-b" });
      store.insert(a);
      store.insert(b);
      store.addLink(makeLink(a.id, b.id, "informs"));

      const result = store.findLinks(b.id, "in");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.from_id).toBe(a.id);
    });

    it("AC-STORE-005.08: findLinks(both) returns all links for a doc", () => {
      const a = makeDoc({ slug: "prd-both-a" });
      const b = makeDoc({ slug: "prd-both-b" });
      const c = makeDoc({ slug: "prd-both-c" });
      store.insert(a);
      store.insert(b);
      store.insert(c);
      store.addLink(makeLink(a.id, b.id, "informs"));
      store.addLink(makeLink(c.id, a.id, "blocks"));

      const result = store.findLinks(a.id, "both");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });

    it("AC-STORE-005.05: removeLink deletes the specific link", () => {
      const a = makeDoc({ slug: "prd-rm-a" });
      const b = makeDoc({ slug: "prd-rm-b" });
      store.insert(a);
      store.insert(b);
      store.addLink(makeLink(a.id, b.id, "informs"));

      store.removeLink(a.id, b.id, "informs");

      const result = store.findLinks(a.id, "out");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it("AC-STORE-007.01: insertVersion + findVersions round-trip", () => {
      const doc = makeDoc({ slug: "prd-ver" });
      store.insert(doc);

      const v1 = makeVersion(doc.id, 1);
      store.insertVersion(v1);

      const result = store.findVersions(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.version).toBe(1);
      expect(result.value[0]?.action).toBe("create");
    });

    it("AC-STORE-008.01: appendAuditEntry + queryAudit round-trip", () => {
      const doc = makeDoc({ slug: "prd-audit" });
      store.insert(doc);

      const entry = makeAuditEntry(doc.id);
      store.appendAuditEntry(entry);

      const result = store.queryAudit({ doc_id: doc.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.actor).toBe("agent:test");
      expect(result.value[0]?.action).toBe("create");
    });

    it("AC-STORE-006.01: search returns results matching query substring", () => {
      const doc1 = makeDoc({
        slug: "spec-auth-v1",
        title: "Authentication Service",
        content:
          "This spec defines the auth flow for all users using JWT tokens.",
        type: "spec",
        role: "spec",
      });
      const doc2 = makeDoc({
        slug: "spec-auth-v2",
        title: "Auth Token Refresh",
        content: "Handles authentication token refresh logic.",
        type: "spec",
        role: "spec",
      });
      const doc3 = makeDoc({
        slug: "prd-unrelated",
        title: "Unrelated Document",
        content: "Nothing about tokens or logins here.",
      });
      store.insert(doc1);
      store.insert(doc2);
      store.insert(doc3);

      const result = store.search("auth");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThanOrEqual(2);
      const ids = result.value.map((h) => h.id);
      expect(ids).toContain(doc1.id);
      expect(ids).toContain(doc2.id);
      for (const hit of result.value) {
        expect(typeof hit.snippet).toBe("string");
      }
    });

    it("AC-STORE-009.01: findMany with type+status filters returns matching docs", () => {
      const docs = Array.from({ length: 10 }, (_, i) => {
        const type = i < 5 ? ("spec" as const) : ("prd" as const);
        const role = type === "spec" ? ("spec" as const) : ("intent" as const);
        return makeDoc({
          slug: `${type}-many-${i}`,
          type,
          role,
          status: i % 2 === 0 ? ("draft" as const) : ("in-review" as const),
        });
      });
      for (const d of docs) store.insert(d);

      const result = store.findMany({ type: "spec", status: "draft" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const doc of result.value) {
        expect(doc.type).toBe("spec");
        expect(doc.status).toBe("draft");
      }
    });

    it("addLink with type=parent creates link record", () => {
      const parent = makeDoc({ slug: "prd-par" });
      const child = makeDoc({ slug: "spec-child", type: "spec", role: "spec" });
      store.insert(parent);
      store.insert(child);

      const result = store.addLink(makeLink(child.id, parent.id, "parent"));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.link_type).toBe("parent");

      const links = store.findLinks(child.id, "out");
      expect(links.ok).toBe(true);
      if (!links.ok) return;
      expect(links.value).toHaveLength(1);
      expect(links.value[0]?.link_type).toBe("parent");
    });
  });

  // ── Negative Cases ─────────────────────────────────────────────────────────

  describe("negative cases", () => {
    it("AC-STORE-001.N01: find on missing id returns null (not error)", () => {
      const result = store.find("01HNOTEXIST0000000000000");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("findBySlug on missing slug returns null (not error)", () => {
      const result = store.findBySlug("prd-does-not-exist");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("AC-STORE-002.N01: update on missing id returns DOC_NOT_FOUND", () => {
      const result = store.update("01HNOTEXIST0000000000000", { title: "x" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });

    it("AC-STORE-003.N01: softDelete on missing id returns DOC_NOT_FOUND", () => {
      const result = store.softDelete("01HNOTEXIST0000000000000");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });

    it("AC-STORE-004.01: insert duplicate slug returns DUPLICATE_SLUG", () => {
      const doc1 = makeDoc({ slug: "prd-dupe" });
      const doc2 = makeDoc({ slug: "prd-dupe" });
      store.insert(doc1);

      const result = store.insert(doc2);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DUPLICATE_SLUG");
    });

    it("AC-STORE-005.02: addLink duplicate link returns DUPLICATE_LINK", () => {
      const a = makeDoc({ slug: "prd-dup-a" });
      const b = makeDoc({ slug: "prd-dup-b" });
      store.insert(a);
      store.insert(b);

      store.addLink(makeLink(a.id, b.id, "informs"));
      const result = store.addLink(makeLink(a.id, b.id, "informs"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DUPLICATE_LINK");
    });

    it("findMany returns empty array for filters matching nothing", () => {
      const result = store.findMany({ type: "knowledge", status: "archived" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it("AC-STORE-006.03: search with no matching docs returns empty array", () => {
      const result = store.search("xyzzy_notfound_12345");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  // ── Boundary Values ────────────────────────────────────────────────────────

  describe("boundary values", () => {
    it("AC-STORE-009.02: findMany exclude_deleted=false includes soft-deleted docs", () => {
      const doc = makeDoc({ slug: "prd-del-bv" });
      store.insert(doc);
      store.softDelete(doc.id);

      const result = store.findMany({ exclude_deleted: false });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((d) => d.id);
      expect(ids).toContain(doc.id);
    });

    it("AC-STORE-007.02: findVersions with limit=1 returns only newest version", () => {
      const doc = makeDoc({ slug: "prd-lim-ver" });
      store.insert(doc);
      store.insertVersion(makeVersion(doc.id, 1));
      store.insertVersion(makeVersion(doc.id, 2));
      store.insertVersion(makeVersion(doc.id, 3));

      const result = store.findVersions(doc.id, { limit: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.version).toBe(3); // newest first
    });

    it("AC-STORE-007.03: findVersions with offset=1 skips newest version", () => {
      const doc = makeDoc({ slug: "prd-off-ver" });
      store.insert(doc);
      store.insertVersion(makeVersion(doc.id, 1));
      store.insertVersion(makeVersion(doc.id, 2));

      const result = store.findVersions(doc.id, { limit: 10, offset: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.version).toBe(1); // offset skipped v2
    });

    it("doc with empty tags array preserved on round-trip", () => {
      const doc = makeDoc({ slug: "prd-no-tags", tags: [] });
      store.insert(doc);

      const result = store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.tags).toEqual([]);
    });

    it("doc with empty extra object preserved on round-trip", () => {
      const doc = makeDoc({ slug: "prd-no-extra", extra: {} });
      store.insert(doc);

      const result = store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.extra).toEqual({});
    });

    it("AC-STORE-008.02: queryAudit with limit returns correct number of entries", () => {
      const doc = makeDoc({ slug: "prd-audit-lim" });
      store.insert(doc);
      store.appendAuditEntry({
        ...makeAuditEntry(doc.id),
        timestamp: "2026-06-08T10:00:00.000Z",
      });
      store.appendAuditEntry({
        ...makeAuditEntry(doc.id),
        timestamp: "2026-06-08T11:00:00.000Z",
      });
      store.appendAuditEntry({
        ...makeAuditEntry(doc.id),
        timestamp: "2026-06-08T12:00:00.000Z",
      });

      const result = store.queryAudit({ doc_id: doc.id, limit: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });

    it("search with empty string returns empty array", () => {
      const doc = makeDoc({ slug: "prd-search-empty", title: "Auth Service" });
      store.insert(doc);

      const result = store.search("");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it("findVersions for doc with no versions returns empty array", () => {
      const result = store.findVersions("01HNOTEXIST0000000000000");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  // ── Error Handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("insert with duplicate primary key returns err Result, does not throw", () => {
      const doc = makeDoc({ slug: "prd-pk1" });
      const doc2 = { ...doc, slug: "prd-pk2" }; // same id, different slug
      store.insert(doc);
      const result = store.insert(doc2);
      expect(result).toBeDefined();
      expect(result.ok).toBe(false);
    });

    it("all store operations return Result, never throw on bad input", () => {
      const badId = "01HNOTEXIST0000000000000";
      expect(() => store.find(badId)).not.toThrow();
      expect(() => store.findBySlug("not-exist")).not.toThrow();
      expect(() => store.update(badId, {})).not.toThrow();
      expect(() => store.softDelete(badId)).not.toThrow();
      expect(() => store.findMany({})).not.toThrow();
      expect(() => store.search("test")).not.toThrow();
      expect(() => store.findVersions(badId)).not.toThrow();
      expect(() => store.queryAudit({})).not.toThrow();
    });
  });

  // ── State Transitions ──────────────────────────────────────────────────────

  describe("state transitions", () => {
    it("AC-STORE-005.03: parent cycle A→B then B→A rejected with LINK_CYCLE", () => {
      const a = makeDoc({ slug: "prd-cycle-a" });
      const b = makeDoc({ slug: "prd-cycle-b" });
      store.insert(a);
      store.insert(b);

      // b's parent = a
      store.addLink(makeLink(b.id, a.id, "parent"));

      // try to make a's parent = b → cycle
      const result = store.addLink(makeLink(a.id, b.id, "parent"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
    });

    it("AC-STORE-005.04: 3-node parent cycle A→B→C→A rejected with LINK_CYCLE", () => {
      const a = makeDoc({ slug: "prd-3c-a" });
      const b = makeDoc({ slug: "prd-3c-b" });
      const c = makeDoc({ slug: "prd-3c-c" });
      store.insert(a);
      store.insert(b);
      store.insert(c);

      store.addLink(makeLink(b.id, a.id, "parent")); // b → a
      store.addLink(makeLink(c.id, b.id, "parent")); // c → b

      // try a → c: would form a→c→b→a cycle
      const result = store.addLink(makeLink(a.id, c.id, "parent"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
    });

    it("AC-STORE-005.E01: non-parent links do NOT trigger cycle detection", () => {
      const a = makeDoc({ slug: "prd-no-cyc-a" });
      const b = makeDoc({ slug: "prd-no-cyc-b" });
      store.insert(a);
      store.insert(b);

      store.addLink(makeLink(b.id, a.id, "informs"));

      // Circular informs link is allowed (not a tree constraint)
      const result = store.addLink(makeLink(a.id, b.id, "informs"));
      expect(result.ok).toBe(true);
    });

    it("AC-STORE-003.03: softDelete: find(id) returns deleted_at; findMany excludes", () => {
      const doc = makeDoc({ slug: "prd-st-del" });
      store.insert(doc);
      store.softDelete(doc.id);

      const byId = store.find(doc.id);
      expect(byId.ok).toBe(true);
      if (!byId.ok) return;
      expect(byId.value?.deleted_at).not.toBeNull();

      const many = store.findMany({});
      expect(many.ok).toBe(true);
      if (!many.ok) return;
      expect(many.value.map((d) => d.id)).not.toContain(doc.id);
    });
  });

  // ── Search ────────────────────────────────────────────────────────────────

  describe("search (substring)", () => {
    it("AC-STORE-006.02: search with type filter returns only matching type", () => {
      const spec = makeDoc({
        slug: "spec-fts-auth",
        title: "Auth Spec",
        content: "Authentication requirements for the API.",
        type: "spec",
        role: "spec",
      });
      const prd = makeDoc({
        slug: "prd-fts-auth",
        title: "Auth PRD",
        content: "Authentication product requirements.",
        type: "prd",
        role: "intent",
      });
      store.insert(spec);
      store.insert(prd);

      const result = store.search("auth", { type: "spec" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // All returned hits must be spec type
      for (const hit of result.value) {
        const docResult = store.find(hit.id);
        if (docResult.ok && docResult.value) {
          expect(docResult.value.type).toBe("spec");
        }
      }
    });

    it("search returns snippet string from content", () => {
      const doc = makeDoc({
        slug: "prd-snippet",
        title: "Snippet Test",
        content:
          "This document describes the authentication protocol in detail. " +
          "The auth system uses JWT tokens for stateless sessions.",
      });
      store.insert(doc);

      const result = store.search("authentication");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThan(0);
      const hit = result.value[0];
      expect(hit).toBeDefined();
      expect(typeof hit!.snippet).toBe("string");
      expect(hit!.snippet.length).toBeGreaterThan(0);
    });

    it("search for term in title is found in results", () => {
      const doc = makeDoc({
        slug: "prd-fts-title",
        title: "Corpus Management System",
        content: "Details about the corpus.",
      });
      store.insert(doc);

      const result = store.search("Corpus");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((h) => h.id);
      expect(ids).toContain(doc.id);
    });

    it("search excludes soft-deleted docs by default", () => {
      const doc = makeDoc({
        slug: "prd-deleted-search",
        title: "Deleted Auth Doc",
        content: "This doc has auth content but is deleted.",
      });
      store.insert(doc);
      store.softDelete(doc.id);

      const result = store.search("auth");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((h) => h.id);
      expect(ids).not.toContain(doc.id);
    });

    it("search is case-insensitive", () => {
      const doc = makeDoc({
        slug: "prd-case-search",
        title: "AUTHENTICATION System",
        content: "Upper case title.",
      });
      store.insert(doc);

      const result = store.search("authentication");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((h) => h.id);
      expect(ids).toContain(doc.id);
    });
  });

  // ── Regression ────────────────────────────────────────────────────────────

  describe("regression", () => {
    it("insert does not mutate the input doc record", () => {
      const doc = makeDoc({ slug: "prd-reg-immut" });
      const originalTitle = doc.title;
      store.insert(doc);
      expect(doc.title).toBe(originalTitle);
    });

    it("AC-STORE-009.03: findMany with empty filters does not throw", () => {
      const result = store.findMany({});
      expect(result.ok).toBe(true);
    });

    it("search finds updated content after update", () => {
      const doc = makeDoc({
        slug: "prd-search-update",
        title: "Original Title",
        content: "Original content without special keyword.",
      });
      store.insert(doc);

      store.update(doc.id, {
        content: "Updated content with unique_search_keyword_xyz.",
        updated_at: "2026-06-08T11:00:00.000Z",
      });

      const result = store.search("unique_search_keyword_xyz");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((h) => h.id)).toContain(doc.id);
    });

    it("queryAudit with empty filters returns all entries", () => {
      const doc = makeDoc({ slug: "prd-audit-all" });
      store.insert(doc);
      store.appendAuditEntry(makeAuditEntry(doc.id));
      store.appendAuditEntry(makeAuditEntry(doc.id));

      const result = store.queryAudit({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThanOrEqual(2);
    });

    it("insertVersion without change_summary round-trips as undefined", () => {
      const doc = makeDoc({ slug: "prd-ver-nosumm" });
      store.insert(doc);
      const version = makeVersion(doc.id, 1);
      store.insertVersion({ ...version });

      const result = store.findVersions(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]?.change_summary).toBeUndefined();
    });

    it("AC-STORE-009.01: findMany handles 100 docs with type+status filters", () => {
      const types = ["spec", "prd", "adr"] as const;
      const roles = ["spec", "intent", "decision"] as const;
      const docs = Array.from({ length: 100 }, (_, i) => {
        const typeIdx = i % 3;
        const type = types[typeIdx]!;
        const role = roles[typeIdx]!;
        return makeDoc({
          slug: `${type}-big-${i}`,
          type,
          role,
          status: i % 2 === 0 ? ("draft" as const) : ("in-review" as const),
        });
      });
      for (const d of docs) store.insert(d);

      const result = store.findMany({ type: "spec", status: "draft" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const doc of result.value) {
        expect(doc.type).toBe("spec");
        expect(doc.status).toBe("draft");
      }
    });

    // Regression: returned records must be independent copies — mutating return
    // value must not affect stored state.
    it("find returns a copy — mutating result does not affect stored doc", () => {
      const doc = makeDoc({ slug: "prd-copy-check" });
      store.insert(doc);

      const result = store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const retrieved = result.value;
      if (retrieved) {
        (retrieved as DocRecord).title = "MUTATED";
      }

      const result2 = store.find(doc.id);
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;
      expect(result2.value?.title).toBe("Test Document");
    });
  });
});
