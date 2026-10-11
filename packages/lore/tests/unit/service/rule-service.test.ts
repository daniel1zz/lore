/**
 * @spec_ref spec-baseline-slice-1-rules-with-permanent-ids-ac-citations (C3, QA-2, AC-BLS1-2)
 * @task task-skill-test-ruleservice-baseline-verbs-and-replace-guard-red ([C1], RED; paired impl C2)
 *
 * RuleService + baseline node verbs, and the service-layer REPLACE GUARD that
 * stops a wholesale `lore set` from rewriting dedicated-verb-owned `extra` keys
 * on a `baseline` doc. InMemoryStore + CorpusService only (vitest, no bun:sqlite).
 *
 * ── PINNED CONTRACT (C2 builds to exactly this) ─────────────────────────────
 *
 *   // packages/lore/src/service/rule-service.ts  (import path pinned by this test)
 *   export class RuleService {
 *     constructor(store: StoreInterface);   // same InMemoryStore as CorpusService
 *
 *     // ── rules (leaf only) ──
 *     addRule(
 *       leaf: string,                       // doc id or slug of a baseline node=leaf
 *       input: { statement: string; confidence: RuleConfidence;
 *                enforced_by: RuleEnforcement; examples: string[] },
 *       opts?: { by?: string },
 *     ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>>;
 *       - allocates the id through store.allocateRuleAndUpdateLeaf (registry, B2):
 *         ruleId matches BASELINE_RULE_ID_PATTERN; new rule lifecycle "live";
 *         leaf.version increments by exactly 1; an `approved` leaf is demoted to
 *         `draft` (editing approved content invalidates approval).
 *       - non-leaf target => VALIDATION_ERROR (rules only on node=leaf).
 *       - statement/examples violating baselineRuleSchema => VALIDATION_ERROR,
 *         NO registry row burned, leaf unchanged.
 *
 *     setRule(
 *       ruleId: string,                     // "BR-<n>"
 *       patch: { statement?; confidence?; enforced_by?; examples?;
 *                lifecycle?: RuleLifecycle; note?: string;   // note => retired_note
 *                moveTo?: string },                          // destination leaf id|slug
 *       opts?: { by?: string },
 *     ): Promise<Result<{ rule: BaselineRule; doc: DocRecord }, LoreError>>;
 *       - lifecycle is FORWARD-ONLY (isLawfulRuleLifecycleTransition): live ->
 *         deprecated|retired, deprecated -> retired; anything -> live (or any
 *         backward / same-state move) => VALIDATION_ERROR.
 *       - lifecycle "retired" without `note` => VALIDATION_ERROR; with note it is
 *         stored as retired_note.
 *       - moveTo goes through store.moveRule: the id is unchanged, the rule leaves
 *         the source leaf and lands on the destination (both versions +1); moveTo
 *         a non-leaf => VALIDATION_ERROR.
 *       - unknown ruleId => DOC_NOT_FOUND.
 *
 *     // ── baseline node verbs ──
 *     addNode(
 *       parent: string,                     // doc id|slug: a prd (for node=root) or a baseline root|branch
 *       input: { node: BaselineNode; label: string; title: string; content: string },
 *       opts?: { by?: string },
 *     ): Promise<Result<DocRecord, LoreError>>;
 *       - validates with validateBaselineParent: leaf/branch under root|branch OK;
 *         leaf under a prd, or anything under a leaf => VALIDATION_ERROR.
 *       - created doc: type "baseline", extra.node + extra.label set, parent = `parent`.
 *     setLabel(node: string, label: string, opts?): Promise<Result<DocRecord, LoreError>>;
 *     setDependsOn(
 *       leaf: string,
 *       change: { add?: string[]; remove?: string[] },   // entries are rule ids "BR-<n>"
 *       opts?,
 *     ): Promise<Result<DocRecord, LoreError>>;
 *       - an `add` entry not present in the rule registry => VALIDATION_ERROR (nothing
 *         written); existing ids are stored (de-duplicated) on extra.depends_on.
 *     glossaryAdd(node: string, entry: { term: string; meaning: string; note?: string }, opts?)
 *       : Promise<Result<DocRecord, LoreError>>;       // root|branch only; leaf => VALIDATION_ERROR
 *     glossaryRemove(node: string, term: string, opts?): Promise<Result<DocRecord, LoreError>>;
 *
 *   All return `Result<_, LoreError>` — never throw for a domain refusal.
 *
 * ── REPLACE GUARD (QA-2) ────────────────────────────────────────────────────
 *   CorpusService.set(idOrSlug, patch) on a `baseline` doc where `patch.extra`
 *   REORDERS, REPLACES or DROPS any key of DEDICATED_EXTRA_KEYS.baseline (node,
 *   label, rules, depends_on, glossary) relative to the stored extra => refused
 *   (VALIDATION_ERROR), doc unchanged, and the error text names that key's
 *   `writer` from DEDICATED_EXTRA_KEYS (e.g. "lore rule add|set"). The guard is
 *   value-comparing: a drop-only guard (refuse only when the key is absent) must
 *   NOT satisfy these tests (falsifier scenarios below). An `extra` that echoes
 *   the guarded keys byte-equal, and non-extra patches (title...), stay allowed.
 *   The refusal lives in CorpusService.set so ALL THREE entry points inherit it:
 *     1. the CLI `lore set` path  -> corpusService.set directly
 *     2. MCP `lore_set` handler   -> registerTools(...) handler, isError result
 *     3. HTTP PATCH /api/docs/:id -> handleApiRoute, non-2xx {ok:false,error}
 *
 * ── FALSIFIERS ──────────────────────────────────────────────────────────────
 *   - a drop-only guard turns the "replaced array" and "reordered array" cases red
 *     (key present, value different).
 *   - a guard wired only into the CLI path turns the MCP / HTTP cases red.
 *
 * ── DIMENSIONS ──────────────────────────────────────────────────────────────
 *   HAPPY addRule / addNode / setDependsOn · NEGATIVE leaf-under-prd, retired
 *   without note, dangling depends_on · STATE approved->draft, version increments,
 *   forward-only lifecycle · BOUNDARY reorder-only patch · REGRESSION control
 *   (identical echo of guarded keys is NOT refused; only that control passes
 *   against today's code, every other test is RED by design).
 *
 * FIXTURE NOTE (re-baselined with C2): fixture leaves are seeded with rules through the registry
 * allocator (`RuleService.addRule`), because `CorpusService.create` refuses a leaf born with rules.
 *
 * RED NOTE: RuleService does not exist yet; it is loaded via dynamic import so
 * this file loads and each RuleService test fails with "RuleService is not
 * implemented". The InMemoryStore rule-registry methods are B2's (in flight).
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DEDICATED_EXTRA_KEYS, NoOpTelemetry, ok } from "@lore/core";
import type { CreateDocInput, DocRecord, DocPatch } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { handleApiRoute } from "../../../src/adapters/http/routes.js";
import type { ApiKeyStore, ActorContext } from "../../../src/adapters/http/auth.js";
import type { App } from "../../../src/app.js";

// ─── RuleService loader (guarded import: the module does not exist yet) ───────

interface RuleServiceLike {
  addRule(leaf: string, input: Record<string, unknown>, opts?: { by?: string }): Promise<ServiceResult>;
  setRule(ruleId: string, patch: Record<string, unknown>, opts?: { by?: string }): Promise<ServiceResult>;
  addNode(parent: string, input: Record<string, unknown>, opts?: { by?: string }): Promise<ServiceResult>;
  setLabel(node: string, label: string, opts?: { by?: string }): Promise<ServiceResult>;
  setDependsOn(leaf: string, change: { add?: string[]; remove?: string[] }, opts?: { by?: string }): Promise<ServiceResult>;
  glossaryAdd(node: string, entry: Record<string, unknown>, opts?: { by?: string }): Promise<ServiceResult>;
  glossaryRemove(node: string, term: string, opts?: { by?: string }): Promise<ServiceResult>;
}
type ServiceResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: { code?: string; message?: string } };

async function makeRuleService(store: InMemoryStore): Promise<RuleServiceLike> {
  // reason: variable specifier keeps tsc/vite from resolving a not-yet-existing module.
  const specifier = "../../../src/service/rule-service.js";
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(`RuleService is not implemented: packages/lore/src/service/rule-service.ts cannot be loaded (${String(cause)})`);
  }
  const Ctor = mod["RuleService"] as (new (s: InMemoryStore, createDoc: CorpusService["create"]) => RuleServiceLike) | undefined;
  if (Ctor === undefined) throw new Error("RuleService is not implemented: rule-service.ts exports no `RuleService` class");
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return new Ctor(store, corpus.create.bind(corpus));
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

const stubApiKeyStore = {} as ApiKeyStore;
const TEST_ACTOR: ActorContext = { name: "test-agent", session_id: "test-session-id" };

let store: InMemoryStore;
let corpusService: CorpusService;
let app: App;

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
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
    taskWorkflowService: new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 }, async () => ok(new Set())),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

beforeEach(() => {
  app = makeApp();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function mustCreate(input: CreateDocInput): Promise<DocRecord> {
  const r = await corpusService.create(input);
  if (!r.ok) throw new Error(`fixture create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

const rule = (id: string, statement: string) => ({
  id,
  statement,
  confidence: "established" as const,
  enforced_by: "guaranteed" as const,
  examples: [`${statement} (example)`],
  lifecycle: "live" as const,
});

/**
 * Seed a freshly created (rule-less) leaf with rules through the sanctioned allocator
 * (`RuleService.addRule`, registry ids BR-n in call order) and an optional `depends_on`,
 * then return the leaf as stored. `CorpusService.create` refuses a leaf born with rules.
 */
async function seedLeaf(leaf: DocRecord, statements: string[], dependsOn: string[] = []): Promise<DocRecord> {
  const svc = await makeRuleService(store);
  for (const statement of statements) {
    const added = await svc.addRule(
      leaf.id,
      { statement, confidence: "established", enforced_by: "guaranteed", examples: [`${statement} (example)`] },
      { by: "fixture" },
    );
    if (!added.ok) throw new Error(`fixture addRule failed: ${JSON.stringify(added.error)}`);
  }
  if (dependsOn.length > 0) {
    const dep = await svc.setDependsOn(leaf.id, { add: dependsOn }, { by: "fixture" });
    if (!dep.ok) throw new Error(`fixture setDependsOn failed: ${JSON.stringify(dep.error)}`);
  }
  const stored = await corpusService.get(leaf.id);
  if (!stored.ok) throw new Error(`fixture get failed: ${JSON.stringify(stored.error)}`);
  return stored.value.doc;
}

/** prd -> baseline root -> baseline branch -> baseline leaf (two rules, label, depends_on). */
async function makeTree(): Promise<{ prd: DocRecord; root: DocRecord; branch: DocRecord; leaf: DocRecord }> {
  const prd = await mustCreate({ type: "prd", title: "Product", content: "root" } as CreateDocInput);
  const root = await mustCreate({
    type: "baseline", title: "Baseline root", content: "r", parent_id: prd.id,
    extra: { node: "root", label: "Root", glossary: [{ term: "Doc", meaning: "A unit" }] },
  } as CreateDocInput);
  const branch = await mustCreate({
    type: "baseline", title: "Baseline branch", content: "b", parent_id: root.id,
    extra: { node: "branch", label: "Branch", glossary: [{ term: "Leaf", meaning: "A rule holder" }, { term: "Rule", meaning: "A fact" }] },
  } as CreateDocInput);
  const created = await mustCreate({
    type: "baseline", title: "Baseline leaf", content: "l", parent_id: branch.id,
    extra: { node: "leaf", label: "Leaf" },
  } as CreateDocInput);
  const leaf = await seedLeaf(created, ["first rule", "second rule"], ["BR-1"]);
  return { prd, root, branch, leaf };
}

const NEW_RULE = {
  statement: "A claimed task cannot be claimed twice",
  confidence: "established",
  enforced_by: "guaranteed",
  examples: ["second claim is refused"],
};

function errorText(r: ServiceResult): string {
  if (r.ok) throw new Error("expected an error result, got ok");
  return JSON.stringify(r.error);
}

// ═════════════════════════════════════════════════════════════════════════════
// RuleService.addRule
// ═════════════════════════════════════════════════════════════════════════════

describe("RuleService.addRule", () => {
  it("returns a BR-n id, appends a live rule and bumps the leaf version by exactly 1", async () => {
    const { leaf } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.addRule(leaf.id, NEW_RULE, { by: "t" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(String(res.value["ruleId"])).toMatch(/^BR-[1-9][0-9]*$/);
    const after = await corpusService.get(leaf.id);
    expect(after.ok && after.value.doc.version).toBe(leaf.version + 1);
    const rules = (after.ok ? after.value.doc.extra["rules"] : []) as Array<{ id: string; lifecycle: string }>;
    expect(rules.find((r) => r.id === res.value["ruleId"])?.lifecycle).toBe("live");
  });

  it("demotes an approved leaf to draft when a rule is added", async () => {
    const { leaf } = await makeTree();
    const approved = await corpusService.set(leaf.id, { status: "approved" });
    expect(approved.ok && approved.value.status).toBe("approved");
    const svc = await makeRuleService(store);
    const res = await svc.addRule(leaf.id, NEW_RULE, { by: "t" });
    expect(res.ok).toBe(true);
    const after = await corpusService.get(leaf.id);
    expect(after.ok && after.value.doc.status).toBe("draft");
  });

  it("refuses rules on a non-leaf node (branch)", async () => {
    const { branch } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.addRule(branch.id, NEW_RULE, { by: "t" });
    expect(res.ok).toBe(false);
    expect(errorText(res)).toMatch(/leaf/i);
  });

  it("refuses an invalid rule (empty examples) without burning a registry id or touching the leaf", async () => {
    const { leaf } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.addRule(leaf.id, { ...NEW_RULE, examples: [] }, { by: "t" });
    expect(res.ok).toBe(false);
    const after = await corpusService.get(leaf.id);
    expect(after.ok && after.value.doc.version).toBe(leaf.version);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RuleService.setRule — lifecycle forward-only, retired needs note, moveTo
// ═════════════════════════════════════════════════════════════════════════════

describe("RuleService.setRule", () => {
  it("refuses lifecycle=retired without a note", async () => {
    const { leaf } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.setRule("BR-1", { lifecycle: "retired" }, { by: "t" });
    expect(res.ok).toBe(false);
    expect(errorText(res)).toMatch(/note/i);
    const after = await corpusService.get(leaf.id);
    expect(after.ok && after.value.doc.version).toBe(leaf.version);
  });

  it("accepts lifecycle=retired with a note and stores it as retired_note", async () => {
    const { leaf } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.setRule("BR-1", { lifecycle: "retired", note: "superseded by BR-2" }, { by: "t" });
    expect(res.ok).toBe(true);
    const after = await corpusService.get(leaf.id);
    const rules = (after.ok ? after.value.doc.extra["rules"] : []) as Array<{ id: string; lifecycle: string; retired_note?: string }>;
    const r1 = rules.find((r) => r.id === "BR-1");
    expect(r1?.lifecycle).toBe("retired");
    expect(r1?.retired_note).toBe("superseded by BR-2");
  });

  it("refuses moving a retired rule back to live (forward-only)", async () => {
    await makeTree();
    const svc = await makeRuleService(store);
    const retired = await svc.setRule("BR-1", { lifecycle: "retired", note: "gone" }, { by: "t" });
    expect(retired.ok).toBe(true);
    const back = await svc.setRule("BR-1", { lifecycle: "live" }, { by: "t" });
    expect(back.ok).toBe(false);
  });

  it("refuses deprecated -> live", async () => {
    await makeTree();
    const svc = await makeRuleService(store);
    expect((await svc.setRule("BR-2", { lifecycle: "deprecated" }, { by: "t" })).ok).toBe(true);
    expect((await svc.setRule("BR-2", { lifecycle: "live" }, { by: "t" })).ok).toBe(false);
  });

  it("returns an error for an unknown rule id", async () => {
    await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.setRule("BR-999", { statement: "x" }, { by: "t" });
    expect(res.ok).toBe(false);
  });

  it("moveTo relocates the rule to another leaf keeping its id", async () => {
    const { branch, leaf } = await makeTree();
    const destCreated = await mustCreate({
      type: "baseline", title: "Second leaf", content: "l2", parent_id: branch.id,
      extra: { node: "leaf", label: "Leaf 2" },
    } as CreateDocInput);
    const dest = await seedLeaf(destCreated, ["third rule"]);
    const svc = await makeRuleService(store);
    const res = await svc.setRule("BR-2", { moveTo: dest.id }, { by: "t" });
    expect(res.ok).toBe(true);
    const from = await corpusService.get(leaf.id);
    const to = await corpusService.get(dest.id);
    const fromIds = ((from.ok ? from.value.doc.extra["rules"] : []) as Array<{ id: string }>).map((r) => r.id);
    const toIds = ((to.ok ? to.value.doc.extra["rules"] : []) as Array<{ id: string }>).map((r) => r.id);
    expect(fromIds).not.toContain("BR-2");
    expect(toIds).toContain("BR-2");
  });

  it("moveTo a non-leaf node is refused", async () => {
    const { branch } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.setRule("BR-2", { moveTo: branch.id }, { by: "t" });
    expect(res.ok).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Baseline node verbs
// ═════════════════════════════════════════════════════════════════════════════

describe("RuleService baseline node verbs", () => {
  it("addNode creates a leaf under a branch with node+label set", async () => {
    const { branch } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.addNode(branch.id, { node: "leaf", label: "New leaf", title: "New leaf", content: "c" }, { by: "t" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const extra = res.value["extra"] as Record<string, unknown>;
    expect(res.value["type"]).toBe("baseline");
    expect(extra["node"]).toBe("leaf");
    expect(extra["label"]).toBe("New leaf");
  });

  it("addNode refuses a leaf directly under a prd", async () => {
    const { prd } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.addNode(prd.id, { node: "leaf", label: "Bad", title: "Bad", content: "c" }, { by: "t" });
    expect(res.ok).toBe(false);
  });

  it("addNode refuses any child under a leaf", async () => {
    const { leaf } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.addNode(leaf.id, { node: "leaf", label: "Bad", title: "Bad", content: "c" }, { by: "t" });
    expect(res.ok).toBe(false);
  });

  it("setLabel updates extra.label", async () => {
    const { leaf } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.setLabel(leaf.id, "Renamed", { by: "t" });
    expect(res.ok).toBe(true);
    const after = await corpusService.get(leaf.id);
    expect(after.ok && after.value.doc.extra["label"]).toBe("Renamed");
  });

  it("setDependsOn refuses an add naming a rule id that does not exist, writing nothing", async () => {
    const { leaf } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.setDependsOn(leaf.id, { add: ["BR-777"] }, { by: "t" });
    expect(res.ok).toBe(false);
    const after = await corpusService.get(leaf.id);
    expect(after.ok && after.value.doc.extra["depends_on"]).toEqual(["BR-1"]);
  });

  it("setDependsOn stores an existing rule id on the leaf", async () => {
    const { leaf } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.setDependsOn(leaf.id, { add: ["BR-2"] }, { by: "t" });
    expect(res.ok).toBe(true);
    const after = await corpusService.get(leaf.id);
    expect(after.ok && after.value.doc.extra["depends_on"]).toEqual(["BR-1", "BR-2"]);
  });

  it("glossaryAdd / glossaryRemove round-trip on a branch", async () => {
    const { branch } = await makeTree();
    const svc = await makeRuleService(store);
    expect((await svc.glossaryAdd(branch.id, { term: "Baseline", meaning: "The product tree" }, { by: "t" })).ok).toBe(true);
    let after = await corpusService.get(branch.id);
    expect(((after.ok ? after.value.doc.extra["glossary"] : []) as Array<{ term: string }>).map((g) => g.term)).toContain("Baseline");
    expect((await svc.glossaryRemove(branch.id, "Baseline", { by: "t" })).ok).toBe(true);
    after = await corpusService.get(branch.id);
    expect(((after.ok ? after.value.doc.extra["glossary"] : []) as Array<{ term: string }>).map((g) => g.term)).not.toContain("Baseline");
  });

  it("glossaryAdd on a leaf is refused", async () => {
    const { leaf } = await makeTree();
    const svc = await makeRuleService(store);
    const res = await svc.glossaryAdd(leaf.id, { term: "X", meaning: "Y" }, { by: "t" });
    expect(res.ok).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// QA-2 — replace guard, three entry points
// ═════════════════════════════════════════════════════════════════════════════

type Refusal = { refused: boolean; text: string };
type EntryPoint = { name: string; set: (idOrSlug: string, patch: DocPatch) => Promise<Refusal> };

type McpServerInternal = {
  _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }>;
};

const entryPoints: EntryPoint[] = [
  {
    // The CorpusService call `lore set` makes (adapters/cli/commands/set.ts -> corpusService.set).
    name: "CLI path (corpusService.set)",
    set: async (idOrSlug, patch) => {
      const r = await corpusService.set(idOrSlug, patch, { by: "cli-test" });
      return { refused: !r.ok, text: r.ok ? "" : JSON.stringify(r.error) };
    },
  },
  {
    name: "MCP lore_set handler",
    set: async (idOrSlug, patch) => {
      const server = new McpServer({ name: "t", version: "0" });
      registerTools(server, app);
      const tool = (server as unknown as McpServerInternal)._registeredTools["lore_set"];
      if (!tool) throw new Error("lore_set not registered");
      const res = await tool.handler({ id_or_slug: idOrSlug, ...patch, by: "mcp-test" }, {});
      const first = res.content[0];
      return { refused: res.isError === true, text: first && first.type === "text" ? first.text : "" };
    },
  },
  {
    name: "HTTP PATCH /api/docs/:id",
    set: async (idOrSlug, patch) => {
      const url = new URL(`http://localhost/api/docs/${idOrSlug}`);
      const req = new Request(url.toString(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const res = await handleApiRoute(req, url, app, TEST_ACTOR);
      if (res === null) throw new Error("route did not match");
      return { refused: res.status >= 400, text: await res.text() };
    },
  },
];

function writerOf(key: string): string {
  const entry = DEDICATED_EXTRA_KEYS.baseline?.find((e) => e.key === key);
  if (entry === undefined) throw new Error(`DEDICATED_EXTRA_KEYS.baseline has no ${key}`);
  return entry.writer;
}

describe.each(entryPoints)("QA-2 replace guard via $name", (entry) => {
  type Scenario = {
    label: string;
    target: "leaf" | "branch";
    key: string;
    build: (extra: Record<string, unknown>) => Record<string, unknown>;
  };

  const dropKey = (key: string) => (extra: Record<string, unknown>) => {
    const { [key]: _gone, ...rest } = extra;
    return rest;
  };

  const scenarios: Scenario[] = [
    {
      label: "reordered rules array (same members, swapped order)",
      target: "leaf",
      key: "rules",
      build: (e) => ({ ...e, rules: [...(e["rules"] as unknown[])].reverse() }),
    },
    {
      // FALSIFIER: key present, array replaced — a drop-only guard lets this through.
      label: "replaced rules array (present, different content)",
      target: "leaf",
      key: "rules",
      build: (e) => ({ ...e, rules: [rule("BR-1", "rewritten wholesale")] }),
    },
    { label: "dropped rules key", target: "leaf", key: "rules", build: dropKey("rules") },
    { label: "dropped depends_on key", target: "leaf", key: "depends_on", build: dropKey("depends_on") },
    {
      label: "replaced depends_on array",
      target: "leaf",
      key: "depends_on",
      build: (e) => ({ ...e, depends_on: ["BR-2"] }),
    },
    {
      label: "replaced label",
      target: "leaf",
      key: "label",
      build: (e) => ({ ...e, label: "Hijacked" }),
    },
    { label: "dropped label key", target: "leaf", key: "label", build: dropKey("label") },
    {
      label: "replaced node kind",
      target: "branch",
      key: "node",
      build: (e) => ({ ...e, node: "root" }),
    },
    {
      label: "reordered glossary array",
      target: "branch",
      key: "glossary",
      build: (e) => ({ ...e, glossary: [...(e["glossary"] as unknown[])].reverse() }),
    },
    {
      label: "replaced glossary array",
      target: "branch",
      key: "glossary",
      build: (e) => ({ ...e, glossary: [{ term: "Only", meaning: "one" }] }),
    },
    { label: "dropped glossary key", target: "branch", key: "glossary", build: dropKey("glossary") },
  ];

  it.each(scenarios)("refuses $label, naming the writer, leaving the doc untouched", async (sc) => {
    const tree = await makeTree();
    const doc = sc.target === "leaf" ? tree.leaf : tree.branch;
    const outcome = await entry.set(doc.id, { extra: sc.build(doc.extra) });
    expect(outcome.refused).toBe(true);
    expect(outcome.text).toContain(writerOf(sc.key));
    const after = await corpusService.get(doc.id);
    expect(after.ok && after.value.doc.version).toBe(doc.version);
    expect(after.ok && after.value.doc.extra).toEqual(doc.extra);
  });

  // REGRESSION control — passes against today's code too; it pins that the guard
  // compares values and does NOT over-refuse an extra that keeps guarded keys byte-equal.
  it("control: allows a set whose extra echoes every guarded key unchanged", async () => {
    const { leaf } = await makeTree();
    const outcome = await entry.set(leaf.id, { title: "Retitled", extra: { ...leaf.extra } });
    expect(outcome.refused).toBe(false);
  });
});
