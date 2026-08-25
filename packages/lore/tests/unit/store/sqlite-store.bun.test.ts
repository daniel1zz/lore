/** @spec_ref AC-STORE-001 */
/**
 * Tests for SQLiteStore — bun:sqlite via Vitest (in-memory, no file I/O).
 *
 * Spec references (SPEC-LORE-STORE-001):
 *   AC-STORE-001: insert + find (by id, by slug)
 *   AC-STORE-002: update + versioning
 *   AC-STORE-003: soft delete lifecycle
 *   AC-STORE-004: duplicate slug rejection
 *   AC-STORE-005: link management + cycle detection
 *   AC-STORE-006: FTS5 search
 *   AC-STORE-007: version history
 *   AC-STORE-008: audit log
 *   AC-STORE-009: findMany filters
 *
 * Test design techniques applied:
 *   EP: valid/invalid inserts, filter combinations
 *   BVA: empty query, limit/offset boundaries, empty arrays
 *   Decision Table: direction='in'|'out'|'both', exclude_deleted=true|false
 *   State Transition: soft-delete lifecycle, parent-cycle detection
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { formatError } from "../../../src/adapters/cli/utils.js";
import type {
  AuditEntry,
  CalibrationRecord,
  DocRecord,
  LinkRecord,
  LoreError,
  ReviewJudgment,
  VersionRecord,
} from "@lore/core";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(): string {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return `01HTEST${padded}`;
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
    // reason: SPEC-044 D3 — explicit here (not omitted-then-`?? "review"`-defaulted) so
    // this fixture's round-trip through insertJudgment/findJudgments/rowToReviewJudgment
    // stays byte-identical (the store layer always persists a concrete "review"/
    // "staleness" string, never leaves the column conceptually "absent").
    kind: "review",
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

describe("SQLiteStore", () => {
  let store: SQLiteStore;

  beforeEach(() => {
    _counter = 0;
    store = new SQLiteStore(":memory:");
  });

  afterEach(() => {
    store.close();
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

    it("SPEC-065 D2: findByIdPrefix resolves a unique 10-char prefix", async () => {
      const doc = makeDoc({ id: "01HZUNIQUE0000000000000001", slug: "prd-unique-prefix" });
      await store.insert(doc);

      const result = await store.findByIdPrefix(doc.id.slice(0, 10));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((d) => d.id)).toEqual([doc.id]);
    });

    it("SPEC-065 D2: findByIdPrefix is case-insensitive (mirrors SQLite's default ASCII LIKE)", async () => {
      const doc = makeDoc({ id: "01HZCASEINS0000000000000001", slug: "prd-case-insensitive" });
      await store.insert(doc);

      const result = await store.findByIdPrefix(doc.id.slice(0, 10).toLowerCase());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((d) => d.id)).toEqual([doc.id]);
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

    it("AC-STORE-005.09 (regression, migration-004): addLink accepts link_type='governs'", async () => {
      // reason: links.link_type is enforced by a SQLite CHECK constraint
      // (migration-001), not just Zod — this is the store-level oracle proving
      // migration-004's widened CHECK actually applies to a freshly-created DB.
      const skill = makeDoc({ slug: "knowledge-governs-skill" });
      const artifact = makeDoc({ slug: "spec-governs-artifact" });
      await store.insert(skill);
      await store.insert(artifact);

      const link = makeLink(skill.id, artifact.id, "governs");
      const result = await store.addLink(link);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.link_type).toBe("governs");
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

    it("AC-STORE-006.01: search returns ranked results with snippets", async () => {
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

    it("addLink with type=parent creates link record in links table", async () => {
      const parent = makeDoc({ slug: "prd-par" });
      const child = makeDoc({
        slug: "spec-child",
        type: "spec",
        role: "spec",
      });
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

    it("SPEC-065 D2: findByIdPrefix on a non-matching prefix returns an empty array (not an error)", async () => {
      const result = await store.findByIdPrefix("01HZNOMATCH");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it("SPEC-065 D2: findByIdPrefix returns every matching doc when the prefix is ambiguous", async () => {
      const a = makeDoc({ id: "01HZAMBIGAAAA0000000000001", slug: "prd-ambig-a" });
      const b = makeDoc({ id: "01HZAMBIGBBBB0000000000002", slug: "prd-ambig-b" });
      await store.insert(a);
      await store.insert(b);

      const result = await store.findByIdPrefix("01HZAMBIG");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
    });

    it("SPEC-065 D2: findByIdPrefix excludes soft-deleted docs, mirroring findMany's default", async () => {
      const doc = makeDoc({ id: "01HZSOFTDEL0000000000000001", slug: "prd-soft-deleted" });
      await store.insert(doc);
      await store.softDelete(doc.id);

      const result = await store.findByIdPrefix(doc.id.slice(0, 10));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it("AC-STORE-002.N01: update on missing id returns DOC_NOT_FOUND", async () => {
      const result = await store.update("01HNOTEXIST0000000000000", {
        title: "x",
      });
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

    it("AC-STORE-005.11 (REGRESSION, audit 2026-07-27 spec-corpus-schema §4.3): 2-node parent cycle formed via docs.parent_id only (no links row — mirrors `lore create --parent`) is rejected on link close", async () => {
      const root = makeDoc({ slug: "prd-pid-cycle-root" });
      await store.insert(root);
      // `lore create --parent` writes ONLY docs.parent_id — never an
      // addLink call, so no row lands in `links`. Reproduced here by
      // setting parent_id directly on the inserted doc instead of going
      // through addLink, exactly like CorpusService.create's --parent path.
      const child = makeDoc({ slug: "prd-pid-cycle-child", parent_id: root.id });
      await store.insert(child);

      // Sanity: the links table has NO row for this pair — a cycle
      // detector that only walked `links` would see nothing here and miss
      // the cycle below entirely (the exact audit hole).
      const outLinks = await store.findLinks(child.id, "out");
      expect(outLinks.ok).toBe(true);
      if (outLinks.ok) expect(outLinks.value).toHaveLength(0);

      // Attempt to close the cycle: root's parent = child.
      const result = await store.addLink(makeLink(root.id, child.id, "parent"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
    });

    it("AC-STORE-005.12 (REGRESSION): deeper 3-node parent cycle via docs.parent_id-only chain (zero links rows) is rejected", async () => {
      const a = makeDoc({ slug: "prd-pid-3c-a" });
      await store.insert(a);
      const b = makeDoc({ slug: "prd-pid-3c-b", parent_id: a.id });
      await store.insert(b);
      const c = makeDoc({ slug: "prd-pid-3c-c", parent_id: b.id });
      await store.insert(c);

      // No addLink calls above — the entire A←B←C chain exists only as
      // docs.parent_id. Confirm the links table is empty for this fixture.
      const links = await store.findLinks(a.id, "in");
      expect(links.ok).toBe(true);
      if (links.ok) expect(links.value).toHaveLength(0);

      // a → c would close a→c→b→a.
      const result = await store.addLink(makeLink(a.id, c.id, "parent"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
    });

    it("AC-STORE-005.13 (HAPPY / legal reparent): a doc with an existing docs.parent_id-only ancestor chain can be relinked to an unrelated parent", async () => {
      const a = makeDoc({ slug: "prd-pid-legal-a" });
      await store.insert(a);
      const b = makeDoc({ slug: "prd-pid-legal-b", parent_id: a.id });
      await store.insert(b);
      const unrelated = makeDoc({ slug: "prd-pid-legal-unrelated" });
      await store.insert(unrelated);

      // b is not an ancestor of `unrelated` — no cycle; must succeed.
      const result = await store.addLink(makeLink(b.id, unrelated.id, "parent"));
      expect(result.ok).toBe(true);
    });

    it("AC-STORE-005.14 (STATE/ERROR): a rejected cycle-closing link leaves docs.parent_id and the links table unchanged, and reports a well-formed path", async () => {
      const root = makeDoc({ slug: "prd-pid-noop-root" });
      await store.insert(root);
      const child = makeDoc({ slug: "prd-pid-noop-child", parent_id: root.id });
      await store.insert(child);

      const result = await store.addLink(makeLink(root.id, child.id, "parent"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
      if (result.error.code !== "LINK_CYCLE") return;
      expect(result.error.path[0]).toBe(root.id);
      expect(result.error.path).toContain(child.id);

      // No partial write: root's parent_id is still null, no links row exists.
      const rootAfter = await store.find(root.id);
      expect(rootAfter.ok).toBe(true);
      if (rootAfter.ok) expect(rootAfter.value?.parent_id).toBeNull();

      const outLinks = await store.findLinks(root.id, "out");
      expect(outLinks.ok).toBe(true);
      if (outLinks.ok) expect(outLinks.value).toHaveLength(0);
    });

    it("AC-STORE-005.10: self-referencing parent link A→A rejected with LINK_CYCLE", async () => {
      const a = makeDoc({ slug: "prd-self-cyc-a" });
      await store.insert(a);

      // a's parent = a → self-cycle, must be rejected even with no
      // pre-existing outgoing parent link on a.
      const result = await store.addLink(makeLink(a.id, a.id, "parent"));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
      if (result.error.code !== "LINK_CYCLE") return;
      expect(result.error.path).toEqual([a.id]);
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

  // ── Search (FTS5) ──────────────────────────────────────────────────────────

  describe("search (FTS5)", () => {
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

    it("search returns snippet string from content column", async () => {
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
      expect(hit!.snippet).toContain("retrogradation");
      expect(hit!.snippet).not.toContain("[");
      expect(hit!.snippet).not.toContain("]");
    });

    // A document whose body contains literal '[brackets]' must not have them
    // misread as highlight markers — only the real FTS match is wrapped.
    it("AC-37-8: literal brackets in doc content are not treated as highlight markers", async () => {
      const doc = makeDoc({
        slug: "prd-literal-brackets",
        title: "Literal Brackets Test",
        content:
          "See the migrationflowchart [figure 3] for the full walkthrough of the system.",
      });
      await store.insert(doc);

      const result = await store.search("walkthrough");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const hit = result.value.find((h) => h.id === doc.id);
      expect(hit).toBeDefined();
      // The literal brackets around "figure 3" survive untouched...
      expect(hit!.snippet).toContain("[figure 3]");
      // ...while the real match is wrapped in sentinels, not brackets.
      expect(hit!.snippet).toContain("walkthrough");
    });

    // SPEC-037 §2 — SearchHit now carries type + status from the docs join
    it("AC-37-8: hits carry the doc's type and status (zero extra query)", async () => {
      const doc = makeDoc({
        slug: "spec-hit-meta",
        title: "Hit Metadata Test",
        content: "Covers the metadata propagation requirement end to end.",
        type: "spec",
        role: "spec",
        status: "approved",
      });
      await store.insert(doc);

      const result = await store.search("metadata");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const hit = result.value.find((h) => h.id === doc.id);
      expect(hit).toBeDefined();
      expect(hit!.type).toBe("spec");
      expect(hit!.status).toBe("approved");
    });
  });

  // ── Regression ────────────────────────────────────────────────────────────

  describe("regression", () => {
    // Regression: insert must not mutate the input doc object (immutability)
    it("insert does not mutate the input doc record", async () => {
      const doc = makeDoc({ slug: "prd-reg-immut" });
      const originalTitle = doc.title;
      await store.insert(doc);
      expect(doc.title).toBe(originalTitle);
    });

    // Regression: findMany with no filters should not crash
    it("AC-STORE-009.03: findMany with empty filters does not throw", async () => {
      const result = await store.findMany({});
      expect(result.ok).toBe(true);
    });

    // Regression: FTS5 update trigger keeps index in sync after content update
    it("FTS index updated after doc update — search finds new content", async () => {
      const doc = makeDoc({
        slug: "prd-fts-update",
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

    // Regression: queryAudit with no filters returns all entries
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

    // Regression: change_summary is optional in VersionRecord — must round-trip as undefined
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

    // Regression: large batch insert + filter — no memory issues
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
  });

  // ── Optimistic Locking (CAS) — RED scenarios ───────────────────────────────
  //
  // @spec_ref AC-STORE-CAS-001
  // Contract: StoreInterface.update(id, patch, opts?) with opts.expected_version.
  // Source: src/store/store-interface.ts JSDoc for UpdateOpts, SPEC-009 §4.2, D-002.
  //
  // Tests CAS-01 – CAS-04 against SQLiteStore (same contract as InMemoryStore).
  // CAS-02 and CAS-BOUND-01 are RED until conditional UPDATE lands in SQLiteStore.
  // CAS-01, CAS-03, CAS-04 are GREEN today (unconditional update, missing doc).

  describe("optimistic locking (CAS)", () => {
    describe("happy path", () => {
      it("CAS-01 SQLite: version match → ok, patch applied", async () => {
        // HAPPY: expected_version matches stored version → conditional update succeeds.
        const doc = makeDoc({ slug: "prd-cas-sqlite-v3", version: 3 });
        await store.insert(doc);

        const result = await store.update(
          doc.id,
          { content: "CAS updated content", updated_at: "2026-06-11T01:00:00.000Z" },
          { expected_version: 3 },
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.content).toBe("CAS updated content");
        // Store does NOT own version increment — patch did not include version, so it stays at 3
        expect(result.value.version).toBe(3);
      });
    });

    describe("negative cases", () => {
      it("CAS-02 SQLite: version mismatch → err STALE_VERSION with {id, expected, actual}", async () => {
        // NEGATIVE: concurrent writer advanced version to 4; caller expected v3.
        // SQLiteStore must return STALE_VERSION — RED until conditional UPDATE implemented.
        const doc = makeDoc({ slug: "prd-cas-sqlite-v4", version: 4 });
        await store.insert(doc);

        const result = await store.update(
          doc.id,
          { content: "stale write" },
          { expected_version: 3 }, // actual is v4
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.error.code).toBe("STALE_VERSION");
        if (result.error.code !== "STALE_VERSION") return;
        expect(result.error.id).toBe(doc.id);
        expect(result.error.expected).toBe(3);
        expect(result.error.actual).toBe(4);
      });

      it("CAS-03 SQLite: doc missing + expected_version → DOC_NOT_FOUND (NOT STALE_VERSION)", async () => {
        // NEGATIVE: non-existent document — must return DOC_NOT_FOUND regardless of expected_version.
        const missingId = "01HMISSINGSQLITE0000CASTEST";

        const result = await store.update(
          missingId,
          { content: "ghost write" },
          { expected_version: 1 },
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DOC_NOT_FOUND");
        expect(result.error.code).not.toBe("STALE_VERSION");
      });
    });

    describe("boundary values", () => {
      it("CAS-BOUND-01 SQLite: expected_version=0 → STALE_VERSION (docs start at v1)", async () => {
        // BOUNDARY: v0 never matches a real document (minimum version is 1).
        const doc = makeDoc({ slug: "prd-cas-sqlite-v1-bv", version: 1 });
        await store.insert(doc);

        const result = await store.update(
          doc.id,
          { content: "v0 update attempt" },
          { expected_version: 0 },
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("STALE_VERSION");
      });
    });

    describe("regression — legacy unconditional semantics preserved", () => {
      it("CAS-04 SQLite: no opts → unconditional update succeeds", async () => {
        // REGRESSION: existing callers pass no opts — backward-compatibility must be preserved.
        // Expected to pass TODAY (before CAS implementation).
        const doc = makeDoc({ slug: "prd-cas-sqlite-legacy", version: 7 });
        await store.insert(doc);

        const result = await store.update(doc.id, {
          content: "unconditional sqlite update",
          updated_at: "2026-06-11T02:00:00.000Z",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.content).toBe("unconditional sqlite update");
      });

      it("CAS-04b SQLite: opts={} (empty) → unconditional update", async () => {
        // REGRESSION: empty opts object should behave like no opts.
        const doc = makeDoc({ slug: "prd-cas-sqlite-emptyopts", version: 2 });
        await store.insert(doc);

        const result = await store.update(
          doc.id,
          { title: "empty opts update" },
          {}, // no expected_version key
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.title).toBe("empty opts update");
      });
    });
  });
});

// ─── FTS5 Special-Token Escape — SPEC-013 §3.5 ───────────────────────────────
//
// @spec_ref AC-STORE-FTS-001
//
// These tests verify that SQLiteStore.search() safely handles FTS5-special input
// tokens (hyphens, wildcards, colons, parentheses) that would previously cause a
// raw SQLite FTS5 MATCH syntax error to propagate as a thrown exception.
//
// After the escapeFtsQuery fix is applied in SQLiteStore, all probes below must
// return Result.ok (never throw / never return Result.err for syntax reasons).
//
// Test design:
//   HAPPY  — hyphen query matches docs containing that hyphenated token
//   HAPPY  — multi-word AND semantics work post-escape
//   BOUNDARY — empty / whitespace-only query short-circuits to ok([])
//   ERROR  — historically crashing inputs surface as ok (never err from SQL error)
//   REGRESSION — "append-only" canonical case matched correctly
//   STATE  — store returns consistent results across repeated calls

describe("SQLiteStore.search — FTS5 special-token escape (SPEC-013 §3.5)", () => {
  let store: SQLiteStore;

  // Each test gets a fresh in-memory store — matches the pattern used above.
  beforeEach(() => {
    _counter = 0;
    store = new SQLiteStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  // ── Happy Path ──────────────────────────────────────────────────────────────

  it("FTS-HAPPY-01: returns ok() for query containing hyphen (append-only)", async () => {
    const doc = makeDoc({
      slug: "spec-fts-hyphen",
      title: "Append-Only Journal Design",
      content: "This spec covers the append-only journal for the version store.",
      type: "spec",
      role: "spec",
    });
    await store.insert(doc);

    const result = await store.search("append-only");
    expect(result.ok).toBe(true);
    // Must find the doc containing the hyphenated token
    if (!result.ok) return;
    const ids = result.value.map((h) => h.id);
    expect(ids).toContain(doc.id);
  });

  it("FTS-HAPPY-02: hyphenated query does NOT match doc that lacks the hyphenated form", async () => {
    // Doc A has "append-only" as a true hyphenated word.
    // Doc B has the words separately in a sentence — FTS5 phrase semantics
    // ensure "append-only" (after escaping to '"append-only"') matches the
    // concatenated token, not split words.
    const docA = makeDoc({
      slug: "spec-fts-h-a",
      title: "Append-Only Store",
      content: "Uses an append-only journal for durability.",
      type: "spec",
      role: "spec",
    });
    const docB = makeDoc({
      slug: "spec-fts-h-b",
      title: "Storage Notes",
      content: "We should not append data. Only log relevant deltas.",
      type: "spec",
      role: "spec",
    });
    await store.insert(docA);
    await store.insert(docB);

    const result = await store.search("append-only");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.map((h) => h.id);
    // docA must appear (has the literal hyphenated token)
    expect(ids).toContain(docA.id);
    // docB must NOT appear (split sentence, not hyphenated token)
    expect(ids).not.toContain(docB.id);
  });

  it("FTS-HAPPY-03: prefix wildcard query (foo*) returns ok — no SQL error", async () => {
    // After the fix, "foo*" is wrapped as '"foo*"'. FTS5 allows * at end of
    // a quoted phrase for prefix matching. Result may be 0 hits but must not
    // be an error.
    const result = await store.search("foo*");
    expect(result.ok).toBe(true);
    // Zero hits is acceptable — the critical assertion is no SQL error
  });

  it("FTS-HAPPY-04: multi-word query uses AND semantics — returns only docs with both terms", async () => {
    // Doc A has BOTH "service" and "layer" in content.
    // Doc B has ONLY "service".
    // search("service layer") must return A but NOT B.
    const docA = makeDoc({
      slug: "spec-fts-and-a",
      title: "Service Layer Design",
      content: "The service layer handles all business logic.",
      type: "spec",
      role: "spec",
    });
    const docB = makeDoc({
      slug: "spec-fts-and-b",
      title: "Service Overview",
      content: "Overview of the service module without further details.",
      type: "spec",
      role: "spec",
    });
    await store.insert(docA);
    await store.insert(docB);

    const result = await store.search("service layer");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.map((h) => h.id);
    expect(ids).toContain(docA.id);
    expect(ids).not.toContain(docB.id);
  });

  // ── Boundary Values ─────────────────────────────────────────────────────────

  it("FTS-BOUNDARY-01: empty string query returns ok([]) without hitting FTS", async () => {
    // Short-circuit: escapeFtsQuery("") === "" → caller must skip MATCH → return []
    const result = await store.search("");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("FTS-BOUNDARY-02: whitespace-only query returns ok([]) without hitting FTS", async () => {
    // "   \t\n  " trims to "" — same short-circuit as empty string
    const result = await store.search("   \t\n  ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  // ── Error / No-Throw ────────────────────────────────────────────────────────

  it("FTS-ERROR-01: historically problematic inputs never cause thrown SQL error or Result.err", async () => {
    // Before the fix, FTS5-special tokens triggered a SQL syntax error that propagated
    // as a thrown exception. After the fix, ALL inputs return Result (never throw).
    // We specifically target inputs that FTS5 interprets as operators without quoting.
    const probes = [
      "append-only",   // hyphen = FTS5 NOT operator
      "real-world",    // hyphen in different context
      "foo*",          // naked wildcard
      "bar?",          // question mark (FTS5 fuzzy in some builds)
      "(parens)",      // grouping syntax
      "a:b",           // FTS5 column filter syntax
      "AND",           // FTS5 boolean operator keyword
      "OR",            // FTS5 boolean operator keyword
      "NOT",           // FTS5 boolean operator keyword
      "-term",         // leading hyphen = NOT
    ];

    for (const q of probes) {
      const r = await store.search(q, {});
      expect(
        r.ok,
        `search("${q}") must return ok (not throw). Got: ${JSON.stringify(!r.ok && r)}`,
      ).toBe(true);
    }
  });

  // ── Regression ──────────────────────────────────────────────────────────────

  it("REGRESSION FTS-REG-01: 'append-only' canonical case — finds doc, does not throw", async () => {
    // This is the exact scenario from the bug report: searching for a hyphenated
    // term previously crashed SQLiteStore with an FTS5 syntax error.
    const doc = makeDoc({
      slug: "spec-fts-reg-hyphen",
      title: "Version Store Spec",
      content: "The store uses an append-only log for version history.",
      type: "spec",
      role: "spec",
    });
    await store.insert(doc);

    // Must not throw; must be ok; must contain the doc
    const result = await store.search("append-only");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((h) => h.id)).toContain(doc.id);
  });

  it("REGRESSION FTS-REG-02: empty query short-circuit works regardless of docs in store", async () => {
    // Insert a doc so the store is non-empty — verify short-circuit still works
    const doc = makeDoc({
      slug: "spec-fts-reg-empty",
      title: "Some Doc",
      content: "Some content here.",
    });
    await store.insert(doc);

    const result = await store.search("");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  // ── State ───────────────────────────────────────────────────────────────────

  it("FTS-STATE-01: repeated searches with same query return consistent results", async () => {
    const doc = makeDoc({
      slug: "spec-fts-state",
      title: "Idempotent Search",
      content: "real-world usage of the FTS system.",
      type: "spec",
      role: "spec",
    });
    await store.insert(doc);

    const first = await store.search("real-world");
    const second = await store.search("real-world");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Same set of IDs in same order
    expect(first.value.map((h) => h.id)).toEqual(second.value.map((h) => h.id));
  });
});

// AC-STORE-010: dbSizeBytes — real on-disk size via PRAGMA page_count * page_size.
// Uses a real temp file (not ":memory:") so the byte count reflects actual disk usage.
describe("SQLiteStore.dbSizeBytes (AC-STORE-010)", () => {
  let tempDir: string;
  let dbPath: string;
  let store: SQLiteStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-db-size-"));
    dbPath = join(tempDir, "test.db");
    store = new SQLiteStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("HAPPY: reports > 0 bytes for a freshly-migrated temp db (schema pages alone occupy disk space)", async () => {
    const result = await store.dbSizeBytes();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeGreaterThan(0);
  });

  it("STATE: reports a larger size after inserting documents than an empty schema-only db", async () => {
    const before = await store.dbSizeBytes();
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    for (let i = 0; i < 20; i += 1) {
      await store.insert(
        makeDoc({
          slug: `prd-size-${i}`,
          content: "x".repeat(2000),
        }),
      );
    }

    const after = await store.dbSizeBytes();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value).toBeGreaterThanOrEqual(before.value);
  });

  it("BOUNDARY: value equals PRAGMA page_count * PRAGMA page_size exactly", async () => {
    const db = store.getDatabase();
    const { page_count: pageCount } = db.query("PRAGMA page_count").get() as {
      page_count: number;
    };
    const { page_size: pageSize } = db.query("PRAGMA page_size").get() as {
      page_size: number;
    };

    const result = await store.dbSizeBytes();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(pageCount * pageSize);
  });
});

// SPEC-034 §3: review_judgments + calibration_records store methods.
// PRAGMA foreign_keys = ON is set in SQLiteStore.init() — every judgment/calibration
// insert below first inserts a real parent doc (and, for calibration, a real judgment)
// to satisfy the FOREIGN KEY REFERENCES docs(id) / review_judgments(id) constraints.
describe("SQLiteStore — review judgments + calibration (SPEC-034)", () => {
  let store: SQLiteStore;

  beforeEach(() => {
    _counter = 0;
    store = new SQLiteStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

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

  it("ERROR: insertJudgment on a non-existent doc_id violates the foreign key and reports STORE_ERROR", async () => {
    const judgment = makeJudgment("01HNOPE00000000000000001");
    const result = await store.insertJudgment(judgment);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
  });

  it("STATE: escalate decision with blocking_questions round-trips through storage intact", async () => {
    const doc = await store.insert(makeDoc({ slug: "spec-escalate-judgment" }));
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;

    const judgment = makeJudgment(doc.value.id, {
      decision: "escalate",
      blocking_questions: ["Is AC-7 in scope?"],
    });
    await store.insertJudgment(judgment);

    const latest = await store.latestJudgment(doc.value.id);
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(latest.value?.decision).toBe("escalate");
    expect(latest.value?.blocking_questions).toEqual(["Is AC-7 in scope?"]);
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
    // reason: queryCalibrationWindow now unconditionally projects the judgment's
    // judge_prompt_version onto the returned row — the plain CalibrationRecord
    // fields still round-trip verbatim via toMatchObject, and the projected field
    // is asserted separately against the judgment it was joined from.
    expect(found.value[0]).toMatchObject(record);
    expect(found.value[0]?.judge_prompt_version).toBe(judgment.judge.prompt_version);
  });

  it("HAPPY: queryCalibrationWindow filters by doc_type", async () => {
    const specDoc = await store.insert(
      makeDoc({ slug: "spec-calib-type-a", type: "spec", role: "spec" }),
    );
    const prdDoc = await store.insert(
      makeDoc({ slug: "prd-calib-type-b", type: "prd", role: "intent" }),
    );
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

  it("HAPPY: queryCalibrationWindow filters by prompt_version via the review_judgments JOIN", async () => {
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

  it("HAPPY: queryCalibrationWindow projects judge_prompt_version onto EVERY row, even fully unfiltered", async () => {
    const doc = await store.insert(makeDoc({ slug: "spec-calib-projection" }));
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

    // No prompt_version filter at all — the join must still run and project the
    // REAL prompt_version onto each row (no "*" sentinel, no undefined field).
    const found = await store.queryCalibrationWindow({ limit: 10 });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toHaveLength(2);
    const byJudgmentId = new Map(found.value.map((r) => [r.judgment_id, r.judge_prompt_version]));
    expect(byJudgmentId.get(judgmentV1.id)).toBe("v1");
    expect(byJudgmentId.get(judgmentV2.id)).toBe("v2");
  });

  it("BOUNDARY: queryCalibrationWindow respects the limit bound, newest first", async () => {
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
    expect(found.value[0]?.created_at).toBe("2026-06-05T00:00:00.000Z");
  });

  it("BOUNDARY: queryCalibrationWindow returns an empty array when nothing matches", async () => {
    const found = await store.queryCalibrationWindow({ limit: 10 });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toEqual([]);
  });

  it("ERROR: insertCalibrationRecord on a non-existent judgment_id violates the foreign key and reports STORE_ERROR", async () => {
    const doc = await store.insert(makeDoc({ slug: "spec-calib-bad-judgment" }));
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;

    const record = makeCalibrationRecord("01HNOPE00000000000000002", doc.value.id);
    const result = await store.insertCalibrationRecord(record);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
  });
});

// ─── DUPLICATE_SLUG.existing_id names the WINNER, never the rejected doc ─────
// task-skill-implement-duplicate-slug-existing-id-names-the
//
// ⛔ These cases MUST run under `bun test` against the real SQLiteStore:
//   cd packages/lore && bun test tests/unit/store/sqlite-store.bun.test.ts
// A vitest run cannot judge this. The two stores that got the field wrong
// (SQLiteStore, TursoStore) are the two that need a real database; the one that
// got it right is InMemoryStore — the test double every vitest unit test uses,
// so every vitest assertion about this field was green while both SQL-backed
// stores were reporting an id that resolved to nothing.

/** The DUPLICATE_SLUG member of the `LoreError` union (`packages/core/src/errors.ts:15`). */
type DuplicateSlugError = Extract<LoreError, { code: "DUPLICATE_SLUG" }>;

/**
 * The AC-1 assertion, factored so every insert entry point asserts the SAME
 * property: `existing_id` must RESOLVE to a persisted doc that holds the
 * colliding slug.
 *
 * ⛔ An id-SHAPED string is not a passing condition — the pre-fix defect
 * returned `doc.id` (the rejected doc's own freshly generated, never-persisted
 * ULID), which is perfectly id-shaped and resolved to DOC_NOT_FOUND every
 * single time. Hence the `store.find()` round trip plus the slug equality
 * check, and the explicit `not.toBe(loser.id)` disqualifier.
 */
async function expectExistingIdNamesTheWinner(
  store: SQLiteStore,
  error: DuplicateSlugError,
  winner: DocRecord,
  loser: DocRecord,
): Promise<void> {
  expect(error.slug).toBe(winner.slug);

  // Resolution is asserted BEFORE identity on purpose: it is the assertion
  // with the discriminating power ("an id-shaped string is not a passing
  // condition"), so it is the one a future red must quote.
  const resolved = await store.find(error.existing_id);
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  expect(
    resolved.value,
    `existing_id ${error.existing_id} resolved to NO doc — the field promises the id of the doc ` +
      `already holding '${error.slug}' (expected the winner ${winner.id}), so an unresolvable ` +
      `value is the false label this fix closes`,
  ).not.toBeNull();
  expect(resolved.value?.slug).toBe(winner.slug);

  expect(error.existing_id).toBe(winner.id);
  expect(error.existing_id).not.toBe(loser.id);
}

describe("SQLiteStore — DUPLICATE_SLUG.existing_id names the winner (task-skill-implement-duplicate-slug-existing-id-names-the)", () => {
  let store: SQLiteStore;

  beforeEach(() => {
    _counter = 0;
    store = new SQLiteStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  const CONFLICT_SLUG = "prd-existing-id-conflict";

  it("AC-1.01 (insert): existing_id resolves to the doc already holding the slug", async () => {
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    const seeded = await store.insert(winner);
    expect(seeded.ok).toBe(true);

    const result = await store.insert(loser);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DUPLICATE_SLUG");
    if (result.error.code !== "DUPLICATE_SLUG") return;

    await expectExistingIdNamesTheWinner(store, result.error, winner, loser);
  });

  it("AC-1.02 (insertWithAllocatedOrdinal): existing_id resolves to the doc already holding the slug", async () => {
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    expect((await store.insert(winner)).ok).toBe(true);

    const result = await store.insertWithAllocatedOrdinal(loser);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DUPLICATE_SLUG");
    if (result.error.code !== "DUPLICATE_SLUG") return;

    await expectExistingIdNamesTheWinner(store, result.error, winner, loser);
  });

  it("AC-1.03 (insertWithProvenance): existing_id resolves to the doc already holding the slug", async () => {
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    expect((await store.insert(winner)).ok).toBe(true);

    const result = await store.insertWithProvenance(
      loser,
      makeVersion(loser.id, 1),
      makeAuditEntry(loser.id),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DUPLICATE_SLUG");
    if (result.error.code !== "DUPLICATE_SLUG") return;

    await expectExistingIdNamesTheWinner(store, result.error, winner, loser);
  });

  it("AC-1.04 (insertWithAllocatedOrdinalAndProvenance): existing_id resolves to the doc already holding the slug", async () => {
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    expect((await store.insert(winner)).ok).toBe(true);

    const result = await store.insertWithAllocatedOrdinalAndProvenance(
      loser,
      makeVersion(loser.id, 1),
      makeAuditEntry(loser.id),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DUPLICATE_SLUG");
    if (result.error.code !== "DUPLICATE_SLUG") return;

    await expectExistingIdNamesTheWinner(store, result.error, winner, loser);
  });

  it("AC-1.05 BOUNDARY: a SOFT-DELETED holder still owns the slug, so existing_id names it", async () => {
    // reason: `docs.slug` is `TEXT NOT NULL UNIQUE` at the COLUMN level
    // (`store/migrations/migration-006.ts:103`) — not a partial index over
    // `deleted_at IS NULL`. A soft-deleted row therefore still holds its slug
    // and still raises the UNIQUE violation, so the conflict lookup MUST NOT
    // filter on `deleted_at` (this mirrors `InMemoryStore.findSlugConflict`,
    // which scans every doc including soft-deleted ones). This case is the
    // guard against a future session "tidying" a `WHERE deleted_at IS NULL`
    // into that lookup: the lookup would then find nothing while the UNIQUE
    // index still refuses the insert.
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    expect((await store.insert(winner)).ok).toBe(true);
    expect((await store.softDelete(winner.id)).ok).toBe(true);

    const result = await store.insert(loser);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DUPLICATE_SLUG");
    if (result.error.code !== "DUPLICATE_SLUG") return;

    // `find` is a direct-address lookup and applies NO soft-delete filter
    // (`store/store-interface.ts:414`), so the shared assertion holds unchanged.
    await expectExistingIdNamesTheWinner(store, result.error, winner, loser);
  });

  it("AC-4 SURFACE: formatError's rendered message names the WINNER's id, not the rejected doc's", async () => {
    // The user-visible half of the same false label:
    // `adapters/cli/utils.ts`'s DUPLICATE_SLUG branch renders
    // "already exists (used by <id>)" — a sentence that was false for every
    // SQL-backed store until this fix. Asserting the store alone would leave
    // the rendered surface uncovered.
    const winner = makeDoc({ slug: CONFLICT_SLUG });
    const loser = makeDoc({ slug: CONFLICT_SLUG });
    expect((await store.insert(winner)).ok).toBe(true);

    const result = await store.insert(loser);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const rendered = formatError(result.error);
    expect(rendered).toContain(`Slug '${CONFLICT_SLUG}' already exists`);
    expect(rendered).toContain(winner.id);
    expect(rendered).not.toContain(loser.id);
  });
});

describe("AC-3 SSOT: no store constructs DUPLICATE_SLUG from the REJECTED doc's own id", () => {
  const STORE_DIR = fileURLToPath(new URL("../../../src/store/", import.meta.url));
  const STORE_FILES_THAT_MUST_CONSTRUCT_IT = [
    "sqlite-store.ts",
    "turso-store.ts",
    "in-memory-store.ts",
  ] as const;

  /**
   * One construction site per store implementation, each fed by a real
   * conflict lookup. The count is asserted EXACTLY (not `<= 3`) so that a
   * fourth store — or a fifth site smuggled back into an existing one — fails
   * here and sends its author to this comment.
   */
  const EXPECTED_CONSTRUCTION_SITE_COUNT = 3;

  function scanStoreSources(): {
    scannedFiles: string[];
    rejectedDocIdSites: string[];
    constructionSites: string[];
  } {
    const scannedFiles = readdirSync(STORE_DIR).filter((name) => name.endsWith(".ts"));
    const rejectedDocIdSites: string[] = [];
    const constructionSites: string[] = [];

    for (const file of scannedFiles) {
      const lines = readFileSync(join(STORE_DIR, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        // reason: comment lines are skipped so that PROSE about this invariant
        // (including the why-comments this very fix added, which necessarily
        // quote the field name) never counts as a construction site — the
        // census must measure code, not documentation of code.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (!/existing_id\s*:/.test(line)) return;
        constructionSites.push(`${file}:${index + 1}`);
        if (/existing_id\s*:\s*doc\.id\b/.test(line)) {
          rejectedDocIdSites.push(`${file}:${index + 1}`);
        }
      });
    }
    return { scannedFiles, rejectedDocIdSites, constructionSites };
  }

  it("no store file assigns existing_id from the doc being inserted", () => {
    const { scannedFiles, rejectedDocIdSites } = scanStoreSources();

    // Positive control: without this, a renamed or empty directory would make
    // the census below vacuously true.
    for (const required of STORE_FILES_THAT_MUST_CONSTRUCT_IT) {
      expect(scannedFiles).toContain(required);
    }

    expect(
      rejectedDocIdSites,
      `existing_id must name the doc ALREADY HOLDING the slug, resolved by a conflict lookup — ` +
        `never \`doc.id\`, which is the id of the doc the UNIQUE constraint just rejected and which ` +
        `was therefore never persisted. Offending sites: ${rejectedDocIdSites.join(", ")}`,
    ).toEqual([]);
  });

  it("exactly one construction site per store implementation, and every store still has one", () => {
    const { constructionSites } = scanStoreSources();

    for (const required of STORE_FILES_THAT_MUST_CONSTRUCT_IT) {
      const sitesInFile = constructionSites.filter((site) => site.startsWith(`${required}:`));
      expect(
        sitesInFile.length,
        `${required} must construct DUPLICATE_SLUG at exactly ONE site (found ${sitesInFile.length}: ${sitesInFile.join(", ")})`,
      ).toBe(1);
    }

    expect(
      constructionSites.length,
      `Every DUPLICATE_SLUG construction site in src/store must resolve the WINNER's id through a ` +
        `conflict lookup — see SQLiteStore.findSlugConflictIdSync, TursoStore.findSlugConflictId, ` +
        `InMemoryStore.findSlugConflict. A new site here means a new store: give it a lookup and ` +
        `bump this count. Sites: ${constructionSites.join(", ")}`,
    ).toBe(EXPECTED_CONSTRUCTION_SITE_COUNT);
  });
});
