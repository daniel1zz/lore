// @layer mcp-adapter
/**
 * ES-D on the MCP surface: a server with no known party (no attested run) is an UNNAMED invocation. Only what needs
 * an actor fails; reads proceed, and nothing is dropped silently
 * (spec-process-state-end-state-one-invocation-per-entry-returned D1, rule AS-26; BR-1351).
 *
 * Covers: HAPPY (a read tool that never needs `by` proceeds), NEGATIVE (a write tool refuses naming the reason; a read
 * tool that needs the caller's name refuses the same way), BOUNDARY (an explicit read filter `by` needs no name),
 * STATE (the same server with a session name works everywhere), REGRESSION (the context-bundle trace is reported as
 * not recorded in the response, never skipped silently).
 */

import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, InvocationIdentity, RunId } from "@lore/core";
import { NoOpTelemetry, ok } from "@lore/core";
import { refusalNamingHowToBecomeKnown } from "@lore/core/node";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { actedStore, liveInvocation } from "../../live-invocation.js";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

const REASON = refusalNamingHowToBecomeKnown("The server has no known party.");

/** Every refusal of a call with no known party names both remedies (BR-1351). */
function expectNamesBothRemedies(refusal: string): void {
  expect(refusal).toContain("lore session start --human");
  expect(refusal).toContain("lore setup");
}
const SESSION_ENV = { CLAUDE_CODE_SESSION_ID: "3de02220-aaaa-bbbb-cccc-111122223333" };

interface Fixture {
  readonly server: McpServer;
  readonly corpusService: CorpusService;
}

/** An MCP server over an in-memory corpus whose invocation has the given env and a FAILED OS user lookup. */
function fixture(env: Record<string, string>): Fixture {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10_080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });
  const app: App = {
    warn: () => undefined,
    corpusService,
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: {} as ApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 }, async () => ok(new Set())),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
    sessionService,
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const base = liveInvocation();
  const inv = { ...base, env };
  // reason: the identity the entry would have resolved: no known party, or an attested run named by the session
  const identity: InvocationIdentity =
    env["CLAUDE_CODE_SESSION_ID"] === undefined
      ? { harnessRun: null, claimed: null, claimedSource: null, unresolvedReason: REASON }
      : { harnessRun: `cc:${env["CLAUDE_CODE_SESSION_ID"]}` as RunId, claimed: "agent:session-3de02220", claimedSource: "run" };
  registerTools(server, app, undefined, { ...inv, identity });
  return { server, corpusService };
}

type McpServerInternal = { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }> };

function call(server: McpServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = (server as unknown as McpServerInternal)._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool.handler(args, {} as unknown);
}

function text(result: CallToolResult): string {
  const part = result.content[0];
  if (!part || part.type !== "text") throw new Error("Expected text content");
  return part.text;
}

async function seedPlan(corpusService: CorpusService): Promise<string> {
  const created = await corpusService.create({ type: "plan", title: "Seed plan", content: "# Plan", by: "seed" } as CreateDocInput);
  if (!created.ok) throw new Error(`seed failed: ${JSON.stringify(created.error)}`);
  return created.value.slug;
}

describe("ES-D MCP: an unnamed server (no known party)", () => {
  it("a read tool that never needs the caller's name proceeds", async () => {
    const { server, corpusService } = fixture({});
    const slug = await seedPlan(corpusService);
    const result = await call(server, "lore_get", { id_or_slug: slug });
    expect(result.isError).toBeFalsy();
  });

  it("a read tool given an explicit read filter `by` proceeds without a name", async () => {
    const { server } = fixture({});
    const result = await call(server, "lore_bootstrap", { by: "alice" });
    expect(result.isError).toBeFalsy();
  });

  it("a read tool that defaults to the caller's own name refuses, naming the reason", async () => {
    const { server } = fixture({});
    const result = await call(server, "lore_bootstrap", {});
    expect(result.isError).toBe(true);
    expectNamesBothRemedies(text(result));
  });

  it("a write tool refuses, naming both remedies, and writes nothing", async () => {
    const { server, corpusService } = fixture({});
    const result = await call(server, "lore_create", { type: "plan", title: "Unnamed plan", content: "# Plan" });
    expect(result.isError).toBe(true);
    expectNamesBothRemedies(text(result));
    const listed = await corpusService.list({ type: "plan" });
    expect(listed.ok && listed.value.docs.map((d) => d.title)).not.toContain("Unnamed plan");
  });

  it("an identity-recording tool (claim) refuses, naming both remedies, before looking up its target", async () => {
    const { server } = fixture({});
    const result = await call(server, "lore_claim", { id_or_slug: "no-such-task" });
    expect(result.isError).toBe(true);
    expectNamesBothRemedies(text(result));
  });

  it("the context bundle is served and says its trace was not recorded and why", async () => {
    const { server, corpusService } = fixture({});
    const slug = await seedPlan(corpusService);
    const result = await call(server, "lore_context_bundle", { id_or_slug: slug });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(text(result)) as { trace_not_recorded?: string; target: { slug: string } };
    expect(payload.target.slug).toBe(slug);
    expect(payload.trace_not_recorded).toContain("trace not recorded");
    expect(payload.trace_not_recorded).toContain(REASON);
  });
});

describe("ES-D MCP: the same server with an attested run", () => {
  it("reports no missing trace on a read (the real per-call attested write path is exercised by write-requires-known-party.bun.test.ts)", async () => {
    const { server, corpusService } = fixture(SESSION_ENV);
    const slug = await seedPlan(corpusService);
    const bundle = await call(server, "lore_context_bundle", { id_or_slug: slug });
    expect(JSON.parse(text(bundle))).not.toHaveProperty("trace_not_recorded");
  });

  it("a call naming harness_run against an App with no per-call write context is refused loudly (it cannot attest)", async () => {
    const { server } = fixture(SESSION_ENV);
    const result = await call(server, "lore_create", { harness_run: `cc:${SESSION_ENV.CLAUDE_CODE_SESSION_ID}`, type: "plan", title: "Named plan", content: "# Plan" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("cannot attest");
  });
});
