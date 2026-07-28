/**
 * Packaged-mode dashboard serving: static asset dispatch + SPA fallback + the one-time
 * nonce redirect auth flow (spec-dashboard-production-packaging-one-command-lore-dashboard
 * DD-1..DD-4).
 *
 * Public surface: `createNonceStore`, `NonceStore`, `createDashboardHandler`,
 *   `DashboardHandler`, `DashboardServingConfig`, `DashboardAssetsResult`,
 *   `DashboardAssetsManifest`, `DashboardAssetsManifestEntry`.
 *
 * Invariants:
 *   - Dispatch order (DD-4), enforced by `DashboardHandler.handle`'s caller (`index.ts`,
 *     invoked only for paths that already fell through the untouched `/api/*` branch):
 *       1. `GET /auth/bootstrap` — nonce lifecycle (added in a follow-up commit; this
 *          revision does not yet claim the path, so it falls through to exact-static/SPA
 *          handling like any other route — harmless until manifest entries ever include
 *          it, which they never do).
 *       2. Exact static asset match (manifest key === pathname).
 *       3. `GET` SPA fallback (any other non-`/api` path) — serves `/index.html`.
 *   - `handle()` returns `null` for anything it does not claim (wrong method, or a GET
 *     whose assets are unavailable) so the caller's pre-existing 404 behavior is
 *     byte-identical when dashboard serving is disabled (`HttpConfig.dashboard` omitted).
 *   - Cache-Control: manifest entries with `immutable: true` get a long-lived immutable
 *     directive; everything else (`/index.html`, the SPA fallback) gets `no-cache` — it
 *     carries no secret (DD-2), so freshness beats caching.
 * Side-effect class: IO (reads embedded/on-disk asset bytes via `Bun.file`).
 * Source: spec-dashboard-production-packaging-one-command-lore-dashboard DD-1 DD-4;
 *   task-skill-implement-f5a-static-serving-nonce-endpoint-and.
 */

import { jsonError } from "./middleware.js";
import type { MachineAuthStores } from "./machine-auth.js";

// ─── Manifest / assets contract (mirrors the DD-1 embedded-manifest shape) ───────────

/** One served dashboard asset entry (DD-1 manifest `entries` value shape). */
export interface DashboardAssetsManifestEntry {
  /** Filesystem path (or embedded-file handle) `Bun.file` can open to read the bytes. */
  embedded: string;
  /** `Content-Type` response header value. */
  contentType: string;
  /** `true` for hashed, content-addressed filenames (long-lived `immutable` caching);
   * `false` for `/index.html` (no-cache — it carries no secret, so freshness wins). */
  immutable: boolean;
}

/** The DD-1 embedded-assets manifest: a build stamp plus every servable urlPath. */
export interface DashboardAssetsManifest {
  stamp: { digest: string; builtAt: string };
  /** Keyed by urlPath, e.g. `"/index.html"`, `"/assets/app-abc123.js"`. */
  entries: Record<string, DashboardAssetsManifestEntry>;
}

/**
 * Outcome of resolving the dashboard assets manifest — `available: false` names WHY
 * (DD-1 Failure Modes: "Source-run packaged mode without built assets" never silently
 * falls back to serving nothing without explanation).
 */
export type DashboardAssetsResult =
  | { available: true; manifest: DashboardAssetsManifest }
  | { available: false; reason: string };

// ─── Nonce store surface (implementation lands in a follow-up commit) ─────────────────

/** Public capability a caller-supplied `DashboardServingConfig.nonces` must implement —
 * minting only. `consume()` (added alongside `createNonceStore`'s implementation) is
 * intentionally NOT part of this public surface — see that commit's module-header note. */
export interface NonceStore {
  /** Mint a fresh, single-use, TTL-bounded token. */
  mint(): string;
}

// ─── Dashboard serving config + handler ────────────────────────────────────────────────

/** Configuration threaded from `HttpConfig.dashboard` (`index.ts`) into this module. */
export interface DashboardServingConfig {
  /** Resolve the embedded/on-disk assets manifest. Called on every non-bootstrap request
   * this handler claims — cheap in production (the real loader memoizes), and lets tests
   * inject a fixture without touching the committed DD-1 loader. */
  assets: () => Promise<DashboardAssetsResult>;
  /** Caller-supplied nonce store; omitted → this module constructs its own default. */
  nonces?: NonceStore;
  /** Lazy resolver for the machine-scope auth stores, used ONLY to redeem a nonce into a
   * session (DD-2) — NEVER invoked for plain static/SPA-fallback serving. */
  machineAuth?: () => MachineAuthStores;
}

/** Returned by {@link createDashboardHandler} — the single per-server-instance entry
 * point `index.ts`'s `fetch` closure calls for every non-`/api` request. */
export interface DashboardHandler {
  /**
   * Dispatch one request per DD-4's ordering.
   *
   * @returns `null` when this module claims nothing for the request (wrong method, or a
   *   GET whose assets are unavailable) — the caller must fall through to its own
   *   pre-existing 404, keeping non-dashboard-configured behavior byte-identical.
   */
  handle(req: Request, url: URL): Promise<Response | null>;
}

/**
 * Serve one embedded/on-disk manifest entry's bytes.
 */
async function serveManifestEntry(entry: DashboardAssetsManifestEntry): Promise<Response> {
  const file = Bun.file(entry.embedded);
  const cacheControl = entry.immutable ? "public, max-age=31536000, immutable" : "no-cache";
  return new Response(file, {
    status: 200,
    headers: {
      "Content-Type": entry.contentType,
      "Cache-Control": cacheControl,
    },
  });
}

/**
 * Build the per-server-instance dashboard request handler (DD-4 dispatch: exact static
 * match → GET SPA fallback; `/auth/bootstrap` lands in a follow-up commit). Call exactly
 * once per `startHttpServer` invocation; the returned `handle()` is then invoked
 * per-request.
 */
export function createDashboardHandler(config: DashboardServingConfig): DashboardHandler {
  return {
    async handle(req: Request, url: URL): Promise<Response | null> {
      if (req.method !== "GET") return null;

      const assetsResult = await config.assets();
      if (!assetsResult.available) return null;

      const { manifest } = assetsResult;
      const exact = manifest.entries[url.pathname];
      if (exact !== undefined) return serveManifestEntry(exact);

      const indexEntry = manifest.entries["/index.html"];
      if (indexEntry === undefined) {
        return jsonError(
          { code: "INTERNAL_ERROR", message: "Dashboard manifest has no /index.html entry for SPA fallback." },
          500,
        );
      }
      return serveManifestEntry(indexEntry);
    },
  };
}
