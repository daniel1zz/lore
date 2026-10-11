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
 * APPENDED GROUP (`CAPMCP-*`, task-the-ac-scope-re-keying-left-the-red-first-
 * floor-unarmed face 3 item 1): this adapter did not pass a config-resolved
 * capture WINDOW, so `capture: true` always ran at the 600 000 ms schema default
 * while the CLI honoured `workflow.evidence.capture_timeout_ms`. That group has
 * its own six-dimension mapping in its own header comment further down, and
 * keys every assertion on the DIFFERENCE the config makes (the refusal's
 * `value.capture_timeout_ms`), never on the call being accepted.
 *
 * @spec_ref task-mcp-lore-evidence-add-cannot-set-capture-source-and-has-no
 * @spec_ref task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
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
import { NoOpTelemetry, ok, evidenceEntrySchema, LoreConfigSchema } from "@lore/core";
import type { LoreConfig } from "@lore/core";
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
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  taskWorkflowService = new TaskWorkflowService(
    store,
    new NoOpTelemetry(),
    { claimTtlMinutes: 120 },
    async () => ok(new Set()),
  );
  return {
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
  // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-
  // own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5) — this
  // test used to prove a "tsc"-oracle self-report with a hand-written tail
  // recorded cleanly, storing capture_source:"self-report" verbatim. That
  // exact shape (self-report + hand-authored tail, no --capture) is the D5
  // defect: it is now REFUSED outright for every oracle but "manual", never
  // reaching a stored row at all — the guard's PREDICATE, not just its
  // labeling, is what changed here.
  it("RED of this task, SUPERSEDED by D5: a passing MCP row with a hand-written tail and no capture is now REFUSED, never stored (oracle \"tsc\" has no self-report escape)", async () => {
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

    expect(result.isError).toBe(true);
    const stored = await storedEvidence(taskId);
    expect(stored).toHaveLength(0);
  });

  it("D5's one surviving self-report escape: an --oracle manual row with a hand-written tail still stores an EXPLICIT \"self-report\"", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "manual",
      command: "checked the login page by hand",
      result: "pass",
      recorded_by: "alice",
      output_tail: "hand-written summary",
    });

    expect(result.isError).toBeFalsy();
    const stored = await storedEvidence(taskId);
    expect(stored).toHaveLength(1);
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

// ─── The CONFIGURED capture window (CAPMCP-*) ────────────────────────────────
//
// Residual closed by task-the-ac-scope-re-keying-left-the-red-first-floor-
// unarmed (face 3, item 1): this adapter passed NO `timeoutMs`, so
// `lore_evidence_add {capture: true}` always ran at the 600 000 ms schema
// default while the CLI honoured `workflow.evidence.capture_timeout_ms`. The
// timeout DETECTION half was already shared, so MCP refused correctly — only
// the configurability was missing, which is exactly the shape of a silently
// inert knob (knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false):
// an exit-code-only check on this surface passed before AND after the fix.
//
// Every assertion below therefore keys on the DIFFERENCE the config makes —
// the refusal's own `value.capture_timeout_ms` and the elapsed/window numbers
// in its message — never on "the call was accepted".
//
// Dimension mapping for this group:
//   HAPPY:      a GENEROUS configured window captures a command that a small
//               one refuses — same command, same fixture
//   NEGATIVE:   a small configured window refuses loudly and records NOTHING
//   BOUNDARY:   both directions of the knob on the SAME command, plus the
//               refusal carrying the CONFIGURED number rather than the default
//   ERROR:      a partially-populated `workflow` section (no `evidence` key)
//               resolves to the default instead of throwing
//   STATE:      the live control — a server registered with NO getConfig (the
//               pre-fix construction) still runs at the 600 000 ms default
//   REGRESSION: a captured row under a configured window keeps `runner` and the
//               child's real output — the knob changes the window, nothing else

/** A parsed LoreConfig carrying exactly one non-default knob. */
function configWithCaptureWindow(captureTimeoutMs: number): LoreConfig {
  return LoreConfigSchema.parse({
    project: { name: "capture-window-fixture", author: "tester" },
    workflow: { evidence: { capture_timeout_ms: captureTimeoutMs } },
  });
}

/**
 * A server registered over the SAME app with an explicit config getter — the
 * production wiring (`startMcpServer(app, getConfig)`), which is what makes the
 * getter observable per call rather than frozen at registration.
 */
function serverWithConfig(config: LoreConfig | undefined): McpServer {
  const configured = new McpServer({ name: "test-configured", version: "0.0.0" });
  registerTools(configured, app, () => config);
  return configured;
}

/** The command every direction of the knob is measured against — one second of real work. */
const ONE_SECOND_COMMAND = "sleep 1";

describe("CAPMCP — lore_evidence_add honours workflow.evidence.capture_timeout_ms", () => {
  it("CAPMCP-N1: a 300ms configured window refuses `sleep 1` loudly, names the CONFIGURED window, and records nothing", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const configured = serverWithConfig(configWithCaptureWindow(300));

    const result = await getToolHandler(configured, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "test",
      command: ONE_SECOND_COMMAND,
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: makeMarkerDir("CAPMCP-N1"),
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as {
      code: string;
      field: string;
      message: string;
      value: { capture_timeout_ms: number };
    };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("capture");
    // THE assertion that distinguishes a wired knob from an inert one: the
    // window the runner actually enforced is the CONFIGURED one, not the default.
    expect(error.value.capture_timeout_ms).toBe(300);
    expect(error.value.capture_timeout_ms).not.toBe(600_000);
    // Two independent lone tokens rather than one remembered sentence.
    expect(error.message).toContain("workflow.evidence.capture_timeout_ms");
    expect(error.message).toContain("300ms");
    // A refused capture leaves no row of ANY class — least of all the weaker
    // self-report one this whole mechanism exists to avoid degrading into.
    expect(await storedEvidence(taskId)).toHaveLength(0);
  });

  it("CAPMCP-H1/B1: BOTH directions on the SAME command — 300ms refuses, 30000ms captures one runner row", async () => {
    const planId = await createPlan(corpusService);
    const refusedTaskId = await createTask(corpusService, planId, "Refused Window Task");
    const capturedTaskId = await createTask(corpusService, planId, "Captured Window Task");
    const cwd = makeMarkerDir("CAPMCP-B1");

    const refused = await getToolHandler(serverWithConfig(configWithCaptureWindow(300)), "lore_evidence_add")({
      id_or_slug: refusedTaskId,
      oracle: "test",
      command: ONE_SECOND_COMMAND,
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: cwd,
    });
    expect(refused.isError).toBe(true);
    expect(await storedEvidence(refusedTaskId)).toHaveLength(0);

    const captured = await getToolHandler(
      serverWithConfig(configWithCaptureWindow(30_000)),
      "lore_evidence_add",
    )({
      id_or_slug: capturedTaskId,
      oracle: "test",
      command: ONE_SECOND_COMMAND,
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: cwd,
    });
    expect(captured.isError).toBeFalsy();
    const stored = await storedEvidence(capturedTaskId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.capture_source).toBe("runner");
  });

  it("CAPMCP-S1: the live control — a server registered with NO getConfig still runs at the (1200000ms, raised 2026-08-11) default", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // `server` is the beforeEach-registered instance: registerTools(server, app)
    // with no third argument, i.e. the pre-fix construction. `sleep 1` must be
    // CAPTURED there — proving the fix did not shrink the default window and
    // that CAPMCP-N1's refusal came from the config, not from the change itself.
    const result = await getToolHandler(server, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "test",
      command: ONE_SECOND_COMMAND,
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: makeMarkerDir("CAPMCP-S1"),
    });

    expect(result.isError).toBeFalsy();
    const stored = await storedEvidence(taskId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.capture_source).toBe("runner");
  });

  it("CAPMCP-E1: a config whose workflow section omits `evidence` resolves to the default window, never throws", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const partial = LoreConfigSchema.parse({
      project: { name: "partial", author: "tester" },
      workflow: { claim_ttl_minutes: 60 },
    });
    const configured = serverWithConfig(partial);

    const result = await getToolHandler(configured, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "test",
      command: "true",
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: makeMarkerDir("CAPMCP-E1"),
    });

    expect(result.isError).toBeFalsy();
    expect(await storedEvidence(taskId)).toHaveLength(1);
  });

  it("CAPMCP-R1: under a configured window a captured row still carries `runner` and the child's REAL output", async () => {
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const marker = "CAPMCP-REAL-OUTPUT-6d21af";
    const cwd = makeMarkerDir(marker);
    const configured = serverWithConfig(configWithCaptureWindow(30_000));

    const result = await getToolHandler(configured, "lore_evidence_add")({
      id_or_slug: taskId,
      oracle: "tsc",
      command: "cat marker.txt",
      result: "pass",
      recorded_by: "alice",
      capture: true,
      caller_cwd: cwd,
    });

    expect(result.isError).toBeFalsy();
    const stored = await storedEvidence(taskId);
    expect(stored[0]?.capture_source).toBe("runner");
    expect(stored[0]?.output_tail).toContain(marker);
  });
});
