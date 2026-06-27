/** @spec_ref AC-REVIEW-001 */
/**
 * Tests for ReviewService — human review workflow.
 * Source: SPEC-005 §3, §4, §6
 *
 * Test plan:
 * EP:       pending(no filter), pending(author), pending(type), pending(since)
 * BVA:      empty store, all-approved store
 * STATE:    approve draft→approved, reject keeps draft, reject in-review→draft
 * NEGATIVE: approve already-approved, approve archived, reject approved, reject archived
 * ERROR:    approve non-existent id, reject non-existent id
 * REGRESSION: rejected doc version unchanged; approved doc absent from pending
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { ReviewService } from "../../../src/service/review-service.js";
import type { DocRecord } from "@lore/core";

// ─── Factories ───────────────────────────────────────────────────────────────

let _seq = 0;

function nextId(): string {
  _seq += 1;
  return `01HREV${String(_seq).padStart(20, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _seq += 1;
  return {
    id: nextId(),
    slug: `prd-test-doc-${_seq}`,
    type: "prd",
    role: "intent",
    title: `Test Doc ${_seq}`,
    status: "draft",
    priority: "medium",
    content: "Test content",
    parent_id: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReviewService", () => {
  let store: InMemoryStore;
  let service: ReviewService;

  beforeEach(() => {
    _seq = 0;
    store = new InMemoryStore();
    service = new ReviewService(store);
  });

  // ── pending ───────────────────────────────────────────────────────────────

  describe("pending", () => {
    describe("happy path", () => {
      it("returns only draft docs from a mixed set", async () => {
        const draft1 = makeDoc({ status: "draft", created_by: "alice" });
        const draft2 = makeDoc({ status: "draft", created_by: "bob" });
        const approved = makeDoc({ status: "approved", created_by: "carol" });

        await store.insert(draft1);
        await store.insert(draft2);
        await store.insert(approved);

        const result = await service.pending();

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toHaveLength(2);
        const ids = result.value.map((d) => d.id);
        expect(ids).toContain(draft1.id);
        expect(ids).toContain(draft2.id);
        expect(ids).not.toContain(approved.id);
      });

      it("returns PendingDoc shape with correct fields", async () => {
        const doc = makeDoc({
          status: "draft",
          created_by: "alice",
          title: "My Draft",
          type: "prd",
          version: 3,
          updated_at: "2026-06-05T10:00:00.000Z",
        });
        await store.insert(doc);

        const result = await service.pending();

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);

        const pending = result.value[0]!;
        expect(pending.id).toBe(doc.id);
        expect(pending.type).toBe("prd");
        expect(pending.title).toBe("My Draft");
        expect(pending.status).toBe("draft");
        expect(pending.created_by).toBe("alice");
        expect(pending.version).toBe(3);
        expect(pending.updated_at).toBe("2026-06-05T10:00:00.000Z");
      });
    });

    describe("filter: author", () => {
      it("returns only docs created by the specified author", async () => {
        const aliceDoc = makeDoc({ status: "draft", created_by: "alice" });
        const bobDoc = makeDoc({ status: "draft", created_by: "bob" });
        await store.insert(aliceDoc);
        await store.insert(bobDoc);

        const result = await service.pending({ author: "alice" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.id).toBe(aliceDoc.id);
      });

      it("returns empty array when author has no drafts", async () => {
        const doc = makeDoc({ status: "draft", created_by: "alice" });
        await store.insert(doc);

        const result = await service.pending({ author: "nobody" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });
    });

    describe("filter: type", () => {
      it("returns only docs of the specified type", async () => {
        const prdDoc = makeDoc({ status: "draft", type: "prd" });
        const adrDoc = makeDoc({
          status: "draft",
          type: "adr",
          extra: { decision_status: "proposed" },
        });
        await store.insert(prdDoc);
        await store.insert(adrDoc);

        const result = await service.pending({ type: "prd" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.type).toBe("prd");
      });
    });

    describe("filter: since", () => {
      it("returns only docs updated at or after the since timestamp", async () => {
        const oldDoc = makeDoc({
          status: "draft",
          updated_at: "2026-01-01T00:00:00.000Z",
        });
        const newDoc = makeDoc({
          status: "draft",
          slug: "prd-newer-doc",
          updated_at: "2026-06-01T00:00:00.000Z",
        });
        await store.insert(oldDoc);
        await store.insert(newDoc);

        const result = await service.pending({ since: "2026-05-01T00:00:00.000Z" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.id).toBe(newDoc.id);
      });
    });

    describe("boundary values", () => {
      it("returns empty array when store has no docs at all", async () => {
        const result = await service.pending();

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });

      it("returns empty array when all docs are approved (no drafts)", async () => {
        const approved = makeDoc({ status: "approved" });
        await store.insert(approved);

        const result = await service.pending();

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });
    });
  });

  // ── approve ───────────────────────────────────────────────────────────────

  describe("approve", () => {
    describe("happy path", () => {
      it("transitions draft → approved and returns updated doc", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        const result = await service.approve(doc.id, { reviewer: "carol" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("approved");
        expect(result.value.id).toBe(doc.id);
      });

      it("increments the version number on approve", async () => {
        const doc = makeDoc({ status: "draft", version: 2 });
        await store.insert(doc);

        const result = await service.approve(doc.id, { reviewer: "carol" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.version).toBe(3);
      });

      it("creates a version record with action=approve and correct reviewer", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.approve(doc.id, { reviewer: "reviewer1" });

        const versionsResult = await store.findVersions(doc.id);
        expect(versionsResult.ok).toBe(true);
        if (!versionsResult.ok) return;
        expect(versionsResult.value).toHaveLength(1);
        expect(versionsResult.value[0]!.action).toBe("approve");
        expect(versionsResult.value[0]!.status).toBe("approved");
        expect(versionsResult.value[0]!.created_by).toBe("reviewer1");
      });

      it("appends an audit entry with reviewer and action=approve", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.approve(doc.id, { reviewer: "carol" });

        const auditResult = await store.queryAudit({ doc_id: doc.id });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value).toHaveLength(1);
        expect(auditResult.value[0]!.action).toBe("approve");
        expect(auditResult.value[0]!.actor).toBe("carol");
        expect(auditResult.value[0]!.doc_id).toBe(doc.id);
      });

      it("transitions in-review → approved", async () => {
        const doc = makeDoc({ status: "in-review" });
        await store.insert(doc);

        const result = await service.approve(doc.id);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("approved");
      });

      it("uses 'system' as reviewer when opts is omitted", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.approve(doc.id);

        const auditResult = await store.queryAudit({ doc_id: doc.id });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value[0]!.actor).toBe("system");
      });
    });

    describe("state transitions (negative)", () => {
      it("returns INVALID_TRANSITION when doc is already approved", async () => {
        const doc = makeDoc({ status: "approved" });
        await store.insert(doc);

        const result = await service.approve(doc.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("approved");
        expect(result.error.to).toBe("approved");
      });

      it("returns INVALID_TRANSITION when doc is archived", async () => {
        const doc = makeDoc({ status: "archived" });
        await store.insert(doc);

        const result = await service.approve(doc.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("archived");
        expect(result.error.to).toBe("approved");
      });

      it("returns INVALID_TRANSITION when doc is deprecated", async () => {
        const doc = makeDoc({ status: "deprecated" });
        await store.insert(doc);

        const result = await service.approve(doc.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("deprecated");
      });
    });

    describe("error handling", () => {
      it("returns DOC_NOT_FOUND when id does not exist", async () => {
        const result = await service.approve("nonexistent-id");

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DOC_NOT_FOUND");
      });
    });
  });

  // ── reject ────────────────────────────────────────────────────────────────

  describe("reject", () => {
    describe("happy path", () => {
      it("keeps status as draft and records reason in audit", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        const result = await service.reject(doc.id, {
          reviewer: "bob",
          reason: "incomplete",
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("draft");

        const auditResult = await store.queryAudit({ doc_id: doc.id });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value).toHaveLength(1);
        expect(auditResult.value[0]!.action).toBe("reject");
        expect(auditResult.value[0]!.actor).toBe("bob");
        expect(auditResult.value[0]!.details?.["reason"]).toBe("incomplete");
      });

      it("rejects an in-review doc, status returns to draft", async () => {
        const doc = makeDoc({ status: "in-review" });
        await store.insert(doc);

        const result = await service.reject(doc.id, { reason: "needs more work" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.status).toBe("draft");
      });

      it("stores reason in audit details", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.reject(doc.id, { reviewer: "reviewer1", reason: "missing tests" });

        const auditResult = await store.queryAudit({ doc_id: doc.id, action: "reject" });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value[0]!.details?.["reason"]).toBe("missing tests");
      });

      it("omits reason key from audit details when reason is not provided", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.reject(doc.id, { reviewer: "reviewer1" });

        const auditResult = await store.queryAudit({ doc_id: doc.id });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value[0]!.details?.["reason"]).toBeUndefined();
      });

      it("uses 'system' as reviewer when opts is omitted", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.reject(doc.id);

        const auditResult = await store.queryAudit({ doc_id: doc.id });
        expect(auditResult.ok).toBe(true);
        if (!auditResult.ok) return;
        expect(auditResult.value[0]!.actor).toBe("system");
      });
    });

    describe("state transitions (negative)", () => {
      it("returns INVALID_TRANSITION when doc is approved (cannot reject approved)", async () => {
        const doc = makeDoc({ status: "approved" });
        await store.insert(doc);

        const result = await service.reject(doc.id, { reason: "test" });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("approved");
        expect(result.error.to).toBe("draft");
      });

      it("returns INVALID_TRANSITION when doc is archived", async () => {
        const doc = makeDoc({ status: "archived" });
        await store.insert(doc);

        const result = await service.reject(doc.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("archived");
      });

      it("returns INVALID_TRANSITION when doc is deprecated", async () => {
        const doc = makeDoc({ status: "deprecated" });
        await store.insert(doc);

        const result = await service.reject(doc.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("INVALID_TRANSITION");
        if (result.error.code !== "INVALID_TRANSITION") return;
        expect(result.error.from).toBe("deprecated");
      });
    });

    describe("error handling", () => {
      it("returns DOC_NOT_FOUND when id does not exist", async () => {
        const result = await service.reject("nonexistent-id");

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DOC_NOT_FOUND");
      });
    });

    describe("regression", () => {
      // Regression: reject MUST NOT increment version — only approve bumps version
      it("reject does not increment version number", async () => {
        const doc = makeDoc({ status: "draft", version: 1 });
        await store.insert(doc);

        const result = await service.reject(doc.id, { reason: "incomplete" });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.version).toBe(1);
      });

      // Regression: approved doc must not appear in pending list
      it("approved doc no longer appears in pending after approval", async () => {
        const doc = makeDoc({ status: "draft" });
        await store.insert(doc);

        await service.approve(doc.id);

        const pendingResult = await service.pending();
        expect(pendingResult.ok).toBe(true);
        if (!pendingResult.ok) return;
        const ids = pendingResult.value.map((d) => d.id);
        expect(ids).not.toContain(doc.id);
      });
    });
  });
});
