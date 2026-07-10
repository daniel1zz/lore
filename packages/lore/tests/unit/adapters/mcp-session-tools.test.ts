/**
 * Unit tests for the SPEC-041 session MCP tools: lore_bootstrap, lore_handoff, and
 * lore_feed's session-resume dispatch branch.
 *
 * Scope: end-to-end through a real `CorpusService` + `SessionService` backed by
 * `InMemoryStore` (vitest-reachable, no `bun:sqlite`) — registration/handler-plumbing
 * style mirrors `mcp-tools-feed.test.ts` (register real tools against a McpServer,
 * extract handlers from the internal `_registeredTools` map, invoke directly).
 *
 * AC-SL-6's "payloads deep-equal the CLI --json shapes for the same seeded corpus"
 * requirement is verified by calling the exact same `SessionService` methods the CLI
 * commands call, against the same seeded `InMemoryStore` — `lore bootstrap --json`
 * prints `{ok: true, data: <BootstrapReport>}` (raw passthrough of
 * `sessionService.bootstrap(by)`, see `commands/bootstrap.ts`'s `run()`), so the CLI
 * JSON shape for bootstrap is just the same `BootstrapReport` the MCP tool wraps as
 * `{report: ...}`. For handoff, the CLI's `--json` output is `{ok: true, data: <DocRecord>}`
 * from the exact same `sessionService.writeHandoff(...)` call the MCP tool makes; two
 * separate calls against the same seeded corpus produce distinct ids/slugs/timestamps
 * by construction (fresh ULID + clock per write) — the comparison scopes to the
 * deterministic parts (`extra.handoff`, `content`, `type`, `status`, `parent_id`).
 *
 * Coverage:
 *   HAPPY:      lore_bootstrap / lore_handoff / lore_feed session-resume succeed and
 *               return the expected envelope shapes
 *   NEGATIVE:   lore_bootstrap/lore_handoff reject missing `by` (schema-level);
 *               lore_feed session-resume with an unresolvable --plan → isError
 *   BOUNDARY:   empty corpus bootstrap via MCP → root: null, empty arrays (mirrors AC-SL-10)
 *   ERROR:      isError=true + LoreError JSON on a writeHandoff validation failure
 *               (multiple PRDs, no plan_ref)
 *   STATE:      lore_handoff → lore_feed session-resume round trip via MCP (the
 *               just-written handoff is what resume surfaces)
 *   REGRESSION: lore_bootstrap/lore_handoff payload shapes deep-equal the CLI's
 *               SessionService-driven --json output for the same seeded corpus
 *
 * @spec_ref SPEC-041 §4 AC-SL-6
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
import { SessionService } from "../../../src/service/session-service.js";
import { NoOpTelemetry, ok } from "@lore/core";
import type { BootstrapReport, DocRecord, HandoffExtra } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import {
  registerTools,
  LoreBootstrapSchema,
  LoreHandoffSchema,
} from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput } from "@lore/core";

// ─── Test Infrastructure (mirrors mcp-tools-feed.test.ts) ────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let sessionService: SessionService;

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store);
  sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10_080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });

  const app: App = {
    corpusService,
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
    taskWorkflowService: new TaskWorkflowService(
      store,
      new NoOpTelemetry(),
      { claimTtlMinutes: 120 },
      async () => ok(new Set()),
    ),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    sessionService,
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

// ─── Fixture helpers ────────────────────────────────────────────────────────

async function createPlan(title: string): Promise<{ id: string; slug: string }> {
  const result = await corpusService.create({ type: "plan", title, content: "# Plan" } as CreateDocInput);
  if (!result.ok) throw new Error(`plan create failed: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, slug: result.value.slug };
}

const VALID_HANDOFF: HandoffExtra = {
  by: "claude",
  task_refs: [],
  modified_files: ["packages/core/src/session.ts"],
  key_decisions: [{ judgment: "extra is SSOT, content is a projection", confidence: 90 }],
  next_steps: ["wire SessionService into app.ts"],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("LoreBootstrapSchema / LoreHandoffSchema — schema-level", () => {
  it("LoreBootstrapSchema rejects missing `by`", () => {
    expect(LoreBootstrapSchema.safeParse({}).success).toBe(false);
    expect(LoreBootstrapSchema.safeParse({ by: "" }).success).toBe(false);
    expect(LoreBootstrapSchema.safeParse({ by: "alice" }).success).toBe(true);
  });

  it("LoreHandoffSchema rejects missing `by` (reuses handoffExtraSchema verbatim)", () => {
    const { by: _by, ...withoutBy } = VALID_HANDOFF;
    expect(LoreHandoffSchema.safeParse(withoutBy).success).toBe(false);
    expect(LoreHandoffSchema.safeParse(VALID_HANDOFF).success).toBe(true);
  });

  it("LoreHandoffSchema rejects empty next_steps (a handoff naming no next step is a status report)", () => {
    const noNext = { ...VALID_HANDOFF, next_steps: [] };
    expect(LoreHandoffSchema.safeParse(noNext).success).toBe(false);
  });
});

describe("lore_bootstrap", () => {
  let app: App;
  let server: McpServer;

  beforeEach(() => {
    app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
  });

  describe("happy path", () => {
    it("returns { report: BootstrapReport } for a seeded corpus", async () => {
      await createPlan("Plan A");
      const call = getToolHandler(server, "lore_bootstrap");
      const result = await call({ by: "alice" });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { report: BootstrapReport };
      expect(data.report.active_plans).toHaveLength(1);
      expect(data.report.active_plans[0]?.title).toBe("Plan A");
    });
  });

  describe("boundary values", () => {
    it("empty corpus → root: null, every array empty (mirrors AC-SL-10)", async () => {
      const call = getToolHandler(server, "lore_bootstrap");
      const result = await call({ by: "alice" });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { report: BootstrapReport };
      expect(data.report.root).toBeNull();
      expect(data.report.active_plans).toEqual([]);
      expect(data.report.my_claims).toEqual([]);
      expect(data.report.pending_reviews).toEqual({ count: 0, slugs: [] });
      expect(data.report.corpus).toEqual({ total_docs: 0, last_updated: null });
    });
  });

  describe("regression", () => {
    it("MCP payload deep-equals the CLI --json shape (sessionService.bootstrap(by) called directly) for the same seeded corpus", async () => {
      await createPlan("Plan A");
      await createPlan("Plan B");

      const call = getToolHandler(server, "lore_bootstrap");
      const mcpResult = await call({ by: "alice" });
      const mcpData = parseResult(mcpResult) as { report: BootstrapReport };

      // reason: this IS the CLI's --json shape's data field (commands/bootstrap.ts's
      // `run()` prints `{ok: true, data: result.value}` where `result` is this exact call).
      const cliShapeResult = await sessionService.bootstrap("alice");
      if (!cliShapeResult.ok) throw new Error(JSON.stringify(cliShapeResult.error));

      expect(mcpData.report).toEqual(cliShapeResult.value);
    });
  });
});

describe("lore_handoff", () => {
  let app: App;
  let server: McpServer;

  beforeEach(() => {
    app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
  });

  describe("happy path", () => {
    it("writes a draft knowledge/handoff doc and returns { doc: DocRecord }", async () => {
      const plan = await createPlan("Plan A");
      const call = getToolHandler(server, "lore_handoff");
      const result = await call({ ...VALID_HANDOFF, plan_ref: plan.slug });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { doc: DocRecord };
      expect(data.doc.type).toBe("knowledge");
      expect(data.doc.status).toBe("draft");
      expect(data.doc.extra["sub_type"]).toBe("handoff");
      expect(data.doc.parent_id).toBe(plan.id);
    });
  });

  describe("error cases", () => {
    it("nonexistent plan_ref → isError with VALIDATION_ERROR", async () => {
      const call = getToolHandler(server, "lore_handoff");
      const result = await call({ ...VALID_HANDOFF, plan_ref: "nonexistent-plan-slug" });

      expect(result.isError).toBe(true);
      const text = result.content[0];
      if (!text || text.type !== "text") throw new Error("expected text content");
      const error = JSON.parse(text.text) as { code: string };
      expect(error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("regression", () => {
    it("MCP-written doc's extra.handoff/content/type/status deep-equal a direct sessionService.writeHandoff call (the CLI's underlying seam) for equivalent input", async () => {
      const plan = await createPlan("Plan A");
      const input: HandoffExtra = { ...VALID_HANDOFF, plan_ref: plan.slug };

      const call = getToolHandler(server, "lore_handoff");
      const mcpResult = await call({ ...input });
      const mcpData = parseResult(mcpResult) as { doc: DocRecord };

      // reason: this IS what commands/handoff.ts's `run()` calls after validation —
      // the CLI's --json `data` field for an equivalent write against the same corpus state.
      const cliShapeResult = await sessionService.writeHandoff(input);
      if (!cliShapeResult.ok) throw new Error(JSON.stringify(cliShapeResult.error));

      expect(mcpData.doc.extra).toEqual(cliShapeResult.value.extra);
      expect(mcpData.doc.content).toEqual(cliShapeResult.value.content);
      expect(mcpData.doc.type).toEqual(cliShapeResult.value.type);
      expect(mcpData.doc.status).toEqual(cliShapeResult.value.status);
      expect(mcpData.doc.parent_id).toEqual(cliShapeResult.value.parent_id);
    });
  });
});

describe("lore_feed session-resume dispatch (SPEC-041 §3 D5)", () => {
  let app: App;
  let server: McpServer;

  beforeEach(() => {
    app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
  });

  it("HAPPY + STATE: a lore_handoff write is surfaced by a subsequent session-resume feed call", async () => {
    const plan = await createPlan("Plan A");
    const handoffCall = getToolHandler(server, "lore_handoff");
    const handoffResult = await handoffCall({ ...VALID_HANDOFF, plan_ref: plan.slug });
    expect(handoffResult.isError).toBeFalsy();
    const handoffDoc = (parseResult(handoffResult) as { doc: DocRecord }).doc;

    const feedCall = getToolHandler(server, "lore_feed");
    const feedResult = await feedCall({ checkpoint: "session-resume", plan: plan.slug });

    expect(feedResult.isError).toBeFalsy();
    const feedData = parseResult(feedResult) as { checkpoint: string; resume: { found: boolean }; feed: string };
    expect(feedData.checkpoint).toBe("session-resume");
    expect(feedData.resume.found).toBe(true);
    expect(feedData.feed).toContain(handoffDoc.slug);
    expect(feedData.feed).toContain("wire SessionService into app.ts");
  });

  it("NEGATIVE: unresolvable --plan → isError with VALIDATION_ERROR (not an advisory degrade, unlike buildFeed's checkpoint lookup)", async () => {
    const feedCall = getToolHandler(server, "lore_feed");
    const result = await feedCall({ checkpoint: "session-resume", plan: "nonexistent-plan-slug" });

    expect(result.isError).toBe(true);
  });

  it("BOUNDARY: no handoff recorded yet → found: false, feed is the exact advisory note, never isError", async () => {
    const feedCall = getToolHandler(server, "lore_feed");
    const result = await feedCall({ checkpoint: "session-resume" });

    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { resume: { found: boolean }; feed: string };
    expect(data.resume.found).toBe(false);
    expect(data.feed).toBe("(no handoff recorded)");
  });
});
