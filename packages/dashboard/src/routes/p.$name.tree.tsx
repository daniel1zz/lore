/**
 * Project-scoped Tree route — `/p/:name/tree`.
 * Purpose: renders the SAME `TreePage` the top-level `/tree` route renders —
 *   no route-binding hazard (`TreePage` has no `Route.useSearch()`/`useParams()`
 *   of its own, see `routes/tree.tsx`'s module doc comment), so it is reused
 *   directly with no thin-wrapper split.
 * Source: SPEC-078 T10 dispatch deliverable 1
 */

import { createFileRoute } from "@tanstack/react-router";
import { TreePage } from "@/routes/tree";

export const Route = createFileRoute("/p/$name/tree")({
  component: TreePage,
});
