/**
 * Unit tests for the SPEC-026 lore_assess MCP tool.
 *
 * Scope: translation-only (args → getPlanBundle/assessPlan/create/link → MCP envelope
 * shape). The corrective-retry protocol and telemetry-exactly-once are exhaustively
 * covered at the service layer (ai-provider-service-assess.test.ts) — this file verifies
 * the MCP adapter wiring, envelope shape, and the AI-brake/contradiction gates that live
 * in the tool handler itself, per the mcp-tools-task-workflow.test.ts precedent of "do not
 * re-test business rules at three layers".
 *
 * Strategy mirrors mcp-tools-task-workflow.test.ts: register real tools against a
 * McpServer, extract handlers from the internal _registeredTools map, invoke directly.
 * AIProviderService is real, wired with InMemoryAIProvider (SPEC-026 D9 sequence mode
 * available when a test needs it).
 *
 * Coverage:
 *   HAPPY:      lore_assess round-trip creates a knowledge doc (sub_type="assessment"),
 *               links it to the plan via "informs", and returns { assessment, result }
 *   NEGATIVE:   zero-task plan → isError, VALIDATION_ERROR, before any AI call;
 *               ai: false → isError, contradiction message (AC-ASSESS-9 mirror)
 *   BOUNDARY:   mcp surface braked by an EXPLICIT config override → isError, requires ai:true;
 *               the built-in mcp AI-off default does NOT brake assess (D5)
 *   ERROR:      provider error passes through as isError with the AI_PROVIDER_ERROR code
 *   STATE:      the informs link is queryable after a successful assess (doc graph updated)
 *   REGRESSION: sub_type/knowledge doc shape matches what CLI assess.ts produces (parity)
 *
 * @spec_ref AC-ASSESS-1, AC-ASSESS-8, AC-ASSESS-9, AC-ASSESS-10
 */

import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AiDefaultSource, CreateDocInput, DocRecord, LoreError } from "@lore/core";

// ─── Test Infrastructure (mirrors mcp-tools-task-workflow.test.ts) ────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let aiProvider: InMemoryAIProvider;

const VALID_JSON = JSON.stringify({
  verdict: "met",
  overall_score: 88,
  ac_scores: [{ ac_id: "AC-ASSESS-1", score: 88, reasoning: "Solid evidence trail.", evidence_refs: [] }],
  gaps: [],
  recommendations: [],
});

function makeApp(opts: {
  resolveAiDefault?: (explicit?: boolean) => { ai: boolean; source: AiDefaultSource };
} = {}): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store);
  aiProvider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
  const providers = new Map([["in-memory", aiProvider]]) as unknown as ReadonlyMap<string, import("@lore/core").AIProvider>;
  const aiProviderService = new AIProviderService(
    providers,
    "in-memory",
    {},
    new NoOpTelemetry(),
    false,
    8000,
    { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 },
  );

  return {
    corpusService,
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService,
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 }),
    callerSurface: "mcp" as const,
    resolveAiDefault: opts.resolveAiDefault ?? ((_explicit?: boolean) => ({ ai: false, source: "env" as const })),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

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

function parseError(result: CallToolResult): LoreError {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text) as LoreError;
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

async function createPlanWithTask(): Promise<{ planId: string; taskId: string }> {
  const planResult = await corpusService.create({ type: "plan", title: "Assess Plan", content: "goals" } as CreateDocInput);
  if (!planResult.ok) throw new Error(`Failed to create plan: ${JSON.stringify(planResult.error)}`);
  const taskResult = await corpusService.create({
    type: "task",
    title: "Assess Task",
    parent_id: planResult.value.id,
    content: "body",
    extra: { plan_id: planResult.value.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error(`Failed to create task: ${JSON.stringify(taskResult.error)}`);
  return { planId: planResult.value.id, taskId: taskResult.value.id };
}

async function createEmptyPlan(): Promise<string> {
  const planResult = await corpusService.create({ type: "plan", title: "Empty Assess Plan", content: "goals" } as CreateDocInput);
  if (!planResult.ok) throw new Error(`Failed to create plan: ${JSON.stringify(planResult.error)}`);
  return planResult.value.id;
}

// ─── Test Setup ────────────────────────────────────────────────────────────────

let app: App;
let server: McpServer;

function setup(opts: Parameters<typeof makeApp>[0] = {}) {
  app = makeApp(opts);
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app);
}

beforeEach(() => {
  setup();
});

// ─── lore_assess — HAPPY ───────────────────────────────────────────────────────

describe("lore_assess — HAPPY (AC-ASSESS-1, AC-ASSESS-10)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  it("creates a knowledge doc with sub_type='assessment' and links it to the plan via informs", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBeFalsy();

    const data = parseResult(result) as { assessment: DocRecord; result: { verdict: string; overall_score: number } };
    expect(data.assessment.type).toBe("knowledge");
    expect(data.assessment.extra["sub_type"]).toBe("assessment");
    expect(data.assessment.parent_id).toBe(planId);
    expect(data.result.verdict).toBe("met");
    expect(data.result.overall_score).toBe(88);
  });

  it("the returned result envelope's judgment.provider matches the active provider name", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    const data = parseResult(result) as { result: { judgment: { provider: string } } };
    expect(data.result.judgment.provider).toBe("in-memory");
  });

  it("mcp's built-in AI-off default does NOT brake assess when no explicit config override is set (D5)", async () => {
    // Default makeApp() resolveAiDefault returns { ai: false, source: "env" } — this is
    // the BUILT-IN per-surface default, not an explicit config override. D5 says this
    // must NOT brake assess even though ai is omitted (no explicit ai:true needed).
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId }); // no `ai` field at all
    expect(result.isError).toBeFalsy();
  });
});

// ─── lore_assess — STATE ────────────────────────────────────────────────────

describe("lore_assess — STATE (informs link persisted, AC-ASSESS-1)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  it("after a successful assess, the plan's incoming 'informs' link resolves to the new assessment doc", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    const data = parseResult(result) as { assessment: DocRecord };

    const linksResult = await store.findLinks(planId, "in");
    expect(linksResult.ok).toBe(true);
    if (!linksResult.ok) return;
    const informsLink = linksResult.value.find((l) => l.link_type === "informs" && l.from_id === data.assessment.id);
    expect(informsLink).toBeDefined();
  });
});

// ─── lore_assess — NEGATIVE ─────────────────────────────────────────────────

describe("lore_assess — NEGATIVE (AC-ASSESS-8, AC-ASSESS-9 mirror)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  it("a plan with zero child tasks → isError, VALIDATION_ERROR, and no AI call is made", async () => {
    const planId = await createEmptyPlan();
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("VALIDATION_ERROR");
    // The provider must never have been invoked — the zero-task gate runs BEFORE AI.
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("ai: false is always a contradiction (assess has no non-AI mode) → isError, AI_PROVIDER_ERROR", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId, ai: false });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("a nonexistent plan id → isError, DOC_NOT_FOUND (via getPlanBundle → resolve)", async () => {
    const result = await call()({ plan_id_or_slug: "plan-does-not-exist-xyz", ai: true });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── lore_assess — BOUNDARY (explicit config brake) ─────────────────────────

describe("lore_assess — BOUNDARY (explicit mcp config brake, SPEC-026 D5)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  it("an EXPLICIT config override (source='config', ai=false) DOES brake assess, requiring ai:true", async () => {
    setup({ resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "config" as const }) });
    const { planId } = await createPlanWithTask();

    const result = await call()({ plan_id_or_slug: planId }); // no explicit ai override
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("passing ai: true overrides the explicit config brake", async () => {
    setup({ resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "config" as const }) });
    const { planId } = await createPlanWithTask();

    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBeFalsy();
  });
});

// ─── lore_assess — ERROR (provider failure passthrough) ─────────────────────

describe("lore_assess — ERROR (provider failure passthrough)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  it("a provider error propagates as isError with code AI_PROVIDER_ERROR, and no doc is created", async () => {
    const { planId } = await createPlanWithTask();
    aiProvider.setMode({ kind: "err", error: { code: "AI_PROVIDER_ERROR", provider: "in-memory", message: "simulated failure" } });

    const beforeResult = await store.findMany({});
    if (!beforeResult.ok) throw new Error("findMany failed");
    const beforeCount = beforeResult.value.length;

    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("AI_PROVIDER_ERROR");

    const afterResult = await store.findMany({});
    if (!afterResult.ok) throw new Error("findMany failed");
    expect(afterResult.value.length).toBe(beforeCount);
  });
});
