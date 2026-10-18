/**
 * F5a static serving + nonce auth — RED scenarios (TDD red phase).
 *
 * Why this exists: DD-1..DD-4 (spec-dashboard-production-packaging-one-command-lore-dashboard)
 * add packaged-mode static asset serving, SPA fallback, and a one-time nonce redirect
 * auth flow to `startHttpServer` (`packages/lore/src/adapters/http/index.ts`). None of
 * that exists yet — this file is the RED half of a paired red/green split: T (paired-impl
 * "static serving + nonce + allowlist") implements the module + config wiring below to
 * turn these tests green. Until then every scenario fails either at:
 *   (a) dynamic-import resolution ("Cannot find module .../static-serving.js"), or
 *   (b) a real assertion mismatch (today's server has no route for `/`, `/library`,
 *       `/p/:name/*`, hashed asset paths, or `/auth/bootstrap` — every one of them falls
 *       through to the existing catch-all `404 NOT_FOUND` JSON response).
 * Both are "missing implementation", never a test bug (task AC).
 *
 * Fixture-only, never a real vite build: `dashboard.assets` is a plain async function
 * returning an in-memory-shaped manifest whose `embedded` fields point at small files
 * this suite writes itself under an `mkdtemp` fixture dir. The paired impl's PRODUCTION
 * loader (`dashboard-assets-loader.ts`, a sibling RED/impl pair) is never touched here —
 * this is the injectable seam DD-1 describes for the runtime serving path, not the build
 * step.
 *
 * ─── Contract surface THIS file defines (paired-impl task must satisfy verbatim) ───
 *
 *   NEW module `packages/lore/src/adapters/http/static-serving.ts`:
 *     export interface NonceStore { mint(): string }
 *     export function createNonceStore(opts?: { ttlMs?: number }): NonceStore
 *       - `mint()` returns a fresh single-use token.
 *       - Consumption happens server-side inside the `/auth/bootstrap` handler — first
 *         GET with a minted, unexpired, unconsumed nonce succeeds; every subsequent or
 *         unknown/expired nonce answers 410 (see "nonce" scenario below).
 *
 *   `HttpConfig` (`index.ts`) gains an optional `dashboard` field:
 *     interface DashboardAssetsManifestEntry { embedded: string; contentType: string; immutable: boolean }
 *     interface DashboardAssetsManifest { stamp: { digest: string; builtAt: string }; entries: Record<string, DashboardAssetsManifestEntry> }
 *     type DashboardAssetsResult = { available: true; manifest: DashboardAssetsManifest } | { available: false; reason: string }
 *     interface DashboardServingConfig {
 *       assets: () => Promise<DashboardAssetsResult>;
 *       nonces?: NonceStore;                 // omitted → server constructs its own default
 *       machineAuth?: () => MachineAuthStores; // lazy resolver for nonce/session minting
 *                                               // ONLY (DD-2) — throwing here must degrade
 *                                               // the `/auth/bootstrap` route to a NAMED
 *                                               // 503, never a blanket 500, and must NEVER
 *                                               // be called just to serve a static page
 *                                               // (Failure Modes table: guarded at nonce
 *                                               // mint + session validate, i.e. lazily,
 *                                               // per-request, not at server startup).
 *     }
 *     HttpConfig.dashboard?: DashboardServingConfig
 *
 *   Route dispatch order (DD-4), all served by `startHttpServer`'s existing `fetch`:
 *     1. `/api/*` — untouched.
 *     2. `GET /auth/bootstrap?nonce=<n>` — nonce lifecycle (see "nonce" scenario).
 *          Sec-Fetch-Dest: iframe (or any subresource/iframe navigation signal) → 403,
 *          never 302 — THIS file's chosen contract value (mirrors the existing bad-Origin
 *          403 convention in `routes.ts::handleLocalBootstrap`; spec DD-3 only says
 *          "rejected", not an exact code).
 *     3. Exact static asset match (manifest key === pathname) — hashed paths get
 *        `Cache-Control` containing `immutable`; `/index.html` gets `no-cache`.
 *     4. GET SPA fallback (any other non-`/api` path, including `/p/:name/*`) — serves
 *        `/index.html`'s bytes, `no-cache`.
 *
 * @spec_ref spec-dashboard-production-packaging-one-command-lore-dashboard DD-2 DD-3 DD-4
 *   AC-F5A-3 AC-F5A-4 AC-F5A-7
 * @task_ref task-skill-test-f5a-static-serving-and-nonce-red-scenarios
 *
 * ─── AC-F5A-10 addendum (RED, task-red-failing-tests-for-no-open-suppression-nonce-
 * failure) — "nonce failure page" describe block below ──────────────────────────────────
 *
 * The spec's own Failure Modes table already mandates: "Nonce consumed/expired/unknown ->
 * 410 + human-readable page naming `lore dashboard` re-launch". `handleNonceBootstrap`
 * (static-serving.ts) instead returns `jsonError(...)` for every one of those three
 * outcomes — a bare `{"ok":false,...}` envelope, never HTML. This is an implementation
 * deviation from an already-approved spec, not a new design decision (see the governing
 * plan's "Why" section). Every NEGATIVE/BOUNDARY case in the "nonce failure page" describe
 * below is expected to fail against the current `jsonError` response; the HAPPY and
 * REGRESSION cases in that same describe pin the CURRENT (correct) response shapes the
 * paired GREEN task must not disturb while fixing the failure-page defect — a blanket
 * "convert every response on this endpoint to HTML" implementation must fail the REGRESSION
 * cases (Sec-Fetch guard 403 JSON, AC-F5A-7's 503 JSON) just as loudly as the current bug
 * fails the NEGATIVE/BOUNDARY ones.
 *
 * @spec_ref spec-dashboard-production-packaging-one-command-lore-dashboard AC-F5A-10
 * @spec_ref task-red-failing-tests-for-no-open-suppression-nonce-failure
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startHttpServer } from "../../src/adapters/http/index.js";
import type { HttpConfig } from "../../src/adapters/http/index.js";
import { createMachineAuthStores } from "../../src/adapters/http/machine-auth.js";
import type { MachineAuthStores } from "../../src/adapters/http/machine-auth.js";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import type { LoreConfig } from "@lore/core";
import { liveAmbient, liveWriteContext } from "../live-invocation.js";

// ─── Future contract types (this file's own DashboardServingConfig — see header) ─────

interface DashboardAssetsManifestEntry {
  embedded: string;
  contentType: string;
  immutable: boolean;
}

interface DashboardAssetsManifest {
  stamp: { digest: string; builtAt: string };
  entries: Record<string, DashboardAssetsManifestEntry>;
}

type DashboardAssetsResult =
  | { available: true; manifest: DashboardAssetsManifest }
  | { available: false; reason: string };

interface NonceStoreLike {
  mint(): string;
}

interface DashboardServingConfig {
  assets: () => Promise<DashboardAssetsResult>;
  nonces?: NonceStoreLike;
  machineAuth?: () => MachineAuthStores;
}

interface FutureHttpConfig extends HttpConfig {
  dashboard?: DashboardServingConfig;
}

// ─── Dynamic import of the not-yet-existing static-serving module ────────────────────
//
// reason: a STRING-TYPED (not string-literal-typed) specifier is passed to `import()` so
// TypeScript widens the argument to `string` and skips static module-graph resolution —
// `bun run typecheck` (AC oracle) stays green even though the file does not exist on disk
// yet. A literal `import("../../src/adapters/http/static-serving.js")` would instead trip
// TS2307 at typecheck time. Verified against this repo's own tsconfig.base.json
// (moduleResolution: "bundler") before relying on it here.
const staticServingModulePath: string = "../../src/adapters/http/static-serving.js";

async function importStaticServing(): Promise<{
  createNonceStore: (opts?: { ttlMs?: number }) => NonceStoreLike;
}> {
  return import(staticServingModulePath);
}

// ─── Fixture manifest (never a real vite build) ───────────────────────────────────────

interface Fixture {
  indexBytes: string;
  assetBytes: string;
  manifest: DashboardAssetsManifest;
}

function writeFixtureAssets(fixtureDir: string): Fixture {
  mkdirSync(fixtureDir, { recursive: true });

  const indexPath = join(fixtureDir, "index.html");
  const indexBytes = "<!doctype html><html><body>LORE_DASHBOARD_FIXTURE_INDEX_V1</body></html>";
  writeFileSync(indexPath, indexBytes, "utf8");

  const assetPath = join(fixtureDir, "app-abc123.js");
  const assetBytes = "console.log('LORE_DASHBOARD_FIXTURE_ASSET_V1');\n";
  writeFileSync(assetPath, assetBytes, "utf8");

  const manifest: DashboardAssetsManifest = {
    stamp: { digest: "fixture-digest-v1", builtAt: new Date().toISOString() },
    entries: {
      "/index.html": { embedded: indexPath, contentType: "text/html", immutable: false },
      "/assets/app-abc123.js": { embedded: assetPath, contentType: "text/javascript", immutable: true },
    },
  };

  return { indexBytes, assetBytes, manifest };
}

// ─── Throwaway-corpus server harness (mkdtemp + createApp, NEVER the repo .lore/) ─────

interface ServerCtx {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  baseUrl: string;
  cleanup: () => void;
}

async function makeServer(dashboard?: DashboardServingConfig): Promise<ServerCtx> {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-static-serving-corpus-"));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  const dbPath = join(tmpDir, ".lore", "lore.db");

  const config = { project: { name: "static-serving-red", author: "test" } } as unknown as LoreConfig;
  const appResult = createApp(dbPath, config, liveAmbient(), liveWriteContext());
  // reason: no `sync` section above → createApp's SQLiteStore branch always returns a
  // bare App, never the Result-wrapped TursoStore branch (same narrowing as
  // tests/http/telemetry-route.bun.test.ts).
  const app = appResult as App;

  // reason: `port: 0` → OS assigns a free ephemeral port, guaranteed never 8787.
  const futureConfig: FutureHttpConfig = {
    port: 0,
    host: "127.0.0.1",
    ...(dashboard !== undefined ? { dashboard } : {}),
  };
  const server = startHttpServer(app, futureConfig);
  const baseUrl = `http://127.0.0.1:${server.port}`;

  return {
    server,
    app,
    baseUrl,
    cleanup: () => {
      server.stop(true);
      app.close();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function makeMachineAuth(): { stores: MachineAuthStores; cleanup: () => void } {
  const baseDir = mkdtempSync(join(tmpdir(), "lore-static-serving-machine-auth-"));
  const stores = createMachineAuthStores({ baseDir });
  return {
    stores,
    cleanup: () => {
      stores.db.close();
      rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

// ─── Scenario: route priority (AC-F5A-4) ───────────────────────────────────────────────

describe("route priority", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("api 404s stay JSON, client routes fall back to index.html, hashed assets are immutable", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "lore-static-serving-fixture-"));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const { indexBytes, assetBytes, manifest } = writeFixtureAssets(fixtureDir);

    const ctx = await makeServer({ assets: async () => ({ available: true, manifest }) });
    cleanups.push(ctx.cleanup);

    // reason: `/api/*` requires authentication BEFORE route dispatch (index.ts, unchanged
    // by DD-4) — an unauthenticated request 401s before ever reaching the "unknown route"
    // branch. A real bearer key isolates THIS assertion to what DD-4 actually promises:
    // an AUTHENTICATED miss stays JSON 404, never swallowed by the new SPA fallback.
    const apiKey = await ctx.app.apiKeyStore.create("route-priority-test", "owner");
    if (!apiKey.ok) throw new Error("expected ok create");

    // Given static serving is enabled. When an unknown /api/* route is requested, Then
    // it stays a JSON 404 (never falls through to the SPA index.html).
    const apiMiss = await fetch(`${ctx.baseUrl}/api/definitely-not-a-route`, {
      headers: { Authorization: `Bearer ${apiKey.value.rawKey}` },
    });
    expect(apiMiss.status).toBe(404);
    expect(apiMiss.headers.get("content-type") ?? "").toContain("application/json");
    const apiMissBody = (await apiMiss.json()) as { ok: boolean; error: { code: string } };
    expect(apiMissBody.ok).toBe(false);
    expect(apiMissBody.error.code).toBe("NOT_FOUND");

    // When a deep client route is requested, Then it answers 200 with index.html bytes
    // (SPA fallback), no-cache (it carries no secret, so freshness beats caching).
    const library = await fetch(`${ctx.baseUrl}/library`);
    expect(library.status).toBe(200);
    expect(await library.text()).toBe(indexBytes);
    expect(library.headers.get("cache-control") ?? "").toContain("no-cache");

    // Project-scoped client route (SPEC-078 client routing) → same SPA fallback.
    const projectLibrary = await fetch(`${ctx.baseUrl}/p/alpha/library`);
    expect(projectLibrary.status).toBe(200);
    expect(await projectLibrary.text()).toBe(indexBytes);

    // When a hashed asset path is requested, Then it answers 200 with the asset bytes
    // and an immutable Cache-Control.
    const asset = await fetch(`${ctx.baseUrl}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe(assetBytes);
    expect(asset.headers.get("content-type") ?? "").toContain("text/javascript");
    expect(asset.headers.get("cache-control") ?? "").toContain("immutable");
  });
});

// ─── Scenario: secret-free (AC-F5A-3) ──────────────────────────────────────────────────

describe("secret-free", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("no response body ever carries the bootstrap-token mechanism or the raw machine key", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "lore-static-serving-fixture-"));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const { manifest } = writeFixtureAssets(fixtureDir);

    const machineAuth = makeMachineAuth();
    cleanups.push(machineAuth.cleanup);
    const created = await machineAuth.stores.apiKeyStore.create("dashboard-local", "admin");
    if (!created.ok) throw new Error("expected ok create");
    const rawLocalKey = created.value.rawKey;

    const ctx = await makeServer({
      assets: async () => ({ available: true, manifest }),
      machineAuth: () => machineAuth.stores,
    });
    cleanups.push(ctx.cleanup);

    // Given GET /, GET /library, GET /auth/bootstrap?nonce=bad (an unknown nonce, so it
    // resolves without ever needing a valid session). When responses are captured...
    const root = await fetch(`${ctx.baseUrl}/`);
    expect(root.status).toBe(200);
    const rootBody = await root.text();

    const library = await fetch(`${ctx.baseUrl}/library`);
    expect(library.status).toBe(200);
    const libraryBody = await library.text();

    const badNonce = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=bad`, { redirect: "manual" });
    expect(badNonce.status).toBe(410);
    const badNonceBody = await badNonce.text();

    // Then no body contains the dev-only bootstrap-token mechanism marker nor the actual
    // raw machine-scope local key value (DD-2's whole point: packaged mode never puts
    // either on the wire).
    for (const body of [rootBody, libraryBody, badNonceBody]) {
      expect(body).not.toContain("__LORE_BOOTSTRAP_TOKEN__");
      expect(body).not.toContain(rawLocalKey);
    }
  });
});

// ─── Scenario: nonce lifecycle (AC-F5A-2 shape, this task's own RED coverage) ─────────

describe("nonce", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("first use redirects with a session cookie; replay, unknown, and iframe requests are all rejected", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "lore-static-serving-fixture-"));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const { manifest } = writeFixtureAssets(fixtureDir);

    const machineAuth = makeMachineAuth();
    cleanups.push(machineAuth.cleanup);

    const { createNonceStore } = await importStaticServing();
    const nonceStore = createNonceStore({ ttlMs: 60_000 });

    const ctx = await makeServer({
      assets: async () => ({ available: true, manifest }),
      nonces: nonceStore,
      machineAuth: () => machineAuth.stores,
    });
    cleanups.push(ctx.cleanup);

    // Given a minted nonce. When it is presented the first time, Then 302 to / with a
    // Set-Cookie lore_sid (HttpOnly).
    const nonce = nonceStore.mint();
    const first = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce}`, { redirect: "manual" });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/");
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("lore_sid=");
    expect(setCookie.toLowerCase()).toContain("httponly");

    // When the SAME nonce is replayed, Then 410 (single-use, already consumed).
    const replay = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce}`, { redirect: "manual" });
    expect(replay.status).toBe(410);

    // When an unknown nonce is presented, Then 410.
    const unknown = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=never-minted-xyz`, { redirect: "manual" });
    expect(unknown.status).toBe(410);

    // When a freshly-minted nonce is presented with Sec-Fetch-Dest: iframe, Then it is
    // rejected — never a 302. This file's chosen contract value is 403 (see module header).
    const nonce2 = nonceStore.mint();
    const iframeAttempt = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce2}`, {
      redirect: "manual",
      headers: { "Sec-Fetch-Dest": "iframe" },
    });
    expect(iframeAttempt.status).not.toBe(302);
    expect(iframeAttempt.status).toBe(403);
  });
});

// ─── Scenario: auth-store degradation (AC-F5A-7) ───────────────────────────────────────

describe("auth-store degradation", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("static pages keep serving unauthenticated while the nonce endpoint fails loud with 503", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "lore-static-serving-fixture-"));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const { indexBytes, manifest } = writeFixtureAssets(fixtureDir);

    const { createNonceStore } = await importStaticServing();
    const nonceStore = createNonceStore({ ttlMs: 60_000 });
    const nonce = nonceStore.mint();

    // Given machine-auth store construction fails (injected fault — mirrors a
    // disk-full/permission failure without ever touching a real filesystem path).
    const ctx = await makeServer({
      assets: async () => ({ available: true, manifest }),
      nonces: nonceStore,
      machineAuth: () => {
        throw new Error("EACCES: permission denied, open 'dashboard-auth.db'");
      },
    });
    cleanups.push(ctx.cleanup);

    // When GET / is requested, Then 200 index.html (unauthenticated state) — static
    // serving never touches the machine-auth resolver at all.
    const root = await fetch(`${ctx.baseUrl}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toBe(indexBytes);

    // When GET /auth/bootstrap?nonce=N is requested, Then 503 with an actionable JSON
    // body — never a blanket 500.
    const bootstrap = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce}`, { redirect: "manual" });
    expect(bootstrap.status).toBe(503);
    expect(bootstrap.status).not.toBe(500);
    expect(bootstrap.headers.get("content-type") ?? "").toContain("application/json");
    const body = (await bootstrap.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(typeof body.error.code).toBe("string");
    expect(body.error.code.length).toBeGreaterThan(0);
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });
});

// ─── Scenario: nonce failure page (AC-F5A-10) ──────────────────────────────────────────

describe("nonce failure page", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  /**
   * Shared assertion body for every consumed/expired/unknown outcome (DD-2: "the endpoint
   * answers 410 for consumed/expired/unknown nonces" — the caller never needs to
   * distinguish which; the spec's Failure Modes table demands the SAME human-readable page
   * for all three). Fails today against `jsonError(...)`'s bare JSON envelope.
   */
  async function assertHumanReadableFailurePage(res: Response): Promise<void> {
    expect(res.status).toBe(410);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");

    const body = await res.text();
    // Must be an actual HTML document, not a JSON envelope wearing an html Content-Type.
    expect(body.toLowerCase()).toContain("<html");
    expect(() => JSON.parse(body)).toThrow();
    expect(body).not.toContain('"ok":false');
    // Must name the `lore dashboard` relaunch as the fix (Failure Modes table wording).
    expect(body).toContain("lore dashboard");
    // Must carry a client-side probe against GET /api/auth/me, forwarding an
    // already-authenticated browser to `/` instead of stranding it on a dead end (the
    // constraint DD-2 documents: `lore_sid` is Path=/api, so /auth/bootstrap can never see
    // the cookie server-side).
    expect(body).toContain("/api/auth/me");
  }

  it("HAPPY: successful redemption still answers 302 with Set-Cookie and Location: / (unchanged by the failure-page fix)", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "lore-static-serving-fixture-"));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const { manifest } = writeFixtureAssets(fixtureDir);

    const machineAuth = makeMachineAuth();
    cleanups.push(machineAuth.cleanup);

    const { createNonceStore } = await importStaticServing();
    const nonceStore = createNonceStore({ ttlMs: 60_000 });

    const ctx = await makeServer({
      assets: async () => ({ available: true, manifest }),
      nonces: nonceStore,
      machineAuth: () => machineAuth.stores,
    });
    cleanups.push(ctx.cleanup);

    const nonce = nonceStore.mint();
    const res = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce}`, { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie") ?? "").toContain("lore_sid=");
  });

  it("NEGATIVE/BOUNDARY: a consumed (replayed) nonce answers a human-readable HTML 410 page, never the JSON envelope", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "lore-static-serving-fixture-"));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const { manifest } = writeFixtureAssets(fixtureDir);

    const machineAuth = makeMachineAuth();
    cleanups.push(machineAuth.cleanup);

    const { createNonceStore } = await importStaticServing();
    const nonceStore = createNonceStore({ ttlMs: 60_000 });

    const ctx = await makeServer({
      assets: async () => ({ available: true, manifest }),
      nonces: nonceStore,
      machineAuth: () => machineAuth.stores,
    });
    cleanups.push(ctx.cleanup);

    const nonce = nonceStore.mint();
    // First redemption succeeds and consumes the token (single-use, DD-2).
    const first = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce}`, { redirect: "manual" });
    expect(first.status).toBe(302);

    // Replay of the SAME, now-consumed token.
    const replay = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce}`, { redirect: "manual" });
    await assertHumanReadableFailurePage(replay);
  });

  it("NEGATIVE/BOUNDARY: an expired nonce answers a human-readable HTML 410 page, never the JSON envelope", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "lore-static-serving-fixture-"));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const { manifest } = writeFixtureAssets(fixtureDir);

    const { createNonceStore } = await importStaticServing();
    // Injectable TTL seam (this file's header contract) — a 1ms TTL lets this scenario
    // observe "expired" deterministically without a real 60s sleep.
    const nonceStore = createNonceStore({ ttlMs: 1 });

    const ctx = await makeServer({
      assets: async () => ({ available: true, manifest }),
      nonces: nonceStore,
      // A failed (non-"granted") nonce redemption must NEVER touch machineAuth — a
      // throwing stub here turns any regression that does into a loud test failure
      // instead of a silently-passing test.
      machineAuth: () => {
        throw new Error("machineAuth must not be invoked for a non-granted nonce outcome");
      },
    });
    cleanups.push(ctx.cleanup);

    const nonce = nonceStore.mint();
    // Let the 1ms TTL lapse — no real sleep, just enough wall time for Date.now() to move.
    await new Promise((resolve) => setTimeout(resolve, 15));

    const res = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce}`, { redirect: "manual" });
    await assertHumanReadableFailurePage(res);
  });

  it("NEGATIVE/BOUNDARY: an unknown (never-minted) nonce answers a human-readable HTML 410 page, never the JSON envelope", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "lore-static-serving-fixture-"));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const { manifest } = writeFixtureAssets(fixtureDir);

    const { createNonceStore } = await importStaticServing();
    const nonceStore = createNonceStore({ ttlMs: 60_000 });

    const ctx = await makeServer({
      assets: async () => ({ available: true, manifest }),
      nonces: nonceStore,
      machineAuth: () => {
        throw new Error("machineAuth must not be invoked for a non-granted nonce outcome");
      },
    });
    cleanups.push(ctx.cleanup);

    const res = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=never-minted-red-f5a-10`, { redirect: "manual" });
    await assertHumanReadableFailurePage(res);
  });

  it("REGRESSION: the Sec-Fetch-Dest iframe guard still answers 403 JSON before the nonce store is touched (never HTML)", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "lore-static-serving-fixture-"));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const { manifest } = writeFixtureAssets(fixtureDir);

    const { createNonceStore } = await importStaticServing();
    const nonceStore = createNonceStore({ ttlMs: 60_000 });

    const ctx = await makeServer({
      assets: async () => ({ available: true, manifest }),
      nonces: nonceStore,
      // The Sec-Fetch guard fires BEFORE the nonce store (and, a fortiori, machineAuth)
      // is ever touched — a throwing stub proves that ordering.
      machineAuth: () => {
        throw new Error("machineAuth must not be invoked for a rejected navigation");
      },
    });
    cleanups.push(ctx.cleanup);

    const nonce = nonceStore.mint();
    const res = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce}`, {
      redirect: "manual",
      headers: { "Sec-Fetch-Dest": "iframe" },
    });

    expect(res.status).toBe(403);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(typeof body.error.code).toBe("string");

    // The nonce must still be redeemable afterward — proof the rejected iframe attempt
    // never burned it.
    const legitimate = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce}`, { redirect: "manual" });
    expect(legitimate.status).not.toBe(403);
  });

  it("REGRESSION: the machine-auth-unavailable path still answers 503 JSON (AC-F5A-7 shape unchanged, never HTML)", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "lore-static-serving-fixture-"));
    cleanups.push(() => rmSync(fixtureDir, { recursive: true, force: true }));
    const { manifest } = writeFixtureAssets(fixtureDir);

    const { createNonceStore } = await importStaticServing();
    const nonceStore = createNonceStore({ ttlMs: 60_000 });

    const ctx = await makeServer({
      assets: async () => ({ available: true, manifest }),
      nonces: nonceStore,
      machineAuth: () => {
        throw new Error("EACCES: permission denied, open 'dashboard-auth.db'");
      },
    });
    cleanups.push(ctx.cleanup);

    const nonce = nonceStore.mint();
    const res = await fetch(`${ctx.baseUrl}/auth/bootstrap?nonce=${nonce}`, { redirect: "manual" });

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(typeof body.error.code).toBe("string");
  });
});
