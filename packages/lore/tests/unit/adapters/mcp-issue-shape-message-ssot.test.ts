/**
 * MCP `lore_report_issue` retired-shape refusal — SSOT probe (P1, RED-first).
 *
 * @spec_ref AC-MS-2, AC-MS-3
 *
 * spec-the-retired-shape-refusal-message-has-two-byte-identical D1/D2: the
 * MCP handler's behaviour on all three `feedback.upstream` shapes is
 * CORRECT today — it refuses unconfigured and retired shapes with distinct,
 * correct messages. ⛔ AMENDED 2026-08-25 (AC-MS-3(b), superseded by
 * spec-a-github-filed-defect-must-be-claimable-one-ingest-seam D12): the
 * GitHub shape no longer refuses by design — it FILES through
 * `fileGithubIssue`. This file's own GitHub-shape fixture (missing
 * `severity`/`category`) still gets refused, but by the handler's
 * missing-required-field PRE-CHECK, never the retired-shape upstream
 * classification this file used to pin. What this file pins is NOT a
 * behaviour bug on the two branches it still fully covers:
 * it is that the RETIRED-shape message has TWO byte-identical definitions
 * (report-issue-wiring.ts's private `buildRetiredFeedbackUpstreamError`, and
 * the MCP handler's own restatement in `adapters/mcp/tools.ts`), and no
 * oracle fails when they diverge. AC-MS-2's equality assertion (not
 * `toContain`) is the whole point — a drifted copy that still contains the
 * canonical fragment must FAIL it.
 *
 * ⛔ `buildRetiredFeedbackUpstreamError` is module-private at
 * report-issue-wiring.ts:172 as measured at HEAD 063d07c1 (this spec's own
 * "Measured baseline" table) — this file's top-level import of it is
 * written AS IF it were already exported, deliberately (spec D1 / plan
 * P2). Until P2 exports it, importing this file fails. That failure IS the
 * red this plan's P1 phase records — see this task's `lore evidence
 * --result expected-fail` entry for the exact failure text.
 *
 * Six-dimension coverage note: this file's scope is exactly AC-MS-2 and
 * AC-MS-3 — AC-MS-1 (whole-tree grep) and AC-MS-4 (green-control substring)
 * are pure `grep`/CLI-probe ACs with no vitest describe here, per the
 * governing plan's own P1 scope split (this file vs.
 * issues-upstream-shape-refusal.bun.test.ts).
 *   HAPPY:      n/a — every branch under test is a refusal; there is no
 *               success path on this handler (SPEC-072 T5's MCP surface
 *               only ever files-or-refuses, and filing is out of this
 *               plan's scope).
 *   NEGATIVE:   AC-MS-2 — the retired-shape refusal must come from the
 *               shared builder, not a local restatement that happens to
 *               read the same today.
 *   BOUNDARY:   AC-MS-3(b)'s negative clause — the GitHub-shape message
 *               must NOT contain the retired-shape fragment, which is what
 *               stops AC-MS-2 from being satisfiable by collapsing all
 *               three branches onto one message.
 *   ERROR:      AC-MS-3(a) — the unconfigured branch's exact LoreError.
 *   STATE:      AC-MS-2 — message equality is a same-run structural
 *               property of the SSOT, not a one-off value comparison.
 *   REGRESSION: AC-MS-3 — the two branches this plan does NOT touch keep
 *               their pre-existing wording after the SSOT refactor.
 */

import { liveInvocation, actedStore } from "../../live-invocation.js";
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
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { NoOpTelemetry, LoreConfigSchema, VENDOR_INTAKE_REPO, buildUnconfiguredUpstreamRemedy } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { LoreConfig } from "@lore/core";
// ⛔ EXPECTED TO FAIL AT IMPORT TIME until P2 (task-skill-implement-export-
// buildRetiredFeedbackUpstreamError-and-wire-the-mcp-handler-onto-it, or
// whatever P2's task slug resolves to) exports this symbol from
// report-issue-wiring.ts. See file header — do not "fix" this red by
// importing from a different path, re-declaring the function locally, or
// widening to a namespace import; the point is this EXACT named export.
import { buildRetiredFeedbackUpstreamError } from "../../../src/adapters/cli/report-issue-wiring.js";

// ─── Test Infrastructure (mirrors mcp-tools.test.ts's makeApp/getToolHandler) ─

const stubApiKeyStore = {} as ApiKeyStore;

function makeApp(): App {
  const store = actedStore(new InMemoryStore());
  return {
    warn: () => undefined,
    corpusService: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    // reason: this file never exercises the AI/sync/phase/task-workflow/
    // spec-kind/audit paths — null-cast per the established mcp-tools.test.ts
    // precedent for satisfying App's required fields without constructing
    // heavyweight services this file's ACs never touch.
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(store, new NoOpTelemetry()),
    auditService: null as unknown as App["auditService"],
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

// reason: McpServer._registeredTools is private — must use a standalone type
// (not intersection) and cast via unknown to access internal state, same
// pattern as mcp-tools.test.ts's own McpServerInternal.
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

/** Parses the MCP error-content envelope `errorContent()` produces (adapters/mcp/tools.ts). */
function parseError(result: CallToolResult): { code: string; field?: string; message: string } {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text) as { code: string; field?: string; message: string };
}

/**
 * Builds a minimal valid `LoreConfig` via the real schema (never a hand-typed
 * literal that could silently drift from `FeedbackConfigSchema`'s shape) —
 * `feedback.upstream` set per test case, omitted entirely for "unconfigured".
 */
function makeConfig(upstream?: Record<string, unknown>): LoreConfig {
  return LoreConfigSchema.parse({
    project: { name: "test", author: "test" },
    ...(upstream !== undefined ? { feedback: { upstream } } : {}),
  }) as LoreConfig;
}

/** Registers a fresh McpServer whose `getConfig` resolves to a FIXED config — one per shape under test. */
function makeServerWithConfig(config: LoreConfig): McpServer {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, makeApp(), () => config, liveInvocation());
  return server;
}

/** Arguments `LoreReportIssueSchema` requires — shape under test only varies via `getConfig`. */
const REPORT_ISSUE_ARGS = {
  by: "agent:ssot-probe",
  title: "SSOT probe report",
  description: "probing the retired-shape refusal message's source",
  expected: "the shared builder's message",
  actual: "under test",
};

const RETIRED_UPSTREAM = { root_prd: "prd-legacy-target" };
const GITHUB_UPSTREAM = { repo: "acme/widget" };
/** The vendor-consent shape (2026-08-25) — CONSENT only; the address is not written here. */
const VENDOR_UPSTREAM = { vendor: true };

// ─── AC-MS-2 ───────────────────────────────────────────────────────────────

describe("AC-MS-2 MCP retired-shape refusal comes from the shared definition", () => {
  it("the MCP lore_report_issue retired-shape refusal message equals buildRetiredFeedbackUpstreamError's own output", async () => {
    const server = makeServerWithConfig(makeConfig(RETIRED_UPSTREAM));
    const call = getToolHandler(server, "lore_report_issue");

    const result = await call(REPORT_ISSUE_ARGS);

    expect(result.isError).toBe(true);
    const error = parseError(result);
    const canonical = buildRetiredFeedbackUpstreamError();
    // ⛔ Equality, not containment — a drifted copy that still contains the
    // canonical fragment must FAIL this. That is the entire point of AC-MS-2.
    expect(error.message).toBe(canonical.message);
  });
});

// ─── Vendor-consent branch (2026-08-25) — PRODUCTION WIRING, not capability ─

describe("the MCP handler routes vendor-consent configs through the shared classifier", () => {
  it("a {vendor: true} feedback.upstream reaches the GitHub filing path addressed at VENDOR_INTAKE_REPO — never the retired-shape refusal", async () => {
    // ⛔ This is a WIRING assertion, and it drives the real surface: the MCP
    // `lore_report_issue` handler used to re-derive shape policy itself with
    // `resolveFeedbackUpstreamCfg` + `isGithubUpstreamCfg`. That chain tests
    // `"repo" in cfg`; a vendor config carries no `repo`, so it fell through to
    // the LEGACY branch and refused a valid config with the retired-SQLite
    // message. Normalizing inside `classifyFeedbackUpstream` is only half the
    // fix — this test proves the MCP surface actually consumes it.
    //
    // MEASURED, not guessed: `REPORT_ISSUE_ARGS` carries no `severity`/
    // `category`, so the handler's own missing-required-triage-field pre-check
    // refuses BEFORE any `gh` call. That refusal is what makes this a safe,
    // network-free probe AND what gives it discriminating power — the pre-check
    // ECHOES the resolved `cfg.repo`, so the message text proves which address
    // the classifier handed over.
    const server = makeServerWithConfig(makeConfig(VENDOR_UPSTREAM));
    const call = getToolHandler(server, "lore_report_issue");

    const result = await call(REPORT_ISSUE_ARGS);

    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("severity,category");
    // Reached the GitHub filing path, addressed at the vendor intake.
    expect(error.message).toContain(VENDOR_INTAKE_REPO);
    // ⛔ The load-bearing negative: the pre-vendor handler produced THIS text
    // for exactly this input.
    expect(error.message).not.toContain("configured with the retired SQLite shape");
  });
});

// ─── AC-MS-3 ───────────────────────────────────────────────────────────────

describe("AC-MS-3 MCP unconfigured and GitHub refusals unchanged", () => {
  it("an unconfigured feedback.upstream returns the shared unconfigured remedy, imported not restated", async () => {
    const server = makeServerWithConfig(makeConfig(undefined));
    const call = getToolHandler(server, "lore_report_issue");

    const result = await call(REPORT_ISSUE_ARGS);

    expect(result.isError).toBe(true);
    const error = parseError(result);
    // Compare against the IMPORTED builder's own output — never a restated
    // literal — so this probe cannot pass by coincidentally matching text
    // that has since drifted from the real remedy.
    expect(error).toEqual(buildUnconfiguredUpstreamRemedy());
  });

  it("a GitHub-shaped feedback.upstream, missing severity/category, is refused by the pre-check before any filing attempt — never with the retired-shape message", async () => {
    // ⛔ AMENDED 2026-08-25 (AC-MS-3(b)): the original positive half asserted
    // "still refuses with a message containing 'filing via' and
    // 'lore_report_issue'" — spec-a-github-filed-defect-must-be-claimable-
    // one-ingest-seam D12 deliberately DELETED that refusal; the handler now
    // FILES through `fileGithubIssue` for a well-formed GitHub-shaped
    // request. That positive half is retired because it asserted behaviour
    // that is now, by design, absent.
    //
    // MEASURED (not guessed) with THIS file's existing REPORT_ISSUE_ARGS
    // fixture, which carries no `severity`/`category`: the handler's own
    // missing-required-triage-field pre-check (`adapters/mcp/tools.ts`)
    // refuses BEFORE `fileGithubIssue`/any `gh` call is ever attempted — this
    // fixture never reaches a real filing attempt. New positive half, true
    // of that measured behaviour, with real discriminating power (a
    // collapsed-onto-the-retired-message handler would fail the `code`/
    // `field` assertions below just as surely as the deleted literals would
    // have caught it):
    const server = makeServerWithConfig(makeConfig(GITHUB_UPSTREAM));
    const call = getToolHandler(server, "lore_report_issue");

    const result = await call(REPORT_ISSUE_ARGS);

    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("severity,category");
    expect(error.message).toContain("requires severity and category");
    expect(error.message).toContain(GITHUB_UPSTREAM.repo);
    // ⛔ Load-bearing negative clause (spec AC-MS-3(b), kept VERBATIM): what
    // stops AC-MS-2 from being satisfiable by collapsing all three branches
    // onto the retired-shape message.
    expect(error.message).not.toContain("configured with the retired SQLite shape");
  });
});
