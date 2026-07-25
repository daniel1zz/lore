/**
 * Project-scoped Home route — `/p/:name/`.
 * Purpose: renders the SAME resolved-PRD body as the top-level `/` route
 *   (`HomeBody`, `routes/index.tsx`) — no redirect wrapper here, since a URL
 *   already carrying a `:name` segment is already resolved (the redirect only
 *   fires from the bare `/`, see `use-project-redirect.ts`).
 * Source: SPEC-078 T10 dispatch deliverable 1
 */

import { createFileRoute } from "@tanstack/react-router";
import { HomeBody } from "@/routes/index";

export const Route = createFileRoute("/p/$name/")({
  component: HomeBody,
});
