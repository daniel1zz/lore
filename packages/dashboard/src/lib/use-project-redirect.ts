/**
 * Multi-mode `/` redirect (SPEC-078 T10 deliverable 1).
 * Purpose: when a project registry exists (`dashboard.projects` non-empty),
 *   the bare `/` route immediately redirects to a resolved `/p/:name` so Home
 *   becomes project-scoped like every other route. Registry-less mode (no
 *   registry, or the `GET /api/projects` route doesn't exist yet — see
 *   `use-projects-query.ts`'s `isRegistryAbsent`) is a no-op: `/` renders
 *   exactly as it does today (R-15 byte-identical requirement).
 * Public surface: useProjectRedirect, resolveRedirectTarget
 * Invariants:
 *   - Priority order per SPEC-078 T10 dispatch: localStorage last-viewed (if
 *     that name still exists in the registry) → first registry entry. The
 *     dispatch's originally-stated "cwd-project-if-registered" tier is
 *     dropped — the server exposes no cwd hint on this route (`ProjectsResponse`
 *     carries only `projects[]` + `instance{port, registry_name}`, no cwd
 *     field), so there is nothing to match against; inventing one would be a
 *     fabricated signal, not a real priority tier.
 *   - Client-side only (`localStorage`, `useNavigate({replace: true})`) — no
 *     server involvement beyond the read-only registry fetch.
 *   - A registry with >=1 project but whose entries are ALL non-mounted
 *     (missing/schema-skew/error) still redirects to the resolved target —
 *     the target project's OWN route surfaces its error state (D7/AC-078-10),
 *     this hook does not pre-filter by mount state.
 *   - Any query error OTHER than "registry absent" (`isRegistryAbsent`) is
 *     treated as inconclusive here and does NOT redirect — redirecting on an
 *     ambiguous transient failure risks a redirect loop; staying at `/` is
 *     the safe default (the page's own error UI, if any, is a separate
 *     concern from this hook).
 * Side-effect class: IO (localStorage read, client-side navigation)
 * Source: SPEC-078 T10 dispatch deliverable 1
 */

import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useProjectsQuery } from "@/lib/use-projects-query";
import { getLastViewedProject } from "@/lib/project-storage";
import type { ProjectsResponseEntry } from "@/lib/project-api";

/**
 * Pure resolution of the redirect target from the registry entries plus the
 * last-viewed project name — separated from the hook for an independent,
 * React-free unit test (mirrors `resolveRouteViewParams`'s precedent).
 *
 * @param projects - Registry entries from `GET /api/projects` (declaration order).
 * @param lastViewed - `getLastViewedProject()`'s result.
 * @returns The project name to redirect to, or `null` when `projects` is empty
 *   (registry configured but empty — same "stay at /" outcome as absent).
 * @example
 * resolveRedirectTarget([{name: "acme", state: "mounted"}], "acme") // => "acme"
 * @example
 * resolveRedirectTarget([{name: "acme", state: "mounted"}], "stale-deleted-project") // => "acme"
 * @example
 * resolveRedirectTarget([], "acme") // => null
 */
export function resolveRedirectTarget(
  projects: readonly Pick<ProjectsResponseEntry, "name">[],
  lastViewed: string | null,
): string | null {
  if (projects.length === 0) return null;
  if (lastViewed !== null && projects.some((p) => p.name === lastViewed)) {
    return lastViewed;
  }
  return projects[0]?.name ?? null;
}

/**
 * Mounted ONLY by the top-level `/` route (`routes/index.tsx`) — redirects to
 * `/p/:name` when a project registry is present, no-ops in registry-less mode.
 *
 * @example
 * // routes/index.tsx
 * function HomeRoute() {
 *   useProjectRedirect();
 *   return <HomePage />;
 * }
 */
export function useProjectRedirect(): void {
  const navigate = useNavigate();
  const { data } = useProjectsQuery();

  useEffect(() => {
    // reason: still loading, registry absent (404), or any other query error —
    // all three stay at "/" (no redirect). `isRegistryAbsent` isn't consulted
    // here directly because EVERY non-success `data` state (loading, absent,
    // or a real error) resolves to the identical no-op; the distinction only
    // matters to a caller that needs to render a loud error state, which this
    // silent-navigation hook is not (see module doc comment).
    if (data === undefined) return;
    const target = resolveRedirectTarget(data.projects, getLastViewedProject());
    if (target !== null) {
      void navigate({ to: "/p/$name", params: { name: target }, replace: true });
    }
  }, [data, navigate]);
}
