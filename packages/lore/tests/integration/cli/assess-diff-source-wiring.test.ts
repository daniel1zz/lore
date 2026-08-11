/**
 * Integration oracle for AC-JV-5 (spec-judgment-surfaces-must-verify-before-they-certify-machine,
 * D6) — PRODUCTION WIRING of `diffSource` through BOTH the CLI (`commands/assess.ts`) and MCP
 * (`tools.ts`) `lore_assess` entry points into `AIProviderService.assessPlan`'s `opts.diffSource`.
 *
 * Why this file exists (measured 2026-08-11, immediately after AC-JV-1 earned an attested pass at
 * the SERVICE layer): both adapters already compute a `DiffSourceRecord` local and persist it on
 * `extra.diff_source`, but neither one passed it into `assessPlan`'s `opts.diffSource` — so every
 * live `lore assess` run resolved to `paths_verified.unchecked` regardless of how much diff
 * provenance the adapter itself had already gathered. AC-JV-1's own oracle
 * (`assess-path-verification.bun.test.ts`) exercises `AIProviderService.assessPlan` DIRECTLY with
 * an explicit `diffSource` opt — it cannot catch a caller that never supplies one at all. This file
 * drives the OUTERMOST surface instead: the real CLI subprocess (`bun run index.ts assess ...`) and
 * the real MCP tool handler (`registerTools` + `lore_assess`), never `assessPlan` directly.
 *
 * Interpreting "extra.diff_source ABSENT" (AC-JV-5 clause d): neither adapter can literally omit
 * the `extra.diff_source` key — `diffSource` is a non-optional local assigned on every branch of
 * both adapters' diff-acquisition step, always spread into the persisted `extra`. The closest real
 * production shape of "no diff source to check paths against" is the pre-existing "no discoverable
 * commits" outcome (`auto_derived`/`no_commits_found`, already covered as a BOUNDARY case in
 * `assess-ai.bun.test.ts` / `mcp-tools-assess.test.ts`) — `resolveAssessedCommit` treats it
 * identically to a genuinely absent diff source (same "no referent" `unchecked` branch — see that
 * function's own JSDoc), and the reverse-control tests below assert exactly that resolution.
 *
 * Test infra:
 *   - CLI (clauses a, c, d-CLI): a real subprocess (`bun run index.ts`) against a throwaway
 *     `mkdtemp` + `lore init` corpus with a REAL git repo, a fake AI-provider shell script (fixed
 *     JSON, same hermetic idiom as `assess-ai.bun.test.ts`), and a SEPARATE follow-up `lore get
 *     --json` subprocess call to read back PERSISTED state — never the assess command's own
 *     in-memory return value. `bun:sqlite` is unreachable from an in-process vitest test
 *     (packages/lore/src/store/CLAUDE.md), so the real CLI binary is the only way to exercise
 *     `commands/assess.ts` from this runner.
 *   - MCP (clauses b, c, d-MCP): `registerTools` against a real `InMemoryStore`/`CorpusService` +
 *     `InMemoryAIProvider`, the same precedent `mcp-tools-assess.test.ts` establishes — the SAME
 *     production `tools.ts` handler code runs. "Persisted state" is read back via a FRESH
 *     `corpusService.get(id)` call on the SAME store the tool wrote to, never the tool's own
 *     returned envelope.
 *   - Both surfaces use a REAL git repo (`git init` + real commits) so `resolveAssessedCommit` has
 *     a genuine commit to resolve and `git cat-file -e` has a genuine object graph to check
 *     against — never a stubbed git.
 *
 * Coverage (six-dimension, scoped to AC-JV-5 only — AC-JV-1/2/3 own their own oracle files):
 *   HAPPY:      (a) CLI --diff <range> resolving a real commit → paths_verified.checked > 0 in the
 *               PERSISTED doc; (b) MCP auto-derived commit → same, via the MCP surface
 *   STATE:      (c) a finding declaring a path absent at the resolved commit lands in
 *               unverifiable_findings[] in the PERSISTED doc, on BOTH surfaces
 *   REGRESSION: (d) reverse control — a run whose diff source resolves to "no referent" (no
 *               discoverable commits) still records paths_verified.unchecked, on BOTH surfaces —
 *               proving the wiring reports what resolveAssessedCommit actually decided rather than
 *               defaulting to "checked" now that a real diffSource typically flows through
 *   NEGATIVE:   n/a — AC-JV-5 is a wiring criterion, not a validation-path criterion (those are
 *               AC-ASSESS-*, covered elsewhere)
 *   BOUNDARY:   n/a here — see this task's own dispatch for the one-adapter-reverted manual probe
 *               (proving clause (b) is not carried by clause (a)), performed once during
 *               development, not encoded as a permanent test (reverting production wiring inside a
 *               test fixture would not be a meaningful regression oracle)
 *
 * @spec_ref AC-JV-5, spec-judgment-surfaces-must-verify-before-they-certify-machine D6
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveConfig } from "@lore/core/node";
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
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput } from "@lore/core";

// ─── Shared fixed judge response — one finding names a path PRESENT at the assessed
// commit, the other names a path that NEVER existed anywhere in the fixture repo. Used
// verbatim by both the CLI and MCP scenarios so the same assertions apply to both. ───

const PRESENT_PATH = "present.ts";
const ABSENT_PATH = "absent-path.ts";

const JUDGE_JSON_PRESENT_AND_ABSENT = JSON.stringify({
  verdict: "partially_met",
  overall_score: 60,
  ac_scores: [],
  gaps: [],
  recommendations: [],
  typed_gaps: [
    { dimension: "outcome", severity: "major", statement: `${PRESENT_PATH} needs work`, paths: [PRESENT_PATH] },
    { dimension: "outcome", severity: "major", statement: `${ABSENT_PATH} is missing`, paths: [ABSENT_PATH] },
  ],
});

interface PersistedAssessment {
  paths_verified?: { checked: number; unverifiable: number; unchecked: number };
  unverifiable_findings?: { failing_path: string; checked_against_commit: string }[];
}

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

// ═══════════════════════════════════════════════════════════════════════════════════
// CLI surface (clauses a, c, d-CLI) — real subprocess against a throwaway corpus
// ═══════════════════════════════════════════════════════════════════════════════════

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` — the real CLI binary path, no stubbing. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd, encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function gitInit(cwd: string): void {
  spawnSync("git", ["init", "-q"], { cwd, env: gitEnv });
}

function gitCommit(cwd: string, filename: string, content: string, message: string): void {
  writeFileSync(join(cwd, filename), content);
  spawnSync("git", ["add", filename], { cwd, env: gitEnv });
  spawnSync("git", ["commit", "-q", "-m", message], { cwd, env: gitEnv });
}

/** Fake "AI provider" shell script — ignores stdin, emits the fixed JSON above (hermetic idiom, same as assess-ai.bun.test.ts). */
function writeFixedJsonProviderScript(dir: string): string {
  const scriptPath = join(dir, "fake-ai-provider.sh");
  writeFileSync(scriptPath, `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${JUDGE_JSON_PRESENT_AND_ABSENT}\nJSONEOF\n`, {
    mode: 0o755,
  });
  return scriptPath;
}

function writeAiConfig(dir: string, command: string): void {
  saveConfig(dir, {
    project: { name: "assess-diff-source-wiring-test", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command, args: [], timeout_ms: 5000 } },
      templates: {},
      telemetry: false,
    },
  } as never);
}

function createPlan(cwd: string, title: string): string {
  const r = runLore(["create", "plan", "--title", title, "--no-ai", "--content", "body"], cwd);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract plan slug from: ${r.stdout}`);
  return slug;
}

function createTask(cwd: string, planSlug: string, title: string): string {
  const r = runLore(
    ["create", "task", "--title", title, "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
    cwd,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract task slug from: ${r.stdout}`);
  return slug;
}

/** Independently re-reads a doc's `extra` via a SEPARATE `lore get --json` subprocess — never the assess command's own return value. */
function getDocExtraJson(cwd: string, slugOrId: string): Record<string, unknown> {
  const r = runLore(["get", slugOrId, "--json"], cwd);
  if (r.exitCode !== 0) throw new Error(`lore get failed: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as { ok: boolean; data: { doc: { extra: Record<string, unknown> } } };
  return parsed.data.doc.extra;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-assess-diff-source-wiring-"));
  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("lore assess (CLI) — AC-JV-5(a)(c): diffSource wired, resolved commit, PERSISTED state", () => {
  it("with --diff resolving a real commit, the PERSISTED assessment records paths_verified.checked > 0 AND withdraws the absent-path finding into unverifiable_findings[]", () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, "seed.txt", "seed\n", "seed commit");
    gitCommit(tmpDir, PRESENT_PATH, "export const ok = true;\n", `add ${PRESENT_PATH}`);
    // ABSENT_PATH is deliberately never created/committed anywhere in this repo.

    const planSlug = createPlan(tmpDir, "CLI Diff Source Wiring Plan");
    createTask(tmpDir, planSlug, "Task One");

    const scriptPath = writeFixedJsonProviderScript(tmpDir);
    writeAiConfig(tmpDir, scriptPath);

    const result = runLore(["assess", planSlug, "--diff", "HEAD~1..HEAD", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; data: { assessment: { slug: string } } };
    expect(parsed.ok).toBe(true);

    // Independently re-read PERSISTED state — a SEPARATE subprocess call, never this
    // run's own --json return value.
    const extra = getDocExtraJson(tmpDir, parsed.data.assessment.slug);
    const assessment = extra["assessment"] as PersistedAssessment;

    expect(assessment.paths_verified?.checked).toBeGreaterThan(0);
    const absentEntry = (assessment.unverifiable_findings ?? []).find((f) => f.failing_path === ABSENT_PATH);
    expect(absentEntry).toBeDefined();
    expect(absentEntry?.checked_against_commit).toBe("HEAD");
  }, 20000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 4 spawn-helper call(s) in this body — gitInit + 2x
  // gitCommit + runLore(assess) (getDocExtraJson's internal runLore call is a
  // SEPARATE function, not counted here — see check-test-budgets.ts's "one level
  // deep" helper detection). Measured 1295-1884ms across runs in this session;
  // 20000ms gives >=10x headroom for a concurrent-worktree load spike.
});

describe("lore assess (CLI) — AC-JV-5(d): REVERSE CONTROL — diffSource resolves to no referent", () => {
  it("when auto-derivation finds no commits for this plan's tasks, the PERSISTED assessment records paths_verified.unchecked — never 'checked' — for declared paths", () => {
    gitInit(tmpDir);
    gitCommit(tmpDir, "unrelated.txt", "unrelated\n", "a commit naming no task at all");

    const planSlug = createPlan(tmpDir, "CLI No Referent Plan");
    createTask(tmpDir, planSlug, "Task One");

    const scriptPath = writeFixedJsonProviderScript(tmpDir);
    writeAiConfig(tmpDir, scriptPath);

    // Deliberately NO --diff/--diff-file — auto-derivation runs, finds zero commits
    // referencing this plan's task slug (sanity-checked below), which is the real
    // production shape of "no diff source to check paths against" (see this file's
    // header for why this stands in for a literally-absent extra.diff_source).
    const result = runLore(["assess", planSlug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data: { assessment: { slug: string }; diff_source: { mode: string; status?: string } };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.diff_source.mode).toBe("auto_derived");
    expect(parsed.data.diff_source.status).toBe("no_commits_found"); // sanity: genuinely no referent

    const extra = getDocExtraJson(tmpDir, parsed.data.assessment.slug);
    const assessment = extra["assessment"] as PersistedAssessment;

    // Both declared paths (PRESENT_PATH + ABSENT_PATH) come back UNCHECKED — the wiring
    // reports what resolveAssessedCommit actually decided, never a default that happens
    // to look like "checked".
    expect(assessment.paths_verified).toEqual({ checked: 0, unverifiable: 0, unchecked: 2 });
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 3 spawn-helper call(s) in this body — gitInit + gitCommit +
  // runLore(assess). Measured 1077-1216ms across runs in this session; 15000ms gives
  // >=12x headroom for a concurrent-worktree load spike.
});

// ═══════════════════════════════════════════════════════════════════════════════════
// MCP surface (clauses b, c, d-MCP) — registerTools against a real InMemoryStore,
// exactly the precedent mcp-tools-assess.test.ts establishes.
// ═══════════════════════════════════════════════════════════════════════════════════

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;
let aiProvider: InMemoryAIProvider;
let app: App;
let server: McpServer;

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store);
  aiProvider = new InMemoryAIProvider("in-memory", { kind: "ok", content: JUDGE_JSON_PRESENT_AND_ABSENT });
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
    versionService: new VersionService(store),
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
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: true, source: "env" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

type McpServerInternal = {
  _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }>;
};

function getToolHandler(srv: McpServer, name: string): (args: Record<string, unknown>) => Promise<CallToolResult> {
  const internal = srv as unknown as McpServerInternal;
  const tool = internal._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return (args) => tool.handler(args, {} as unknown);
}

function parseResult(result: CallToolResult): unknown {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text);
}

async function createPlanWithNamedTasks(taskTitles: string[]): Promise<{ planId: string; taskSlugs: string[] }> {
  const planResult = await corpusService.create({
    type: "plan",
    title: "MCP Diff Source Wiring Plan",
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

describe("lore_assess (MCP) — AC-JV-5(b)(c): diffSource wired, resolved commit, PERSISTED state", () => {
  let gitTmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);

    gitTmpDir = mkdtempSync(join(tmpdir(), "lore-mcp-assess-diff-source-wiring-"));
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

  it("with an auto-derived resolved commit, the PERSISTED assessment records paths_verified.checked > 0 AND withdraws the absent-path finding into unverifiable_findings[]", async () => {
    const { planId, taskSlugs } = await createPlanWithNamedTasks(["MCP Wiring Task Alpha"]);
    writeFileSync(join(gitTmpDir, "seed.txt"), "seed\n");
    spawnSync("git", ["add", "seed.txt"], { cwd: gitTmpDir, env: gitEnv });
    spawnSync("git", ["commit", "-q", "-m", "seed commit"], { cwd: gitTmpDir, env: gitEnv });
    writeFileSync(join(gitTmpDir, PRESENT_PATH), "export const ok = true;\n");
    spawnSync("git", ["add", PRESENT_PATH], { cwd: gitTmpDir, env: gitEnv });
    spawnSync("git", ["commit", "-q", "-m", `implements ${taskSlugs[0]}`], { cwd: gitTmpDir, env: gitEnv });
    // ABSENT_PATH is deliberately never created/committed anywhere in this repo.

    const call = getToolHandler(server, "lore_assess");
    const result = await call({ plan_id_or_slug: planId, ai: true }); // NOTE: no diff_text — auto-derivation
    expect(result.isError).toBeFalsy();

    const data = parseResult(result) as { assessment: { id: string }; diff_source: { mode: string; status?: string } };
    expect(data.diff_source.mode).toBe("auto_derived");
    expect(data.diff_source.status).toBe("derived"); // sanity: a real commit was found

    // Independently re-read PERSISTED state via a FRESH corpusService.get(id) call on
    // the SAME store the tool wrote to — never the tool's own returned envelope.
    const persisted = await corpusService.get(data.assessment.id);
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) return;
    const assessment = persisted.value.doc.extra["assessment"] as PersistedAssessment;

    expect(assessment.paths_verified?.checked).toBeGreaterThan(0);
    const absentEntry = (assessment.unverifiable_findings ?? []).find((f) => f.failing_path === ABSENT_PATH);
    expect(absentEntry).toBeDefined();
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 4 direct spawnSync call(s) in this body (2x git add + 2x
  // git commit). Measured 286-324ms across runs in this session; 15000ms gives ample
  // headroom for a concurrent-worktree load spike, matching mcp-tools-assess.test.ts's
  // own git-fixture describe blocks' budget for a comparably-shaped fixture.
});

describe("lore_assess (MCP) — AC-JV-5(d): REVERSE CONTROL — diffSource resolves to no referent", () => {
  let gitTmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    app = makeApp();
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app);

    gitTmpDir = mkdtempSync(join(tmpdir(), "lore-mcp-assess-diff-source-wiring-reverse-"));
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

  it("no discoverable commits → the PERSISTED assessment records paths_verified.unchecked — never 'checked'", async () => {
    const { planId } = await createPlanWithNamedTasks(["MCP No Referent Task"]);
    writeFileSync(join(gitTmpDir, "unrelated.txt"), "unrelated\n");
    spawnSync("git", ["add", "unrelated.txt"], { cwd: gitTmpDir, env: gitEnv });
    spawnSync("git", ["commit", "-q", "-m", "a commit naming no task at all"], { cwd: gitTmpDir, env: gitEnv });

    const call = getToolHandler(server, "lore_assess");
    const result = await call({ plan_id_or_slug: planId, ai: true }); // NOTE: no diff_text
    expect(result.isError).toBeFalsy();

    const data = parseResult(result) as { assessment: { id: string }; diff_source: { mode: string; status?: string } };
    expect(data.diff_source.mode).toBe("auto_derived");
    expect(data.diff_source.status).toBe("no_commits_found"); // sanity: genuinely no referent

    const persisted = await corpusService.get(data.assessment.id);
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) return;
    const assessment = persisted.value.doc.extra["assessment"] as PersistedAssessment;

    expect(assessment.paths_verified).toEqual({ checked: 0, unverifiable: 0, unchecked: 2 });
  });
});
