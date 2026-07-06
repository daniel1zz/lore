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
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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

    it("creates a spec with parent_id", async () => {
      const prdResult = await call()({ type: "prd", title: "Parent PRD" });
      const prd = parseResult(prdResult) as { id: string };
      const specResult = await call()({ type: "spec", title: "Auth Spec", parent_id: prd.id });
      expect(specResult.isError).toBeFalsy();
      const spec = parseResult(specResult) as { type: string };
      expect(spec.type).toBe("spec");
    });
  });

  describe("negative cases", () => {
    it("returns error when spec missing parent_id", async () => {
      const result = await call()({ type: "spec", title: "Orphan Spec" });
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
      const result = await call()({ type: "spec", title: "No Parent" });
      expect(result.isError).toBe(true);
      const text = result.content[0];
      expect(text?.type).toBe("text");
    });
  });

  // STATE: N/A — stateless per call
  // REGRESSION: N/A — no known regressions
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
      await cc({ type: "spec", title: "Spec", parent_id: prdData.id });

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
      await getToolHandler(server, "lore_create")({ type: "spec", title: "Child Spec", parent_id: prdData.id });

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
      const sr = await getToolHandler(server, "lore_create")({ type: "spec", title: "Child", parent_id: prd.id });
      const spec = parseResult(sr) as { id: string };
      await getToolHandler(server, "lore_create")({ type: "spec", title: "GrandChild", parent_id: spec.id });

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
  });

  // BOUNDARY: N/A — array size handled by Zod
  // ERROR: N/A — individual op failures captured in result array
  // STATE: N/A — sequential execution
  // REGRESSION: N/A
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

// ─── Tool Registration Completeness ──────────────────────────────────────────

describe("tool registration completeness", () => {
  // reason: SPEC-025 §4 AC-WF-10 added 4 task-workflow tools (lore_claim,
  // lore_release, lore_evidence_add, lore_ready), bringing the total from 16 to 20.
  // SPEC-026 §4 AC-ASSESS-10 adds lore_assess, bringing the total from 20 to 21.
  it("registers all 21 expected tools", () => {
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
    ];

    const internal = server as unknown as McpServerInternal;
    for (const name of expectedTools) {
      expect(internal._registeredTools[name]).toBeDefined();
    }
    expect(Object.keys(internal._registeredTools)).toHaveLength(21);
  });
});
