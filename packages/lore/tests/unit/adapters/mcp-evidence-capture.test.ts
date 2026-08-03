/**
 * Six-dimension tests for MCP runner-capture parity
 * (task-mcp-lore-evidence-add-cannot-set-capture-source-and-has-no).
 *
 * The gap: the CLI's `lore evidence --capture` spawns the oracle command itself
 * and stamps `capture_source: "runner"`; `lore_evidence_add` over MCP had no
 * equivalent and stamped NOTHING, so an agent reaching lore through MCP could
 * not produce a runner-captured row at all — while a self-reported `pass`
 * carrying no captured output is REFUSED. Recording a passing oracle was
 * therefore impossible over MCP.
 *
 * The fix is option (b) of the governing task: the SERVER spawns the command,
 * in the caller-declared `caller_cwd`, and DERIVES `capture_source`. Option (a)
 * — a caller-supplied `capture_source` — was explicitly rejected as "a
 * self-report wearing a runner's label", so the assertions below include the
 * NEGATIVE that no such input field exists: a caller cannot reach `"runner"`
 * except by having its command actually run.
 *
 * MOCK RISK: NONE for the capture itself — every capture case below spawns a
 * REAL child process via the real `spawnSync` and asserts against its REAL
 * output. A mocked spawn would be precisely the proxy
 * adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the warns about
 * for this specific mechanism (the whole point of `capture_source: "runner"` is
 * that something really ran).
 *
 * Dimension mapping:
 *   HAPPY:      capture: true + caller_cwd + a real passing command → the row
 *               stores capture_source "runner" AND an output_tail that is the
 *               command's REAL stdout (asserted by content, not by non-emptiness).
 *   NEGATIVE:   the three refusals that keep the label honest — capture without
 *               caller_cwd (no silent fallback to the server's own cwd),
 *               capture + a caller-supplied output_tail, capture + oracle
 *               "manual" — plus the structural NEGATIVE that the schema exposes
 *               no capture_source input at all.
 *   BOUNDARY:   the declared-vs-observed exit-code cross-check in both
 *               directions: nonzero exit declared "pass" is REFUSED and records
 *               nothing; nonzero exit declared "fail" is ACCEPTED as runner.
 *   ERROR:      an unspawnable capture (caller_cwd that does not exist) is
 *               refused loudly, and no evidence row is written.
 *   STATE:      the field is stamped on EVERY MCP write, not only captured ones
 *               — a no-capture call stores an explicit "self-report" where it
 *               previously stored nothing (this task's literal RED).
 *   REGRESSION: legacy rows with capture_source absent still parse and still
 *               read as self-report; and appendEvidenceEntry still FORCES
 *               "runner" for any attested row regardless of what an adapter
 *               passed alongside it.
 *
 * @spec_ref task-mcp-lore-evidence-add-cannot-set-capture-source-and-has-no
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { NoOpTelemetry, ok, evidenceEntrySchema } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools, LoreEvidenceAddSchema } from "../../../src/adapters/mcp/tools.js";
import { captureOracleCommand } from "../../../src/adapters/evidence-capture.js";
import type { CreateDocInput, DocRecord, EvidenceEntry } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const createdDirs: string[] = [];

/**
 * A plain temp directory holding a marker file with UNIQUE content. Commands
 * below read it by RELATIVE path, which only resolves if the spawn really ran
 * with this directory as its cwd — that is how "the working directory is
 * asserted explicitly, not assumed" is measured rather than trusted.
 */
function makeMarkerDir(marker: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-capture-"));
  createdDirs.push(dir);
  writeFileSync(join(dir, "marker.txt"), marker);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test Infrastructure (mirrors mcp-tools-task-workflow.test.ts) ───────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let taskWorkflowService: TaskWorkflowService;

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store);
  taskWorkflowService = new TaskWorkflowService(
    store,
    new NoOpTelemetry(),
    { claimTtlMinutes: 120 },
    async () => ok(new Set()),
  );
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
    taskWorkflowService,
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

async function createPlan(cs: CorpusService, title = "Capture Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "Capture Task"): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** Reads the evidence array off a tool result's returned doc. */
function evidenceOf(result: CallToolResult): EvidenceEntry[] {
  const data = parseResult(result) as { doc: DocRecord };
  return (data.doc.extra["verification_evidence"] ?? []) as EvidenceEntry[];
}

/** Re-reads the task straight from the store — proves what was PERSISTED. */
async function storedEvidence(taskId: string): Promise<EvidenceEntry[]> {
  const doc = await store.find(taskId);
  if (!doc.ok || doc.value === null) throw new Error("task vanished");
  return (doc.value.extra["verification_evidence"] ?? []) as EvidenceEntry[];
}

let app: App;
let server: McpServer;

beforeEach(() => {
  app = makeApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app);
});

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("HAPPY — an MCP caller can produce a runner-captured evidence row", () => {
  it("capture: true + caller_cwd + a real passing command → capture_source \"runner\" and the tail IS the command's real output", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const marker = "UNIQUE-CAPTURED-STDOUT-9f3a2b";
    const cwd = makeMarkerDir(marker);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "cat marker.txt",
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: cwd,
    });

    expect(result.isError).toBeFalsy();
    const entries = evidenceOf(result);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.capture_source).toBe("runner");
    // The caller supplied NO tail — this content can only have come from the
    // child process's real stdout, read in the declared cwd.
    expect(entries[0]?.output_tail).toContain(marker);
  });

  it("the spawned command's working directory is the declared caller_cwd — asserted, not assumed (a relative read resolves only there)", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const marker = "CWD-PROOF-4c81de";
    const cwd = makeMarkerDir(marker);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "test",
      command: "cat marker.txt",
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: cwd,
    });

    expect(result.isError).toBeFalsy();
    const stored = await storedEvidence(taskId);
    expect(stored[0]?.output_tail).toContain(marker);
    // Control: the SAME relative command run from the MCP server's own cwd
    // would not find that file at all, which is why the cwd must be declared.
    const fromServerCwd = captureOracleCommand({
      command: "cat marker.txt",
      cwd: process.cwd(),
      declaredResult: "fail",
    });
    expect(fromServerCwd.ok).toBe(true);
    if (fromServerCwd.ok) expect(fromServerCwd.value.outputTail).not.toContain(marker);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — the refusals that keep the \"runner\" label honest", () => {
  it("capture: true with NO caller_cwd → refused loudly, never silently falling back to the MCP server's own cwd", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "true",
      result: "pass",
      recorded_by: "alice",
      capture: true,
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field: string; message: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("caller_cwd");
    expect(error.message).toContain("caller_cwd");
    // Nothing recorded — a refused capture must not leave a partial row.
    expect(await storedEvidence(taskId)).toHaveLength(0);
  });

  it("capture: true together with a caller-supplied output_tail → refused (exactly one evidentiary source)", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "true",
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: makeMarkerDir("x"),
      output_tail: "I promise this passed",
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("capture");
    expect(await storedEvidence(taskId)).toHaveLength(0);
  });

  it("capture: true with oracle \"manual\" → refused (a visual check has no command whose exit code proves anything)", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "manual",
      command: "eyeball the dashboard",
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: makeMarkerDir("x"),
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field: string };
    expect(error.field).toBe("capture");
    expect(await storedEvidence(taskId)).toHaveLength(0);
  });

  it("the schema exposes NO capture_source input — a caller cannot assert the label option (a) would have handed it", () => {
    const shape = LoreEvidenceAddSchema.shape as Record<string, unknown>;
    expect(shape["capture_source"]).toBeUndefined();
    // And the opt-in it DOES expose is a boolean, not a free-text label.
    expect(shape["capture"]).toBeDefined();
    // An unknown key is not silently accepted into a typed row either.
    const parsed = LoreEvidenceAddSchema.safeParse({
      id_or_slug: "t",
      oracle: "tsc",
      command: "true",
      result: "pass",
      recorded_by: "alice",
      capture_source: "runner",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>)["capture_source"]).toBeUndefined();
    }
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — the declared-vs-observed exit-code cross-check, both directions", () => {
  it("a nonzero exit declared \"pass\" is REFUSED and records nothing", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "exit 7",
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: makeMarkerDir("x"),
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field: string; message: string };
    expect(error.field).toBe("result");
    expect(error.message).toContain("exit code 7");
    expect(await storedEvidence(taskId)).toHaveLength(0);
  });

  it("a nonzero exit declared \"fail\" is ACCEPTED and still labelled runner", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const cwd = makeMarkerDir("x");

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "echo BOOM-3311 >&2; exit 3",
      result: "fail",
      recorded_by: "alice",
      capture: true,
      caller_cwd: cwd,
    });

    expect(result.isError).toBeFalsy();
    const stored = await storedEvidence(taskId);
    expect(stored[0]?.capture_source).toBe("runner");
    // stderr is captured too, not just stdout.
    expect(stored[0]?.output_tail).toContain("BOOM-3311");
  });

  it("a zero exit declared \"fail\" is REFUSED — the check is symmetric, not pass-only", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "true",
      result: "fail",
      recorded_by: "alice",
      capture: true,
      caller_cwd: makeMarkerDir("x"),
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { field: string; message: string };
    expect(error.field).toBe("result");
    expect(error.message).toContain("exit code 0");
    expect(await storedEvidence(taskId)).toHaveLength(0);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR — an unspawnable capture is refused, never downgraded", () => {
  it("a caller_cwd that does not exist → spawn failure refusal, no evidence row", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "true",
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: join(tmpdir(), "definitely-not-a-real-dir-a71fe3", "nested"),
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("capture");
    expect(await storedEvidence(taskId)).toHaveLength(0);
  });

  it("captureOracleCommand surfaces the same refusal directly (shared SSOT, not an MCP-local branch)", () => {
    const outcome = captureOracleCommand({
      command: "true",
      cwd: join(tmpdir(), "definitely-not-a-real-dir-b82ff4"),
      declaredResult: "pass",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("VALIDATION_ERROR");
      // `field` is present only on LoreError's validation variants — narrow
      // structurally rather than widening the shared type for a test.
      expect((outcome.error as { field?: string }).field).toBe("capture");
    }
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — capture_source is stamped on EVERY MCP write, not only captured ones", () => {
  it("RED of this task: a passing MCP row with a supplied tail and no capture now stores an EXPLICIT \"self-report\" (previously the field was absent)", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "alice",
      output_tail: "hand-written summary",
    });

    expect(result.isError).toBeFalsy();
    const stored = await storedEvidence(taskId);
    expect(stored).toHaveLength(1);
    // The assertion is on the stored VALUE, per this task's Oracle — not on
    // "the field is present".
    expect(stored[0]?.capture_source).toBe("self-report");
  });

  it("a captured row and a self-reported row on the SAME task keep their distinct labels", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const cwd = makeMarkerDir("MIXED-7a2c");

    await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "manual",
      command: "visual check of the panel",
      result: "pass",
      recorded_by: "alice",
      output_tail: "panel renders as designed",
    });
    await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "cat marker.txt",
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: cwd,
    });

    const stored = await storedEvidence(taskId);
    expect(stored).toHaveLength(2);
    expect(stored[0]?.capture_source).toBe("self-report");
    expect(stored[1]?.capture_source).toBe("runner");
    expect(stored[1]?.output_tail).toContain("MIXED-7a2c");
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — legacy rows and the attestation override are untouched", () => {
  it("a legacy entry with capture_source ABSENT still parses and reads as self-report by absence", () => {
    const parsed = evidenceEntrySchema.safeParse({
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_at: "2026-07-01T00:00:00.000Z",
      recorded_by: "alice",
      output_tail: "legacy row",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.capture_source).toBeUndefined();
  });

  it("appendEvidenceEntry still FORCES \"runner\" for an attested row even when \"self-report\" is passed alongside it", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "test",
        command: "bunx vitest run something.test.ts",
        result: "pass",
        recorded_by: "runner",
        output_tail: "3 passed",
        // Deliberately the WRONG label alongside a real attestation.
        capture_source: "self-report",
        attestation: {
          runner: "lore-cli",
          exit_code: 0,
          duration_ms: 1234,
          timed_out: false,
        },
      } as never,
      "2026-08-03T00:00:02.000Z",
    );

    expect(result.ok).toBe(true);
    const stored = await storedEvidence(taskId);
    expect(stored[0]?.attestation).toBeDefined();
    expect(stored[0]?.capture_source).toBe("runner");
  });

  // MEASURED, not assumed (this corrected the test's own first draft): a
  // self-reported `fail` ALSO carries a mandatory non-empty-tail floor, so the
  // "no tail at all" variant is refused for that PRE-EXISTING reason and says
  // nothing about capture. The regression worth pinning is that a legitimate
  // no-capture non-pass row keeps its explicit "self-report" label.
  it("a no-capture, non-pass MCP row is unaffected — still explicitly self-report", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "bun run typecheck",
      result: "fail",
      recorded_by: "alice",
      output_tail: "error TS2554: Expected 1 arguments, but got 0.",
    });

    expect(result.isError === true ? parseResult(result) : null).toBeNull();
    const stored = await storedEvidence(taskId);
    expect(stored[0]?.capture_source).toBe("self-report");
    expect(stored[0]?.result).toBe("fail");
  });
});
