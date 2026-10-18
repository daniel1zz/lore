/**
 * Unit tests for the `lore_feed` MCP tool (IoC vertical-slice tech-spec §4.1/§11, P4
 * slice) — feed-before-produce PULL surface.
 *
 * Scope: end-to-end through a real `CorpusService` + `OutlineService` backed by
 * `InMemoryStore` (vitest-reachable, no `bun:sqlite`) — `buildFeed`
 * (`../../../src/flows/feed-flow.ts`) is exercised for real rather than stubbed,
 * since its whole point is discovering an approved skill doc and rendering it; a spy
 * would defeat the purpose of this test. Registration/handler-plumbing style mirrors
 * `mcp-tools-verify.test.ts` (register real tools against a McpServer, extract
 * handlers from the internal `_registeredTools` map, invoke directly).
 *
 * Coverage:
 *   HAPPY:      approved skill + parent doc → { checkpoint, type, skill, feed } shape,
 *               feed text carries the skill's rule content + parent summary + header
 *   NEGATIVE:   no approved skill doc → skill: null, feed is the one-line note
 *   BOUNDARY:   unknown checkpoint → type: null, skill: null, one-line note — never isError
 *   STATE:      a DRAFT (unapproved) skill doc is invisible, same as no skill at all
 *   ERROR:      n/a — lore_feed has no failure mode (advisory-only, always textContent)
 *   REGRESSION: lore_feed never mutates the corpus (doc count unchanged)
 *
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11, P4 slice
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
import { NoOpTelemetry, ok } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput } from "@lore/core";
import type { FeedOutcome } from "../../../src/flows/feed-flow.js";

// ─── Test Infrastructure (mirrors mcp-tools-verify.test.ts) ──────────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;

function makeApp(): App {
  store = actedStore(new InMemoryStore());
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

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

// ─── Fixture helpers ──────────────────────────────────────────────────────────

async function createApprovedSkillDoc(opts: {
  title: string;
  appliesTo: string;
  content: string;
}): Promise<{ id: string; slug: string; title: string }> {
  const createResult = await corpusService.create({
    type: "knowledge",
    title: opts.title,
    content: opts.content,
    extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
  } as CreateDocInput);
  if (!createResult.ok) throw new Error(`skill doc create failed: ${JSON.stringify(createResult.error)}`);

  const approveResult = await corpusService.set(createResult.value.id, { status: "approved" });
  if (!approveResult.ok) throw new Error(`skill doc approve failed: ${JSON.stringify(approveResult.error)}`);

  return { id: createResult.value.id, slug: approveResult.value.slug, title: opts.title };
}

async function createDraftSkillDoc(opts: {
  title: string;
  appliesTo: string;
  content: string;
}): Promise<{ id: string; slug: string }> {
  const createResult = await corpusService.create({
    type: "knowledge",
    title: opts.title,
    content: opts.content,
    extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
  } as CreateDocInput);
  if (!createResult.ok) throw new Error(`skill doc create failed: ${JSON.stringify(createResult.error)}`);
  return { id: createResult.value.id, slug: createResult.value.slug };
}

async function createPrd(title: string): Promise<{ id: string; slug: string }> {
  const createResult = await corpusService.create({
    type: "prd",
    title,
    content: "## Overview\n\nSome PRD content.",
  } as CreateDocInput);
  if (!createResult.ok) throw new Error(`prd create failed: ${JSON.stringify(createResult.error)}`);
  return { id: createResult.value.id, slug: createResult.value.slug };
}

async function countDocs(): Promise<number> {
  const result = await corpusService.list({});
  if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result.error)}`);
  return result.value.docs.length;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("lore_feed", () => {
  let app: App;
  let server: McpServer;

  beforeEach(() => {
    app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
  });

  describe("happy path", () => {
    it("returns { checkpoint, type, skill, feed } with the skill's rule content + parent summary + provenance header", async () => {
      const skill = await createApprovedSkillDoc({
        title: "Custom write-spec rules",
        appliesTo: "spec",
        content: "## Rule\n\nDiscoverable marker content.",
      });
      const prd = await createPrd("My Feature PRD");

      const call = getToolHandler(server, "lore_feed");
      const result = await call({ checkpoint: "spec-create", parent_id_or_slug: prd.id });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as FeedOutcome;
      expect(data.checkpoint).toBe("spec-create");
      expect(data.type).toBe("spec");
      expect(data.skill).toEqual({ slug: skill.slug, title: skill.title });
      expect(data.feed).toContain(`[source: ${skill.slug}`);
      expect(data.feed).toContain("Discoverable marker content.");
      expect(data.feed).toContain("Some PRD content.");
      expect(data.feed).toContain("## Parent");
    });

    it("omitting parent_id_or_slug produces a feed with no '## Parent' section", async () => {
      await createApprovedSkillDoc({
        title: "Custom write-spec rules",
        appliesTo: "spec",
        content: "## Rule\n\nNo-parent marker content.",
      });

      const call = getToolHandler(server, "lore_feed");
      const result = await call({ checkpoint: "spec-create" });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as FeedOutcome;
      expect(data.feed).toContain("No-parent marker content.");
      expect(data.feed).not.toContain("## Parent");
    });
  });

  describe("negative cases", () => {
    it("no approved skill doc → skill: null, feed is the one-line advisory note (never isError)", async () => {
      const call = getToolHandler(server, "lore_feed");
      const result = await call({ checkpoint: "spec-create" });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as FeedOutcome;
      expect(data.type).toBe("spec");
      expect(data.skill).toBeNull();
      expect(data.feed).toBe("no approved governing skill for spec");
    });
  });

  describe("boundary values", () => {
    it("unknown checkpoint → type: null, skill: null, one-line note — never isError", async () => {
      const call = getToolHandler(server, "lore_feed");
      const result = await call({ checkpoint: "totally-unknown-checkpoint" });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as FeedOutcome;
      expect(data.checkpoint).toBe("totally-unknown-checkpoint");
      expect(data.type).toBeNull();
      expect(data.skill).toBeNull();
      expect(data.feed).toBe("unknown checkpoint: totally-unknown-checkpoint");
    });
  });

  describe("state", () => {
    it("a DRAFT (unapproved) skill doc is invisible — same as no skill at all", async () => {
      await createDraftSkillDoc({
        title: "Not yet approved rules",
        appliesTo: "spec",
        content: "## Rule\n\nDraft marker content — must never surface.",
      });

      const call = getToolHandler(server, "lore_feed");
      const result = await call({ checkpoint: "spec-create" });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as FeedOutcome;
      expect(data.skill).toBeNull();
      expect(data.feed).not.toContain("Draft marker content");
    });
  });

  describe("regression", () => {
    it("lore_feed never creates or mutates any corpus document", async () => {
      await createApprovedSkillDoc({
        title: "Read-only check rules",
        appliesTo: "spec",
        content: "## Rule\n\nRead-only marker content.",
      });
      const before = await countDocs();

      const call = getToolHandler(server, "lore_feed");
      await call({ checkpoint: "spec-create" });
      await call({ checkpoint: "spec-create" });

      const after = await countDocs();
      expect(after).toBe(before);
    });
  });
});
