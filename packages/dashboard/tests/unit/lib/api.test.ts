// @vitest-environment jsdom
/**
 * Tests for lib/api.ts — typed fetch wrapper.
 * Source: SPEC-015 §3.4
 *
 * Test plan:
 *   HAPPY:
 *     - apiGetStatus parses { ok: true, data: T } envelope correctly
 *     - apiList returns docs array from data field
 *     - apiList joins a tags[] opt into a single comma-separated query param (SPEC-036 §1 D2)
 *     - apiList combines type/status/tags into one query string
 *     - apiSearch returns docs for a query
 *     - apiGetDoc returns DocWithNavigation
 *     - apiGetDoc with resolveMdx=true appends ?resolveMdx=true to path
 *     - apiGetReadyReport returns { ok: true, value: ReadyReportResponse } — the
 *       FULL {records, sessions, anchor_conflicts, claim_ttl_minutes} object, on
 *       success (SPEC-042/SPEC-077; the route has never returned a bare
 *       `ReadyRecord[]` — see the module's regression-history doc comment)
 *
 *   NEGATIVE:
 *     - Non-2xx response throws ApiError with HTTP status
 *     - Server { ok: false } envelope throws ApiError with server code
 *     - Unknown error code in envelope is preserved
 *     - apiGetReadyReport returns { ok: false, error } instead of throwing on a server error
 *
 *   BOUNDARY:
 *     - Empty docs array in response is returned as-is
 *     - apiSearch with empty query still builds URL (caller controls enabled)
 *     - apiList with an empty tags[] array omits the tags query param entirely
 *     - apiGetReadyReport against a plan with zero tasks returns an empty
 *       records array (still ok:true) inside the full report object
 *
 *   ERROR:
 *     - Timeout (AbortSignal) throws ApiError with code NETWORK_ERROR
 *     - JSON parse failure throws ApiError with code PARSE_ERROR
 *     - apiGetReadyReport wraps a network failure into { ok: false, error } (never throws)
 *
 *   STATE:
 *     - Multiple sequential calls each get their own response (no shared state)
 *
 *   REGRESSION:
 *     - Response without Content-Type header still parses (no Content-Type check)
 *     - apiGetDoc URL-encodes the idOrSlug parameter
 *     - apiGetReadyReport URL-encodes the planIdOrSlug parameter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  apiGetStatus,
  apiList,
  apiSearch,
  apiGetDoc,
  apiGetReadyReport,
  apiGetEvidencePanel,
  evidencePanelQueryKey,
  ApiError,
} from "../../../src/lib/api";
import type { EvidencePanelProjection, ReadyRecord } from "@lore/core";

// ─── Mock fetch ───────────────────────────────────────────────────────────────

function makeFetchMock(body: unknown, status = 200): () => Promise<Response> {
  return vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function makeNetworkErrorMock(): () => Promise<never> {
  return vi.fn().mockRejectedValueOnce(new Error("Failed to fetch"));
}

beforeEach(() => {
  // Reset fetch mock before each test
  vi.stubGlobal("fetch", undefined);
  vi.stubGlobal("AbortSignal", { timeout: () => new AbortController().signal });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── HAPPY paths ──────────────────────────────────────────────────────────────

describe("apiGetStatus", () => {
  describe("happy path", () => {
    it("returns parsed status data from { ok, data } envelope", async () => {
      const mockStatus = { total_docs: 42, by_type: { prd: 3 }, by_status: { active: 5 } };
      vi.stubGlobal("fetch", makeFetchMock({ ok: true, data: mockStatus }));

      const result = await apiGetStatus(null);

      expect(result.total_docs).toBe(42);
      expect(result.by_type.prd).toBe(3);
    });
  });
});

describe("apiList", () => {
  describe("happy path", () => {
    it("returns docs array and total count", async () => {
      const mockData = { docs: [{ id: "01", slug: "prd-test", title: "Test", type: "prd", status: "draft", updated_at: "" }], total: 1 };
      vi.stubGlobal("fetch", makeFetchMock({ ok: true, data: mockData }));

      const result = await apiList(null, {});

      expect(result.total).toBe(1);
      expect(result.docs).toHaveLength(1);
    });

    it("builds type filter query parameter", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { docs: [], total: 0 } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }));

      await apiList(null, { type: "prd" });

      expect(calls[0]).toContain("type=prd");
    });

    it("joins a tags[] opt into a single comma-separated query param", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { docs: [], total: 0 } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }));

      await apiList(null, { tags: ["a", "b"] });

      expect(calls[0]).toContain(`tags=${encodeURIComponent("a,b")}`);
    });

    it("combines type/status/tags into one query string", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { docs: [], total: 0 } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }));

      await apiList(null, { type: "spec", status: "draft", tags: ["core"] });

      expect(calls[0]).toContain("type=spec");
      expect(calls[0]).toContain("status=draft");
      expect(calls[0]).toContain("tags=core");
    });
  });

  describe("boundary", () => {
    it("returns empty docs array when server returns empty list", async () => {
      vi.stubGlobal("fetch", makeFetchMock({ ok: true, data: { docs: [], total: 0 } }));

      const result = await apiList(null, {});

      expect(result.docs).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("omits the tags query param entirely when tags[] is empty", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { docs: [], total: 0 } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }));

      await apiList(null, { tags: [] });

      expect(calls[0]).not.toContain("tags=");
    });
  });
});

describe("apiSearch", () => {
  describe("happy path", () => {
    it("includes q parameter in the URL", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { results: [] } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }));

      await apiSearch(null, "hello world");

      expect(calls[0]).toContain("q=hello+world");
    });

    // reason: CorpusService.search returns { results: SearchHit[] } with NO server-side
    // total — a past version of this test asserted a fabricated `data.docs`/`data.total`
    // shape the server never emits (SPEC-031 read-path contract drift).
    it("returns search results under `results`, matching the real server envelope", async () => {
      const mockData = { results: [{ id: "02", slug: "spec-test", title: "Spec", snippet: "...match...", score: 1.5, type: "spec", status: "active" }] };
      vi.stubGlobal("fetch", makeFetchMock({ ok: true, data: mockData }));

      const result = await apiSearch(null, "test");

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.title).toBe("Spec");
    });

    // reason: SPEC-037 §2 added `type`/`status` to SearchHit so result cards can
    // render the same badges as DocCard without a second query — pin the passthrough.
    it("passes through the SPEC-037 type/status fields on each hit", async () => {
      const mockData = { results: [{ id: "03", slug: "task-x", title: "Task X", snippet: "", score: 0.8, type: "task", status: "draft" }] };
      vi.stubGlobal("fetch", makeFetchMock({ ok: true, data: mockData }));

      const result = await apiSearch(null, "task");

      expect(result.results[0]?.type).toBe("task");
      expect(result.results[0]?.status).toBe("draft");
    });
  });
});

describe("apiGetReadyReport", () => {
  // reason: the server has returned the FULL `{records, sessions,
  // anchor_conflicts, claim_ttl_minutes}` object from `GET /api/ready/:plan`
  // since SPEC-042 — every fixture below mirrors that real shape (never a
  // bare records array) per `task-fix-live-spec-042-regression-apigetready-
  // types-api-ready`.
  describe("happy path", () => {
    it("returns { ok: true, value: ReadyReportResponse } — the full report object — on a successful fetch", async () => {
      const record: ReadyRecord = {
        task: {
          id: "01HTASK0000000000000000001",
          slug: "task-a",
          type: "task",
          title: "Task A",
          status: "draft",
          updated_at: "2026-07-01T00:00:00.000Z",
          tags: [],
          priority: "medium",
        },
        ready: true,
        unmet_blockers: [],
        evidence_count: 0,
      };
      vi.stubGlobal(
        "fetch",
        makeFetchMock({
          ok: true,
          data: { records: [record], sessions: [], anchor_conflicts: [], claim_ttl_minutes: 120 },
        }),
      );

      const result = await apiGetReadyReport(null, "plan-a");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.records).toHaveLength(1);
        expect(result.value.records[0]?.task.slug).toBe("task-a");
        expect(result.value.sessions).toEqual([]);
        expect(result.value.anchor_conflicts).toEqual([]);
        expect(result.value.claim_ttl_minutes).toBe(120);
      }
    });
  });

  describe("boundary", () => {
    it("returns an empty records array (still ok:true) for a plan with zero tasks", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetchMock({ ok: true, data: { records: [], sessions: [], anchor_conflicts: [], claim_ttl_minutes: 120 } }),
      );

      const result = await apiGetReadyReport(null, "plan-empty");

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.records).toHaveLength(0);
    });
  });

  describe("negative: server error", () => {
    it("returns { ok: false, error } instead of throwing on a 422 (non-plan target)", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetchMock({ ok: false, error: { code: "VALIDATION_ERROR", message: "not a plan" } }, 422),
      );

      const result = await apiGetReadyReport(null, "spec-not-a-plan");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ApiError);
        expect(result.error.status).toBe(422);
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("error: network failure", () => {
    it("wraps a network failure into { ok: false, error } rather than throwing", async () => {
      vi.stubGlobal("fetch", makeNetworkErrorMock());

      const result = await apiGetReadyReport(null, "plan-a");

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NETWORK_ERROR");
    });
  });

  describe("regression: URL encoding", () => {
    it("URL-encodes the planIdOrSlug parameter", async () => {
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          calls.push(url);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                data: { records: [], sessions: [], anchor_conflicts: [], claim_ttl_minutes: 120 },
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }),
      );

      await apiGetReadyReport(null, "plan with spaces");

      expect(calls[0]).toContain(encodeURIComponent("plan with spaces"));
    });
  });
});

describe("apiGetDoc", () => {
  describe("happy path", () => {
    it("returns DocWithNavigation from server envelope", async () => {
      const mockDoc = {
        doc: { id: "01", slug: "prd-test", title: "Test", type: "prd", status: "draft", content: "hello", created_at: "", updated_at: "", created_by: null, parent_id: null, tags: [], extra: {}, version: 1 },
        navigation: { parent: null, siblings: [], children: [], related: [] },
      };
      vi.stubGlobal("fetch", makeFetchMock({ ok: true, data: mockDoc }));

      const result = await apiGetDoc(null, "01");

      expect(result.doc.id).toBe("01");
      expect(result.navigation.parent).toBeNull();
    });

    it("passes through navigation.ancestors (SPEC-036 §1 D1, AC-36-1)", async () => {
      const mockDoc = {
        doc: { id: "03", slug: "task-x", title: "Task X", type: "task", status: "draft", content: "", created_at: "", updated_at: "", created_by: null, parent_id: "02", tags: [], extra: {}, version: 1 },
        navigation: {
          parent: { id: "02", slug: "plan-a", title: "Plan A", type: "plan", status: "active", updated_at: "" },
          ancestors: [{ id: "01", slug: "prd-root", title: "Root PRD", type: "prd", status: "active", updated_at: "" }],
          siblings: [],
          children: [],
          related: [],
        },
      };
      vi.stubGlobal("fetch", makeFetchMock({ ok: true, data: mockDoc }));

      const result = await apiGetDoc(null, "03");

      expect(result.navigation.ancestors).toHaveLength(1);
      expect(result.navigation.ancestors[0]?.title).toBe("Root PRD");
    });

    it("appends ?resolveMdx=true when resolveMdx option is set", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        const mockDoc = { doc: { id: "01", slug: "s", title: "T", type: "prd", status: "draft", content: "", created_at: "", updated_at: "", created_by: null, parent_id: null, tags: [], extra: {}, version: 1 }, navigation: { parent: null, siblings: [], children: [], related: [] }, resolvedMdx: { content: "", resolvedComponents: [], warnings: [] } };
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: mockDoc }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }));

      await apiGetDoc(null, "01", { resolveMdx: true });

      expect(calls[0]).toContain("resolveMdx=true");
    });

    it("URL-encodes the idOrSlug with special characters (regression)", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { doc: { id: "01", slug: "s", title: "T", type: "prd", status: "draft", content: "", created_at: "", updated_at: "", created_by: null, parent_id: null, tags: [], extra: {}, version: 1 }, navigation: { parent: null, siblings: [], children: [], related: [] } } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }));

      await apiGetDoc(null, "prd-my spec");

      expect(calls[0]).toContain(encodeURIComponent("prd-my spec"));
    });
  });

  describe("state", () => {
    it("two sequential calls each use their own response (no shared state)", async () => {
      let callCount = 0;
      vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
        callCount += 1;
        const id = `0${callCount}`;
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { doc: { id, slug: `s${id}`, title: `T${id}`, type: "prd", status: "draft", content: "", created_at: "", updated_at: "", created_by: null, parent_id: null, tags: [], extra: {}, version: 1 }, navigation: { parent: null, siblings: [], children: [], related: [] } } }), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }));

      const [r1, r2] = await Promise.all([apiGetDoc(null, "01"), apiGetDoc(null, "02")]);

      expect(r1.doc.id).toBe("01");
      expect(r2.doc.id).toBe("02");
    });
  });
});

// ─── NEGATIVE / ERROR paths ──────────────────────────────────────────────────

describe("ApiError", () => {
  describe("negative: server error response", () => {
    it("throws ApiError when server returns { ok: false }", async () => {
      vi.stubGlobal("fetch", makeFetchMock({ ok: false, error: { code: "DOC_NOT_FOUND", message: "Not found" } }, 404));

      await expect(apiGetDoc(null, "missing")).rejects.toThrow(ApiError);
    });

    it("ApiError has status=404 and code=DOC_NOT_FOUND", async () => {
      vi.stubGlobal("fetch", makeFetchMock({ ok: false, error: { code: "DOC_NOT_FOUND", message: "Not found" } }, 404));

      const err = await apiGetDoc(null, "missing").catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).code).toBe("DOC_NOT_FOUND");
    });

    it("throws ApiError on non-2xx with no JSON error field", async () => {
      vi.stubGlobal("fetch", makeFetchMock({ ok: false }, 500));

      await expect(apiList(null, {})).rejects.toThrow(ApiError);
    });
  });

  describe("error: network failure", () => {
    it("throws ApiError with code NETWORK_ERROR on fetch failure", async () => {
      vi.stubGlobal("fetch", makeNetworkErrorMock());

      const err = await apiGetStatus(null).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("NETWORK_ERROR");
    });
  });

  describe("error: JSON parse failure", () => {
    it("throws ApiError with code PARSE_ERROR when response is not valid JSON", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
        new Response("not-json", { status: 200, headers: { "Content-Type": "text/plain" } }),
      ));

      const err = await apiGetStatus(null).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("PARSE_ERROR");
    });
  });

  describe("regression: no Content-Type header still parses", () => {
    it("parses response even without Content-Type header", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { total_docs: 0, by_type: {}, by_status: {} } }), { status: 200 }),
      ));

      const result = await apiGetStatus(null);

      expect(result.total_docs).toBe(0);
    });
  });
});

// ─── SPEC-075: apiGetEvidencePanel / evidencePanelQueryKey ───────────────────

describe("apiGetEvidencePanel", () => {
  describe("happy path", () => {
    it("fetches GET /api/evidence-panel/:idOrSlug and returns the projection verbatim", async () => {
      const projection: EvidencePanelProjection = { doc_type: "task", evidence: [], ac_refs: [] };
      vi.stubGlobal("fetch", makeFetchMock({ ok: true, data: projection }));

      const result = await apiGetEvidencePanel(null, "task-fixture");

      expect(result).toStrictEqual(projection);
    });

    it("URL-encodes the idOrSlug parameter", async () => {
      const fetchMock = makeFetchMock({ ok: true, data: { doc_type: "other" } });
      vi.stubGlobal("fetch", fetchMock);

      await apiGetEvidencePanel(null, "spec/with slash");

      const calledUrl = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe(`/api/evidence-panel/${encodeURIComponent("spec/with slash")}`);
    });
  });

  describe("negative", () => {
    it("throws ApiError with the server's code on a DOC_NOT_FOUND response", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetchMock({ ok: false, error: { code: "DOC_NOT_FOUND", message: "not found" } }, 404),
      );

      const err = await apiGetEvidencePanel(null, "missing").catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("DOC_NOT_FOUND");
    });
  });

  describe("error: network failure", () => {
    it("throws ApiError with code NETWORK_ERROR", async () => {
      vi.stubGlobal("fetch", makeNetworkErrorMock());

      const err = await apiGetEvidencePanel(null, "task-fixture").catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("NETWORK_ERROR");
    });
  });
});

describe("evidencePanelQueryKey", () => {
  describe("happy path", () => {
    it("returns a ['evidence-panel', idOrSlug] tuple", () => {
      expect(evidencePanelQueryKey(null, "task-fixture")).toEqual(["evidence-panel", "task-fixture"]);
    });
  });

  describe("regression", () => {
    it("returns an equal-by-value key for the same idOrSlug across calls (TanStack Query cache-sharing contract)", () => {
      expect(evidencePanelQueryKey(null, "plan-x")).toEqual(evidencePanelQueryKey(null, "plan-x"));
    });
  });
});
