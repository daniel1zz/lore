/**
 * SPEC-078 D5 — the dashboard's ONE seam for project-scoped HTTP addressing.
 * Purpose: every backend fetch call and every TanStack Query cache key in
 *   this package routes through this module, so a future project switch
 *   (`/p/:name`, mounted by T10) touches exactly this file's internals
 *   instead of every individual call site. Registry-less mode
 *   (`project === null`, the ONLY mode reachable until T10 mounts the
 *   router) is byte-identical to pre-SPEC-078 behavior: `apiFetch(null,
 *   "/docs")` resolves to `/api/docs`, exactly what the old direct
 *   `fetch("/api/docs")` call it replaces hit; `queryKeys.scope(null, key)`
 *   returns `key` verbatim, so the TanStack Query cache shape — and every
 *   existing `invalidateQueries`/`getQueryData` call keying off it — is
 *   unchanged.
 * Public surface: apiFetch, queryKeys, useProjectParam, projectPath,
 *   ProjectsResponse, ProjectsResponseEntry
 * Invariants:
 *   - `apiFetch`'s `resourcePath` argument is the portion of the URL AFTER
 *     "/api" (e.g. "/docs", "/dashboard/docs/123/approve") and must NEVER
 *     itself contain an "/api" segment — this module is the ONLY place in
 *     `packages/dashboard/src` allowed to write the literal "/api" path
 *     segment. Every other module that used to call `fetch("/api/...")`
 *     directly now calls `apiFetch(project, "/...")` instead (the "/api"
 *     prefix moved here, not just the project-prefixing logic — this is
 *     what makes the raw-literal ESLint rule, `eslint.config.js`'s
 *     `dashboard-local/no-raw-api-literal`, enforceable with a single
 *     file-scoped exemption rather than a per-call-site allowlist).
 *   - `apiFetch` returns the raw `Response` (mirrors the native `fetch`
 *     contract) rather than a parsed/unwrapped envelope — `lib/api.ts`'s
 *     `fetchJson` and `api/mutations.ts`'s `writeFetch`/`writeConfigFetch`
 *     have DIFFERENT envelope-parsing and error-class contracts
 *     (`ApiError` vs `DashboardApiError`/`ConflictError`/
 *     `ConfigConflictError`); unifying those into one throw-shape here
 *     would fork every consumer's catch-site behavior. This module owns
 *     ONLY the request-routing concern (D5 "one seam"), never response
 *     interpretation.
 *   - `project === null` is the current, and ONLY reachable, calling
 *     convention across this codebase today — no call site has a non-null
 *     project to pass until T10 mounts the `/p/:name` route and wires a
 *     project-selection context through to callers. Every internal
 *     `fetchJson`/`writeFetch`/etc. call site hardcodes `null` for now;
 *     re-threading a real selected project through those call sites is
 *     T10's job (and whatever component-level project context it
 *     introduces), not this module's.
 * Side-effect class: pure (`queryKeys`, `useProjectParam`'s path parsing) /
 *   IO (`apiFetch` — network)
 * Source: SPEC-078 D5, D7 (mirrored response types)
 */

import { useRouterState } from "@tanstack/react-router";
import type { MountState } from "@lore/core";

// ─── Path construction (the ONLY "/api" literal in this package) ────────────

/**
 * Builds the full backend request path for one HTTP call.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param resourcePath - The path AFTER "/api" — MUST start with "/" and MUST
 *   NOT itself contain an "/api" segment.
 * @returns `/api${resourcePath}` when `project` is `null` (today's shape,
 *   byte-identical); `/api/p/${project}/api${resourcePath}` otherwise — the
 *   D4 path-rewrite shim strips the `/api/p/:name` prefix server-side and
 *   delegates to the SAME existing route tables, so the suffix after the
 *   prefix is deliberately the unchanged `/api/...` shape, not a replacement.
 */
function buildApiPath(project: string | null, resourcePath: string): string {
  const apiPath = `/api${resourcePath}`;
  return project === null ? apiPath : `/api/p/${encodeURIComponent(project)}${apiPath}`;
}

/**
 * Project-scoped `fetch` — the ONE function every backend request in this
 * package must go through (enforced by `dashboard-local/no-raw-api-literal`,
 * `eslint.config.js`). Returns the raw `Response`; callers keep their own
 * envelope-parsing/error-throwing contract exactly as before this refactor
 * (see the module invariant above).
 *
 * @param project - Registry project name, or `null` for registry-less mode
 *   (the only value any current call site passes).
 * @param resourcePath - Path fragment after "/api" (e.g. "/docs", not
 *   "/api/docs" — see {@link buildApiPath}).
 * @param init - Forwarded verbatim to the underlying `fetch` call.
 * @example
 * apiFetch(null, "/docs") // → fetch("/api/docs")
 * apiFetch("acme", "/docs") // → fetch("/api/p/acme/api/docs")
 */
export async function apiFetch(
  project: string | null,
  resourcePath: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(buildApiPath(project, resourcePath), init);
}

// ─── TanStack Query key scoping ──────────────────────────────────────────────

/**
 * `queryKeys` — the single project-scoping seam for every TanStack Query
 * `queryKey` array in this package (mirrors {@link apiFetch}'s role for
 * fetch paths).
 */
export const queryKeys = {
  /**
   * Prefixes `key` with a project-scope segment when `project` is non-null;
   * returns `key` UNCHANGED (same array contents, same reference-equality-
   * irrelevant shape) when `project` is `null` — today's cache-key shape,
   * byte-stable, so every existing `invalidateQueries`/`getQueryData` call
   * site keying off one of these arrays continues to match after migrating
   * to this call.
   *
   * @param project - Registry project name, or `null` for registry-less mode.
   * @param key - The query key this call site used to pass as a bare array.
   * @example
   * queryKeys.scope(null, ["doc", id]) // => ["doc", id] (unchanged)
   * queryKeys.scope("acme", ["doc", id]) // => ["project:acme", "doc", id]
   */
  scope(project: string | null, key: readonly unknown[]): readonly unknown[] {
    return project === null ? key : [`project:${project}`, ...key];
  },
};

// ─── /p/:name route param ────────────────────────────────────────────────────

/**
 * Matches a `/p/:name` (or `/p/:name/...`) pathname prefix — the route
 * convention T10 mounts for the project switcher. `:name` is captured
 * url-encoded (decoded below).
 */
const PROJECT_PARAM_PATTERN = /^\/p\/([^/]+)(?:\/|$)/;

/**
 * Reads the current `/p/:name` route-param segment, or `null` when the
 * current route is not project-scoped (registry-less mode, or any route
 * outside the `/p/:name/*` prefix — the ONLY case reachable today, since
 * that route doesn't exist in the router tree until T10 mounts it).
 *
 * Implemented via pathname pattern matching against
 * `useRouterState`'s `location.pathname` (the same primitive
 * `use-route-telemetry.ts::useRouteTelemetry` already uses for pathname
 * reads) rather than TanStack Router's typed `useParams` — a typed
 * `useParams` call requires the target route to already exist in the
 * generated route tree, which would make this hook fail to compile before
 * T10 mounts `/p/:name`. Once that route exists, this hook's behavior is
 * unchanged (it never depended on the route being registered) — it simply
 * starts returning non-null values for URLs under that prefix.
 *
 * @returns The url-decoded project name segment, or `null`.
 * @example
 * // pathname "/p/acme/library" → "acme"
 * // pathname "/library"        → null
 */
export function useProjectParam(): string | null {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const match = PROJECT_PARAM_PATTERN.exec(pathname);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : null;
}

/**
 * Builds a project-scoped PAGE route path — the browser-navigation mirror of
 * {@link buildApiPath} (that function prefixes backend `/api/...` requests;
 * this one prefixes the `Link`/`navigate` targets the user actually clicks).
 * Purpose: fixes the defect where `__root.tsx`'s nav (logo/Home/Library/Tree/
 * Execution/Settings/Issues) and the search-box submit hardcoded unprefixed
 * paths (`/library`, `/search`, …) — every click under a `/p/:name` context
 * silently dropped the user back into the default (registry-less) project.
 * Every nav/header link and the search-box navigation MUST route its target
 * through this function rather than hardcoding a route string, so the
 * prefixing logic has exactly one home (mirrors {@link apiFetch}'s D5
 * "one seam" role for backend addressing).
 *
 * @param project - Registry project name (from {@link useProjectParam}), or
 *   `null` for registry-less mode / no active `/p/:name` context.
 * @param routePath - The unprefixed route path, e.g. "/library" or "/" for
 *   home — MUST start with "/".
 * @returns `routePath` unchanged when `project` is `null` (today's shape,
 *   byte-identical — regression guard). Otherwise `/p/${project}` plus
 *   `routePath` (home's `"/"` collapses to bare `/p/${project}`, never a
 *   trailing slash, matching the `/p/$name` index route's own path).
 * @example
 * projectPath(null, "/library")   // => "/library"
 * projectPath("acme", "/library") // => "/p/acme/library"
 * projectPath("acme", "/")        // => "/p/acme"
 */
export function projectPath(project: string | null, routePath: string): string {
  if (project === null) return routePath;
  const prefix = `/p/${encodeURIComponent(project)}`;
  return routePath === "/" ? prefix : `${prefix}${routePath}`;
}

// ─── D7 mirrored types (GET /api/projects) ───────────────────────────────────

/**
 * One `GET /api/projects` entry — the switcher's per-project badge data.
 * Mirrors `ProjectsResponseEntry` (`packages/lore/src/mount/types.ts`)
 * field-for-field. Hand-copied, NOT imported, because `@lore/dashboard` must
 * never depend on `@lore/lore` (module boundary, `packages/dashboard/
 * CLAUDE.md`) — same reason `lib/api.ts`'s `AnchorConflict`/
 * `ReadyReportResponse` types are hand-copied rather than imported.
 * `MountState` itself IS re-exported from the browser-safe `@lore/core`
 * barrel (`packages/core/src/config.ts`), so it is imported directly rather
 * than also hand-copied.
 */
export interface ProjectsResponseEntry {
  /** Registry name (switcher label / `/p/:name` segment). */
  name: string;
  /** Classification state (SPEC-078 D7). */
  state: MountState;
  /** Human-readable reason, present whenever `state !== "mounted"`. */
  diagnosis?: string;
}

/**
 * `GET /api/projects` response shape (SPEC-078 D7). Mirrors `ProjectsResponse`
 * (`packages/lore/src/mount/types.ts`) field-for-field — same hand-copy
 * boundary reason as {@link ProjectsResponseEntry}. Ships alongside the
 * per-entry classification the serving INSTANCE identity (the "two
 * instances, one corpus" debug surface); consumed by the (separate) project
 * switcher UI component, not by this module.
 */
export interface ProjectsResponse {
  /** One entry per registered project (declaration order). */
  projects: ProjectsResponseEntry[];
  /** The serving instance's identity. */
  instance: {
    /** TCP port this dashboard process is listening on. */
    port: number;
    /** Identity label for this process's loaded registry. */
    registry_name: string;
  };
}
