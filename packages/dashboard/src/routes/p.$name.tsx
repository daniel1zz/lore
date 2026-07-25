/**
 * Project-scoped layout route (SPEC-078 T10 deliverable 1) — `/p/:name/*`.
 * Purpose: mounts every existing route under a project context. TanStack
 *   Router's file-based flat-routing convention makes this file (having the
 *   SAME `p.$name` prefix as its children below) the pathless LAYOUT for
 *   `/p/:name/*` — it renders nothing but `<Outlet/>`; the actual page
 *   bodies are the SAME reusable components the top-level routes render
 *   (`HomeBody`, `LibraryPage`, `TreePage`, `SettingsPage`, `DocPageBody`),
 *   each of which already reads `useProjectParam()` (`lib/project-api.ts`)
 *   to resolve the LIVE `:name` segment — this layout file itself never
 *   reads or threads the param anywhere; it exists purely so the nested
 *   file paths below resolve under the `/p/:name` prefix.
 * Invariants:
 *   - Registry-less mode is entirely unaffected — this prefix is simply an
 *     additional, independent branch of the route tree; no top-level route
 *     file's path or behavior changes (R-15).
 *   - `:name` is NOT validated against the real registry here (no fetch) —
 *     an unregistered/missing project name still mounts this layout and its
 *     children; the server-side path shim (D4) is the actual authority that
 *     404s an unregistered project's API calls. A future task MAY add a
 *     client-side "unknown project" banner; out of scope for T10.
 * Source: SPEC-078 D5, T10 dispatch deliverable 1
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/p/$name")({
  component: ProjectLayout,
});

function ProjectLayout(): React.ReactElement {
  return <Outlet />;
}
