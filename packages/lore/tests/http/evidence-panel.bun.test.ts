/**
 * End-to-end tests for GET /api/evidence-panel/:idOrSlug against a real
 * in-process Bun.Server backed by a REAL SQLiteStore (via `createApp`, the
 * actual production composition root — SPEC-075 D8: avoids InMemoryStore-vs-
 * production divergence and keeps bun:sqlite reachability confined to
 * `.bun.test.ts` files). Mirrors `ready-route.bun.test.ts`'s stated division
 * of labor: deep per-doc_type assembly coverage lives in
 * `verification-projection-service.test.ts`'s vitest suite (AC-075-2/3) — this
 * file focuses on the auth boundary (AC-075-9) plus one end-to-end wiring
 * smoke check per doc_type through the REAL HTTP route.
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - AC-075-9: bearer token → 200 (task doc_type)
 *     - AC-075-9: cookie session → 200 (task doc_type)
 *     - wiring smoke: spec doc_type → 200; plan doc_type → 200
 *   NEGATIVE:
 *     - AC-075-9: no auth → 401
 *   ERROR:
 *     - unknown id → 404 DOC_NOT_FOUND
 *
 * @spec_ref AC-075-9
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startHttpServer } from "../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../src/adapters/http/machine-auth.js";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import type { CreateDocInput } from "@lore/core";

interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  rawKey: string;
  // reason: SPEC-078 D1 — the cookie-bootstrap flow (bootstrapCookie below) mints
  // "dashboard-local" on this MACHINE-scope store, never the per-corpus app.apiKeyStore.
  machineAuth: MachineAuthStores;
  machineRawKey: string;
  baseUrl: string;
  tmpDir: string;
  taskId: string;
  specId: string;
  planId: string;
}

async function makeTestServer(): Promise<TestContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-evidence-panel-"));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  const dbPath = join(tmpDir, ".lore", "lore.db");

  // reason: createApp(dbPath) with NO config is the real production composition
  // root's simplest overload — SQLiteStore, NoOpTelemetry, every service
  // (including verificationProjectionService) wired exactly as `lore serve`
  // wires it. No hand-built App stub for this test (SPEC-075 D8).
  const app = createApp(dbPath);

  // reason: SPEC-078 D1 — this key is used ONLY for the bearer-token tests below;
  // "dashboard-local" for the cookie-bootstrap regression test lives on machineAuth.
  const createResult = await app.apiKeyStore.create("regression-agent", "owner");
  if (!createResult.ok) throw new Error("Failed to create API key");
  const rawKey = createResult.value.rawKey;

  const machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-evidence-panel-machine-auth-")) });
  const machineKeyResult = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
  if (!machineKeyResult.ok) throw new Error("Failed to create machine API key");

  const prdResult = await app.corpusService.create({ type: "prd", title: "Evidence Panel Root PRD", content: "root" });
  if (!prdResult.ok) throw new Error("Failed to create seed prd");

  const specResult = await app.corpusService.create({
    type: "spec",
    title: "Evidence Panel Spec",
    parent_id: prdResult.value.id,
    content: "## Spec",
    extra: {
      acceptance_criteria: [
        { id: "AC-1", statement: "does the thing", verify: { mode: "script", oracle: "test", command: "bun test" } },
      ],
    },
  } as CreateDocInput);
  if (!specResult.ok) throw new Error("Failed to create seed spec");

  const planResult = await app.corpusService.create({
    type: "plan",
    title: "Evidence Panel Plan",
    parent_id: specResult.value.id,
    content: "## Plan",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("Failed to create seed plan");

  const taskResult = await app.corpusService.create({
    type: "task",
    title: "Evidence Panel Task",
    parent_id: planResult.value.id,
    content: "## Task",
    extra: {
      plan_id: planResult.value.id,
      // reason: spec-declaring-ac-scope-is-required-at-task-creation-so-the —
      // this plan's spec declares a script-mode AC (AC-1), so task-create's
      // admission gate now requires ac_scope to be declared. Matches the
      // evidence entry's own ac_ref below.
      ac_scope: ["AC-1"],
      verification_evidence: [
        {
          oracle: "test",
          command: "bun test",
          result: "pass",
          recorded_at: "2026-07-24T00:00:00.000Z",
          recorded_by: "agent:t",
          ac_ref: "AC-1",
        },
      ],
    },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("Failed to create seed task");

  const server = startHttpServer(app, { port: 0, host: "127.0.0.1", machineAuth });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  return {
    server,
    app,
    rawKey,
    machineAuth,
    machineRawKey: machineKeyResult.value.rawKey,
    baseUrl,
    tmpDir,
    taskId: taskResult.value.id,
    specId: specResult.value.id,
    planId: planResult.value.id,
  };
}

async function bootstrapCookie(ctx: TestContext): Promise<string> {
  const res = await fetch(`${ctx.baseUrl}/api/auth/local-bootstrap`, {
    method: "POST",
    // reason: SPEC-078 D1 — bootstrap validates against the MACHINE-scope
    // "dashboard-local" key, not the bearer-only ctx.rawKey.
    headers: { "X-Lore-Token": ctx.machineRawKey, Origin: "http://localhost:5173" },
  });
  const { data } = (await res.json()) as { data: { session_id: string } };
  return data.session_id;
}

describe("GET /api/evidence-panel/:idOrSlug (SPEC-075 §Module Boundary)", () => {
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

  describe("HAPPY — auth duality (AC-075-9)", () => {
    it("AC-075-9: bearer token → 200 with the task's evidence panel projection", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/evidence-panel/${ctx.taskId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data: { doc_type: string; evidence: unknown[]; ac_refs: string[] } };
      expect(body.ok).toBe(true);
      expect(body.data.doc_type).toBe("task");
      expect(body.data.evidence).toHaveLength(1);
      expect(body.data.ac_refs).toEqual(["AC-1"]);
    });

    it("AC-075-9: cookie session → 200 with the task's evidence panel projection", async () => {
      const sessionId = await bootstrapCookie(ctx);
      const res = await fetch(`${ctx.baseUrl}/api/evidence-panel/${ctx.taskId}`, {
        headers: { Cookie: `lore_sid=${sessionId}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data: { doc_type: string } };
      expect(body.ok).toBe(true);
      expect(body.data.doc_type).toBe("task");
    });
  });

  describe("wiring smoke — spec/plan doc_types through the real SQLiteStore path", () => {
    it("GET .../:specId → 200 with an aggregated AC coverage projection", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/evidence-panel/${ctx.specId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { doc_type: string; task_count: number; coverage: Array<{ ac_id: string; pass: number }> };
      };
      expect(body.data.doc_type).toBe("spec");
      expect(body.data.task_count).toBe(1);
      expect(body.data.coverage.find((f) => f.ac_id === "AC-1")?.pass).toBe(1);
    });

    it("GET .../:planId → 200 with a plan attestation summary", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/evidence-panel/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { doc_type: string; attestation: { total_evidence: number; ratio: number | null } };
      };
      expect(body.data.doc_type).toBe("plan");
      expect(body.data.attestation.total_evidence).toBe(1);
      expect(body.data.attestation.ratio).toBe(0);
    });
  });

  describe("NEGATIVE (AC-075-9): unauthenticated → 401", () => {
    it("AC-075-9: no auth header at all → 401", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/evidence-panel/${ctx.taskId}`);
      expect(res.status).toBe(401);
    });
  });

  describe("ERROR: unknown id → 404", () => {
    it("an unresolvable id/slug → 404 DOC_NOT_FOUND", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/evidence-panel/does-not-exist-at-all`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("DOC_NOT_FOUND");
    });
  });
});
