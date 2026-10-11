/**
 * Unit tests for the SPEC-026 lore_assess MCP tool.
 *
 * Scope: translation-only (args → getPlanBundle/assessPlan/create/link → MCP envelope
 * shape). The corrective-retry protocol and telemetry-exactly-once are exhaustively
 * covered at the service layer (ai-provider-service-assess.test.ts) — this file verifies
 * the MCP adapter wiring, envelope shape, and the AI-brake/contradiction gates that live
 * in the tool handler itself, per the mcp-tools-task-workflow.test.ts precedent of "do not
 * re-test business rules at three layers".
 *
 * Strategy mirrors mcp-tools-task-workflow.test.ts: register real tools against a
 * McpServer, extract handlers from the internal _registeredTools map, invoke directly.
 * AIProviderService is real, wired with InMemoryAIProvider (SPEC-026 D9 sequence mode
 * available when a test needs it).
 *
 * Coverage:
 *   HAPPY:      lore_assess round-trip creates a knowledge doc (sub_type="assessment"),
 *               links it to the plan via "informs", and returns { assessment, result }
 *   NEGATIVE:   zero-task plan → isError, VALIDATION_ERROR, before any AI call;
 *               ai: false → isError, contradiction message (AC-ASSESS-9 mirror)
 *   BOUNDARY:   mcp surface braked by an EXPLICIT config override → isError, requires ai:true;
 *               the built-in mcp AI-off default does NOT brake assess (D5)
 *   ERROR:      provider error passes through as isError with the AI_PROVIDER_ERROR code
 *   STATE:      the informs link is queryable after a successful assess (doc graph updated)
 *   REGRESSION: sub_type/knowledge doc shape matches what CLI assess.ts produces (parity)
 *
 * Also covers (task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be):
 * when `diff_text` is OMITTED, `lore_assess` now auto-derives the plan's own commit set
 * from real git history (mirrors the CLI's assess.ts) instead of running with no diff at
 * all — a dedicated describe block below chdir's into a throwaway `git init` fixture
 * (real subprocess git, same idiom as `assess-ai.bun.test.ts`) for PRIMARY ORACLE
 * (interleaved foreign history excluded) and BOUNDARY (no discoverable commits → named
 * outcome) coverage.
 *
 * @spec_ref AC-ASSESS-1, AC-ASSESS-8, AC-ASSESS-9, AC-ASSESS-10, task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AiDefaultSource, CreateDocInput, DocRecord, LoreError } from "@lore/core";

// ─── Test Infrastructure (mirrors mcp-tools-task-workflow.test.ts) ────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let aiProvider: InMemoryAIProvider;

const VALID_JSON = JSON.stringify({
  verdict: "met",
  overall_score: 88,
  ac_scores: [{ ac_id: "AC-ASSESS-1", score: 88, reasoning: "Solid evidence trail.", evidence_refs: [] }],
  gaps: [],
  recommendations: [],
});

function makeApp(opts: {
  resolveAiDefault?: (explicit?: boolean) => { ai: boolean; source: AiDefaultSource };
} = {}): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store, new RecordLockService(store));
  aiProvider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
  const providers = new Map([["in-memory", aiProvider]]) as unknown as ReadonlyMap<string, import("@lore/core").AIProvider>;
  const aiProviderService = new AIProviderService(
    providers,
    "in-memory",
    {},
    new NoOpTelemetry(),
    false,
    8000,
    { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 },
  );

  return {
    corpusService,
    reviewService: new ReviewService(store),
    versionService: new VersionService(store, new RecordLockService(store)),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService,
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 }),
    // reason: SPEC-032 §3.4 — test does not exercise spec-kind audit; null-cast per
    // established pattern (see phaseService above) for satisfying newly-required App fields.
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    callerSurface: "mcp" as const,
    resolveAiDefault: opts.resolveAiDefault ?? ((_explicit?: boolean) => ({ ai: false, source: "env" as const })),
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

// ─── Fixture helpers ──────────────────────────────────────────────────────────

async function createPlanWithTask(): Promise<{ planId: string; taskId: string }> {
  const planResult = await corpusService.create({ type: "plan", title: "Assess Plan", content: "goals" } as CreateDocInput);
  if (!planResult.ok) throw new Error(`Failed to create plan: ${JSON.stringify(planResult.error)}`);
  const taskResult = await corpusService.create({
    type: "task",
    title: "Assess Task",
    parent_id: planResult.value.id,
    content: "body",
    extra: { plan_id: planResult.value.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error(`Failed to create task: ${JSON.stringify(taskResult.error)}`);
  return { planId: planResult.value.id, taskId: taskResult.value.id };
}

async function createEmptyPlan(): Promise<string> {
  const planResult = await corpusService.create({ type: "plan", title: "Empty Assess Plan", content: "goals" } as CreateDocInput);
  if (!planResult.ok) throw new Error(`Failed to create plan: ${JSON.stringify(planResult.error)}`);
  return planResult.value.id;
}

/**
 * Creates a plan with N tasks named `taskTitles`, returning each task's REAL slug — the
 * git-fixture-driven derivation tests below must reference the actual generated slug,
 * never a guessed one (`deriveCommitSetForPlan` matches on the corpus's own `task.slug`).
 */
async function createPlanWithNamedTasks(taskTitles: string[]): Promise<{ planId: string; taskSlugs: string[] }> {
  const planResult = await corpusService.create({
    type: "plan",
    title: "MCP Assess Derivation Plan",
    content: "goals",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error(`Failed to create plan: ${JSON.stringify(planResult.error)}`);
  const taskSlugs: string[] = [];
  for (const title of taskTitles) {
    const taskResult = await corpusService.create({
      type: "task",
      title,
      parent_id: planResult.value.id,
      content: "body",
      extra: { plan_id: planResult.value.id },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error(`Failed to create task: ${JSON.stringify(taskResult.error)}`);
    taskSlugs.push(taskResult.value.slug);
  }
  return { planId: planResult.value.id, taskSlugs };
}

// ─── Test Setup ────────────────────────────────────────────────────────────────

let app: App;
let server: McpServer;

function setup(opts: Parameters<typeof makeApp>[0] = {}) {
  app = makeApp(opts);
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app);
}

beforeEach(() => {
  setup();
});

// ─── lore_assess — HAPPY ───────────────────────────────────────────────────────

describe("lore_assess — HAPPY (AC-ASSESS-1, AC-ASSESS-10)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  it("creates a knowledge doc with sub_type='assessment' and links it to the plan via informs", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBeFalsy();

    const data = parseResult(result) as { assessment: DocRecord; result: { verdict: string; overall_score: number } };
    expect(data.assessment.type).toBe("knowledge");
    expect(data.assessment.extra["sub_type"]).toBe("assessment");
    expect(data.assessment.parent_id).toBe(planId);
    expect(data.result.verdict).toBe("met");
    expect(data.result.overall_score).toBe(88);
  });

  it("the returned result envelope's judgment.provider matches the active provider name", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    const data = parseResult(result) as { result: { judgment: { provider: string } } };
    expect(data.result.judgment.provider).toBe("in-memory");
  });

  it("mcp's built-in AI-off default does NOT brake assess when no explicit config override is set (D5)", async () => {
    // Default makeApp() resolveAiDefault returns { ai: false, source: "env" } — this is
    // the BUILT-IN per-surface default, not an explicit config override. D5 says this
    // must NOT brake assess even though ai is omitted (no explicit ai:true needed).
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId }); // no `ai` field at all
    expect(result.isError).toBeFalsy();
  });
});

// ─── lore_assess — STATE ────────────────────────────────────────────────────

describe("lore_assess — STATE (informs link persisted, AC-ASSESS-1)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  it("after a successful assess, the plan's incoming 'informs' link resolves to the new assessment doc", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    const data = parseResult(result) as { assessment: DocRecord };

    const linksResult = await store.findLinks(planId, "in");
    expect(linksResult.ok).toBe(true);
    if (!linksResult.ok) return;
    const informsLink = linksResult.value.find((l) => l.link_type === "informs" && l.from_id === data.assessment.id);
    expect(informsLink).toBeDefined();
  });
});

// ─── lore_assess — NEGATIVE ─────────────────────────────────────────────────

describe("lore_assess — NEGATIVE (AC-ASSESS-8, AC-ASSESS-9 mirror)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  it("a plan with zero child tasks → isError, VALIDATION_ERROR, and no AI call is made", async () => {
    const planId = await createEmptyPlan();
    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("VALIDATION_ERROR");
    // The provider must never have been invoked — the zero-task gate runs BEFORE AI.
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("ai: false is always a contradiction (assess has no non-AI mode) → isError, AI_PROVIDER_ERROR", async () => {
    const { planId } = await createPlanWithTask();
    const result = await call()({ plan_id_or_slug: planId, ai: false });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("a nonexistent plan id → isError, DOC_NOT_FOUND (via getPlanBundle → resolve)", async () => {
    const result = await call()({ plan_id_or_slug: "plan-does-not-exist-xyz", ai: true });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── lore_assess — BOUNDARY (explicit config brake) ─────────────────────────

describe("lore_assess — BOUNDARY (explicit mcp config brake, SPEC-026 D5)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  it("an EXPLICIT config override (source='config', ai=false) DOES brake assess, requiring ai:true", async () => {
    setup({ resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "config" as const }) });
    const { planId } = await createPlanWithTask();

    const result = await call()({ plan_id_or_slug: planId }); // no explicit ai override
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(aiProvider.calls).toHaveLength(0);
  });

  it("passing ai: true overrides the explicit config brake", async () => {
    setup({ resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "config" as const }) });
    const { planId } = await createPlanWithTask();

    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBeFalsy();
  });
});

// ─── lore_assess — ERROR (provider failure passthrough) ─────────────────────

describe("lore_assess — ERROR (provider failure passthrough)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  it("a provider error propagates as isError with code AI_PROVIDER_ERROR, and no doc is created", async () => {
    const { planId } = await createPlanWithTask();
    aiProvider.setMode({ kind: "err", error: { code: "AI_PROVIDER_ERROR", provider: "in-memory", message: "simulated failure" } });

    const beforeResult = await store.findMany({});
    if (!beforeResult.ok) throw new Error("findMany failed");
    const beforeCount = beforeResult.value.length;

    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.code).toBe("AI_PROVIDER_ERROR");

    const afterResult = await store.findMany({});
    if (!afterResult.ok) throw new Error("findMany failed");
    expect(afterResult.value.length).toBe(beforeCount);
  });
});

// ─── lore_assess — auto-derived commit set (task-lore-assess-asks-the-caller-for-a-
// git-range-that-cannot-be) ──────────────────────────────────────────────────────
//
// When `diff_text` is omitted, lore_assess now derives the plan's own commit set from
// REAL git history (mirrors the CLI's assess.ts) instead of running with no diff. These
// tests chdir into a throwaway `git init` fixture so `process.cwd()`-based derivation
// has real, controlled history to work against — restored in afterEach so it never
// leaks into sibling tests in this file (which run against the real project repo's cwd
// and rely on derivation harmlessly finding nothing there).

describe("lore_assess — auto-derived commit set: PRIMARY ORACLE + BOUNDARY", () => {
  const call = () => getToolHandler(server, "lore_assess");

  let gitTmpDir: string;
  let originalCwd: string;
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Tester",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "Tester",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };

  beforeEach(() => {
    gitTmpDir = mkdtempSync(join(tmpdir(), "lore-mcp-assess-derivation-test-"));
    spawnSync("git", ["init", "-q"], { cwd: gitTmpDir, env: gitEnv });
    originalCwd = process.cwd();
    process.chdir(gitTmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try {
      rmSync(gitTmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  function gitCommit(filename: string, content: string, message: string) {
    writeFileSync(join(gitTmpDir, filename), content);
    spawnSync("git", ["add", filename], { cwd: gitTmpDir, env: gitEnv });
    spawnSync("git", ["commit", "-q", "-m", message], { cwd: gitTmpDir, env: gitEnv });
  }

  it("PRIMARY ORACLE: excludes every interleaved foreign commit from the prompt sent to the judge", async () => {
    const { planId, taskSlugs } = await createPlanWithNamedTasks(["MCP Own Task Alpha", "MCP Own Task Beta"]);
    gitCommit("seed.txt", "seed\n", "seed commit");
    gitCommit("foreign1.txt", "MCP_FOREIGN_ALPHA\n", "unrelated foreign change alpha");
    gitCommit("own-a.txt", "MCP_OWN_A\n", `implements ${taskSlugs[0]}`);
    gitCommit("foreign2.txt", "MCP_FOREIGN_BETA\n", "unrelated foreign change beta");
    gitCommit("own-b.txt", "MCP_OWN_B\n", `implements ${taskSlugs[1]}`);
    gitCommit("foreign3.txt", "MCP_FOREIGN_GAMMA\n", "unrelated foreign change gamma");

    const result = await call()({ plan_id_or_slug: planId, ai: true }); // NOTE: no diff_text
    expect(result.isError).toBeFalsy();

    expect(aiProvider.calls).toHaveLength(1);
    const prompt = aiProvider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("MCP_OWN_A");
    expect(prompt).toContain("MCP_OWN_B");
    expect(prompt).not.toContain("MCP_FOREIGN_ALPHA");
    expect(prompt).not.toContain("MCP_FOREIGN_BETA");
    expect(prompt).not.toContain("MCP_FOREIGN_GAMMA");

    const data = parseResult(result) as { assessment: DocRecord; diff_source: { mode: string; status?: string; commits?: unknown[] } };
    expect(data.diff_source.mode).toBe("auto_derived");
    expect(data.diff_source.status).toBe("derived");
    expect(data.diff_source.commits).toHaveLength(2);
    expect(data.assessment.extra["diff_source"]).toEqual(data.diff_source);
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 6 direct `spawnSync`/`gitCommit` calls in this body
  // (`gitCommit` is itself a spawn helper — its own body directly calls
  // `spawnSync` twice — so calling it 6 times counts as 6 spawn-helper
  // invocations for this oracle). Measured 380-708ms in isolation across 2
  // runs; 15000ms gives >=21x headroom for a concurrent-worktree load spike.

  it("BOUNDARY: no commit anywhere references either task slug — a loud named outcome, never a silent empty diff", async () => {
    const { planId } = await createPlanWithNamedTasks(["MCP Unreferenced Task One", "MCP Unreferenced Task Two"]);
    gitCommit("unrelated.txt", "unrelated\n", "a commit naming neither task");

    const result = await call()({ plan_id_or_slug: planId, ai: true });
    expect(result.isError).toBeFalsy();

    expect(aiProvider.calls).toHaveLength(1);
    expect(aiProvider.calls[0]?.prompt ?? "").not.toContain("diff --git");

    const data = parseResult(result) as { diff_source: { mode: string; status?: string; tasks_without_commits?: string[] } };
    expect(data.diff_source.mode).toBe("auto_derived");
    expect(data.diff_source.status).toBe("no_commits_found");
    expect(data.diff_source.tasks_without_commits).toHaveLength(2);
  });
});

// ─── lore_assess — commit-derivation convention-mismatch suppression
// (task-the-mcp-assess-adapter-still-calls-derivecommitsetforplan) ───────────────
//
// The CLI path (commands/assess.ts) computes `allTasksArchived` from the already-loaded
// bundle, passes it to `deriveCommitSetForPlan`, and threads the resulting
// `commitDerivationUnverifiable` flag into `assessPlan` so the SERVICE layer forbids an
// absence-scored `scope_fidelity` from ever publishing when every task in the plan is
// already archived (merged work by definition) yet zero commits reference any task
// slug — a commit-message CONVENTION MISMATCH, not genuine absence
// (task-lore-assess-derives-a-plan-s-commits-by-grepping-task). `tools.ts` previously
// called `deriveCommitSetForPlan` with the OLD 2-arg shape, so this suppression never
// reached the MCP surface: the SAME fixture below used to report `"no_commits_found"`
// and publish an absence-scored `scope_fidelity` — the false-major-finding route this
// describe block proves is now closed. Real `git init` fixture (same idiom as the block
// above), CONVENTIONALLY-worded commits deliberately referencing NEITHER task's slug
// (mirrors assess-commit-derivation.test.ts's own RED-FIRST fixture), and a scripted
// judge response that scores `scope_fidelity` absence-based — exactly the shape that
// manufactures a false major finding pre-fix.
describe("lore_assess — commit-derivation convention-mismatch suppression (task-the-mcp-assess-adapter-still-calls-derivecommitsetforplan)", () => {
  const call = () => getToolHandler(server, "lore_assess");

  let gitTmpDir: string;
  let originalCwd: string;
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Tester",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "Tester",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };

  beforeEach(() => {
    gitTmpDir = mkdtempSync(join(tmpdir(), "lore-mcp-assess-convention-mismatch-test-"));
    spawnSync("git", ["init", "-q"], { cwd: gitTmpDir, env: gitEnv });
    originalCwd = process.cwd();
    process.chdir(gitTmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try {
      rmSync(gitTmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  function gitCommit(filename: string, content: string, message: string) {
    writeFileSync(join(gitTmpDir, filename), content);
    spawnSync("git", ["add", filename], { cwd: gitTmpDir, env: gitEnv });
    spawnSync("git", ["commit", "-q", "-m", message], { cwd: gitTmpDir, env: gitEnv });
  }

  it("an all-archived plan whose commits carry conventional (slug-less) messages reports 'unverifiable_convention_mismatch' (never 'no_commits_found'), and scope_fidelity is absent from dimension_scores with a NOT SCORED unverifiable[] entry", async () => {
    const { planId } = await createPlanWithNamedTasks(["MCP Archived Task Alpha"]);
    // Conventional Commits messages — deliberately reference NEITHER task's slug,
    // mirroring the measured defect (fix(evidence): ... never mentions the task slug it
    // closes).
    gitCommit("a.txt", "content-a\n", "fix(evidence): self-reported fail must carry a non-empty output_tail");
    gitCommit("b.txt", "content-b\n", "feat(assess): add scope mismatch warning");

    // Every task in this plan is already archived — merged work exists BY DEFINITION
    // (VALID_TRANSITIONS, @lore/core) — so a zero-match derivation against the fixture
    // above is a CONTRADICTION, not a legitimate absence.
    const tasksResult = await store.findMany({ parent_id: planId, type: "task" });
    if (!tasksResult.ok) throw new Error("findMany failed");
    for (const task of tasksResult.value) {
      const setResult = await corpusService.set(task.id, { status: "archived" });
      if (!setResult.ok) throw new Error(`Failed to archive task: ${JSON.stringify(setResult.error)}`);
    }

    // Scripted judge response scores scope_fidelity absence-based — exactly the shape
    // that (pre-fix) manufactures a false major finding once diff_available=false.
    aiProvider.setMode({
      kind: "ok",
      content: JSON.stringify({
        verdict: "partially_met",
        overall_score: 50,
        ac_scores: [],
        gaps: [],
        recommendations: [],
        dimension_scores: {
          scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
        },
      }),
    });

    const result = await call()({ plan_id_or_slug: planId, ai: true }); // NOTE: no diff_text
    expect(result.isError).toBeFalsy();

    const data = parseResult(result) as {
      result: {
        dimension_scores?: Record<string, unknown>;
        unverifiable?: { material: string; reason: string }[];
      };
      diff_source: { mode: string; status?: string };
    };

    // The distinct, named contradiction status — never the shared "no_commits_found" a
    // genuinely commit-less plan gets (ADR three-question review Q2: an empty result and
    // a clean result must not be the same value).
    expect(data.diff_source.mode).toBe("auto_derived");
    expect(data.diff_source.status).toBe("unverifiable_convention_mismatch");
    expect(data.diff_source.status).not.toBe("no_commits_found");

    // scope_fidelity forcibly removed from the persisted dimension_scores, regardless of
    // what the judge itself reported, with an explicit "not scored" unverifiable[] entry.
    expect(data.result.dimension_scores?.["scope_fidelity"]).toBeUndefined();
    const scopeEntry = (data.result.unverifiable ?? []).find((u) =>
      u.material.toLowerCase().includes("scope_fidelity"),
    );
    expect(scopeEntry).toBeDefined();
    expect(scopeEntry?.reason.toLowerCase()).toContain("not scored");
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 4 direct `spawnSync`/`gitCommit` calls in this body
  // (`gitCommit` is itself a spawn helper — its own body directly calls `spawnSync`
  // twice — so calling it twice counts as 2 spawn-helper invocations, plus the fixture's
  // own `git init` in beforeEach). Comparable to this file's other git-fixture describe
  // block (380-708ms measured); 15000ms gives ample headroom for a concurrent-worktree
  // load spike.
});
