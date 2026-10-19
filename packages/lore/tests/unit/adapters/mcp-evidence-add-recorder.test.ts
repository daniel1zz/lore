// @layer mcp-adapter AC-ROI-1 (in-process lore_evidence_add tool; owner drives the CLI write surface)
/**
 * `lore_evidence_add` takes no caller-named recorder (BR-1055).
 *
 * @spec_ref AC-ROI-1
 *   spec-run-only-write-identity-and-run-end-claim-release Scope 1; the retired `recorded_by` argument was a
 *   caller-named identity of the same kind as `by`.
 *
 * Coverage: NEGATIVE (the registered input schema refuses `recorded_by`, never strips it) / HAPPY (the evidence row
 * records the call's own resolved name) / REGRESSION (a `recorded_by` that reaches the handler anyway is not recorded).
 */

import { liveInvocation, actedStore } from "../../live-invocation.js";
import { describe, it, expect, beforeEach } from "vitest";
import type { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NoOpTelemetry } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { asSessionActor, sessionActorFor } from "../../helpers/session-actor.js";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

let store: InMemoryStore;
let corpusService: CorpusService;

function makeApp(): App {
  store = actedStore(new InMemoryStore());
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  corpusService = new CorpusService(store, lock);
  return {
    warn: () => undefined,
    corpusService,
    reviewService: new ReviewService(store, lock),
    versionService: new VersionService(store, lock),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: {} as ApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 }),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

type RegisteredTool = {
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;
  inputSchema: z.ZodTypeAny;
};

function registeredTool(server: McpServer, name: string): RegisteredTool {
  const tool = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

async function createTaskWithPlan(): Promise<string> {
  const plan = await corpusService.create({ type: "plan", title: "Recorder Plan", content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error(JSON.stringify(plan.error));
  const task = await corpusService.create({
    type: "task",
    title: "Recorder Task",
    parent_id: plan.value.id,
    content: "body",
    extra: { plan_id: plan.value.id },
  } as CreateDocInput);
  if (!task.ok) throw new Error(JSON.stringify(task.error));
  return task.value.id;
}

let server: McpServer;

beforeEach(() => {
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, makeApp(), undefined, liveInvocation());
});

const EVIDENCE = { oracle: "manual", command: "bun run typecheck", result: "pass", output_tail: "ok" } as const;

async function recordedByOf(taskId: string): Promise<string | undefined> {
  const doc = await corpusService.get(taskId);
  if (!doc.ok) throw new Error(JSON.stringify(doc.error));
  const rows = doc.value.doc.extra["verification_evidence"] as { recorded_by?: string }[];
  return rows[0]?.recorded_by;
}

describe("lore_evidence_add recorder identity", () => {
  it("NEGATIVE: the registered input schema REFUSES recorded_by loudly, never strips it", () => {
    const result = registeredTool(server, "lore_evidence_add").inputSchema.safeParse({
      id_or_slug: "t",
      ...EVIDENCE,
      recorded_by: "mallory",
    });

    expect(result.success).toBe(false);
    expect(
      !result.success && result.error.issues.some((i) => i.code === "unrecognized_keys" && i.keys.includes("recorded_by")),
    ).toBe(true);
  });

  it("NEGATIVE control: the same call without recorded_by passes the schema", () => {
    expect(registeredTool(server, "lore_evidence_add").inputSchema.safeParse({ id_or_slug: "t", ...EVIDENCE }).success).toBe(true);
  });

  it("HAPPY: the evidence row records the call's own resolved name", async () => {
    const taskId = await createTaskWithPlan();
    const tool = registeredTool(server, "lore_evidence_add");

    const result = await asSessionActor("alice", () => tool.handler({ id_or_slug: taskId, ...EVIDENCE }, {}));

    expect(result.isError).toBeFalsy();
    expect(await recordedByOf(taskId)).toBe(sessionActorFor("alice"));
  });

  it("REGRESSION: a recorded_by that reaches the handler past the schema is NOT what gets recorded", async () => {
    const taskId = await createTaskWithPlan();
    const tool = registeredTool(server, "lore_evidence_add");

    const result = await asSessionActor("alice", () =>
      tool.handler({ id_or_slug: taskId, ...EVIDENCE, recorded_by: "mallory" }, {}),
    );

    expect(result.isError).toBeFalsy();
    expect(await recordedByOf(taskId)).toBe(sessionActorFor("alice"));
  });
});
