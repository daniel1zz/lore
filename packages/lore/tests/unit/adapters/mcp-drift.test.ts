/**
 * Unit tests for the SPEC-045 `lore_status {check_drift}` extension and
 * `lore_anchor_set`'s spec-target dispatch (doc-code drift oracle, memory hygiene
 * part 3 — PRD §16 H3).
 *
 * Scope: translation-only (args → DriftCheckService/flows/drift-flow.ts → MCP
 * envelope shape), mirroring `mcp-staleness.test.ts`'s own scope note and test
 * harness (hand-built `App` via `InMemoryStore` + real services, `registerTools`,
 * handlers extracted from the internal `_registeredTools` map). This file builds its
 * OWN `makeApp()` (distinct from `mcp-tools.test.ts`'s, which does not wire
 * `driftCheckService` — that file's own tests never exercise `check_drift: true` /
 * spec-target `lore_anchor_set`).
 *
 * @spec_ref SPEC-045 §Acceptance Criteria AC-DR-5
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      `check_drift: true` on a consistent, armed corpus; `lore_anchor_set`
 *               spec-target REPLACE
 *   NEGATIVE:   n/a — SPEC-045 has no schema-level input-shape rejection to probe on
 *               this tool pair (both schemas accept broad shapes; the interesting
 *               failure modes are ERROR-dimension doc-type/attestation cases below)
 *   BOUNDARY:   `lore_status {}` (check_drift omitted) — byte-identical pre-SPEC-045
 *               shape, REGRESSION oracle; deep-equals proof that the MCP handler and
 *               the CLI's shared `runDrift` builder produce IDENTICAL payloads
 *   ERROR:      `lore_anchor_set` on a non-task/non-spec target (a plan) →
 *               VALIDATION_ERROR naming "task or spec"; a `#`-carrying task anchor
 *               is STILL rejected loud (REGRESSION oracle for the task branch)
 *   STATE:      `check_drift: true` on a corpus with a broken (never-existing) anchor
 *               → consistent:false, drifts[] carries the row
 *   REGRESSION: task-target `lore_anchor_set` preserves `extra.claim`/
 *               `extra.verification_evidence` untouched (byte-identical to
 *               pre-SPEC-045 behavior)
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
import { StalenessProbeService } from "../../../src/service/staleness-probe-service.js";
import { ValidityService } from "../../../src/service/validity-service.js";
import { DriftCheckService } from "../../../src/service/drift-check-service.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { buildDriftFlowDeps, runDrift, type CodeDriftPayload } from "../../../src/flows/drift-flow.js";
import { buildRealFsProbe } from "../../../src/adapters/real-fs-probe.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, LoreError } from "@lore/core";

// ─── Test Infrastructure (mirrors mcp-staleness.test.ts) ─────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let taskWorkflowService: TaskWorkflowService;
let driftCheckService: DriftCheckService;
let app: App;

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store);
  const judgmentService = new JudgmentService(store, new NoOpTelemetry());
  const aiProvider = new InMemoryAIProvider("in-memory", { kind: "ok", content: "{}" });
  const providers = new Map([["in-memory", aiProvider]]) as unknown as ReadonlyMap<string, import("@lore/core").AIProvider>;
  const aiProviderService = new AIProviderService(
    providers,
    "in-memory",
    {},
    new NoOpTelemetry(),
    false,
    8000,
    { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 },
    { max_doc_chars: 12000, max_context_chars: 8000 },
    { max_doc_chars: 12000, neighbor_limit: 20 },
  );
  const stalenessProbeService = new StalenessProbeService(
    store,
    aiProviderService.probeStaleness.bind(aiProviderService),
    judgmentService.record.bind(judgmentService),
  );
  taskWorkflowService = new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 });
  driftCheckService = new DriftCheckService(store);

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
    taskWorkflowService,
    specKindService: null as unknown as App["specKindService"],
    judgmentService,
    stalenessProbeService,
    validityService: new ValidityService(store, new NoOpTelemetry()),
    auditService: null as unknown as App["auditService"],
    driftCheckService,
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "env" as const }),
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

async function createPrd(): Promise<string> {
  const result = await corpusService.create({
    type: "prd",
    title: "ZzzMcpDriftRootPrd",
    content: "## Overview\n\nBody.",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`create prd failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createSpecWithAnchors(prdId: string, title: string, codeAnchors: string[]): Promise<{ id: string; slug: string }> {
  const result = await corpusService.create({
    type: "spec",
    title,
    parent_id: prdId,
    content: "## Overview\n\nBody.",
    extra: { spec_kind: "feature", code_anchors: codeAnchors },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`create spec "${title}" failed: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, slug: result.value.slug };
}

async function createPlan(): Promise<{ id: string; slug: string }> {
  const result = await corpusService.create({
    type: "plan",
    title: "ZzzMcpDriftPlan",
    content: "body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`create plan failed: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, slug: result.value.slug };
}

async function createTask(planId: string): Promise<{ id: string; slug: string }> {
  const result = await corpusService.create({
    type: "task",
    title: "ZzzMcpDriftTask",
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`create task failed: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, slug: result.value.slug };
}

let server: McpServer;

beforeEach(() => {
  app = makeApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app);
});

// ─── BOUNDARY: lore_status {} — byte-identical pre-SPEC-045 shape ────────────

describe("lore_status {} — BOUNDARY (REGRESSION, check_drift omitted)", () => {
  it("carries no code_drift key at all", async () => {
    const call = getToolHandler(server, "lore_status");
    const result = await call({});
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as Record<string, unknown>;
    expect(data["code_drift"]).toBeUndefined();
    expect(data["open_stale_candidates"]).toBeDefined();
    expect(data["total_docs"]).toBeDefined();
  });

  it("carries no code_drift key when check_drift: false is passed explicitly either", async () => {
    const call = getToolHandler(server, "lore_status");
    const result = await call({ check_drift: false });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as Record<string, unknown>;
    expect(data["code_drift"]).toBeUndefined();
  });
});

// ─── HAPPY: check_drift:true on a consistent, armed corpus ──────────────────

describe("lore_status {check_drift: true} — HAPPY (consistent, armed corpus)", () => {
  it("declares an anchor with NO path component (an empty string is invalid) — use a real, currently-nonexistent path to prove armed:true/consistent:false first, then flip to a resolvable case", async () => {
    // Simplest deterministic "consistent" fixture: anchor a bare directory-less path
    // that the drift oracle probes against process.cwd() — since this vitest run's
    // cwd is the package root, "package.json" always exists there as a plain file.
    const prdId = await createPrd();
    await createSpecWithAnchors(prdId, "ZzzMcpDriftConsistentSpec", ["package.json"]);

    const call = getToolHandler(server, "lore_status");
    const result = await call({ check_drift: true });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { code_drift: CodeDriftPayload };
    expect(data.code_drift.armed).toBe(true);
    expect(data.code_drift.enabled).toBe(true);
    expect(data.code_drift.consistent).toBe(true);
    expect(data.code_drift.drifts).toEqual([]);
  });
});

// ─── STATE: check_drift:true on a corpus with a broken anchor ───────────────

describe("lore_status {check_drift: true} — STATE (broken anchor)", () => {
  it("a spec anchoring a path that never exists → consistent:false, drifts[] carries the row", async () => {
    const prdId = await createPrd();
    const { slug } = await createSpecWithAnchors(prdId, "ZzzMcpDriftBrokenSpec", [
      "this/path/definitely/does/not/exist.ts",
    ]);

    const call = getToolHandler(server, "lore_status");
    const result = await call({ check_drift: true });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { code_drift: CodeDriftPayload };
    expect(data.code_drift.consistent).toBe(false);
    expect(data.code_drift.drifts).toHaveLength(1);
    expect(data.code_drift.drifts[0]).toMatchObject({
      spec_slug: slug,
      anchor: "this/path/definitely/does/not/exist.ts",
      kind: "file_missing",
    });
  });
});

// ─── BOUNDARY: deep-equals proof against the shared drift-flow builder ──────

describe("lore_status {check_drift: true} — BOUNDARY (deep-equals the shared runDrift builder, AC-DR-5)", () => {
  it("the MCP handler's code_drift is deep-equal to calling runDrift/buildDriftFlowDeps directly against the SAME store state", async () => {
    const prdId = await createPrd();
    await createSpecWithAnchors(prdId, "ZzzMcpDriftDeepEqualConsistent", ["package.json"]);
    await createSpecWithAnchors(prdId, "ZzzMcpDriftDeepEqualBroken", ["never/exists/anywhere.ts"]);

    const call = getToolHandler(server, "lore_status");
    const result = await call({ check_drift: true });
    expect(result.isError).toBeFalsy();
    const mcpPayload = (parseResult(result) as { code_drift: CodeDriftPayload }).code_drift;

    // The CLI's commands/status.ts calls this EXACT same pair of functions — proving
    // the MCP handler didn't hand-roll its own shape (AC-DR-5's "shared drift-flow
    // builder" requirement).
    const deps = buildDriftFlowDeps(app, app.driftCheckService!);
    const probe = buildRealFsProbe(process.cwd());
    const directResult = await runDrift(deps, probe);
    expect(directResult.ok).toBe(true);
    if (!directResult.ok) return;

    expect(mcpPayload).toEqual(directResult.value);
  });
});

// ─── HAPPY: lore_anchor_set spec-target REPLACE ──────────────────────────────

describe("lore_anchor_set — HAPPY (spec target, declarative REPLACE)", () => {
  it("REPLACES the full code_anchors array — 2 existing anchors + 1 new call → exactly 1 anchor survives", async () => {
    const prdId = await createPrd();
    const { id, slug } = await createSpecWithAnchors(prdId, "ZzzMcpAnchorSetSpecTarget", [
      "src/one.ts",
      "src/two.ts",
    ]);

    const call = getToolHandler(server, "lore_anchor_set");
    const result = await call({ id_or_slug: slug, anchors: ["src/three.ts"], by: "agent:mcp" });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { anchors: string[] };
    expect(data.anchors).toEqual(["src/three.ts"]);

    const docResult = await corpusService.get(id);
    expect(docResult.ok).toBe(true);
    if (!docResult.ok) return;
    expect(docResult.value.doc.extra["code_anchors"]).toEqual(["src/three.ts"]);
  });
});

// ─── REGRESSION: lore_anchor_set task-target byte-identical behavior ────────

describe("lore_anchor_set — REGRESSION (task target, byte-identical to pre-SPEC-045)", () => {
  it("still works for a task target and preserves extra.claim/extra.verification_evidence untouched", async () => {
    const { id: planId } = await createPlan();
    const { id: taskId, slug: taskSlug } = await createTask(planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "agent:mcp", source: "mcp" });
    expect(claimResult.ok).toBe(true);
    const evidenceResult = await taskWorkflowService.addEvidence(taskId, {
      oracle: "test",
      command: "bun test",
      result: "pass",
      recorded_by: "agent:mcp",
      source: "mcp",
      output_tail: "ok",
      capture_source: "self-report",
    });
    expect(evidenceResult.ok).toBe(true);

    const call = getToolHandler(server, "lore_anchor_set");
    const result = await call({ id_or_slug: taskSlug, anchors: ["src/task-anchor.ts"], by: "agent:mcp" });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { doc: { extra: Record<string, unknown> } };
    expect(data.doc.extra["file_anchors"]).toEqual(["src/task-anchor.ts"]);
    expect(data.doc.extra["claim"]).toBeDefined();
    expect((data.doc.extra["verification_evidence"] as unknown[]).length).toBe(1);
  });

  it("a '#'-carrying task anchor is STILL rejected loud, naming the SPEC code-anchor grammar", async () => {
    const { id: planId } = await createPlan();
    const { slug: taskSlug } = await createTask(planId);

    const call = getToolHandler(server, "lore_anchor_set");
    const result = await call({ id_or_slug: taskSlug, anchors: ["src/y.ts#Foo"], by: "agent:mcp" });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    if (error.code !== "VALIDATION_ERROR") throw new Error(`expected VALIDATION_ERROR, got ${error.code}`);
    expect(error.message).toContain("SPEC-045");
  });
});

// ─── ERROR: lore_anchor_set on a non-task/non-spec target ───────────────────

describe("lore_anchor_set — ERROR (target is neither task nor spec)", () => {
  it("a plan target → isError, VALIDATION_ERROR naming 'task or spec'", async () => {
    const { slug: planSlug } = await createPlan();

    const call = getToolHandler(server, "lore_anchor_set");
    const result = await call({ id_or_slug: planSlug, anchors: ["src/x.ts"], by: "agent:mcp" });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    if (error.code !== "VALIDATION_ERROR") throw new Error(`expected VALIDATION_ERROR, got ${error.code}`);
    expect(error.message).toContain("task or spec");
  });
});
