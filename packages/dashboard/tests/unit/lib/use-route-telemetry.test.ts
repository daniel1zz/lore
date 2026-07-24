// @vitest-environment jsdom
/**
 * Tests for use-route-telemetry.ts — route-navigation telemetry ping
 * (SPEC-075 R-10).
 * @spec_ref AC-075-8
 *
 * `resolveRouteViewParams` is a pure function (route_id/doc_type derivation)
 * and gets a direct, React-free unit test. `useRouteTelemetry` itself is
 * tested via `renderHook` with `@tanstack/react-router`'s `useRouterState`
 * and `apiPostRouteView` mocked — proving the hook's "one POST per pathname
 * change" contract without needing a real Router/RouterProvider tree.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - resolveRouteViewParams returns doc_type on a /docs/:id route when
 *       the lookup hits
 *     - the hook fires exactly one apiPostRouteView call per distinct
 *       pathname
 *   NEGATIVE:
 *     - resolveRouteViewParams omits doc_type on a non-doc route
 *     - resolveRouteViewParams omits doc_type on a /docs/:id route when the
 *       lookup misses (cache miss — never fabricated)
 *   BOUNDARY:
 *     - a re-render with the SAME pathname does NOT fire a second call
 *   ERROR:
 *     - n/a — apiPostRouteView's own silent-failure-swallow contract is
 *       covered in mutations.test.ts; this hook doesn't add its own
 *       try/catch to duplicate that
 *   STATE:
 *     - navigating to a SECOND distinct pathname fires a second, separate call
 *   REGRESSION:
 *     - a doc-route pathname decodes a URL-encoded id before the lookup
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { DocType } from "@lore/core";

const mockUseRouterState = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useRouterState: (opts: { select: (state: { location: { pathname: string } }) => string }) =>
    opts.select({ location: { pathname: mockUseRouterState() as string } }),
}));

const mockGetQueryData = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ getQueryData: mockGetQueryData }),
}));

const mockApiPostRouteView = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/api/mutations", () => ({
  apiPostRouteView: (...args: unknown[]) => mockApiPostRouteView(...args),
}));

import { useRouteTelemetry, resolveRouteViewParams } from "../../../src/lib/use-route-telemetry";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveRouteViewParams (pure) (AC-075-8)", () => {
  describe("happy path", () => {
    it("includes doc_type on a /docs/:id route when the lookup hits", () => {
      const result = resolveRouteViewParams("/docs/abc123", (id) => (id === "abc123" ? ("task" as DocType) : undefined));
      expect(result).toEqual({ route_id: "/docs/abc123", doc_type: "task" });
    });
  });

  describe("negative", () => {
    it("omits doc_type on a non-doc route", () => {
      const result = resolveRouteViewParams("/library", () => "task" as DocType);
      expect(result).toEqual({ route_id: "/library" });
    });

    it("omits doc_type on a /docs/:id route when the cache lookup misses", () => {
      const result = resolveRouteViewParams("/docs/unknown", () => undefined);
      expect(result).toEqual({ route_id: "/docs/unknown" });
    });
  });

  describe("regression", () => {
    it("URL-decodes the doc id before calling the lookup", () => {
      const lookup = vi.fn().mockReturnValue("spec" as DocType);
      resolveRouteViewParams("/docs/spec-my%20doc", lookup);
      expect(lookup).toHaveBeenCalledWith("spec-my doc");
    });
  });
});

describe("useRouteTelemetry (AC-075-8)", () => {
  describe("happy path (AC-075-8)", () => {
    it("fires exactly one apiPostRouteView call for the current pathname", () => {
      mockUseRouterState.mockReturnValue("/library");
      mockGetQueryData.mockReturnValue(undefined);

      renderHook(() => useRouteTelemetry());

      expect(mockApiPostRouteView).toHaveBeenCalledTimes(1);
      expect(mockApiPostRouteView).toHaveBeenCalledWith({ route_id: "/library" });
    });
  });

  describe("boundary", () => {
    it("does not fire a second call on a re-render with the same pathname", () => {
      mockUseRouterState.mockReturnValue("/tree");
      const { rerender } = renderHook(() => useRouteTelemetry());
      rerender();
      rerender();

      expect(mockApiPostRouteView).toHaveBeenCalledTimes(1);
    });
  });

  describe("state", () => {
    it("fires a second, separate call when the pathname changes", () => {
      mockUseRouterState.mockReturnValue("/library");
      const { rerender } = renderHook(() => useRouteTelemetry());
      expect(mockApiPostRouteView).toHaveBeenCalledTimes(1);

      mockUseRouterState.mockReturnValue("/tree");
      rerender();

      expect(mockApiPostRouteView).toHaveBeenCalledTimes(2);
      expect(mockApiPostRouteView).toHaveBeenNthCalledWith(2, { route_id: "/tree" });
    });
  });
});
