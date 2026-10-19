/**
 * End-to-end tests for GET /api/ready/:planIdOrSlug against a real in-process
 * Bun.Server (mirrors `feedback-loop-routes.bun.test.ts`'s `makeTestServer`
 * pattern — `handleApiRoute` unit tests in `routes.test.ts` call the dispatcher
 * directly with a pre-authenticated `ActorContext`, which cannot exercise the
 * REAL `authenticateRequest` 401 gate in `index.ts`; this file can).
 *
 * Test plan (6-dimension; deep per-scenario HAPPY/NEGATIVE/ERROR coverage
 * lives in routes.test.ts's unit tests — this file focuses on the auth
 * boundary + one end-to-end smoke check to prove real wiring through
 * `index.ts`):
 *   HAPPY:
 *     - GET /api/ready/:planId with valid bearer token → 200 with ReadyRecord[]
 *   NEGATIVE:
 *     - GET /api/ready/:planId with no auth → 401
 *   REGRESSION:
 *     - A cookie session (not just bearer) also reaches this route (auth
 *       duality — same as every other v1 GET route).
 *
 * @spec_ref SPEC-037 D1, AC-37-1
 */

import { RecordLockService } from "../../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../../src/service/gate-enforcer.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiKeyStore } from "../../../../src/adapters/http/auth.js";
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
import { JudgmentService } from "../../../../src/service/judgment-service.js";
import { AuditService } from "../../../../src/service/audit-service.js";
import { TaskWorkflowService } from "../../../../src/service/task-workflow-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { MIGRATION_002_SQL } from "../../../../src/store/migrations/migration-002.js";
import type { App } from "../../../../src/app.js";
import { actedStore, liveIo } from "../../../live-invocation.js";
import { inLoopAuditVerifyRunner } from "../../../support/audit-verify-runner-stub.js";

const FAR_PAST = "2000-01-01T00:00:00.000Z";

// ─── Setup ────────────────────────────────────────────────────────────────────

interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  db: Database;
  rawKey: string;
  // reason: SPEC-078 D1 — machine-scope auth store; the cookie-session regression test
  // below mints "dashboard-local" here (not on the per-corpus apiKeyStore above).
  machineAuth: MachineAuthStores;
  machineRawKey: string;
  baseUrl: string;
  planId: string;
  planSlug: string;
}

async function makeTestServer(): Promise<TestContext> {
  const db = new Database(":memory:");
  db.exec(MIGRATION_002_SQL);

  const apiKeyStore = new ApiKeyStore(db);
  const sessionStore = new SessionStore(db);
  const docStore = actedStore(new InMemoryStore());

  const app: App = {
    warn: () => undefined,
    corpusService: new CorpusService(docStore, new RecordLockService(docStore, new GateEnforcer(undefined))),
    reviewService: new ReviewService(docStore, new RecordLockService(docStore, new GateEnforcer(undefined))),
    versionService: new VersionService(docStore, new RecordLockService(docStore, new GateEnforcer(undefined))),
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
    // reason: SPEC-037 D1 — GET /api/ready/:planIdOrSlug exercises this directly.
    taskWorkflowService: new TaskWorkflowService(docStore, new NoOpTelemetry(), { claimTtlMinutes: 120 }),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(docStore, new NoOpTelemetry()),
    auditService: new AuditService(docStore, { verifySince: FAR_PAST }),
    auditVerifyRunner: inLoopAuditVerifyRunner(new AuditService(docStore, { verifySince: FAR_PAST })),
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => db.close(),
  };

  // reason: SPEC-078 D1 — this key is used ONLY for the bearer-token happy path below;
  // "dashboard-local" for the cookie-bootstrap regression test lives on machineAuth.
  const createResult = await apiKeyStore.create("regression-agent", "owner");
  if (!createResult.ok) throw new Error("Failed to create API key");
  const rawKey = createResult.value.rawKey;

  const machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-ready-route-test-")) });
  const machineKeyResult = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
  if (!machineKeyResult.ok) throw new Error("Failed to create machine API key");

  const planResult = await app.corpusService.create({ type: "plan", title: "Ready Route Plan", content: "body" });
  if (!planResult.ok) throw new Error("Failed to create seed plan");

  const taskResult = await app.corpusService.create({
    type: "task",
    title: "Ready Route Task",
    parent_id: planResult.value.id,
    content: "body",
    extra: { plan_id: planResult.value.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("Failed to create seed task");

  // Port 0 → OS assigns a free port
  const server = startHttpServer(app, {
    io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  return {
    server,
    app,
    db,
    rawKey,
    machineAuth,
    machineRawKey: machineKeyResult.value.rawKey,
    baseUrl,
    planId: planResult.value.id,
    planSlug: planResult.value.slug,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("GET /api/ready/:planIdOrSlug — auth boundary + wiring smoke (SPEC-037 D1)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer();
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    ctx.machineAuth.db.close();
  });

  describe("happy path — valid bearer token", () => {
    // reason: SPEC-042 D7 — TaskWorkflowService.ready's return shape gained
    // `sessions[]`/`anchor_conflicts[]` alongside the pre-existing flat
    // records array (now `.records`); `handleGetReady` (routes.ts) is an
    // unmodified thin pipe (`jsonOk(result.value)`), so this is a mechanical
    // shape update, not a design decision about the HTTP route itself.
    it("GET /api/ready/:planId → 200 with a one-entry ReadyReport.records", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/ready/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        data: { records: Array<{ ready: boolean }>; sessions: unknown[]; anchor_conflicts: unknown[] };
      };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.records)).toBe(true);
      expect(body.data.records).toHaveLength(1);
    });

    // reason: SPEC-077 S4 — the response gains a top-level `claim_ttl_minutes`
    // equal to the resolved `workflow.claim_ttl_minutes` value the test's
    // `TaskWorkflowService` was constructed with (120, see `makeTestServer`
    // above) — HTTP-layer enrichment only, core `ReadyReport` stays untouched.
    it("AC-077-4: GET /api/ready/:planId → 200 with top-level claim_ttl_minutes equal to the resolved config value", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/ready/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data: { claim_ttl_minutes: number } };
      expect(body.ok).toBe(true);
      expect(body.data.claim_ttl_minutes).toBe(120);
    });
  });

  describe("negative — no auth → 401", () => {
    it("GET /api/ready/:planId with no auth → 401", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/ready/${ctx.planId}`);
      expect(res.status).toBe(401);
    });
  });

  describe("regression — cookie session also reaches this route (auth duality)", () => {
    it("GET /api/ready/:planId with a valid cookie session → 200", async () => {
      const bootstrapRes = await fetch(`${ctx.baseUrl}/api/auth/local-bootstrap`, {
        method: "POST",
        // reason: SPEC-078 D1 — bootstrap validates against the MACHINE-scope
        // "dashboard-local" key, not the bearer-only ctx.rawKey above.
        headers: { "X-Lore-Token": ctx.machineRawKey, Origin: "http://localhost:5173" },
      });
      const { data: { session_id } } = await bootstrapRes.json() as { data: { session_id: string } };

      const res = await fetch(`${ctx.baseUrl}/api/ready/${ctx.planSlug}`, {
        headers: { Cookie: `lore_sid=${session_id}` },
      });
      expect(res.status).toBe(200);
    });
  });
});
