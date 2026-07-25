// @vitest-environment jsdom
/**
 * Tests for lib/project-api.ts — SPEC-078 D5 client factory triple
 * (apiFetch / queryKeys / useProjectParam).
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - apiFetch(null, "/docs") calls fetch("/api/docs") — registry-less,
 *       byte-identical to the pre-SPEC-078 direct call
 *     - apiFetch("acme", "/docs") calls fetch("/api/p/acme/api/docs")
 *     - apiFetch forwards `init` (method/headers/body) verbatim
 *     - queryKeys.scope(null, key) returns key unchanged
 *     - queryKeys.scope("acme", key) prefixes with a project segment
 *     - useProjectParam reads "acme" from pathname "/p/acme/library"
 *
 *   NEGATIVE:
 *     - useProjectParam returns null for a non-project-scoped pathname
 *     - queryKeys.scope(null, []) returns an empty array unchanged
 *
 *   BOUNDARY:
 *     - useProjectParam matches "/p/acme" with no trailing segment (exact,
 *       not just prefix-of-a-longer-name)
 *     - a project name containing url-encoded characters is decoded
 *
 *   ERROR:
 *     - (n/a — apiFetch has no additional error-throwing behavior of its own;
 *       it is a thin pathname-aware wrapper over the native `fetch`, whose
 *       rejection semantics are unchanged and already covered by every
 *       consumer's own test file, e.g. api.test.ts's NETWORK_ERROR cases)
 *
 *   STATE:
 *     - two sequential apiFetch calls with different projects each resolve
 *       to their own independent path (no shared/leaked state between calls)
 *
 *   REGRESSION:
 *     - a pathname like "/plan" (NOT "/p/...") must NOT false-positive match
 *       the "/p/:name" prefix pattern (guards a naive `pathname.startsWith("/p")` implementation)
 *     - queryKeys.scope is referentially the identity function's VALUE (same
 *       array contents) when project is null, guarding any future change
 *       that would silently break `getQueryData`/`invalidateQueries` cache matches
 *
 * @spec_ref SPEC-078 D5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockUseRouterState = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useRouterState: (opts: { select: (state: { location: { pathname: string } }) => string }) =>
    opts.select({ location: { pathname: mockUseRouterState() as string } }),
}));

import { apiFetch, queryKeys, useProjectParam } from "../../../src/lib/project-api";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
});

// ─── apiFetch ─────────────────────────────────────────────────────────────────

describe("apiFetch", () => {
  describe("happy path", () => {
    it("registry-less (project: null) hits /api<resourcePath>, byte-identical to today", async () => {
      await apiFetch(null, "/docs");

      const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0]?.[0]).toBe("/api/docs");
    });

    it("prefixes with /api/p/<project> when a project is given", async () => {
      await apiFetch("acme", "/docs");

      const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
      expect(mockFetch.mock.calls[0]?.[0]).toBe("/api/p/acme/api/docs");
    });

    it("forwards init (method/headers/body) verbatim to fetch", async () => {
      const init: RequestInit = { method: "POST", headers: { "X-Test": "1" }, body: "{}" };
      await apiFetch(null, "/dashboard/docs", init);

      const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
      expect(mockFetch.mock.calls[0]?.[1]).toBe(init);
    });
  });

  describe("state", () => {
    it("two sequential calls with different projects resolve independent paths", async () => {
      await apiFetch(null, "/docs");
      await apiFetch("beta", "/docs");

      const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
      expect(mockFetch.mock.calls[0]?.[0]).toBe("/api/docs");
      expect(mockFetch.mock.calls[1]?.[0]).toBe("/api/p/beta/api/docs");
    });
  });

  describe("regression", () => {
    it("url-encodes the project name in the prefix", async () => {
      await apiFetch("a b", "/docs");

      const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
      expect(mockFetch.mock.calls[0]?.[0]).toBe("/api/p/a%20b/api/docs");
    });
  });
});

// ─── queryKeys.scope ──────────────────────────────────────────────────────────

describe("queryKeys.scope", () => {
  describe("happy path", () => {
    it("returns the key unchanged when project is null (byte-stable cache shape)", () => {
      const key = ["doc", "abc123"];
      expect(queryKeys.scope(null, key)).toBe(key);
    });

    it("prefixes with a project segment when project is non-null", () => {
      expect(queryKeys.scope("acme", ["doc", "abc123"])).toEqual(["project:acme", "doc", "abc123"]);
    });
  });

  describe("negative", () => {
    it("returns an empty array unchanged for project: null", () => {
      expect(queryKeys.scope(null, [])).toEqual([]);
    });
  });

  describe("regression", () => {
    it("is the identity function's VALUE for project: null (guards cache-key drift)", () => {
      // reason: a future change that stopped short-circuiting on `null` (e.g.
      // always prepending an empty-string segment) would silently break every
      // existing invalidateQueries/getQueryData call site keying off this
      // exact array shape — this pins the value, not merely "some array".
      expect(queryKeys.scope(null, ["tree"])).toEqual(["tree"]);
      expect(queryKeys.scope(null, ["tree"])).not.toEqual(["project:null", "tree"]);
    });
  });
});

// ─── useProjectParam ──────────────────────────────────────────────────────────

describe("useProjectParam", () => {
  describe("happy path", () => {
    it("reads the project name from a /p/:name/... pathname", () => {
      mockUseRouterState.mockReturnValue("/p/acme/library");
      const { result } = renderHook(() => useProjectParam());
      expect(result.current).toBe("acme");
    });
  });

  describe("negative", () => {
    it("returns null for a non-project-scoped pathname", () => {
      mockUseRouterState.mockReturnValue("/library");
      const { result } = renderHook(() => useProjectParam());
      expect(result.current).toBeNull();
    });
  });

  describe("boundary", () => {
    it("matches /p/:name with no trailing segment (exact end-of-string)", () => {
      mockUseRouterState.mockReturnValue("/p/acme");
      const { result } = renderHook(() => useProjectParam());
      expect(result.current).toBe("acme");
    });

    it("url-decodes a project name containing encoded characters", () => {
      mockUseRouterState.mockReturnValue("/p/my%20project/library");
      const { result } = renderHook(() => useProjectParam());
      expect(result.current).toBe("my project");
    });
  });

  describe("regression", () => {
    it("does not false-positive match a pathname that merely starts with /p (e.g. /plan)", () => {
      mockUseRouterState.mockReturnValue("/plan");
      const { result } = renderHook(() => useProjectParam());
      expect(result.current).toBeNull();
    });
  });
});
