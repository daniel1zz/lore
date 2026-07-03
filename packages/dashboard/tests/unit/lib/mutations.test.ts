// @vitest-environment jsdom

/**
 * @spec_ref AC-DASH-WRITE-3, AC-DASH-WRITE-9, AC-DASH-WRITE-10, AC-DH-6, AC-DH-7
 *
 * Unit tests for dashboard write API mutations.
 * Source: SPEC-022 §9.3, §9.4, mutations.ts public surface; SPEC-027 AC-DH-6, AC-DH-7.
 *
 * Spec expectations (written before reading implementation):
 *   - apiCreateDoc: validates payload client-side; throws DashboardApiError on 4xx
 *   - apiPatchDoc with version: sends If-Match header (AC-DASH-WRITE-3)
 *   - apiPatchDoc with forceOverwrite: sends X-Force-Overwrite: 1 header (§8 Q-extra)
 *   - 409 response: throws ConflictError with current/mine/diff fields
 *   - 422 response: throws DashboardApiError with status 422
 *   - Without version and forceOverwrite: sends neither If-Match nor X-Force-Overwrite
 *   - All requests use credentials: "include" (cookie auth per SPEC-022 §9.5)
 *   - Empty title must fail before HTTP call (AC-DASH-WRITE-10)
 *   - apiDeleteDoc always appends ?confirm=true to the DELETE URL (AC-DH-6)
 *   - apiRestoreVersion sends POST with a JSON { version } body (AC-DH-7)
 *
 * MOCK RISK: fetch is mocked globally. Real network/cookie behavior is not tested here.
 * Integration test (dashboard-routes.test.ts) covers server-side without mocks.
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DocRecord } from "@lore/core";
import {
  apiCreateDoc,
  apiPatchDoc,
  apiApproveDoc,
  apiRejectDoc,
  apiCreateLink,
  apiDeleteLink,
  apiDeleteDoc,
  apiRestoreVersion,
  DashboardApiError,
  ConflictError,
} from "../../../src/api/mutations";

// ─── Test setup ───────────────────────────────────────────────────────────────

/** Minimal DocRecord that satisfies the type for response mocking. */
function makeDocRecord(overrides?: Partial<DocRecord>): DocRecord {
  return {
    id: "01JTEST",
    slug: "prd-test-doc",
    title: "Test Doc",
    type: "prd",
    status: "draft",
    content: "content",
    version: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    created_by: null,
    parent_id: null,
    tags: [],
    extra: {},
    ...overrides,
  };
}

/** Build a mock Response with a JSON body. */
function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  global.fetch = vi.fn();
});

// ─── Captured headers helper ───────────────────────────────────────────────────

/** Extract headers from the last mocked fetch call. */
function capturedHeaders(): Record<string, string> {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  if (calls.length === 0) throw new Error("fetch was not called");
  const init = calls[calls.length - 1]?.[1] as RequestInit | undefined;
  const headers = init?.headers;
  if (!headers || typeof headers !== "object") return {};
  return headers as Record<string, string>;
}

// ─── HAPPY paths ──────────────────────────────────────────────────────────────

describe("apiCreateDoc — happy path", () => {
  it("returns the DocRecord from the response on success", async () => {
    const doc = makeDocRecord({ title: "My New PRD", type: "prd" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    const result = await apiCreateDoc({ type: "prd", title: "My New PRD" });
    expect(result).toStrictEqual(doc);
  });

  it("sends POST to /api/dashboard/docs with credentials: include", async () => {
    const doc = makeDocRecord();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    await apiCreateDoc({ type: "prd", title: "My New PRD" });

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/dashboard/docs");
    expect(call[1]?.method).toBe("POST");
    expect(call[1]?.credentials).toBe("include");
  });

  it("returns different DocRecords for different payloads (anti-hardcode)", async () => {
    const doc1 = makeDocRecord({ id: "DOC1", title: "PRD One", type: "prd" });
    const doc2 = makeDocRecord({ id: "DOC2", title: "Plan Two", type: "plan" });

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ ok: true, data: { doc: doc1 } }))
      .mockResolvedValueOnce(mockJsonResponse({ ok: true, data: { doc: doc2 } }));

    const r1 = await apiCreateDoc({ type: "prd", title: "PRD One" });
    const r2 = await apiCreateDoc({ type: "plan", title: "Plan Two" });

    expect(r1.id).toBe("DOC1");
    expect(r2.id).toBe("DOC2");
    expect(r1.type).not.toBe(r2.type);
  });
});

describe("apiPatchDoc — header dispatch", () => {
  it("sends If-Match header when version is provided", async () => {
    // AC-DASH-WRITE-3: client must send If-Match for optimistic concurrency
    const doc = makeDocRecord({ version: 5 });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    await apiPatchDoc("01JTEST", { content: "updated" }, { version: 5 });

    const headers = capturedHeaders();
    expect(headers["If-Match"]).toBe("5");
    // Must NOT also set X-Force-Overwrite when version is provided
    expect(headers["X-Force-Overwrite"]).toBeUndefined();
  });

  it("sends X-Force-Overwrite: 1 header when forceOverwrite is true", async () => {
    // §8 Q-extra: force overwrite path uses X-Force-Overwrite: 1
    const doc = makeDocRecord();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    await apiPatchDoc("01JTEST", { content: "force write" }, { forceOverwrite: true });

    const headers = capturedHeaders();
    expect(headers["X-Force-Overwrite"]).toBe("1");
    // Must NOT also set If-Match when forceOverwrite is true
    expect(headers["If-Match"]).toBeUndefined();
  });

  it("sends PATCH to the correct URL with the doc id encoded", async () => {
    const doc = makeDocRecord();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    await apiPatchDoc("my-doc-id", { content: "updated" }, { version: 1 });

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/dashboard/docs/");
    expect(call[0]).toContain("my-doc-id");
    expect(call[1]?.method).toBe("PATCH");
  });
});

// ─── NEGATIVE paths ───────────────────────────────────────────────────────────

describe("apiPatchDoc — 409 → ConflictError (AC-DASH-WRITE-3)", () => {
  // reason: the server ALWAYS wraps error payloads under an `error` key —
  // `jsonError(payload, status)` (packages/lore/src/adapters/http/middleware.ts)
  // produces `{ ok: false, error: payload }` for every non-2xx response, including
  // the 409 conflict payload built by `checkConcurrency`
  // (packages/lore/src/adapters/http/concurrency.ts). These mocks previously placed
  // `current`/`mine`/`diff` at the top level of the body, which never matched the real
  // server and masked a genuine bug in `writeFetch`'s 409 handling (it silently fell
  // back to a generic DashboardApiError instead of ConflictError — verified against the
  // live HTTP server via manual curl during diagnosis of the SPEC-022 e2e ConflictModal
  // failure). Mocks below now mirror the real `{ ok: false, error: {...} }` envelope.
  it("throws ConflictError when server returns 409 with conflict payload", async () => {
    const currentDoc = makeDocRecord({ content: "server content", version: 3 });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse(
        {
          ok: false,
          error: {
            current: currentDoc,
            mine: "client content",
            diff: "--- yours\n+++ theirs\n@@ -1 +1 @@\n-client content\n+server content",
          },
        },
        409,
      ),
    );

    await expect(
      apiPatchDoc("01JTEST", { content: "client content" }, { version: 2 }),
    ).rejects.toThrow(ConflictError);
  });

  it("ConflictError carries current, mine, and diff from the 409 payload", async () => {
    const currentDoc = makeDocRecord({ content: "server content", version: 3 });
    const diff = "--- yours\n+++ theirs\n@@ -1 +1 @@\n-client\n+server";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: false, error: { current: currentDoc, mine: "client content", diff } }, 409),
    );

    let caughtError: ConflictError | null = null;
    try {
      await apiPatchDoc("01JTEST", { content: "client content" }, { version: 2 });
    } catch (e) {
      if (e instanceof ConflictError) caughtError = e;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.status).toBe(409);
    expect(caughtError!.current).toStrictEqual(currentDoc);
    expect(caughtError!.mine).toBe("client content");
    expect(caughtError!.diff).toBe(diff);
  });

  it("ConflictError is an instance of DashboardApiError", async () => {
    // ConflictError must extend DashboardApiError for unified catch handling
    const currentDoc = makeDocRecord({ version: 3 });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: false, error: { current: currentDoc, mine: "mine", diff: "diff" } }, 409),
    );

    const err = await apiPatchDoc("01JTEST", { content: "mine" }, { version: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toBeInstanceOf(DashboardApiError);
  });

  it("REGRESSION: falls back to generic DashboardApiError when the 409 body lacks the error.current/mine/diff shape (e.g. top-level fields, matching the pre-fix bug)", async () => {
    // This mirrors the exact defect found in writeFetch: if current/mine/diff were
    // (incorrectly) placed outside `error`, the client must NOT crash — it degrades to
    // a generic conflict error rather than silently constructing a broken ConflictError.
    const currentDoc = makeDocRecord({ version: 3 });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: false, current: currentDoc, mine: "mine", diff: "diff" }, 409),
    );

    const err = await apiPatchDoc("01JTEST", { content: "mine" }, { version: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(DashboardApiError);
    expect(err).not.toBeInstanceOf(ConflictError);
    expect((err as DashboardApiError).code).toBe("STALE_VERSION");
  });
});

describe("apiCreateDoc — 422 → DashboardApiError (AC-DASH-WRITE-10)", () => {
  it("throws DashboardApiError with status 422 when server returns 422", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse(
        { ok: false, error: { code: "VALIDATION_ERROR", message: "title is required" } },
        422,
      ),
    );

    const err = await apiCreateDoc({ type: "prd", title: "Valid Title" }).catch((e) => e);
    expect(err).toBeInstanceOf(DashboardApiError);
    expect(err.status).toBe(422);
  });

  it("client-side Zod validation rejects empty title BEFORE making HTTP call (AC-DASH-WRITE-10)", async () => {
    // Spec AC-DASH-WRITE-10: client-side validation must reject without HTTP call.
    // DEFECT DETECTION: createDocInputSchema has `title: z.string()` with no .min(1).
    // An empty title passes the schema, reaches writeFetch, and an HTTP call IS made.
    // This test FAILS to document the defect: spec requires client-side rejection,
    // implementation does not enforce it. Fix: add .min(1) to title in createDocInputSchema.
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    // Prime the mock so that if fetch IS called we get a valid response back,
    // making the assertion about `not.toHaveBeenCalled` the clean signal of the defect.
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc: makeDocRecord() } }),
    );

    let threw: Error | null = null;
    try {
      // @ts-expect-error — intentionally passing empty title to test validation
      await apiCreateDoc({ type: "prd", title: "" });
    } catch (e) {
      threw = e as Error;
    }

    // Spec says: a DashboardApiError must be thrown BEFORE the HTTP call is made.
    // If this assertion fails, it means empty title was not rejected client-side.
    expect(threw, "empty title must throw DashboardApiError (AC-DASH-WRITE-10)").toBeInstanceOf(DashboardApiError);
    // Spec says: no HTTP call should have been made
    expect(fetchMock, "fetch must not be called when client-side validation rejects").not.toHaveBeenCalled();
  });
});

// ─── BOUNDARY conditions ──────────────────────────────────────────────────────

describe("apiPatchDoc — no version and no forceOverwrite", () => {
  it("sends neither If-Match nor X-Force-Overwrite when no options are given", async () => {
    // Spec §9.4: absent If-Match → skip check (legacy path). Client must not add spurious headers.
    const doc = makeDocRecord();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    await apiPatchDoc("01JTEST", { content: "bare patch" });

    const headers = capturedHeaders();
    expect(headers["If-Match"]).toBeUndefined();
    expect(headers["X-Force-Overwrite"]).toBeUndefined();
  });

  it("forceOverwrite:true takes precedence over version when both are provided", async () => {
    // §8 Q-extra: forceOverwrite wins — no If-Match should be sent alongside X-Force-Overwrite
    const doc = makeDocRecord();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    await apiPatchDoc("01JTEST", { content: "force" }, { version: 3, forceOverwrite: true });

    const headers = capturedHeaders();
    expect(headers["X-Force-Overwrite"]).toBe("1");
    // When force is true, If-Match must NOT be sent — force means unconditional write
    expect(headers["If-Match"]).toBeUndefined();
  });
});

describe("apiDeleteLink — boundary", () => {
  it("does not throw on 204 response (no-content is a success)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    await expect(apiDeleteLink("from-id", "to-id")).resolves.toBeUndefined();
  });
});

// ─── ERROR paths ──────────────────────────────────────────────────────────────

describe("DashboardApiError error classification", () => {
  it("throws DashboardApiError with status 403 on 403 response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse(
        { ok: false, error: { code: "FORBIDDEN", message: "Bearer sessions not allowed" } },
        403,
      ),
    );

    const err = await apiCreateDoc({ type: "prd", title: "Test" }).catch((e) => e);
    expect(err).toBeInstanceOf(DashboardApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
  });

  it("throws DashboardApiError with NETWORK_ERROR code when fetch itself throws", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const err = await apiCreateDoc({ type: "prd", title: "Test" }).catch((e) => e);
    expect(err).toBeInstanceOf(DashboardApiError);
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.status).toBe(0);
  });
});

// ─── apiDeleteDoc (SPEC-027 AC-DH-6) ────────────────────────────────────────────

describe("apiDeleteDoc — happy path (AC-DH-6)", () => {
  it("returns {id, recoverable_until} from the response on success", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { id: "01JTEST", recoverable_until: "2024-02-01T00:00:00Z" } }),
    );

    const result = await apiDeleteDoc("01JTEST");
    expect(result).toStrictEqual({ id: "01JTEST", recoverable_until: "2024-02-01T00:00:00Z" });
  });

  it("sends DELETE with credentials: include and ?confirm=true appended to the URL", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { id: "01JTEST", recoverable_until: "2024-02-01T00:00:00Z" } }),
    );

    await apiDeleteDoc("01JTEST");

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/dashboard/docs/01JTEST?confirm=true");
    expect(call[1]?.method).toBe("DELETE");
    expect(call[1]?.credentials).toBe("include");
  });

  it("URL-encodes a slug id containing special characters", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { id: "prd-a/b", recoverable_until: "2024-02-01T00:00:00Z" } }),
    );

    await apiDeleteDoc("prd-a/b");

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(`/api/dashboard/docs/${encodeURIComponent("prd-a/b")}?confirm=true`);
  });
});

describe("apiDeleteDoc — error path", () => {
  it("throws DashboardApiError with status 404 when the doc doesn't exist", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: false, error: { code: "DOC_NOT_FOUND", message: "not found" } }, 404),
    );

    const err = await apiDeleteDoc("missing-id").catch((e) => e);
    expect(err).toBeInstanceOf(DashboardApiError);
    expect(err.status).toBe(404);
  });

  it("throws DashboardApiError with status 400 when confirm is rejected server-side", async () => {
    // BOUNDARY: apiDeleteDoc always sends confirm=true, so this exercises the
    // server's defense-in-depth path being surfaced faithfully to the caller
    // rather than silently swallowed.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: false, error: { code: "DELETE_REQUIRES_CONFIRM", message: "confirm required" } }, 400),
    );

    const err = await apiDeleteDoc("01JTEST").catch((e) => e);
    expect(err).toBeInstanceOf(DashboardApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("DELETE_REQUIRES_CONFIRM");
  });
});

// ─── apiRestoreVersion (SPEC-027 AC-DH-7) ───────────────────────────────────────

describe("apiRestoreVersion — happy path (AC-DH-7)", () => {
  it("returns the restored DocRecord from the response", async () => {
    const doc = makeDocRecord({ version: 3, status: "draft" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    const result = await apiRestoreVersion("01JTEST", 1);
    expect(result).toStrictEqual(doc);
  });

  it("sends POST with a JSON { version } body to the /restore endpoint", async () => {
    const doc = makeDocRecord({ version: 3 });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    await apiRestoreVersion("01JTEST", 1);

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/dashboard/docs/01JTEST/restore");
    expect(call[1]?.method).toBe("POST");
    expect(call[1]?.credentials).toBe("include");
    expect(JSON.parse(call[1]?.body as string)).toStrictEqual({ version: 1 });
  });
});

describe("apiRestoreVersion — error path", () => {
  it("throws DashboardApiError with status 404 when the target version doesn't exist", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: false, error: { code: "DOC_NOT_FOUND", message: "Version 99 not found" } }, 404),
    );

    const err = await apiRestoreVersion("01JTEST", 99).catch((e) => e);
    expect(err).toBeInstanceOf(DashboardApiError);
    expect(err.status).toBe(404);
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("regression — apiApproveDoc and apiRejectDoc", () => {
  it("apiApproveDoc returns DocRecord from response", async () => {
    const doc = makeDocRecord({ status: "approved" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    const result = await apiApproveDoc("01JTEST");
    expect(result.status).toBe("approved");
  });

  it("apiRejectDoc returns DocRecord from response", async () => {
    const doc = makeDocRecord({ status: "draft" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { doc } }),
    );

    const result = await apiRejectDoc("01JTEST", "Needs more work");
    expect(result.status).toBe("draft");
  });

  it("apiCreateLink returns void (not DocRecord) — spec says 201 with {ok: true}", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ ok: true, data: { ok: true } }, 201),
    );

    const result = await apiCreateLink("from-id", { to: "to-id", type: "relates-to" });
    expect(result).toBeUndefined(); // apiCreateLink returns void
  });
});
