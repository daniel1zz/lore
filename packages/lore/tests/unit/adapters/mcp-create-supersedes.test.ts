/**
 * MCP `lore_create.supersedes` end-to-end tests, covering the target-type
 * eligibility precheck task-mcp-lore-create-supersedes-still-creates-then-fails-the
 * adds to the shared `createWithSupersedes` orchestration (`flows/supersede-flow.ts`).
 *
 * Defect being closed: `lore create --supersedes` (CLI) validated the target's type
 * BEFORE any write; MCP `lore_create.supersedes` did not, so it still exhibited the
 * pre-Defect-1 create-then-fail behavior — it created the new doc, failed the
 * invalidate, and emitted a `supersede_repair_command` that fails IDENTICALLY on
 * retry for a type-ineligible target. The fix hoists the precheck INTO the shared
 * flow so both surfaces inherit it from one place.
 *
 * Scope: end-to-end through a real `CorpusService` + `ValidityService` backed by
 * `InMemoryStore` (vitest-reachable, no `bun:sqlite`) — registration/handler-plumbing
 * style mirrors `mcp-invalidate.test.ts` (register real tools against a McpServer,
 * extract handlers from the internal `_registeredTools` map, invoke directly).
 *
 * Coverage:
 *   NEGATIVE (AC1): `supersedes` naming a `task` (type-ineligible) → `isError`, AND
 *               the corpus doc count is UNCHANGED before/after — the count assertion
 *               is load-bearing since the PRE-FIX behavior also returned an error
 *               while creating a doc (loud-but-useless, not loud-and-clean).
 *   BOUNDARY:   `supersedes` naming a doc that does not exist at all → `isError`
 *               (DOC_NOT_FOUND), same "nothing created" guarantee, before the
 *               type check is even reached.
 *   CONTROL (AC3): a type-ELIGIBLE target (knowledge AND adr) still supersedes
 *               successfully via MCP end-to-end (create + invalidate both applied) —
 *               proves the fix is a narrow allow-list, not a blanket refusal that
 *               would trivially make NEGATIVE (AC1) pass.
 *   ERROR:      the refusal names the offending type and field in the JSON error
 *               payload (`code: "VALIDATION_ERROR"`, `field: "supersedes"`).
 *   STATE:      doc count is asserted via a real second `corpusService.list()` read
 *               (`include_invalid: true`), not a parsed-payload heuristic.
 *
 * @spec_ref SPEC-043 §Design Decisions D11; task-mcp-lore-create-supersedes-still-
 *   creates-then-fails-the
 */

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
import { ValidityService } from "../../../src/service/validity-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ─── Test Infrastructure (mirrors mcp-invalidate.test.ts) ────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let validityService: ValidityService;

function makeApp(): App {
  store = new InMemoryStore();
  // reason: bare `new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)))` (no gate-enforcer args) stays UNGATED —
  // this test exercises the supersede precheck, not the task-create gate.
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  validityService = new ValidityService(store);

  const app: App = {
    corpusService,
    reviewService: new ReviewService(store),
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
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
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

async function createAdr(title: string): Promise<DocRecord> {
  const result = await corpusService.create({
    type: "adr",
    title,
    content: `# ${title}\n\nBody.`,
    extra: { decision_status: "accepted" },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`adr create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Task requires BOTH parent_id and extra.plan_id (createDocInputSchema superRefine) —
 *  build the minimal plan → task chain a real task needs. */
async function createTask(title: string): Promise<DocRecord> {
  const planResult = await corpusService.create({
    type: "plan",
    title: `${title} — Parent Plan`,
    content: "# Plan",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error(`plan create failed: ${JSON.stringify(planResult.error)}`);
  const plan = planResult.value;

  const taskResult = await corpusService.create({
    type: "task",
    title,
    content: `# ${title}`,
    parent_id: plan.id,
    extra: { plan_id: plan.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error(`task create failed: ${JSON.stringify(taskResult.error)}`);
  return taskResult.value;
}

async function countDocsOfType(type: DocRecord["type"]): Promise<number> {
  const result = await corpusService.list({ type, include_invalid: true });
  if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result.error)}`);
  return result.value.total;
}

// ─── NEGATIVE (AC1): type-ineligible target ─────────────────────────────────

describe("lore_create.supersedes — NEGATIVE (AC1, type-ineligible target)", () => {
  it("supersedes naming a task → isError, AND the corpus doc count is UNCHANGED before/after", async () => {
    const app = makeApp();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
    const handler = getToolHandler(server, "lore_create");

    const task = await createTask("A Task That Cannot Be Superseded");

    const knowledgeCountBefore = await countDocsOfType("knowledge");
    const totalTaskCountBefore = await countDocsOfType("task");

    const result = await handler({
      type: "knowledge",
      title: "Should Not Be Created",
      extra: { sub_type: "ideation" },
      supersedes: task.slug,
      by: "alice",
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field?: string; value?: string; message?: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("supersedes");
    expect(error.value).toBe("task");
    expect(error.message).toMatch(/task/i);
    expect(error.message).toMatch(/supersede/i);

    // The load-bearing oracle the task calls for: doc count is UNCHANGED. The
    // pre-fix behavior ALSO returned an error here — the bug was that it created a
    // doc anyway (loud-but-useless), not that it failed to report an error at all.
    const knowledgeCountAfter = await countDocsOfType("knowledge");
    const totalTaskCountAfter = await countDocsOfType("task");
    expect(knowledgeCountAfter).toBe(knowledgeCountBefore);
    expect(totalTaskCountAfter).toBe(totalTaskCountBefore);
  });
});

// ─── BOUNDARY: target does not resolve at all ────────────────────────────────

describe("lore_create.supersedes — BOUNDARY (target does not resolve)", () => {
  it("supersedes naming a nonexistent slug → isError (DOC_NOT_FOUND), creates NOTHING", async () => {
    const app = makeApp();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
    const handler = getToolHandler(server, "lore_create");

    const knowledgeCountBefore = await countDocsOfType("knowledge");

    const result = await handler({
      type: "knowledge",
      title: "Should Also Not Be Created",
      extra: { sub_type: "ideation" },
      supersedes: "knowledge-does-not-exist-at-all",
      by: "alice",
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("DOC_NOT_FOUND");

    const knowledgeCountAfter = await countDocsOfType("knowledge");
    expect(knowledgeCountAfter).toBe(knowledgeCountBefore);
  });
});

// ─── CONTROL (AC3): type-eligible targets still succeed end-to-end via MCP ───

describe("lore_create.supersedes — CONTROL (AC3, type-eligible targets still succeed)", () => {
  it("supersedes a knowledge target → creates AND invalidates end-to-end", async () => {
    const app = makeApp();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
    const handler = getToolHandler(server, "lore_create");

    const oldKnowledge = await createKnowledge("Old Knowledge Doc (MCP)");
    const knowledgeCountBefore = await countDocsOfType("knowledge");

    const result = await handler({
      type: "knowledge",
      title: "New Knowledge Doc (MCP)",
      extra: { sub_type: "ideation" },
      supersedes: oldKnowledge.slug,
      by: "alice",
    });

    expect(result.isError).toBeUndefined();
    const payload = parseResult(result) as { id: string; slug: string; type: string };
    expect(payload.type).toBe("knowledge");

    const knowledgeCountAfter = await countDocsOfType("knowledge");
    expect(knowledgeCountAfter).toBe(knowledgeCountBefore + 1);

    const oldDocResult = await corpusService.get(oldKnowledge.slug);
    expect(oldDocResult.ok).toBe(true);
    if (!oldDocResult.ok) return;
    expect(oldDocResult.value.doc.extra["validity"]).toBeDefined();
  });

  it("supersedes an adr target → creates AND invalidates end-to-end (both eligible types, not just one)", async () => {
    const app = makeApp();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
    const handler = getToolHandler(server, "lore_create");

    const oldAdr = await createAdr("Old Decision (MCP)");

    const result = await handler({
      type: "adr",
      title: "New Decision (MCP)",
      extra: { decision_status: "accepted" },
      supersedes: oldAdr.slug,
      by: "alice",
    });

    expect(result.isError).toBeUndefined();
    const payload = parseResult(result) as { id: string; slug: string; type: string };
    expect(payload.type).toBe("adr");

    const oldDocResult = await corpusService.get(oldAdr.slug);
    expect(oldDocResult.ok).toBe(true);
    if (!oldDocResult.ok) return;
    expect(oldDocResult.value.doc.extra["decision_status"]).toBe("superseded");
  });
});
