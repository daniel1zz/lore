// @vitest-environment jsdom

/**
 * @spec_ref AC-P0C-8
 *
 * BR-996 (baseline rule): every dashboard write behaves on a registered project as with a
 * single project. At the client seam that means every exported WRITE function of
 * `src/api/mutations.ts` addresses `/api/p/<project>/api/...` when given a project name and
 * the plain `/api/...` path when given `null` (the launch directory's project).
 *
 * The test ENUMERATES the module's exports (`Object.keys` of the namespace) and fails on any
 * export that has neither a write case below nor an entry in NON_WRITE_EXPORTS — so a new
 * write function added to mutations.ts cannot ship without a project-scope case.
 *
 * MOCK RISK: `fetch` is mocked globally; only the request address (and `If-Match`) is
 * asserted. The server-side half of BR-996 is covered by multi-project-write-parity.spec.ts.
 *
 * Six-dimension coverage:
 *   HAPPY      — project name prefixes the address; null keeps the plain address
 *   NEGATIVE   — an unseen export fails the enumeration; a project never leaks into null calls
 *   BOUNDARY   — project name needing URL-encoding is encoded, not spliced raw
 *   ERROR      — a 409 on a project-scoped PATCH still surfaces as ConflictError
 *   STATE      — consecutive calls with different projects do not bleed into each other
 *   REGRESSION — BR-996 enumeration of exports
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as mutations from "../../../src/api/mutations";

const PROJECT = "acme";

/** Exports that are not write calls (error classes) — they never address an endpoint. */
const NON_WRITE_EXPORTS: ReadonlySet<string> = new Set(["DashboardApiError", "ConflictError", "ConfigConflictError"]);

type WriteCase = (project: string | null) => Promise<unknown>;

/** One case per exported write function. Each invokes the function with the given project. */
const WRITE_CASES: Readonly<Record<string, WriteCase>> = {
  apiCreateDoc: (p) => mutations.apiCreateDoc(p, { type: "prd", title: "T" } as Parameters<typeof mutations.apiCreateDoc>[1]),
  apiPatchDoc: (p) => mutations.apiPatchDoc(p, "doc-1", { title: "x" }, { version: 4 }),
  apiApproveDoc: (p) => mutations.apiApproveDoc(p, "doc-1"),
  apiRejectDoc: (p) => mutations.apiRejectDoc(p, "doc-1", "because"),
  apiDeleteDoc: (p) => mutations.apiDeleteDoc(p, "doc-1"),
  apiRestoreVersion: (p) => mutations.apiRestoreVersion(p, "doc-1", 2),
  apiCreateLink: (p) => mutations.apiCreateLink(p, "doc-1", { to: "doc-2", type: "relates-to" }),
  apiDeleteLink: (p) => mutations.apiDeleteLink(p, "doc-1", "doc-2"),
  apiPatchConfig: (p) => mutations.apiPatchConfig(p, { a: 1 }, "hash-1"),
  apiPatchMachineConfig: (p) => mutations.apiPatchMachineConfig(p, { a: 1 }, "hash-1"),
  apiPostRouteView: (p) => mutations.apiPostRouteView(p, { route_id: "/library" }),
};

const WRITE_NAMES = Object.keys(WRITE_CASES);

let fetchMock: ReturnType<typeof vi.fn>;

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true, data: { doc: { id: "doc-1" }, warnings: [] } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (call === undefined) throw new Error("fetch was never called");
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

beforeEach(() => {
  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BR-996 export enumeration — every mutations.ts export is a classified write or a non-write", () => {
  it("fails on any export that has no write case and is not a known non-write", () => {
    const exported = Object.keys(mutations);
    const unclassified = exported.filter((name) => !(name in WRITE_CASES) && !NON_WRITE_EXPORTS.has(name));
    expect(unclassified, `mutations.ts exports without a project-scope case: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("has an export behind every case (no stale case table)", () => {
    const exported = new Set(Object.keys(mutations));
    const stale = [...WRITE_NAMES, ...NON_WRITE_EXPORTS].filter((name) => !exported.has(name));
    expect(stale).toEqual([]);
  });

  it("every write case entry is a function export", () => {
    for (const name of WRITE_NAMES) {
      expect(typeof (mutations as Record<string, unknown>)[name], name).toBe("function");
    }
  });
});

describe("BR-996 project-scoped address — every write function", () => {
  for (const name of WRITE_NAMES) {
    it(`${name} given a project hits /api/p/<project>/api/... and never the plain path`, async () => {
      await WRITE_CASES[name]!(PROJECT);
      const { url } = lastCall();
      expect(url.startsWith(`/api/p/${PROJECT}/api/`), `${name} → ${url}`).toBe(true);
    });

    it(`${name} given null hits the plain /api/... path with no project segment`, async () => {
      await WRITE_CASES[name]!(null);
      const { url } = lastCall();
      expect(url.startsWith("/api/"), `${name} → ${url}`).toBe(true);
      expect(url.startsWith("/api/p/"), `${name} → ${url}`).toBe(false);
    });

    it(`${name} addresses the SAME resource under both modes (only the prefix differs)`, async () => {
      await WRITE_CASES[name]!(null);
      const plain = lastCall().url;
      await WRITE_CASES[name]!(PROJECT);
      const scoped = lastCall().url;
      expect(scoped).toBe(plain.replace("/api/", `/api/p/${PROJECT}/api/`));
    });
  }
});

describe("BR-996 boundary and state", () => {
  it("URL-encodes a project name that is not path-safe", async () => {
    await mutations.apiApproveDoc("my project/x", "doc-1");
    expect(lastCall().url.startsWith("/api/p/my%20project%2Fx/api/")).toBe(true);
  });

  it("alternating project and null calls do not bleed the project across calls", async () => {
    await mutations.apiDeleteDoc(PROJECT, "doc-1");
    expect(lastCall().url.startsWith(`/api/p/${PROJECT}/`)).toBe(true);
    await mutations.apiDeleteDoc(null, "doc-1");
    expect(lastCall().url.startsWith("/api/p/")).toBe(false);
    await mutations.apiDeleteDoc("other", "doc-1");
    expect(lastCall().url.startsWith("/api/p/other/")).toBe(true);
  });

  it("a project-scoped PATCH still sends If-Match with the given version", async () => {
    await mutations.apiPatchDoc(PROJECT, "doc-1", { title: "x" }, { version: 7 });
    const { init } = lastCall();
    expect((init.headers as Record<string, string>)["If-Match"]).toBe("7");
  });

  it("a project-scoped PATCH answered 409 surfaces as ConflictError (same out-of-date check)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error: { code: "STALE_VERSION", current: { id: "doc-1" }, mine: "m", diff: "d" } }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(mutations.apiPatchDoc(PROJECT, "doc-1", { content: "m" }, { version: 1 })).rejects.toBeInstanceOf(
      mutations.ConflictError,
    );
    expect(lastCall().url.startsWith(`/api/p/${PROJECT}/api/`)).toBe(true);
  });
});
