/**
 * AC-DR-10 — the record-edit gate and the correction exit over the HTTP and dashboard surfaces, on a
 * real SQLiteStore in a mkdtemp throwaway corpus (never the repo's own `.lore/`).
 *
 * Spec: spec-documents-are-living-or-records-a-locked-record-is-never (D4, D6, D14, D15).
 * Rules: BR-1048 (refusal on every surface), BR-1049 (correction).
 *
 * Dimensions:
 *   HAPPY       correction on a locked spec through routes.ts PATCH and the dashboard PATCH -> 200, ONE new
 *               version, status kept approved; a draft spec edits normally
 *   NEGATIVE    locked spec content edit through both PATCH routes -> 422 `gate:record-edit`, version
 *               unchanged; dashboard restore of a locked ADR -> refused, version unchanged
 *   BOUNDARY    a dashboard save that resends identical content with a changed tag -> 200, still approved
 *   ERROR       a malformed correction (blank reason / not an object) -> 422 field `correction`
 *   REGRESSION  `correction` never leaks into the stored patch (the version carries it only as change_summary)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { NoOpTelemetry, type DocRecord } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { SessionStore } from "../../../src/adapters/http/sessions.js";
import { startHttpServer } from "../../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../../src/adapters/http/machine-auth.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { AuditService } from "../../../src/service/audit-service.js";
import type { App } from "../../../src/app.js";
import { actedStore, liveIo } from "../../live-invocation.js";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

const FAR_PAST = "2000-01-01T00:00:00.000Z";

interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  store: SQLiteStore;
  bearer: string;
  sessionId: string;
  machineAuth: MachineAuthStores;
  baseUrl: string;
  tmpDir: string;
}

async function makeTestServer(): Promise<TestContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-http-record-lock-"));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const store = actedStore(new SQLiteStore(join(loreDir, "lore.db")));
  const db = store.getDatabase();
  const telemetry = new NoOpTelemetry();
  const recordLock = new RecordLockService(store, new GateEnforcer(undefined));

  const app: App = {
    warn: () => undefined,
    corpusService: new CorpusService(store, recordLock, telemetry),
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, recordLock),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: new ApiKeyStore(db),
    sessionStore: new SessionStore(db),
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(store, telemetry),
    auditService: new AuditService(store),
    auditVerifyRunner: inLoopAuditVerifyRunner(new AuditService(store)),
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry,
    close: () => {
      store.close();
    },
  };

  const bearerResult = await app.apiKeyStore.create("record-lock-test", "admin");
  if (!bearerResult.ok) throw new Error("failed to create bearer key");

  // The cookie-bootstrap flow mints "dashboard-local" on the MACHINE-scope store (SPEC-078 D1) — a
  // mkdtemp base dir, never the real XDG state path.
  const machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-record-lock-machine-auth-")) });
  const dashboardKey = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
  if (!dashboardKey.ok) throw new Error("failed to create dashboard key");

  const server = startHttpServer(app, {
    io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  const bootstrap = await fetch(`${baseUrl}/api/auth/local-bootstrap`, {
    method: "POST",
    headers: { "X-Lore-Token": dashboardKey.value.rawKey, Origin: "http://localhost:5173" },
  });
  const { data } = (await bootstrap.json()) as { data: { session_id: string } };

  return { server, app, store, bearer: bearerResult.value.rawKey, sessionId: data.session_id, machineAuth, baseUrl, tmpDir };
}

/** Status write plus the version row that records it — the two facts the lock reads — without approval gates. */
async function forceApproved(store: SQLiteStore, doc: DocRecord): Promise<DocRecord> {
  const current = await store.find(doc.id);
  if (!current.ok || current.value === null) throw new Error("fixture doc vanished");
  const nextVersion = current.value.version + 1;
  const updated = await store.update(doc.id, { status: "approved", version: nextVersion }, { expected_version: current.value.version });
  if (!updated.ok) throw new Error(`forceApproved failed: ${JSON.stringify(updated.error)}`);
  const inserted = await store.insertVersion({
    doc_id: doc.id,
    version: nextVersion,
    content: updated.value.content,
    extra: updated.value.extra,
    status: "approved",
    title: updated.value.title,
    action: "update",
    created_at: new Date().toISOString(),
    created_by: "tester",
    slug: updated.value.slug,
  });
  if (!inserted.ok) throw new Error("insertVersion failed");
  return updated.value;
}

async function lockedSpec(ctx: TestContext): Promise<DocRecord> {
  const created = await ctx.app.corpusService.create({ type: "spec", title: "Locked spec", content: "original body" });
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  return forceApproved(ctx.store, created.value);
}

async function lockedAdr(ctx: TestContext): Promise<DocRecord> {
  const created = await ctx.app.corpusService.create({
    type: "adr",
    title: "Locked ADR",
    content: "decision v1",
    extra: { decision_status: "proposed" },
  });
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  const edited = await ctx.app.corpusService.set(created.value.id, { content: "decision v2" });
  if (!edited.ok) throw new Error("fixture edit failed");
  return forceApproved(ctx.store, edited.value);
}

async function versionCount(ctx: TestContext, docId: string): Promise<number> {
  const versions = await ctx.store.findVersions(docId as DocRecord["id"], { limit: 1000 });
  if (!versions.ok) throw new Error("findVersions failed");
  return versions.value.length;
}

interface ErrorEnvelope {
  ok: false;
  error: { code: string; field?: string; message?: string };
}

function patchRoute(ctx: TestContext, slug: string, body: unknown): Promise<Response> {
  return fetch(`${ctx.baseUrl}/api/docs/${slug}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ctx.bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchDashboard(ctx: TestContext, id: string, body: unknown): Promise<Response> {
  return fetch(`${ctx.baseUrl}/api/dashboard/docs/${id}`, {
    method: "PATCH",
    headers: { Cookie: `lore_sid=${ctx.sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("record-edit gate over HTTP and the dashboard (AC-DR-10)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer();
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    ctx.machineAuth.db.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  describe("NEGATIVE — a locked record is refused with gate:record-edit", () => {
    it("PATCH /api/docs/:slug with new content -> 422, version unchanged", async () => {
      const spec = await lockedSpec(ctx);
      const before = await versionCount(ctx, spec.id);

      const res = await patchRoute(ctx, spec.slug, { content: "rewritten over HTTP" });

      expect(res.status).toBe(422);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error.field).toBe("gate:record-edit");
      expect(await versionCount(ctx, spec.id)).toBe(before);
    });

    it("PATCH /api/dashboard/docs/:id with new content -> 422, version unchanged", async () => {
      const spec = await lockedSpec(ctx);
      const before = await versionCount(ctx, spec.id);

      const res = await patchDashboard(ctx, spec.id, { content: "rewritten from the dashboard" });

      expect(res.status).toBe(422);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error.field).toBe("gate:record-edit");
      expect(await versionCount(ctx, spec.id)).toBe(before);
    });

    it("POST /api/dashboard/docs/:id/restore on a locked ADR -> refused, no version written", async () => {
      const adr = await lockedAdr(ctx);
      const before = await versionCount(ctx, adr.id);

      const res = await fetch(`${ctx.baseUrl}/api/dashboard/docs/${adr.id}/restore?confirm=true`, {
        method: "POST",
        headers: { Cookie: `lore_sid=${ctx.sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1 }),
      });

      expect(res.status).toBe(422);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error.field).toBe("gate:record-edit");
      expect(await versionCount(ctx, adr.id)).toBe(before);
    });

    it("POST /api/docs/:slug/restore on a locked ADR -> refused too", async () => {
      const adr = await lockedAdr(ctx);

      const res = await fetch(`${ctx.baseUrl}/api/docs/${adr.slug}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1 }),
      });

      expect(res.status).toBe(422);
    });
  });

  describe("HAPPY — the correction exit", () => {
    it("PATCH /api/docs/:slug with correction.reason -> 200, one new version, status kept", async () => {
      const spec = await lockedSpec(ctx);
      const before = await versionCount(ctx, spec.id);

      const res = await patchRoute(ctx, spec.slug, { content: "original body, typo fixed", correction: { reason: "typo" } });

      expect(res.status).toBe(200);
      expect(await versionCount(ctx, spec.id)).toBe(before + 1);
      const stored = await ctx.store.find(spec.id);
      expect(stored.ok && stored.value?.status).toBe("approved");
      expect(stored.ok && stored.value?.content).toContain("typo fixed");
      const versions = await ctx.store.findVersions(spec.id, { limit: 1 });
      expect(versions.ok && versions.value[0]?.change_summary).toContain("typo");
    });

    it("PATCH /api/dashboard/docs/:id with correction.reason -> 200, one new version, status kept", async () => {
      const spec = await lockedSpec(ctx);
      const before = await versionCount(ctx, spec.id);

      const res = await patchDashboard(ctx, spec.id, { content: "original body, typo fixed", correction: { reason: "typo" } });

      expect(res.status).toBe(200);
      expect(await versionCount(ctx, spec.id)).toBe(before + 1);
      const stored = await ctx.store.find(spec.id);
      expect(stored.ok && stored.value?.status).toBe("approved");
    });

    it("a draft spec edits normally over HTTP with no correction", async () => {
      const created = await ctx.app.corpusService.create({ type: "spec", title: "Draft spec", content: "v1" });
      if (!created.ok) throw new Error("create failed");

      const res = await patchRoute(ctx, created.value.slug, { content: "v2" });

      expect(res.status).toBe(200);
    });
  });

  describe("BOUNDARY — a save that changes nothing the lock protects", () => {
    it("dashboard save resending identical content with a changed tag -> 200 and the spec stays approved", async () => {
      const spec = await lockedSpec(ctx);

      const res = await patchDashboard(ctx, spec.id, { content: spec.content, tags: ["reviewed"] });

      expect(res.status).toBe(200);
      const stored = await ctx.store.find(spec.id);
      expect(stored.ok && stored.value?.tags).toEqual(["reviewed"]);
      expect(stored.ok && stored.value?.status).toBe("approved");
    });
  });

  describe("ERROR — a malformed correction is rejected before any write", () => {
    it("blank reason -> 422 field correction, version unchanged", async () => {
      const spec = await lockedSpec(ctx);
      const before = await versionCount(ctx, spec.id);

      const res = await patchRoute(ctx, spec.slug, { content: "fixed", correction: { reason: "   " } });

      expect(res.status).toBe(422);
      expect(((await res.json()) as ErrorEnvelope).error.field).toBe("correction");
      expect(await versionCount(ctx, spec.id)).toBe(before);
    });

    it("a non-object correction on the dashboard -> 422 field correction", async () => {
      const spec = await lockedSpec(ctx);

      const res = await patchDashboard(ctx, spec.id, { content: "fixed", correction: "typo" });

      expect(res.status).toBe(422);
      expect(((await res.json()) as ErrorEnvelope).error.field).toBe("correction");
    });
  });
});
