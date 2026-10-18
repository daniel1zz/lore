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
 *     `resolveNonceStore`. `/auth/bootstrap` rejects subresource/iframe navigations
 *     (DD-3's `Sec-Fetch-Dest`/`Sec-Fetch-Mode` guard — see `isRejectedNavigation`) BEFORE
 *     ever touching the nonce store, so a rejected embed attempt never burns a legitimate
 *     token.
 *   - `machineAuth` (DD-2) is invoked LAZILY and ONLY inside the `/auth/bootstrap` branch,
 *     guarded by try/catch — a throw (or an omitted resolver) degrades that ONE route to a
 *     named `503`, never a blanket `500`, and NEVER blocks static serving (Failure Modes
 *     table: "Machine-auth store unavailable"). A missing/unreadable embedded asset
 *     (Failure Modes table: "Embedded asset read failure") answers a named `500` for THAT
 *     asset only, likewise never an uncaught throw.
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

import { discardWarnings, type WarnSink } from "../../service/warn-sink.js";
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

/** The DD-1 embedded-assets manifest: a build stamp plus every servable urlPath.
 * `stamp.skipped` mirrors `dashboard-assets-loader.ts`'s identically-optional field
 * (`scripts/build.ts`'s `--skip-dashboard` emergency escape hatch, DD-1 build-tax
 * control) — carried here, rather than dropped, so `index.ts`'s `GET /api/health`
 * handler can surface it (Observability section: "`skipped: true` when `--skip-
 * dashboard` was used — loud"). */
export interface DashboardAssetsManifest {
  stamp: { digest: string; builtAt: string; skipped?: boolean };
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
 * SAME `410` + `text/html` human-readable failure page (DD-2/AC-F5A-10: "the endpoint
 * answers 410 for consumed/expired/unknown nonces" — the caller never needs to distinguish
 * which; see {@link renderNonceFailurePage}). */
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
  /** Where a missing embedded asset is reported (the run's stderr); absent -> not printed. */
  warn?: WarnSink;
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
 * Reject anything that is not a top-level browser navigation (DD-3: the nonce endpoint's
 * own guard, since it is deliberately EXEMPT from Origin checking — Origin is a POST-CSRF
 * concept and this is a GET navigation). A `Sec-Fetch-Dest` other than `"document"`, or a
 * `Sec-Fetch-Mode` other than `"navigate"`, signals a subresource/iframe/fetch-initiated
 * request — reject it. Both headers are OPTIONAL (older browsers / non-browser callers
 * send neither) — absence never rejects, only a present-and-wrong value does.
 */
function isRejectedNavigation(req: Request): boolean {
  const dest = req.headers.get("Sec-Fetch-Dest");
  if (dest !== null && dest !== "document") return true;
  const mode = req.headers.get("Sec-Fetch-Mode");
  if (mode !== null && mode !== "navigate") return true;
  return false;
}

/** api_keys.name the redeemed session is attributed to — the same "dashboard-local"
 * identity `POST /api/auth/local-bootstrap` (`routes.ts::handleLocalBootstrap`) uses. */
const BOOTSTRAP_SESSION_OWNER = "dashboard-local";

/** Human-readable reason sentence per {@link ConsumeNonceOutcome} failure branch — the ONE
 * part of {@link renderNonceFailurePage}'s output that varies per outcome (DD-2/AC-F5A-10:
 * the page itself, and its `410`/`text/html` shape, are identical across all three; only
 * this one sentence differs). */
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
 * Render the self-contained HTML page served for every non-`"granted"` nonce outcome
 * (consumed/expired/unknown — AC-F5A-10/DD-2 collapse all three into ONE response shape:
 * this same page structure, always `410`, always `Content-Type: text/html`; only the
 * embedded {@link nonceFailureMessage} sentence differs). States the launch link is dead
 * and names re-running `lore dashboard` as the fix (spec Failure Modes table).
 *
 * The `GET /api/auth/me` probe is CLIENT-SIDE (inline `<script>`), never server-side, by
 * necessity, not convenience: `lore_sid` is scoped `Path=/api` (`auth.ts:187`, a deliberate
 * minimal-exposure choice — `routes.ts:122`), so this `/auth/bootstrap` route NEVER
 * receives the cookie on the request that renders this page. Probing from inside the
 * loaded page — after the browser itself attaches the cookie to the follow-up fetch — is
 * the only way to detect an already-authenticated browser and forward it to `/` instead of
 * stranding it here. Widening the cookie's path to `/` was considered and rejected at
 * planning time (spec security-narrative amendment + ADR); do not "simplify" this probe
 * into a server-side cookie read.
 *
 * Served from a strict local origin (packaged `lore dashboard` only) — kept dependency-free
 * on purpose: no external `fetch`/CDN/script src, only this one same-origin probe.
 *
 * @param reasonMessage - the outcome-specific sentence from {@link nonceFailureMessage}.
 * @returns a complete `<!doctype html>` document as a string (never JSON-parseable, never
 *   contains `"ok":false` — {@link handleNonceBootstrap}'s tests assert both, to catch a
 *   future regression that quietly reintroduces the JSON envelope under an HTML label).
 */
function renderNonceFailurePage(reasonMessage: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>lore dashboard — link no longer valid</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1.5rem; color: #1a1a1a; line-height: 1.5; }
  code { background: #eee; padding: 0.1rem 0.35rem; border-radius: 0.25rem; font-size: 0.95em; }
</style>
</head>
<body>
<h1>This dashboard link is no longer valid</h1>
<p>${reasonMessage}</p>
<p>Run <code>lore dashboard</code> again to open a fresh link.</p>
<script>
  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (res) { if (res.ok) { window.location.replace("/"); } })
    .catch(function () {});
</script>
</body>
</html>
`;
}

/**
 * Validate the sign-in `next` redirect target at the boundary (AC-HR-7).
 *
 * Accepts only a same-origin absolute PATH: exactly one leading `/`, no `//`, no backslash,
 * no control characters, no scheme — checked on the raw value AND on its fully percent-decoded
 * form (so `%2F%2Fevil` / `%5C` variants cannot smuggle an authority past the browser).
 * Anything else (including absent) yields `/`, the pre-existing landing page.
 *
 * @param next - raw (already query-decoded) `next` query value, or null when absent.
 * @returns a path safe to use as a `Location` header value.
 */
export function resolveSameOriginNext(next: string | null): string {
  if (next === null) return "/";
  const candidates = [next];
  try {
    candidates.push(decodeURIComponent(next));
  } catch {
    // reason: malformed percent-encoding is an invalid target, not a crash; fall back to "/".
    return "/";
  }
  for (const candidate of candidates) {
    // reason: reject `//host` (protocol-relative), `/\host` (browsers treat `\` as `/`) and
    // control chars (header smuggling). See spec-human-review-surface D6.
    if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
    if (candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate)) return "/";
  }
  return next;
}

/**
 * `GET /auth/bootstrap?nonce=<n>[&next=<path>]` — redeem a single-use nonce into a `lore_sid`
 * session cookie and 302-redirect to `/` (DD-2), or to the same-origin path in `next` when it
 * passes {@link resolveSameOriginNext} (spec-human-review-surface D6 / AC-HR-7, changes BR-862).
 */
async function handleNonceBootstrap(
  req: Request,
  url: URL,
  config: DashboardServingConfig,
  nonces: NonceStoreWithConsume,
): Promise<Response> {
  if (isRejectedNavigation(req)) {
    return jsonError(
      {
        code: "FORBIDDEN",
        message: "Bootstrap nonce redemption must be a top-level navigation, not a subresource/iframe request.",
      },
      403,
    );
  }

  const token = url.searchParams.get("nonce");
  const outcome = token !== null ? nonces.consume(token) : "unknown";
  if (outcome !== "granted") {
    // AC-F5A-10 / spec Failure Modes table: "Nonce consumed/expired/unknown -> 410 +
    // human-readable page naming `lore dashboard` re-launch" — a bare JSON envelope here
    // (the pre-fix behavior) puts raw `{"ok":false,...}` in the user's viewport when a
    // launch link is replayed. See `renderNonceFailurePage`'s own doc comment for why the
    // authenticated-forward probe below is client-side, not server-side.
    return new Response(renderNonceFailurePage(nonceFailureMessage(outcome)), {
      status: 410,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Failure Modes table: "Machine-auth store unavailable" — guarded HERE, lazily, per
  // request, ONLY on this nonce-redemption path (never for plain static serving above).
  // An omitted resolver is equivalent to a throwing one: both degrade to a named 503,
  // never a blanket 500.
  let stores: MachineAuthStores;
  try {
    if (config.machineAuth === undefined) {
      throw new Error("No machine-auth resolver configured for this server instance.");
    }
    stores = config.machineAuth();
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return jsonError(
      {
        code: "MACHINE_AUTH_UNAVAILABLE",
        message: `Dashboard session store unavailable: ${cause}. Resolve the underlying storage issue, then re-run 'lore dashboard'.`,
      },
      503,
    );
  }

  const { session_id } = stores.sessionStore.create(BOOTSTRAP_SESSION_OWNER);
  const headers = new Headers({ Location: resolveSameOriginNext(url.searchParams.get("next")) });
  headers.append("Set-Cookie", buildSessionCookieHeader(req, session_id));
  return new Response(null, { status: 302, headers });
}

/**
 * Serve one embedded/on-disk manifest entry's bytes.
 * Guards the Failure Modes table's "Embedded asset read failure" row: a missing file at
 * the recorded path answers a named `500` for THIS asset only, never an uncaught throw
 * that would fall through Bun.serve's generic error() handler for every other request.
 */
async function serveManifestEntry(entry: DashboardAssetsManifestEntry, warn: WarnSink): Promise<Response> {
  const file = Bun.file(entry.embedded);
  const exists = await file.exists();
  if (!exists) {
    warn(`[dashboard] embedded asset missing at "${entry.embedded}"`);
    return jsonError(
      { code: "INTERNAL_ERROR", message: `Dashboard asset unavailable: ${entry.embedded}` },
      500,
    );
  }

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
  const warn = config.warn ?? discardWarnings;

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
      if (exact !== undefined) return serveManifestEntry(exact, warn);

      const indexEntry = manifest.entries["/index.html"];
      if (indexEntry === undefined) {
        return jsonError(
          { code: "INTERNAL_ERROR", message: "Dashboard manifest has no /index.html entry for SPA fallback." },
          500,
        );
      }
      return serveManifestEntry(indexEntry, warn);
    },
  };
}
