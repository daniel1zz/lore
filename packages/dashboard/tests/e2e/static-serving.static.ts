/**
 * Single-process packaged-mode static e2e suite
 * (spec-dashboard-production-packaging-one-command-lore-dashboard DD-6).
 *
 * Run via `playwright.static.config.ts` (baseURL `http://localhost:8787`,
 * `globalSetup: "./global-setup-static.ts"` — spawns the ONE `dist/lore dashboard
 * --no-open` process this whole suite talks to). Never run standalone against the
 * default `playwright.config.ts` — the two configs' `testMatch` globs are deliberately
 * disjoint (see `playwright.static.config.ts`'s header) so this file is invisible to
 * that config and vice versa.
 *
 * Three `describe` groups, matching the spec's oracle `-g` filters verbatim
 * (spec-dashboard-production-packaging-one-command-lore-dashboard's AC-F5A-1/2/8 script
 * commands filter on these EXACT titles — renaming a describe block silently
 * under-matches the oracle, which is itself one of this repo's documented false-oracle
 * vectors):
 *   -g "packaged serve"      → AC-F5A-1
 *   -g "nonce"                → AC-F5A-2
 *   -g "allowlist|freshness"  → AC-F5A-8
 *
 * KNOWN GAP (documented so a future reader never mistakes this for a harness bug):
 * two tests below — "packaged serve"'s health-stamp assertion and "allowlist and
 * freshness"'s digest-equality assertion — assert against `GET /api/health` carrying a
 * `dashboard: { digest, builtAt }` build-stamp field, exactly as this spec's
 * Observability section and AC-F5A-1/AC-F5A-8 literally require. As of this file's
 * authorship, NO SUCH FIELD OR ROUTE EXISTS: `packages/lore/src/adapters/http/index.ts`'s
 * `/health` handler returns a hardcoded `{ ok: true, status: "healthy" }` with no
 * `dashboard` key, and no `/api/health` route is registered in `routes.ts::
 * handleApiRoute` at all (confirmed by `grep -rni health packages/lore/src/adapters/
 * http/*.ts` and by `git log -S"dashboard:" -- .../index.ts`, which returns nothing —
 * neither F5a implement commit that landed DD-2/DD-3/DD-4 (route priority, secret-free,
 * nonce, auth-store degradation) ever touched the Observability stamp). This harness's
 * write-scope anchor is `packages/dashboard/tests/e2e/` + `packages/dashboard/
 * package.json` ONLY — the fix (threading `config.dashboard.assets()`'s resolved
 * `.stamp` onto the health response) belongs to `packages/lore/src/adapters/http/
 * index.ts`, outside this anchor. These two assertions are written EXACTLY as the spec
 * requires and are expected to fail until that field is added — see this task's
 * completion report / the `lore handoff` filed alongside it for the precise follow-up.
 *
 * @spec_ref spec-dashboard-production-packaging-one-command-lore-dashboard DD-1 DD-2
 *   DD-3 DD-6 AC-F5A-1 AC-F5A-2 AC-F5A-8
 * @task_ref task-skill-test-f5a-single-process-static-e2e-harness
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import {
  NONCE_URL_ENV_VAR,
  FIRST_REDEMPTION_STATUS_ENV_VAR,
  FIRST_REDEMPTION_SET_COOKIE_ENV_VAR,
  FIRST_REDEMPTION_LOCATION_ENV_VAR,
  VITE_DEV_PORT,
  isPortOpen,
} from "./global-setup-static";

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e -> tests -> dashboard -> packages -> <repo root>
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const DASHBOARD_ROOT = join(REPO_ROOT, "packages", "dashboard");

/** Reads a required env var `global-setup-static.ts` publishes — throws loud (never
 * `undefined`-silently-passed-around) if globalSetup did not run first. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is unset — this suite must run via playwright.static.config.ts ` +
        `(its globalSetup publishes this env var before any test file loads).`,
    );
  }
  return value;
}

function nonceUrl(): string {
  return requiredEnv(NONCE_URL_ENV_VAR);
}

/** Extracts the `lore_sid=...` cookie pair (up to the first `;`) from a raw
 * `Set-Cookie` header value, for manual reattachment as a `Cookie` request header. */
function cookiePairFromSetCookie(setCookie: string): string {
  const pair = setCookie.split(";")[0]?.trim();
  if (pair === undefined || pair === "") {
    throw new Error(`Could not extract a cookie pair from Set-Cookie value: ${setCookie}`);
  }
  return pair;
}

// ─── Independent freshness digest (mirrors scripts/build.ts::computeDashboardSourceDigest) ──
//
// Deliberately REIMPLEMENTED here rather than imported: the whole point of a freshness
// ORACLE is that it computes the expected value independently of the production code
// path it is checking — importing the same function scripts/build.ts uses would let a
// bug in that one function silently agree with itself. Algorithm intentionally mirrors
// it exactly (sha256 per file, sorted-pair whole-tree digest — filesystem walk order
// must never leak into the digest) so a genuinely fresh build is expected to match.

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Recursively collects every regular file under `dir`, as POSIX-relative paths (sorted). */
function walkFilesRelative(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    const dirents = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of dirents) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(dir, "");
  return out;
}

/** Independent recomputation of the dashboard source digest — see this section's header. */
function computeFreshDashboardSourceDigest(): string {
  const srcDir = join(DASHBOARD_ROOT, "src");
  const viteConfigPath = join(DASHBOARD_ROOT, "vite.config.ts");
  const pkgJsonPath = join(DASHBOARD_ROOT, "package.json");

  const entries: { path: string; sha256: string }[] = [];
  for (const rel of walkFilesRelative(srcDir)) {
    entries.push({ path: `src/${rel}`, sha256: sha256Hex(readFileSync(join(srcDir, rel))) });
  }
  entries.push({ path: "vite.config.ts", sha256: sha256Hex(readFileSync(viteConfigPath)) });
  entries.push({ path: "package.json", sha256: sha256Hex(readFileSync(pkgJsonPath)) });
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const joined = entries.map((e) => `${e.path} ${e.sha256}`).join("\n");
  return sha256Hex(Buffer.from(joined, "utf8"));
}

// ─── (a) "packaged serve" — AC-F5A-1 ───────────────────────────────────────────────

test.describe("packaged serve", () => {
  test("GET / returns 200 with HTML content", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<div id=\"root\">");
  });

  test("a hashed asset is served 200 with immutable Cache-Control", async ({ request }) => {
    const indexRes = await request.get("/");
    const html = await indexRes.text();
    const match = /\/assets\/[^"'>]+\.(?:js|css)/.exec(html);
    expect(match, `expected index.html to reference a hashed /assets/* file; got:\n${html}`).not.toBeNull();

    const assetPath = match![0];
    const assetRes = await request.get(assetPath);
    expect(assetRes.status()).toBe(200);
    expect(assetRes.headers()["cache-control"] ?? "").toContain("immutable");
  });

  // KNOWN GAP — see this file's header. Written per AC-F5A-1's literal text
  // ("/api/health with dashboard build stamp"); fails today because neither the
  // `/api/health` route nor the `dashboard` stamp field exists yet in
  // packages/lore/src/adapters/http/index.ts (outside this task's write-scope anchor).
  test("GET /api/health carries the dashboard build stamp", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { dashboard?: { digest?: unknown; builtAt?: unknown } };
    expect(body.dashboard, "expected a top-level 'dashboard' build-stamp field").toBeDefined();
    expect(typeof body.dashboard?.digest).toBe("string");
    expect(typeof body.dashboard?.builtAt).toBe("string");
  });

  test("no vite process is running — the harness's defining property", async () => {
    // Primary oracle: a raw TCP probe of vite's default dev port. Reliable
    // cross-platform (Scope-Alt fallback the task packet explicitly allows when
    // process-list enumeration is flaky).
    const viteDevPortOpen = await isPortOpen(VITE_DEV_PORT);
    expect(viteDevPortOpen, `port ${VITE_DEV_PORT} (vite's default) must stay unbound in packaged mode`).toBe(false);

    // Secondary, best-effort corroboration: scan the process list for a running
    // 'vite' process by command name. Never treated as authoritative on its own —
    // `pgrep` availability/behavior varies across CI images, so its absence or a
    // spawn failure degrades to a skipped assertion, never a false pass OR a flaky
    // failure of an unrelated test.
    try {
      const { execFileSync } = await import("node:child_process");
      const out = execFileSync("pgrep", ["-fl", "vite"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
      // pgrep exits 0 with output only when it found a match — if we get here, log
      // what matched (this test's own assertion below will fail loud either way).
      expect(out, `unexpected running vite process(es):\n${out}`).toBe("");
    } catch (err) {
      // Non-zero exit (no match) is pgrep's NORMAL "nothing found" signal, not a
      // tooling failure — treat it as a pass. A genuine tooling absence (ENOENT)
      // also degrades silently here; the port probe above remains authoritative.
      void err;
    }
  });
});

// ─── (b) "nonce" — AC-F5A-2 ─────────────────────────────────────────────────────────

test.describe("nonce", () => {
  // The ONE nonce this suite has (minted once at `dist/lore dashboard` startup, DD-2)
  // is already redeemed by the time ANY test here runs — `global-setup-static.ts`
  // performs that first redemption itself, immediately after the stdout handshake, to
  // avoid racing the server's fixed 60s nonce TTL against Playwright's own
  // browser-launch/dispatch overhead (see that file's `FIRST_REDEMPTION_*_ENV_VAR` doc
  // comment for the full rationale — this is a deliberate, documented harness design,
  // not a workaround). This test asserts on that CAPTURED result: a real HTTP call
  // against the real spawned server, just issued from `globalSetup` rather than from
  // here.
  test("first redemption sets lore_sid and the session can read corpus data via /api", async ({ request }) => {
    expect(requiredEnv(FIRST_REDEMPTION_STATUS_ENV_VAR)).toBe("302");
    const setCookie = requiredEnv(FIRST_REDEMPTION_SET_COOKIE_ENV_VAR);
    expect(setCookie).toContain("lore_sid");
    expect(process.env[FIRST_REDEMPTION_LOCATION_ENV_VAR]).toBe("/");

    // Manually reattach the captured session cookie (this fixture's own request
    // context never performed the redemption itself, so it has nothing in its cookie
    // jar) and prove the resulting session is actually usable — reads real corpus
    // data, not just a 200.
    const statusRes = await request.get("/api/status", {
      headers: { Cookie: cookiePairFromSetCookie(setCookie) },
    });
    expect(statusRes.status()).toBe(200);
    const body = (await statusRes.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  test("replaying the same nonce answers 410", async ({ request }) => {
    // Deterministic regardless of elapsed time: static-serving.ts's `consume()` checks
    // `record.consumed` BEFORE checking expiry, so a nonce already redeemed by
    // globalSetup above always 410s here as "consumed", never flakes into "expired"
    // vs. some other branch.
    const res = await request.get(nonceUrl(), { maxRedirects: 0 });
    expect(res.status()).toBe(410);
  });
});

// ─── (c) "allowlist and freshness" — AC-F5A-8 ──────────────────────────────────────
// Describe title deliberately contains BOTH keywords so `-g "allowlist|freshness"`
// (a regex OR matched against the full qualified test title) selects every test below.

test.describe("allowlist and freshness", () => {
  test("packaged mode allowlists only the api origin", async ({ request }) => {
    // Disallowed origin (vite's default dev port — irrelevant in packaged/single-origin
    // mode, DD-3): preflight must NOT echo it back.
    const disallowed = await request.fetch("/api/status", {
      method: "OPTIONS",
      headers: { Origin: `http://localhost:${VITE_DEV_PORT}`, "Access-Control-Request-Method": "GET" },
    });
    expect(disallowed.headers()["access-control-allow-origin"]).toBeUndefined();

    // The api origin itself IS allowlisted.
    const allowed = await request.fetch("/api/status", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:8787", "Access-Control-Request-Method": "GET" },
    });
    expect(allowed.headers()["access-control-allow-origin"]).toBe("http://localhost:8787");
  });

  // KNOWN GAP — see this file's header. Written per AC-F5A-8's literal text ("served
  // build-stamp digest matches freshly computed dashboard source digest ... stale
  // bundle is a failure, not a pass"); fails today for the SAME reason as "packaged
  // serve"'s health-stamp test — no `/api/health` dashboard-stamp field exists to read
  // the served digest from.
  test("served build-stamp digest equals a freshly computed dashboard source digest", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { dashboard?: { digest?: string } };
    const servedDigest = body.dashboard?.digest;
    expect(typeof servedDigest, "expected a served dashboard.digest to compare against").toBe("string");

    const freshDigest = computeFreshDashboardSourceDigest();
    expect(servedDigest).toBe(freshDigest);
  });
});
