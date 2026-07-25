/**
 * Execution route — SPEC-077 S1 `/execution` page: plan selector + the four
 * read-only execution panels (PRD §21 F3).
 * Path: /execution?plan=<idOrSlug>
 * Purpose: thin router-aware wrapper around `ExecutionPage`, the same
 *   pattern as `docs.$id.tsx` wrapping `DocDetail` — this file owns ONLY the
 *   `?plan` search-param <-> callback wiring; all data fetching and rendering
 *   lives in `ExecutionPage`. Route telemetry (`route_id: "/execution"`) is
 *   automatic via `__root.tsx`'s `useRouteTelemetry`, mounted once at the
 *   root layout — no telemetry code needed here (AC-077-6).
 * SPEC-078 T13: `executionSearchSchema` exported for reuse by
 *   `routes/p.$name.execution.tsx`'s own `validateSearch` — that mirror route
 *   owns its own `Route.useSearch()`/`useNavigate({from: "/p/$name/execution"})`
 *   bindings and passes `project={name}` into `ExecutionPage` (which already
 *   accepts an explicit `project` prop, unlike `useProjectParam()`-driven
 *   bodies such as `SearchPageBody`).
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ExecutionPage } from "@/components/ExecutionPage";

/** Exported for reuse by `routes/p.$name.execution.tsx`'s own `validateSearch`. */
export const executionSearchSchema = z.object({
  plan: z.string().optional(),
});

export const Route = createFileRoute("/execution")({
  validateSearch: (search) => executionSearchSchema.parse(search),
  component: ExecutionRoute,
});

function ExecutionRoute(): React.ReactElement {
  const navigate = useNavigate({ from: "/execution" });
  const { plan } = Route.useSearch();

  function handlePlanChange(planId: string): void {
    void navigate({ search: (prev) => ({ ...prev, plan: planId }) });
  }

  function handleNavigateToDoc(docId: string): void {
    void navigate({ to: "/docs/$id", params: { id: docId } });
  }

  // reason: exactOptionalPropertyTypes forbids passing `undefined` for an
  // optional prop explicitly — conditional spread omits the key entirely
  // when the search param is absent (mirrors library.tsx's identical pattern).
  return (
    <ExecutionPage
      {...(plan !== undefined ? { planParam: plan } : {})}
      onPlanChange={handlePlanChange}
      onNavigateToDoc={handleNavigateToDoc}
    />
  );
}
