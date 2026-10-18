/**
 * End-to-end tests for CORS origin-echo behavior against a real in-process Bun.Server.
 * Source: SPEC-027 AC-DH-5 — Access-Control-Allow-Origin must never be a wildcard; it must
 * echo the caller's Origin only when allowlisted (ALLOWED_ORIGINS, SPEC-016 §3.2).
 * Source: SPEC-027 AC-DH-13 — disallowed-Origin requests must get NO CORS-origin headers at
 * all (not merely "not a wildcard" — a fully absent Access-Control-Allow-Origin, verified with
 * `toBeNull()`), across every surface (read, write, preflight), and must never leak
 * Access-Control-Allow-Credentials or echo a look-alike/arbitrary Origin.
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - GET /health with allowlisted Origin → 200 + Allow-Origin echoes it + Vary: Origin
 *     - GET /api/status with valid bearer + allowlisted Origin → 200 + Allow-Origin echoes it
 *     - OPTIONS preflight with allowlisted Origin → 204 + Allow-Origin echoes it
 *
 *   NEGATIVE:
 *     - GET /health with disallowed Origin → 200, no Allow-Origin header at all, no
 *       Allow-Credentials header at all (AC-DH-13)
 *     - OPTIONS preflight with disallowed Origin → 204, no Allow-Origin header, no
 *       Allow-Credentials header (AC-DH-13)
 *     - GET /api/status with unauthenticated request + allowlisted Origin → 401, but Allow-Origin
 *       is still echoed (CORS applies uniformly regardless of route auth outcome)
 *     - GET /api/docs (read surface) with disallowed Origin + valid bearer → 200, no Allow-Origin
 *       header, no Allow-Credentials header (AC-DH-13)
 *     - POST /api/dashboard/docs (write surface) with disallowed Origin + no auth → 401, no
 *       Allow-Origin header, no Allow-Credentials header (AC-DH-13)
 *     - GET /health with a look-alike Origin that merely contains/prefixes/suffixes an
 *       allowlisted entry (not an exact match) → no Allow-Origin header at all — locks exact-match
 *       semantics of isOriginAllowed against a future substring/prefix regression (AC-DH-13)
 *
 *   BOUNDARY:
 *     - GET /health with no Origin header (non-browser caller) → 200, no Allow-Origin header
 *     - 404 (unmatched route) with allowlisted Origin → still gets Allow-Origin echoed
 *
 *   ERROR:
 *     - n/a: no store/IO failure path exercises CORS differently
 *
 *   STATE:
 *     - n/a: CORS headers are computed per-request, no persisted state
 *
 *   REGRESSION:
 *     - Access-Control-Allow-Origin is never literally "*" on any response, ever (grep-style
 *       assertion across every case above)
 *
 * @spec_ref AC-DH-5
 * @spec_ref AC-DH-13
 */

import { RecordLockService } from "../../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../../src/service/gate-enforcer.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { ApiKeyStore } from "../../../../src/adapters/http/auth.js";
import { SessionStore } from "../../../../src/adapters/http/sessions.js";
import { startHttpServer } from "../../../../src/adapters/http/index.js";
import { InMemoryStore } from "../../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../../src/service/corpus-service.js";
import { ReviewService } from "../../../../src/service/review-service.js";
import { VersionService } from "../../../../src/service/version-service.js";
import { OutlineService } from "../../../../src/service/outline-service.js";
import { MigrationService } from "../../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../../src/service/tree-check-service.js";
import { NoOpTelemetry } from "@lore/core";
import { MIGRATION_002_SQL } from "../../../../src/store/migrations/migration-002.js";
import type { App } from "../../../../src/app.js";
import { actedStore } from "../../../live-invocation.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGIN = "http://localhost:5173";
const DISALLOWED_ORIGIN = "http://evil.example";

interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  db: Database;
  rawKey: string;
  baseUrl: string;
}

async function makeTestServer(): Promise<TestContext> {
  const db = new Database(":memory:");
  db.exec(MIGRATION_002_SQL);

  const apiKeyStore = new ApiKeyStore(db);
  const sessionStore = new SessionStore(db);
  const docStore = actedStore(new InMemoryStore());

  const app: App = {
    corpusService: new CorpusService(docStore, new RecordLockService(docStore, new GateEnforcer(undefined))),
    reviewService: new ReviewService(docStore, new RecordLockService(docStore, new GateEnforcer(undefined))),
    versionService: new VersionService(docStore, new RecordLockService(docStore, new GateEnforcer(undefined))),
    outlineService: new OutlineService(docStore),
    migrationService: new MigrationService(docStore),
    treeCheckService: new TreeCheckService(docStore),
    apiKeyStore,
    sessionStore,
    // reason: CORS tests never exercise the AI path; null-cast avoids heavyweight
    // AIProviderService construction while satisfying the required field (SPEC-017 §3.12).
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    // reason: SPEC-032 §3.4 — test does not exercise spec-kind audit; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => db.close(),
  };

  const createResult = await apiKeyStore.create("dashboard-local", "admin");
  if (!createResult.ok) throw new Error("Failed to create API key");
  const rawKey = createResult.value.rawKey;

  // Port 0 → OS assigns a free port
  const server = startHttpServer(app, { port: 0, host: "127.0.0.1" });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  return { server, app, db, rawKey, baseUrl };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("CORS Access-Control-Allow-Origin (SPEC-027 AC-DH-5)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer();
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
  });

  it("echoes an allowlisted Origin on GET /health with Vary: Origin (happy path)", async () => {
    const res = await fetch(`${ctx.baseUrl}/health`, { headers: { Origin: ALLOWED_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("echoes an allowlisted Origin on GET /api/status with valid bearer auth (happy path)", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/status`, {
      headers: { Authorization: `Bearer ${ctx.rawKey}`, Origin: ALLOWED_ORIGIN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });

  it("echoes an allowlisted Origin on OPTIONS preflight (happy path)", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/status`, {
      method: "OPTIONS",
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });

  it("does not echo a disallowed Origin on GET /health (negative, AC-DH-13: exact toBeNull assertion)", async () => {
    const res = await fetch(`${ctx.baseUrl}/health`, { headers: { Origin: DISALLOWED_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    // AC-DH-13: a disallowed Origin must not leak Allow-Credentials either.
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("does not echo a disallowed Origin on OPTIONS preflight (negative, AC-DH-13: exact toBeNull assertion)", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/status`, {
      method: "OPTIONS",
      headers: { Origin: DISALLOWED_ORIGIN },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    // AC-DH-13: preflight for a disallowed Origin must not leak Allow-Credentials either.
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("does not echo a disallowed Origin on GET /api/docs — read surface (negative, AC-DH-13)", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/docs`, {
      headers: { Authorization: `Bearer ${ctx.rawKey}`, Origin: DISALLOWED_ORIGIN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("does not echo a disallowed Origin on POST /api/dashboard/docs — write surface (negative, AC-DH-13)", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/dashboard/docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: DISALLOWED_ORIGIN },
      body: JSON.stringify({ type: "knowledge", title: "x" }),
    });
    // No cookie and no bearer token → unauthenticated, but CORS must still behave correctly
    // regardless of the auth outcome (mirrors the existing 401-with-allowlisted-Origin case).
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("does not echo a look-alike Origin that only contains/prefixes/suffixes an allowlisted entry (negative, AC-DH-13)", async () => {
    const lookAlikes = [
      `${ALLOWED_ORIGIN}.evil.example`, // suffix trick: allowlisted origin as a prefix
      `http://evil.example?${ALLOWED_ORIGIN}`, // allowlisted origin embedded as a query string
      `${ALLOWED_ORIGIN}/`, // trailing slash — must be an exact string match, not a startsWith
    ];

    for (const origin of lookAlikes) {
      const res = await fetch(`${ctx.baseUrl}/health`, { headers: { Origin: origin } });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("still echoes an allowlisted Origin on a 401 (auth failure) response (negative)", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/status`, { headers: { Origin: ALLOWED_ORIGIN } });
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });

  it("omits Access-Control-Allow-Origin when no Origin header is sent (non-browser caller, boundary)", async () => {
    const res = await fetch(`${ctx.baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("still echoes an allowlisted Origin on a 404 (unmatched route) response (boundary)", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/does-not-exist`, {
      headers: { Authorization: `Bearer ${ctx.rawKey}`, Origin: ALLOWED_ORIGIN },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });

  it("never emits a wildcard Access-Control-Allow-Origin on any response (regression)", async () => {
    const cases: Array<[string, RequestInit]> = [
      ["/health", { headers: { Origin: ALLOWED_ORIGIN } }],
      ["/health", { headers: { Origin: DISALLOWED_ORIGIN } }],
      ["/health", {}],
      ["/api/status", { headers: { Authorization: `Bearer ${ctx.rawKey}`, Origin: ALLOWED_ORIGIN } }],
      ["/api/status", { method: "OPTIONS", headers: { Origin: ALLOWED_ORIGIN } }],
    ];

    for (const [path, init] of cases) {
      const res = await fetch(`${ctx.baseUrl}${path}`, init);
      expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    }
  });
});
