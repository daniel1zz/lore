/**
 * End-to-end tests for the SPEC-033 F1 feedback-loop read routes against a real
 * in-process Bun.Server (mirrors `auth-routes.bun.test.ts`'s `makeTestServer`
 * pattern — `handleApiRoute` unit tests in `routes.test.ts` call the dispatcher
 * directly with a pre-authenticated `ActorContext`, which cannot exercise the
 * REAL `authenticateRequest` 401 gate in `index.ts`; this file can).
 *
 * Test plan (6-dimension; the deep per-route HAPPY-path coverage lives in
 * routes.test.ts's unit tests — this file focuses on the auth boundary + one
 * end-to-end smoke check per route to prove real wiring through `index.ts`):
 *   HAPPY:
 *     - GET /api/judgments/:docId with valid bearer token → 200
 *     - GET /api/audit/:docId with valid bearer token → 200
 *     - GET /api/audit/verify with valid bearer token → 200
 *     - GET /api/calibration/stats with valid bearer token → 200
 *   NEGATIVE:
 *     - GET /api/judgments/:docId with no auth → 401
 *     - GET /api/audit/:docId with no auth → 401
 *     - GET /api/audit/verify with no auth → 401
 *     - GET /api/calibration/stats with no auth → 401
 *   REGRESSION:
 *     - A cookie session (not just bearer) also reaches these routes (auth
 *       duality — same as every other v1 GET route, unlike the cookie-only
 *       /api/dashboard/* write surface).
 *
 * @spec_ref SPEC-033 F1
 */

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
import { JudgmentService } from "../../../../src/service/judgment-service.js";
import { AuditService } from "../../../../src/service/audit-service.js";
import { NoOpTelemetry } from "@lore/core";
import { MIGRATION_002_SQL } from "../../../../src/store/migrations/migration-002.js";
import type { App } from "../../../../src/app.js";

const FAR_PAST = "2000-01-01T00:00:00.000Z";

// ─── Setup ────────────────────────────────────────────────────────────────────

interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  db: Database;
  docStore: InMemoryStore;
  rawKey: string;
  baseUrl: string;
  docId: string;
}

async function makeTestServer(): Promise<TestContext> {
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
    // reason: this file never exercises the AI path; null-cast avoids heavyweight
    // AIProviderService construction while satisfying the now-required field (SPEC-017 §3.12).
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(docStore, new NoOpTelemetry()),
    auditService: new AuditService(docStore, { verifySince: FAR_PAST }),
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => db.close(),
  };

  const createResult = await apiKeyStore.create("dashboard-local", "admin");
  if (!createResult.ok) throw new Error("Failed to create API key");
  const rawKey = createResult.value.rawKey;

  const docResult = await app.corpusService.create({ type: "prd", title: "Feedback Loop Doc" });
  if (!docResult.ok) throw new Error("Failed to create seed doc");

  // Port 0 → OS assigns a free port
  const server = startHttpServer(app, { port: 0, host: "127.0.0.1" });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  return { server, app, db, docStore, rawKey, baseUrl, docId: docResult.value.id };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("SPEC-033 F1 feedback-loop read routes — auth boundary + wiring smoke", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer();
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
  });

  describe("happy path — valid bearer token", () => {
    it("GET /api/judgments/:docId → 200 with { latest, history }", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/judgments/${ctx.docId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { latest: unknown; history: unknown[] } };
      expect(body.ok).toBe(true);
      expect(body.data.latest).toBeNull();
      expect(body.data.history).toEqual([]);
    });

    it("GET /api/audit/:docId → 200 with the doc's audit entries", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/audit/${ctx.docId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: Array<Record<string, unknown>> };
      expect(body.ok).toBe(true);
      expect(body.data.some((e) => e.action === "create")).toBe(true);
    });

    it("GET /api/audit/verify → 200 with { clean, misses, since }", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/audit/verify`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: { clean: boolean; misses: unknown[] } };
      expect(body.ok).toBe(true);
      expect(body.data.clean).toBe(true);
      expect(body.data.misses).toEqual([]);
    });

    it("GET /api/calibration/stats → 200 with an array", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/calibration/stats`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: unknown[] };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe("negative — no auth → 401", () => {
    it("GET /api/judgments/:docId with no auth → 401", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/judgments/${ctx.docId}`);
      expect(res.status).toBe(401);
    });

    it("GET /api/audit/:docId with no auth → 401", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/audit/${ctx.docId}`);
      expect(res.status).toBe(401);
    });

    it("GET /api/audit/verify with no auth → 401", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/audit/verify`);
      expect(res.status).toBe(401);
    });

    it("GET /api/calibration/stats with no auth → 401", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/calibration/stats`);
      expect(res.status).toBe(401);
    });
  });

  describe("regression — cookie session also reaches these routes (auth duality)", () => {
    it("GET /api/judgments/:docId with a valid cookie session → 200", async () => {
      const bootstrapRes = await fetch(`${ctx.baseUrl}/api/auth/local-bootstrap`, {
        method: "POST",
        headers: { "X-Lore-Token": ctx.rawKey, Origin: "http://localhost:5173" },
      });
      const { data: { session_id } } = await bootstrapRes.json() as { data: { session_id: string } };

      const res = await fetch(`${ctx.baseUrl}/api/judgments/${ctx.docId}`, {
        headers: { Cookie: `lore_sid=${session_id}` },
      });
      expect(res.status).toBe(200);
    });
  });
});
