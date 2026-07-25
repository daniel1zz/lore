/**
 * Project-scoped Settings route — `/p/:name/settings`.
 * Purpose: renders the SAME `SettingsPage` the top-level `/settings` route
 *   renders — no route-binding hazard (no `Route.useSearch()`/`useParams()`
 *   of its own), reused directly with no thin-wrapper split.
 * Source: SPEC-078 T10 dispatch deliverable 1
 */

import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/routes/settings";

export const Route = createFileRoute("/p/$name/settings")({
  component: SettingsPage,
});
