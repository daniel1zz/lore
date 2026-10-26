// @reads packages/lore/tests/unit/adapters/cli-anchor-resolution.bun.test.ts
// @reads packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts
/**
 * `lore evidence` dropped-file guard — the protection that
 * task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a introduced,
 * re-derived from the runner's OWN output by
 * task-skill-implement-tg-32-evidence-precheck-follows-the-one.
 *
 * History. 2026-08-01: `bunx vitest run a.test.ts b.bun.test.ts` ran ONLY
 * `a.test.ts`, exited 0 and warned about nothing — vitest's "no test files
 * found" refusal is evaluated over the WHOLE invocation, so one matching file
 * silences it for every other named file the runner drops. The first fix was a
 * FILENAME-SUFFIX rule ("`.bun.test.ts` belongs to `bun test`, everything else
 * to vitest"). Since 90c2b081 (adr-tg-1-test-runner-decision-measured-
 * comparison-of-bun-only) this repo runs every test, `.bun.test.ts` included,
 * through ONE runner (`bunx --bun vitest run`), so that rule refused a command
 * that genuinely runs the file. It was also a repo convention shipped to
 * consumers (task-gh-1343388703-46: a consumer's `bun test a.test.ts` refused).
 *
 * The protection that remains is the property, not the suffix: a captured pass
 * whose runner summary shows FEWER test files executed than the command named
 * (or none) is refused. That reads the runner's own output
 * (`@lore/core` `countExplicitPathArgs` + `parseExecutedUnits` +
 * `judgeCompleteness`, the same trio `lore verify` already applies), so it
 * holds for any runner and any file-naming scheme, and never refuses a command
 * that did run everything it named.
 *
 * Six-dimension coverage:
 *   HAPPY:      the one-runner command naming a `.bun.test.ts` file whose
 *               summary shows it ran is accepted (the regression that motivated
 *               this task); a chained multi-runner command whose two summaries
 *               sum to the named count is accepted
 *   NEGATIVE:   a command naming 2 files whose summary shows 1 executed is
 *               refused, naming both counts and the dropped-file repair; a
 *               command naming a file whose summary shows 0 executed is refused
 *   BOUNDARY:   no tail / an unrecognised-runner tail / no extractable path are
 *               left alone (fail-open, documented); a case-filtered command is
 *               left to the filtered-pass guard
 *   ERROR:      every refusal is VALIDATION_ERROR on field output_tail, exit 4
 *   STATE:      a refused MCP call writes NO evidence row
 *   REGRESSION: --result fail / expected-fail and out-of-scope oracle kinds
 *               are untouched; the refusal never asserts a repo-specific
 *               two-runner convention
 *
 * @spec_ref task-skill-implement-tg-32-evidence-precheck-follows-the-one
 */

import { liveInvocation, actedStore } from "../../live-invocation.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NoOpTelemetry, ok } from "@lore/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, DocRecord, LoreError } from "@lore/core";
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
import { exitCode } from "../../../src/adapters/cli/utils.js";
import { findUnderMatchedPassRefusal } from "../../../src/adapters/cli/evidence-precheck.js";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
// ─── Fixtures ───────────────────────────────────────────────────────────────

// reason: both named files must EXIST: the MCP surface refuses a missing oracle file (field `command`) before the
// under-match guard speaks (field `output_tail`), so a deleted file turns the parity cases red for the wrong reason.
const BUN_NAMED_FILE = "packages/lore/tests/unit/adapters/cli-anchor-resolution.bun.test.ts";
const VITEST_NAMED_FILE = "packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts";

/** The one-runner command this repo's own evidence now records for a `.bun.test.ts` file. */
const ONE_RUNNER_BUN_FILE_COMMAND = `bunx --bun vitest run ${BUN_NAMED_FILE}`;
/** Two files named; the shape measured 2026-08-01. */
const TWO_FILE_COMMAND = `bunx vitest run ${VITEST_NAMED_FILE} ${BUN_NAMED_FILE}`;

const TAIL_ONE_FILE = "Test Files  1 passed (1)\n     Tests  12 passed (12)\n";
const TAIL_TWO_FILES = "Test Files  2 passed (2)\n     Tests  15 passed (15)\n";
const TAIL_ZERO_FILES = "Test Files  0 passed (0)\n     Tests  0 passed (0)\n";
const TAIL_BUN_ONE_FILE = "Ran 3 tests across 1 file. [12.00ms]\n";

function refuseUnderMatched(overrides: {
  oracle?: string;
  result?: string;
  command?: string;
  outputTail?: string;
}): LoreError | null {
  return findUnderMatchedPassRefusal({
    oracle: overrides.oracle ?? "test",
    result: overrides.result ?? "pass",
    command: overrides.command ?? TWO_FILE_COMMAND,
    ...(overrides.outputTail !== undefined ? { outputTail: overrides.outputTail } : { outputTail: TAIL_ONE_FILE }),
  });
}

type ValidationError = Extract<LoreError, { code: "VALIDATION_ERROR" }>;

function expectRefusedWithExitFour(error: LoreError | null): ValidationError {
  expect(error).not.toBeNull();
  const refusal = error as LoreError;
  expect(refusal.code).toBe("VALIDATION_ERROR");
  expect(exitCode(refusal)).toBe(4);
  if (refusal.code !== "VALIDATION_ERROR") {
    throw new Error(`expected VALIDATION_ERROR, got ${refusal.code}`);
  }
  return refusal;
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("findUnderMatchedPassRefusal — HAPPY", () => {
  it("accepts `bunx --bun vitest run <x>.bun.test.ts` whose summary shows the file ran (the one-runner regression)", () => {
    expect(
      refuseUnderMatched({ command: ONE_RUNNER_BUN_FILE_COMMAND, outputTail: TAIL_ONE_FILE }),
    ).toBeNull();
  });

  it("accepts a .bun.test.ts file under the nested-config form (vitest.node.config.ts) when it ran", () => {
    expect(
      refuseUnderMatched({
        command: `bunx vitest run --config vitest.node.config.ts ${BUN_NAMED_FILE}`,
        outputTail: TAIL_ONE_FILE,
      }),
    ).toBeNull();
  });

  it("accepts a plain `bun test` run of an ordinary .test.ts file (a consumer project's single runner)", () => {
    expect(
      refuseUnderMatched({ command: `bun test ${VITEST_NAMED_FILE}`, outputTail: TAIL_BUN_ONE_FILE }),
    ).toBeNull();
  });

  it("accepts two named files whose summary shows two executed", () => {
    expect(refuseUnderMatched({ outputTail: TAIL_TWO_FILES })).toBeNull();
  });

  it("accepts a chained two-invocation command whose two summaries sum to the named count", () => {
    const chained = `bunx vitest run ${VITEST_NAMED_FILE} && cd packages/lore && bun test ${BUN_NAMED_FILE}`;
    const bothSummaries = `${TAIL_ONE_FILE}\n${TAIL_BUN_ONE_FILE}`;
    expect(refuseUnderMatched({ command: chained, outputTail: bothSummaries })).toBeNull();
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("findUnderMatchedPassRefusal — NEGATIVE", () => {
  it("refuses two named files when the summary shows only one executed, exit code 4", () => {
    const refusal = expectRefusedWithExitFour(refuseUnderMatched({ outputTail: TAIL_ONE_FILE }));
    expect(refusal.field).toBe("output_tail");
  });

  it("names the declared and executed counts and the repair, never a repo runner convention", () => {
    const refusal = expectRefusedWithExitFour(refuseUnderMatched({ outputTail: TAIL_ONE_FILE }));
    expect(refusal.message).toContain("2");
    expect(refusal.message).toContain("1");
    expect(refusal.message).toMatch(/under_match|fewer test files/i);
    expect(refusal.message).toMatch(/re-run|split|runner/i);
    expect(refusal.message).not.toContain("This repo splits");
    expect(refusal.message).not.toContain("CLAUDE.md");
    expect(refusal.value).toBe(TWO_FILE_COMMAND);
  });

  it("refuses a named file whose summary shows zero files executed", () => {
    const refusal = expectRefusedWithExitFour(
      refuseUnderMatched({ command: ONE_RUNNER_BUN_FILE_COMMAND, outputTail: TAIL_ZERO_FILES }),
    );
    expect(refusal.message).toMatch(/zero_match|no test file/i);
  });

  it("refuses the symmetric dropped file under bun test too (no runner is assumed)", () => {
    const refusal = expectRefusedWithExitFour(
      refuseUnderMatched({
        command: `bun test ${BUN_NAMED_FILE} ${VITEST_NAMED_FILE}`,
        outputTail: TAIL_BUN_ONE_FILE,
      }),
    );
    expect(refusal.message).toMatch(/under_match|fewer test files/i);
  });
});

// ─── BOUNDARY (fail-open cases, documented) ─────────────────────────────────

describe("findUnderMatchedPassRefusal — BOUNDARY: nothing to compare, nothing refused", () => {
  it("leaves a call with no output tail alone (the pass-tail requirement owns that gap)", () => {
    expect(
      findUnderMatchedPassRefusal({ oracle: "test", result: "pass", command: TWO_FILE_COMMAND }),
    ).toBeNull();
  });

  it("leaves a tail no known runner summary is recognised in alone (fail-open, as lore verify)", () => {
    expect(refuseUnderMatched({ outputTail: "ok\n" })).toBeNull();
  });

  it("leaves a command naming no test-file path alone", () => {
    expect(refuseUnderMatched({ command: "bunx vitest run --reporter json", outputTail: TAIL_ONE_FILE })).toBeNull();
  });

  it("leaves a case-filtered command to the filtered-pass guard", () => {
    expect(
      refuseUnderMatched({
        command: `bunx vitest run ${VITEST_NAMED_FILE} ${BUN_NAMED_FILE} -t 'AC-1'`,
        outputTail: TAIL_ONE_FILE,
      }),
    ).toBeNull();
  });
});

// ─── REGRESSION (scope gate) ────────────────────────────────────────────────

describe("findUnderMatchedPassRefusal — REGRESSION: out-of-scope oracle/result untouched", () => {
  it("does not gate --result fail or expected-fail", () => {
    expect(refuseUnderMatched({ result: "fail" })).toBeNull();
    expect(refuseUnderMatched({ result: "expected-fail" })).toBeNull();
  });

  it("does not gate out-of-scope oracle kinds", () => {
    for (const oracle of ["tsc", "lint", "build", "manual", "other"]) {
      expect(refuseUnderMatched({ oracle })).toBeNull();
    }
  });

  it("the old filename-suffix export no longer exists", async () => {
    const mod = (await import("../../../src/adapters/cli/evidence-precheck.js")) as Record<string, unknown>;
    expect(mod["findMixedRunnerRefusal"]).toBeUndefined();
    expect(mod["findCrossRunnerTokens"]).toBeUndefined();
  });
});

// ─── MCP gate parity ─────────────────────────────────────────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;

/** Mirrors `evidence-completeness-guard.test.ts`'s fixture App verbatim. */
function makeApp(): App {
  store = actedStore(new InMemoryStore());
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return {
    warn: () => undefined,
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
      async () => ok(new Set<string>()), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe(),
    ),
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

async function createTaskDoc(): Promise<string> {
  const plan = await corpusService.create({
    type: "plan",
    title: "Mixed Runner Guard Parity Plan",
    content: "body",
  } as CreateDocInput);
  if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
  const task = await corpusService.create({
    type: "task",
    title: "Mixed Runner Guard Parity Task",
    parent_id: plan.value.id,
    content: "body",
    extra: { plan_id: plan.value.id },
  } as CreateDocInput);
  if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
  return task.value.id;
}

async function readEvidenceCount(taskId: string): Promise<number> {
  const doc = await corpusService.get(taskId);
  if (!doc.ok) throw new Error(`get failed: ${JSON.stringify(doc.error)}`);
  const evidence = doc.value.doc.extra["verification_evidence"];
  return Array.isArray(evidence) ? evidence.length : 0;
}

let app: App;
let server: McpServer;

beforeEach(() => {
  app = makeApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app, undefined, liveInvocation());
});

describe("MCP lore_evidence_add refuses exactly what the CLI refuses (dropped file)", () => {
  const call = () => getToolHandler(server, "lore_evidence_add");

  it("refuses the under-matched pass byte-identically to the shared decision", async () => {
    const taskId = await createTaskDoc();

    const result = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: TWO_FILE_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
      output_tail: TAIL_ONE_FILE,
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as ValidationError;
    const shared = expectRefusedWithExitFour(refuseUnderMatched({ outputTail: TAIL_ONE_FILE }));
    expect(error.code).toBe(shared.code);
    expect(error.field).toBe(shared.field);
    expect(error.message).toBe(shared.message);
  });

  it("STATE: the refused call writes no evidence row", async () => {
    const taskId = await createTaskDoc();
    expect(await readEvidenceCount(taskId)).toBe(0);

    const refused = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: TWO_FILE_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
      output_tail: TAIL_ONE_FILE,
    });
    expect(refused.isError).toBe(true);
    expect(await readEvidenceCount(taskId)).toBe(0);
  });

  // reason: a complete run clears THIS guard; the self-reported pass is then
  // refused by the separate tail-proof requirement (names --capture), so the
  // refusal wording — not the exit — is what proves which guard spoke
  // (task-raise-the-evidence-tail-guard-s-predicate-to-its-own, D5).
  it("CONTROL: a complete one-runner `.bun.test.ts` run clears this guard (D5 still demands --capture)", async () => {
    const taskId = await createTaskDoc();

    const result = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: ONE_RUNNER_BUN_FILE_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
      output_tail: TAIL_ONE_FILE,
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { message: string };
    expect(error.message).toContain("--capture");
    expect(error.message).not.toMatch(/under_match|fewer test files/i);
    expect(await readEvidenceCount(taskId)).toBe(0);
  });
});
