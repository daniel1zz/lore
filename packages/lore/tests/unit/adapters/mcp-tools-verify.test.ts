// @layer mcp-adapter (in-process MCP tool handlers; owners drive services, the CLI and a CLI write-surface test)
/**
 * Unit tests for the SPEC-039 lore_verify MCP tool + the AC-VRF-2 adapter half
 * (evidence write surfaces reject/never-receive attestation-carrying input).
 *
 * Scope: translation-only (args → VerifyRunnerService.verifyPlan call → MCP
 * envelope shape). VerifyRunnerService's own orchestration logic (four-step
 * pipeline, launch-failure abort, draft-spec advisory, the §M2 approval-gate
 * decision itself) is exhaustively covered at the service layer
 * (verify-runner-service.test.ts) — per the mcp-tools-task-workflow.test.ts
 * precedent ("do not re-test business rules at three layers"), `lore_verify`'s
 * `verifyPlan` port is a hand-written spy here, not a real service instance.
 *
 * Strategy mirrors mcp-tools-task-workflow.test.ts: register real tools against
 * a McpServer, extract handlers from the internal _registeredTools map, invoke
 * directly.
 *
 * Coverage:
 *   HAPPY:      lore_verify schema roundtrip (valid shapes, ac/task/
 *               allow_new_commands optional); handler threads plan/ac/task/by +
 *               a fresh nowIso through to verifyPlan's opts, returning its
 *               Result value verbatim; allow_new_commands: true threads
 *               opts.allowNewCommands: true
 *   NEGATIVE:   verifyPlan err() → isError + LoreError JSON passthrough,
 *               including a NEEDS_APPROVAL-shaped error; allow_new_commands
 *               omitted (or false) never threads opts.allowNewCommands
 *   BOUNDARY:   omitting ac/task leaves those keys ABSENT from the opts object
 *               passed to verifyPlan (not present-but-undefined)
 *   ERROR:      App.verifyRunnerService === undefined (optional-typed test-stub
 *               shape) → isError, STORE_ERROR — never throws
 *   STATE:      n/a (VerifyRunnerService is a full test double here — no store
 *               state to assert on beyond the spy's captured args)
 *   REGRESSION: AC-VRF-2 adapter half — LoreEvidenceAddSchema strips a forged
 *               `attestation` key before the handler ever sees it, AND the
 *               handler's explicit-field construction never forwards it to
 *               TaskWorkflowService.addEvidence even when a raw untyped object
 *               smuggles the key past the schema layer; the handler NEVER
 *               supplies `confirmUnapprovedCommand` (MCP is non-interactive)
 *
 * @spec_ref AC-VRF-10 AC-VRF-2; SPEC-039 §M2
 */

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
import type { EvidenceInput } from "../../../src/service/task-workflow-service.js";
import type { VerifyPlanOpts, VerifyPlanResult, VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import { NoOpTelemetry, ok, err } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools, LoreVerifySchema, LoreEvidenceAddSchema } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, LoreError } from "@lore/core";
import { asSessionActor, sessionActorFor } from "../../helpers/session-actor.js";

// ─── Test Infrastructure (mirrors mcp-tools-task-workflow.test.ts) ────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;

/** Captures every `verifyPlan` call for spy-style assertions. */
interface VerifyPlanCall {
  readonly planIdOrSlug: string;
  readonly opts: VerifyPlanOpts;
}

function makeApp(opts: {
  verifyPlanImpl?: (
    planIdOrSlug: string,
    verifyOpts: VerifyPlanOpts,
  ) => Promise<{ ok: true; value: VerifyPlanResult } | { ok: false; error: LoreError }>;
  omitVerifyRunnerService?: boolean;
} = {}): { app: App; calls: VerifyPlanCall[] } {
  store = new InMemoryStore();
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const calls: VerifyPlanCall[] = [];

  const defaultResult: VerifyPlanResult = {
    task: { id: "task-1", slug: "task-1" },
    results: [{ ac_id: "AC-VRF-1", result: "pass", exit_code: 0, duration_ms: 5, timed_out: false }],
    skipped: [],
    warnings: [],
  };

  const verifyRunnerServiceStub = {
    verifyPlan: async (planIdOrSlug: string, verifyOpts: VerifyPlanOpts) => {
      calls.push({ planIdOrSlug, opts: verifyOpts });
      if (opts.verifyPlanImpl) return opts.verifyPlanImpl(planIdOrSlug, verifyOpts);
      return ok(defaultResult);
    },
  } as unknown as VerifyRunnerService;

  const app: App = {
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
      async () => ok(new Set()),
    ),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    ...(opts.omitVerifyRunnerService ? {} : { verifyRunnerService: verifyRunnerServiceStub }),
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };

  return { app, calls };
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

// ─── Fixture helpers ──────────────────────────────────────────────────────────

async function createPlan(title = "Test Plan"): Promise<string> {
  const result = await corpusService.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(planId: string, title = "Test Task"): Promise<string> {
  const result = await corpusService.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

// ─── lore_verify — schema roundtrip ──────────────────────────────────────────

describe("LoreVerifySchema — roundtrip", () => {
  it("HAPPY: minimal valid shape (plan + by only) parses", () => {
    const parsed = LoreVerifySchema.safeParse({ plan: "plan-1", by: "alice" });
    expect(parsed.success).toBe(true);
  });

  it("HAPPY: full shape (plan + ac[] + task + by) parses", () => {
    const parsed = LoreVerifySchema.safeParse({
      plan: "plan-1",
      ac: ["AC-1", "AC-2"],
      task: "task-1",
      by: "alice",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ac).toEqual(["AC-1", "AC-2"]);
    }
  });

  // reason: BR-1034 (AC-RID-7) — no MCP tool requires the caller to name itself.
  it("BOUNDARY: missing by → accepted (the call's resolved name fills in)", () => {
    const parsed = LoreVerifySchema.safeParse({ plan: "plan-1" });
    expect(parsed.success).toBe(true);
  });

  it("NEGATIVE: the schema declares no `by` property (AC-ROI-1: the call's own identity writes)", () => {
    expect(Object.keys(LoreVerifySchema.shape)).not.toContain("by");
  });

  it("HAPPY: allow_new_commands: true parses (SPEC-039 §M2)", () => {
    const parsed = LoreVerifySchema.safeParse({ plan: "plan-1", by: "alice", allow_new_commands: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.allow_new_commands).toBe(true);
    }
  });

  it("HAPPY: allow_new_commands omitted parses (optional field)", () => {
    const parsed = LoreVerifySchema.safeParse({ plan: "plan-1", by: "alice" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.allow_new_commands).toBeUndefined();
    }
  });
});

// ─── lore_verify — handler arg threading ─────────────────────────────────────

describe("lore_verify", () => {
  describe("happy path", () => {
    it("threads plan/ac/task/by through to verifyPlan and returns its Result value", async () => {
      const { app, calls } = makeApp();
      const server = new McpServer({ name: "test", version: "0.0.0" });
      registerTools(server, app);
      const call = getToolHandler(server, "lore_verify");

      const result = await asSessionActor("alice", () => call({ plan: "plan-1", ac: ["AC-1", "AC-2"], task: "task-1" }));

      expect(result.isError).toBeFalsy();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.planIdOrSlug).toBe("plan-1");
      expect(calls[0]?.opts.acIds).toEqual(["AC-1", "AC-2"]);
      expect(calls[0]?.opts.explicitTaskIdOrSlug).toBe("task-1");
      expect(calls[0]?.opts.by).toBe(sessionActorFor("alice"));
      expect(typeof calls[0]?.opts.nowIso).toBe("string");
      expect(Number.isNaN(Date.parse(calls[0]?.opts.nowIso ?? ""))).toBe(false);

      const data = parseResult(result) as VerifyPlanResult;
      expect(data.task.slug).toBe("task-1");
      expect(data.results).toHaveLength(1);
    });
  });

  describe("boundary values", () => {
    it("omitting ac/task leaves those keys ABSENT from verifyPlan's opts (not present-but-undefined)", async () => {
      const { app, calls } = makeApp();
      const server = new McpServer({ name: "test", version: "0.0.0" });
      registerTools(server, app);
      const call = getToolHandler(server, "lore_verify");

      await call({ plan: "plan-1", by: "alice" });

      expect(calls).toHaveLength(1);
      const opts = calls[0]?.opts;
      expect(opts && "acIds" in opts).toBe(false);
      expect(opts && "explicitTaskIdOrSlug" in opts).toBe(false);
    });
  });

  describe("negative cases", () => {
    it("verifyPlan err() → isError=true, LoreError JSON passthrough", async () => {
      const { app } = makeApp({
        verifyPlanImpl: async () =>
          err({ code: "VALIDATION_ERROR", field: "task", message: "ambiguous target task — task-a, task-b", value: ["task-a", "task-b"] }),
      });
      const server = new McpServer({ name: "test", version: "0.0.0" });
      registerTools(server, app);
      const call = getToolHandler(server, "lore_verify");

      const result = await call({ plan: "plan-1", by: "alice" });

      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; message?: string };
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain("ambiguous");
    });

    it("SPEC-039 §M2: verifyPlan NEEDS_APPROVAL err() → isError=true, JSON passthrough naming the AC/command", async () => {
      const { app } = makeApp({
        verifyPlanImpl: async () =>
          err({
            code: "NEEDS_APPROVAL",
            message: "command is new/changed and was not approved",
            ac_id: "AC-1",
            command: "rm -rf /tmp/x",
          }),
      });
      const server = new McpServer({ name: "test", version: "0.0.0" });
      registerTools(server, app);
      const call = getToolHandler(server, "lore_verify");

      const result = await call({ plan: "plan-1", by: "alice" });

      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; ac_id?: string; command?: string };
      expect(error.code).toBe("NEEDS_APPROVAL");
      expect(error.ac_id).toBe("AC-1");
      expect(error.command).toBe("rm -rf /tmp/x");
    });
  });

  describe("§M2 command-provenance approval — allow_new_commands threading", () => {
    it("HAPPY: allow_new_commands: true threads opts.allowNewCommands: true", async () => {
      const { app, calls } = makeApp();
      const server = new McpServer({ name: "test", version: "0.0.0" });
      registerTools(server, app);
      const call = getToolHandler(server, "lore_verify");

      await call({ plan: "plan-1", by: "alice", allow_new_commands: true });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.opts.allowNewCommands).toBe(true);
    });

    it("NEGATIVE: allow_new_commands omitted never threads opts.allowNewCommands", async () => {
      const { app, calls } = makeApp();
      const server = new McpServer({ name: "test", version: "0.0.0" });
      registerTools(server, app);
      const call = getToolHandler(server, "lore_verify");

      await call({ plan: "plan-1", by: "alice" });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.opts && "allowNewCommands" in calls[0].opts).toBe(false);
    });

    it("NEGATIVE: allow_new_commands: false never threads opts.allowNewCommands (false is not forwarded)", async () => {
      const { app, calls } = makeApp();
      const server = new McpServer({ name: "test", version: "0.0.0" });
      registerTools(server, app);
      const call = getToolHandler(server, "lore_verify");

      await call({ plan: "plan-1", by: "alice", allow_new_commands: false });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.opts && "allowNewCommands" in calls[0].opts).toBe(false);
    });

    it("REGRESSION: the handler NEVER supplies confirmUnapprovedCommand (MCP is non-interactive)", async () => {
      const { app, calls } = makeApp();
      const server = new McpServer({ name: "test", version: "0.0.0" });
      registerTools(server, app);
      const call = getToolHandler(server, "lore_verify");

      await call({ plan: "plan-1", by: "alice" });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.opts.confirmUnapprovedCommand).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("App.verifyRunnerService === undefined → isError=true, STORE_ERROR (never throws)", async () => {
      const { app } = makeApp({ omitVerifyRunnerService: true });
      const server = new McpServer({ name: "test", version: "0.0.0" });
      registerTools(server, app);
      const call = getToolHandler(server, "lore_verify");

      const result = await call({ plan: "plan-1", by: "alice" });

      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string };
      expect(error.code).toBe("STORE_ERROR");
    });
  });
});

// ─── AC-VRF-2 adapter half — lore_evidence_add rejects/never-forwards attestation ──

describe("lore_evidence_add — forged attestation is inert (AC-VRF-2 adapter half)", () => {
  it("REGRESSION: LoreEvidenceAddSchema strips an unknown `attestation` key before the handler sees it", () => {
    const candidate = {
      id_or_slug: "task-1",
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
    };

    const parsed = LoreEvidenceAddSchema.safeParse(candidate);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("attestation" in parsed.data).toBe(false);
    }
  });

  it("REGRESSION: even a raw object smuggling `attestation` past the schema never reaches TaskWorkflowService.addEvidence", async () => {
    const { app } = makeApp();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
    const call = getToolHandler(server, "lore_evidence_add");

    const planId = await createPlan();
    const taskId = await createTask(planId);

    const original = app.taskWorkflowService.addEvidence.bind(app.taskWorkflowService);
    let capturedEntry: EvidenceInput | undefined;
    app.taskWorkflowService.addEvidence = ((idOrSlug: string, entry: EvidenceInput, now?: () => string) => {
      capturedEntry = entry;
      return original(idOrSlug, entry, now);
    }) as typeof app.taskWorkflowService.addEvidence;

    try {
      // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
      // predicate-to-its-own) — "tsc" self-report is now refused regardless
      // of tail content; "manual" is the one oracle that still lets a
      // genuinely non-empty self-reported tail succeed. This test only
      // checks attestation-stripping, not capture_source semantics.
      const result = await call({
        id_or_slug: taskId,
        oracle: "manual",
        command: "bun run typecheck",
        result: "pass",
        output_tail: "ok",
        // reason: forged past the type system — the SDK's real runtime schema
        // validation would strip this before the handler ever ran; calling the
        // handler directly (bypassing SDK-level parse, per this suite's
        // getToolHandler helper) proves the handler's explicit-field
        // construction is ALSO safe even if schema stripping were bypassed.
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      });

      expect(result.isError).toBeFalsy();
      expect(capturedEntry).toBeDefined();
      expect(capturedEntry && "attestation" in capturedEntry).toBe(false);
    } finally {
      app.taskWorkflowService.addEvidence = original;
    }
  });
});
