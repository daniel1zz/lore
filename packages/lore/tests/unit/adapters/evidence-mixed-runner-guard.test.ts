// @reads packages/lore/tests/integration/cli/assess-ai.bun.test.ts
// @reads packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts
/**
 * `lore evidence` mixed-runner invocation guard — closes
 * task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a.
 *
 * Defect measured 2026-08-01: `bunx vitest run a.test.ts b.bun.test.ts` (TWO
 * files named on the command line) runs ONLY `a.test.ts`, exits 0, and prints
 * no warning that `b.bun.test.ts` was dropped — vitest excludes `.bun.test.ts`
 * files via `vitest.config.ts` (they need `bun:sqlite`), and its own "no test
 * files found" loud refusal is evaluated over the WHOLE invocation, not per
 * named argument: a single matching file anywhere in the command line
 * silences the loud failure for every OTHER named file the runner drops. The
 * symmetric case (a `bun test` invocation naming a plain `.test.ts` file) is
 * refused for the same reason: this repo's two-runner convention
 * (CLAUDE.md "Test file convention") never runs that file under `bun test`.
 *
 * Decided location (task's own "decide WHERE, then mechanize" requirement):
 * `lore evidence` precheck — the failure mode actually observed this session
 * was an agent recording ONE misleading `lore evidence` row (3 vitest files +
 * 1 `.bun.test.ts` in a single `--command`), not a committed script mixing
 * runners (verified: `package.json`'s `test:vitest`/`test:bun` are two
 * separate invocations; `scripts/changed-tests.ts::runVitest`/`runBunTest`
 * spawn each runner with ONLY its own selected files — no committed script
 * mixes). A repo guard would have nothing to catch; the CLI/MCP precheck is
 * the right layer.
 *
 * Why a path-shape check is NOT the same fabricability class the module
 * header excludes a `--matched <n>` flag for: `--matched <n>` would be a bare
 * integer the caller asserts independently of what actually ran — pure
 * self-report. This guard reads the `--command` string the caller ALREADY
 * supplied to name what oracle ran; the caller cannot satisfy it by typing a
 * different number, only by actually splitting the command into two
 * genuinely single-runner invocations (which is the real fix, not a workaround
 * around the check).
 *
 * Test surface split (mirrors `evidence-completeness-guard.test.ts`):
 *   - the PURE decision functions (`findCrossRunnerTokens`,
 *     `findMixedRunnerRefusal`, `../../../src/adapters/cli/evidence-precheck.ts`)
 *     drive HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE.
 *   - MCP gate parity is asserted against the REAL `lore_evidence_add` handler
 *     extracted from `McpServer._registeredTools` (same precedent as
 *     `evidence-completeness-guard.test.ts`'s AC-061-17 block) — gate parity
 *     by BEHAVIOUR plus byte-identical refusal message, never by inspecting
 *     imports.
 *
 * Six-dimension coverage:
 *   HAPPY:      a vitest invocation naming only vitest-family files is
 *               accepted; a bun test invocation naming only its own file is
 *               accepted; the mixed command split into two separate
 *               recordings is accepted both times
 *   NEGATIVE:   a single vitest invocation naming a .bun.test.ts path
 *               alongside a real vitest file is refused, naming the runner
 *               split + the two-command repair
 *   BOUNDARY:   the symmetric case (bun test invocation naming a non-.bun
 *               file) is refused too; a command invoking NEITHER runner is
 *               untouched; a command invoking BOTH (chained) is untouched
 *               (documented non-goal — not a shell-grammar parser)
 *   ERROR:      every refusal is VALIDATION_ERROR mapping to exit code 4
 *   STATE:      a refused MCP call writes NO evidence row; the following
 *               split-in-two calls each write exactly one
 *   REGRESSION: the two existing prechecks (missing-oracle-file,
 *               filtered-pass matched-count) are unaffected — same fixture
 *               commands from evidence-completeness-guard.test.ts still
 *               resolve identically; `--result fail`/`expected-fail` and
 *               out-of-scope oracle kinds are untouched
 *
 * @spec_ref task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a
 */

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
import {
  findCrossRunnerTokens,
  findMixedRunnerRefusal,
} from "../../../src/adapters/cli/evidence-precheck.js";

// ─── Fixture command strings ────────────────────────────────────────────────

/** The exact shape measured 2026-08-01 — two vitest files plus one .bun.test.ts. */
const MIXED_VITEST_COMMAND =
  "bunx vitest run packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts " +
  "packages/lore/tests/integration/cli/assess-ai.bun.test.ts";

/** The same file set, split in two — the required repair shape. */
const SPLIT_VITEST_COMMAND =
  "bunx vitest run packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts";
const SPLIT_BUN_COMMAND =
  "cd packages/lore && bun test tests/integration/cli/assess-ai.bun.test.ts";

/** Symmetric case: a bun test invocation naming a non-.bun file. */
const MIXED_BUN_COMMAND =
  "cd packages/lore && bun test tests/integration/cli/assess-ai.bun.test.ts " +
  "tests/unit/adapters/mcp-tools-assess.test.ts";

function refuseMixed(overrides: {
  oracle?: string;
  result?: string;
  command?: string;
}): LoreError | null {
  return findMixedRunnerRefusal({
    oracle: overrides.oracle ?? "test",
    result: overrides.result ?? "pass",
    command: overrides.command ?? MIXED_VITEST_COMMAND,
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

// ─── findCrossRunnerTokens — HAPPY ──────────────────────────────────────────

describe("findCrossRunnerTokens — HAPPY", () => {
  it("returns [] for a vitest invocation naming only vitest-family files", () => {
    expect(findCrossRunnerTokens(SPLIT_VITEST_COMMAND)).toEqual([]);
  });

  it("returns [] for a bun test invocation naming only its own .bun.test.ts file", () => {
    expect(findCrossRunnerTokens(SPLIT_BUN_COMMAND)).toEqual([]);
  });
});

// ─── findCrossRunnerTokens — NEGATIVE ───────────────────────────────────────

describe("findCrossRunnerTokens — NEGATIVE", () => {
  it("reports the .bun.test.ts token when a vitest invocation also names it", () => {
    expect(findCrossRunnerTokens(MIXED_VITEST_COMMAND)).toEqual([
      "packages/lore/tests/integration/cli/assess-ai.bun.test.ts",
    ]);
  });

  it("reports the non-.bun token when a bun test invocation also names it", () => {
    expect(findCrossRunnerTokens(MIXED_BUN_COMMAND)).toEqual([
      "tests/unit/adapters/mcp-tools-assess.test.ts",
    ]);
  });
});

// ─── findCrossRunnerTokens — BOUNDARY ───────────────────────────────────────

describe("findCrossRunnerTokens — BOUNDARY", () => {
  it("returns [] for a command invoking neither runner", () => {
    expect(findCrossRunnerTokens("bun run typecheck")).toEqual([]);
  });

  it("returns [] for a command invoking BOTH runners (chained, not a shell parser)", () => {
    const chained = `${SPLIT_VITEST_COMMAND} && ${SPLIT_BUN_COMMAND}`;
    expect(findCrossRunnerTokens(chained)).toEqual([]);
  });

  it("returns [] for a command with no extractable test-file token", () => {
    expect(findCrossRunnerTokens("bunx vitest run --reporter json")).toEqual([]);
  });
});

// ─── findMixedRunnerRefusal — NEGATIVE ──────────────────────────────────────

describe("findMixedRunnerRefusal — NEGATIVE", () => {
  it("refuses a single vitest invocation naming a .bun.test.ts path, exit code 4", () => {
    const refusal = expectRefusedWithExitFour(refuseMixed({}));
    expect(refusal.field).toBe("command");
  });

  it("names the runner split and the two-command repair", () => {
    const refusal = expectRefusedWithExitFour(refuseMixed({}));
    expect(refusal.message).toContain("vitest run");
    expect(refusal.message).toContain("bun test");
    expect(refusal.message).toContain(
      "packages/lore/tests/integration/cli/assess-ai.bun.test.ts",
    );
    expect(refusal.message).toMatch(/split|two.*command|two.*invocation/i);
  });

  it("refuses the symmetric bun-test-invocation case, naming the non-.bun file", () => {
    const refusal = expectRefusedWithExitFour(refuseMixed({ command: MIXED_BUN_COMMAND }));
    expect(refusal.message).toContain("tests/unit/adapters/mcp-tools-assess.test.ts");
  });
});

// ─── findMixedRunnerRefusal — HAPPY / REGRESSION ────────────────────────────

describe("findMixedRunnerRefusal — HAPPY / REGRESSION", () => {
  it("accepts the same file set once split into two separate recordings", () => {
    expect(refuseMixed({ command: SPLIT_VITEST_COMMAND })).toBeNull();
    expect(refuseMixed({ command: SPLIT_BUN_COMMAND })).toBeNull();
  });

  it("does not gate a chained BOTH-runner command (documented non-goal)", () => {
    const chained = `${SPLIT_VITEST_COMMAND} && ${SPLIT_BUN_COMMAND}`;
    expect(refuseMixed({ command: chained })).toBeNull();
  });

  it("does not gate a command invoking neither runner", () => {
    expect(refuseMixed({ command: "bun run typecheck" })).toBeNull();
  });
});

// ─── findMixedRunnerRefusal — BOUNDARY (scope gate) ─────────────────────────

describe("findMixedRunnerRefusal — BOUNDARY: out-of-scope oracle/result untouched", () => {
  it("does not gate --result fail or expected-fail", () => {
    expect(refuseMixed({ result: "fail" })).toBeNull();
    expect(refuseMixed({ result: "expected-fail" })).toBeNull();
  });

  it("does not gate out-of-scope oracle kinds", () => {
    for (const oracle of ["tsc", "lint", "build", "manual", "other"]) {
      expect(refuseMixed({ oracle })).toBeNull();
    }
  });
});

// ─── MCP gate parity ─────────────────────────────────────────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;

/** Mirrors `evidence-completeness-guard.test.ts`'s fixture App verbatim. */
function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return {
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
  registerTools(server, app);
});

describe("MCP lore_evidence_add refuses exactly what the CLI refuses (mixed-runner)", () => {
  const call = () => getToolHandler(server, "lore_evidence_add");

  it("refuses the mixed command byte-identically to the shared decision", async () => {
    const taskId = await createTaskDoc();

    const result = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: MIXED_VITEST_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as ValidationError;
    const shared = expectRefusedWithExitFour(refuseMixed({}));
    expect(error.code).toBe(shared.code);
    expect(error.field).toBe(shared.field);
    expect(error.message).toBe(shared.message);
  });

  // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-
  // own, D5) — `firstHalf`/`secondHalf` below used to satisfy the mixed-
  // runner guard (each names only ONE runner's files) and record cleanly
  // with a hand-typed "ok" tail. D5's rejectMissingPassOutputTail raise now
  // ALSO refuses self-reported oracle-"test" passes regardless of tail
  // content, so satisfying the mixed-runner guard is necessary but no longer
  // sufficient — all three calls below now write zero rows.
  it("STATE SUPERSEDED: a refused MCP call writes NO evidence row; the split-in-two calls are ALSO refused by D5, so all three write zero", async () => {
    const taskId = await createTaskDoc();
    expect(await readEvidenceCount(taskId)).toBe(0);

    const refused = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: MIXED_VITEST_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
    });
    expect(refused.isError).toBe(true);
    expect(await readEvidenceCount(taskId)).toBe(0);

    const firstHalf = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: SPLIT_VITEST_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
      output_tail: "ok",
    });
    expect(firstHalf.isError).toBe(true);
    const firstHalfError = parseResult(firstHalf) as { message: string };
    expect(firstHalfError.message).toContain("--capture");
    expect(await readEvidenceCount(taskId)).toBe(0);

    const secondHalf = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: SPLIT_BUN_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
      output_tail: "ok",
    });
    expect(secondHalf.isError).toBe(true);
    const secondHalfError = parseResult(secondHalf) as { message: string };
    expect(secondHalfError.message).toContain("--capture");
    expect(await readEvidenceCount(taskId)).toBe(0);
  });

  // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-
  // own, D5) — this "unrelated" single-runner pass used to record cleanly
  // with a hand-typed "ok" tail once past the mixed-runner guard. D5 now
  // ALSO refuses it (self-reported oracle "test", no --capture) — see the
  // STATE test above's identical supersession.
  it("CONTROL SUPERSEDED: an unrelated unfiltered single-runner pass clears the mixed-runner guard, but D5 still refuses without --capture", async () => {
    const taskId = await createTaskDoc();

    const result = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: SPLIT_VITEST_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
      output_tail: "ok",
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { message: string };
    expect(error.message).toContain("--capture");
    expect(await readEvidenceCount(taskId)).toBe(0);
  });
});
