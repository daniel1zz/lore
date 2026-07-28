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
 *       1. `GET /auth/bootstrap` — nonce lifecycle.
 *       2. Exact static asset match (manifest key === pathname).
 *       3. `GET` SPA fallback (any other non-`/api` path) — serves `/index.html`.
 *   - `handle()` returns `null` for anything it does not claim (wrong method, or a GET
 *     whose assets are unavailable) so the caller's pre-existing 404 behavior is
 *     byte-identical when dashboard serving is disabled (`HttpConfig.dashboard` omitted).
 *   - The nonce store is single-use (DD-2 "DoS: nonce store bounded" — one entry per
 *     `lore dashboard` launch in the common case). `createNonceStore`'s public return
 *     type (`NonceStore`) exposes ONLY `mint()` — `consume()` is an internal capability
 *     (`NonceStoreWithConsume`) never part of `DashboardServingConfig.nonces`'s declared
 *     type, so a caller-supplied store only has to promise minting; this module enforces
 *     at `createDashboardHandler` construction time (loud, once, never per request) that
 *     any injected store actually was built by `createNonceStore` (has `consume`) — see
 *     `resolveNonceStore`. This revision's `/auth/bootstrap` handler does NOT yet reject
 *     subresource/iframe navigations (DD-3's `Sec-Fetch-*` guard) — that guard lands in a
 *     follow-up commit — and does NOT yet guard `machineAuth()` throws with a named `503`
 *     (Failure Modes degradation guard, also a follow-up commit).
 *   - Cache-Control: manifest entries with `immutable: true` get a long-lived immutable
 *     directive; everything else (`/index.html`, the SPA fallback) gets `no-cache` — it
 *     carries no secret (DD-2), so freshness beats caching.
 *   - `routes.ts` (out of this task's write scope) has its OWN private
 *     `isSecureRequestContext`/cookie-string construction for `POST /api/auth/local-
 *     bootstrap` — this module intentionally duplicates that small piece of logic in
 *     `auth.ts::buildSessionCookieHeader` (an anchor file for this task) rather than
 *     editing `routes.ts`, so `GET /auth/bootstrap`'s `Set-Cookie` stays byte-attribute-
 *     identical to the existing bootstrap flow without touching a file outside scope.
 * Side-effect class: IO (reads embedded/on-disk asset bytes via `Bun.file`; mutates the
 *   in-memory nonce map).
 * Source: spec-dashboard-production-packaging-one-command-lore-dashboard DD-1 DD-2 DD-4;
 *   task-skill-implement-f5a-static-serving-nonce-endpoint-and.
 */

import { randomUUID } from "node:crypto";

import { buildSessionCookieHeader } from "./auth.js";
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

// ─── Nonce store (DD-2) ───────────────────────────────────────────────────────────────

/** Default nonce lifetime: 60 seconds — long enough for a browser to open the URL the
 * CLI just printed/launched, short enough that a leaked URL in shell history is stale
 * within a minute. */
const DEFAULT_NONCE_TTL_MS = 60_000;

/** Public capability a caller-supplied `DashboardServingConfig.nonces` must implement —
 * minting only. `consume()` is intentionally NOT part of this public surface; see this
 * module's header comment for why. */
export interface NonceStore {
  /** Mint a fresh, single-use, TTL-bounded token. */
  mint(): string;
}

/** Result of attempting to redeem a nonce — every non-`"granted"` outcome maps to the
 * SAME `410` response (DD-2: "the endpoint answers 410 for consumed/expired/unknown
 * nonces" — the caller never needs to distinguish which). */
type ConsumeNonceOutcome = "granted" | "unknown" | "expired" | "consumed";

/** Internal capability surface actually returned by {@link createNonceStore} — a
 * superset of the public {@link NonceStore}. Never exported: nothing outside this module
 * needs to name it, and `noEmit`/no-declaration-file typecheck config (tsconfig.base.json)
 * means an exported function may safely return an unexported type. */
interface NonceStoreWithConsume extends NonceStore {
  /** Atomically check-and-mark a token consumed. Single call, no separate peek — a
   * concurrent double-redemption of the same token can only grant once. */
  consume(token: string): ConsumeNonceOutcome;
}

interface NonceRecord {
  expiresAt: number;
  consumed: boolean;
}

/**
 * Build an in-memory, single-use, TTL-bounded nonce store (DD-2).
 *
 * @param opts.ttlMs - Token lifetime in milliseconds. Defaults to 60s (`DEFAULT_NONCE_TTL_MS`).
 * @returns A store whose `mint()` is the ONLY member visible through the public
 *   {@link NonceStore} type; this module's own request handling additionally uses the
 *   wider `consume()` capability on the concrete object it returns.
 * @example
 *   const nonces = createNonceStore();
 *   const token = nonces.mint(); // -> pass to `lore dashboard`'s opened URL
 */
export function createNonceStore(opts?: { ttlMs?: number }): NonceStoreWithConsume {
  const ttlMs = opts?.ttlMs ?? DEFAULT_NONCE_TTL_MS;
  const records = new Map<string, NonceRecord>();

  return {
    mint(): string {
      const token = randomUUID();
      records.set(token, { expiresAt: Date.now() + ttlMs, consumed: false });
      return token;
    },
    consume(token: string): ConsumeNonceOutcome {
      const record = records.get(token);
      if (record === undefined) return "unknown";
      if (record.consumed) return "consumed";
      if (Date.now() > record.expiresAt) return "expired";
      record.consumed = true;
      return "granted";
    },
  };
}

/** Narrow a caller-supplied `NonceStore` to the internal `consume`-capable shape. */
function isNonceStoreWithConsume(store: NonceStore): store is NonceStoreWithConsume {
  return typeof (store as Partial<NonceStoreWithConsume>).consume === "function";
}

/**
 * Resolve the nonce store this handler will use — the caller-supplied one (must have
 * been built by {@link createNonceStore}, checked once here) or a fresh default.
 * Called exactly once, at `createDashboardHandler` construction time (server startup),
 * never per-request — the resulting store's minted tokens must survive across requests.
 *
 * @throws Error if `config.nonces` is supplied but was not built by
 *   {@link createNonceStore} (missing the internal `consume` capability) — a
 *   misconfiguration caught loudly at startup rather than silently breaking every nonce
 *   redemption at request time.
 */
function resolveNonceStore(config: DashboardServingConfig): NonceStoreWithConsume {
  if (config.nonces === undefined) return createNonceStore();
  if (!isNonceStoreWithConsume(config.nonces)) {
    throw new Error(
      "DashboardServingConfig.nonces must be constructed via static-serving.ts's " +
        "createNonceStore() — a caller-supplied mint-only NonceStore lacks the consume() " +
        "capability this handler needs to redeem tokens.",
    );
  }
  return config.nonces;
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

/** api_keys.name the redeemed session is attributed to — the same "dashboard-local"
 * identity `POST /api/auth/local-bootstrap` (`routes.ts::handleLocalBootstrap`) uses. */
const BOOTSTRAP_SESSION_OWNER = "dashboard-local";

/** Human-readable reason text per {@link ConsumeNonceOutcome} failure branch (DD-2: the
 * 410 body must be actionable, naming the `lore dashboard` re-launch as the fix). */
function nonceFailureMessage(outcome: Exclude<ConsumeNonceOutcome, "granted">): string {
  switch (outcome) {
    case "unknown":
      return "Bootstrap nonce is unknown or already expired-and-evicted.";
    case "expired":
      return "Bootstrap nonce has expired.";
    case "consumed":
      return "Bootstrap nonce was already used.";
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/**
 * `GET /auth/bootstrap?nonce=<n>` — redeem a single-use nonce into a `lore_sid` session
 * cookie and 302-redirect to `/` (DD-2).
 */
async function handleNonceBootstrap(
  req: Request,
  url: URL,
  config: DashboardServingConfig,
  nonces: NonceStoreWithConsume,
): Promise<Response> {
  const token = url.searchParams.get("nonce");
  const outcome = token !== null ? nonces.consume(token) : "unknown";
  if (outcome !== "granted") {
    return jsonError(
      {
        code: "NONCE_INVALID",
        message: `${nonceFailureMessage(outcome)} Relaunch 'lore dashboard' for a fresh link.`,
      },
      410,
    );
  }

  // reason: machineAuth() resolution is NOT YET guarded here — a missing resolver or a
  // throw inside it currently propagates to Bun.serve's global error() handler (a
  // generic 500), and an omitted resolver throws a plain "not a function" TypeError via
  // this non-null assertion. The named-503 degradation guard (Failure Modes table) lands
  // in a follow-up commit.
  const stores = config.machineAuth!();
  const { session_id } = stores.sessionStore.create(BOOTSTRAP_SESSION_OWNER);
  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", buildSessionCookieHeader(req, session_id));
  return new Response(null, { status: 302, headers });
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
 * Build the per-server-instance dashboard request handler (DD-4 dispatch: bootstrap →
 * exact static match → GET SPA fallback). Call exactly once per `startHttpServer`
 * invocation (so the nonce store's mints survive across requests); the returned
 * `handle()` is then invoked per-request.
 *
 * @throws Error — see {@link resolveNonceStore} — if `config.nonces` is supplied but was
 *   not built by {@link createNonceStore}.
 */
export function createDashboardHandler(config: DashboardServingConfig): DashboardHandler {
  const nonces = resolveNonceStore(config);

  return {
    async handle(req: Request, url: URL): Promise<Response | null> {
      if (url.pathname === "/auth/bootstrap") {
        if (req.method !== "GET") return null;
        return handleNonceBootstrap(req, url, config, nonces);
      }

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
