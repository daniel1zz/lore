/**
 * Unit tests for the `lore_assess` MCP tool, the milestone review (BR-1372).
 *
 * Scope: translation-only (args -> MilestoneReviewService -> MCP envelope), plus the AI-brake and contradiction gates
 * that live in the tool handler. The review's own rules (seven dimensions, retry, fingerprint, deterministic
 * design_necessity floor) are covered at the service layer and by `tests/integration/milestone-review.test.ts`.
 *
 * Strategy mirrors mcp-tools-task-workflow.test.ts: register real tools against a McpServer, extract handlers from the
 * internal _registeredTools map, invoke directly. AIProviderService is real, wired with the in-memory provider test
 * double — never a real model.
 *
 * Coverage:
 *   HAPPY:      a review creates a `milestone-review` knowledge doc under the plan, informs-linked, and returns the
 *               seven dimensions with the overall verdict
 *   NEGATIVE:   a plan with no tasks -> isError VALIDATION_ERROR before any AI call; ai: false -> contradiction error;
 *               a nonexistent plan -> DOC_NOT_FOUND
 *   BOUNDARY:   the built-in mcp AI-off default does NOT brake assess (D5); an EXPLICIT config brake requires ai: true
 *   ERROR:      a provider error passes through as AI_PROVIDER_ERROR and stores nothing
 *   STATE:      the informs link is queryable afterwards; a referenceless design_necessity pass stores a failing review
 *   REGRESSION: a plan with no recorded commit range tells the judge no diff is available
 *
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, BR-1372)
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
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { MilestoneReviewService } from "../../../src/service/milestone-review-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { MILESTONE_DIMENSIONS, NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AiDefaultSource, CreateDocInput, DocRecord, LoreError } from "@lore/core";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let aiProvider: InMemoryAIProvider;

function judgeAnswer(overrides: Record<string, { verdict: string; reason: string; reference: string }> = {}): string {
  return JSON.stringify({
    dimensions: Object.fromEntries(
      MILESTONE_DIMENSIONS.map((d) => [d, overrides[d] ?? { verdict: "pass", reason: `${d} holds`, reference: "Google code review guide" }]),
    ),
  });
}

function makeApp(opts: { resolveAiDefault?: (explicit?: boolean) => { ai: boolean; source: AiDefaultSource } } = {}): App {
  store = actedStore(new InMemoryStore());
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  aiProvider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeAnswer() });
  const providers = new Map([["in-memory", aiProvider]]) as unknown as ReadonlyMap<string, import("@lore/core").AIProvider>;
  const aiProviderService = new AIProviderService(providers, "in-memory", {}, new NoOpTelemetry(), false, 8000, {
    max_diff_chars: 24000,
  });
  return {
    warn: () => undefined,
    corpusService,
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService,
    milestoneReviewService: new MilestoneReviewService({
      getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
      getCitedRuleStates: corpusService.getCitedRuleStates.bind(corpusService),
      listDecisionLog: () => store.listDecisionLog(),
      judge: aiProviderService.judgeMilestone.bind(aiProviderService),
      createReviewDoc: corpusService.createMilestoneReviewDoc.bind(corpusService),
      link: (fromId, toId, type) => corpusService.link(fromId, toId, type),
    }),
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 }),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
    callerSurface: "mcp" as const,
    resolveAiDefault: opts.resolveAiDefault ?? ((_explicit?: boolean) => ({ ai: false, source: "env" as const })),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

type McpServerInternal = {
  _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }>;
};

function getToolHandler(server: McpServer, name: string): (args: Record<string, unknown>) => Promise<CallToolResult> {
  const tool = (server as unknown as McpServerInternal)._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return (args) => tool.handler(args, {} as unknown);
}

function parseResult(result: CallToolResult): unknown {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text);
}

function parseError(result: CallToolResult): LoreError {
  return parseResult(result) as LoreError;
}

async function createPlanWithTask(): Promise<{ planId: string }> {
  const plan = await corpusService.create({ type: "plan", title: "Review Plan", content: "goals" } as CreateDocInput);
  if (!plan.ok) throw new Error(`Failed to create plan: ${JSON.stringify(plan.error)}`);
  const task = await corpusService.create({
    type: "task",
    title: "Review Task",
    parent_id: plan.value.id,
    content: "body",
    extra: { plan_id: plan.value.id },
  } as CreateDocInput);
  if (!task.ok) throw new Error(`Failed to create task: ${JSON.stringify(task.error)}`);
  return { planId: plan.value.id };
}

let app: App;
let server: McpServer;

function setup(opts: Parameters<typeof makeApp>[0] = {}): void {
  app = makeApp(opts);
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app, undefined, liveInvocation());
}

beforeEach(() => {
  setup();
});

const call = () => getToolHandler(server, "lore_assess");

describe("lore_assess — milestone review HAPPY (BR-1372)", () => {
  it("creates a milestone-review knowledge doc under the plan, informs-linked, with the seven dimensions", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      review: DocRecord;
      overall: string;
      failed_dimensions: string[];
      dimensions: Record<string, { verdict: string }>;
    };
    expect(data.review.type).toBe("knowledge");
    expect(data.review.extra["sub_type"]).toBe("milestone-review");
    expect(data.review.parent_id).toBe(planId);
    expect(data.overall).toBe("pass");
    expect(data.failed_dimensions).toEqual([]);
    expect(Object.keys(data.dimensions)).toEqual([...MILESTONE_DIMENSIONS]);
  });

  it("the stored review carries the plan-state fingerprint it judged and is linked by informs", async () => {
    const { planId } = await createPlanWithTask();
    const data = parseResult(await call()({ plan_id_or_slug: planId, ai: true })) as { review: DocRecord };
    const stored = data.review.extra["milestone_review"] as { fingerprint: string; plan_id: string };
    expect(stored.plan_id).toBe(planId);
    expect(stored.fingerprint).toMatch(/^plan:.+@\d+\|tasks:.+\|landed:none$/);
    const docs = await corpusService.listMilestoneReviewDocs(planId);
    expect(docs.ok && docs.value.map((d) => d.id)).toEqual([data.review.id]);
  });

  it("mcp's built-in AI-off default does NOT brake assess when no explicit config override is set (D5)", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId });
    expect(result.isError).toBeFalsy();
  });
});

describe("lore_assess — retired ACs (same fields as the CLI)", () => {
  const retired = [{ kind: "superseded" as const, spec: "old-spec", ac: "AC-OLD-1", reason: "feature removed", at: "2026-10-23T00:00:00.000Z", superseded_by: "new-spec:AC-NEW-1" }];

  it("a pending retirement adds retired_acs and pending_decision to the payload", async () => {
    const { planId } = await createPlanWithTask();
    app = { ...app, retiredAcService: { settle: async () => ({ ok: true, value: { state: "pending", retired, pendingId: 7 } }) } as unknown as NonNullable<App["retiredAcService"]> };
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
    const data = parseResult(await call()({ plan_id_or_slug: planId, ai: true })) as { retired_acs?: unknown; pending_decision?: unknown };
    expect(data.retired_acs).toEqual(retired);
    expect(data.pending_decision).toBe(7);
  });

  it("a plan with nothing retired carries neither field", async () => {
    const { planId } = await createPlanWithTask();
    app = { ...app, retiredAcService: { settle: async () => ({ ok: true, value: { state: "none" } }) } as unknown as NonNullable<App["retiredAcService"]> };
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
    const data = parseResult(await call()({ plan_id_or_slug: planId, ai: true })) as Record<string, unknown>;
    expect(data["retired_acs"]).toBeUndefined();
    expect(data["pending_decision"]).toBeUndefined();
  });

  it("a settle failure is an isError result, never a silent skip", async () => {
    const { planId } = await createPlanWithTask();
    app = { ...app, retiredAcService: { settle: async () => ({ ok: false, error: { code: "STORE_ERROR", message: "boom" } }) } as unknown as NonNullable<App["retiredAcService"]> };
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBe(true);
  });
});

describe("lore_assess — NEGATIVE / BOUNDARY / ERROR", () => {
  it("a plan with zero child tasks -> isError VALIDATION_ERROR and no AI call is made", async () => {
    const plan = await corpusService.create({ type: "plan", title: "Empty Plan", content: "goals" } as CreateDocInput);
    if (!plan.ok) throw new Error("fixture");
    const result = await call()({ plan_id_or_slug: plan.value.id, ai: true });
    expect(result.isError).toBe(true);
    expect(parseError(result).code).toBe("VALIDATION_ERROR");
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("ai: false is a contradiction -> isError, no AI call", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId, ai: false });
    expect(result.isError).toBe(true);
    expect(parseError(result).code).toBe("AI_PROVIDER_ERROR");
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("a nonexistent plan id -> isError DOC_NOT_FOUND", async () => {
    const result = await call()({ plan_id_or_slug: "01ARZ3NDEKTSV4RRFFQ69G5FAV", ai: true });
    expect(result.isError).toBe(true);
    expect(parseError(result).code).toBe("DOC_NOT_FOUND");
  });

  it("an EXPLICIT config brake on the mcp surface requires ai: true, which overrides it", async () => {
    setup({
      resolveAiDefault: (explicit?: boolean) =>
        explicit === true ? { ai: true, source: "explicit_arg" as const } : { ai: false, source: "config" as const },
    });
    const { planId } = await createPlanWithTask();
    const braked = await call()({ plan_id_or_slug: planId });
    expect(braked.isError).toBe(true);
    expect(JSON.stringify(parseError(braked))).toContain("ai: true");
    const overridden = await call()({ plan_id_or_slug: planId, ai: true });
    expect(overridden.isError).toBeFalsy();
  });

  it("a provider error propagates as AI_PROVIDER_ERROR and no review doc is created", async () => {
    const { planId } = await createPlanWithTask();
    aiProvider.setMode({ kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "binary missing", provider: "in-memory" } });
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBe(true);
    expect(parseError(result).code).toBe("AI_PROVIDER_ERROR");
    const docs = await corpusService.listMilestoneReviewDocs(planId);
    expect(docs.ok && docs.value).toEqual([]);
  });
});

describe("lore_assess — STATE / REGRESSION", () => {
  it("a design_necessity pass with no reference is stored as a failing review", async () => {
    const { planId } = await createPlanWithTask();
    aiProvider.setMode({ kind: "ok", content: judgeAnswer({ design_necessity: { verdict: "pass", reason: "needed", reference: "" } }) });
    const data = parseResult(await call()({ plan_id_or_slug: planId, ai: true })) as { overall: string; failed_dimensions: string[] };
    expect(data.overall).toBe("fail");
    expect(data.failed_dimensions).toEqual(["design_necessity"]);
  });

  it("a plan with no recorded commit range tells the judge that no diff is available", async () => {
    const { planId } = await createPlanWithTask();
    await call()({ plan_id_or_slug: planId, ai: true });
    expect(aiProvider.calls).toHaveLength(1);
    expect(aiProvider.calls[0]?.prompt).toContain("No diff is available");
  });
});
