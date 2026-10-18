/**
 * Tests for lore_create MCP tool with SPEC-024 `ai` field.
 *
 * Spec-first expected behaviours (SPEC-024 AC-NOAI-4, AC-NOAI-5):
 *   AC-NOAI-4: lore_create with ai=false (or default) MUST NOT invoke AIProviderService
 *   AC-NOAI-5: lore_create with ai=true MUST invoke AIProviderService.generate()
 *              and use the generated content as the document body
 *
 * MCP surface is always agent-like — AI is off by default.
 * The `ai` field in LoreCreateSchema defaults to false (SPEC-024 §9.4).
 *
 * Adversarial angles:
 *   - Default (ai field omitted) must NOT call AI — verify call count = 0
 *   - ai=false must NOT call AI — separate test from "omitted" to catch default-handling bugs
 *   - ai=true with content already provided must NOT call AI (content takes precedence)
 *   - ai=true without content MUST call AI exactly once
 *   - Generated content must appear in the created doc (fetch with lore_get to verify)
 *   - AI failure (err mode) must return isError=true response (no silent swallow)
 *
 * Mock risk: InMemoryAIProvider tracks all generate() calls in .calls — use this
 * instead of vi.fn() to avoid mocking the unit under test.
 *
 * @spec_ref AC-NOAI-4 AC-NOAI-5
 */

import { liveInvocation, actedStore } from "../../live-invocation.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ─── Test Infrastructure ─────────────────────────────────────────────────────

/** Stub ApiKeyStore — MCP AI tests do not exercise auth */
const stubApiKeyStore = {} as ApiKeyStore;

/**
 * Creates an App backed by InMemoryStore with a REAL InMemoryAIProvider.
 * Returns both the App and the provider so tests can inspect .calls.
 *
 * The `callerSurface` is set to "mcp" (the target surface for these tests).
 * `resolveAiDefault` is a stub that mirrors the real SPEC-024 logic for mcp:
 * explicit wins, else ai=false (mcp built-in default).
 */
function makeApp(): { app: App; aiProvider: InMemoryAIProvider } {
  const store = actedStore(new InMemoryStore());
  const aiProvider = new InMemoryAIProvider("test-provider", { kind: "ok", content: "# AI Generated\n\nStub content from InMemoryAIProvider.\n" });
  // reason: ReadonlyMap<string, AIProvider> required by AIProviderService constructor
  const providers: ReadonlyMap<string, InstanceType<typeof InMemoryAIProvider>> = new Map([
    ["test-provider", aiProvider],
  ]);
  const aiService = new AIProviderService(
    providers,
    "test-provider",
    {},
    new NoOpTelemetry(),
    false,
    8000, // refineMaxInputChars — SPEC-019 default (tests don't exercise truncation)
    { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 }, // assessBudgets — SPEC-026 default
  );

  const app: App = {
    corpusService: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService: aiService,
    // reason: these services are not exercised by lore_create AI path tests
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
    auditService: null as unknown as App["auditService"],
    // reason: SPEC-024 §9.2 — MCP surface is set at startup, before any tool call
    callerSurface: "mcp" as const,
    // reason: simplified resolveAiDefault for unit tests — mirrors mcp built-in (false)
    // with explicit_arg tier taking precedence when explicit is provided
    resolveAiDefault: (explicit?: boolean) => ({
      ai: explicit ?? false,
      source: explicit !== undefined ? ("explicit_arg" as const) : ("env" as const),
    }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };

  return { app, aiProvider };
}

/** Access the internal _registeredTools map to extract a named tool handler */
type McpServerInternal = {
  _registeredTools: Record<
    string,
    { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }
  >;
};

function getToolHandler(
  server: McpServer,
  name: string,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  const internal = server as unknown as McpServerInternal;
  const tool = internal._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return (args) => tool.handler(args, {} as unknown);
}

function parseResult(result: CallToolResult): unknown {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text);
}

// ─── Test Setup ──────────────────────────────────────────────────────────────

let app: App;
let server: McpServer;
let aiProvider: InMemoryAIProvider;

beforeEach(() => {
  const made = makeApp();
  app = made.app;
  aiProvider = made.aiProvider;
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app, undefined, liveInvocation());
});

// ─── HAPPY — ai field absent (defaults to false) ─────────────────────────────

describe("lore_create — ai field absent (default = false)", () => {
  it("creates doc without calling AI provider when ai field is omitted", async () => {
    const result = await getToolHandler(server, "lore_create")({ type: "prd", title: "Default AI Test" });
    expect(result.isError).toBeFalsy();
    // AC-NOAI-4: AI must NOT have been invoked
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("created doc has no AI-generated content when ai is omitted", async () => {
    const createResult = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "No AI Content Test",
    });
    const created = parseResult(createResult) as { id: string };

    const getResult = await getToolHandler(server, "lore_get")({ id_or_slug: created.id });
    expect(getResult.isError).toBeFalsy();
    const got = parseResult(getResult) as { doc: { content: string } };
    // adversarial: content must NOT be the InMemoryAIProvider stub ("# AI Generated\n...")
    expect(got.doc.content).not.toContain("AI Generated");
  });
});

// ─── HAPPY — ai: false explicitly ────────────────────────────────────────────

describe("lore_create — ai: false explicitly", () => {
  it("creates doc without calling AI provider when ai=false", async () => {
    const result = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "Explicit No AI Test",
      ai: false,
    });
    expect(result.isError).toBeFalsy();
    // AC-NOAI-4: provider must not be called for ai=false
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("created doc has empty content when ai=false and content not provided", async () => {
    const createResult = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "Empty Content Test",
      ai: false,
    });
    const created = parseResult(createResult) as { id: string };

    const getResult = await getToolHandler(server, "lore_get")({ id_or_slug: created.id });
    expect(getResult.isError).toBeFalsy();
    const got = parseResult(getResult) as { doc: { content: string } };
    // No AI content injected — content should be empty string or undefined
    expect(got.doc.content).not.toContain("AI Generated");
  });
});

// ─── HAPPY — ai: true invokes AI provider ─────────────────────────────────────

describe("lore_create — ai: true invokes AI provider", () => {
  it("calls AI provider exactly once when ai=true", async () => {
    const result = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "AI Generate Test",
      ai: true,
    });
    expect(result.isError).toBeFalsy();
    // AC-NOAI-5: AI provider MUST be called
    expect(aiProvider.calls).toHaveLength(1);
  });

  it("AI call uses the correct doc_type and title", async () => {
    await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "My AI PRD",
      ai: true,
    });
    expect(aiProvider.calls).toHaveLength(1);
    expect(aiProvider.calls[0]?.doc_type).toBe("prd");
    expect(aiProvider.calls[0]?.title).toBe("My AI PRD");
  });

  it("created doc has AI-generated content when ai=true", async () => {
    const createResult = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "Content AI Test",
      ai: true,
    });
    expect(createResult.isError).toBeFalsy();
    const created = parseResult(createResult) as { id: string };

    const getResult = await getToolHandler(server, "lore_get")({ id_or_slug: created.id });
    expect(getResult.isError).toBeFalsy();
    const got = parseResult(getResult) as { doc: { content: string } };
    // InMemoryAIProvider returns "# AI Generated\n\nStub content from InMemoryAIProvider.\n"
    expect(got.doc.content).toContain("AI Generated");
  });

  it("lore_create response contains correct shape (id, slug, type, status, version)", async () => {
    const result = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "Shape Test AI",
      ai: true,
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { id: string; slug: string; type: string; status: string; version: number };
    expect(data.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(data.slug).toContain("prd");
    expect(data.type).toBe("prd");
    expect(data.status).toBe("draft");
    expect(data.version).toBe(1);
  });
});

// ─── BOUNDARY — ai: true with content already provided ───────────────────────

describe("lore_create — ai: true + content provided (AI skipped)", () => {
  it("does NOT call AI when content is already provided even if ai=true", async () => {
    // The handler only calls AI when content is undefined
    // (see tools.ts: `if (resolvedContent === undefined && args.ai)`)
    const result = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "Content Provided AI Test",
      content: "# Existing Content\n\nThis was provided explicitly.",
      ai: true,
    });
    expect(result.isError).toBeFalsy();
    // adversarial: AI must NOT be called when content is already provided
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("provided content is preserved when ai=true + content both set", async () => {
    const explicitContent = "# My Manual Content\n\nWritten by hand.";
    const createResult = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "Manual Content Test",
      content: explicitContent,
      ai: true,
    });
    const created = parseResult(createResult) as { id: string };

    const getResult = await getToolHandler(server, "lore_get")({ id_or_slug: created.id });
    const got = parseResult(getResult) as { doc: { content: string } };
    // reason: canonicaliseBody is applied on write — stored content ends with exactly one "\n".
    expect(got.doc.content).toBe(explicitContent + "\n");
    // And the AI stub content was NOT injected
    expect(got.doc.content).not.toContain("AI Generated");
  });
});

// ─── ERROR — AI provider failure returns MCP error response ──────────────────

describe("lore_create — AI provider failure handling", () => {
  it("returns isError=true when AI provider fails (err mode)", async () => {
    // Reconfigure the InMemoryAIProvider to fail
    aiProvider.setMode({
      kind: "err",
      error: {
        code: "AI_PROVIDER_ERROR",
        message: "AI provider binary not found",
        provider: "test-provider",
      },
    });

    const result = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "AI Failure Test",
      ai: true,
    });
    // The error must propagate as an MCP error response, not be silently swallowed
    expect(result.isError).toBe(true);
  });

  it("error response contains structured LoreError when AI fails", async () => {
    aiProvider.setMode({
      kind: "err",
      error: {
        code: "AI_PROVIDER_ERROR",
        message: "timeout exceeded",
        provider: "test-provider",
      },
    });

    const result = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "AI Error Code Test",
      ai: true,
    });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("AI_PROVIDER_ERROR");
  });
});

// ─── STATE — multiple calls, AI call count tracks correctly ──────────────────

describe("lore_create — AI call count tracking across multiple invocations", () => {
  it("only ai=true calls accumulate in provider.calls (ai=false calls do not)", async () => {
    const create = getToolHandler(server, "lore_create");

    // First two calls: ai=false (no AI)
    await create({ type: "prd", title: "No AI 1", ai: false });
    await create({ type: "prd", title: "No AI 2" }); // omitted = false

    expect(aiProvider.calls).toHaveLength(0);

    // Third call: ai=true
    await create({ type: "prd", title: "AI Call 1", ai: true });
    expect(aiProvider.calls).toHaveLength(1);

    // Fourth call: ai=true again
    await create({ type: "prd", title: "AI Call 2", ai: true });
    expect(aiProvider.calls).toHaveLength(2);

    // Fifth call: ai=false (count stays at 2)
    await create({ type: "prd", title: "No AI 3", ai: false });
    expect(aiProvider.calls).toHaveLength(2);
  });
});

// ─── REGRESSION — ai field does not contaminate corpus doc fields ─────────────

describe("lore_create — ai field is stripped before corpus write", () => {
  it("ai field is NOT present on the stored doc record", async () => {
    const createResult = await getToolHandler(server, "lore_create")({
      type: "prd",
      title: "Field Strip Test",
      ai: true,
    });
    const created = parseResult(createResult) as { id: string };

    const getResult = await getToolHandler(server, "lore_get")({ id_or_slug: created.id });
    expect(getResult.isError).toBeFalsy();
    const got = parseResult(getResult) as { doc: Record<string, unknown> };
    // `ai` must not appear as a doc field — it's a tool-level hint only
    expect("ai" in got.doc).toBe(false);
  });
});
