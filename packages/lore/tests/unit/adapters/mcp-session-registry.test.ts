/**
 * Unit tests for the SPEC-042 session-registry MCP surface: `lore_claim`'s new
 * `machine`/`worktree` fields, `lore_anchor_set`, `lore_ready`'s `ReadyReport`
 * payload parity with the underlying `TaskWorkflowService.ready` call, and
 * `lore_bootstrap`'s `active_sessions` exposure.
 *
 * Scope: end-to-end through real services (`CorpusService` + `TaskWorkflowService`
 * + `SessionService`) backed by `InMemoryStore` (vitest-reachable, no `bun:sqlite`)
 * — registration/handler-plumbing style mirrors `mcp-session-tools.test.ts`
 * (register real tools against a McpServer, extract handlers from the internal
 * `_registeredTools` map, invoke directly).
 *
 * AC-S3-8's "lore_ready equals CLI --json … after unwrapping envelopes and
 * normalizing wall-clock-derived subfields" is verified the same way
 * `mcp-session-tools.test.ts` verifies `lore_bootstrap`/`lore_handoff` parity:
 * the CLI's `--json` output for `lore ready` is a raw passthrough of
 * `taskWorkflowService.ready(...)` (see `commands/ready.ts`'s `run()`), so
 * comparing the MCP tool's payload against a DIRECT `taskWorkflowService.ready()`
 * call against the same seeded corpus is equivalent to comparing against the
 * CLI's `--json` shape. `age_minutes` (wall-clock-derived, may legitimately
 * differ between two calls made microseconds apart) is normalized away before
 * the deep-equal; `stale` is left in place and separately self-consistency
 * asserted (both calls happen well within the 120min TTL, so it must be `false`
 * on both sides).
 *
 * Coverage:
 *   HAPPY:      lore_claim {machine, worktree, branch} persisted; lore_anchor_set
 *               replaces anchors; lore_bootstrap exposes active_sessions
 *   NEGATIVE:   lore_anchor_set with an invalid anchor entry (leading "/") →
 *               isError with VALIDATION_ERROR, anchors left untouched
 *   BOUNDARY:   lore_anchor_set with an empty anchors array clears file_anchors
 *   STATE:      lore_anchor_set preserves extra.claim AND extra.
 *               verification_evidence untouched (AC-S3-5 regression, exercised
 *               again here at the MCP seam)
 *   ERROR:      lore_claim on a nonexistent task → isError with DOC_NOT_FOUND
 *   REGRESSION: lore_ready's MCP payload structurally deep-equals a direct
 *               taskWorkflowService.ready() call (after normalizing age_minutes)
 *               for the same seeded corpus; self-consistency on `stale`
 *
 * @spec_ref SPEC-042 §Acceptance Criteria AC-S3-8
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
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, DocRecord } from "@lore/core";

// ─── Test Infrastructure (mirrors mcp-session-tools.test.ts) ─────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let taskWorkflowService: TaskWorkflowService;
let sessionService: SessionService;

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store);
  taskWorkflowService = new TaskWorkflowService(
    store,
    new NoOpTelemetry(),
    { claimTtlMinutes: 120 },
    async () => ok(new Set()),
  );
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
    taskWorkflowService,
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

async function mustCreate(input: CreateDocInput): Promise<DocRecord> {
  const result = await corpusService.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPlanAndTask(): Promise<{ plan: DocRecord; task: DocRecord }> {
  const plan = await mustCreate({ type: "plan", title: "Plan A", content: "# Plan" } as CreateDocInput);
  const task = await mustCreate({
    type: "task",
    title: "Task A",
    parent_id: plan.id,
    content: "# Task",
    extra: { plan_id: plan.id },
  } as CreateDocInput);
  return { plan, task };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("lore_claim — machine/worktree persisted (SPEC-042 D2, D9)", () => {
  let server: McpServer;

  beforeEach(() => {
    const app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
  });

  it("HAPPY: {machine, worktree, branch} all persist into extra.claim", async () => {
    const { task } = await createPlanAndTask();
    const call = getToolHandler(server, "lore_claim");

    const result = await call({
      id_or_slug: task.slug,
      by: "agent:t1",
      branch: "wt-a",
      machine: "hostA",
      worktree: "/repo/.worktrees/t1",
    });

    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { doc: DocRecord };
    expect(data.doc.extra["claim"]).toMatchObject({
      by: "agent:t1",
      branch: "wt-a",
      machine: "hostA",
      worktree: "/repo/.worktrees/t1",
    });
  });

  it("ERROR: nonexistent task → isError with DOC_NOT_FOUND", async () => {
    const call = getToolHandler(server, "lore_claim");
    const result = await call({ id_or_slug: "task-does-not-exist", by: "agent:t1" });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("DOC_NOT_FOUND");
  });
});

describe("lore_anchor_set — declarative replace, preserves claim/evidence (SPEC-042 D9, AC-S3-5)", () => {
  let server: McpServer;

  beforeEach(() => {
    const app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
  });

  it("HAPPY + STATE: replacing anchors preserves an existing claim AND evidence untouched", async () => {
    const { task } = await createPlanAndTask();

    const claimResult = await taskWorkflowService.claim(task.id, { by: "agent:t1", branch: "wt-a" });
    if (!claimResult.ok) throw new Error(JSON.stringify(claimResult.error));
    const evidenceResult = await taskWorkflowService.addEvidence(task.id, {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "agent:t1",
      output_tail: "ok",
      capture_source: "self-report",
    });
    if (!evidenceResult.ok) throw new Error(JSON.stringify(evidenceResult.error));

    const call = getToolHandler(server, "lore_anchor_set");
    const result = await call({ id_or_slug: task.slug, anchors: ["src/a", "src/b/"], by: "agent:t1" });

    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { doc: DocRecord };
    expect(data.doc.extra["file_anchors"]).toEqual(["src/a", "src/b/"]);
    expect(data.doc.extra["claim"]).toMatchObject({ by: "agent:t1", branch: "wt-a" });
    expect(data.doc.extra["verification_evidence"]).toHaveLength(1);
  });

  it("BOUNDARY: an empty anchors array clears file_anchors", async () => {
    const { task } = await createPlanAndTask();
    const setResult = await taskWorkflowService.setAnchors(task.id, ["src/a"], { by: "agent:t1" });
    if (!setResult.ok) throw new Error(JSON.stringify(setResult.error));

    const call = getToolHandler(server, "lore_anchor_set");
    const result = await call({ id_or_slug: task.slug, anchors: [], by: "agent:t1" });

    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { doc: DocRecord };
    expect(data.doc.extra["file_anchors"]).toEqual([]);
  });

  it("NEGATIVE: an invalid anchor entry (leading '/') → isError VALIDATION_ERROR, anchors untouched", async () => {
    const { task } = await createPlanAndTask();
    const setResult = await taskWorkflowService.setAnchors(task.id, ["src/a"], { by: "agent:t1" });
    if (!setResult.ok) throw new Error(JSON.stringify(setResult.error));

    const call = getToolHandler(server, "lore_anchor_set");
    const result = await call({ id_or_slug: task.slug, anchors: ["/absolute/path"], by: "agent:t1" });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("VALIDATION_ERROR");

    const reread = await corpusService.get(task.slug);
    if (!reread.ok) throw new Error(JSON.stringify(reread.error));
    expect(reread.value.doc.extra["file_anchors"]).toEqual(["src/a"]);
  });
});

describe("lore_bootstrap — exposes active_sessions (SPEC-042 D8, D9)", () => {
  let server: McpServer;

  beforeEach(() => {
    const app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
  });

  it("HAPPY: a fresh claim shows up as one active session", async () => {
    const { task } = await createPlanAndTask();
    const claimResult = await taskWorkflowService.claim(task.id, {
      by: "agent:t1",
      machine: "hostA",
      worktree: "/w1",
    });
    if (!claimResult.ok) throw new Error(JSON.stringify(claimResult.error));

    const call = getToolHandler(server, "lore_bootstrap");
    const result = await call({ by: "agent:t1" });

    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { report: { active_sessions: Array<{ by: string; task_slugs: string[] }> } };
    expect(data.report.active_sessions).toHaveLength(1);
    expect(data.report.active_sessions[0]?.by).toBe("agent:t1");
    expect(data.report.active_sessions[0]?.task_slugs).toContain(task.slug);
  });
});

describe("lore_ready — REGRESSION: MCP payload deep-equals a direct service call (SPEC-042 D7, AC-S3-8)", () => {
  let server: McpServer;

  beforeEach(() => {
    const app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);
  });

  /** Strips the wall-clock-derived `age_minutes` subfield from every record's claim, in place on a fresh copy. */
  function normalize(report: {
    records: Array<{ claim?: { age_minutes?: number; [k: string]: unknown } }>;
    sessions: unknown[];
    anchor_conflicts: unknown[];
  }): unknown {
    return {
      ...report,
      records: report.records.map((r) => {
        if (r.claim === undefined) return r;
        const { age_minutes: _age_minutes, ...restClaim } = r.claim;
        return { ...r, claim: restClaim };
      }),
    };
  }

  it("full ReadyReport (records/sessions/anchor_conflicts) structurally equals TaskWorkflowService.ready() for the same seeded corpus", async () => {
    const { plan, task } = await createPlanAndTask();
    const claimResult = await taskWorkflowService.claim(task.id, {
      by: "agent:t1",
      machine: "hostA",
      worktree: "/w1",
      branch: "wt-a",
    });
    if (!claimResult.ok) throw new Error(JSON.stringify(claimResult.error));

    const call = getToolHandler(server, "lore_ready");
    const mcpResult = await call({ plan_id_or_slug: plan.slug });
    expect(mcpResult.isError).toBeFalsy();
    const mcpData = parseResult(mcpResult) as {
      ready: {
        records: Array<{ claim?: { age_minutes?: number; stale?: boolean } }>;
        sessions: unknown[];
        anchor_conflicts: unknown[];
      };
    };

    // reason: this IS what commands/ready.ts's `run()` calls and passes through
    // verbatim as `--json`'s `data.ready` field for an equivalent read against
    // the same corpus state.
    const directResult = await taskWorkflowService.ready(plan.slug);
    if (!directResult.ok) throw new Error(JSON.stringify(directResult.error));

    expect(normalize(mcpData.ready)).toEqual(normalize(directResult.value));

    // Self-consistency on the normalized-away field: both calls happen well
    // within the 120min TTL against the same fresh claim, so `stale` must be
    // `false` on both sides (review T3's "self-consistency asserted for the
    // normalized fields" requirement).
    expect(mcpData.ready.records[0]?.claim?.stale).toBe(false);
    expect(directResult.value.records[0]?.claim?.stale).toBe(false);
    expect(typeof mcpData.ready.records[0]?.claim?.age_minutes).toBe("number");
  });

  it("BOUNDARY: empty plan (no tasks) → records/sessions/anchor_conflicts all [] on both sides", async () => {
    const plan = await mustCreate({ type: "plan", title: "Empty Plan", content: "# Plan" } as CreateDocInput);

    const call = getToolHandler(server, "lore_ready");
    const mcpResult = await call({ plan_id_or_slug: plan.slug });
    const mcpData = parseResult(mcpResult) as { ready: { records: unknown[]; sessions: unknown[]; anchor_conflicts: unknown[] } };

    const directResult = await taskWorkflowService.ready(plan.slug);
    if (!directResult.ok) throw new Error(JSON.stringify(directResult.error));

    expect(mcpData.ready).toEqual({ records: [], sessions: [], anchor_conflicts: [] });
    expect(directResult.value).toEqual({ records: [], sessions: [], anchor_conflicts: [] });
  });
});
