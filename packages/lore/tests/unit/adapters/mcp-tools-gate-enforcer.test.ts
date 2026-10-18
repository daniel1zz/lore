/**
 * @spec_ref retro follow-up item 8 ("[arch] defense-in-depth")
 *
 * Proves the MCP surface specifically — `lore_create` (`registerTools`'s handler,
 * the exact call path an AI agent uses) — inherits `GateEnforcer` once it's wired
 * into `CorpusService`, the SAME optional-DI wiring `app.ts` performs in production.
 * This is the "actual bypass closure" the task calls for: before this task, an MCP
 * caller invoking `lore_create` never went through `lore gate spec-create` (a
 * separate CLI command an agent/CI hook shells out to) and so could create an
 * ungated spec; this test proves that is no longer possible once the service is
 * gate-wired, using the SAME `registerTools(server, app)` production wiring
 * `mcp-tools.test.ts` uses (InMemoryStore — no bun:sqlite needed to prove this).
 *
 * Coverage:
 *   HAPPY:      lore_create for type=spec with a `## ` skeleton heading PASSES
 *   NEGATIVE:   lore_create for type=spec with no skeleton heading is BLOCKED
 *               (isError=true, VALIDATION_ERROR, field "gate:spec-create") — the
 *               bypass-closure proof
 *   REGRESSION: lore_create for type=prd is untouched by the spec-create checkpoint
 *               (it only fires for type==="spec") — proves the gate is scoped, not a
 *               blanket lore_create block
 */

import { liveInvocation } from "../../live-invocation.js";
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
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ─── Test Infrastructure (mirrors mcp-tools.test.ts's makeApp, plus a wired GateEnforcer) ──

const stubApiKeyStore = {} as ApiKeyStore;

/**
 * Same shape as `mcp-tools.test.ts::makeApp`, except `corpusService` is constructed
 * WITH a real `GateEnforcer` (default config — undefined — so every checkpoint is
 * enabled per `resolveGateEnabled`'s default-ON contract), mirroring exactly what
 * `app.ts`'s `buildAppFromSqlite`/`buildAppFromTurso` wire in production.
 */
function makeGatedApp(): App {
  const store = new InMemoryStore();
  const gateEnforcer = new GateEnforcer(undefined);
  return {
    corpusService: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), new NoOpTelemetry(), undefined, gateEnforcer),
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
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(store, new NoOpTelemetry()),
    auditService: null as unknown as App["auditService"],
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
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

// ─── Test Setup ──────────────────────────────────────────────────────────────

let app: App;
let server: McpServer;

beforeEach(() => {
  app = makeGatedApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app, undefined, liveInvocation());
});

// ─── lore_create — MCP-path gate closure ─────────────────────────────────────

describe("lore_create — GateEnforcer wired (MCP surface, retro follow-up item 8)", () => {
  const call = () => getToolHandler(server, "lore_create");

  it("NEGATIVE: type=spec with no `## ` skeleton heading is BLOCKED (isError, gate:spec-create)", async () => {
    const prdResult = await call()({ type: "prd", title: "Parent PRD" });
    const prd = parseResult(prdResult) as { id: string };

    const specResult = await call()({
      type: "spec",
      title: "Ungated Agent Spec",
      content: "no heading here",
    });

    expect(specResult.isError).toBe(true);
    const error = parseResult(specResult) as { code: string; field?: string; message?: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("gate:spec-create");
    expect(error.message).toContain("MISSING_SKELETON");
  });

  it("HAPPY: type=spec with a `## ` skeleton heading PASSES", async () => {
    const prdResult = await call()({ type: "prd", title: "Parent PRD" });
    const prd = parseResult(prdResult) as { id: string };

    const specResult = await call()({
      type: "spec",
      title: "Gated Agent Spec",
      content: "## Overview\n\nSpec body.\n",
    });

    expect(specResult.isError).toBeFalsy();
    const spec = parseResult(specResult) as { type: string };
    expect(spec.type).toBe("spec");
  });

  it("REGRESSION: type=prd is unaffected by the spec-create checkpoint (scoped, not blanket)", async () => {
    const result = await call()({ type: "prd", title: "Untouched PRD" });
    expect(result.isError).toBeFalsy();
  });
});
