// @reads src/another-valid-target.ts
// @reads src/valid-target.ts
/**
 * AC-RR-9 — closing the MCP side door that stored a grammar-invalid knowledge
 * `code_anchors` entry as a silent false green
 * (spec-a-write-side-fact-with-no-read-side-address-counts-with-no §M2).
 *
 * `CorpusService.create`/`.set`'s per-entry `code_anchors` GRAMMAR check
 * (`parseCodeAnchor`) was gated on a literal `type === "spec"`. MCP
 * `lore_create`/`lore_set` accept `extra` directly (`tools.ts` merges no
 * code_anchors-specific validation of its own — see corpus-service.ts's own
 * comment on the fixed gate), so a knowledge doc's grammar-invalid entry rode
 * straight through that door: `extractParsedCodeAnchors`
 * (drift-check-service.ts) silently SKIPS an unparseable entry at scan time,
 * so `lore status --check-drift` never reported it and it never counted
 * toward `knowledge_checked` — a fact admitted at write time with zero drift
 * coverage, never surfaced as a refusal either.
 *
 * Driven EXCLUSIVELY through the MCP tool handlers `registerTools` wires
 * (`lore_create` / `lore_set` / `lore_status`) — never by importing
 * `parseCodeAnchor`/`extractParsedCodeAnchors` directly. Harness mirrors
 * `mcp-drift.test.ts`'s own `makeApp()`/`getToolHandler()` pattern.
 *
 * Six-dimension coverage:
 *   HAPPY:      CONTROL — a grammar-VALID knowledge `code_anchors` entry is
 *               ACCEPTED via `lore_create`, and the drift oracle
 *               (`lore_status {check_drift:true}`, itself an MCP tool)
 *               reports it ARMED (`knowledge_checked: 1`) — proving the
 *               stored entry actually reaches `extractParsedCodeAnchors`,
 *               not merely that the create call returned success
 *   NEGATIVE:   REFUSAL — `lore_create` with a grammar-invalid knowledge
 *               `code_anchors` entry is refused (VALIDATION_ERROR naming the
 *               offending string), and no such doc exists afterward
 *   BOUNDARY:   a SECOND, differently-shaped grammar violation (directory +
 *               symbol combo) is refused the same way — proving the gate
 *               checks real grammar, not one hardcoded literal
 *   ERROR:      `lore_set` on an EXISTING knowledge doc with a
 *               grammar-invalid `code_anchors` entry is refused, and the
 *               target's `extra` is byte-identical (SHA-256 compared) before
 *               and after the rejected call
 *   STATE:      `lore_set` with a grammar-VALID entry on that SAME doc DOES
 *               change stored state (extra changes, drift oracle sees it) —
 *               the mirror-image control for the `set` door
 *   REGRESSION: the pre-existing spec-doc refusal through the same MCP door
 *               (both `lore_create` and `lore_set`) is unchanged
 *
 * @spec_ref spec-a-write-side-fact-with-no-read-side-address-counts-with-no §M2, AC-RR-9
 */

import { liveInvocation, actedStore } from "../../live-invocation.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { createHash } from "node:crypto";
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
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { ValidityService } from "../../../src/service/validity-service.js";
import { DriftCheckService } from "../../../src/service/drift-check-service.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, LoreError } from "@lore/core";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

// ─── Test Infrastructure (mirrors mcp-drift.test.ts's makeApp/getToolHandler) ─

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let app: App;

function makeApp(): App {
  store = actedStore(new InMemoryStore());
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const judgmentService = new JudgmentService(store, new NoOpTelemetry());
  const aiProvider = new InMemoryAIProvider("in-memory", { kind: "ok", content: "{}" });
  const providers = new Map([["in-memory", aiProvider]]) as unknown as ReadonlyMap<
    string,
    import("@lore/core").AIProvider
  >;
  const aiProviderService = new AIProviderService(
    providers,
    "in-memory",
    {},
    new NoOpTelemetry(),
    false,
    8000,
    { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 },
    { max_context_chars: 8000 },
    { max_doc_chars: 12000, neighbor_limit: 20 },
  );

  return {
    warn: () => undefined,
    corpusService,
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService,
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 }),
    specKindService: null as unknown as App["specKindService"],
    judgmentService,
    validityService: new ValidityService(store, new NoOpTelemetry()),
    auditService: null as unknown as App["auditService"],
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
    driftCheckService: new DriftCheckService(store),
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "env" as const }),
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

function parseError(result: CallToolResult): LoreError {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text) as LoreError;
}

/** Stable stringify (recursively sorted keys) — makes the SHA comparison immune to
 *  incidental key-ordering rather than a real content change. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Of(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

async function createPrd(): Promise<string> {
  const result = await corpusService.create({
    type: "prd",
    title: "ZzzMcpAnchorGrammarRootPrd",
    content: "## Overview\n\nBody.",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`create prd failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** Fixture: an existing, grammar-clean knowledge doc — created directly via
 *  CorpusService (fixture setup, not the write under test) so each `lore_set`
 *  test starts from a known-good `extra`. */
async function createKnowledgeFixture(
  prdId: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; slug: string }> {
  const result = await corpusService.create({
    type: "knowledge",
    title,
    parent_id: prdId,
    content: "fact body",
    extra: { sub_type: "reference", ...extra },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`create knowledge "${title}" failed: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, slug: result.value.slug };
}

let server: McpServer;

beforeEach(() => {
  app = makeApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app, undefined, liveInvocation());
});

// ─── NEGATIVE — lore_create REFUSAL, knowledge target ────────────────────────

describe("lore_create — NEGATIVE (REFUSAL: grammar-invalid knowledge code_anchors)", () => {
  it("refuses a knowledge doc carrying a grammar-invalid code_anchors entry, naming the offending string", async () => {
    const prdId = await createPrd();
    const call = getToolHandler(server, "lore_create");
    const result = await call({
      type: "knowledge",
      title: "ZzzMcpAnchorGrammarRefusedFact",
      parent_id: prdId,
      content: "fact body",
      extra: { sub_type: "reference", code_anchors: ["../escapes/the/repo.ts"] },
    });

    expect(result.isError).toBe(true);
    const error = parseError(result);
    if (error.code !== "VALIDATION_ERROR") throw new Error(`expected VALIDATION_ERROR, got ${error.code}`);
    expect(error.message).toContain("../escapes/the/repo.ts");
  });

  it("stores NOTHING — the refused doc does not exist afterward", async () => {
    const prdId = await createPrd();
    const call = getToolHandler(server, "lore_create");
    const result = await call({
      type: "knowledge",
      title: "ZzzMcpAnchorGrammarAbsentFact",
      parent_id: prdId,
      content: "fact body",
      extra: { sub_type: "reference", code_anchors: ["../escapes/the/repo.ts"] },
    });
    expect(result.isError).toBe(true);

    const listResult = await corpusService.list({ type: "knowledge" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.docs.some((d) => d.title === "ZzzMcpAnchorGrammarAbsentFact")).toBe(false);
    expect(listResult.value.total).toBe(0);
  });
});

// ─── BOUNDARY — a second, differently-shaped grammar violation ──────────────

describe("lore_create — BOUNDARY (a directory-anchor-plus-symbol combo is ALSO refused)", () => {
  it("refuses a knowledge doc whose code_anchors entry is a directory anchor carrying a #Symbol", async () => {
    const prdId = await createPrd();
    const call = getToolHandler(server, "lore_create");
    const result = await call({
      type: "knowledge",
      title: "ZzzMcpAnchorGrammarDirPlusSymbolFact",
      parent_id: prdId,
      content: "fact body",
      extra: { sub_type: "reference", code_anchors: ["src/dir/#Foo"] },
    });

    expect(result.isError).toBe(true);
    const error = parseError(result);
    if (error.code !== "VALIDATION_ERROR") throw new Error(`expected VALIDATION_ERROR, got ${error.code}`);
  });
});

// ─── HAPPY — CONTROL: the SAME door accepts a grammar-VALID entry ───────────

describe("lore_create — HAPPY (CONTROL: grammar-VALID knowledge code_anchors is ACCEPTED)", () => {
  it("accepts the doc, and lore_status{check_drift:true} reports it ARMED (knowledge_checked: 1)", async () => {
    const prdId = await createPrd();
    const createCall = getToolHandler(server, "lore_create");
    const createResult = await createCall({
      type: "knowledge",
      title: "ZzzMcpAnchorGrammarAcceptedFact",
      parent_id: prdId,
      content: "fact body",
      extra: { sub_type: "reference", code_anchors: ["src/valid-target.ts#Exported"] },
    });

    expect(createResult.isError).toBeFalsy();
    const created = parseResult(createResult) as { id: string; slug: string };
    expect(created.slug).toBeDefined();

    // The discriminator: this same test would ALSO pass for a check that
    // refuses NOTHING (create would still succeed) — the knowledge_checked
    // assertion below is what proves the entry was actually stored AND is
    // reachable by extractParsedCodeAnchors (drift-check-service.ts), not
    // merely that create() returned ok.
    const statusCall = getToolHandler(server, "lore_status");
    const statusResult = await statusCall({ check_drift: true });
    expect(statusResult.isError).toBeFalsy();
    const status = parseResult(statusResult) as { code_drift: { knowledge_checked: number; specs_checked: number } };
    expect(status.code_drift.knowledge_checked).toBe(1);
    expect(status.code_drift.specs_checked).toBe(0);
  });
});

// ─── ERROR — lore_set REFUSAL, knowledge target, byte-identical extra ───────

describe("lore_set — ERROR (REFUSAL: grammar-invalid knowledge code_anchors, extra untouched)", () => {
  it("refuses the patch and leaves the target's extra byte-identical (SHA-256 compared)", async () => {
    const prdId = await createPrd();
    const { id, slug } = await createKnowledgeFixture(prdId, "ZzzMcpAnchorGrammarSetRefusedFact", {
      tags_note: "keep me",
    });

    const before = await corpusService.get(id);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const beforeHash = sha256Of(before.value.doc.extra);

    const setCall = getToolHandler(server, "lore_set");
    const setResult = await setCall({
      id_or_slug: slug,
      extra: { sub_type: "reference", tags_note: "keep me", code_anchors: ["../escapes/the/repo.ts"] },
    });
    expect(setResult.isError).toBe(true);
    const error = parseError(setResult);
    if (error.code !== "VALIDATION_ERROR") throw new Error(`expected VALIDATION_ERROR, got ${error.code}`);

    const after = await corpusService.get(id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const afterHash = sha256Of(after.value.doc.extra);
    expect(afterHash).toBe(beforeHash);
    // Positive trace the hash comparison isn't vacuously trivial (an empty-object
    // hash matching an empty-object hash either way): the fixture's own sibling
    // key must actually be present in both snapshots.
    expect(after.value.doc.extra["tags_note"]).toBe("keep me");
    expect(after.value.doc.extra["code_anchors"]).toBeUndefined();
  });
});

// ─── STATE — mirror-image control for the set door ──────────────────────────

describe("lore_set — STATE (CONTROL: grammar-VALID knowledge code_anchors DOES persist)", () => {
  it("accepts the patch, changes stored extra, and the drift oracle sees the new entry", async () => {
    const prdId = await createPrd();
    const { id, slug } = await createKnowledgeFixture(prdId, "ZzzMcpAnchorGrammarSetAcceptedFact");

    const setCall = getToolHandler(server, "lore_set");
    const setResult = await setCall({
      id_or_slug: slug,
      extra: { sub_type: "reference", code_anchors: ["src/another-valid-target.ts#Exported"] },
    });
    expect(setResult.isError).toBeFalsy();

    const after = await corpusService.get(id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.extra["code_anchors"]).toEqual(["src/another-valid-target.ts#Exported"]);

    const statusCall = getToolHandler(server, "lore_status");
    const statusResult = await statusCall({ check_drift: true });
    expect(statusResult.isError).toBeFalsy();
    const status = parseResult(statusResult) as { code_drift: { knowledge_checked: number } };
    expect(status.code_drift.knowledge_checked).toBe(1);
  });
});

// ─── REGRESSION — the pre-existing spec-doc refusal is unchanged ────────────

describe("REGRESSION — the pre-existing spec-doc refusal through the same MCP door is unchanged", () => {
  it("lore_create still refuses a grammar-invalid spec code_anchors entry", async () => {
    const prdId = await createPrd();
    const call = getToolHandler(server, "lore_create");
    const result = await call({
      type: "spec",
      title: "ZzzMcpAnchorGrammarSpecRefused",
      content: "spec body",
      extra: { spec_kind: "feature", code_anchors: ["../escapes/the/repo.ts"] },
    });

    expect(result.isError).toBe(true);
    const error = parseError(result);
    if (error.code !== "VALIDATION_ERROR") throw new Error(`expected VALIDATION_ERROR, got ${error.code}`);
    expect(error.message).toContain("../escapes/the/repo.ts");
  });

  it("lore_set still refuses a grammar-invalid spec code_anchors entry, extra untouched", async () => {
    const prdId = await createPrd();
    const specResult = await corpusService.create({
      type: "spec",
      title: "ZzzMcpAnchorGrammarSpecSetFixture",
      content: "spec body",
      extra: { spec_kind: "feature" },
    } as CreateDocInput);
    if (!specResult.ok) throw new Error(`create spec fixture failed: ${JSON.stringify(specResult.error)}`);
    const { id, slug } = specResult.value;

    const before = await corpusService.get(id);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const beforeHash = sha256Of(before.value.doc.extra);

    const setCall = getToolHandler(server, "lore_set");
    const setResult = await setCall({
      id_or_slug: slug,
      extra: { spec_kind: "feature", code_anchors: ["../escapes/the/repo.ts"] },
    });
    expect(setResult.isError).toBe(true);

    const after = await corpusService.get(id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(sha256Of(after.value.doc.extra)).toBe(beforeHash);
  });
});
