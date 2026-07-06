/**
 * Unit tests for the SPEC-034 lore_review MCP tool.
 *
 * Scope: translation-only (args → getReviewBundle/runDeterministicChecks/judgeDoc/
 * record → MCP envelope shape), mirroring mcp-tools-assess.test.ts's own scope note —
 * the corrective-retry protocol is exhaustively covered at the service layer
 * (ai-provider-service tests); this file verifies the MCP adapter wiring, envelope
 * shape, and the AI-brake gate that lives in the tool handler itself.
 *
 * Strategy mirrors mcp-tools-assess.test.ts: register real tools against a McpServer,
 * extract handlers from the internal _registeredTools map, invoke directly. Real
 * JudgmentService(InMemoryStore, NoOpTelemetry) — no service is null-cast for the paths
 * these tests exercise. AIProviderService is real, wired with InMemoryAIProvider.
 *
 * Coverage:
 *   HAPPY:      a doc whose deterministic checks all pass reaches the AI judge, records
 *               the judge's decision, and returns {requested_by, judgment}
 *   NEGATIVE:   a doc that fails a deterministic check (task with no
 *               verification_evidence) records a reject judgment WITHOUT ever invoking
 *               the AI provider (aiProvider.calls stays empty)
 *   BOUNDARY:   an EXPLICIT mcp config brake (source: "config", ai: false) blocks the
 *               tool entirely — isError, no provider call, no judgment recorded; the
 *               built-in mcp AI-off default (source: "env") does NOT brake it
 *   ERROR:      a provider failure on an otherwise-clean doc → isError,
 *               AI_PROVIDER_ERROR, and no judgment is ever recorded (checked via
 *               judgmentService.latestFor)
 *   STATE:      after a successful lore_review, judgmentService.latestFor(docId)
 *               resolves the just-recorded judgment
 *   REGRESSION: lore_pending's include_judgments:true attaches each doc's latest
 *               judgment (or null) without changing the base docs[] shape
 *
 * @spec_ref SPEC-034 §4, §6
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
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AiDefaultSource, CreateDocInput, DocId, LoreError, ReviewJudgment } from "@lore/core";

// ─── Test Infrastructure (mirrors mcp-tools-assess.test.ts) ──────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let judgmentService: JudgmentService;
let aiProvider: InMemoryAIProvider;

const VALID_REVIEW_JSON = JSON.stringify({
  decision: "approve",
  confidence: 0.88,
  reasons: [{ dimension: "completeness", finding: "Solid document." }],
  blocking_questions: [],
});

function makeApp(
  opts: {
    resolveAiDefault?: (explicit?: boolean) => { ai: boolean; source: AiDefaultSource };
  } = {},
): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store);
  judgmentService = new JudgmentService(store, new NoOpTelemetry());
  aiProvider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_REVIEW_JSON });
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
    specKindService: null as unknown as App["specKindService"],
    judgmentService,
    auditService: null as unknown as App["auditService"],
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

/** A root-type PRD doc: parent_contract passes (root type, no parent), schema passes
 * (prdExtraSchema accepts any extra), no links → ALL deterministic checks pass/skip. */
async function createCleanPrd(title: string): Promise<string> {
  const result = await corpusService.create({ type: "prd", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** A task with NO verification_evidence — naturally fails the evidence_completeness
 * deterministic check (mirrors mcp-tools-assess.test.ts's createPlanWithTask). */
async function createTaskWithoutEvidence(): Promise<string> {
  const planResult = await corpusService.create({ type: "plan", title: "Review Plan", content: "goals" } as CreateDocInput);
  if (!planResult.ok) throw new Error(`Failed to create plan: ${JSON.stringify(planResult.error)}`);
  const taskResult = await corpusService.create({
    type: "task",
    title: "Review Task",
    parent_id: planResult.value.id,
    content: "body",
    extra: { plan_id: planResult.value.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error(`Failed to create task: ${JSON.stringify(taskResult.error)}`);
  return taskResult.value.id;
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

// ─── lore_review — HAPPY ───────────────────────────────────────────────────────

describe("lore_review — HAPPY (AI judge path)", () => {
  const call = () => getToolHandler(server, "lore_review");

  it("a doc that passes all deterministic checks reaches the AI judge and records its decision", async () => {
    const docId = await createCleanPrd("Clean PRD");
    const result = await call()({ id_or_slug: docId, by: "alice" });
    expect(result.isError).toBeFalsy();

    const data = parseResult(result) as { requested_by: string; judgment: ReviewJudgment };
    expect(data.requested_by).toBe("alice");
    expect(data.judgment.decision).toBe("approve");
    expect(data.judgment.confidence).toBe(0.88);
    expect(data.judgment.judge.provider).toBe("in-memory");
    expect(aiProvider.calls).toHaveLength(1);
  });
});

// ─── lore_review — NEGATIVE (deterministic-check-fail short-circuit) ─────────

describe("lore_review — NEGATIVE (deterministic-check failure never touches the provider)", () => {
  const call = () => getToolHandler(server, "lore_review");

  it("a task with no verification_evidence records decision=reject, confidence=1.0, WITHOUT invoking the AI provider", async () => {
    const taskId = await createTaskWithoutEvidence();
    const result = await call()({ id_or_slug: taskId, by: "bob" });
    expect(result.isError).toBeFalsy();

    const data = parseResult(result) as { judgment: ReviewJudgment };
    expect(data.judgment.decision).toBe("reject");
    expect(data.judgment.confidence).toBe(1.0);
    expect(data.judgment.judge.provider).toBe("deterministic-checks");
    expect(data.judgment.checks.some((c) => c.check === "evidence_completeness" && c.outcome === "fail")).toBe(true);
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("a nonexistent doc id → isError, DOC_NOT_FOUND", async () => {
    const result = await call()({ id_or_slug: "doc-does-not-exist-xyz", by: "bob" });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── lore_review — BOUNDARY (explicit config brake) ──────────────────────────

describe("lore_review — BOUNDARY (explicit mcp config brake)", () => {
  const call = () => getToolHandler(server, "lore_review");

  it("an EXPLICIT config override (source='config', ai=false) blocks the tool entirely", async () => {
    setup({ resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "config" as const }) });
    const docId = await createCleanPrd("Braked PRD");

    const result = await call()({ id_or_slug: docId, by: "alice" });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(aiProvider.calls).toHaveLength(0);

    const latestResult = await judgmentService.latestFor(docId as DocId);
    expect(latestResult.ok).toBe(true);
    if (latestResult.ok) expect(latestResult.value).toBeNull();
  });

  it("the built-in mcp AI-off default (source='env') does NOT brake lore_review", async () => {
    // Default makeApp() resolveAiDefault returns {ai: false, source: "env"} — the BUILT-IN
    // per-surface default, not an explicit config override. It must NOT block the tool.
    const docId = await createCleanPrd("Not Braked PRD");
    const result = await call()({ id_or_slug: docId, by: "alice" });
    expect(result.isError).toBeFalsy();
  });
});

// ─── lore_review — ERROR (provider failure) ──────────────────────────────────

describe("lore_review — ERROR (AI provider failure, no judgment recorded)", () => {
  const call = () => getToolHandler(server, "lore_review");

  it("a provider error on an otherwise-clean doc → isError, AI_PROVIDER_ERROR, no judgment recorded", async () => {
    const docId = await createCleanPrd("Provider Failure PRD");
    aiProvider.setMode({ kind: "err", error: { code: "AI_PROVIDER_ERROR", provider: "in-memory", message: "simulated failure" } });

    const result = await call()({ id_or_slug: docId, by: "carol" });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("AI_PROVIDER_ERROR");

    const latestResult = await judgmentService.latestFor(docId as DocId);
    expect(latestResult.ok).toBe(true);
    if (latestResult.ok) expect(latestResult.value).toBeNull();
  });
});

// ─── lore_review — STATE (judgment persisted, queryable via JudgmentService) ─

describe("lore_review — STATE (judgment persisted)", () => {
  const call = () => getToolHandler(server, "lore_review");

  it("after a successful lore_review, judgmentService.latestFor resolves the recorded judgment", async () => {
    const docId = await createCleanPrd("State PRD");
    await call()({ id_or_slug: docId, by: "dave" });

    const latestResult = await judgmentService.latestFor(docId as DocId);
    expect(latestResult.ok).toBe(true);
    if (!latestResult.ok) return;
    expect(latestResult.value).not.toBeNull();
    expect(latestResult.value?.decision).toBe("approve");
  });
});

// ─── lore_pending — REGRESSION (include_judgments) ───────────────────────────

describe("lore_pending include_judgments — REGRESSION", () => {
  const callPending = () => getToolHandler(server, "lore_pending");

  it("attaches each doc's latest judgment (or null) without changing the base docs[] shape", async () => {
    const reviewedId = await createCleanPrd("Reviewed PRD");
    const unreviewedId = await createCleanPrd("Unreviewed PRD");
    await getToolHandler(server, "lore_review")({ id_or_slug: reviewedId, by: "erin" });

    const result = await callPending()({ include_judgments: true });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { docs: Array<{ id: string; judgment: ReviewJudgment | null }> };

    const reviewedRow = data.docs.find((d) => d.id === reviewedId);
    const unreviewedRow = data.docs.find((d) => d.id === unreviewedId);
    expect(reviewedRow?.judgment?.decision).toBe("approve");
    expect(unreviewedRow?.judgment).toBeNull();
  });

  it("omitting include_judgments returns docs with no judgment field (backward-compatible)", async () => {
    await createCleanPrd("Plain PRD");
    const result = await callPending()({});
    const data = parseResult(result) as { docs: Array<{ judgment?: unknown }> };
    expect(data.docs.every((d) => d.judgment === undefined)).toBe(true);
  });
});
