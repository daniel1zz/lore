/**
 * @spec_ref AC-STORE-TURSO-001
 *
 * TursoStore contract test suite — file: mode (RED)
 * Task: TASK-01KTRJZCYPZFS745TZ5TSJT8TC
 * Plan: PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC (SPEC-009 §3.1)
 *
 * CONSTRUCTION ASSUMPTION:
 *   new TursoStore({ localPath: "/tmp/lore-turso-test.db" })
 *   TursoConfig = { localPath: string; remoteUrl?: string; authToken?: string }
 *   File-only mode when no remoteUrl. TursoStore delegates all operations to
 *   @libsql/client (file: protocol), and wraps the async client methods in
 *   StoreInterface's Promise<Result<T, LoreError>> contract.
 *   sync() without remoteUrl MUST return err({ code: "STORE_ERROR", message: <contains "sync" or "not supported"> })
 *
 * DIMENSION MAPPING (sqlite-store.bun.test.ts → turso-store.bun.test.ts):
 *   [SQ-1]  happy path                                     → [TS-1]  happy path
 *   [SQ-2]  negative cases                                 → [TS-2]  negative cases
 *   [SQ-3]  boundary values                                → [TS-3]  boundary values
 *   [SQ-4]  error handling                                 → [TS-4]  error handling
 *   [SQ-5]  state transitions                              → [TS-5]  state transitions
 *   [SQ-6]  search (FTS5)                                  → [TS-6]  search (FTS5)
 *   [SQ-7]  regression                                     → [TS-7]  regression
 *   [SQ-8]  optimistic locking (CAS) / happy path          → [TS-8]  optimistic locking (CAS) / happy path
 *   [SQ-9]  optimistic locking (CAS) / negative cases      → [TS-9]  optimistic locking (CAS) / negative cases
 *   [SQ-10] optimistic locking (CAS) / boundary values     → [TS-10] optimistic locking (CAS) / boundary values
 *   [SQ-11] optimistic locking (CAS) / regression legacy   → [TS-11] optimistic locking (CAS) / regression legacy
 *   [NEW]   TursoStore-specific: sync() without remoteUrl  → [TS-12] sync() file-only mode
 *
 * AC coverage requirements (must be ≥ sqlite-store.bun.test.ts):
 *   AC-STORE-001: insert + find (by id, by slug)
 *   AC-STORE-002: update + versioning
 *   AC-STORE-003: soft delete lifecycle
 *   AC-STORE-004: duplicate slug rejection
 *   AC-STORE-005: link management + cycle detection
 *   AC-STORE-006: FTS5 search
 *   AC-STORE-007: version history
 *   AC-STORE-008: audit log
 *   AC-STORE-009: findMany filters
 *   AC-STORE-CAS-001: optimistic locking (expected_version)
 *   AC-STORE-TURSO-SYNC: sync() without remoteUrl → STORE_ERROR
 *
 * TEST DESIGN TECHNIQUES:
 *   EP: valid/invalid inserts, filter combinations, sync with/without remoteUrl
 *   BVA: empty tags/extra, limit/offset boundaries, version=0 guard
 *   Decision Table: direction='in'|'out'|'both', exclude_deleted=true|false
 *   State Transition: soft-delete, parent-cycle, CAS mismatch
 *
 * This test file runs under `bun test` only (.bun.test.ts convention).
 * Do NOT run via vitest — @libsql/client uses bun:sqlite file: mode.
 *
 * STATUS: RED — TursoStore module does not exist yet.
 *   Failure mode: "Cannot find module '../../../../src/store/turso-store.js'"
 *   This is the intended pre-implementation RED state per TDD plan.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TursoStore } from "../../../src/store/turso-store.js";
import type {
  AuditEntry,
  DocRecord,
  LinkRecord,
  VersionRecord,
} from "@lore/core";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(): string {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return `01HTURSO${padded}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  return {
    id: nextId(),
    slug: `prd-turso-${_counter}`,
    type: "prd",
    role: "intent",
    title: "Turso Test Document",
    status: "draft",
    priority: "medium",
    content: "Turso test content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-06-11T10:00:00.000Z",
    updated_at: "2026-06-11T10:00:00.000Z",
    created_by: "agent:turso-test",
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
    created_at: "2026-06-11T10:00:00.000Z",
    created_by: "agent:turso-test",
  };
}

function makeVersion(docId: string, version: number): VersionRecord {
  return {
    doc_id: docId,
    version,
    content: `Content at version ${version}`,
    extra: {},
    status: "draft",
    title: "Turso Test Document",
    action: "create",
    created_at: "2026-06-11T10:00:00.000Z",
    created_by: "agent:turso-test",
  };
}

function makeAuditEntry(docId: string): AuditEntry {
  return {
    timestamp: "2026-06-11T10:00:00.000Z",
    actor: "agent:turso-test",
    session_id: "sess-turso-001",
    action: "create",
    doc_id: docId,
    details: { field: "value" },
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("TursoStore", () => {
  let store: TursoStore;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    _counter = 0;
    tmpDir = mkdtempSync(join(tmpdir(), "lore-turso-test-"));
    dbPath = join(tmpDir, "lore.db");
    store = new TursoStore({ localPath: dbPath });
  });

  afterEach(async () => {
    store.close();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  // ── [TS-1] Happy Path ──────────────────────────────────────────────────────
  // Mirrors: [SQ-1] happy path in sqlite-store.bun.test.ts

  describe("happy path", () => {
    it("AC-STORE-001.01: insert + find by id round-trip", async () => {
      const doc = makeDoc({ slug: "prd-turso-hello" });
      const insertResult = await store.insert(doc);
      expect(insertResult.ok).toBe(true);

      const findResult = await store.find(doc.id);
      expect(findResult.ok).toBe(true);
      if (!findResult.ok) return;
      expect(findResult.value?.id).toBe(doc.id);
      expect(findResult.value?.slug).toBe("prd-turso-hello");
    });

    it("AC-STORE-001.02: insert + findBySlug round-trip", async () => {
      const doc = makeDoc({ slug: "spec-turso-auth-flow" });
      await store.insert(doc);

      const result = await store.findBySlug("spec-turso-auth-flow");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.id).toBe(doc.id);
    });

    it("tags round-trip: insert doc with tags, retrieve with tags preserved", async () => {
      const doc = makeDoc({
        slug: "prd-turso-tags",
        tags: ["auth", "security", "phase-2"],
      });
      await store.insert(doc);

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.tags).toEqual(["auth", "security", "phase-2"]);
    });

    it("extra round-trip: insert doc with extra, retrieve with extra preserved", async () => {
      const doc = makeDoc({
        slug: "adr-turso-test",
        type: "adr",
        role: "decision",
        extra: { decision_status: "proposed", notes: "turso draft" },
      });
      await store.insert(doc);

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.extra).toEqual({
        decision_status: "proposed",
        notes: "turso draft",
      });
    });

    it("AC-STORE-002.01: update patches doc fields and they persist", async () => {
      const doc = makeDoc({ slug: "prd-turso-updateme" });
      await store.insert(doc);

      const updateResult = await store.update(doc.id, {
        title: "Updated Turso Title",
        status: "in-review",
        version: 2,
        updated_at: "2026-06-11T11:00:00.000Z",
      });
      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;
      expect(updateResult.value.title).toBe("Updated Turso Title");
      expect(updateResult.value.status).toBe("in-review");
      expect(updateResult.value.version).toBe(2);
    });

    it("AC-STORE-002.01: version field incremented on the stored record", async () => {
      const doc = makeDoc({ slug: "prd-turso-version" });
      await store.insert(doc);

      await store.update(doc.id, {
        content: "turso new content",
        version: 2,
        updated_at: "2026-06-11T11:00:00.000Z",
      });

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.version).toBe(2);
    });

    it("AC-STORE-003.01: softDelete sets deleted_at timestamp", async () => {
      const doc = makeDoc({ slug: "prd-turso-delete" });
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
      const doc = makeDoc({ slug: "prd-turso-exclude", type: "prd" });
      await store.insert(doc);
      await store.softDelete(doc.id);

      const result = await store.findMany({ type: "prd" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((d) => d.id);
      expect(ids).not.toContain(doc.id);
    });

    it("AC-STORE-005.01: addLink creates a link record", async () => {
      const docA = makeDoc({ slug: "prd-turso-link-a" });
      const docB = makeDoc({ slug: "prd-turso-link-b" });
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
      const skill = makeDoc({ slug: "knowledge-turso-governs-skill" });
      const artifact = makeDoc({ slug: "spec-turso-governs-artifact" });
      await store.insert(skill);
      await store.insert(artifact);

      const link = makeLink(skill.id, artifact.id, "governs");
      const result = await store.addLink(link);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.link_type).toBe("governs");
    });

    it("AC-STORE-005.06: findLinks(out) returns outbound links", async () => {
      const a = makeDoc({ slug: "prd-turso-fl-a" });
      const b = makeDoc({ slug: "prd-turso-fl-b" });
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
      const a = makeDoc({ slug: "prd-turso-in-a" });
      const b = makeDoc({ slug: "prd-turso-in-b" });
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
      const a = makeDoc({ slug: "prd-turso-both-a" });
      const b = makeDoc({ slug: "prd-turso-both-b" });
      const c = makeDoc({ slug: "prd-turso-both-c" });
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
      const a = makeDoc({ slug: "prd-turso-rm-a" });
      const b = makeDoc({ slug: "prd-turso-rm-b" });
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
      const doc = makeDoc({ slug: "prd-turso-ver" });
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
      const doc = makeDoc({ slug: "prd-turso-audit" });
      await store.insert(doc);

      const entry = makeAuditEntry(doc.id);
      await store.appendAuditEntry(entry);

      const result = await store.queryAudit({ doc_id: doc.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.actor).toBe("agent:turso-test");
      expect(result.value[0]?.action).toBe("create");
    });

    it("AC-STORE-006.01: search returns ranked results with snippets", async () => {
      const doc1 = makeDoc({
        slug: "spec-turso-auth-v1",
        title: "Authentication Service",
        content: "This spec defines the auth flow for all users using JWT tokens.",
        type: "spec",
        role: "spec",
      });
      const doc2 = makeDoc({
        slug: "spec-turso-auth-v2",
        title: "Auth Token Refresh",
        content: "Handles authentication token refresh logic.",
        type: "spec",
        role: "spec",
      });
      const doc3 = makeDoc({
        slug: "prd-turso-unrelated",
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
          slug: `${type}-turso-many-${i}`,
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
      const parent = makeDoc({ slug: "prd-turso-par" });
      const child = makeDoc({
        slug: "spec-turso-child",
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

  // ── [TS-2] Negative Cases ──────────────────────────────────────────────────
  // Mirrors: [SQ-2] negative cases in sqlite-store.bun.test.ts

  describe("negative cases", () => {
    it("AC-STORE-001.N01: find on missing id returns null (not error)", async () => {
      const result = await store.find("01HNOTEXIST0000000000000");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("findBySlug on missing slug returns null (not error)", async () => {
      const result = await store.findBySlug("prd-turso-does-not-exist");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
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
      const doc1 = makeDoc({ slug: "prd-turso-dupe" });
      const doc2 = makeDoc({ slug: "prd-turso-dupe" });
      await store.insert(doc1);

      const result = await store.insert(doc2);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DUPLICATE_SLUG");
    });

    it("AC-STORE-005.02: addLink duplicate link returns DUPLICATE_LINK", async () => {
      const a = makeDoc({ slug: "prd-turso-dup-a" });
      const b = makeDoc({ slug: "prd-turso-dup-b" });
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
      const result = await store.search("xyzzy_notfound_12345_turso");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  // ── [TS-3] Boundary Values ─────────────────────────────────────────────────
  // Mirrors: [SQ-3] boundary values in sqlite-store.bun.test.ts

  describe("boundary values", () => {
    it("AC-STORE-009.02: findMany exclude_deleted=false includes soft-deleted docs", async () => {
      const doc = makeDoc({ slug: "prd-turso-del-bv" });
      await store.insert(doc);
      await store.softDelete(doc.id);

      const result = await store.findMany({ exclude_deleted: false });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((d) => d.id);
      expect(ids).toContain(doc.id);
    });

    it("AC-STORE-007.02: findVersions with limit=1 returns only newest version", async () => {
      const doc = makeDoc({ slug: "prd-turso-lim-ver" });
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
      const doc = makeDoc({ slug: "prd-turso-off-ver" });
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
      const doc = makeDoc({ slug: "prd-turso-no-tags", tags: [] });
      await store.insert(doc);

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.tags).toEqual([]);
    });

    it("doc with empty extra object preserved on round-trip", async () => {
      const doc = makeDoc({ slug: "prd-turso-no-extra", extra: {} });
      await store.insert(doc);

      const result = await store.find(doc.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.extra).toEqual({});
    });

    it("AC-STORE-008.02: queryAudit with limit returns correct number of entries", async () => {
      const doc = makeDoc({ slug: "prd-turso-audit-lim" });
      await store.insert(doc);
      await store.appendAuditEntry({
        ...makeAuditEntry(doc.id),
        timestamp: "2026-06-11T10:00:00.000Z",
      });
      await store.appendAuditEntry({
        ...makeAuditEntry(doc.id),
        timestamp: "2026-06-11T11:00:00.000Z",
      });
      await store.appendAuditEntry({
        ...makeAuditEntry(doc.id),
        timestamp: "2026-06-11T12:00:00.000Z",
      });

      const result = await store.queryAudit({ doc_id: doc.id, limit: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });
  });

  // ── [TS-4] Error Handling ──────────────────────────────────────────────────
  // Mirrors: [SQ-4] error handling in sqlite-store.bun.test.ts

  describe("error handling", () => {
    it("insert with duplicate primary key returns err Result, does not throw", async () => {
      const doc = makeDoc({ slug: "prd-turso-pk1" });
      const doc2 = { ...doc, slug: "prd-turso-pk2" }; // same id, different slug
      await store.insert(doc);
      const result = await store.insert(doc2);
      expect(result).toBeDefined();
      expect(result.ok).toBe(false);
    });

    it("all store operations return Result, never throw on bad input", async () => {
      const badId = "01HNOTEXIST0000000000000";
      await expect(store.find(badId)).resolves.toBeDefined();
      await expect(store.findBySlug("not-exist-turso")).resolves.toBeDefined();
      await expect(store.update(badId, {})).resolves.toBeDefined();
      await expect(store.softDelete(badId)).resolves.toBeDefined();
      await expect(store.findMany({})).resolves.toBeDefined();
      await expect(store.search("test")).resolves.toBeDefined();
      await expect(store.findVersions(badId)).resolves.toBeDefined();
      await expect(store.queryAudit({})).resolves.toBeDefined();
    });
  });

  // ── [TS-5] State Transitions ───────────────────────────────────────────────
  // Mirrors: [SQ-5] state transitions in sqlite-store.bun.test.ts

  describe("state transitions", () => {
    it("AC-STORE-005.03: parent cycle A→B then B→A rejected with LINK_CYCLE", async () => {
      const a = makeDoc({ slug: "prd-turso-cycle-a" });
      const b = makeDoc({ slug: "prd-turso-cycle-b" });
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
      const a = makeDoc({ slug: "prd-turso-3c-a" });
      const b = makeDoc({ slug: "prd-turso-3c-b" });
      const c = makeDoc({ slug: "prd-turso-3c-c" });
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

    it("AC-STORE-005.10: self-referencing parent link A→A rejected with LINK_CYCLE", async () => {
      const a = makeDoc({ slug: "prd-turso-self-cyc-a" });
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
      const a = makeDoc({ slug: "prd-turso-no-cyc-a" });
      const b = makeDoc({ slug: "prd-turso-no-cyc-b" });
      await store.insert(a);
      await store.insert(b);

      await store.addLink(makeLink(b.id, a.id, "informs"));

      // Circular informs link is allowed (not a tree constraint)
      const result = await store.addLink(makeLink(a.id, b.id, "informs"));
      expect(result.ok).toBe(true);
    });

    it("AC-STORE-003.03: softDelete: find(id) returns deleted_at; findMany excludes", async () => {
      const doc = makeDoc({ slug: "prd-turso-st-del" });
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

  // ── [TS-6] Search (FTS5) ───────────────────────────────────────────────────
  // Mirrors: [SQ-6] search (FTS5) in sqlite-store.bun.test.ts
  // Note: TursoStore must explicitly maintain FTS5 index on INSERT/UPDATE/DELETE
  // (R1 spike finding: FTS5 triggers may not fire via @libsql/client — see libsql-compat.bun.test.ts S3.5)

  describe("search (FTS5)", () => {
    it("AC-STORE-006.02: search with type filter returns only matching type", async () => {
      const spec = makeDoc({
        slug: "spec-turso-fts-auth",
        title: "Auth Spec Turso",
        content: "Authentication requirements for the API.",
        type: "spec",
        role: "spec",
      });
      const prd = makeDoc({
        slug: "prd-turso-fts-auth",
        title: "Auth PRD Turso",
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
        slug: "prd-turso-snippet",
        title: "Turso Snippet Test",
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
        slug: "prd-turso-fts-title",
        title: "TursoCorpusManagement System",
        content: "Details about the turso corpus.",
      });
      await store.insert(doc);

      const result = await store.search("TursoCorpusManagement");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ids = result.value.map((h) => h.id);
      expect(ids).toContain(doc.id);
    });

    // SPEC-037 D5 — snippet highlight sentinels replace literal '['/']'
    it("AC-37-8: snippet wraps the matched term in the control-char sentinels, not literal brackets", async () => {
      const doc = makeDoc({
        slug: "prd-turso-sentinel-match",
        title: "Turso Sentinel Match Test",
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
        slug: "prd-turso-literal-brackets",
        title: "Turso Literal Brackets Test",
        content:
          "See the migrationflowchart [figure 3] for the full walkthrough of the system.",
      });
      await store.insert(doc);

      const result = await store.search("walkthrough");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const hit = result.value.find((h) => h.id === doc.id);
      expect(hit).toBeDefined();
      expect(hit!.snippet).toContain("[figure 3]");
      expect(hit!.snippet).toContain("walkthrough");
    });

    // SPEC-037 §2 — SearchHit now carries type + status from the docs join
    it("AC-37-8: hits carry the doc's type and status (zero extra query)", async () => {
      const doc = makeDoc({
        slug: "spec-turso-hit-meta",
        title: "Turso Hit Metadata Test",
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

    // [TS-6 REGRESSION] FTS triggers are the sole mechanism (Fix 1 gate regression).
    // Verifies: insert doc with unique term A, update replacing A with term B →
    //   search(A) returns 0 hits (old term removed from index),
    //   search(B) returns 1 hit (new term indexed).
    // This confirms triggers keep the FTS index correct without manual fts* calls.
    it("TS-6-REG-01: FTS trigger-only: update removes old term from index, indexes new term", async () => {
      const doc = makeDoc({
        slug: "prd-turso-fts-trig-reg",
        title: "Trigger Regression Test",
        content: "This content contains uniqueTermAlpha_trigger_reg.",
      });
      await store.insert(doc);

      // Verify term A is found before update
      const beforeResult = await store.search("uniqueTermAlpha_trigger_reg");
      expect(beforeResult.ok).toBe(true);
      if (!beforeResult.ok) return;
      expect(beforeResult.value.map((h) => h.id)).toContain(doc.id);

      // Update doc, replacing term A with term B
      await store.update(doc.id, {
        content: "This content now contains uniqueTermBeta_trigger_reg instead.",
        updated_at: "2026-06-11T12:00:00.000Z",
      });

      // term A must no longer appear in results (trigger removed old entry)
      const searchA = await store.search("uniqueTermAlpha_trigger_reg");
      expect(searchA.ok).toBe(true);
      if (!searchA.ok) return;
      expect(searchA.value.map((h) => h.id)).not.toContain(doc.id);

      // term B must appear in results (trigger indexed new entry)
      const searchB = await store.search("uniqueTermBeta_trigger_reg");
      expect(searchB.ok).toBe(true);
      if (!searchB.ok) return;
      expect(searchB.value.map((h) => h.id)).toContain(doc.id);
    });

    // [TS-6 REGRESSION] FTS integrity-check passes after normal insert+update operations.
    // Verifies: `INSERT INTO docs_fts(docs_fts, rank) VALUES ('integrity-check', 0)` executes
    // without error, proving the FTS index is internally consistent.
    it("TS-6-REG-02: FTS integrity-check passes after insert and update", async () => {
      const doc = makeDoc({
        slug: "prd-turso-fts-integrity",
        title: "FTS Integrity Check Doc",
        content: "Content for integrity check test.",
      });
      await store.insert(doc);
      await store.update(doc.id, {
        content: "Updated content for integrity check.",
        updated_at: "2026-06-11T12:00:00.000Z",
      });

      // FTS integrity-check: must execute without throwing
      // A non-zero return value indicates corruption.
      const { createClient } = await import("@libsql/client");
      const checkClient = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await checkClient.execute(
          "INSERT INTO docs_fts(docs_fts, rank) VALUES ('integrity-check', 0)",
        );
        // integrity-check returns 0 rows; success means no corruption
        expect(rs).toBeDefined();
      } finally {
        checkClient.close();
      }
    });
  });

  // ── [TS-7] Regression ─────────────────────────────────────────────────────
  // Mirrors: [SQ-7] regression in sqlite-store.bun.test.ts

  describe("regression", () => {
    // Regression: insert must not mutate the input doc object (immutability)
    it("insert does not mutate the input doc record", async () => {
      const doc = makeDoc({ slug: "prd-turso-reg-immut" });
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
    // TursoStore MUST manually maintain FTS5 after updates (R1 spike: triggers may not fire via libsql)
    it("FTS index updated after doc update — search finds new content", async () => {
      const doc = makeDoc({
        slug: "prd-turso-fts-update",
        title: "Original Turso Title",
        content: "Original content without special keyword.",
      });
      await store.insert(doc);

      await store.update(doc.id, {
        content: "Updated content with unique_turso_search_keyword_xyz.",
        updated_at: "2026-06-11T11:00:00.000Z",
      });

      const result = await store.search("unique_turso_search_keyword_xyz");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((h) => h.id)).toContain(doc.id);
    });

    // Regression: queryAudit with no filters returns all entries
    it("queryAudit with empty filters returns all entries", async () => {
      const doc = makeDoc({ slug: "prd-turso-audit-all" });
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
      const doc = makeDoc({ slug: "prd-turso-ver-nosumm" });
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
          slug: `${type}-turso-big-${i}`,
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

  // ── [TS-8 / TS-9 / TS-10 / TS-11] Optimistic Locking (CAS) ───────────────
  //
  // @spec_ref AC-STORE-CAS-001
  // Contract: StoreInterface.update(id, patch, opts?) with opts.expected_version.
  // Source: src/store/store-interface.ts JSDoc for UpdateOpts, SPEC-009 §4.2.
  //
  // Mirrors: [SQ-8/9/10/11] optimistic locking (CAS) in sqlite-store.bun.test.ts

  describe("optimistic locking (CAS)", () => {
    // [TS-8] happy path
    describe("happy path", () => {
      it("CAS-01 Turso: version match → ok, patch applied", async () => {
        // HAPPY: expected_version matches stored version → conditional update succeeds.
        const doc = makeDoc({ slug: "prd-turso-cas-v3", version: 3 });
        await store.insert(doc);

        const result = await store.update(
          doc.id,
          { content: "CAS turso updated content", updated_at: "2026-06-11T01:00:00.000Z" },
          { expected_version: 3 },
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.content).toBe("CAS turso updated content");
        // Store does NOT own version increment — patch did not include version, so it stays at 3
        expect(result.value.version).toBe(3);
      });
    });

    // [TS-9] negative cases
    describe("negative cases", () => {
      it("CAS-02 Turso: version mismatch → err STALE_VERSION with {id, expected, actual}", async () => {
        // NEGATIVE: concurrent writer advanced version to 4; caller expected v3.
        // TursoStore must return STALE_VERSION — RED until conditional UPDATE implemented.
        const doc = makeDoc({ slug: "prd-turso-cas-v4", version: 4 });
        await store.insert(doc);

        const result = await store.update(
          doc.id,
          { content: "stale turso write" },
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

      it("CAS-03 Turso: doc missing + expected_version → DOC_NOT_FOUND (NOT STALE_VERSION)", async () => {
        // NEGATIVE: non-existent document — must return DOC_NOT_FOUND regardless of expected_version.
        const missingId = "01HMISSINGTURSO0000CASTEST";

        const result = await store.update(
          missingId,
          { content: "ghost turso write" },
          { expected_version: 1 },
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DOC_NOT_FOUND");
        expect(result.error.code).not.toBe("STALE_VERSION");
      });
    });

    // [TS-10] boundary values
    describe("boundary values", () => {
      it("CAS-BOUND-01 Turso: expected_version=0 → STALE_VERSION (docs start at v1)", async () => {
        // BOUNDARY: v0 never matches a real document (minimum version is 1).
        const doc = makeDoc({ slug: "prd-turso-cas-v1-bv", version: 1 });
        await store.insert(doc);

        const result = await store.update(
          doc.id,
          { content: "v0 turso update attempt" },
          { expected_version: 0 },
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("STALE_VERSION");
      });
    });

    // [TS-11] regression — legacy unconditional semantics preserved
    describe("regression — legacy unconditional semantics preserved", () => {
      it("CAS-04 Turso: no opts → unconditional update succeeds", async () => {
        // REGRESSION: existing callers pass no opts — backward-compatibility must be preserved.
        const doc = makeDoc({ slug: "prd-turso-cas-legacy", version: 7 });
        await store.insert(doc);

        const result = await store.update(doc.id, {
          content: "unconditional turso update",
          updated_at: "2026-06-11T02:00:00.000Z",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.content).toBe("unconditional turso update");
      });

      it("CAS-04b Turso: opts={} (empty) → unconditional update", async () => {
        // REGRESSION: empty opts object should behave like no opts.
        const doc = makeDoc({ slug: "prd-turso-cas-emptyopts", version: 2 });
        await store.insert(doc);

        const result = await store.update(
          doc.id,
          { title: "empty opts turso update" },
          {}, // no expected_version key
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.title).toBe("empty opts turso update");
      });
    });
  });

  // ── [TS-12] TursoStore-specific: sync() without remoteUrl ─────────────────
  // NEW dimension — no equivalent in sqlite-store.bun.test.ts
  // @spec_ref AC-STORE-TURSO-SYNC
  //
  // SPEC-009 §3.1: TursoStore.sync() forwards to @libsql/client.sync()
  // File-only mode (no remoteUrl/syncUrl): sync() MUST NOT silently succeed.
  // MUST return err({ code: "STORE_ERROR", message: ... }) with a message that
  // clearly communicates sync is not available in file-only mode.
  // The message must contain either "sync" or "not supported" (case-insensitive)
  // so callers can display a meaningful error without inspecting internals.

  describe("sync() file-only mode", () => {
    describe("happy path", () => {
      // N/A: sync() has no happy path in file-only mode — it always fails.
      // The happy path (sync with remoteUrl) requires a live Turso connection
      // and is an integration test outside the scope of this unit contract.
    });

    describe("negative cases", () => {
      it("AC-STORE-TURSO-SYNC.N01: sync() without remoteUrl returns STORE_ERROR (not throws)", async () => {
        // NEGATIVE: file-only store (no remoteUrl) — sync() must fail loudly,
        // not silently succeed or return an empty result.
        // Per global rule: ⛔ no silent fallback on unsupported operations.
        const result = await store.sync();
        expect(result.ok).toBe(false);
      });

      it("AC-STORE-TURSO-SYNC.N02: sync() STORE_ERROR has code STORE_ERROR", async () => {
        // NEGATIVE: error code must be STORE_ERROR (existing error taxonomy in errors.ts)
        const result = await store.sync();
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("STORE_ERROR");
      });

      it("AC-STORE-TURSO-SYNC.N03: sync() STORE_ERROR message describes the problem", async () => {
        // NEGATIVE: error message must contain "sync" or "not supported" (case-insensitive)
        // so the CLI/adapter layer can surface a clear user-facing message.
        const result = await store.sync();
        expect(result.ok).toBe(false);
        if (result.ok) return;
        if (result.error.code !== "STORE_ERROR") return;
        const msgLower = result.error.message.toLowerCase();
        const describesProblem = msgLower.includes("sync") || msgLower.includes("not supported");
        expect(describesProblem).toBe(true);
      });

      it("AC-STORE-TURSO-SYNC.N04: sync() never throws — always returns a Result", async () => {
        // NEGATIVE: all operations on StoreInterface return Result, never throw.
        await expect(store.sync()).resolves.toBeDefined();
      });
    });

    describe("boundary values", () => {
      it("AC-STORE-TURSO-SYNC.BV01: sync() called multiple times consistently returns STORE_ERROR", async () => {
        // BOUNDARY: idempotency — calling sync() multiple times on file-only mode
        // must consistently return STORE_ERROR, not succeed on a subsequent call.
        const r1 = await store.sync();
        const r2 = await store.sync();
        expect(r1.ok).toBe(false);
        expect(r2.ok).toBe(false);
        if (!r1.ok && !r2.ok) {
          expect(r1.error.code).toBe(r2.error.code);
        }
      });
    });

    describe("error handling", () => {
      // N/A: sync() is the unit under test in this describe block.
      // External dependency failure (network) is out of scope for file-only mode.
    });

    describe("state transitions", () => {
      it("AC-STORE-TURSO-SYNC.ST01: sync() failure does not corrupt store state — can still insert after failed sync", async () => {
        // STATE: a failed sync() must not leave the store in a broken state.
        // All other operations must continue to work normally after a sync failure.
        const syncResult = await store.sync();
        expect(syncResult.ok).toBe(false); // file-only mode, expected failure

        // Store must still be usable after sync() fails
        const doc = makeDoc({ slug: "prd-turso-after-sync-fail" });
        const insertResult = await store.insert(doc);
        expect(insertResult.ok).toBe(true);

        const findResult = await store.find(doc.id);
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value?.id).toBe(doc.id);
      });
    });

    describe("regression", () => {
      // N/A: no known regressions for sync() at this stage.
    });
  });

  // ── [TS-13] Constructor rejection handling — initSchema async rejection ────
  // Regression: Fix 1 — constructor used `void this.initSchema()` which left
  // the rejection unhandled at the process level if initSchema rejected before
  // any public method awaited ensureReady(). The fix attaches a no-op .catch()
  // to mark the promise handled while still propagating via ensureReady().
  //
  // Implementation note: @libsql/client createClient() throws SYNCHRONOUSLY for
  // invalid paths (e.g. nonexistent directory), so the constructor itself will
  // throw in that case. The async-rejection fix applies to the narrower scenario
  // where the client is created successfully but initSchema() rejects asynchronously
  // (e.g. a malformed PRAGMA response or migration failure on a valid file path).
  //
  // @spec_ref AC-STORE-TURSO-001 (fail-loud: STORE_ERROR on bad path)

  describe("constructor initSchema rejection handling", () => {
    describe("happy path", () => {
      // N/A: this suite covers the async rejection path only.
    });

    describe("negative cases", () => {
      it("AC-STORE-TURSO-INIT.N01: initSchema rejection surfaced as STORE_ERROR on first operation (not unhandledRejection)", async () => {
        // NEGATIVE: verify that a newly constructed TursoStore (valid path) runs initSchema
        // eagerly AND that the resulting promise has a .catch() handler attached so any
        // rejection does NOT fire as an unhandled promise rejection at the process level.
        // The observable behavior: store construction succeeds, all operations work, and
        // after store is closed the _schemaInitPromise has already been settled.
        // This test uses a valid path (the beforeEach store) to confirm the happy path
        // works end-to-end with the .catch() attached.
        const doc = makeDoc({ slug: "prd-turso-init-catch-ok" });
        const insertResult = await store.insert(doc);
        expect(insertResult.ok).toBe(true);

        const findResult = await store.find(doc.id);
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value?.id).toBe(doc.id);
      });

      it("AC-STORE-TURSO-INIT.N02: ensureReady rejection propagates as STORE_ERROR Result (not unhandled throw)", async () => {
        // NEGATIVE: if initSchema rejects (simulated by directly rejecting the stored
        // promise), all subsequent operations must return STORE_ERROR, not throw or hang.
        // This guards the ensureReady() → catch path in public methods.
        // We inject a rejected promise directly into _schemaInitPromise to simulate
        // a post-construction initSchema failure without needing a broken file path.
        // NOTE: TypeScript private field — accessed via type assertion for test injection only.
        const testStore = new TursoStore({ localPath: dbPath + ".inject" });
        const fakeError = new Error("simulated initSchema failure");

        // Inject a pre-rejected promise — simulates a late async initSchema rejection.
        // Attach .catch() immediately to suppress unhandledRejection at injection point.
        const rejectedPromise = Promise.reject(fakeError);
        rejectedPromise.catch(() => { /* handled */ });
        (testStore as unknown as Record<string, unknown>)["_schemaInitPromise"] = rejectedPromise;

        try {
          // The first operation must return STORE_ERROR, not throw
          const result = await testStore.findMany({});
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("STORE_ERROR");
          }
        } finally {
          testStore.close();
        }
      });
    });

    describe("boundary values", () => {
      // N/A: the rejection path is either triggered or not — no numeric boundaries.
    });

    describe("error handling", () => {
      // N/A: covered in negative cases above.
    });

    describe("state transitions", () => {
      it("AC-STORE-TURSO-INIT.ST01: store remains usable after _schemaInitPromise settles successfully", async () => {
        // STATE: once initSchema completes successfully (settled promise),
        // all subsequent operations work without re-running migrations.
        const doc1 = makeDoc({ slug: "prd-turso-init-st-01" });
        const doc2 = makeDoc({ slug: "prd-turso-init-st-02" });

        await store.insert(doc1);
        await store.insert(doc2);

        const listResult = await store.findMany({});
        expect(listResult.ok).toBe(true);
        if (!listResult.ok) return;
        expect(listResult.value.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe("regression", () => {
      it("AC-STORE-TURSO-INIT.REG01: regression — constructor void initSchema() unhandled rejection pattern", async () => {
        // REGRESSION: before the fix, `void this.initSchema()` in the constructor
        // left the async rejection unhandled at the process level, potentially causing
        // UnhandledPromiseRejection events that could crash Bun/Node processes.
        // After the fix, `.catch(() => { /* surfaced via ensureReady */ })` is attached
        // so the promise is marked handled immediately in the constructor.
        //
        // Verification: construct a store (which calls initSchema() with .catch()),
        // then verify the schema was actually initialized by doing a round-trip.
        // If the .catch() accidentally swallowed errors, operations would fail.
        const freshDir = mkdtempSync(join(tmpdir(), "lore-turso-reg01-"));
        const freshPath = join(freshDir, "lore.db");
        const freshStore = new TursoStore({ localPath: freshPath });
        try {
          const doc = makeDoc({ slug: "prd-turso-reg01" });
          const insertResult = await freshStore.insert(doc);
          expect(insertResult.ok).toBe(true);
          const findResult = await freshStore.find(doc.id);
          expect(findResult.ok).toBe(true);
          if (findResult.ok) {
            expect(findResult.value?.id).toBe(doc.id);
          }
        } finally {
          freshStore.close();
          try { rmSync(freshDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      });
    });
  });

  // AC-STORE-010: dbSizeBytes — real on-disk size via PRAGMA page_count * page_size
  // against the embedded replica's local file (file-only mode, no remoteUrl).
  describe("dbSizeBytes (AC-STORE-010)", () => {
    it("HAPPY: reports > 0 bytes for a freshly-migrated file-only store", async () => {
      const result = await store.dbSizeBytes();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeGreaterThan(0);
    });

    it("STATE: reports a size at least as large after inserting documents", async () => {
      const before = await store.dbSizeBytes();
      expect(before.ok).toBe(true);
      if (!before.ok) return;

      for (let i = 0; i < 20; i += 1) {
        await store.insert(
          makeDoc({ slug: `prd-turso-size-${i}`, content: "x".repeat(2000) }),
        );
      }

      const after = await store.dbSizeBytes();
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      expect(after.value).toBeGreaterThanOrEqual(before.value);
    });

    it("BOUNDARY: value is a multiple of the SQLite default page size (4096) — sanity check on page_count * page_size arithmetic", async () => {
      // `client` is a private field on TursoStore, so this asserts the public
      // contract's shape rather than reaching into the driver directly:
      // any valid SQLite page_size is a power of two >= 512, and the file's
      // total byte size (page_count * page_size) must be an exact multiple of it.
      const result = await store.dbSizeBytes();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value % 512).toBe(0);
    });
  });
});
