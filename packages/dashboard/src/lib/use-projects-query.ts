/**
 * Shared TanStack Query binding for the SPEC-078 D7 mount-registry
 * projection (`GET /api/projects`).
 * Purpose: the ONE query both `ProjectSwitcher` and `use-project-redirect.ts`
 *   read — a single cache entry, so a switcher render and a same-mount
 *   redirect probe never issue two independent requests.
 * Public surface: PROJECTS_QUERY_KEY, useProjectsQuery, isRegistryAbsent
 * Invariants:
 *   - `project: null` always — `apiGetProjects` takes no project parameter
 *     (see its own doc comment in `lib/api.ts`); this hook does not call
 *     `useProjectParam()`.
 *   - `retry: false` — a 404 (no registry route/config) is the expected
 *     "registry-less" signal, not a transient failure to retry into.
 *   - `isRegistryAbsent` is the ONE place that classifies "no registry" vs
 *     "a real error" (404 → absent; anything else → real error, callers must
 *     fail loud, never swallow it into the same silent-degrade path — SPEC-078
 *     T10 dispatch: "fail loud on unexpected errors").
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-078 D5/D7, T10
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiGetProjects, ApiError } from "@/lib/api";
import { queryKeys, type ProjectsResponse } from "@/lib/project-api";

/** Shared query key — `project: null` always (see module doc comment). */
export const PROJECTS_QUERY_KEY = queryKeys.scope(null, ["projects"]);

/**
 * Classifies a query error as "no registry configured" (404) vs a real,
 * surfaceable failure. Callers use this to decide degrade-silently vs
 * fail-loud (SPEC-078 T10 dispatch requirement).
 *
 * @param error - The `useQuery` error value (typed `unknown` by TanStack Query).
 * @returns `true` only for a 404 `ApiError` — every other error (network,
 *   5xx, malformed schema) is a real failure the caller must surface.
 */
export function isRegistryAbsent(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * @example
 * const { data, error, isLoading } = useProjectsQuery();
 * if (data !== undefined && data.projects.length > 0) { ... }
 */
export function useProjectsQuery(): UseQueryResult<ProjectsResponse, ApiError> {
  return useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: apiGetProjects,
    retry: false,
  });
}
