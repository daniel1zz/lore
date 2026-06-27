/**
 * Dashboard entry point — mounts the React app with TanStack Router + Query providers.
 * Purpose: bootstraps the SPA for the Lore read-only dashboard.
 * Invariants:
 *   - bootstrapAuthIfNeeded() runs before React mounts (top-level await).
 *   - Bootstrap failure is non-fatal: shows a sonner toast but renders anyway.
 *   - Single DOM mount point (#root). Only pure reads; no write operations.
 * Side-effect class: IO (DOM mount, router initialization, optional fetch for auth bootstrap)
 * Source: SPEC-015 §3; SPEC-016 §3.8
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./lib/query-client";
import { ThemeProvider } from "./lib/theme";
import { Toaster } from "./components/ui/sonner";
import { bootstrapAuthIfNeeded } from "./lib/bootstrap";
import "./index.css";

// ─── Router ───────────────────────────────────────────────────────────────────

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// ─── Mount ────────────────────────────────────────────────────────────────────

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root not found in index.html");
}

// reason: SPEC-016 §3.8 — bootstrap auth BEFORE rendering so the cookie is set before
// the first API call. We use a promise chain instead of top-level await so the
// bundle stays compatible with Vite's default `es2020`-ish browser target. Failures
// are non-fatal: render the app anyway and queue a sonner toast for visibility.
bootstrapAuthIfNeeded()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`Auth bootstrap failed: ${message}. Restart with \`lore dashboard\`.`);
  })
  .finally(() => {
    createRoot(rootElement).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <Toaster />
            <RouterProvider router={router} />
          </ThemeProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  });
