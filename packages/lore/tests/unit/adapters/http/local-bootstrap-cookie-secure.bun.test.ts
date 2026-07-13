/**
 * Tests for the conditional `Secure` cookie-attribute hardening on
 * POST /api/auth/local-bootstrap's Set-Cookie response.
 * Source: SPEC-016 §3.2 hardening — the lore_sid cookie previously never carried `Secure`,
 * so it would be sent over plain http even in a non-loopback / reverse-proxied-HTTPS
 * deployment. `Secure` is now added whenever the request is HTTPS (directly or via
 * `X-Forwarded-Proto`) OR the request's hostname is not loopback — and omitted for
 * loopback plain-http requests so `lore dashboard` on localhost keeps working (Secure
 * cookies are silently dropped by browsers over plain http).
 *
 * Calls `handleLocalBootstrap` directly with crafted `Request` objects rather than a real
 * network `Bun.serve` round-trip — deterministic control over URL scheme/hostname and
 * `X-Forwarded-Proto`, which a real loopback-bound test server cannot easily vary.
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - non-loopback https:// URL → Set-Cookie includes "; Secure"
 *
 *   NEGATIVE:
 *     - n/a (covered by boundary/regression below — this is a binary attribute)
 *
 *   BOUNDARY:
 *     - loopback http:// URL (localhost) → Set-Cookie does NOT include "; Secure" (regression:
 *       must not break local `lore dashboard` dev flow)
 *     - loopback http:// URL + X-Forwarded-Proto: https → Set-Cookie includes "; Secure"
 *       (HTTPS signal wins even on loopback)
 *     - non-loopback http:// URL + X-Forwarded-Proto: http (explicit) → Set-Cookie still
 *       includes "; Secure" (non-loopback host alone is sufficient — OR semantics)
 *     - 127.0.0.1 and ::1 are also treated as loopback (not just "localhost")
 *
 *   ERROR:
 *     - n/a: no IO failure path exercises this branch differently
 *
 *   STATE:
 *     - n/a: cookie flag is computed per-request, no persisted state
 *
 *   REGRESSION:
 *     - all other Set-Cookie attributes (HttpOnly, SameSite=Strict, Path=/api,
 *       Max-Age=2592000) are unchanged regardless of Secure
 */

import { describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { ApiKeyStore } from "../../../../src/adapters/http/auth.js";
import { SessionStore } from "../../../../src/adapters/http/sessions.js";
import { handleLocalBootstrap } from "../../../../src/adapters/http/routes.js";
import { MIGRATION_002_SQL } from "../../../../src/store/migrations/migration-002.js";
import { InMemoryStore } from "../../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../../src/service/corpus-service.js";
import { ReviewService } from "../../../../src/service/review-service.js";
import { VersionService } from "../../../../src/service/version-service.js";
import { OutlineService } from "../../../../src/service/outline-service.js";
import { MigrationService } from "../../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../../src/service/tree-check-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../../src/app.js";

// ─── Test setup ───────────────────────────────────────────────────────────────

async function makeTestApp(): Promise<{ app: App; rawKey: string }> {
  const db = new Database(":memory:");
  db.exec(MIGRATION_002_SQL);
  const apiKeyStore = new ApiKeyStore(db);
  const sessionStore = new SessionStore(db);
  const docStore = new InMemoryStore();

  const app: App = {
    corpusService: new CorpusService(docStore),
    reviewService: new ReviewService(docStore),
    versionService: new VersionService(docStore),
    outlineService: new OutlineService(docStore),
    migrationService: new MigrationService(docStore),
    treeCheckService: new TreeCheckService(docStore),
    apiKeyStore,
    sessionStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
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

  return { app, rawKey: createResult.value.rawKey };
}

function makeBootstrapReq(url: string, extraHeaders: Record<string, string> = {}, rawKey = ""): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "X-Lore-Token": rawKey,
      Origin: "http://localhost:5173",
      ...extraHeaders,
    },
  });
}

// ─── isSecureRequestContext (via handleLocalBootstrap's Set-Cookie) ────────────

describe("POST /api/auth/local-bootstrap — Secure cookie attribute", () => {
  describe("happy path", () => {
    it("adds Secure for a non-loopback https:// URL", async () => {
      const { app, rawKey } = await makeTestApp();
      const req = makeBootstrapReq("https://lore.example.com/api/auth/local-bootstrap", {}, rawKey);
      const res = await handleLocalBootstrap(req, app);
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).not.toBeNull();
      expect(setCookie).toContain("; Secure");
    });
  });

  describe("boundary values", () => {
    it("does NOT add Secure for loopback (localhost) plain http", async () => {
      const { app, rawKey } = await makeTestApp();
      const req = makeBootstrapReq("http://localhost:8787/api/auth/local-bootstrap", {}, rawKey);
      const res = await handleLocalBootstrap(req, app);
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).not.toBeNull();
      expect(setCookie).not.toContain("Secure");
    });

    it("does NOT add Secure for loopback 127.0.0.1 plain http", async () => {
      const { app, rawKey } = await makeTestApp();
      const req = makeBootstrapReq("http://127.0.0.1:8787/api/auth/local-bootstrap", {}, rawKey);
      const res = await handleLocalBootstrap(req, app);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).not.toContain("Secure");
    });

    it("does NOT add Secure for loopback ::1 plain http", async () => {
      const { app, rawKey } = await makeTestApp();
      const req = makeBootstrapReq("http://[::1]:8787/api/auth/local-bootstrap", {}, rawKey);
      const res = await handleLocalBootstrap(req, app);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).not.toContain("Secure");
    });

    it("adds Secure for loopback http when X-Forwarded-Proto: https (HTTPS signal wins)", async () => {
      const { app, rawKey } = await makeTestApp();
      const req = makeBootstrapReq(
        "http://localhost:8787/api/auth/local-bootstrap",
        { "X-Forwarded-Proto": "https" },
        rawKey,
      );
      const res = await handleLocalBootstrap(req, app);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("; Secure");
    });

    it("adds Secure for a non-loopback host even with X-Forwarded-Proto: http (non-loopback alone is sufficient)", async () => {
      const { app, rawKey } = await makeTestApp();
      const req = makeBootstrapReq(
        "http://lore.example.com/api/auth/local-bootstrap",
        { "X-Forwarded-Proto": "http" },
        rawKey,
      );
      const res = await handleLocalBootstrap(req, app);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("; Secure");
    });
  });

  describe("regression", () => {
    it("keeps HttpOnly, SameSite=Strict, Path=/api, Max-Age=2592000 regardless of Secure", async () => {
      const { app, rawKey } = await makeTestApp();
      const req = makeBootstrapReq("https://lore.example.com/api/auth/local-bootstrap", {}, rawKey);
      const res = await handleLocalBootstrap(req, app);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Path=/api");
      expect(setCookie).toContain("Max-Age=2592000");
    });
  });
});
