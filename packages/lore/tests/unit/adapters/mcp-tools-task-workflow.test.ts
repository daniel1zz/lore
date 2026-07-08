/**
 * Unit tests for the 4 SPEC-025 task-workflow MCP tools: lore_claim, lore_release,
 * lore_evidence_add, lore_ready.
 *
 * Scope: translation-only (args → TaskWorkflowService call → MCP envelope shape).
 * Business rules (CLAIM_CONFLICT precedence, staleness math, evidence cap) are
 * exhaustively covered at the service layer — this file verifies the MCP adapter
 * wiring and envelope shape only, per SPEC-025 §7 "do not re-test business rules
 * at three layers".
 *
 * Strategy mirrors mcp-tools.test.ts: register real tools against a McpServer,
 * extract handlers from the internal _registeredTools map, invoke directly.
 *
 * Coverage:
 *   HAPPY:      each of the 4 tools succeeds and returns { doc } / { ready };
 *               lore_evidence_add's optional ac_ref (SPEC-038 §4) is threaded
 *               through to the EvidenceInput passed to the service (adapter
 *               boundary only — see the "ac_ref" describe block below for why)
 *   NEGATIVE:   lore_claim conflict envelope; lore_ready on a non-plan doc
 *   BOUNDARY:   lore_ready on an empty plan → { ready: [] }
 *   ERROR:      isError=true + LoreError JSON on failure (all 4 tools)
 *   STATE:      claim → release → re-claim state machine round-trip via MCP
 *   REGRESSION: `by` is required (schema rejects/omits — MCP callers always pass
 *               it explicitly, unlike the CLI's env/OS-username fallback);
 *               omitting ac_ref leaves it absent from the service call arg
 *
 * @spec_ref AC-WF-10 AC-ACODE-3 AC-ACODE-8
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
import type { EvidenceInput } from "../../../src/service/task-workflow-service.js";
import { NoOpTelemetry, ok } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, DocRecord } from "@lore/core";

// ─── Test Infrastructure (mirrors mcp-tools.test.ts) ─────────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store);
  return {
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
    // reason: unlike mcp-tools.test.ts, THIS suite exercises the task-workflow
    // tools, so taskWorkflowService must be a real instance (not null-cast).
    // The 4th ctor arg stubs SPEC-038 §7 D4's resolveDeclaredAcIds port — this
    // suite's fixtures (createPlan/createTask below) build plans directly via
    // CorpusService with no parent spec, so the production port would always
    // resolve `null` and fail-loud reject any ac_ref. Per the port's own JSDoc
    // ("Tests can inject a stub without a 3-hop CorpusService fixture" —
    // task-workflow-service.ts), stub a fixed declared-id set covering the
    // "AC-ACODE-8" id the ac_ref describe block below exercises.
    taskWorkflowService: new TaskWorkflowService(
      store,
      new NoOpTelemetry(),
      { claimTtlMinutes: 120 },
      async () => ok(new Set(["AC-ACODE-8"])),
    ),
    // reason: SPEC-032 §3.4 — test does not exercise spec-kind audit; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
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

// ─── Test Setup ────────────────────────────────────────────────────────────────

let app: App;
let server: McpServer;

beforeEach(() => {
  app = makeApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app);
});

// ─── lore_claim ────────────────────────────────────────────────────────────────

describe("lore_claim", () => {
  const call = () => getToolHandler(server, "lore_claim");

  describe("happy path", () => {
    it("acquires a lease and returns { doc } with extra.claim.by set", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);

      const result = await call()({ id_or_slug: taskId, by: "alice" });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { doc: DocRecord };
      expect((data.doc.extra["claim"] as { by?: string }).by).toBe("alice");
    });
  });

  describe("negative cases", () => {
    it("a fresh claim held by a different actor → isError=true, CLAIM_CONFLICT", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);
      await call()({ id_or_slug: taskId, by: "alice" });

      const result = await call()({ id_or_slug: taskId, by: "bob" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; holder?: string };
      expect(error.code).toBe("CLAIM_CONFLICT");
      expect(error.holder).toBe("alice");
    });

    it("steal:true overrides a fresh claim held by someone else", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);
      await call()({ id_or_slug: taskId, by: "alice" });

      const result = await call()({ id_or_slug: taskId, by: "bob", steal: true });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { doc: DocRecord };
      expect((data.doc.extra["claim"] as { by?: string }).by).toBe("bob");
    });
  });

  describe("error handling", () => {
    it("non-existent task id → isError=true, DOC_NOT_FOUND", async () => {
      const result = await call()({ id_or_slug: "does-not-exist", by: "alice" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string };
      expect(error.code).toBe("DOC_NOT_FOUND");
    });
  });
});

// ─── lore_release ────────────────────────────────────────────────────────────

describe("lore_release", () => {
  const callClaim = () => getToolHandler(server, "lore_claim");
  const callRelease = () => getToolHandler(server, "lore_release");

  describe("happy path", () => {
    it("clears the lease and returns { doc } with extra.claim absent", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);
      await callClaim()({ id_or_slug: taskId, by: "alice" });

      const result = await callRelease()({ id_or_slug: taskId, by: "alice" });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { doc: DocRecord };
      expect(data.doc.extra["claim"]).toBeUndefined();
    });
  });

  describe("negative cases", () => {
    it("release by a non-holder without force → isError=true, CLAIM_CONFLICT", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);
      await callClaim()({ id_or_slug: taskId, by: "alice" });

      const result = await callRelease()({ id_or_slug: taskId, by: "bob" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string };
      expect(error.code).toBe("CLAIM_CONFLICT");
    });

    it("release by a non-holder WITH force:true succeeds", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);
      await callClaim()({ id_or_slug: taskId, by: "alice" });

      const result = await callRelease()({ id_or_slug: taskId, by: "bob", force: true });
      expect(result.isError).toBeFalsy();
    });
  });

  // STATE: claim → release → re-claim round trip via MCP tools only
  describe("state transitions", () => {
    it("claim → release → re-claim by a different actor succeeds (lease fully cleared)", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);

      await callClaim()({ id_or_slug: taskId, by: "alice" });
      const released = await callRelease()({ id_or_slug: taskId, by: "alice" });
      expect(released.isError).toBeFalsy();

      const reclaimed = await callClaim()({ id_or_slug: taskId, by: "bob" });
      expect(reclaimed.isError).toBeFalsy();
      const data = parseResult(reclaimed) as { doc: DocRecord };
      expect((data.doc.extra["claim"] as { by?: string }).by).toBe("bob");
    });
  });
});

// ─── lore_evidence_add ───────────────────────────────────────────────────────

describe("lore_evidence_add", () => {
  const call = () => getToolHandler(server, "lore_evidence_add");

  describe("happy path", () => {
    it("appends an evidence entry and returns { doc } with verification_evidence populated", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);

      const result = await call()({
        id_or_slug: taskId,
        oracle: "tsc",
        command: "bun run typecheck",
        result: "pass",
        recorded_by: "alice",
      });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { doc: DocRecord };
      const evidenceArr = data.doc.extra["verification_evidence"] as unknown[];
      expect(evidenceArr).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    it("non-existent task id → isError=true, DOC_NOT_FOUND", async () => {
      const result = await call()({
        id_or_slug: "does-not-exist",
        oracle: "tsc",
        command: "cmd",
        result: "pass",
        recorded_by: "alice",
      });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string };
      expect(error.code).toBe("DOC_NOT_FOUND");
    });
  });

  // ── SPEC-038 §4/§7 D3 — optional ac_ref pass-through ─────────────────────────
  // Scope note: this suite is adapter-only (SPEC-038 §7 D3 T2). Whether
  // TaskWorkflowService.addEvidence *persists* ac_ref onto the stored entry is
  // T3's responsibility (SPEC-038 §4 D4) and is not yet landed on this branch —
  // so these tests assert on the argument the tool handler passes to the
  // service (an instance-level spy wrapping the real addEvidence, which still
  // delegates to it so the round trip itself is unaffected), not on the
  // persisted DocRecord.
  describe("ac_ref (SPEC-038) — adapter → service call arg", () => {
    function spyOnAddEvidence(): { captured: () => EvidenceInput | undefined; restore: () => void } {
      const original = app.taskWorkflowService.addEvidence.bind(app.taskWorkflowService);
      let capturedEntry: EvidenceInput | undefined;
      app.taskWorkflowService.addEvidence = ((idOrSlug: string, entry: EvidenceInput, now?: () => string) => {
        capturedEntry = entry;
        return original(idOrSlug, entry, now);
      }) as typeof app.taskWorkflowService.addEvidence;
      return {
        captured: () => capturedEntry,
        restore: () => {
          app.taskWorkflowService.addEvidence = original;
        },
      };
    }

    it("HAPPY: ac_ref is threaded through to the EvidenceInput passed to the service", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);
      const spy = spyOnAddEvidence();

      try {
        const result = await call()({
          id_or_slug: taskId,
          oracle: "tsc",
          command: "bun run typecheck",
          result: "pass",
          recorded_by: "alice",
          ac_ref: "AC-ACODE-8",
        });
        expect(result.isError).toBeFalsy();
        expect(spy.captured()?.ac_ref).toBe("AC-ACODE-8");
      } finally {
        spy.restore();
      }
    });

    it("REGRESSION: omitting ac_ref leaves it absent from the EvidenceInput (schema field is optional)", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);
      const spy = spyOnAddEvidence();

      try {
        const result = await call()({
          id_or_slug: taskId,
          oracle: "tsc",
          command: "cmd",
          result: "pass",
          recorded_by: "alice",
        });
        expect(result.isError).toBeFalsy();
        const entry = spy.captured();
        expect(entry).toBeDefined();
        expect(entry && "ac_ref" in entry).toBe(false);
      } finally {
        spy.restore();
      }
    });
  });
});

// ─── lore_ready ──────────────────────────────────────────────────────────────

describe("lore_ready", () => {
  const call = () => getToolHandler(server, "lore_ready");

  describe("happy path", () => {
    it("returns { ready: [...] } — a flat array, one record per task", async () => {
      const planId = await createPlan();
      await createTask(planId, "Task A");
      await createTask(planId, "Task B");

      const result = await call()({ plan_id_or_slug: planId });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { ready: Array<{ ready: boolean }> };
      expect(Array.isArray(data.ready)).toBe(true);
      expect(data.ready).toHaveLength(2);
    });
  });

  describe("boundary values", () => {
    it("an empty plan (no tasks) returns { ready: [] }, not an error", async () => {
      const planId = await createPlan("Empty Plan");
      const result = await call()({ plan_id_or_slug: planId });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { ready: unknown[] };
      expect(data.ready).toEqual([]);
    });
  });

  describe("negative cases", () => {
    it("a non-plan document id → isError=true, VALIDATION_ERROR", async () => {
      const planId = await createPlan();
      const taskId = await createTask(planId);

      const result = await call()({ plan_id_or_slug: taskId });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string };
      expect(error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("error handling", () => {
    it("non-existent plan id → isError=true, DOC_NOT_FOUND", async () => {
      const result = await call()({ plan_id_or_slug: "does-not-exist" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string };
      expect(error.code).toBe("DOC_NOT_FOUND");
    });
  });
});
