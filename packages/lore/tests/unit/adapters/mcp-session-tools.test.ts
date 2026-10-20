// @layer mcp-adapter AC-SL-10 AC-CP-4 (in-process MCP session tools; owners drive services and the CLI)
/**
 * Unit tests for the SPEC-041 session MCP tools: lore_bootstrap, lore_handoff, and
 * lore_feed's session-resume dispatch branch.
 *
 * Scope: end-to-end through a real `CorpusService` + `SessionService` backed by
 * `InMemoryStore` (vitest-reachable, no `bun:sqlite`) — registration/handler-plumbing
 * style mirrors `mcp-tools-feed.test.ts` (register real tools against a McpServer,
 * extract handlers from the internal `_registeredTools` map, invoke directly).
 *
 * AC-SL-6's "payloads deep-equal the CLI --json shapes for the same seeded corpus"
 * requirement is verified by calling the exact same `SessionService` methods the CLI
 * commands call, against the same seeded `InMemoryStore` — `lore bootstrap --json`
 * prints `{ok: true, data: <BootstrapReport>}` (raw passthrough of
 * `sessionService.bootstrap(by)`, see `commands/bootstrap.ts`'s `run()`), so the CLI
 * JSON shape for bootstrap is just the same `BootstrapReport` the MCP tool wraps as
 * `{report: ...}`. For handoff, the CLI's `--json` output is `{ok: true, data: <DocRecord>}`
 * from the exact same `sessionService.writeHandoff(...)` call the MCP tool makes; two
 * separate calls against the same seeded corpus produce distinct ids/slugs/timestamps
 * by construction (fresh ULID + clock per write) — the comparison scopes to the
 * deterministic parts (`extra.handoff`, `content`, `type`, `status`, `parent_id`).
 *
 * Coverage:
 *   HAPPY:      lore_bootstrap / lore_handoff / lore_feed session-resume succeed and
 *               return the expected envelope shapes
 *   NEGATIVE:   lore_bootstrap/lore_handoff reject missing `by` (schema-level);
 *               lore_feed session-resume with an unresolvable --plan → isError
 *   BOUNDARY:   empty corpus bootstrap via MCP → root: null, empty arrays (mirrors AC-SL-10)
 *   ERROR:      isError=true + LoreError JSON on a writeHandoff validation failure
 *               (multiple PRDs, no plan_ref)
 *   STATE:      lore_handoff → lore_feed session-resume round trip via MCP (the
 *               just-written handoff is what resume surfaces)
 *   REGRESSION: lore_bootstrap/lore_handoff payload shapes deep-equal the CLI's
 *               SessionService-driven --json output for the same seeded corpus;
 *               the MCP `lore_feed` session-resume response's `feed` field
 *               carries the exported `RESUME_SCOPE_CLOSURE` constant verbatim
 *               (identity) and names every `BOOTSTRAP_RESUME_CLOSURE_KEYS`
 *               member — spec-context-provenance-injected-corpus-global-state-and-a
 *               §Design Decisions D3, AC-CP-4, task
 *               task-t3-scope-closure-on-the-resume-ticket-cli-stdout-and-mcp.
 *               This is the MCP-surface half of AC-CP-4's "both surfaces"
 *               requirement — the CLI-stdout half is pinned by
 *               `tests/integration/cli-feed-task-start.bun.test.ts`, and the
 *               pure render-function mechanics by
 *               `tests/unit/flows/feed-flow-resume-closure.test.ts`. The
 *               pre-existing BOUNDARY test below ("no handoff recorded yet")
 *               is deliberately left asserting the exact
 *               `"(no handoff recorded)"` text — that advisory note is not a
 *               resume ticket, so it carries no scope to close.
 *
 * @spec_ref SPEC-041 §4 AC-SL-6; spec-context-provenance-injected-corpus-global-state-and-a §Design Decisions D3
 */

import { liveInvocation, actedStore } from "../../live-invocation.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
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
import { BOOTSTRAP_RESUME_CLOSURE_KEYS, handoffExtraSchema, NoOpTelemetry, ok, RESUME_SCOPE_CLOSURE } from "@lore/core";
import type { BootstrapReport, DocRecord, HandoffExtra } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import {
  registerTools,
  LoreBootstrapSchema,
  LoreHandoffSchema,
} from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput } from "@lore/core";
import { asSessionActor, sessionActorFor, sessionIdFor } from "../../helpers/session-actor.js";
import type { RunId } from "@lore/core";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

// ─── Test Infrastructure (mirrors mcp-tools-feed.test.ts) ────────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let sessionService: SessionService;

function makeApp(): App {
  store = actedStore(new InMemoryStore());
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10_080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });

  const app: App = {
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
      async () => ok(new Set()),
    ),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
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

async function createPlan(title: string): Promise<{ id: string; slug: string }> {
  const result = await corpusService.create({ type: "plan", title, content: "# Plan" } as CreateDocInput);
  if (!result.ok) throw new Error(`plan create failed: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, slug: result.value.slug };
}

const VALID_HANDOFF: HandoffExtra = {
  by: "claude",
  task_refs: [],
  modified_files: ["packages/core/src/session.ts"],
  key_decisions: [{ judgment: "extra is SSOT, content is a projection", confidence: 90 }],
  next_steps: ["wire SessionService into app.ts"],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("LoreBootstrapSchema / LoreHandoffSchema — schema-level", () => {
  // reason: BR-1034 (AC-RID-7) — `by` is optional (the call's resolved name fills in); an EMPTY `by` is still refused.
  it("LoreBootstrapSchema accepts missing `by`, rejects an empty one", () => {
    expect(LoreBootstrapSchema.safeParse({}).success).toBe(true);
    expect(LoreBootstrapSchema.safeParse({ by: "" }).success).toBe(false);
    expect(LoreBootstrapSchema.safeParse({ by: "alice" }).success).toBe(true);
  });

  // reason: BR-1034 (AC-RID-7) — the MCP schema relaxes ONLY `by` (the handler fills it from the call's resolved
  // name); the CLI contract `handoffExtraSchema` still requires it.
  it("LoreHandoffSchema declares no `by` and accepts a payload without one; handoffExtraSchema (CLI contract) still rejects it", () => {
    expect(Object.keys(LoreHandoffSchema.shape)).not.toContain("by");
    const { by: _by, ...withoutBy } = VALID_HANDOFF;
    expect(LoreHandoffSchema.safeParse(withoutBy).success).toBe(true);
    expect(handoffExtraSchema.safeParse(withoutBy).success).toBe(false);
    expect(LoreHandoffSchema.safeParse(VALID_HANDOFF).success).toBe(true);
  });

  it("LoreHandoffSchema rejects empty next_steps (a handoff naming no next step is a status report)", () => {
    const noNext = { ...VALID_HANDOFF, next_steps: [] };
    expect(LoreHandoffSchema.safeParse(noNext).success).toBe(false);
  });
});

describe("lore_bootstrap", () => {
  let app: App;
  let server: McpServer;

  beforeEach(() => {
    app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
  });

  describe("happy path", () => {
    it("returns { report: BootstrapReport } for a seeded corpus", async () => {
      await createPlan("Plan A");
      const call = getToolHandler(server, "lore_bootstrap");
      const result = await call({ by: "alice" });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { report: BootstrapReport };
      expect(data.report.active_plans).toHaveLength(1);
      expect(data.report.active_plans[0]?.title).toBe("Plan A");
    });
  });

  describe("boundary values", () => {
    it("empty corpus → root: null, every array empty (mirrors AC-SL-10)", async () => {
      const call = getToolHandler(server, "lore_bootstrap");
      const result = await call({ by: "alice" });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { report: BootstrapReport };
      expect(data.report.root).toBeNull();
      expect(data.report.active_plans).toEqual([]);
      expect(data.report.my_claims).toEqual([]);
      expect(data.report.pending_reviews).toEqual({ count: 0, slugs: [] });
      // reason: SPEC-044 §Design Decisions D14 — the MCP tool splices a computed
      // open_stale_candidates count onto SessionService.bootstrap's raw corpus summary
      // (the underlying service is untouched, outside this task's file anchors); an
      // empty corpus has zero knowledge/adr docs to probe, so the count is 0.
      // SPEC-045 §Design Decisions D7 — code_anchor_specs is the SAME store-only,
      // zero-fs-probing splice (an empty corpus has zero specs, so 0).
      expect(data.report.corpus).toEqual({
        total_docs: 0,
        last_updated: null,
        open_stale_candidates: 0,
        code_anchor_specs: 0,
      });
    });
  });

  describe("regression", () => {
    it("MCP payload deep-equals the CLI --json shape (sessionService.bootstrap(by) PLUS the D14 open_stale_candidates splice) for the same seeded corpus", async () => {
      await createPlan("Plan A");
      await createPlan("Plan B");

      const call = getToolHandler(server, "lore_bootstrap");
      const mcpResult = await call({ by: "alice" });
      const mcpData = parseResult(mcpResult) as { report: BootstrapReport };

      // reason: pre-SPEC-044 this WAS `sessionService.bootstrap(by)`'s raw output
      // verbatim (`commands/bootstrap.ts`'s `run()` used to print `{ok: true, data:
      // result.value}` unmodified). SPEC-044 §Design Decisions D14 makes BOTH the CLI
      // and the MCP tool splice the SAME open_stale_candidates count onto
      // `.corpus` afterward (computed by `flows/staleness-flow.ts::listFreshStalenessEscalates`,
      // the single derivation site `--list` also uses) — this fixture seeds only plans
      // (no knowledge/adr docs), so the count is always 0 here, same as the CLI would
      // splice for this identical seeded corpus.
      const cliShapeResult = await sessionService.bootstrap("alice");
      if (!cliShapeResult.ok) throw new Error(JSON.stringify(cliShapeResult.error));
      // SPEC-045 §Design Decisions D7 — code_anchor_specs is the SAME kind of
      // store-only splice as open_stale_candidates (this fixture seeds only plans,
      // no specs, so the count is always 0 here).
      const cliShapeWithStaleness = {
        ...cliShapeResult.value,
        corpus: { ...cliShapeResult.value.corpus, open_stale_candidates: 0, code_anchor_specs: 0 },
      };

      expect(mcpData.report).toEqual(cliShapeWithStaleness);
    });
  });
});

describe("lore_handoff", () => {
  let app: App;
  let server: McpServer;

  beforeEach(() => {
    app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
  });

  describe("happy path", () => {
    it("writes a draft knowledge/handoff doc and returns { doc: DocRecord }", async () => {
      const plan = await createPlan("Plan A");
      const call = getToolHandler(server, "lore_handoff");
      const result = await call({ ...VALID_HANDOFF, plan_ref: plan.slug });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { doc: DocRecord };
      expect(data.doc.type).toBe("knowledge");
      expect(data.doc.status).toBe("draft");
      expect(data.doc.extra["sub_type"]).toBe("handoff");
      expect(data.doc.parent_id).toBe(plan.id);
    });
  });

  describe("error cases", () => {
    it("nonexistent plan_ref → isError with VALIDATION_ERROR", async () => {
      const call = getToolHandler(server, "lore_handoff");
      const result = await call({ ...VALID_HANDOFF, plan_ref: "nonexistent-plan-slug" });

      expect(result.isError).toBe(true);
      const text = result.content[0];
      if (!text || text.type !== "text") throw new Error("expected text content");
      const error = JSON.parse(text.text) as { code: string };
      expect(error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("regression", () => {
    it("MCP-written doc's extra.handoff/content/type/status deep-equal a direct sessionService.writeHandoff call (the CLI's underlying seam) for equivalent input", async () => {
      const plan = await createPlan("Plan A");
      // reason: AC-ROI-1 — the MCP tool takes no `by`; the stored author is the call's own (session-tier) name,
      // so the equivalent direct write names that same author.
      const input: HandoffExtra = { ...VALID_HANDOFF, by: sessionActorFor("claude"), plan_ref: plan.slug };
      const { by: _author, ...mcpArgs } = input;

      const call = getToolHandler(server, "lore_handoff");
      const mcpResult = await asSessionActor("claude", () => call({ ...mcpArgs }));
      const mcpData = parseResult(mcpResult) as { doc: DocRecord };

      // reason: this IS what commands/handoff.ts's `run()` calls after validation —
      // the CLI's --json `data` field for an equivalent write against the same corpus state.
      // The MCP call runs as the server's invocation identity (the agent run of that session), so the equivalent CLI-shaped
      // write names the same run (a write is always made by a known party, BR-1351).
      const cliShapeResult = await sessionService.writeHandoff(input, undefined, { run: `cc:${sessionIdFor("claude")}` as RunId });
      if (!cliShapeResult.ok) throw new Error(JSON.stringify(cliShapeResult.error));

      expect(mcpData.doc.extra).toEqual(cliShapeResult.value.extra);
      expect(mcpData.doc.content).toEqual(cliShapeResult.value.content);
      expect(mcpData.doc.type).toEqual(cliShapeResult.value.type);
      expect(mcpData.doc.status).toEqual(cliShapeResult.value.status);
      expect(mcpData.doc.parent_id).toEqual(cliShapeResult.value.parent_id);
    });
  });
});

describe("lore_feed session-resume dispatch (SPEC-041 §3 D5)", () => {
  let app: App;
  let server: McpServer;

  beforeEach(() => {
    app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
  });

  it("HAPPY + STATE: a lore_handoff write is surfaced by a subsequent session-resume feed call", async () => {
    const plan = await createPlan("Plan A");
    const handoffCall = getToolHandler(server, "lore_handoff");
    const handoffResult = await handoffCall({ ...VALID_HANDOFF, plan_ref: plan.slug });
    expect(handoffResult.isError).toBeFalsy();
    const handoffDoc = (parseResult(handoffResult) as { doc: DocRecord }).doc;

    const feedCall = getToolHandler(server, "lore_feed");
    const feedResult = await feedCall({ checkpoint: "session-resume", plan: plan.slug });

    expect(feedResult.isError).toBeFalsy();
    const feedData = parseResult(feedResult) as { checkpoint: string; resume: { found: boolean }; feed: string };
    expect(feedData.checkpoint).toBe("session-resume");
    expect(feedData.resume.found).toBe(true);
    expect(feedData.feed).toContain(handoffDoc.slug);
    expect(feedData.feed).toContain("wire SessionService into app.ts");
  });

  it("REGRESSION (AC-CP-4, MCP surface): the derivation-path call (no --handoff, only --plan) carries RESUME_SCOPE_CLOSURE verbatim and names every BOOTSTRAP_RESUME_CLOSURE_KEYS member", async () => {
    const plan = await createPlan("Plan A");
    const handoffCall = getToolHandler(server, "lore_handoff");
    const handoffResult = await handoffCall({ ...VALID_HANDOFF, plan_ref: plan.slug });
    expect(handoffResult.isError).toBeFalsy();

    // reason: no `handoff` field supplied — this is the SAME derivation path
    // (newest-wins over `plan`) the task's REGRESSION requirement names,
    // never the direct `--handoff <slug>` shortcut.
    const feedCall = getToolHandler(server, "lore_feed");
    const feedResult = await feedCall({ checkpoint: "session-resume", plan: plan.slug });

    expect(feedResult.isError).toBeFalsy();
    const feedData = parseResult(feedResult) as { resume: { found: boolean }; feed: string };
    expect(feedData.resume.found).toBe(true);
    // reason: identity against the exported constant (D6), not a remembered
    // substring — proves the MCP `feed` field (JSON-stringified alongside the
    // rest of `ResumeFeedOutcome` by `textContent`, tools.ts) really carries
    // the SAME text `renderResumeFeed` produces for the CLI surface.
    expect(feedData.feed.includes(RESUME_SCOPE_CLOSURE)).toBe(true);
    for (const key of BOOTSTRAP_RESUME_CLOSURE_KEYS) {
      expect(RESUME_SCOPE_CLOSURE.includes(key)).toBe(true);
    }
  });

  it("REGRESSION (AC-CP-4): a non-resume checkpoint (spec-create) must NOT gain the scope-closure block", async () => {
    const feedCall = getToolHandler(server, "lore_feed");
    const result = await feedCall({ checkpoint: "spec-create" });

    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { feed: string };
    expect(data.feed.includes(RESUME_SCOPE_CLOSURE)).toBe(false);
  });

  it("NEGATIVE: unresolvable --plan → isError with VALIDATION_ERROR (not an advisory degrade, unlike buildFeed's checkpoint lookup)", async () => {
    const feedCall = getToolHandler(server, "lore_feed");
    const result = await feedCall({ checkpoint: "session-resume", plan: "nonexistent-plan-slug" });

    expect(result.isError).toBe(true);
  });

  it("BOUNDARY: no handoff recorded yet → found: false, feed is the exact advisory note, never isError", async () => {
    const feedCall = getToolHandler(server, "lore_feed");
    const result = await feedCall({ checkpoint: "session-resume" });

    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { resume: { found: boolean }; feed: string };
    expect(data.resume.found).toBe(false);
    expect(data.feed).toBe("(no handoff recorded)");
  });
});
