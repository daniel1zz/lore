/**
 * End-to-end tests for POST /api/auth/local-bootstrap against a real in-process
 * `startHttpServer` configured with a NON-DEFAULT Origin allowlist.
 * Source: task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173 — with
 * `--dashboard-port P` (or Vite auto-increment off a held 5173), the SPA's bootstrap POST
 * comes from `http://localhost:P`, which the pre-fix hardcoded ALLOWED_ORIGINS constant
 * always rejected (403, cookie never minted, dashboard fully unauthenticated). This suite
 * exercises the fix at the SERVER-CONFIG level (`HttpConfig.allowedOrigins`, threaded from
 * `auth.ts::buildAllowedOrigins`) — the same wiring `lore dashboard` uses in production —
 * not just the pure builder function (see allowed-origins.test.ts for that).
 *
 * `machineAuth` is explicitly injected with an `mkdtemp` base dir (never the real XDG
 * state path) per root CLAUDE.md's 2026-07-07 pollution-incident rule and this task's own
 * "don't touch the machine auth store" constraint.
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - bootstrap POST with Origin http://localhost:6000 succeeds (200 + Set-Cookie) when
 *       the server is configured with allowedOrigins = buildAllowedOrigins(9000, 6000)
 *       (AC 2's primary case)
 *     - the 127.0.0.1:6000 variant also succeeds (same allowlist entry)
 *
 *   NEGATIVE:
 *     - Origin http://evil.example still 403, even with a custom allowlist configured
 *       (AC 2's negative control)
 *     - Origin http://localhost:5173 (the OLD default) is now REJECTED once the server is
 *       configured for a different dashPort — proves the allowlist is actually swapped,
 *       not just additively widened
 *
 *   BOUNDARY:
 *     - a bootstrap request with NO Origin header still 403s (empty-string fallback in
 *       handleLocalBootstrap never accidentally matches an allowedOrigins entry)
 *
 *   ERROR:
 *     - n/a — no IO failure path exercises Origin checking differently
 *
 *   STATE:
 *     - n/a — Origin allowlist is resolved once at server-start, not persisted/mutated
 *
 *   REGRESSION:
 *     - omitting `allowedOrigins` from HttpConfig entirely → default-port behavior
 *       byte-identical to pre-fix (Origin http://localhost:5173 → 200, evil.example → 403)
 *
 * @spec_ref task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173 AC-1, AC-2
 */

import { RecordLockService } from "../../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../../src/service/gate-enforcer.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiKeyStore, buildAllowedOrigins } from "../../../../src/adapters/http/auth.js";
import { SessionStore } from "../../../../src/adapters/http/sessions.js";
import { startHttpServer } from "../../../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../../../src/adapters/http/machine-auth.js";
import { InMemoryStore } from "../../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../../src/service/corpus-service.js";
import { ReviewService } from "../../../../src/service/review-service.js";
import { VersionService } from "../../../../src/service/version-service.js";
import { OutlineService } from "../../../../src/service/outline-service.js";
import { MigrationService } from "../../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../../src/service/tree-check-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../../src/app.js";
import { actedStore, liveIo } from "../../../live-invocation.js";
import { inLoopAuditVerifyRunner } from "../../../support/audit-verify-runner-stub.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  db: Database;
  machineAuth: MachineAuthStores;
  machineAuthTmpDir: string;
  rawKey: string;
  baseUrl: string;
}

/**
 * Builds a real in-process server. `allowedOrigins` is threaded verbatim into
 * `startHttpServer`'s `HttpConfig`; omitting it exercises the REGRESSION default path.
 */
async function makeTestServer(allowedOrigins?: readonly string[]): Promise<TestContext> {
  const db = new Database(":memory:");
  const docStore = actedStore(new InMemoryStore());

  // reason: machineAuth is now the SOLE backer of cookie sessions + the bootstrap key
  // (SPEC-078 D1) — an mkdtemp baseDir keeps this test off the real XDG state path.
  const machineAuthTmpDir = mkdtempSync(join(tmpdir(), "lore-bootstrap-allowlist-test-"));
  const machineAuth = createMachineAuthStores({ baseDir: machineAuthTmpDir });

  const app: App = {
    warn: () => undefined,
    corpusService: new CorpusService(docStore, new RecordLockService(docStore, new GateEnforcer(undefined))),
    reviewService: new ReviewService(docStore, new RecordLockService(docStore, new GateEnforcer(undefined))),
    versionService: new VersionService(docStore, new RecordLockService(docStore, new GateEnforcer(undefined))),
    outlineService: new OutlineService(docStore),
    migrationService: new MigrationService(docStore),
    treeCheckService: new TreeCheckService(docStore),
    // reason: bearer-token auth is untouched by this suite (bootstrap only touches
    // machineAuth.apiKeyStore) — a throwaway in-memory ApiKeyStore/SessionStore pair
    // satisfies App's required shape without ever being exercised.
    apiKeyStore: new ApiKeyStore(db),
    sessionStore: new SessionStore(db),
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => db.close(),
  };

  const createResult = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
  if (!createResult.ok) throw new Error("Failed to create local bootstrap API key");
  const rawKey = createResult.value.rawKey;

  // Port 0 → OS assigns a free port. `machineAuth` injected explicitly so the lazy
  // XDG-path resolution in index.ts is never triggered.
  const server = startHttpServer(app, {
    io: liveIo(),
    port: 0,
    host: "127.0.0.1",
    machineAuth,
    ...(allowedOrigins !== undefined ? { allowedOrigins } : {}),
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  return { server, app, db, machineAuth, machineAuthTmpDir, rawKey, baseUrl };
}

function postBootstrap(baseUrl: string, origin: string | undefined, rawKey: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/local-bootstrap`, {
    method: "POST",
    headers: {
      "X-Lore-Token": rawKey,
      ...(origin !== undefined ? { Origin: origin } : {}),
    },
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("POST /api/auth/local-bootstrap — server-configured Origin allowlist", () => {
  let ctx: TestContext;

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    ctx.machineAuth.db.close();
    rmSync(ctx.machineAuthTmpDir, { recursive: true, force: true });
  });

  describe("happy path (AC-2)", () => {
    beforeEach(async () => {
      ctx = await makeTestServer(buildAllowedOrigins(9000, 6000));
    });

    it("succeeds for Origin http://localhost:6000 when configured for dashPort 6000", async () => {
      const res = await postBootstrap(ctx.baseUrl, "http://localhost:6000", ctx.rawKey);
      expect(res.status).toBe(200);
      expect(res.headers.get("Set-Cookie")).not.toBeNull();
    });

    it("succeeds for Origin http://127.0.0.1:6000 (the 127.0.0.1 variant of the same dashPort)", async () => {
      const res = await postBootstrap(ctx.baseUrl, "http://127.0.0.1:6000", ctx.rawKey);
      expect(res.status).toBe(200);
    });
  });

  describe("negative cases (AC-2)", () => {
    beforeEach(async () => {
      ctx = await makeTestServer(buildAllowedOrigins(9000, 6000));
    });

    it("still 403s for a genuinely foreign Origin (negative control)", async () => {
      const res = await postBootstrap(ctx.baseUrl, "http://evil.example", ctx.rawKey);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { ok: boolean; error: { field: string } };
      expect(body.ok).toBe(false);
      expect(body.error.field).toBe("Origin");
    });

    it("rejects the OLD default port 5173 once the server is configured for a different dashPort", async () => {
      const res = await postBootstrap(ctx.baseUrl, "http://localhost:5173", ctx.rawKey);
      expect(res.status).toBe(403);
    });
  });

  describe("boundary values", () => {
    beforeEach(async () => {
      ctx = await makeTestServer(buildAllowedOrigins(9000, 6000));
    });

    it("403s when no Origin header is sent at all", async () => {
      const res = await postBootstrap(ctx.baseUrl, undefined, ctx.rawKey);
      expect(res.status).toBe(403);
    });
  });

  describe("regression", () => {
    beforeEach(async () => {
      // No allowedOrigins passed → HttpConfig falls back to the default ALLOWED_ORIGINS.
      ctx = await makeTestServer();
    });

    it("default config: Origin http://localhost:5173 still succeeds (byte-identical to pre-fix)", async () => {
      const res = await postBootstrap(ctx.baseUrl, "http://localhost:5173", ctx.rawKey);
      expect(res.status).toBe(200);
    });

    it("default config: Origin http://evil.example still 403s (byte-identical to pre-fix)", async () => {
      const res = await postBootstrap(ctx.baseUrl, "http://evil.example", ctx.rawKey);
      expect(res.status).toBe(403);
    });
  });
});
