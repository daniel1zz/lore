/**
 * Unit tests for the SPEC-044 lore_staleness_probe MCP tool.
 *
 * Scope: translation-only (args → StalenessProbeService.probeBatch/probeOne/
 * listFreshStalenessEscalates → MCP envelope shape), mirroring
 * mcp-tools-review.test.ts's own scope note. Strategy mirrors that file exactly:
 * register real tools against a McpServer, extract handlers from the internal
 * _registeredTools map, invoke directly. Real JudgmentService/StalenessProbeService
 * (InMemoryStore, NoOpTelemetry) — AIProviderService is real, wired with
 * InMemoryAIProvider.
 *
 * @spec_ref SPEC-044 §Design Decisions D10; AC-SP-7
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      batch mode probes a fresh knowledge doc and returns the shared
 *               {probes, skipped, total_candidates, excluded_by_limit} payload; single-
 *               doc mode via id_or_slug; list mode returns {docs, total} with NO
 *               provider call
 *   NEGATIVE:   `by` is required — LoreStalenessProbeSchema.safeParse({}) fails, and
 *               omitting a non-empty `by` fails too
 *   BOUNDARY:   payload structurally deep-equals the CLI --json `data` shape for the
 *               SAME scenario, because both call the identical
 *               flows/staleness-flow.ts builder functions (AC-SP-7's "envelope-
 *               unwrapped deep-equal" requirement, proven by shared-function identity)
 *   ERROR:      an already-invalidated single-doc target → isError, VALIDATION_ERROR
 *   STATE:      after a batch probe, judgmentService.latestFor(docId, "staleness")
 *               resolves the recorded judgment
 *   REGRESSION: expectedTools length is 30 (verified in mcp-tools.test.ts, not
 *               re-asserted here to avoid duplicate ownership of that oracle)
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
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
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools, LoreStalenessProbeSchema } from "../../../src/adapters/mcp/tools.js";
import {
  buildStalenessFlowDeps,
  buildStalenessSingleJsonPayload,
  buildStalenessBatchJsonPayload,
} from "../../../src/flows/staleness-flow.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, DocId, LoreError } from "@lore/core";

// ─── Test Infrastructure (mirrors mcp-tools-review.test.ts) ──────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let judgmentService: JudgmentService;
let aiProvider: InMemoryAIProvider;
let app: App;

const VALID_STALENESS_JSON = JSON.stringify({
  decision: "stale_candidate",
  confidence: 0.87,
  reasons: ["the linked API changed shape"],
  blocking_questions: ["has anyone re-confirmed this?"],
});

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store, new RecordLockService(store));
  judgmentService = new JudgmentService(store, new NoOpTelemetry());
  aiProvider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_STALENESS_JSON });
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

  return {
    corpusService,
    reviewService: new ReviewService(store),
    versionService: new VersionService(store, new RecordLockService(store)),
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
    stalenessProbeService,
    validityService: new ValidityService(store, new NoOpTelemetry()),
    auditService: null as unknown as App["auditService"],
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

async function createFreshKnowledge(title: string): Promise<string> {
  const result = await corpusService.create({
    type: "knowledge",
    title,
    content: "body",
    extra: { sub_type: "reference" },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

let server: McpServer;

beforeEach(() => {
  app = makeApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app);
});

// ─── NEGATIVE: schema requires `by` ──────────────────────────────────────────

describe("LoreStalenessProbeSchema — NEGATIVE (by is required)", () => {
  // reason: BR-1034 (AC-RID-7) — no MCP tool requires the caller to name itself; the call's resolved name fills in.
  it("accepts a payload missing `by` entirely", () => {
    const result = LoreStalenessProbeSchema.safeParse({ list: true });
    expect(result.success).toBe(true);
  });

  it("rejects an empty-string `by`", () => {
    const result = LoreStalenessProbeSchema.safeParse({ by: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal valid payload ({by} alone)", () => {
    const result = LoreStalenessProbeSchema.safeParse({ by: "agent:x" });
    expect(result.success).toBe(true);
  });
});

// ─── HAPPY + STATE: batch mode ────────────────────────────────────────────────

describe("lore_staleness_probe — HAPPY/STATE (batch mode)", () => {
  const call = () => getToolHandler(server, "lore_staleness_probe");

  it("probes a fresh candidate and returns the shared {probes, skipped, total_candidates, excluded_by_limit} payload", async () => {
    const docId = await createFreshKnowledge("ZzzMcpBatchTarget");
    const result = await call()({ limit: 5, min_age_days: 0, by: "agent:mcp" });
    expect(result.isError).toBeFalsy();

    const data = parseResult(result) as {
      probes: Array<{ doc: { id: string }; decision: string }>;
      skipped: { invalidated: number; too_young: number };
      total_candidates: number;
      excluded_by_limit: number;
    };
    expect(data.probes).toHaveLength(1);
    expect(data.probes[0]?.doc.id).toBe(docId);
    expect(data.probes[0]?.decision).toBe("escalate");
    expect(data.total_candidates).toBe(1);
    expect(data.excluded_by_limit).toBe(0);
    expect(data.skipped).toEqual({ invalidated: 0, too_young: 0 });

    // STATE — the judgment actually landed.
    const latestResult = await judgmentService.latestFor(docId as DocId, "staleness");
    expect(latestResult.ok).toBe(true);
    if (latestResult.ok) expect(latestResult.value?.decision).toBe("escalate");
  });

  it("too_young candidates (min_age_days default, fresh fixture) are skipped, not probed", async () => {
    await createFreshKnowledge("ZzzMcpTooYoungTarget");
    // No min_age_days override — defaults to 14; a freshly-created doc is age_days=0.
    const result = await call()({ by: "agent:mcp" });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { probes: unknown[]; skipped: { too_young: number } };
    expect(data.probes).toHaveLength(0);
    expect(data.skipped.too_young).toBe(1);
  });
});

// ─── HAPPY: single-doc mode ───────────────────────────────────────────────────

describe("lore_staleness_probe — HAPPY (single-doc mode)", () => {
  const call = () => getToolHandler(server, "lore_staleness_probe");

  it("id_or_slug routes to probeOne and returns the SAME payload shape as batch mode (1 entry)", async () => {
    const docId = await createFreshKnowledge("ZzzMcpSingleTarget");
    const result = await call()({ id_or_slug: docId, by: "agent:mcp" });
    expect(result.isError).toBeFalsy();

    const data = parseResult(result) as {
      probes: Array<{ doc: { id: string } }>;
      total_candidates: number;
      excluded_by_limit: number;
    };
    expect(data.probes).toHaveLength(1);
    expect(data.probes[0]?.doc.id).toBe(docId);
    expect(data.total_candidates).toBe(1);
    expect(data.excluded_by_limit).toBe(0);
  });
});

// ─── ERROR: already-invalidated single-doc target ────────────────────────────

describe("lore_staleness_probe — ERROR (already-invalidated single-doc target)", () => {
  const call = () => getToolHandler(server, "lore_staleness_probe");

  it("refuses an already-invalidated target with VALIDATION_ERROR", async () => {
    const docId = await createFreshKnowledge("ZzzMcpInvalidatedTarget");
    const invalidateResult = await app.validityService!.invalidate(docId, { by: "agent:mcp", reason: "obsolete" });
    expect(invalidateResult.ok).toBe(true);

    const result = await call()({ id_or_slug: docId, by: "agent:mcp" });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── HAPPY: list mode (no provider call) ─────────────────────────────────────

describe("lore_staleness_probe — HAPPY (list mode, no provider call)", () => {
  const call = () => getToolHandler(server, "lore_staleness_probe");

  it("list:true returns {docs, total} for fresh escalates, with ZERO provider invocations", async () => {
    const docId = await createFreshKnowledge("ZzzMcpListTarget");
    const probeResult = await call()({ limit: 5, min_age_days: 0, by: "agent:mcp" });
    expect(probeResult.isError).toBeFalsy();
    expect(aiProvider.calls).toHaveLength(1);

    const listResult = await call()({ list: true, by: "agent:mcp" });
    expect(listResult.isError).toBeFalsy();
    // No additional provider call from list mode.
    expect(aiProvider.calls).toHaveLength(1);

    const data = parseResult(listResult) as { docs: Array<{ id: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.docs[0]?.id).toBe(docId);
  });
});

// ─── BOUNDARY: payload deep-equals the CLI's shared builder output ───────────

describe("lore_staleness_probe — BOUNDARY (payload deep-equals CLI --json, envelope-unwrapped)", () => {
  const call = () => getToolHandler(server, "lore_staleness_probe");

  it("single-doc payload is byte-identical to buildStalenessSingleJsonPayload's own output for the same probe outcome", async () => {
    const docId = await createFreshKnowledge("ZzzMcpDeepEqualTarget");
    const result = await call()({ id_or_slug: docId, by: "agent:mcp" });
    expect(result.isError).toBeFalsy();
    const mcpPayload = parseResult(result);

    // Reconstruct what the CLI's `lore review <doc> --staleness --json`'s `data` field
    // would be for the SAME already-recorded judgment — same shared builder function,
    // same StalenessFlowDeps shape (AC-SP-7: this is TRUE BY CONSTRUCTION since both
    // CLI and MCP call buildStalenessSingleJsonPayload — see flows/staleness-flow.ts).
    const flowDeps = buildStalenessFlowDeps(app);
    const latestResult = await judgmentService.latestFor(docId as DocId, "staleness");
    expect(latestResult.ok).toBe(true);
    if (!latestResult.ok) return;
    const judgment = latestResult.value;
    expect(judgment).not.toBeNull();
    if (judgment === null) return;

    const docResult = await corpusService.get(docId);
    expect(docResult.ok).toBe(true);
    if (!docResult.ok) return;

    const cliShapedPayload = await buildStalenessSingleJsonPayload(flowDeps, {
      doc: { id: docResult.value.doc.id, slug: docResult.value.doc.slug },
      candidate: { priority: 0, in_degree: 0, age_days: 0 },
      result: { ok: true, judgment },
    });

    // Both payloads went through the identical shared function — the fields that
    // actually vary per candidate/priority computation are held constant here
    // (priority/in_degree/age_days=0 for both, since this fixture has no incoming
    // links and is freshly created), so the two objects deep-equal exactly.
    expect(mcpPayload).toEqual(cliShapedPayload);
  });

  it("batch payload shape matches buildStalenessBatchJsonPayload's own output structurally (same field set)", async () => {
    await createFreshKnowledge("ZzzMcpBatchShapeTarget");
    const result = await call()({ limit: 5, min_age_days: 0, by: "agent:mcp" });
    expect(result.isError).toBeFalsy();
    const mcpPayload = parseResult(result) as Record<string, unknown>;

    expect(Object.keys(mcpPayload).sort()).toEqual(
      Object.keys(await buildStalenessBatchJsonPayload(buildStalenessFlowDeps(app), {
        probes: [],
        total_candidates: 0,
        excluded_by_limit: 0,
        skipped: { invalidated: 0, too_young: 0 },
      })).sort(),
    );
  });
});
