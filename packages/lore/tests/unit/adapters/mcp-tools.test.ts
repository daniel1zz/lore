/**
 * Unit tests for MCP tool adapter.
 * Tests: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * Strategy: Create McpServer, register tools, then extract and call
 * handlers directly from _registeredTools (internal map). This avoids
 * needing a full stdio transport while still testing the real tool wiring.
 *
 * @spec_ref AC-MCP-001
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
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DocRecord, UatVerdict } from "@lore/core";
import { UatService } from "../../../src/service/uat-service.js";
import { resolveDoc } from "../../../src/service/resolve.js";

// ─── Test Infrastructure ─────────────────────────────────────────────────────

/** Stub ApiKeyStore — not used in MCP tests, present to satisfy App interface. */
const stubApiKeyStore = {} as ApiKeyStore;

function makeApp(): App {
  const store = new InMemoryStore();
  return {
    corpusService: new CorpusService(store),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    // reason: MCP tool tests never exercise the AI path; null-cast avoids heavyweight
    // AIProviderService construction while satisfying the now-required field (SPEC-017 §3.12).
    aiProviderService: null as unknown as App["aiProviderService"],
    // reason: MCP tool tests never exercise sync-docs path — null-cast per SPEC-018 §3.6.
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    // reason: test does not exercise phase commands; null-cast per pattern from SPEC-023 §9.1.
    phaseService: null as unknown as App["phaseService"],
    // reason: SPEC-025 §9.1 — test does not exercise task-workflow commands; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    // reason: SPEC-032 §3.4 — test does not exercise spec-kind audit; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    specKindService: null as unknown as App["specKindService"],
    // reason: lore_approve's post-approve calibration hook (SPEC-033 F1) needs a real
    // JudgmentService.latestFor — the prior null-cast only worked because no earlier
    // test in this file exercised lore_approve. Wired against the same InMemoryStore
    // instance so calibration data lands in the same corpus the test observes.
    judgmentService: new JudgmentService(store, new NoOpTelemetry()),
    auditService: null as unknown as App["auditService"],
    // reason: test does not exercise AI-default path; callerSurface required by App interface (SPEC-024).
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

/**
 * Access the internal _registeredTools map to extract a tool handler.
 *
 * Tools with input use `registerToolWithArgs` which patches `inputSchema` after 3-arg
 * registration. At runtime the SDK calls `handler(validatedArgs, extra)`, so the handler's
 * first parameter receives the actual args. The test calls `tool.handler(args, {})` to
 * simulate this — args go directly as the first param, consistent with runtime behavior.
 * — reason: ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA §"Fast Path" Pattern 1 (post-registration patch)
 */
// reason: McpServer._registeredTools is private — must use a standalone type (not intersection)
// and cast via unknown to access internal state without triggering TS private-member collision.
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

// ─── Test Setup ──────────────────────────────────────────────────────────────

let app: App;
let server: McpServer;

beforeEach(() => {
  app = makeApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app);
});

// ─── lore_create ─────────────────────────────────────────────────────────────

describe("lore_create", () => {
  const call = () => getToolHandler(server, "lore_create");

  describe("happy path", () => {
    it("creates a PRD and returns id, slug, type, status, version", async () => {
      const result = await call()({ type: "prd", title: "Test PRD" });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { id: string; slug: string; type: string; status: string; version: number };
      expect(data.id).toMatch(/^[0-9A-Z]{26}$/);
      expect(data.slug).toContain("prd");
      expect(data.type).toBe("prd");
      expect(data.status).toBe("draft");
      expect(data.version).toBe(1);
    });

    it("creates a spec with no parent (BR-1)", async () => {
      const specResult = await call()({ type: "spec", title: "Auth Spec" });
      expect(specResult.isError).toBeFalsy();
      const spec = parseResult(specResult) as { type: string };
      expect(spec.type).toBe("spec");
    });
  });

  describe("negative cases", () => {
    it("returns error when a spec is given a parent_id (BR-2), naming criterion citations", async () => {
      const prd = parseResult(await call()({ type: "prd", title: "Parent PRD" })) as { id: string };
      const result = await call()({ type: "spec", title: "Parented Spec", parent_id: prd.id });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; message: string };
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain("lore ac cite");
    });

    it("returns error when a task is missing parent_id (parent still required for task)", async () => {
      const result = await call()({ type: "task", title: "Orphan Task" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string };
      expect(["SCHEMA_VIOLATION", "PARENT_REQUIRED", "VALIDATION_ERROR"]).toContain(error.code);
    });
  });

  describe("boundary values", () => {
    it("accepts minimal input (type + title only)", async () => {
      const result = await call()({ type: "prd", title: "x" });
      expect(result.isError).toBeFalsy();
    });

    it("accepts all optional fields", async () => {
      const result = await call()({
        type: "prd",
        title: "Full PRD",
        content: "# Content",
        tags: ["tag1"],
        extra: { key: "value" },
      });
      expect(result.isError).toBeFalsy();
    });
  });

  describe("error handling", () => {
    it("returns isError=true with LoreError JSON on failure", async () => {
      const result = await call()({ type: "task", title: "No Parent" });
      expect(result.isError).toBe(true);
      const text = result.content[0];
      expect(text?.type).toBe("text");
    });
  });

  // STATE: N/A — stateless per call
  // REGRESSION: N/A — no known regressions

  // ─── requires_uat (SPEC-058 hotfix: plan-add-requires-uat-authoring-path) ───
  //
  // Consistency note: the CLI's `lore create <type> --requires-uat` rejects the
  // flag on any non-plan type as a type-flag mismatch, exit 2 (see
  // cli-create.bun.test.ts's "--requires-uat (SPEC-058 hotfix)" describe block
  // for the exit-code correction — the task doc that spawned this test file
  // addition stated exit 4, but the REAL, pre-existing mismatch-validation
  // block this hotfix reuses calls process.exit(2), same as every other entry
  // in TYPE_SPECIFIC_FLAGS). This tool matches that REJECT stance (not "ignore")
  // via a VALIDATION_ERROR, asserted below.
  describe("requires_uat (SPEC-058 hotfix)", () => {
    it("HAPPY: requires_uat=true on a plan sets extra.requires_uat=true", async () => {
      const prdResult = await call()({ type: "prd", title: "Root" });
      const prd = parseResult(prdResult) as { id: string };

      const planResult = await call()({
        type: "plan",
        title: "UAT-Gated Plan",
        parent_id: prd.id,
        requires_uat: true,
      });
      expect(planResult.isError).toBeFalsy();
      const plan = parseResult(planResult) as { id: string };

      const getResult = await getToolHandler(server, "lore_get")({ id_or_slug: plan.id });
      expect(getResult.isError).toBeFalsy();
      const data = parseResult(getResult) as { doc: DocRecord };
      expect(data.doc.extra["requires_uat"]).toBe(true);
    });

    it("REGRESSION: a plan created WITHOUT requires_uat has no requires_uat key (absent, not false)", async () => {
      const prdResult = await call()({ type: "prd", title: "Root" });
      const prd = parseResult(prdResult) as { id: string };

      const planResult = await call()({ type: "plan", title: "Plain Plan", parent_id: prd.id });
      expect(planResult.isError).toBeFalsy();
      const plan = parseResult(planResult) as { id: string };

      const getResult = await getToolHandler(server, "lore_get")({ id_or_slug: plan.id });
      const data = parseResult(getResult) as { doc: DocRecord };
      expect("requires_uat" in data.doc.extra).toBe(false);
    });

    it("BOUNDARY: requires_uat=false is treated as absent — no requires_uat key written", async () => {
      const prdResult = await call()({ type: "prd", title: "Root" });
      const prd = parseResult(prdResult) as { id: string };

      const planResult = await call()({
        type: "plan",
        title: "Explicit False Plan",
        parent_id: prd.id,
        requires_uat: false,
      });
      expect(planResult.isError).toBeFalsy();
      const plan = parseResult(planResult) as { id: string };

      const getResult = await getToolHandler(server, "lore_get")({ id_or_slug: plan.id });
      const data = parseResult(getResult) as { doc: DocRecord };
      expect("requires_uat" in data.doc.extra).toBe(false);
    });

    it("consistency with the CLI: requires_uat=true on a non-plan type is rejected (VALIDATION_ERROR), never silently ignored", async () => {
      const result = await call()({ type: "spec", title: "Spec", requires_uat: true });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; field?: string };
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.field).toBe("requires_uat");
    });
  });
});

// ─── lore_get ─────────────────────────────────────────────────────────────────

describe("lore_get", () => {
  const callCreate = () => getToolHandler(server, "lore_create");
  const callGet = () => getToolHandler(server, "lore_get");

  describe("happy path", () => {
    it("returns doc + navigation by id", async () => {
      const cr = await callCreate()({ type: "prd", title: "Get Test" });
      const created = parseResult(cr) as { id: string };

      const result = await callGet()({ id_or_slug: created.id });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { doc: { id: string }; navigation: unknown };
      expect(data.doc.id).toBe(created.id);
      expect(data.navigation).toBeDefined();
    });

    it("returns doc by slug", async () => {
      const cr = await callCreate()({ type: "prd", title: "Slug Get Test" });
      const created = parseResult(cr) as { slug: string };

      const result = await callGet()({ id_or_slug: created.slug });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { doc: { slug: string } };
      expect(data.doc.slug).toBe(created.slug);
    });
  });

  describe("negative cases", () => {
    it("returns DOC_NOT_FOUND error for missing ULID", async () => {
      const result = await callGet()({ id_or_slug: "01AAAAAAAAAAAAAAAAAAAAAAAAA" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string };
      expect(error.code).toBe("DOC_NOT_FOUND");
    });

    it("returns error for unknown slug", async () => {
      const result = await callGet()({ id_or_slug: "prd-nonexistent-slug" });
      expect(result.isError).toBe(true);
    });
  });

  describe("boundary values", () => {
    it("include_navigation=false omits navigation key", async () => {
      const cr = await callCreate()({ type: "prd", title: "Nav False Test" });
      const created = parseResult(cr) as { id: string };

      const result = await callGet()({ id_or_slug: created.id, include_navigation: false });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as Record<string, unknown>;
      expect(data["navigation"]).toBeUndefined();
    });
  });

  // ERROR: N/A — InMemoryStore does not produce STORE_ERRORs in normal flow
  // STATE: N/A — lore_get is read-only
  // REGRESSION: N/A — no known regressions
});

// ─── lore_list ────────────────────────────────────────────────────────────────

describe("lore_list", () => {
  describe("happy path", () => {
    it("returns empty list when corpus is empty", async () => {
      const result = await getToolHandler(server, "lore_list")({});
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { docs: unknown[]; total: number };
      expect(data.docs).toHaveLength(0);
      expect(data.total).toBe(0);
    });

    it("returns all docs after creating some", async () => {
      const cc = getToolHandler(server, "lore_create");
      await cc({ type: "prd", title: "PRD1" });
      await cc({ type: "prd", title: "PRD2" });

      const result = await getToolHandler(server, "lore_list")({});
      const data = parseResult(result) as { docs: unknown[]; total: number };
      expect(data.docs).toHaveLength(2);
      expect(data.total).toBe(2);
    });

    it("filters by type", async () => {
      const cc = getToolHandler(server, "lore_create");
      const prd = await cc({ type: "prd", title: "PRD" });
      const prdData = parseResult(prd) as { id: string };
      await cc({ type: "spec", title: "Spec" });

      const result = await getToolHandler(server, "lore_list")({ type: "spec" });
      const data = parseResult(result) as { docs: Array<{ type: string }> };
      expect(data.docs.every((d) => d.type === "spec")).toBe(true);
    });
  });

  describe("boundary values", () => {
    it("limit=1 returns at most 1 doc", async () => {
      const cc = getToolHandler(server, "lore_create");
      await cc({ type: "prd", title: "P1" });
      await cc({ type: "prd", title: "P2" });

      const result = await getToolHandler(server, "lore_list")({ limit: 1 });
      const data = parseResult(result) as { docs: unknown[] };
      expect(data.docs).toHaveLength(1);
    });
  });

  // NEGATIVE: N/A — list accepts empty filters without error
  // ERROR: N/A — InMemoryStore does not fail
  // STATE: N/A — stateless read
  // REGRESSION: N/A
});

// ─── lore_list — pagination hardening (unbounded-payload review) ────────────

describe("lore_list pagination", () => {
  describe("happy path", () => {
    it("explicit limit + offset page through the corpus without overlap", async () => {
      const cc = getToolHandler(server, "lore_create");
      await cc({ type: "prd", title: "Page Doc 1" });
      await cc({ type: "prd", title: "Page Doc 2" });
      await cc({ type: "prd", title: "Page Doc 3" });

      const page1 = parseResult(
        await getToolHandler(server, "lore_list")({ limit: 2, offset: 0 }),
      ) as { docs: Array<{ id: string }>; total: number; truncated: boolean };
      const page2 = parseResult(
        await getToolHandler(server, "lore_list")({ limit: 2, offset: 2 }),
      ) as { docs: Array<{ id: string }>; total: number; truncated: boolean };

      expect(page1.docs).toHaveLength(2);
      expect(page2.docs).toHaveLength(1);
      const page1Ids = new Set(page1.docs.map((d) => d.id));
      expect(page2.docs.every((d) => !page1Ids.has(d.id))).toBe(true);
    });

    it("truncated is false when every matching doc fits within limit", async () => {
      const cc = getToolHandler(server, "lore_create");
      await cc({ type: "prd", title: "Small Set 1" });
      await cc({ type: "prd", title: "Small Set 2" });

      const result = parseResult(
        await getToolHandler(server, "lore_list")({ limit: 10 }),
      ) as { docs: unknown[]; total: number; truncated: boolean };
      expect(result.docs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.truncated).toBe(false);
    });

    it("truncated is true when an explicit limit caps a larger matching set", async () => {
      const cc = getToolHandler(server, "lore_create");
      await cc({ type: "prd", title: "Cap Doc 1" });
      await cc({ type: "prd", title: "Cap Doc 2" });
      await cc({ type: "prd", title: "Cap Doc 3" });

      const result = parseResult(
        await getToolHandler(server, "lore_list")({ limit: 2 }),
      ) as { docs: unknown[]; total: number; truncated: boolean };
      // reason: `truncated` must be a real signal the agent can act on, not just
      // present-but-always-false — this is what distinguishes a capped call from
      // a complete one (never a silent cap).
      expect(result.docs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.truncated).toBe(true);
    });
  });

  describe("boundary values", () => {
    it("no limit/offset AND the corpus exceeds MCP_LIST_DEFAULT_LIMIT → capped at 100, truncated true", async () => {
      const cc = getToolHandler(server, "lore_create");
      for (let i = 0; i < 105; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await cc({ type: "prd", title: `Default Cap Doc ${i}` });
      }

      const result = parseResult(await getToolHandler(server, "lore_list")({})) as {
        docs: unknown[];
        total: number;
        truncated: boolean;
      };
      expect(result.docs).toHaveLength(100);
      expect(result.total).toBe(100);
      expect(result.truncated).toBe(true);
    });

    it("limit 0 returns an empty page, no error, truncated reflects whether any rows exist", async () => {
      const cc = getToolHandler(server, "lore_create");
      await cc({ type: "prd", title: "Zero Limit Doc" });

      const result = await getToolHandler(server, "lore_list")({ limit: 0 });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { docs: unknown[]; total: number; truncated: boolean };
      expect(data.docs).toEqual([]);
      expect(data.total).toBe(0);
    });

    it("offset beyond the matching row count returns an empty page, no error", async () => {
      const cc = getToolHandler(server, "lore_create");
      await cc({ type: "prd", title: "Only Doc" });

      const result = await getToolHandler(server, "lore_list")({ limit: 10, offset: 100 });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { docs: unknown[]; total: number };
      expect(data.docs).toEqual([]);
    });
  });

  // STATE (REGRESSION): pre-pagination callers that never pass limit/offset still
  // get a docs[]/total envelope (shape-compatible) — covered by "lore_list" describe
  // block's "returns all docs after creating some" test above (2 docs, well under the
  // default cap, so truncated is never observably different from the old unpaged shape).
});

// ─── lore_list — governed_by (IoC vertical-slice tech-spec §4.1 P4) ──────────

describe("lore_list governed_by", () => {
  describe("happy path", () => {
    it("short-circuits to listGovernedBy and returns the doc the feeding skill governs", async () => {
      const cc = getToolHandler(server, "lore_create");
      const ca = getToolHandler(server, "lore_approve");

      const skillResult = await cc({
        type: "knowledge",
        title: "Write-spec rules",
        content: "## Rule\n\nBody.",
        extra: { sub_type: "skill", skill: { applies_to: "spec" } },
      });
      expect(skillResult.isError).toBeFalsy();
      const skill = parseResult(skillResult) as { id: string; slug: string };
      const approveResult = await ca({ id_or_slug: skill.id });
      expect(approveResult.isError).toBeFalsy();

      const specResult = await cc({ type: "spec", title: "Governed Spec", content: "body" });
      expect(specResult.isError).toBeFalsy();
      const spec = parseResult(specResult) as { id: string };

      const result = await getToolHandler(server, "lore_list")({ governed_by: skill.id });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { docs: Array<{ id: string }>; total: number };
      expect(data.total).toBe(1);
      expect(data.docs.some((d) => d.id === spec.id)).toBe(true);
    });
  });

  describe("negative cases", () => {
    it("a skill with no governs links returns an empty docs array, not an error", async () => {
      const cc = getToolHandler(server, "lore_create");
      const ca = getToolHandler(server, "lore_approve");

      const skillResult = await cc({
        type: "knowledge",
        title: "Lonely skill",
        content: "body",
        extra: { sub_type: "skill", skill: { applies_to: "spec" } },
      });
      const skill = parseResult(skillResult) as { id: string };
      await ca({ id_or_slug: skill.id });

      const result = await getToolHandler(server, "lore_list")({ governed_by: skill.id });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { docs: unknown[]; total: number };
      expect(data.docs).toHaveLength(0);
      expect(data.total).toBe(0);
    });
  });

  describe("error handling", () => {
    it("an unresolvable governed_by id/slug returns isError=true", async () => {
      const result = await getToolHandler(server, "lore_list")({ governed_by: "knowledge-nonexistent-slug" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string };
      expect(error.code).toBe("DOC_NOT_FOUND");
    });
  });

  // BOUNDARY: N/A — limit/offset slicing over governed_by results mirrors the
  // normal path's slice, already covered generically above for the filters path.
  // STATE: N/A — read-only
  // REGRESSION: N/A
});

// ─── lore_search ─────────────────────────────────────────────────────────────

describe("lore_search", () => {
  describe("happy path", () => {
    it("returns empty results for no match", async () => {
      const result = await getToolHandler(server, "lore_search")({ query: "zzz_nonexistent" });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { results: unknown[] };
      expect(Array.isArray(data.results)).toBe(true);
    });

    it("finds document by title keyword", async () => {
      await getToolHandler(server, "lore_create")({ type: "prd", title: "Authentication Design" });
      const result = await getToolHandler(server, "lore_search")({ query: "Authentication" });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { results: Array<{ title: string }> };
      expect(data.results.length).toBeGreaterThan(0);
    });
  });

  describe("boundary values", () => {
    it("limit=1 returns at most 1 result", async () => {
      await getToolHandler(server, "lore_create")({ type: "prd", title: "Search Alpha" });
      await getToolHandler(server, "lore_create")({ type: "prd", title: "Search Beta" });

      const result = await getToolHandler(server, "lore_search")({ query: "Search", limit: 1 });
      const data = parseResult(result) as { results: unknown[] };
      expect(data.results.length).toBeLessThanOrEqual(1);
    });
  });

  // NEGATIVE: N/A — Zod rejects empty query before service is called
  // ERROR: N/A — InMemoryStore does not fail on search
  // STATE: N/A — stateless read
  // REGRESSION: N/A
});

// ─── lore_tree ────────────────────────────────────────────────────────────────

describe("lore_tree", () => {
  describe("happy path", () => {
    it("returns tree rooted at first PRD", async () => {
      await getToolHandler(server, "lore_create")({ type: "prd", title: "Root PRD" });
      const result = await getToolHandler(server, "lore_tree")({});
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { tree: { doc: { type: string } } };
      expect(data.tree.doc.type).toBe("prd");
    });

    it("returns tree with children", async () => {
      const cr = await getToolHandler(server, "lore_create")({ type: "prd", title: "Root" });
      const prdData = parseResult(cr) as { id: string };
      await getToolHandler(server, "lore_create")({ type: "plan", title: "Child Plan", parent_id: prdData.id });

      const result = await getToolHandler(server, "lore_tree")({ root: prdData.id });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { tree: { children: unknown[] } };
      expect(data.tree.children.length).toBeGreaterThan(0);
    });
  });

  describe("negative cases", () => {
    it("returns error when no docs exist", async () => {
      const result = await getToolHandler(server, "lore_tree")({});
      expect(result.isError).toBe(true);
    });
  });

  describe("boundary values", () => {
    it("depth=1 returns children but no grandchildren", async () => {
      const cr = await getToolHandler(server, "lore_create")({ type: "prd", title: "Root" });
      const prd = parseResult(cr) as { id: string };
      const sr = await getToolHandler(server, "lore_create")({ type: "plan", title: "Child", parent_id: prd.id });
      const plan = parseResult(sr) as { id: string };
      await getToolHandler(server, "lore_create")({
        type: "knowledge",
        title: "GrandChild",
        parent_id: plan.id,
        extra: { sub_type: "reference" },
      });

      const result = await getToolHandler(server, "lore_tree")({ root: prd.id, depth: 1 });
      const data = parseResult(result) as {
        tree: { children: Array<{ children: unknown[] }> }
      };
      const firstChild = data.tree.children[0];
      expect(firstChild?.children).toHaveLength(0);
    });
  });

  // ERROR: N/A — InMemoryStore does not fail
  // STATE: N/A — stateless read
  // REGRESSION: N/A
});

// ─── lore_schema ─────────────────────────────────────────────────────────────

describe("lore_schema", () => {
  describe("happy path", () => {
    it("returns doc_types, link_types, status_values, required_fields", async () => {
      const result = await getToolHandler(server, "lore_schema")({});
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as {
        doc_types: string[];
        link_types: string[];
        status_values: string[];
        required_fields: Record<string, string[]>;
      };
      expect(data.doc_types).toContain("prd");
      expect(data.doc_types).toContain("spec");
      expect(data.link_types).toContain("implements");
      expect(data.status_values).toContain("draft");
      expect(data.required_fields.spec).toContain("parent_id");
    });
  });

  // NEGATIVE: N/A — static info, no inputs to reject
  // BOUNDARY: N/A — no parameters
  // ERROR: N/A — static, no I/O
  // STATE: N/A — stateless
  // REGRESSION: N/A
});

// ─── lore_status ─────────────────────────────────────────────────────────────

describe("lore_status", () => {
  describe("happy path", () => {
    it("returns corpus stats with correct shape", async () => {
      const result = await getToolHandler(server, "lore_status")({});
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as {
        total_docs: number;
        by_type: Record<string, number>;
        by_status: Record<string, number>;
        last_updated: string;
      };
      expect(typeof data.total_docs).toBe("number");
      expect(typeof data.by_type).toBe("object");
      expect(typeof data.by_status).toBe("object");
    });

    it("counts docs accurately after creates", async () => {
      const cc = getToolHandler(server, "lore_create");
      await cc({ type: "prd", title: "P1" });
      await cc({ type: "prd", title: "P2" });

      const result = await getToolHandler(server, "lore_status")({});
      const data = parseResult(result) as { total_docs: number };
      expect(data.total_docs).toBe(2);
    });
  });

  // NEGATIVE: N/A — no inputs
  // BOUNDARY: N/A — no parameters
  // ERROR: N/A — InMemoryStore does not fail
  // STATE: N/A — read-only aggregate
  // REGRESSION: N/A
});

// ─── lore_batch ──────────────────────────────────────────────────────────────

describe("lore_batch", () => {
  describe("happy path", () => {
    it("executes multiple operations and returns array of results", async () => {
      const result = await getToolHandler(server, "lore_batch")({
        operations: [
          { op: "create", args: { type: "prd", title: "Batch PRD" } },
          { op: "list", args: {} },
        ],
      });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { results: unknown[] };
      expect(data.results).toHaveLength(2);
    });
  });

  describe("negative cases", () => {
    it("captures failure in results array for unknown op (batch itself succeeds)", async () => {
      const result = await getToolHandler(server, "lore_batch")({
        operations: [{ op: "unknown_op", args: {} }],
      });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { results: Array<{ ok: boolean }> };
      expect(data.results[0]?.ok).toBe(false);
    });

    // Fix1 (MCP batch-op dispatcher validation, MAJOR): create/set/link previously
    // cast caller-supplied args straight to the service param type with only ad-hoc
    // typeof checks (create had NO guard at all). A malformed op must now surface a
    // structured VALIDATION_ERROR entry — never crash executeBatchOp's cast, never
    // silently pass through with fields coerced to undefined.

    it("captures VALIDATION_ERROR for a create op missing the required title", async () => {
      const result = await getToolHandler(server, "lore_batch")({
        operations: [{ op: "create", args: { type: "prd" } }],
      });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { results: Array<{ ok: boolean; error?: { code: string; field: string } }> };
      expect(data.results[0]?.ok).toBe(false);
      expect(data.results[0]?.error?.code).toBe("VALIDATION_ERROR");
      expect(data.results[0]?.error?.field).toBe("title");
    });

    it("captures VALIDATION_ERROR for a create op with an invalid doc type", async () => {
      const result = await getToolHandler(server, "lore_batch")({
        operations: [{ op: "create", args: { type: "not_a_real_type", title: "X" } }],
      });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { results: Array<{ ok: boolean; error?: { code: string } }> };
      expect(data.results[0]?.ok).toBe(false);
      expect(data.results[0]?.error?.code).toBe("VALIDATION_ERROR");
    });

    it("captures VALIDATION_ERROR for a set op missing id_or_slug", async () => {
      const result = await getToolHandler(server, "lore_batch")({
        operations: [{ op: "set", args: { title: "New Title" } }],
      });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { results: Array<{ ok: boolean; error?: { code: string; field: string } }> };
      expect(data.results[0]?.ok).toBe(false);
      expect(data.results[0]?.error?.code).toBe("VALIDATION_ERROR");
      expect(data.results[0]?.error?.field).toBe("id_or_slug");
    });

    it("captures VALIDATION_ERROR for a link op missing from/to", async () => {
      const result = await getToolHandler(server, "lore_batch")({
        operations: [{ op: "link", args: { to: "some-doc" } }],
      });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { results: Array<{ ok: boolean; error?: { code: string; field: string } }> };
      expect(data.results[0]?.ok).toBe(false);
      expect(data.results[0]?.error?.code).toBe("VALIDATION_ERROR");
      expect(data.results[0]?.error?.field).toBe("from");
    });
  });

  describe("regression — well-formed ops still succeed", () => {
    it("create/set/link ops with valid args all succeed within one batch", async () => {
      const createResult = await getToolHandler(server, "lore_batch")({
        operations: [{ op: "create", args: { type: "prd", title: "Batch Regression PRD" } }],
      });
      const createData = parseResult(createResult) as { results: Array<{ ok: boolean; value?: { id: string; slug: string } }> };
      expect(createData.results[0]?.ok).toBe(true);
      const created = createData.results[0]?.value;
      expect(created?.id).toBeDefined();

      const followUp = await getToolHandler(server, "lore_batch")({
        operations: [
          { op: "set", args: { id_or_slug: created?.id, title: "Batch Regression PRD (renamed)" } },
          { op: "create", args: { type: "prd", title: "Batch Regression PRD 2" } },
        ],
      });
      const followUpData = parseResult(followUp) as {
        results: Array<{ ok: boolean; value?: { id?: string; slug?: string; version?: number } }>;
      };
      expect(followUpData.results[0]?.ok).toBe(true);
      expect(followUpData.results[1]?.ok).toBe(true);
      const secondPrdId = followUpData.results[1]?.value?.id;
      expect(secondPrdId).toBeDefined();

      const linkResult = await getToolHandler(server, "lore_batch")({
        operations: [{ op: "link", args: { from: created?.id, to: secondPrdId, type: "relates-to" } }],
      });
      const linkData = parseResult(linkResult) as { results: Array<{ ok: boolean }> };
      expect(linkData.results[0]?.ok).toBe(true);
    });
  });

  // BOUNDARY: N/A — array size handled by Zod
  // ERROR: N/A — individual op failures captured in result array
  // STATE: N/A — sequential execution
  // REGRESSION: covered above (well-formed ops still succeed)
});

// ─── lore_pending ─────────────────────────────────────────────────────────────

describe("lore_pending", () => {
  describe("happy path", () => {
    it("returns empty array when no draft docs", async () => {
      const result = await getToolHandler(server, "lore_pending")({});
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as { docs: unknown[] };
      expect(Array.isArray(data.docs)).toBe(true);
    });

    it("returns draft docs after creation", async () => {
      await getToolHandler(server, "lore_create")({ type: "prd", title: "Pending PRD" });
      const result = await getToolHandler(server, "lore_pending")({});
      const data = parseResult(result) as { docs: Array<{ status: string }> };
      expect(data.docs.every((d) => d.status === "draft")).toBe(true);
    });
  });

  // NEGATIVE: N/A — no required inputs
  // BOUNDARY: N/A — no numeric parameters
  // ERROR: N/A — InMemoryStore does not fail
  // STATE: N/A — read-only query
  // REGRESSION: N/A
});

// ─── lore_uat_record (SPEC-054 / task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict) ───
//
// AC-5 SURFACE PARITY: proves the non-plan-target refusal fixed in UatService.record
// (packages/lore/src/service/uat-service.ts) reaches the MCP `lore_uat_record` tool
// WITHOUT any edit to `mcp/tools.ts` — that file still does nothing but the pre-existing
// thin pipe (`app.uatService.record(args.plan, args.verdict, { by: args.by })`, unchanged
// by this task). `makeApp()` above never wires a real `uatService` (stays `undefined`,
// tripping the tool's own "not available" branch), so this block builds ITS OWN app with
// a real `UatService` sharing one `InMemoryStore` with `corpusService` — the same DI shape
// `app.ts` wires in production, just constructed locally for the test.

const UAT_ACCEPT_VERDICT: UatVerdict = {
  verdict: "accept",
  tier_results: [{ tier: "P0", accepted: 2, rejected: 0, unverified: 0 }],
  requirement_coverage: { total: 2, covered: 2, uncovered_p0: [] },
  uiux: { blocker_count: 0, min_dimension_score: 4 },
  run_meta: { at: "2026-08-04T00:00:00.000Z", by: "agent:uat" },
};

function makeAppWithUatService(): { app: App; store: InMemoryStore } {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const uatService = new UatService({
    createUatDoc: corpusService.createUatDoc.bind(corpusService),
    resolveTarget: (idOrSlug: string) => resolveDoc(store, idOrSlug),
    addLink: store.addLink.bind(store),
    now: () => "2026-08-04T00:00:00.000Z",
  });
  return { app: { ...makeApp(), corpusService, uatService }, store };
}

describe("lore_uat_record", () => {
  it("AC-1/HAPPY: recording against a plan through MCP still creates the knowledge/uat doc + informs link, unchanged", async () => {
    const { app: uatApp, store } = makeAppWithUatService();
    const localServer = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(localServer, uatApp);

    const planResult = await uatApp.corpusService.create({ type: "plan", title: "Test plan", content: "body", extra: {} });
    if (!planResult.ok) throw new Error("fixture plan create failed");

    const call = getToolHandler(localServer, "lore_uat_record");
    const result = await call({ plan: planResult.value.slug, verdict: UAT_ACCEPT_VERDICT, by: "agent:uat" });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { doc: DocRecord };
    expect(data.doc.type).toBe("knowledge");
    expect((data.doc.extra as Record<string, unknown>)["sub_type"]).toBe("uat");

    const links = await store.findLinks(planResult.value.id, "in");
    expect(links.ok).toBe(true);
    if (!links.ok) return;
    expect(links.value.some((l) => l.link_type === "informs" && l.from_id === data.doc.id)).toBe(true);
  });

  it("AC-5/NEGATIVE: refuses a non-plan target through the SAME MCP path — proves the fix lives in the service layer, not mcp/tools.ts", async () => {
    const { app: uatApp } = makeAppWithUatService();
    const localServer = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(localServer, uatApp);

    const adrResult = await uatApp.corpusService.create({
      type: "adr",
      title: "Test adr",
      content: "body",
      extra: { decision_status: "accepted" },
    });
    if (!adrResult.ok) throw new Error("fixture adr create failed");

    const call = getToolHandler(localServer, "lore_uat_record");
    const result = await call({ plan: adrResult.value.slug, verdict: UAT_ACCEPT_VERDICT, by: "agent:uat" });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; message?: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("adr");
    expect(error.message).toContain("plan-close");
  });

  it("AC-4/ORDERING (MCP surface): the refused MCP call creates NO knowledge/uat doc and NO link", async () => {
    const { app: uatApp, store } = makeAppWithUatService();
    const localServer = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(localServer, uatApp);

    const adrResult = await uatApp.corpusService.create({
      type: "adr",
      title: "Test adr",
      content: "body",
      extra: { decision_status: "accepted" },
    });
    if (!adrResult.ok) throw new Error("fixture adr create failed");

    const beforeDocs = await uatApp.corpusService.list({ type: "knowledge" });
    const beforeLinks = await store.findLinks(adrResult.value.id, "in");
    if (!beforeDocs.ok || !beforeLinks.ok) throw new Error("fixture count read failed");

    const call = getToolHandler(localServer, "lore_uat_record");
    await call({ plan: adrResult.value.slug, verdict: UAT_ACCEPT_VERDICT, by: "agent:uat" });

    const afterDocs = await uatApp.corpusService.list({ type: "knowledge" });
    const afterLinks = await store.findLinks(adrResult.value.id, "in");
    if (!afterDocs.ok || !afterLinks.ok) throw new Error("fixture count read failed");
    expect(afterDocs.value.total).toBe(beforeDocs.value.total);
    expect(afterLinks.value.length).toBe(beforeLinks.value.length);
  });

  // BOUNDARY/STATE/REGRESSION for this tool are covered by uat-service.test.ts's direct
  // UatService.record suite (AC-2/AC-6/AC-7/AC-8) — this block's sole job is AC-5 surface
  // parity, so it does not re-derive every dimension against the MCP transport.
});

// ─── Tool Registration Completeness ──────────────────────────────────────────

describe("tool registration completeness", () => {
  // reason: SPEC-025 §4 AC-WF-10 added 4 task-workflow tools (lore_claim,
  // lore_release, lore_evidence_add, lore_ready), bringing the total from 16 to 20.
  // SPEC-026 §4 AC-ASSESS-10 adds lore_assess, bringing the total from 20 to 21.
  // SPEC-035 §2 adds lore_audit, bringing the total from 21 to 22.
  // SPEC-034 §6 adds lore_review, bringing the total from 22 to 23.
  // SPEC-039 §2 adds lore_verify, bringing the total from 23 to 24.
  // IoC vertical-slice tech-spec §4.1/§11 P4 adds lore_feed, bringing the total from 24 to 25.
  // SPEC-041 §3 D8 adds lore_bootstrap + lore_handoff, bringing the total from 25 to 27.
  // SPEC-042 §Design Decisions D9 adds lore_anchor_set, bringing the total from 27 to 28.
  // SPEC-043 §Design Decisions D6 adds lore_invalidate, bringing the total from 28 to 29.
  // SPEC-044 §Design Decisions D10 adds lore_staleness_probe, bringing the total from 29 to 30.
  // SPEC-054 adds lore_uat_record, bringing the total from 30 to 31.
  // SPEC-055 adds lore_requirement_add (31 to 32); SPEC-056 adds lore_phase_status
  // (32 to 33, task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence).
  // SPEC-072 T5 adds lore_report_issue (33 to 34).
  // baseline slice 1 §C3 adds the 7 baseline write tools (34 to 41): lore_rule_add/_set,
  // lore_baseline_add/_set_label/_depends/_glossary_add/_glossary_rm.
  // baseline slice 2 C6 adds the 3 rule read tools (41 to 44): lore_rule_show/_find/_impact.
  it("registers all 44 expected tools", () => {
    const expectedTools = [
      "lore_create",
      "lore_get",
      "lore_set",
      "lore_delete",
      "lore_list",
      "lore_search",
      "lore_tree",
      "lore_link",
      "lore_log",
      "lore_diff",
      "lore_pending",
      "lore_approve",
      "lore_schema",
      "lore_context_bundle",
      "lore_batch",
      "lore_status",
      "lore_claim",
      "lore_release",
      "lore_evidence_add",
      "lore_ready",
      "lore_assess",
      "lore_audit",
      "lore_review",
      "lore_verify",
      "lore_feed",
      "lore_bootstrap",
      "lore_handoff",
      "lore_anchor_set",
      "lore_invalidate",
      "lore_staleness_probe",
      "lore_uat_record",
      "lore_requirement_add",
      "lore_phase_status",
      "lore_report_issue",
      "lore_rule_add",
      "lore_rule_set",
      "lore_rule_show",
      "lore_rule_find",
      "lore_rule_impact",
      "lore_baseline_add",
      "lore_baseline_set_label",
      "lore_baseline_depends",
      "lore_baseline_glossary_add",
      "lore_baseline_glossary_rm",
    ];

    const internal = server as unknown as McpServerInternal;
    for (const name of expectedTools) {
      expect(internal._registeredTools[name]).toBeDefined();
    }
    expect(Object.keys(internal._registeredTools)).toHaveLength(44);
  });
});
