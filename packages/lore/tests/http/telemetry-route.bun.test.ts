/**
 * End-to-end tests for POST /api/dashboard/telemetry/route-view against a real
 * in-process Bun.Server backed by a REAL SQLiteStore (via `createApp` — SPEC-075
 * D8, avoids InMemoryStore-vs-production divergence). Covers the D4/D8 injectable-
 * telemetry seam directly: `handleDashboardRouteViewTelemetry`'s `telemetry`
 * parameter is production-wired from `app.telemetry`, and `App.telemetry` is a
 * plain mutable field — a test substitutes it post-`createApp()` to reach the
 * sink-failure branch, exactly mirroring `emitDashboardTelemetry`'s existing
 * `app`-based injectable shape (module header of `dashboard-routes.ts`).
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - AC-075-8: telemetry ENABLED (real JsonlTelemetry over an mkdtemp path) →
 *       exactly one JSONL line, shape {service:"dashboard", method:"route_view",
 *       ok:true, duration_ms:0, source:"dashboard", meta:{route_id, doc_type}}
 *   NEGATIVE:
 *     - AC-075-9: bearer-token actor → 403 (cookie-only dashboard write surface)
 *     - AC-075-9: valid cookie but a disallowed Origin → 403 (CSRF guard)
 *     - malformed body (route_id missing) → 422 VALIDATION_ERROR
 *   BOUNDARY:
 *     - route_id at exactly the 200-char cap → 204 (accepted); 201 chars → 422
 *   STATE:
 *     - telemetry DISABLED (NoOpTelemetry) → the configured sink file is NEVER
 *       created — zero sink writes, proven by filesystem absence, not just a
 *       200-ish response
 *   ERROR:
 *     - AC-075-8: a THROWING telemetry double (injected via the D8 seam) still
 *       returns 204 with NO user-visible error body, and emits EXACTLY ONE
 *       server-side `console.error` line (the documented fail-quiet exception)
 *
 * @spec_ref AC-075-8 AC-075-9
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startHttpServer } from "../../src/adapters/http/index.js";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import type { LoreConfig, Telemetry, TelemetryEvent } from "@lore/core";

interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  rawKey: string;
  baseUrl: string;
  tmpDir: string;
  telemetryPath: string;
}

const ALLOWED_ORIGIN = "http://localhost:5173";
const DISALLOWED_ORIGIN = "http://evil.example";

/**
 * @param telemetryEnabled - When `true`, wires a REAL `JsonlTelemetry` at
 *   `telemetryPath` via config (proving the actual JSONL sink, not a mock).
 *   When `false`, the sink file path is still resolved (so tests can assert
 *   its ABSENCE) but telemetry stays the default `NoOpTelemetry`.
 */
async function makeTestServer(telemetryEnabled: boolean): Promise<TestContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-telemetry-route-"));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  const dbPath = join(tmpDir, ".lore", "lore.db");
  const telemetryPath = join(tmpDir, ".lore", "telemetry.jsonl");

  const config = {
    project: { name: "t", author: "t" },
    telemetry: { enabled: telemetryEnabled, path: telemetryPath },
  } as unknown as LoreConfig;

  const appResult = createApp(dbPath, config);
  // reason: no sync section in `config` above → createApp's SQLiteStore branch
  // always returns a bare App, never the Result-wrapped TursoStore branch — this
  // narrows the union for TS without a runtime branch that can ever be false.
  const app = appResult as App;

  const createResult = await app.apiKeyStore.create("dashboard-local", "admin");
  if (!createResult.ok) throw new Error("Failed to create API key");
  const rawKey = createResult.value.rawKey;

  const server = startHttpServer(app, { port: 0, host: "127.0.0.1" });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  return { server, app, rawKey, baseUrl, tmpDir, telemetryPath };
}

async function bootstrapCookie(ctx: TestContext): Promise<string> {
  const res = await fetch(`${ctx.baseUrl}/api/auth/local-bootstrap`, {
    method: "POST",
    headers: { "X-Lore-Token": ctx.rawKey, Origin: ALLOWED_ORIGIN },
  });
  const { data } = (await res.json()) as { data: { session_id: string } };
  return data.session_id;
}

function postRouteView(
  ctx: TestContext,
  body: unknown,
  opts: { cookie?: string; bearer?: string; origin?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.cookie !== undefined) headers["Cookie"] = `lore_sid=${opts.cookie}`;
  if (opts.bearer !== undefined) headers["Authorization"] = `Bearer ${opts.bearer}`;
  if (opts.origin !== undefined) headers["Origin"] = opts.origin;
  return fetch(`${ctx.baseUrl}/api/dashboard/telemetry/route-view`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ─── HAPPY: telemetry enabled — exactly one real JSONL line ──────────────────

describe("POST /api/dashboard/telemetry/route-view — HAPPY: telemetry enabled (AC-075-8)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer(true);
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it("AC-075-8: a route-view POST writes exactly one JSONL line carrying route_id and doc_type", async () => {
    const sessionId = await bootstrapCookie(ctx);

    const res = await postRouteView(
      ctx,
      { route_id: "/docs/spec-075", doc_type: "spec" },
      { cookie: sessionId, origin: ALLOWED_ORIGIN },
    );

    expect(res.status).toBe(204);
    const bodyText = await res.text();
    expect(bodyText).toBe("");

    const lines = readFileSync(ctx.telemetryPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? "{}") as TelemetryEvent;
    expect(event.service).toBe("dashboard");
    expect(event.method).toBe("route_view");
    expect(event.ok).toBe(true);
    expect(event.duration_ms).toBe(0);
    expect(event.source).toBe("dashboard");
    expect(typeof event.ts).toBe("string");
    expect((event.meta as Record<string, unknown>)["route_id"]).toBe("/docs/spec-075");
    expect((event.meta as Record<string, unknown>)["doc_type"]).toBe("spec");
  });

  it("a route-view POST with no doc_type omits it from meta entirely (not null, not undefined-as-key)", async () => {
    const sessionId = await bootstrapCookie(ctx);

    const res = await postRouteView(ctx, { route_id: "/docs" }, { cookie: sessionId, origin: ALLOWED_ORIGIN });
    expect(res.status).toBe(204);

    const lines = readFileSync(ctx.telemetryPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? "{}") as TelemetryEvent;
    expect(Object.prototype.hasOwnProperty.call(event.meta, "doc_type")).toBe(false);
  });
});

// ─── STATE: telemetry disabled — zero sink writes ────────────────────────────

describe("POST /api/dashboard/telemetry/route-view — STATE: telemetry disabled", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer(false);
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it("AC-075-8: disabled telemetry → 204 and the configured sink file is NEVER created", async () => {
    const sessionId = await bootstrapCookie(ctx);

    const res = await postRouteView(ctx, { route_id: "/docs" }, { cookie: sessionId, origin: ALLOWED_ORIGIN });

    expect(res.status).toBe(204);
    expect(existsSync(ctx.telemetryPath)).toBe(false);
  });
});

// ─── ERROR: a throwing telemetry writer (D8 injectable seam) ────────────────

describe("POST /api/dashboard/telemetry/route-view — ERROR: throwing sink (AC-075-8)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer(false);
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it("AC-075-8: a record() that throws still returns 204 with no user-visible error, and logs exactly one server-side line", async () => {
    // reason: D8's injectable seam — `handleDashboardRouteViewTelemetry` takes
    // `app.telemetry` as an explicit parameter; substituting the mutable field
    // post-construction is the documented way a test reaches the failure branch
    // without a second App-construction path.
    const throwingTelemetry: Telemetry = {
      record: () => {
        throw new Error("sink write failed (test double)");
      },
      emit: () => {},
      close: () => {},
    };
    ctx.app.telemetry = throwingTelemetry;

    const originalConsoleError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    let res: Response;
    try {
      const sessionId = await bootstrapCookie(ctx);
      res = await postRouteView(ctx, { route_id: "/docs" }, { cookie: sessionId, origin: ALLOWED_ORIGIN });
    } finally {
      console.error = originalConsoleError;
    }

    expect(res.status).toBe(204);
    const bodyText = await res.text();
    expect(bodyText).toBe("");
    expect(errorCalls).toHaveLength(1);
  });
});

// ─── NEGATIVE (AC-075-9): auth matrix ────────────────────────────────────────

describe("POST /api/dashboard/telemetry/route-view — NEGATIVE: auth matrix (AC-075-9)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer(false);
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it("AC-075-9: a bearer-token actor → 403 (cookie-only dashboard write surface)", async () => {
    const res = await postRouteView(ctx, { route_id: "/docs" }, { bearer: ctx.rawKey, origin: ALLOWED_ORIGIN });
    expect(res.status).toBe(403);
  });

  it("AC-075-9: a valid cookie but a disallowed Origin → 403 (CSRF guard)", async () => {
    const sessionId = await bootstrapCookie(ctx);
    const res = await postRouteView(ctx, { route_id: "/docs" }, { cookie: sessionId, origin: DISALLOWED_ORIGIN });
    expect(res.status).toBe(403);
  });

  it("a malformed body (missing route_id) → 422 VALIDATION_ERROR", async () => {
    const sessionId = await bootstrapCookie(ctx);
    const res = await postRouteView(ctx, { doc_type: "spec" }, { cookie: sessionId, origin: ALLOWED_ORIGIN });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── BOUNDARY: route_id length cap ────────────────────────────────────────────

describe("POST /api/dashboard/telemetry/route-view — BOUNDARY: route_id <= 200 chars", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer(false);
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it("route_id at exactly 200 chars is accepted (204)", async () => {
    const sessionId = await bootstrapCookie(ctx);
    const res = await postRouteView(ctx, { route_id: "a".repeat(200) }, { cookie: sessionId, origin: ALLOWED_ORIGIN });
    expect(res.status).toBe(204);
  });

  it("route_id at 201 chars is rejected (422 VALIDATION_ERROR)", async () => {
    const sessionId = await bootstrapCookie(ctx);
    const res = await postRouteView(ctx, { route_id: "a".repeat(201) }, { cookie: sessionId, origin: ALLOWED_ORIGIN });
    expect(res.status).toBe(422);
  });
});
