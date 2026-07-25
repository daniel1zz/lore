/**
 * useRouteTelemetry — fires one dashboard route-navigation telemetry ping
 * per TanStack Router location change (SPEC-075 R-10, PRD §21 F2).
 * Purpose: mounted ONCE at the root layout (`routes/__root.tsx`) so every
 *   client-side navigation — home, library, tree, settings, issues, a doc
 *   detail page — records exactly one `POST /api/dashboard/telemetry/route-view`
 *   event, with the loaded doc's type attached when cheaply available.
 * Public surface: useRouteTelemetry, resolveRouteViewParams (exported for
 *   direct unit testing of the pure route_id/doc_type derivation, mirroring
 *   `resolved-content.ts::splitContentByPlaceholders`'s "pure logic gets a
 *   pure unit test, independent of React" precedent)
 * Invariants:
 *   - Exactly one `apiPostRouteView` call per DISTINCT pathname — a `useRef`
 *     guard compares the incoming pathname against the last one fired,
 *     so neither a same-pathname re-render (e.g. a sibling query
 *     invalidating and re-rendering the root layout) nor React StrictMode's
 *     dev-mode double-effect-invocation double-fires the ping.
 *   - `doc_type` is derived from the TanStack Query cache (`["doc", id]`,
 *     the SAME key `routes/docs.$id.tsx` populates) — NEVER a fresh fetch.
 *     "Cheaply available" means "already in cache"; a cache miss (doc still
 *     loading, or not on a doc route at all) omits `doc_type` entirely
 *     rather than fabricating it or blocking on a fetch.
 *   - `apiPostRouteView` (`api/mutations.ts`) is itself fire-and-forget and
 *     never throws — this hook does not additionally try/catch it; the
 *     silent-failure-swallow contract is `apiPostRouteView`'s, not
 *     duplicated here.
 * Side-effect class: IO (fires apiPostRouteView on location change)
 * Source: SPEC-075 §Module Boundary D7, R-10, AC-075-8
 *
 * @example
 * // routes/__root.tsx
 * function RootLayout() {
 *   useRouteTelemetry();
 *   return <Outlet />;
 * }
 */

import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DocType } from "@lore/core";
import type { DocWithNavigation } from "@/lib/api";
import { apiPostRouteView } from "@/api/mutations";
import { queryKeys, useProjectParam } from "@/lib/project-api";

/**
 * Matches `/docs/:id`, optionally prefixed by `/p/:name` (SPEC-078 T10) — the
 * only route shape whose loaded doc carries a `doc_type`.
 */
const DOC_ROUTE_PATTERN = /^(?:\/p\/[^/]+)?\/docs\/([^/]+)$/;

/**
 * Pure derivation of `{route_id, doc_type?}` from a pathname plus a doc_type
 * lookup callback — separated from the hook so this logic has an
 * independent, React-free unit test.
 *
 * @param pathname - The router's current `location.pathname`.
 * @param lookupDocType - Resolves a cached doc's `type` for a given doc id,
 *   or `undefined` on a cache miss. Callers pass a TanStack Query cache read.
 * @returns `route_id` always equals `pathname` verbatim; `doc_type` is
 *   present only when `pathname` matches `/docs/:id` AND the lookup hits.
 * @example
 * resolveRouteViewParams("/docs/abc", (id) => (id === "abc" ? "task" : undefined));
 * // => { route_id: "/docs/abc", doc_type: "task" }
 * @example
 * resolveRouteViewParams("/library", () => undefined);
 * // => { route_id: "/library" }
 */
export function resolveRouteViewParams(
  pathname: string,
  lookupDocType: (docId: string) => DocType | undefined,
): { route_id: string; doc_type?: DocType } {
  const docMatch = DOC_ROUTE_PATTERN.exec(pathname);
  if (docMatch?.[1] === undefined) {
    return { route_id: pathname };
  }
  const docType = lookupDocType(decodeURIComponent(docMatch[1]));
  return docType !== undefined ? { route_id: pathname, doc_type: docType } : { route_id: pathname };
}

/** Reads a doc's cached `type` from the TanStack Query `["doc", id]` cache entry, if present. */
function lookupCachedDocType(queryClient: QueryClient, project: string | null, docId: string): DocType | undefined {
  const cached = queryClient.getQueryData<DocWithNavigation>(queryKeys.scope(project, ["doc", docId]));
  return cached?.doc.type;
}

/**
 * Subscribes to TanStack Router location changes and fires one route-view
 * telemetry ping per navigation. Mount exactly once, at the root layout.
 *
 * @example
 * useRouteTelemetry();
 */
export function useRouteTelemetry(): void {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const project = useProjectParam();
  const queryClient = useQueryClient();
  const lastFiredPathnameRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastFiredPathnameRef.current === pathname) return;
    lastFiredPathnameRef.current = pathname;

    const params = resolveRouteViewParams(pathname, (docId) => lookupCachedDocType(queryClient, project, docId));
    void apiPostRouteView(project, params);
  }, [pathname, project, queryClient]);
}
