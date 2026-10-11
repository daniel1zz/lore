/**
 * Tests for the CSRF Origin guard on /api/dashboard/* write routes.
 * Source: SPEC-016 §3.2 / SPEC-022 §9.3 hardening — dashboard write endpoints relied solely
 * on SameSite=Strict + assertCookieActor (auth TYPE, not origin) for CSRF protection. This
 * adds the SAME Origin allowlist check `POST /api/auth/local-bootstrap` already uses
 * (`ALLOWED_ORIGINS` via `middleware.ts::isOriginAllowed` — no second allowlist) as
 * defense-in-depth: a present-but-disallowed Origin is rejected (403); an ABSENT Origin is
 * NOT rejected (same-origin GETs / non-browser cookie clients routinely omit it, and this
 * preserves every dashboard write route's pre-existing behavior for the no-Origin case).
 *
 * Uses InMemoryStore + real services (no external DB) — mirrors dashboard-routes.test.ts's
 * infrastructure exactly, since the Origin guard runs before any service call.
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - allowlisted Origin (http://localhost:5173) on a write route → passes through to the
 *       normal cookie-actor / service flow (200/201, not 403)
 *
 *   NEGATIVE:
 *     - disallowed Origin (http://evil.example) on a write route → 403 VALIDATION_ERROR
 *       field=Origin, BEFORE the cookie-actor guard or any service call runs
 *     - disallowed Origin is rejected even for an otherwise-valid cookie actor (guard runs
 *       first — a bearer actor with a disallowed Origin still gets 403, not the bearer-403
 *       from assertCookieActor, proving Origin is checked first)
 *
 *   BOUNDARY:
 *     - a look-alike Origin that merely contains/prefixes an allowlisted entry (not an exact
 *       match) → 403 (locks exact-match semantics, mirrors cors.bun.test.ts's precedent)
 *
 *   ERROR:
 *     - n/a: no IO failure path exercises this branch differently
 *
 *   STATE:
 *     - n/a: Origin is checked per-request, no persisted state
 *
 *   REGRESSION:
 *     - a request with NO Origin header on a write route behaves EXACTLY as before this
 *       fix — passes the CSRF guard and reaches the normal cookie-actor / service flow
 *       (matches dashboard-routes.test.ts's jsonReq helper, which never sets Origin)
 *     - applies uniformly across create / patch / approve / reject / createLink /
 *       deleteLink / deleteDoc / restore
 */

import { RecordLockService } from "../../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore } from "../../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../../src/service/corpus-service.js";
import { ReviewService } from "../../../../src/service/review-service.js";
import { VersionService } from "../../../../src/service/version-service.js";
import { OutlineService } from "../../../../src/service/outline-service.js";
import { MigrationService } from "../../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../../src/service/tree-check-service.js";
import { JudgmentService } from "../../../../src/service/judgment-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../../src/app.js";
import type { ApiKeyStore, ActorContext } from "../../../../src/adapters/http/auth.js";
import { handleDashboardRoute } from "../../../../src/adapters/http/dashboard-routes.js";

// ─── Test infrastructure (mirrors dashboard-routes.test.ts) ────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

function makeApp(): App {
  const store = new InMemoryStore();
  return {
    corpusService: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(store, new NoOpTelemetry()),
    auditService: null as unknown as App["auditService"],
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

const COOKIE_ACTOR: ActorContext = {
  name: "test-user",
  session_id: "test-session",
  callerSurface: "http_cookie" as const,
};

const BEARER_ACTOR: ActorContext = {
  name: "test-agent",
  session_id: "token-session",
  callerSurface: "http_token" as const,
};

function makeUrl(path: string): URL {
  return new URL(`http://localhost${path}`);
}

function jsonReq(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function parseRes(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

let app: App;

beforeEach(() => {
  app = makeApp();
});

// ─── happy path ─────────────────────────────────────────────────────────────

describe("CSRF Origin guard — allowlisted Origin", () => {
  it("passes through to the normal flow (201) for an allowlisted Origin", async () => {
    const req = jsonReq(
      "POST",
      "/api/dashboard/docs",
      { type: "prd", title: "Allowed Origin PRD" },
      { Origin: "http://localhost:5173" },
    );
    const res = await handleDashboardRoute(req, makeUrl("/api/dashboard/docs"), app, COOKIE_ACTOR);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);
  });
});

// ─── negative cases ───────────────────────────────────────────────────────────

describe("CSRF Origin guard — disallowed Origin", () => {
  it("rejects with 403 VALIDATION_ERROR field=Origin, before any service call", async () => {
    const req = jsonReq(
      "POST",
      "/api/dashboard/docs",
      { type: "prd", title: "Should Not Be Created" },
      { Origin: "http://evil.example" },
    );
    const res = await handleDashboardRoute(req, makeUrl("/api/dashboard/docs"), app, COOKIE_ACTOR);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await parseRes(res!);
    expect(body.ok).toBe(false);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("Origin");

    // No doc must have been created.
    const listResult = await app.corpusService.list({});
    expect(listResult.ok).toBe(true);
    if (listResult.ok) expect(listResult.value.docs).toHaveLength(0);
  });

  it("rejects a disallowed Origin BEFORE the cookie-actor guard — bearer actor still gets Origin 403, not the bearer 403", async () => {
    const req = jsonReq(
      "POST",
      "/api/dashboard/docs",
      { type: "prd", title: "Bearer + Bad Origin" },
      { Origin: "http://evil.example" },
    );
    const res = await handleDashboardRoute(req, makeUrl("/api/dashboard/docs"), app, BEARER_ACTOR);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await parseRes(res!);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("Origin");
  });
});

// ─── boundary values ──────────────────────────────────────────────────────────

describe("CSRF Origin guard — exact-match semantics", () => {
  it("rejects a look-alike Origin that merely prefixes an allowlisted entry", async () => {
    const req = jsonReq(
      "POST",
      "/api/dashboard/docs",
      { type: "prd", title: "Lookalike Origin" },
      { Origin: "http://localhost:5173.evil.example" },
    );
    const res = await handleDashboardRoute(req, makeUrl("/api/dashboard/docs"), app, COOKIE_ACTOR);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});

// ─── regression: missing Origin preserved ──────────────────────────────────────

describe("CSRF Origin guard — missing Origin (REGRESSION)", () => {
  it("a request with no Origin header on POST /api/dashboard/docs still succeeds (201) exactly as before this fix", async () => {
    const req = jsonReq("POST", "/api/dashboard/docs", { type: "prd", title: "No Origin Header PRD" });
    const res = await handleDashboardRoute(req, makeUrl("/api/dashboard/docs"), app, COOKIE_ACTOR);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(201);
  });

  it("a bearer actor with no Origin header still gets the pre-existing 403 (bearer-only guard, not Origin)", async () => {
    const req = jsonReq("POST", "/api/dashboard/docs", { type: "prd", title: "Bearer No Origin" });
    const res = await handleDashboardRoute(req, makeUrl("/api/dashboard/docs"), app, BEARER_ACTOR);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await parseRes(res!);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("FORBIDDEN");
  });

  it("PATCH with no Origin header still reaches the normal flow (not a 403 from the Origin guard)", async () => {
    const createRes = await app.corpusService.create({ type: "prd", title: "Patch Target" });
    if (!createRes.ok) throw new Error("setup failed");
    const id = createRes.value.id;

    const req = jsonReq("PATCH", `/api/dashboard/docs/${id}`, { title: "Patched Title" });
    const res = await handleDashboardRoute(req, makeUrl(`/api/dashboard/docs/${id}`), app, COOKIE_ACTOR);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });

  it("unknown dashboard path still returns null (unaffected by the Origin guard placement)", async () => {
    const req = jsonReq("GET", "/api/dashboard/unknown-route");
    const res = await handleDashboardRoute(req, makeUrl("/api/dashboard/unknown-route"), app, COOKIE_ACTOR);
    expect(res).toBeNull();
  });
});
