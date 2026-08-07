// @vitest-environment jsdom
/**
 * Tests for lib/review-queue.ts — fetchReviewQueueRows, the client-side
 * merge of draft + in-review documents (ADR
 * adr-dashboard-review-queues-include-in-review-docs-ahead-of, dogfood
 * 2026-07-26 ISSUE-008).
 *
 * Test plan:
 *   HAPPY:
 *     - merges a draft batch and an in-review batch, in-review rows FIRST
 *     - an in-review row's `version`/`created_by` come from the per-row
 *       `apiGetDoc` call (the REAL DocRecord), not fabricated
 *     - a draft row's fields pass through apiGetPendingReview's row unchanged
 *   NEGATIVE:
 *     - no in-review docs -> only draft rows returned, in draft's own order
 *     - no draft docs -> only in-review rows returned
 *   BOUNDARY:
 *     - both batches empty -> [] (never throws)
 *     - opts.type narrows BOTH the draft (apiGetPendingReview) and in-review
 *       (apiList) branches
 *     - opts.since narrows both branches the same way
 *   STATE:
 *     - (n/a — pure async orchestration, no component state)
 *   REGRESSION:
 *     - opts.author narrows the draft branch only (apiList has no author
 *       filter) — the in-review branch's apiList call never receives it
 *     - within-batch order is preserved (no independent re-sort) even when
 *       the in-review batch has more than one row
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PendingDocRow, ListResponse, DocWithNavigation } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  apiGetPendingReview: vi.fn(),
  apiList: vi.fn(),
  apiGetDoc: vi.fn(),
}));

import { apiGetPendingReview, apiList, apiGetDoc } from "@/lib/api";
import { fetchReviewQueueRows } from "../../../src/lib/review-queue";

const mockedGetPending = vi.mocked(apiGetPendingReview);
const mockedList = vi.mocked(apiList);
const mockedGetDoc = vi.mocked(apiGetDoc);

function makeDraftRow(overrides: Partial<PendingDocRow> & { id: string }): PendingDocRow {
  return {
    type: "spec",
    title: "Untitled draft",
    status: "draft",
    created_by: "alice",
    updated_at: "2026-07-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makeListResponse(docs: ListResponse["docs"]): ListResponse {
  return { docs, total: docs.length };
}

function makeDocWithNavigation(overrides: Partial<DocWithNavigation["doc"]> & { id: string }): DocWithNavigation {
  return {
    doc: {
      slug: `slug-${overrides.id}`,
      type: "knowledge",
      role: "knowledge",
      title: "Untitled in-review",
      status: "in-review",
      priority: "medium",
      content: "",
      parent_id: null,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      created_by: "bob",
      version: 1,
      deleted_at: null,
      tags: [],
      extra: {},
      ...overrides,
    },
    navigation: { parent: null, ancestors: [], siblings: [], children: [], related: [] },
  };
}

beforeEach(() => {
  mockedGetPending.mockReset();
  mockedList.mockReset();
  mockedGetDoc.mockReset();
});

describe("fetchReviewQueueRows", () => {
  describe("happy path", () => {
    it("merges draft + in-review batches, in-review rows first", async () => {
      const draft = makeDraftRow({ id: "01DRAFT0000000000000000001", title: "Draft Row" });
      mockedGetPending.mockResolvedValue([draft]);
      mockedList.mockResolvedValue(
        makeListResponse([
          {
            id: "01INREVIEW000000000000001",
            slug: "knowledge-in-review-row",
            type: "knowledge",
            title: "In Review Row",
            status: "in-review",
            updated_at: "2026-07-02T00:00:00.000Z",
            tags: [],
            priority: "medium",
          },
        ]),
      );
      mockedGetDoc.mockResolvedValue(
        makeDocWithNavigation({ id: "01INREVIEW000000000000001", title: "In Review Row", version: 3, created_by: "carol" }),
      );

      const rows = await fetchReviewQueueRows(null);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ id: "01INREVIEW000000000000001", status: "in-review", title: "In Review Row" });
      expect(rows[1]).toMatchObject({ id: draft.id, status: "draft", title: "Draft Row" });
    });

    it("populates an in-review row's version/created_by from the real DocRecord (apiGetDoc), not a fabricated value", async () => {
      mockedGetPending.mockResolvedValue([]);
      mockedList.mockResolvedValue(
        makeListResponse([
          {
            id: "01INREVIEW000000000000002",
            slug: "spec-x",
            type: "spec",
            title: "Spec X",
            status: "in-review",
            updated_at: "2026-07-02T00:00:00.000Z",
            tags: [],
            priority: "medium",
          },
        ]),
      );
      mockedGetDoc.mockResolvedValue(
        makeDocWithNavigation({
          id: "01INREVIEW000000000000002",
          type: "spec",
          title: "Spec X",
          version: 7,
          created_by: "dave",
        }),
      );

      const rows = await fetchReviewQueueRows(null);

      // reason: meta is (re)derived from the FULL DocRecord via
      // deriveTypeMeta (@lore/core) -- a spec's absent extra.spec_kind
      // defaults to "feature" (CorpusService._createImpl's own default),
      // so it's expected here too, not an unrelated leak.
      expect(rows).toEqual([
        {
          id: "01INREVIEW000000000000002",
          type: "spec",
          title: "Spec X",
          status: "in-review",
          created_by: "dave",
          updated_at: "2026-07-01T00:00:00.000Z",
          version: 7,
          meta: { t: "spec", kind: "feature" },
        },
      ]);
    });

    it("passes a draft row's fields through unchanged from apiGetPendingReview", async () => {
      const draft = makeDraftRow({
        id: "01DRAFT0000000000000000002",
        title: "Draft Passthrough",
        version: 9,
        created_by: "erin",
        meta: { t: "adr", decision_status: "accepted" },
      });
      mockedGetPending.mockResolvedValue([draft]);
      mockedList.mockResolvedValue(makeListResponse([]));

      const rows = await fetchReviewQueueRows(null);

      expect(rows).toEqual([draft]);
    });
  });

  describe("negative", () => {
    it("returns only draft rows, in their own order, when there are no in-review docs", async () => {
      const draft1 = makeDraftRow({ id: "01DRAFT0000000000000000003", title: "Draft One" });
      const draft2 = makeDraftRow({ id: "01DRAFT0000000000000000004", title: "Draft Two" });
      mockedGetPending.mockResolvedValue([draft1, draft2]);
      mockedList.mockResolvedValue(makeListResponse([]));

      const rows = await fetchReviewQueueRows(null);

      expect(rows).toEqual([draft1, draft2]);
      expect(mockedGetDoc).not.toHaveBeenCalled();
    });

    it("returns only in-review rows when there are no draft docs", async () => {
      mockedGetPending.mockResolvedValue([]);
      mockedList.mockResolvedValue(
        makeListResponse([
          {
            id: "01INREVIEW000000000000003",
            slug: "plan-y",
            type: "plan",
            title: "Plan Y",
            status: "in-review",
            updated_at: "2026-07-02T00:00:00.000Z",
            tags: [],
            priority: "medium",
          },
        ]),
      );
      mockedGetDoc.mockResolvedValue(makeDocWithNavigation({ id: "01INREVIEW000000000000003", title: "Plan Y" }));

      const rows = await fetchReviewQueueRows(null);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("in-review");
    });
  });

  describe("boundary", () => {
    it("returns [] without throwing when both batches are empty", async () => {
      mockedGetPending.mockResolvedValue([]);
      mockedList.mockResolvedValue(makeListResponse([]));

      const rows = await fetchReviewQueueRows(null);

      expect(rows).toEqual([]);
      expect(mockedGetDoc).not.toHaveBeenCalled();
    });

    it("threads opts.type to BOTH the draft (apiGetPendingReview) and in-review (apiList) branches", async () => {
      mockedGetPending.mockResolvedValue([]);
      mockedList.mockResolvedValue(makeListResponse([]));

      await fetchReviewQueueRows(null, { type: "task" });

      expect(mockedGetPending).toHaveBeenCalledWith(null, { type: "task" });
      expect(mockedList).toHaveBeenCalledWith(null, { status: "in-review", type: "task" });
    });

    it("threads opts.since to both branches the same way", async () => {
      mockedGetPending.mockResolvedValue([]);
      mockedList.mockResolvedValue(makeListResponse([]));

      await fetchReviewQueueRows(null, { since: "2026-07-01T00:00:00.000Z" });

      expect(mockedGetPending).toHaveBeenCalledWith(null, { since: "2026-07-01T00:00:00.000Z" });
      expect(mockedList).toHaveBeenCalledWith(null, { status: "in-review", since: "2026-07-01T00:00:00.000Z" });
    });
  });

  describe("regression", () => {
    it("opts.author narrows the draft branch only — apiList never receives it (no ListOpts.author field exists)", async () => {
      mockedGetPending.mockResolvedValue([]);
      mockedList.mockResolvedValue(makeListResponse([]));

      await fetchReviewQueueRows(null, { author: "frank" });

      expect(mockedGetPending).toHaveBeenCalledWith(null, { author: "frank" });
      expect(mockedList).toHaveBeenCalledWith(null, { status: "in-review" });
    });

    it("preserves within-batch order for multiple in-review rows (no independent re-sort)", async () => {
      mockedGetPending.mockResolvedValue([]);
      mockedList.mockResolvedValue(
        makeListResponse([
          {
            id: "01INREVIEWA00000000000001",
            slug: "knowledge-a",
            type: "knowledge",
            title: "A",
            status: "in-review",
            updated_at: "2026-07-02T00:00:00.000Z",
            tags: [],
            priority: "medium",
          },
          {
            id: "01INREVIEWB00000000000002",
            slug: "knowledge-b",
            type: "knowledge",
            title: "B",
            status: "in-review",
            updated_at: "2026-07-02T00:00:00.000Z",
            tags: [],
            priority: "medium",
          },
        ]),
      );
      mockedGetDoc.mockImplementation(async (_project, id) =>
        makeDocWithNavigation({ id: id as string, title: id === "01INREVIEWA00000000000001" ? "A" : "B" }),
      );

      const rows = await fetchReviewQueueRows(null);

      expect(rows.map((r) => r.title)).toEqual(["A", "B"]);
    });
  });
});
