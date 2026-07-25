/**
 * SPA auth bootstrap helper for the local dashboard dev environment.
 * Purpose: exchange the dev-only window.__LORE_BOOTSTRAP_TOKEN__ for an HttpOnly
 *   session cookie on first load. Subsequent requests use the cookie transparently.
 * Public surface: bootstrapAuthIfNeeded()
 * Invariants:
 *   - No-ops when window.__LORE_BOOTSTRAP_TOKEN__ is absent (prod builds, direct API use).
 *   - The global is deleted in a finally block regardless of whether POST succeeds.
 *   - On POST failure, throws so the caller (main.tsx) can show a toast + render anyway.
 *   - credentials: "include" is set so the server's Set-Cookie response is accepted.
 * Side-effect class: IO (fetch POST to /api/auth/local-bootstrap)
 * Source: SPEC-016 §3.8; SPEC-078 D5 (routes through `project-api.ts`'s
 *   `apiFetch`, project always `null` — bootstrap precedes any project
 *   selection)
 */

import { apiFetch } from "./project-api";

// ─── Window augmentation (dev-only global, never in built artefacts) ──────────

/** Augmented window shape for the dev-only bootstrap token. */
interface BootstrapWindow {
  __LORE_BOOTSTRAP_TOKEN__?: string;
}

// ─── bootstrapAuthIfNeeded ────────────────────────────────────────────────────

/**
 * Exchange the dev-injected bootstrap token for an HttpOnly session cookie.
 * Call this once before mounting React (top-level await in main.tsx).
 *
 * Behaviour:
 *   - If `window.__LORE_BOOTSTRAP_TOKEN__` is absent → returns immediately (no-op).
 *   - If present → POST /api/auth/local-bootstrap with X-Lore-Token header.
 *   - Deletes the global in `finally` regardless of outcome (prevent token re-use).
 *   - Throws if the server responds with a non-OK status.
 *
 * @throws Error with HTTP status if bootstrap POST fails.
 * @example
 *   // In main.tsx (top-level await):
 *   await bootstrapAuthIfNeeded().catch((err) => toast.error(String(err)));
 *   createRoot(element).render(<App />);
 */
export async function bootstrapAuthIfNeeded(): Promise<void> {
  const w = window as unknown as BootstrapWindow;
  const token = w.__LORE_BOOTSTRAP_TOKEN__;

  // AC-A-S1: no-op when token is absent (prod builds, direct server access).
  if (!token) return;

  try {
    const res = await apiFetch(null, "/auth/local-bootstrap", {
      method: "POST",
      headers: { "X-Lore-Token": token },
      // reason: credentials: "include" is required so the browser accepts the Set-Cookie
      // response from the server via the Vite proxy. Without it, the cookie is silently
      // discarded. SPEC-016 §3.8.
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error(`bootstrap failed: ${res.status}`);
    }
  } finally {
    // AC-A-S2: always delete the global — even on failure — to prevent token re-use.
    delete w.__LORE_BOOTSTRAP_TOKEN__;
  }
}
