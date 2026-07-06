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
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type {
  AuditEntry,
  CalibrationRecord,
  DocRecord,
  LinkRecord,
  ReviewJudgment,
  VersionRecord,
} from "@lore/core";

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

function makeJudgment(docId: string, overrides: Partial<ReviewJudgment> = {}): ReviewJudgment {
  _counter += 1;
  return {
    id: `01HJUDGE${String(_counter).padStart(18, "0")}`,
    doc_id: docId,
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "All ACs covered." }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" },
    created_at: "2026-06-08T10:00:00.000Z",
    created_by: "ai:claude-cli:claude-sonnet-5:v1",
    ...overrides,
  };
}

function makeCalibrationRecord(
  judgmentId: string,
  docId: string,
  overrides: Partial<CalibrationRecord> = {},
): CalibrationRecord {
  _counter += 1;
  return {
    id: `01HCALIB${String(_counter).padStart(18, "0")}`,
    judgment_id: judgmentId,
    doc_id: docId,
    doc_type: "spec",
    human_outcome: "confirmed",
    delta_reasons: [],
    actor: "alice",
    created_at: "2026-06-08T10:00:00.000Z",
    ...overrides,
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
    it("AC-STORE-001.01: insert + find by id round-trip", async () => {
      const doc = makeDoc({ slug: "prd-hello" });
      const insertResult = await store.insert(doc);
      expect(insertResult.ok).toBe(true);

      const findResult = await store.find(doc.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;
      expect(findResult.value?.id).toBe(doc.id);
      expect(findResult.value?.slug).toBe("prd-hello");
    });

    it("AC-STORE-001.02: insert + findBySlug round-trip", async () => {
      const doc = makeDoc({ slug: "spec-auth-flow" });
      await store.insert(doc);

      const result = await store.findBySlug("spec-auth-flow");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.id).toBe(doc.id);
    });

    it("tags round-trip: insert doc with tags, retrieve with tags preserved", async () => {
      const doc = makeDoc({
        slug: "prd-tags",
        tags: ["auth", "security", "phase-1"],
      });
      await store.insert(doc);

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.tags).toEqual(["auth", "security", "phase-1"]);
    });

    it("extra round-trip: insert doc with extra, retrieve with extra preserved", async () => {
      const doc = makeDoc({
        slug: "adr-test",
        type: "adr",
        role: "decision",
        extra: { decision_status: "proposed", notes: "initial draft" },
      });
      await store.insert(doc);

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.extra).toEqual({
        decision_status: "proposed",
        notes: "initial draft",
      });
    });

    it("AC-STORE-002.01: update patches doc fields and they persist", async () => {
      const doc = makeDoc({ slug: "prd-updateme" });
      await store.insert(doc);

      const updateResult = await store.update(doc.id, {
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

    it("AC-STORE-002.01: version field incremented on the stored record", async () => {
      const doc = makeDoc({ slug: "prd-version" });
      await store.insert(doc);

      await store.update(doc.id, {
        content: "new content",
        version: 2,
        updated_at: "2026-06-08T11:00:00.000Z",
      });

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.version).toBe(2);
    });

    it("AC-STORE-003.01: softDelete sets deleted_at timestamp", async () => {
      const doc = makeDoc({ slug: "prd-delete" });
      await store.insert(doc);

      const deleteResult = await store.softDelete(doc.id);
      expect(deleteResult.ok).toBe(true);

      // find() still returns the doc (soft delete preserved in storage)
      const found = await store.find(doc.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value?.deleted_at).not.toBeNull();
    });

    it("AC-STORE-003.02: findMany(default) excludes soft-deleted docs", async () => {
      const doc = makeDoc({ slug: "prd-exclude", type: "prd" });
      await store.insert(doc);
      await store.softDelete(doc.id);

      const result = await store.findMany({ type: "prd" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((d) => d.id);
      expect(ids).not.toContain(doc.id);
    });

    it("AC-STORE-005.01: addLink creates a link record", async () => {
      const docA = makeDoc({ slug: "prd-link-a" });
      const docB = makeDoc({ slug: "prd-link-b" });
      await store.insert(docA);
      await store.insert(docB);

      const link = makeLink(docA.id, docB.id, "relates-to");
      const result = await store.addLink(link);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.from_id).toBe(docA.id);
      expect(result.value.link_type).toBe("relates-to");
    });

    it("AC-STORE-005.06: findLinks(out) returns outbound links", async () => {
      const a = makeDoc({ slug: "prd-fl-a" });
      const b = makeDoc({ slug: "prd-fl-b" });
      await store.insert(a);
      await store.insert(b);
      await store.addLink(makeLink(a.id, b.id, "informs"));

      const result = await store.findLinks(a.id, "out");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.to_id).toBe(b.id);
    });

    it("AC-STORE-005.07: findLinks(in) returns inbound links", async () => {
      const a = makeDoc({ slug: "prd-in-a" });
      const b = makeDoc({ slug: "prd-in-b" });
      await store.insert(a);
      await store.insert(b);
      await store.addLink(makeLink(a.id, b.id, "informs"));

      const result = await store.findLinks(b.id, "in");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.from_id).toBe(a.id);
    });

    it("AC-STORE-005.08: findLinks(both) returns all links for a doc", async () => {
      const a = makeDoc({ slug: "prd-both-a" });
      const b = makeDoc({ slug: "prd-both-b" });
      const c = makeDoc({ slug: "prd-both-c" });
      await store.insert(a);
      await store.insert(b);
      await store.insert(c);
      await store.addLink(makeLink(a.id, b.id, "informs"));
      await store.addLink(makeLink(c.id, a.id, "blocks"));

      const result = await store.findLinks(a.id, "both");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });

    it("AC-STORE-005.05: removeLink deletes the specific link", async () => {
      const a = makeDoc({ slug: "prd-rm-a" });
      const b = makeDoc({ slug: "prd-rm-b" });
      await store.insert(a);
      await store.insert(b);
      await store.addLink(makeLink(a.id, b.id, "informs"));

      await store.removeLink(a.id, b.id, "informs");

      const result = await store.findLinks(a.id, "out");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it("AC-STORE-007.01: insertVersion + findVersions round-trip", async () => {
      const doc = makeDoc({ slug: "prd-ver" });
      await store.insert(doc);

      const v1 = makeVersion(doc.id, 1);
      await store.insertVersion(v1);

      const result = await store.findVersions(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.version).toBe(1);
      expect(result.value[0]?.action).toBe("create");
    });

    it("AC-STORE-008.01: appendAuditEntry + queryAudit round-trip", async () => {
      const doc = makeDoc({ slug: "prd-audit" });
      await store.insert(doc);

      const entry = makeAuditEntry(doc.id);
      await store.appendAuditEntry(entry);

      const result = await store.queryAudit({ doc_id: doc.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.actor).toBe("agent:test");
      expect(result.value[0]?.action).toBe("create");
    });

    it("AC-STORE-006.01: search returns results matching query substring", async () => {
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
      await store.insert(doc1);
      await store.insert(doc2);
      await store.insert(doc3);

      const result = await store.search("auth");
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

    it("AC-STORE-009.01: findMany with type+status filters returns matching docs", async () => {
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
      for (const d of docs) await store.insert(d);

      const result = await store.findMany({ type: "spec", status: "draft" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const doc of result.value) {
        expect(doc.type).toBe("spec");
        expect(doc.status).toBe("draft");
      }
    });

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

  // ── Negative Cases ─────────────────────────────────────────────────────────

  describe("negative cases", () => {
    it("AC-STORE-001.N01: find on missing id returns null (not error)", async () => {
      const result = await store.find("01HNOTEXIST0000000000000");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("findBySlug on missing slug returns null (not error)", async () => {
      const result = await store.findBySlug("prd-does-not-exist");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("AC-STORE-002.N01: update on missing id returns DOC_NOT_FOUND", async () => {
      const result = await store.update("01HNOTEXIST0000000000000", { title: "x" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });

    it("AC-STORE-003.N01: softDelete on missing id returns DOC_NOT_FOUND", async () => {
      const result = await store.softDelete("01HNOTEXIST0000000000000");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });

    it("AC-STORE-004.01: insert duplicate slug returns DUPLICATE_SLUG", async () => {
      const doc1 = makeDoc({ slug: "prd-dupe" });
      const doc2 = makeDoc({ slug: "prd-dupe" });
      await store.insert(doc1);

      const result = await store.insert(doc2);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DUPLICATE_SLUG");
    });

    it("AC-STORE-005.02: addLink duplicate link returns DUPLICATE_LINK", async () => {
      const a = makeDoc({ slug: "prd-dup-a" });
      const b = makeDoc({ slug: "prd-dup-b" });
      await store.insert(a);
      await store.insert(b);

      await store.addLink(makeLink(a.id, b.id, "informs"));
      const result = await store.addLink(makeLink(a.id, b.id, "informs"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DUPLICATE_LINK");
    });

    it("findMany returns empty array for filters matching nothing", async () => {
      const result = await store.findMany({ type: "knowledge", status: "archived" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it("AC-STORE-006.03: search with no matching docs returns empty array", async () => {
      const result = await store.search("xyzzy_notfound_12345");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  // ── Boundary Values ────────────────────────────────────────────────────────

  describe("boundary values", () => {
    it("AC-STORE-009.02: findMany exclude_deleted=false includes soft-deleted docs", async () => {
      const doc = makeDoc({ slug: "prd-del-bv" });
      await store.insert(doc);
      await store.softDelete(doc.id);

      const result = await store.findMany({ exclude_deleted: false });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((d) => d.id);
      expect(ids).toContain(doc.id);
    });

    it("AC-STORE-007.02: findVersions with limit=1 returns only newest version", async () => {
      const doc = makeDoc({ slug: "prd-lim-ver" });
      await store.insert(doc);
      await store.insertVersion(makeVersion(doc.id, 1));
      await store.insertVersion(makeVersion(doc.id, 2));
      await store.insertVersion(makeVersion(doc.id, 3));

      const result = await store.findVersions(doc.id, { limit: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.version).toBe(3); // newest first
    });

    it("AC-STORE-007.03: findVersions with offset=1 skips newest version", async () => {
      const doc = makeDoc({ slug: "prd-off-ver" });
      await store.insert(doc);
      await store.insertVersion(makeVersion(doc.id, 1));
      await store.insertVersion(makeVersion(doc.id, 2));

      const result = await store.findVersions(doc.id, { limit: 10, offset: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.version).toBe(1); // offset skipped v2
    });

    it("doc with empty tags array preserved on round-trip", async () => {
      const doc = makeDoc({ slug: "prd-no-tags", tags: [] });
      await store.insert(doc);

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.tags).toEqual([]);
    });

    it("doc with empty extra object preserved on round-trip", async () => {
      const doc = makeDoc({ slug: "prd-no-extra", extra: {} });
      await store.insert(doc);

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.extra).toEqual({});
    });

    it("AC-STORE-008.02: queryAudit with limit returns correct number of entries", async () => {
      const doc = makeDoc({ slug: "prd-audit-lim" });
      await store.insert(doc);
      await store.appendAuditEntry({
        ...makeAuditEntry(doc.id),
        timestamp: "2026-06-08T10:00:00.000Z",
      });
      await store.appendAuditEntry({
        ...makeAuditEntry(doc.id),
        timestamp: "2026-06-08T11:00:00.000Z",
      });
      await store.appendAuditEntry({
        ...makeAuditEntry(doc.id),
        timestamp: "2026-06-08T12:00:00.000Z",
      });

      const result = await store.queryAudit({ doc_id: doc.id, limit: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });

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

  // ── Error Handling ─────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("insert with duplicate primary key returns err Result, does not throw", async () => {
      const doc = makeDoc({ slug: "prd-pk1" });
      const doc2 = { ...doc, slug: "prd-pk2" }; // same id, different slug
      await store.insert(doc);
      const result = await store.insert(doc2);
      expect(result).toBeDefined();
      expect(result.ok).toBe(false);
    });

    it("all store operations return Result, never throw on bad input", async () => {
      const badId = "01HNOTEXIST0000000000000";
      await expect(store.find(badId)).resolves.toBeDefined();
      await expect(store.findBySlug("not-exist")).resolves.toBeDefined();
      await expect(store.update(badId, {})).resolves.toBeDefined();
      await expect(store.softDelete(badId)).resolves.toBeDefined();
      await expect(store.findMany({})).resolves.toBeDefined();
      await expect(store.search("test")).resolves.toBeDefined();
      await expect(store.findVersions(badId)).resolves.toBeDefined();
      await expect(store.queryAudit({})).resolves.toBeDefined();
    });
  });

  // ── State Transitions ──────────────────────────────────────────────────────

  describe("state transitions", () => {
    it("AC-STORE-005.03: parent cycle A→B then B→A rejected with LINK_CYCLE", async () => {
      const a = makeDoc({ slug: "prd-cycle-a" });
      const b = makeDoc({ slug: "prd-cycle-b" });
      await store.insert(a);
      await store.insert(b);

      // b's parent = a
      await store.addLink(makeLink(b.id, a.id, "parent"));

      // try to make a's parent = b → cycle
      const result = await store.addLink(makeLink(a.id, b.id, "parent"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
    });

    it("AC-STORE-005.04: 3-node parent cycle A→B→C→A rejected with LINK_CYCLE", async () => {
      const a = makeDoc({ slug: "prd-3c-a" });
      const b = makeDoc({ slug: "prd-3c-b" });
      const c = makeDoc({ slug: "prd-3c-c" });
      await store.insert(a);
      await store.insert(b);
      await store.insert(c);

      await store.addLink(makeLink(b.id, a.id, "parent")); // b → a
      await store.addLink(makeLink(c.id, b.id, "parent")); // c → b

      // try a → c: would form a→c→b→a cycle
      const result = await store.addLink(makeLink(a.id, c.id, "parent"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
    });

    it("AC-STORE-005.E01: non-parent links do NOT trigger cycle detection", async () => {
      const a = makeDoc({ slug: "prd-no-cyc-a" });
      const b = makeDoc({ slug: "prd-no-cyc-b" });
      await store.insert(a);
      await store.insert(b);

      await store.addLink(makeLink(b.id, a.id, "informs"));

      // Circular informs link is allowed (not a tree constraint)
      const result = await store.addLink(makeLink(a.id, b.id, "informs"));
      expect(result.ok).toBe(true);
    });

    it("AC-STORE-003.03: softDelete: find(id) returns deleted_at; findMany excludes", async () => {
      const doc = makeDoc({ slug: "prd-st-del" });
      await store.insert(doc);
      await store.softDelete(doc.id);

      const byId = await store.find(doc.id);
      expect(byId.ok).toBe(true);
      if (!byId.ok) return;
      expect(byId.value?.deleted_at).not.toBeNull();

      const many = await store.findMany({});
      expect(many.ok).toBe(true);
      if (!many.ok) return;
      expect(many.value.map((d) => d.id)).not.toContain(doc.id);
    });
  });

  // ── Search ────────────────────────────────────────────────────────────────

  describe("search (substring)", () => {
    it("AC-STORE-006.02: search with type filter returns only matching type", async () => {
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
      await store.insert(spec);
      await store.insert(prd);

      const result = await store.search("auth", { type: "spec" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // All returned hits must be spec type
      for (const hit of result.value) {
        const docResult = await store.find(hit.id);
        if (docResult.ok && docResult.value) {
          expect(docResult.value.type).toBe("spec");
        }
      }
    });

    it("search returns snippet string from content", async () => {
      const doc = makeDoc({
        slug: "prd-snippet",
        title: "Snippet Test",
        content:
          "This document describes the authentication protocol in detail. " +
          "The auth system uses JWT tokens for stateless sessions.",
      });
      await store.insert(doc);

      const result = await store.search("authentication");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThan(0);
      const hit = result.value[0];
      expect(hit).toBeDefined();
      expect(typeof hit!.snippet).toBe("string");
      expect(hit!.snippet.length).toBeGreaterThan(0);
    });

    it("search for term in title is found in results", async () => {
      const doc = makeDoc({
        slug: "prd-fts-title",
        title: "Corpus Management System",
        content: "Details about the corpus.",
      });
      await store.insert(doc);

      const result = await store.search("Corpus");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((h) => h.id);
      expect(ids).toContain(doc.id);
    });

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
    it("insert does not mutate the input doc record", async () => {
      const doc = makeDoc({ slug: "prd-reg-immut" });
      const originalTitle = doc.title;
      await store.insert(doc);
      expect(doc.title).toBe(originalTitle);
    });

    it("AC-STORE-009.03: findMany with empty filters does not throw", async () => {
      const result = await store.findMany({});
      expect(result.ok).toBe(true);
    });

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

    it("queryAudit with empty filters returns all entries", async () => {
      const doc = makeDoc({ slug: "prd-audit-all" });
      await store.insert(doc);
      await store.appendAuditEntry(makeAuditEntry(doc.id));
      await store.appendAuditEntry(makeAuditEntry(doc.id));

      const result = await store.queryAudit({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThanOrEqual(2);
    });

    it("insertVersion without change_summary round-trips as undefined", async () => {
      const doc = makeDoc({ slug: "prd-ver-nosumm" });
      await store.insert(doc);
      const version = makeVersion(doc.id, 1);
      await store.insertVersion({ ...version });

      const result = await store.findVersions(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]?.change_summary).toBeUndefined();
    });

    it("AC-STORE-009.01: findMany handles 100 docs with type+status filters", async () => {
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
      for (const d of docs) await store.insert(d);

      const result = await store.findMany({ type: "spec", status: "draft" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const doc of result.value) {
        expect(doc.type).toBe("spec");
        expect(doc.status).toBe("draft");
      }
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

  // SPEC-034 §3: review_judgments + calibration_records store methods
  describe("review judgments + calibration (SPEC-034)", () => {
    it("HAPPY: insertJudgment + findJudgments round-trip", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-judgment-doc" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const judgment = makeJudgment(doc.value.id);
      const insertResult = await store.insertJudgment(judgment);
      expect(insertResult.ok).toBe(true);

      const found = await store.findJudgments(doc.value.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(1);
      expect(found.value[0]).toEqual(judgment);
    });

    it("HAPPY: findJudgments orders newest first (created_at DESC)", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-judgment-order" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const older = makeJudgment(doc.value.id, { created_at: "2026-06-01T00:00:00.000Z" });
      const newer = makeJudgment(doc.value.id, { created_at: "2026-06-08T00:00:00.000Z" });
      await store.insertJudgment(older);
      await store.insertJudgment(newer);

      const found = await store.findJudgments(doc.value.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value.map((j) => j.id)).toEqual([newer.id, older.id]);
    });

    it("HAPPY: latestJudgment returns the most recent judgment", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-latest-judgment" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const older = makeJudgment(doc.value.id, { created_at: "2026-06-01T00:00:00.000Z" });
      const newer = makeJudgment(doc.value.id, { created_at: "2026-06-08T00:00:00.000Z" });
      await store.insertJudgment(older);
      await store.insertJudgment(newer);

      const latest = await store.latestJudgment(doc.value.id);
      expect(latest.ok).toBe(true);
      if (!latest.ok) return;
      expect(latest.value?.id).toBe(newer.id);
    });

    it("BOUNDARY: latestJudgment returns null when no judgment exists for the doc", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-no-judgment" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const latest = await store.latestJudgment(doc.value.id);
      expect(latest.ok).toBe(true);
      if (!latest.ok) return;
      expect(latest.value).toBeNull();
    });

    it("BOUNDARY: findJudgments returns an empty array for a doc with no judgments", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-empty-judgments" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const found = await store.findJudgments(doc.value.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toEqual([]);
    });

    it("REGRESSION: findJudgments returns independent copies — mutating result does not affect stored state", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-judgment-copy" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      await store.insertJudgment(makeJudgment(doc.value.id));

      const found = await store.findJudgments(doc.value.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      const [judgment] = found.value;
      expect(judgment).toBeDefined();
      if (!judgment) return;
      (judgment as ReviewJudgment).decision = "reject";

      const found2 = await store.findJudgments(doc.value.id);
      expect(found2.ok).toBe(true);
      if (!found2.ok) return;
      expect(found2.value[0]?.decision).toBe("approve");
    });

    it("HAPPY: insertCalibrationRecord + queryCalibrationWindow round-trip", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-calibration-doc" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const judgment = makeJudgment(doc.value.id);
      await store.insertJudgment(judgment);

      const record = makeCalibrationRecord(judgment.id, doc.value.id);
      const insertResult = await store.insertCalibrationRecord(record);
      expect(insertResult.ok).toBe(true);

      const found = await store.queryCalibrationWindow({ limit: 10 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(1);
      expect(found.value[0]).toEqual(record);
    });

    it("HAPPY: queryCalibrationWindow filters by doc_type", async () => {
      const specDoc = await store.insert(makeDoc({ slug: "spec-calib-type-a", type: "spec", role: "spec" }));
      const prdDoc = await store.insert(makeDoc({ slug: "prd-calib-type-b", type: "prd", role: "intent" }));
      expect(specDoc.ok && prdDoc.ok).toBe(true);
      if (!specDoc.ok || !prdDoc.ok) return;

      const specJudgment = makeJudgment(specDoc.value.id);
      const prdJudgment = makeJudgment(prdDoc.value.id);
      await store.insertJudgment(specJudgment);
      await store.insertJudgment(prdJudgment);
      await store.insertCalibrationRecord(
        makeCalibrationRecord(specJudgment.id, specDoc.value.id, { doc_type: "spec" }),
      );
      await store.insertCalibrationRecord(
        makeCalibrationRecord(prdJudgment.id, prdDoc.value.id, { doc_type: "prd" }),
      );

      const found = await store.queryCalibrationWindow({ doc_type: "spec", limit: 10 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(1);
      expect(found.value[0]?.doc_type).toBe("spec");
    });

    it("HAPPY: queryCalibrationWindow filters by prompt_version via the judgment join", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-calib-prompt-version" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const judgmentV1 = makeJudgment(doc.value.id, {
        judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" },
      });
      const judgmentV2 = makeJudgment(doc.value.id, {
        judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v2" },
      });
      await store.insertJudgment(judgmentV1);
      await store.insertJudgment(judgmentV2);
      await store.insertCalibrationRecord(makeCalibrationRecord(judgmentV1.id, doc.value.id));
      await store.insertCalibrationRecord(makeCalibrationRecord(judgmentV2.id, doc.value.id));

      const found = await store.queryCalibrationWindow({ prompt_version: "v1", limit: 10 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(1);
      expect(found.value[0]?.judgment_id).toBe(judgmentV1.id);
    });

    it("BOUNDARY: queryCalibrationWindow respects the limit bound", async () => {
      const doc = await store.insert(makeDoc({ slug: "spec-calib-limit" }));
      expect(doc.ok).toBe(true);
      if (!doc.ok) return;

      const judgment = makeJudgment(doc.value.id);
      await store.insertJudgment(judgment);

      for (let i = 0; i < 5; i += 1) {
        await store.insertCalibrationRecord(
          makeCalibrationRecord(judgment.id, doc.value.id, {
            created_at: `2026-06-0${i + 1}T00:00:00.000Z`,
          }),
        );
      }

      const found = await store.queryCalibrationWindow({ limit: 2 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toHaveLength(2);
      // Newest first
      expect(found.value[0]?.created_at).toBe("2026-06-05T00:00:00.000Z");
    });

    it("BOUNDARY: queryCalibrationWindow returns an empty array when nothing matches", async () => {
      const found = await store.queryCalibrationWindow({ limit: 10 });
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toEqual([]);
    });
  });
});
