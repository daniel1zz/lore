/**
 * @spec_ref AC-DASH-WRITE-2, AC-DASH-WRITE-3, AC-DASH-WRITE-7, AC-DASH-WRITE-9
 *
 * Integration tests for handleDashboardRoute.
 * Uses InMemoryStore + real services (no external DB).
 * Source: SPEC-022 §9.1, §9.3, §9.4, §9.5
 *
 * Spec expectations (written before reading implementation):
 *   - POST /api/dashboard/docs → 201 with new DocRecord (AC-DASH-WRITE-2)
 *   - PATCH /api/dashboard/docs/:id → 200 with updated doc
 *   - POST /api/dashboard/docs/:id/approve → 200 (doc must be in-review first)
 *   - POST /api/dashboard/docs/:id/reject → 200 with draft status
 *   - POST /api/dashboard/docs/:id/links → 201
 *   - DELETE /api/dashboard/docs/:id/links/:toId → 204
 *   - Bearer-token actor → 403 on any route (AC-DASH-WRITE-9)
 *   - PATCH with stale If-Match → 409 (AC-DASH-WRITE-3)
 *   - PATCH with X-Force-Overwrite: 1 after stale conflict → 200
 *   - Unknown dashboard path → null (caller handles 404)
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore } from "../../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../../src/service/corpus-service.js";
import { ReviewService } from "../../../../src/service/review-service.js";
import { VersionService } from "../../../../src/service/version-service.js";
import { OutlineService } from "../../../../src/service/outline-service.js";
import { MigrationService } from "../../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../../src/service/tree-check-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../../src/app.js";
import type { ApiKeyStore, ActorContext } from "../../../../src/adapters/http/auth.js";
import { handleDashboardRoute } from "../../../../src/adapters/http/dashboard-routes.js";

// ─── Test infrastructure ──────────────────────────────────────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

function makeApp(): App {
  const store = new InMemoryStore();
  return {
    corpusService: new CorpusService(store),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    // reason: SPEC-025 §9.1 — test does not exercise task-workflow commands; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    // reason: SPEC-032 §3.4 — test does not exercise spec-kind audit; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

// Cookie actor — required by all dashboard write endpoints (AC-DASH-WRITE-9)
const COOKIE_ACTOR: ActorContext = {
  name: "test-user",
  session_id: "test-session",
  callerSurface: "http_cookie" as const,
};

// Bearer actor — must receive 403 on all dashboard write routes (AC-DASH-WRITE-9)
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

// ─── Test setup ───────────────────────────────────────────────────────────────

let app: App;

beforeEach(() => {
  app = makeApp();
});

// Helper: create a PRD doc via service, return its id and version
async function createPrd(title: string): Promise<{ id: string; version: number }> {
  const result = await app.corpusService.create({ type: "prd", title });
  if (!result.ok) throw new Error(`Failed to create PRD: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, version: result.value.version };
}

// Helper: put a doc in-review via service (required before approve/reject)
async function putInReview(id: string): Promise<void> {
  const result = await app.corpusService.set(id, { status: "in-review" });
  if (!result.ok) throw new Error(`Failed to set in-review: ${JSON.stringify(result.error)}`);
}

// ─── HAPPY paths ──────────────────────────────────────────────────────────────

describe("POST /api/dashboard/docs — create", () => {
  describe("happy path", () => {
    it("returns 201 with new DocRecord in {ok: true, data: {doc}} envelope", async () => {
      const req = jsonReq("POST", "/api/dashboard/docs", { type: "prd", title: "New PRD" });
      const url = makeUrl("/api/dashboard/docs");
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(201);
      const body = await parseRes(res!);
      expect(body.ok).toBe(true);
      const data = body.data as Record<string, unknown>;
      const doc = data.doc as Record<string, unknown>;
      expect(doc.type).toBe("prd");
      expect(doc.title).toBe("New PRD");
      expect(doc.status).toBe("draft");
    });

    it("creates docs with different types — confirms it is not hardcoded to one type", async () => {
      // Anti-hardcode: two different doc types must produce different results
      const req1 = jsonReq("POST", "/api/dashboard/docs", { type: "prd", title: "First PRD" });
      const url1 = makeUrl("/api/dashboard/docs");
      const res1 = await handleDashboardRoute(req1, url1, app, COOKIE_ACTOR);
      const body1 = await parseRes(res1!);
      const doc1 = (body1.data as Record<string, unknown>).doc as Record<string, unknown>;

      const req2 = jsonReq("POST", "/api/dashboard/docs", { type: "plan", title: "A Plan" });
      const url2 = makeUrl("/api/dashboard/docs");
      const res2 = await handleDashboardRoute(req2, url2, app, COOKIE_ACTOR);
      const body2 = await parseRes(res2!);
      const doc2 = (body2.data as Record<string, unknown>).doc as Record<string, unknown>;

      expect(doc1.type).toBe("prd");
      expect(doc2.type).toBe("plan");
      expect(doc1.id).not.toBe(doc2.id);
    });
  });
});

describe("PATCH /api/dashboard/docs/:id — edit", () => {
  describe("happy path", () => {
    it("returns 200 with updated content in {ok: true, data: {doc}} envelope", async () => {
      const { id } = await createPrd("Original Title");
      const req = jsonReq("PATCH", `/api/dashboard/docs/${id}`, { content: "Updated content" });
      const url = makeUrl(`/api/dashboard/docs/${id}`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const body = await parseRes(res!);
      expect(body.ok).toBe(true);
      const doc = (body.data as Record<string, unknown>).doc as Record<string, unknown>;
      expect(doc.content).toBe("Updated content\n"); // canonicaliseBody appends trailing \n (SPEC-021 FU)
    });

    it("editing content on an approved doc resets status to draft (AC-DASH-WRITE-5)", async () => {
      // Spec AC-DASH-WRITE-5: editing content on approved doc auto-flips to draft
      const { id } = await createPrd("Approved Doc");
      // Fast-track to approved
      await app.corpusService.set(id, { status: "approved" });

      const req = jsonReq("PATCH", `/api/dashboard/docs/${id}`, { content: "New content after approval" });
      const url = makeUrl(`/api/dashboard/docs/${id}`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res!.status).toBe(200);
      const body = await parseRes(res!);
      const doc = (body.data as Record<string, unknown>).doc as Record<string, unknown>;
      // Editing content on approved doc must demote it to draft
      expect(doc.status).toBe("draft");
    });
  });
});

describe("DELETE /api/dashboard/docs/:id — soft delete (SPEC-027 AC-DH-6)", () => {
  describe("happy path", () => {
    it("returns 200 with {id, recoverable_until} after confirmed delete", async () => {
      const { id } = await createPrd("Deletable Doc");

      const req = jsonReq("DELETE", `/api/dashboard/docs/${id}?confirm=true`);
      const url = makeUrl(`/api/dashboard/docs/${id}?confirm=true`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const body = await parseRes(res!);
      expect(body.ok).toBe(true);
      const data = body.data as Record<string, unknown>;
      expect(data.id).toBe(id);
      expect(typeof data.recoverable_until).toBe("string");
    });

    it("the deleted doc's record carries a non-null deleted_at afterward", async () => {
      const { id } = await createPrd("Deleted Doc Marker");

      const req = jsonReq("DELETE", `/api/dashboard/docs/${id}?confirm=true`);
      const url = makeUrl(`/api/dashboard/docs/${id}?confirm=true`);
      await handleDashboardRoute(req, url, app, COOKIE_ACTOR);

      const getResult = await app.corpusService.get(id);
      if (!getResult.ok) throw new Error("expected doc to still resolve after soft delete");
      expect(getResult.value.doc.deleted_at).not.toBeNull();
    });
  });

  describe("negative", () => {
    it("without ?confirm=true returns 400 DELETE_REQUIRES_CONFIRM", async () => {
      const { id } = await createPrd("Unconfirmed Delete");

      const req = jsonReq("DELETE", `/api/dashboard/docs/${id}`);
      const url = makeUrl(`/api/dashboard/docs/${id}`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res!.status).toBe(400);
      const body = await parseRes(res!);
      expect(body.ok).toBe(false);
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe("DELETE_REQUIRES_CONFIRM");
    });

    it("nonexistent doc id returns 404 DOC_NOT_FOUND", async () => {
      const req = jsonReq("DELETE", "/api/dashboard/docs/nonexistent-id?confirm=true");
      const url = makeUrl("/api/dashboard/docs/nonexistent-id?confirm=true");
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res!.status).toBe(404);
    });
  });
});

describe("POST /api/dashboard/docs/:id/restore — version restore (SPEC-027 AC-DH-7, AC-DH-11)", () => {
  describe("happy path", () => {
    it("returns 200 with a new version N+1 carrying the target version's content", async () => {
      const { id } = await createPrd("Restorable Doc");
      // v1 content is the title-seeded default; bump to v2 with new content.
      await app.corpusService.set(id, { content: "v2 content" });

      const req = jsonReq("POST", `/api/dashboard/docs/${id}/restore?confirm=true`, { version: 1 });
      const url = makeUrl(`/api/dashboard/docs/${id}/restore?confirm=true`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const body = await parseRes(res!);
      expect(body.ok).toBe(true);
      const doc = (body.data as Record<string, unknown>).doc as Record<string, unknown>;
      expect(doc.version).toBe(3); // v1 (create) -> v2 (set) -> v3 (restore, append-only)
      expect(doc.status).toBe("draft"); // restore always resets to draft
    });

    it("restore is append-only — the pre-restore version log entry is untouched", async () => {
      const { id } = await createPrd("Append-only Restore Doc");
      await app.corpusService.set(id, { content: "v2 content" });

      const req = jsonReq("POST", `/api/dashboard/docs/${id}/restore?confirm=true`, { version: 1 });
      const url = makeUrl(`/api/dashboard/docs/${id}/restore?confirm=true`);
      await handleDashboardRoute(req, url, app, COOKIE_ACTOR);

      const logResult = await app.versionService.log(id, { limit: 50 });
      if (!logResult.ok) throw new Error("expected version log to resolve");
      // All three versions (create, set, restore) must still be present — history
      // is never deleted or overwritten.
      const versionNumbers = logResult.value.map((entry) => entry.version).sort();
      expect(versionNumbers).toEqual([1, 2, 3]);
    });
  });

  describe("negative", () => {
    it("without ?confirm=true returns 400 RESTORE_REQUIRES_CONFIRM (AC-DH-11)", async () => {
      const { id } = await createPrd("Unconfirmed Restore Doc");
      await app.corpusService.set(id, { content: "v2 content" });

      const req = jsonReq("POST", `/api/dashboard/docs/${id}/restore`, { version: 1 });
      const url = makeUrl(`/api/dashboard/docs/${id}/restore`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res!.status).toBe(400);
      const body = await parseRes(res!);
      expect(body.ok).toBe(false);
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe("RESTORE_REQUIRES_CONFIRM");
    });

    it("confirm=false (or any non-'true' value) is treated as missing confirm", async () => {
      const { id } = await createPrd("Falsy Confirm Restore Doc");
      await app.corpusService.set(id, { content: "v2 content" });

      const req = jsonReq("POST", `/api/dashboard/docs/${id}/restore?confirm=false`, { version: 1 });
      const url = makeUrl(`/api/dashboard/docs/${id}/restore?confirm=false`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res!.status).toBe(400);
      const body = await parseRes(res!);
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe("RESTORE_REQUIRES_CONFIRM");
    });

    it("non-integer version (with confirm=true) returns 422 VALIDATION_ERROR", async () => {
      const { id } = await createPrd("Bad Version Doc");
      const req = jsonReq("POST", `/api/dashboard/docs/${id}/restore?confirm=true`, { version: 1.5 });
      const url = makeUrl(`/api/dashboard/docs/${id}/restore?confirm=true`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res!.status).toBe(422);
      const body = await parseRes(res!);
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe("VALIDATION_ERROR");
    });

    it("missing version field (with confirm=true) returns 422 VALIDATION_ERROR", async () => {
      const { id } = await createPrd("Missing Version Doc");
      const req = jsonReq("POST", `/api/dashboard/docs/${id}/restore?confirm=true`, {});
      const url = makeUrl(`/api/dashboard/docs/${id}/restore?confirm=true`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res!.status).toBe(422);
    });

    it("restoring to a version that doesn't exist (with confirm=true) returns 404 DOC_NOT_FOUND — pinned error contract (AC-DH-11)", async () => {
      // Explicit contract: a well-formed but nonexistent version is DOC_NOT_FOUND (404),
      // never VALIDATION_ERROR and never an ambiguous 500 — see the route module header
      // for the reasoning (shape-valid input, the historical snapshot itself is absent).
      const { id } = await createPrd("Nonexistent Version Doc");
      const req = jsonReq("POST", `/api/dashboard/docs/${id}/restore?confirm=true`, { version: 99 });
      const url = makeUrl(`/api/dashboard/docs/${id}/restore?confirm=true`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res!.status).toBe(404);
      const body = await parseRes(res!);
      expect(body.ok).toBe(false);
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe("DOC_NOT_FOUND");
    });
  });
});

describe("POST /api/dashboard/docs/:id/approve", () => {
  describe("happy path", () => {
    it("returns 200 with approved DocRecord after transitioning through in-review", async () => {
      // Spec §9.4: approve requires doc to be in in-review state
      const { id } = await createPrd("Approvable Doc");
      await putInReview(id);

      const req = jsonReq("POST", `/api/dashboard/docs/${id}/approve`);
      const url = makeUrl(`/api/dashboard/docs/${id}/approve`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const body = await parseRes(res!);
      expect(body.ok).toBe(true);
      const doc = (body.data as Record<string, unknown>).doc as Record<string, unknown>;
      expect(doc.status).toBe("approved");
    });
  });
});

describe("POST /api/dashboard/docs/:id/reject", () => {
  describe("happy path", () => {
    it("returns 200 with draft-status DocRecord (rejection resets to draft)", async () => {
      const { id } = await createPrd("Rejectable Doc");
      await putInReview(id);

      const req = jsonReq("POST", `/api/dashboard/docs/${id}/reject`, { reason: "Not ready" });
      const url = makeUrl(`/api/dashboard/docs/${id}/reject`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const body = await parseRes(res!);
      expect(body.ok).toBe(true);
      const doc = (body.data as Record<string, unknown>).doc as Record<string, unknown>;
      // reject transitions doc back to draft
      expect(doc.status).toBe("draft");
    });
  });
});

describe("POST /api/dashboard/docs/:id/links", () => {
  describe("happy path", () => {
    it("returns 201 after creating a link between two docs", async () => {
      const { id: fromId } = await createPrd("Source Doc");
      const { id: toId } = await createPrd("Target Doc");

      const req = jsonReq("POST", `/api/dashboard/docs/${fromId}/links`, {
        to: toId,
        type: "relates-to",
      });
      const url = makeUrl(`/api/dashboard/docs/${fromId}/links`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(201);
      const body = await parseRes(res!);
      expect(body.ok).toBe(true);
    });
  });
});

describe("DELETE /api/dashboard/docs/:id/links/:linkId", () => {
  describe("happy path", () => {
    it("returns 204 after deleting an existing link", async () => {
      const { id: fromId } = await createPrd("Unlink Source");
      const { id: toId } = await createPrd("Unlink Target");
      // Create link first via service
      await app.corpusService.link(fromId, toId, "relates-to");

      const req = jsonReq("DELETE", `/api/dashboard/docs/${fromId}/links/${toId}`);
      const url = makeUrl(`/api/dashboard/docs/${fromId}/links/${toId}`);
      const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(204);
    });
  });
});

// ─── NEGATIVE paths ───────────────────────────────────────────────────────────

describe("bearer-token actor is rejected on all dashboard write routes (AC-DASH-WRITE-9)", () => {
  it("POST /api/dashboard/docs → 403 for bearer actor", async () => {
    const req = jsonReq("POST", "/api/dashboard/docs", { type: "prd", title: "Test" });
    const url = makeUrl("/api/dashboard/docs");
    const res = await handleDashboardRoute(req, url, app, BEARER_ACTOR);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("PATCH /api/dashboard/docs/:id → 403 for bearer actor", async () => {
    const { id } = await createPrd("Bearer Patch Test");
    const req = jsonReq("PATCH", `/api/dashboard/docs/${id}`, { content: "updated" });
    const url = makeUrl(`/api/dashboard/docs/${id}`);
    const res = await handleDashboardRoute(req, url, app, BEARER_ACTOR);
    expect(res!.status).toBe(403);
  });

  it("POST /api/dashboard/docs/:id/approve → 403 for bearer actor", async () => {
    const { id } = await createPrd("Bearer Approve Test");
    const req = jsonReq("POST", `/api/dashboard/docs/${id}/approve`);
    const url = makeUrl(`/api/dashboard/docs/${id}/approve`);
    const res = await handleDashboardRoute(req, url, app, BEARER_ACTOR);
    expect(res!.status).toBe(403);
  });

  it("403 response has a meaningful FORBIDDEN error code", async () => {
    const req = jsonReq("POST", "/api/dashboard/docs", { type: "prd", title: "T" });
    const url = makeUrl("/api/dashboard/docs");
    const res = await handleDashboardRoute(req, url, app, BEARER_ACTOR);
    const body = await parseRes(res!);
    expect(body.ok).toBe(false);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("FORBIDDEN");
  });
});

describe("PATCH with stale If-Match → 409 conflict (AC-DASH-WRITE-3)", () => {
  it("returns 409 with conflict payload when If-Match version is stale", async () => {
    const { id, version } = await createPrd("Conflict Doc");
    // Advance the server version by making an update
    await app.corpusService.set(id, { content: "server updated content" });
    // Client sends the old version number
    const req = jsonReq(
      "PATCH",
      `/api/dashboard/docs/${id}`,
      { content: "client edit" },
      { "If-Match": String(version) }, // stale (server is now at version+1 minimum)
    );
    const url = makeUrl(`/api/dashboard/docs/${id}`);
    const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
    expect(res!.status).toBe(409);
    const body = await parseRes(res!);
    // 409 must return conflict payload (current, mine, diff) per AC-DASH-WRITE-3
    expect(body.ok).toBe(false);
    const error = body.error as Record<string, unknown>;
    expect(error.current).toBeDefined();
    expect(error.mine).toBeDefined();
    expect(error.diff).toBeDefined();
  });

  it("409 conflict payload contains the actual current server doc with updated content", async () => {
    const { id, version } = await createPrd("Conflict Payload Doc");
    await app.corpusService.set(id, { content: "the server content that beat you" });

    const req = jsonReq(
      "PATCH",
      `/api/dashboard/docs/${id}`,
      { content: "client attempt" },
      { "If-Match": String(version) },
    );
    const url = makeUrl(`/api/dashboard/docs/${id}`);
    const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
    const body = await parseRes(res!);
    const error = body.error as Record<string, unknown>;
    const current = error.current as Record<string, unknown>;
    expect(current.content).toBe("the server content that beat you\n"); // canonicaliseBody appends \n (SPEC-021 FU)
    expect(error.mine).toBe("client attempt");
  });
});

describe("PATCH with X-Force-Overwrite: 1 — bypass stale conflict", () => {
  it("returns 200 even when If-Match would be stale, if X-Force-Overwrite: 1 is set", async () => {
    const { id, version } = await createPrd("Force Overwrite Doc");
    // Advance server version
    await app.corpusService.set(id, { content: "server moved forward" });

    // Client sends both stale If-Match AND X-Force-Overwrite: 1 — force must win
    const req = jsonReq(
      "PATCH",
      `/api/dashboard/docs/${id}`,
      { content: "forced content" },
      {
        "If-Match": String(version), // would be stale
        "X-Force-Overwrite": "1",   // bypasses check
      },
    );
    const url = makeUrl(`/api/dashboard/docs/${id}`);
    const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
    expect(res!.status).toBe(200);
    const body = await parseRes(res!);
    expect(body.ok).toBe(true);
    const doc = (body.data as Record<string, unknown>).doc as Record<string, unknown>;
    expect(doc.content).toBe("forced content\n"); // canonicaliseBody appends \n (SPEC-021 FU)
  });
});

// ─── BOUNDARY conditions ──────────────────────────────────────────────────────

describe("unknown /api/dashboard/* path → null (caller handles 404)", () => {
  it("returns null for an unrecognized /api/dashboard/* path", async () => {
    const req = new Request("http://localhost/api/dashboard/unknown-endpoint", { method: "GET" });
    const url = makeUrl("/api/dashboard/unknown-endpoint");
    const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
    expect(res).toBeNull();
  });

  it("returns null for /api/dashboard/docs/:id with GET method (write routes only)", async () => {
    const { id } = await createPrd("No GET Test");
    const req = new Request(`http://localhost/api/dashboard/docs/${id}`, { method: "GET" });
    const url = makeUrl(`/api/dashboard/docs/${id}`);
    const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
    // GET is not a dashboard write route — should return null (unmatched)
    expect(res).toBeNull();
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("state transitions via dashboard write routes", () => {
  it("approve after reject produces in-review then approved states correctly", async () => {
    const { id } = await createPrd("State Transition Doc");
    await putInReview(id);

    // Reject first → back to draft
    const rejectReq = jsonReq("POST", `/api/dashboard/docs/${id}/reject`, { reason: "Need revisions" });
    const rejectUrl = makeUrl(`/api/dashboard/docs/${id}/reject`);
    const rejectRes = await handleDashboardRoute(rejectReq, rejectUrl, app, COOKIE_ACTOR);
    const rejectBody = await parseRes(rejectRes!);
    const rejectedDoc = (rejectBody.data as Record<string, unknown>).doc as Record<string, unknown>;
    expect(rejectedDoc.status).toBe("draft");

    // Move back to in-review for approval
    await putInReview(id);

    // Now approve
    const approveReq = jsonReq("POST", `/api/dashboard/docs/${id}/approve`);
    const approveUrl = makeUrl(`/api/dashboard/docs/${id}/approve`);
    const approveRes = await handleDashboardRoute(approveReq, approveUrl, app, COOKIE_ACTOR);
    const approveBody = await parseRes(approveRes!);
    const approvedDoc = (approveBody.data as Record<string, unknown>).doc as Record<string, unknown>;
    expect(approvedDoc.status).toBe("approved");
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("regression — response envelope shape", () => {
  it("success responses always have {ok: true, data: ...} shape", async () => {
    const req = jsonReq("POST", "/api/dashboard/docs", { type: "prd", title: "Envelope Test" });
    const url = makeUrl("/api/dashboard/docs");
    const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
    const raw = await parseRes(res!);
    expect(raw.ok).toBe(true);
    expect(raw.data).toBeDefined();
    expect(raw.error).toBeUndefined();
  });

  it("error responses always have {ok: false, error: ...} shape", async () => {
    const req = jsonReq("POST", "/api/dashboard/docs", {}); // invalid body — missing type
    const url = makeUrl("/api/dashboard/docs");
    const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
    const raw = await parseRes(res!);
    expect(raw.ok).toBe(false);
    expect(raw.error).toBeDefined();
    expect(raw.data).toBeUndefined();
  });

  it("POST /api/dashboard/docs with missing required 'type' field → 422", async () => {
    // Spec AC-DASH-WRITE-2: Zod validated — type is required
    const req = jsonReq("POST", "/api/dashboard/docs", { title: "No type here" });
    const url = makeUrl("/api/dashboard/docs");
    const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
    expect(res!.status).toBe(422);
  });
});

describe("regression — DELETE /api/dashboard/docs/:id without ?confirm=true is rejected (AC-DH-12)", () => {
  // Defense-in-depth: the confirm gate must hold at the server even if a future
  // change to the dashboard UI's confirm dialog is skipped or bypassed. This is a
  // deliberate duplicate of the "negative" coverage above — pinned explicitly under
  // the REGRESSION dimension per SPEC-027 AC-DH-12 (a server-side regression test
  // independent of any UI confirmation dialog).
  it("rejects with 400 DELETE_REQUIRES_CONFIRM and performs no deletion", async () => {
    const { id } = await createPrd("AC-DH-12 Regression Doc");

    const req = jsonReq("DELETE", `/api/dashboard/docs/${id}`);
    const url = makeUrl(`/api/dashboard/docs/${id}`);
    const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = await parseRes(res!);
    expect(body.ok).toBe(false);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("DELETE_REQUIRES_CONFIRM");

    // The doc must remain undeleted — confirm the gate actually blocked the write,
    // not just that it returned an error code cosmetically.
    const getResult = await app.corpusService.get(id);
    if (!getResult.ok) throw new Error("expected doc to still exist and resolve");
    expect(getResult.value.doc.deleted_at).toBeNull();
  });

  it("rejects with 400 even when ?confirm=false is explicitly passed (not just omitted)", async () => {
    const { id } = await createPrd("AC-DH-12 Falsy Confirm Doc");

    const req = jsonReq("DELETE", `/api/dashboard/docs/${id}?confirm=false`);
    const url = makeUrl(`/api/dashboard/docs/${id}?confirm=false`);
    const res = await handleDashboardRoute(req, url, app, COOKIE_ACTOR);

    expect(res!.status).toBe(400);
    const body = await parseRes(res!);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("DELETE_REQUIRES_CONFIRM");
  });
});
