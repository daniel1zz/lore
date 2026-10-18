/**
 * @spec_ref AC-D-B1, AC-D-B2
 *
 * Tests for the ?resolveMdx=true query parameter on GET /api/docs/:id.
 * Source: SPEC-015 §3.5
 *
 * Test plan:
 *   HAPPY (AC-D-B1):
 *     - GET /api/docs/:id?resolveMdx=true returns body.data.resolvedMdx with
 *       resolvedComponents array and warnings array
 *
 *   NEGATIVE (AC-D-B2):
 *     - GET /api/docs/:id (no resolveMdx param) returns raw content, no resolvedMdx key
 *
 *   BOUNDARY:
 *     - ?resolveMdx=false behaves like no flag — raw content, no resolvedMdx key
 *
 *   REGRESSION:
 *     - resolvedMdx does not mutate doc.content in the response
 *     - original doc fields remain intact when resolveMdx=true
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
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../../src/app.js";
import type { ApiKeyStore, ActorContext } from "../../../../src/adapters/http/auth.js";
import { handleApiRoute } from "../../../../src/adapters/http/routes.js";
import { actedStore } from "../../../live-invocation.js";

// ─── Test Infrastructure ─────────────────────────────────────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

function makeApp(): App {
  const store = actedStore(new InMemoryStore());
  return {
    warn: () => undefined,
    corpusService: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    // reason: MDX resolve route tests never exercise the AI path; null-cast avoids heavyweight
    // AIProviderService construction while satisfying the now-required field (SPEC-017 §3.12).
    aiProviderService: null as unknown as App["aiProviderService"],
    // reason: MDX resolve route tests never exercise sync-docs path — null-cast per SPEC-018 §3.6.
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    // reason: test does not exercise phase commands; null-cast per pattern from SPEC-023 §9.1.
    phaseService: null as unknown as App["phaseService"],
    // reason: SPEC-025 §9.1 — test does not exercise task-workflow commands; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    // reason: SPEC-032 §3.4 — test does not exercise spec-kind audit; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    // reason: test does not exercise AI-default path; callerSurface required by App interface (SPEC-024).
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

const TEST_ACTOR: ActorContext = { name: "test-agent", session_id: "test-session" };

function makeGetRequest(path: string): { req: Request; url: URL } {
  const url = new URL(`http://localhost${path}`);
  const req = new Request(url.toString(), { method: "GET" });
  return { req, url };
}

let app: App;

beforeEach(() => {
  app = makeApp();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createPrd(title: string, content: string): Promise<{ id: string; slug: string }> {
  const result = await app.corpusService.create({ type: "prd", title, content });
  if (!result.ok) throw new Error(`Failed to create PRD: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, slug: result.value.slug };
}

// ─── GET /api/docs/:id?resolveMdx=true ───────────────────────────────────────

describe("GET /api/docs/:id?resolveMdx=true", () => {
  describe("happy path (AC-D-B1)", () => {
    it("returns 200 with resolvedMdx field when flag is true", async () => {
      const { id } = await createPrd("PRD With Placeholder", "# PRD\n\n<HealthStats />\n");

      const { req, url } = makeGetRequest(`/api/docs/${id}?resolveMdx=true`);
      const res = await handleApiRoute(req, url, app, TEST_ACTOR);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const body = await res!.json() as Record<string, unknown>;
      expect(body.ok).toBe(true);
      const data = body.data as Record<string, unknown>;
      expect(data).toHaveProperty("resolvedMdx");
    });

    it("resolvedMdx contains resolvedComponents and warnings arrays", async () => {
      const { id } = await createPrd("PRD With Placeholder", "<HealthStats />");

      const { req, url } = makeGetRequest(`/api/docs/${id}?resolveMdx=true`);
      const res = await handleApiRoute(req, url, app, TEST_ACTOR);
      const body = await res!.json() as Record<string, unknown>;
      const data = body.data as Record<string, unknown>;
      const resolvedMdx = data.resolvedMdx as Record<string, unknown>;

      expect(Array.isArray(resolvedMdx.resolvedComponents)).toBe(true);
      expect(Array.isArray(resolvedMdx.warnings)).toBe(true);
    });

    it("doc fields remain intact when resolveMdx=true (regression)", async () => {
      const title = "Regression PRD";
      const content = "<ChildrenOf />";
      const { id } = await createPrd(title, content);

      const { req, url } = makeGetRequest(`/api/docs/${id}?resolveMdx=true`);
      const res = await handleApiRoute(req, url, app, TEST_ACTOR);
      const body = await res!.json() as Record<string, unknown>;
      const data = body.data as Record<string, unknown>;
      const doc = data.doc as Record<string, unknown>;

      expect(doc.id).toBe(id);
      expect(doc.title).toBe(title);
      // reason: canonicaliseBody applied on write — stored content ends with exactly one "\n".
      expect(doc.content).toBe(content + "\n");
    });

    it("navigation field is still present when resolveMdx=true", async () => {
      const { id } = await createPrd("Nav PRD", "plain content");

      const { req, url } = makeGetRequest(`/api/docs/${id}?resolveMdx=true`);
      const res = await handleApiRoute(req, url, app, TEST_ACTOR);
      const body = await res!.json() as Record<string, unknown>;
      const data = body.data as Record<string, unknown>;

      expect(data).toHaveProperty("navigation");
    });
  });

  describe("no flag → raw content (AC-D-B2)", () => {
    it("GET without resolveMdx param has no resolvedMdx key", async () => {
      const { id } = await createPrd("Plain PRD", "<HealthStats />");

      const { req, url } = makeGetRequest(`/api/docs/${id}`);
      const res = await handleApiRoute(req, url, app, TEST_ACTOR);

      expect(res!.status).toBe(200);
      const body = await res!.json() as Record<string, unknown>;
      const data = body.data as Record<string, unknown>;
      expect(data).not.toHaveProperty("resolvedMdx");
    });

    it("doc.content is unchanged when no resolveMdx flag", async () => {
      const content = "<HealthStats />";
      const { id } = await createPrd("Raw PRD", content);

      const { req, url } = makeGetRequest(`/api/docs/${id}`);
      const res = await handleApiRoute(req, url, app, TEST_ACTOR);
      const body = await res!.json() as Record<string, unknown>;
      const data = body.data as Record<string, unknown>;
      const doc = data.doc as Record<string, unknown>;

      // reason: canonicaliseBody applied on write — stored content ends with exactly one "\n".
      expect(doc.content).toBe(content + "\n");
    });
  });

  describe("boundary: ?resolveMdx=false", () => {
    it("resolveMdx=false returns raw content without resolvedMdx key", async () => {
      const { id } = await createPrd("Boundary PRD", "<HealthStats />");

      const { req, url } = makeGetRequest(`/api/docs/${id}?resolveMdx=false`);
      const res = await handleApiRoute(req, url, app, TEST_ACTOR);

      expect(res!.status).toBe(200);
      const body = await res!.json() as Record<string, unknown>;
      const data = body.data as Record<string, unknown>;
      expect(data).not.toHaveProperty("resolvedMdx");
    });
  });

  describe("error: unknown doc with resolveMdx=true", () => {
    it("returns 404 when doc does not exist even with resolveMdx=true", async () => {
      const { req, url } = makeGetRequest("/api/docs/01HNOTFOUNDNOTFOUNDNOTFOUND?resolveMdx=true");
      const res = await handleApiRoute(req, url, app, TEST_ACTOR);

      expect(res!.status).toBe(404);
      const body = await res!.json() as Record<string, unknown>;
      expect(body.ok).toBe(false);
    });
  });
});
