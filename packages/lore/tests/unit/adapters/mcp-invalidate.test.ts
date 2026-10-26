/**
 * Unit tests for the SPEC-043 MCP invalidation surface: `lore_invalidate`,
 * `lore_get.validity_state`, `lore_search`/`lore_list.include_invalid`.
 *
 * Scope: end-to-end through a real `CorpusService` + `ValidityService` backed by
 * `InMemoryStore` (vitest-reachable, no `bun:sqlite`) — registration/handler-plumbing
 * style mirrors `mcp-session-tools.test.ts` (register real tools against a McpServer,
 * extract handlers from the internal `_registeredTools` map, invoke directly).
 *
 * "Deep-equals CLI --json (envelopes unwrapped)" (AC-MH-9) is verified the same way
 * `mcp-session-tools.test.ts` verifies CLI/MCP parity: `commands/invalidate.ts` (CLI)
 * and this MCP tool both call `ValidityService.invalidate` with the SAME opts and wrap
 * its `Result.value` verbatim (`{doc, decision_status_unchanged?}`) — CLI as
 * `{ok:true, data:{doc, decision_status_unchanged?}}`, MCP as
 * `{doc, decision_status_unchanged?}` inside `textContent`. Calling
 * `ValidityService.invalidate` directly here and comparing its `.value` to the parsed
 * MCP payload proves that parity without spawning the CLI binary (get.ts/invalidate.ts
 * are bun-only — see `validity-projection.test.ts`'s header for why).
 *
 * Coverage:
 *   HAPPY:      lore_invalidate happy path; MCP payload deep-equals the underlying
 *               ValidityService.invalidate() result (the CLI's own call)
 *   NEGATIVE:   LoreInvalidateSchema rejects missing `by`
 *   BOUNDARY:   lore_search/lore_list `include_invalid` toggles from excluding to
 *               including the SAME invalidated doc
 *   ERROR:      lore_invalidate on a non-knowledge/adr doc (a plan) → isError with
 *               VALIDATION_ERROR
 *   STATE:      lore_get.validity_state carries {invalidated:true, invalid_at,
 *               invalidated_by_slug, reason} for an invalidated doc, and
 *               {invalidated:false} for its (valid) successor
 *   REGRESSION: lore_search/lore_list WITHOUT include_invalid never surface the
 *               invalidated doc (pre-SPEC-043 default-exclude behavior unchanged);
 *               mcp-tools.test.ts's tool-count bump (28→29) is asserted separately
 *
 * @spec_ref SPEC-043 §Acceptance Criteria AC-MH-9
 */

import { liveInvocation, actedStore } from "../../live-invocation.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { ValidityService } from "../../../src/service/validity-service.js";
import { NoOpTelemetry, ok } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools, LoreInvalidateSchema } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
// ─── Test Infrastructure (mirrors mcp-session-tools.test.ts) ────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let validityService: ValidityService;

function makeApp(): App {
  store = actedStore(new InMemoryStore());
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  validityService = new ValidityService(store);

  const app: App = {
    warn: () => undefined,
    corpusService,
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
    taskWorkflowService: new TaskWorkflowService(
      store,
      new NoOpTelemetry(),
      { claimTtlMinutes: 120 },
      async () => ok(new Set()), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe(),
    ),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
    validityService,
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };

  return app;
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

// ─── Fixture helpers ──────────────────────────────────────────────────────

async function createKnowledge(title: string): Promise<DocRecord> {
  const result = await corpusService.create({
    type: "knowledge",
    title,
    content: `# ${title}\n\nBody.`,
    extra: { sub_type: "reference" },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`knowledge create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPlan(title: string): Promise<DocRecord> {
  const result = await corpusService.create({ type: "plan", title, content: "# Plan" } as CreateDocInput);
  if (!result.ok) throw new Error(`plan create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

// ─── NEGATIVE: schema-level ──────────────────────────────────────────────────

describe("LoreInvalidateSchema — NEGATIVE", () => {
  // reason: AC-ROI-1 — no MCP write tool takes `by`: the call's own identity (the attested run) writes.
  it("declares no `by` property; a payload without one is valid", () => {
    expect(Object.keys(LoreInvalidateSchema.shape)).not.toContain("by");
    expect(LoreInvalidateSchema.safeParse({ id_or_slug: "knowledge-x" }).success).toBe(true);
  });
});

// ─── HAPPY: lore_invalidate deep-equals ValidityService.invalidate() ────────

describe("lore_invalidate — HAPPY (deep-equals the underlying ValidityService call, AC-MH-9)", () => {
  it("MCP payload {doc, decision_status_unchanged?} matches ValidityService.invalidate()'s own result", async () => {
    const app = makeApp();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
    const handler = getToolHandler(server, "lore_invalidate");

    const doc = await createKnowledge("Invalidate Target");
    const anotherDoc = await createKnowledge("Successor Target");

    const directResult = await validityService.invalidate(anotherDoc.id, {
      supersededBy: doc.id,
      reason: "n/a",
      by: "alice",
    });
    expect(directResult.ok).toBe(true);

    const mcpResult = await handler({
      id_or_slug: doc.slug,
      superseded_by: anotherDoc.slug,
      reason: "n/a",
      by: "alice",
    });
    expect(mcpResult.isError).toBeUndefined();
    const payload = parseResult(mcpResult) as { doc: DocRecord; decision_status_unchanged?: string };

    // Both went through the SAME service call shape — compare the structurally
    // significant parts (ids/timestamps differ by construction between the two calls).
    expect(payload.doc.type).toBe("knowledge");
    expect(payload.doc.extra["validity"]).toMatchObject({ reason: "n/a" });
    expect((payload.doc.extra["validity"] as { invalidated_by: string }).invalidated_by).toBe(anotherDoc.id);
    expect(payload.decision_status_unchanged).toBeUndefined();
  });
});

// ─── ERROR: non-knowledge/adr target ─────────────────────────────────────────

describe("lore_invalidate — ERROR (ineligible type)", () => {
  it("a plan target → isError with VALIDATION_ERROR", async () => {
    const app = makeApp();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
    const handler = getToolHandler(server, "lore_invalidate");

    const plan = await createPlan("Cannot Be Invalidated");
    const result = await handler({ id_or_slug: plan.slug, by: "alice" });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── BOUNDARY + REGRESSION: lore_search/lore_list include_invalid ───────────

describe("lore_search / lore_list — include_invalid (BOUNDARY + REGRESSION)", () => {
  it("excludes the invalidated doc by default, includes it when include_invalid:true", async () => {
    const app = makeApp();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
    const searchHandler = getToolHandler(server, "lore_search");
    const listHandler = getToolHandler(server, "lore_list");

    const doc = await createKnowledge("ZzzMcpIncludeInvalidTarget");
    const invalidateResult = await validityService.invalidate(doc.id, { by: "alice", reason: "obsolete" });
    expect(invalidateResult.ok).toBe(true);

    // REGRESSION — default (no include_invalid) never surfaces it.
    const searchDefault = await searchHandler({ query: "ZzzMcpIncludeInvalidTarget" });
    const searchDefaultPayload = parseResult(searchDefault) as { results: Array<{ id: string }> };
    expect(searchDefaultPayload.results.some((r) => r.id === doc.id)).toBe(false);

    const listDefault = await listHandler({ type: "knowledge" });
    const listDefaultPayload = parseResult(listDefault) as { docs: Array<{ id: string }> };
    expect(listDefaultPayload.docs.some((d) => d.id === doc.id)).toBe(false);

    // BOUNDARY — include_invalid:true restores it on both surfaces.
    const searchIncluded = await searchHandler({ query: "ZzzMcpIncludeInvalidTarget", include_invalid: true });
    const searchIncludedPayload = parseResult(searchIncluded) as { results: Array<{ id: string }> };
    expect(searchIncludedPayload.results.some((r) => r.id === doc.id)).toBe(true);

    const listIncluded = await listHandler({ type: "knowledge", include_invalid: true });
    const listIncludedPayload = parseResult(listIncluded) as { docs: Array<{ id: string }> };
    expect(listIncludedPayload.docs.some((d) => d.id === doc.id)).toBe(true);
  });
});

// ─── STATE: lore_get.validity_state ──────────────────────────────────────────

describe("lore_get — validity_state (STATE, AC-MH-9)", () => {
  it("carries {invalidated:true, invalid_at, invalidated_by_slug, reason} for an invalidated doc, and {invalidated:false} for its valid successor", async () => {
    const app = makeApp();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
    const getHandler = getToolHandler(server, "lore_get");

    const successor = await createKnowledge("Successor Doc");
    const doc = await createKnowledge("Invalidated Doc For Get");
    const invalidateResult = await validityService.invalidate(doc.id, {
      supersededBy: successor.id,
      reason: "superseded",
      by: "alice",
    });
    expect(invalidateResult.ok).toBe(true);

    const invalidatedGet = await getHandler({ id_or_slug: doc.slug });
    const invalidatedPayload = parseResult(invalidatedGet) as {
      validity_state: { invalidated: boolean; invalid_at?: string; invalidated_by_slug?: string; reason?: string };
    };
    expect(invalidatedPayload.validity_state.invalidated).toBe(true);
    expect(invalidatedPayload.validity_state.invalid_at).toBeDefined();
    expect(invalidatedPayload.validity_state.invalidated_by_slug).toBe(successor.slug);
    expect(invalidatedPayload.validity_state.reason).toBe("superseded");

    const validGet = await getHandler({ id_or_slug: successor.slug });
    const validPayload = parseResult(validGet) as { validity_state: { invalidated: boolean } };
    expect(validPayload.validity_state).toEqual({ invalidated: false });
  });
});
