/**
 * Unit tests for the SPEC-056 phase-execution-model MCP surfaces
 * (task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence):
 *   - `lore_phase_status` — computed completion scorecard for a phase document.
 *   - `lore_evidence_add`'s target-type dispatch (task vs phase) + optional
 *     `checklist_ref` field.
 *
 * Strategy mirrors `mcp-tools-task-workflow.test.ts`: register real tools against a
 * McpServer, extract handlers from the internal `_registeredTools` map, invoke
 * directly. `phase` docs are inserted RAW via `store.insert(...)` (no `lore create
 * phase` / `corpusService.create` support exists yet — see `phase.ts`'s module
 * header) — mirrors `phase-workflow-service.test.ts`'s fixture convention.
 *
 * Coverage:
 *   HAPPY:      lore_phase_status renders a done scorecard; lore_evidence_add on a
 *               phase target dispatches to PhaseWorkflowService and threads
 *               checklist_ref through
 *   NEGATIVE:   lore_evidence_add on a phase with an undeclared checklist_ref →
 *               isError, VALIDATION_ERROR; lore_phase_status on a task (not a
 *               phase) → isError, VALIDATION_ERROR
 *   BOUNDARY:   lore_evidence_add on a TASK target stays byte-identical (never
 *               reaches PhaseWorkflowService)
 *   ERROR:      lore_phase_status on a non-existent id → isError, DOC_NOT_FOUND;
 *               lore_evidence_add on a phase target with oracle test + result pass
 *               citing a MISSING file → isError, VALIDATION_ERROR on field "command",
 *               PhaseWorkflowService.addEvidence never called (task-mcp-lore-evidence-
 *               add-bypasses-the-oracle-file-existence AC-2 — the missing-oracle-file
 *               precheck gates BEFORE the task-vs-phase dispatch, not per-branch)
 *   STATE:      lore_evidence_add(checklist_ref) → lore_phase_status reflects
 *               nothing changes for AC scope (checklist_ref never satisfies
 *               ac_scope — a separate id namespace)
 *   REGRESSION: lore_evidence_add's ac_ref-only (no checklist_ref) behavior is
 *               unchanged for a task target
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence
 *   task-mcp-lore-evidence-add-bypasses-the-oracle-file-existence
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
import { buildPhaseServices, requirePhaseWorkflowService } from "../../../src/adapters/cli/phase-wiring.js";
import { NoOpTelemetry, ok } from "@lore/core";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, DocRecord } from "@lore/core";

// ─── Test Infrastructure (mirrors mcp-tools-task-workflow.test.ts) ────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store);
  const gateEnforcer = new GateEnforcer(undefined);
  const phaseServices = buildPhaseServices(store, new NoOpTelemetry(), 120, gateEnforcer, corpusService);
  return {
    corpusService,
    ...phaseServices,
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
      async () => ok(new Set<string>()),
    ),
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

async function createPlan(title = "Test Plan"): Promise<DocRecord> {
  const result = await corpusService.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value;
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

let phaseCounter = 0;

/**
 * Raw phase DocRecord — no `lore create phase` path exists (phase.ts module header).
 * Returns the SLUG (not the id) — `resolve.ts::resolveDoc`'s ULID regex requires an
 * EXACT 26-char Crockford string, and a hand-typed fixture id can silently miss that
 * length, making resolution fall through to a slug lookup that then fails (a real
 * landmine this suite hit once). Resolving by slug throughout sidesteps it entirely
 * and matches realistic CLI/MCP caller usage (a human/agent types a slug, not a ULID).
 */
async function createPhase(
  plan: DocRecord,
  overrides: Partial<DocRecord> = {},
): Promise<string> {
  phaseCounter += 1;
  const now = "2026-07-20T00:00:00.000Z";
  const doc: DocRecord = {
    id: `01HPHASE0000000000000${String(phaseCounter).padStart(4, "0")}` as DocRecord["id"],
    slug: `phase-mcp-test-${phaseCounter}`,
    type: "phase" as DocRecord["type"],
    role: "plan",
    title: "MCP Test Phase",
    status: "draft",
    priority: "medium",
    content: "# Phase",
    parent_id: plan.id,
    created_at: now,
    updated_at: now,
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: plan.id },
    ...overrides,
  };
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`Failed to insert phase: ${JSON.stringify(result.error)}`);
  return result.value.slug;
}

// ─── Test Setup ────────────────────────────────────────────────────────────────

let app: App;
let server: McpServer;

beforeEach(() => {
  app = makeApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app);
});

// ─── lore_phase_status ─────────────────────────────────────────────────────────

describe("lore_phase_status", () => {
  const call = () => getToolHandler(server, "lore_phase_status");

  it("HAPPY: renders a vacuous scorecard for a freshly-inserted phase with no declared scope/checklist", async () => {
    const plan = await createPlan();
    const phaseSlug = await createPhase(plan);

    const result = await call()({ id_or_slug: phaseSlug });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { state: string; exit_code: number; phase_slug: string };
    expect(data.state).toBe("vacuous");
    expect(data.exit_code).toBe(2);
    expect(data.phase_slug).toBe(phaseSlug);
  });

  it("HAPPY: a manual checklist item that IS checked, with empty ac_scope, reaches 'done'", async () => {
    const plan = await createPlan();
    const phaseSlug = await createPhase(plan, {
      extra: {
        plan_id: plan.id,
        checklist: [
          {
            id: "CHK-1",
            statement: "manual smoke test passes",
            bind: { kind: "manual" },
            checked: { by: "alice", at: "2026-07-20T00:00:00.000Z" },
          },
        ],
      },
    });

    const result = await call()({ id_or_slug: phaseSlug });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { state: string; exit_code: number };
    expect(data.state).toBe("done");
    expect(data.exit_code).toBe(0);
  });

  it("NEGATIVE: a task (not a phase) target → isError, VALIDATION_ERROR", async () => {
    const plan = await createPlan();
    const taskId = await createTask(plan.id);

    const result = await call()({ id_or_slug: taskId });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("ERROR: a non-existent id → isError, DOC_NOT_FOUND", async () => {
    const result = await call()({ id_or_slug: "does-not-exist" });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── lore_evidence_add — phase dispatch + checklist_ref ────────────────────────

describe("lore_evidence_add — SPEC-056 target-type dispatch", () => {
  const call = () => getToolHandler(server, "lore_evidence_add");

  it("HAPPY: a phase target dispatches to PhaseWorkflowService and threads checklist_ref through", async () => {
    const plan = await createPlan();
    const phaseSlug = await createPhase(plan, {
      extra: {
        plan_id: plan.id,
        checklist: [{ id: "CHK-1", statement: "script check", bind: { kind: "script", oracle: "test", command: "bun test" } }],
      },
    });

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — TaskWorkflowService.addEvidence is ALWAYS tried
    // FIRST (per the target-type dispatch), so rejectMissingPassOutputTail's
    // D5 raise runs (and refuses "test" self-report) BEFORE the {field:
    // "type", value:"phase"} probe that triggers the PhaseWorkflowService
    // retry ever executes — masking this test's actual dispatch target.
    // "manual" satisfies D5's one surviving escape, letting the call reach
    // the phase-dispatch retry this test means to exercise.
    const result = await call()({
      id_or_slug: phaseSlug,
      oracle: "manual",
      command: "bun test",
      result: "pass",
      recorded_by: "alice",
      checklist_ref: "CHK-1",
      output_tail: "ok",
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { doc: DocRecord };
    const evidence = data.doc.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.["checklist_ref"]).toBe("CHK-1");
  });

  it("NEGATIVE: a phase target with an UNDECLARED checklist_ref → isError, VALIDATION_ERROR, no evidence written", async () => {
    const plan = await createPlan();
    const phaseSlug = await createPhase(plan);

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — see the HAPPY test above in this describe
    // block for why "manual" is required to reach the phase-dispatch retry
    // (and, in turn, this test's own checklist_ref cross-validation) at all.
    const result = await call()({
      id_or_slug: phaseSlug,
      oracle: "manual",
      command: "bun test",
      result: "pass",
      recorded_by: "alice",
      checklist_ref: "CHK-UNKNOWN",
      output_tail: "ok",
    });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("checklist_ref");
  });

  it("BOUNDARY/REGRESSION: a TASK target never reaches PhaseWorkflowService, ac_ref-only behavior unchanged", async () => {
    const plan = await createPlan();
    const taskId = await createTask(plan.id);

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — "tsc" self-report is now refused; "manual" is
    // the one oracle that still lets a genuinely non-empty self-reported
    // tail succeed, which this test needs since it asserts on a SUCCESSFUL
    // write's resulting doc shape, not on capture_source semantics.
    const result = await call()({
      id_or_slug: taskId,
      oracle: "manual",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "alice",
      output_tail: "ok",
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { doc: DocRecord };
    expect(data.doc.type).toBe("task");
    const evidence = data.doc.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.["checklist_ref"]).toBeUndefined();
  });
});

// ─── lore_evidence_add — missing-oracle-file precheck gates BEFORE dispatch ────
//
// task-mcp-lore-evidence-add-bypasses-the-oracle-file-existence AC-2: the
// precheck must run BEFORE the task-vs-phase target-type dispatch (ONCE, not
// duplicated per branch) — a self-reported test/e2e pass citing a missing
// file on a PHASE target must be rejected the SAME way a task target is,
// without ever reaching PhaseWorkflowService (or TaskWorkflowService's own
// {field:"type", value:"phase"} probe). Vitest's cwd is the repo root
// (`vitest.config.ts` lives there), so the missing-path token below is
// resolved for real via `existsSync` — see `mcp-tools-task-workflow.test.ts`'s
// matching describe block for the fuller rationale.
describe("lore_evidence_add — missing-oracle-file precheck gates the phase branch too", () => {
  const call = () => getToolHandler(server, "lore_evidence_add");
  const MISSING_TEST_FILE = "packages/lore/tests/unit/adapters/ghost-nonexistent-oracle-file.test.ts";

  it("AC-2.E1: a phase target with oracle test + result pass citing a MISSING file → isError, VALIDATION_ERROR on field \"command\" (never reaches PhaseWorkflowService)", async () => {
    const plan = await createPlan();
    const phaseSlug = await createPhase(plan, {
      extra: {
        plan_id: plan.id,
        checklist: [{ id: "CHK-1", statement: "script check", bind: { kind: "script", oracle: "test", command: "bun test" } }],
      },
    });

    const phaseWorkflowService = requirePhaseWorkflowService(app);
    const originalPhaseAddEvidence = phaseWorkflowService.addEvidence.bind(phaseWorkflowService);
    let phaseServiceCalled = false;
    phaseWorkflowService.addEvidence = ((...callArgs: Parameters<typeof originalPhaseAddEvidence>) => {
      phaseServiceCalled = true;
      return originalPhaseAddEvidence(...callArgs);
    }) as typeof phaseWorkflowService.addEvidence;

    try {
      const result = await call()({
        id_or_slug: phaseSlug,
        oracle: "test",
        command: `bunx vitest run ${MISSING_TEST_FILE}`,
        result: "pass",
        recorded_by: "alice",
        checklist_ref: "CHK-1",
      });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; field: string; message: string };
      // reason: field "command" (not "checklist_ref") proves the precheck fired BEFORE
      // any phase-specific validation — a checklist_ref rejection would carry field
      // "checklist_ref" instead (see the NEGATIVE test above).
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.field).toBe("command");
      expect(error.message).toContain(MISSING_TEST_FILE);
      expect(phaseServiceCalled).toBe(false);
    } finally {
      phaseWorkflowService.addEvidence = originalPhaseAddEvidence;
    }
  });
});
