/**
 * `lore evidence` filtered-pass matched-count guard — SPEC-061 AC-061-11 …
 * AC-061-14, AC-061-17.
 *
 * Defect closed (task-lore-evidence-must-refuse-a-t-filtered-pass-with-no):
 * `lore evidence --result pass` stored whatever the caller asserted. When
 * `--command` carries a `-t`/`--testNamePattern` case filter, a filter that
 * matches ZERO tests still exits 0 with every case reported `skipped` — so a
 * drifted or mistyped test title produced a corpus row byte-indistinguishable
 * from a real pass. Measured 2026-07-31: 21 of 21 script ACs across four plans
 * were recorded that way, `attested_evidence_ratio 0.00` on every plan.
 *
 * Binding decision: `adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own`
 * — the proof is the RUNNER'S OWN summary line delivered via
 * `--output-tail`/`--output-tail-file` (MCP `output_tail`), parsed by the
 * shared `@lore/core` classifier. Deliberately NO `--matched <n>` flag: a bare
 * integer is as easy to fabricate as the false `--result pass` it would gate.
 * Fail-CLOSED on a missing/unparseable tail (unlike `judgeCompleteness`'s
 * fail-OPEN posture inside `lore verify`, where the runner has independently
 * observed the exit code — `lore evidence` has observed nothing).
 *
 * Test surface split (why these ACs live at these layers):
 *   - AC-061-11/12/13 drive the PURE decision function
 *     (`findFilteredPassRefusal`, `../../../src/adapters/cli/evidence-precheck.ts`)
 *     — the CLI command itself (`commands/evidence.ts`) imports the bun-only
 *     `loader.ts` (`bun:sqlite`) and is therefore unreachable from vitest; its
 *     end-to-end wiring is pinned by AC-061-16's compiled-binary suite
 *     (`tests/e2e/evidence-completeness-guard-compiled.bun.test.ts`).
 *   - AC-061-14 is a source scan (single definition site).
 *   - AC-061-17 drives the REAL MCP `lore_evidence_add` handler, extracted from
 *     `McpServer._registeredTools` (the `mcp-tools-task-workflow.test.ts`
 *     precedent) — gate parity is asserted by BEHAVIOUR plus byte-identical
 *     refusal message, never by inspecting imports.
 *
 * Coverage:
 *   HAPPY:      a filtered pass whose tail parses to N>0 matched cases is
 *               accepted (AC-061-13); an unfiltered pass records unchanged
 *               through the real MCP handler (AC-061-13, AC-061-17 control)
 *   NEGATIVE:   filtered pass with no tail (AC-061-11); with a zero-matched
 *               tail (AC-061-12)
 *   BOUNDARY:   empty-string tail; `--testNamePattern=` equals form; a tail
 *               with a file-summary line but no matched-CASE line (truncated)
 *   ERROR:      every refusal is `VALIDATION_ERROR` mapping to exit code 4
 *               through the SAME `exitCode()` the CLI uses
 *   STATE:      a refused MCP call writes NO evidence row; the following
 *               unfiltered call on the same task writes exactly one
 *   REGRESSION: unfiltered commands, non-`pass` results and out-of-scope
 *               oracle kinds are untouched — zero new friction (AC-061-13)
 *
 * @spec_ref AC-061-11 AC-061-12 AC-061-13 AC-061-14 AC-061-17
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  findFilteredPassProofGap,
  findFilteredPassRefusal,
} from "../../../src/adapters/cli/evidence-precheck.js";

// ─── Fixture command strings ────────────────────────────────────────────────

/**
 * A `-t`-filtered command naming an EXISTING test file (this very file).
 * Existence matters: the sibling missing-oracle-file precheck
 * (`findMissingOracleFilesForEvidence`) runs first on the real adapters, and a
 * nonexistent path would refuse the call for the WRONG reason — making every
 * "refused" assertion below a false oracle.
 */
const FILTERED_COMMAND =
  "bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts -t 'AC-061-11'";

/** Same file, NO case filter — the control shape the guard must never touch. */
const UNFILTERED_COMMAND =
  "bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts";

/** vitest tail for a filter that matched 3 cases. */
const TAIL_THREE_MATCHED = "\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n";

/**
 * vitest tail for a filter that matched NOTHING: vitest does not print
 * "0 tests" — it prints every test in the loaded file as `skipped`, which is
 * exactly why reading the parenthesised total would report 46 matched cases
 * for a filter that matched none.
 */
const TAIL_ZERO_MATCHED = "\n Test Files  1 skipped (1)\n      Tests  46 skipped (46)\n";

/** bun test tail — a real, parseable summary carrying both counts. */
const TAIL_BUN_FIVE_MATCHED = "\n 5 pass\n 0 fail\nRan 5 tests across 1 files. [412.00ms]\n";

/** A file-level summary with the matched-CASE line truncated away. */
const TAIL_NO_CASE_LINE = "\n Test Files  1 passed (1)\n";

/** No recognised runner summary anywhere. */
const TAIL_UNPARSEABLE = "everything looked fine to me, honest\n";

function refuseFiltered(overrides: {
  oracle?: string;
  result?: string;
  command?: string;
  outputTail?: string;
}): LoreError | null {
  return findFilteredPassRefusal({
    oracle: overrides.oracle ?? "test",
    result: overrides.result ?? "pass",
    command: overrides.command ?? FILTERED_COMMAND,
    ...(overrides.outputTail !== undefined ? { outputTail: overrides.outputTail } : {}),
  });
}

/** The one `LoreError` variant this guard is allowed to produce. */
type ValidationError = Extract<LoreError, { code: "VALIDATION_ERROR" }>;

/** Asserts the shared refusal shape every gap classification must produce. */
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

// ─── AC-061-11: a filtered pass with NO output tail is refused ──────────────

describe("AC-061-11 — filtered --result pass carrying no output tail", () => {
  it("AC-061-11 refuses with VALIDATION_ERROR mapping to exit code 4", () => {
    const refusal = expectRefusedWithExitFour(refuseFiltered({}));
    expect(findFilteredPassProofGap({
      oracle: "test",
      result: "pass",
      command: FILTERED_COMMAND,
    })).toBe("missing_tail");
    expect(refusal.field).toBe("output_tail");
  });

  it("AC-061-11 names the missing matched-count proof and the flags that supply it", () => {
    const refusal = expectRefusedWithExitFour(refuseFiltered({}));
    expect(refusal.message).toContain("matched-count proof");
    expect(refusal.message).toContain("--output-tail");
    expect(refusal.message).toContain("--output-tail-file");
    expect(refusal.message).toContain("output_tail");
  });

  it("AC-061-11 BOUNDARY: an empty-string output tail is no proof either", () => {
    const refusal = expectRefusedWithExitFour(refuseFiltered({ outputTail: "" }));
    expect(refusal.message).toContain("matched-count proof");
  });

  it("AC-061-11 BOUNDARY: the --testNamePattern= equals form is equally in scope", () => {
    const command = `bunx vitest run packages/lore/tests/unit/adapters/evidence-completeness-guard.test.ts --testNamePattern='AC-061-11'`;
    expectRefusedWithExitFour(refuseFiltered({ command }));
  });

  it("AC-061-11 applies to the e2e oracle too, not only test", () => {
    expectRefusedWithExitFour(refuseFiltered({ oracle: "e2e" }));
  });
});

// ─── AC-061-12: zero-matched and unreadable tails are refused (fail-CLOSED) ──

describe("AC-061-12 — a tail that proves nothing is refused", () => {
  it("AC-061-12 refuses a vitest tail whose cases were all skipped, naming zero_match", () => {
    const refusal = expectRefusedWithExitFour(refuseFiltered({ outputTail: TAIL_ZERO_MATCHED }));
    expect(refusal.message).toContain("zero_match");
    expect(findFilteredPassProofGap({
      oracle: "test",
      result: "pass",
      command: FILTERED_COMMAND,
      outputTail: TAIL_ZERO_MATCHED,
    })).toBe("zero_match");
  });

  it("AC-061-12 refuses a bun tail reporting zero tests run, naming zero_match", () => {
    const refusal = expectRefusedWithExitFour(
      refuseFiltered({ outputTail: "\nRan 0 tests across 1 files. [8.00ms]\n" }),
    );
    expect(refusal.message).toContain("zero_match");
  });

  it("AC-061-12 fail-CLOSED: a tail with no recognised runner summary is refused", () => {
    const refusal = expectRefusedWithExitFour(refuseFiltered({ outputTail: TAIL_UNPARSEABLE }));
    expect(findFilteredPassProofGap({
      oracle: "test",
      result: "pass",
      command: FILTERED_COMMAND,
      outputTail: TAIL_UNPARSEABLE,
    })).toBe("unparseable_tail");
    expect(refusal.message).toContain("matched-count proof");
  });

  it("AC-061-12 fail-CLOSED: a tail whose matched-CASE line was truncated away is refused", () => {
    expectRefusedWithExitFour(refuseFiltered({ outputTail: TAIL_NO_CASE_LINE }));
    expect(findFilteredPassProofGap({
      oracle: "test",
      result: "pass",
      command: FILTERED_COMMAND,
      outputTail: TAIL_NO_CASE_LINE,
    })).toBe("no_matched_case_count");
  });
});

// ─── AC-061-13: real proof is accepted; unfiltered runs keep zero friction ───

describe("AC-061-13 — proof accepted, and the unfiltered CONTROL is untouched", () => {
  it("AC-061-13 accepts a filtered pass whose vitest tail parses to 3 matched cases", () => {
    expect(refuseFiltered({ outputTail: TAIL_THREE_MATCHED })).toBeNull();
    expect(findFilteredPassProofGap({
      oracle: "test",
      result: "pass",
      command: FILTERED_COMMAND,
      outputTail: TAIL_THREE_MATCHED,
    })).toBeNull();
  });

  it("AC-061-13 accepts a filtered pass whose bun tail parses to 5 matched cases", () => {
    expect(refuseFiltered({ outputTail: TAIL_BUN_FIVE_MATCHED })).toBeNull();
  });

  it("AC-061-13 CONTROL: an UNFILTERED command with no output tail is accepted unchanged", () => {
    expect(refuseFiltered({ command: UNFILTERED_COMMAND })).toBeNull();
  });

  it("AC-061-13 CONTROL: an UNFILTERED command is not gated even by a zero-matched tail", () => {
    // A whole-file run whose path filter matches nothing exits 1 loudly — the
    // completeness question this guard answers simply does not arise there.
    expect(
      refuseFiltered({ command: UNFILTERED_COMMAND, outputTail: TAIL_ZERO_MATCHED }),
    ).toBeNull();
  });

  it("AC-061-13 CONTROL: a filtered command recorded as fail or expected-fail is not gated", () => {
    expect(refuseFiltered({ result: "fail" })).toBeNull();
    expect(refuseFiltered({ result: "expected-fail" })).toBeNull();
  });

  it("AC-061-13 CONTROL: out-of-scope oracle kinds are not gated", () => {
    for (const oracle of ["tsc", "lint", "build", "manual", "other"]) {
      expect(refuseFiltered({ oracle })).toBeNull();
    }
  });
});

// ─── AC-061-14: single definition site ──────────────────────────────────────

const LORE_SRC_DIR = fileURLToPath(new URL("../../../src/", import.meta.url));
const EVIDENCE_PRECHECK_PATH = join(LORE_SRC_DIR, "adapters", "cli", "evidence-precheck.ts");

/** Every `.ts` file under `packages/lore/src`, recursively. */
function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Drops comment lines (`//`, `/*`, ` * `) so a prose MENTION of a rule is never
 * mistaken for a second IMPLEMENTATION of it — `verify-runner-service.ts`
 * legitimately discusses `--testNamePattern` in its header while importing the
 * real predicate from `@lore/core`.
 */
function stripCommentLines(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*")
      );
    });
}

describe("AC-061-14 — one definition site for filter detection and summary parsing", () => {
  it("AC-061-14 the guard imports both rules from @lore/core's attestation-completeness module", () => {
    const source = readFileSync(EVIDENCE_PRECHECK_PATH, "utf8");
    const importMatch = /import\s*\{([^}]*)\}\s*from\s*"@lore\/core"/s.exec(source);
    expect(importMatch).not.toBeNull();
    const imported = (importMatch?.[1] ?? "").replace(/\s+/g, " ");
    expect(imported).toContain("commandHasCaseFilter");
    expect(imported).toContain("parseExecutedUnits");
  });

  it("AC-061-14 no file under packages/lore/src re-declares either rule in executable code", () => {
    // Markers that can only appear in a SECOND copy of the rule: the filter
    // flag's long name, and the two runner-summary phrases the shared parser
    // owns. Comment lines are stripped first (see stripCommentLines).
    const ruleMarkers = ["testNamePattern", "Test Files", "tests across"];
    const offenders: string[] = [];
    for (const file of listSourceFiles(LORE_SRC_DIR)) {
      for (const line of stripCommentLines(readFileSync(file, "utf8"))) {
        if (ruleMarkers.some((marker) => line.includes(marker))) {
          offenders.push(`${file.slice(LORE_SRC_DIR.length)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("AC-061-14 the guard module itself declares no RegExp literal at all", () => {
    // Both rules it needs are imported; any new regex here would be a candidate
    // second copy. (The module's pre-existing patterns live above this guard's
    // section and are matched by name below, so this asserts the guard section
    // adds none of its own.)
    const guardSection = readFileSync(EVIDENCE_PRECHECK_PATH, "utf8").split(
      "// ─── Filtered-Pass Matched-Count Proof",
    )[1];
    expect(guardSection).toBeDefined();
    expect(stripCommentLines(guardSection ?? "").join("\n")).not.toMatch(/=\s*\/[^/*]/);
  });
});

// ─── AC-061-17: MCP gate parity ─────────────────────────────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;

/** Mirrors `mcp-tools-task-workflow.test.ts`'s fixture App verbatim. */
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
    title: "Guard Parity Plan",
    content: "body",
  } as CreateDocInput);
  if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
  const task = await corpusService.create({
    type: "task",
    title: "Guard Parity Task",
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

describe("AC-061-17 — MCP lore_evidence_add refuses exactly what the CLI refuses", () => {
  const call = () => getToolHandler(server, "lore_evidence_add");

  it("AC-061-17 refuses a filtered pass with no output_tail, byte-identically to the shared decision", async () => {
    const taskId = await createTaskDoc();

    const result = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: FILTERED_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as ValidationError;
    const shared = expectRefusedWithExitFour(refuseFiltered({}));
    // Byte-identical message + code + field: the handler cannot be running a
    // second, independently-worded copy of the rule.
    expect(error.code).toBe(shared.code);
    expect(error.field).toBe(shared.field);
    expect(error.message).toBe(shared.message);
  });

  it("AC-061-17 refuses a zero-matched tail through the MCP surface, naming zero_match", async () => {
    const taskId = await createTaskDoc();

    const result = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: FILTERED_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
      output_tail: TAIL_ZERO_MATCHED,
    });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as ValidationError;
    expect(error.message).toContain("zero_match");
    expect(error.message).toBe(
      expectRefusedWithExitFour(refuseFiltered({ outputTail: TAIL_ZERO_MATCHED })).message,
    );
  });

  it("AC-061-17 STATE: a refused MCP call writes NO evidence row; the accepted call that follows writes exactly one", async () => {
    const taskId = await createTaskDoc();
    expect(await readEvidenceCount(taskId)).toBe(0);

    const refused = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: FILTERED_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
    });
    expect(refused.isError).toBe(true);
    expect(await readEvidenceCount(taskId)).toBe(0);

    const accepted = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: FILTERED_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
      output_tail: TAIL_THREE_MATCHED,
    });
    expect(accepted.isError).toBeFalsy();
    const data = parseResult(accepted) as { doc: DocRecord };
    expect((data.doc.extra["verification_evidence"] as unknown[]).length).toBe(1);
    expect(await readEvidenceCount(taskId)).toBe(1);
  });

  // reason: SUPERSEDED (task-a-non-empty-output-tail-can-be-hand-authored-
  // prose-and-the) — this test originally proved an UNFILTERED pass records
  // with NO output_tail at all, i.e. that `findFilteredPassRefusal`'s guard
  // does not widen into unfiltered commands. That remains true, but EVERY
  // self-reported pass (filtered or not) now ALSO needs a genuinely non-empty
  // tail via the separate `rejectMissingPassOutputTail` guard — this test
  // still proves the unfiltered-command exemption from the FILTERED-pass
  // guard specifically, now with a tail supplied to satisfy the other one.
  it("AC-061-17 CONTROL: an UNFILTERED pass is exempt from the filtered-pass guard (still needs SOME tail, per the separate pass-tail guard)", async () => {
    const taskId = await createTaskDoc();

    const result = await call()({
      id_or_slug: taskId,
      oracle: "test",
      command: UNFILTERED_COMMAND,
      result: "pass",
      recorded_by: "agent:parity",
      output_tail: "ok",
    });

    expect(result.isError).toBeFalsy();
    expect(await readEvidenceCount(taskId)).toBe(1);
  });
});
