/**
 * MCP `lore_report_issue` files under a GitHub-shaped `feedback.upstream`.
 *
 * @spec_ref spec-a-github-filed-defect-must-be-claimable-one-ingest-seam AC-GR-11
 *
 * Prior to this file, `adapters/mcp/tools.ts`'s `lore_report_issue` handler
 * refused EVERY GitHub-shaped `feedback.upstream` with a `VALIDATION_ERROR`
 * naming a phase that spec never declared (measured at
 * `tools.ts:2921-2930` pre-fix). That refusal is now deleted: the handler
 * wires onto the SAME `fileGithubIssue` (`report-issue-wiring.ts`) the CLI's
 * `commands/report-issue.ts` calls — one call site, never a second filing
 * path (this task's own bundle) — and the success payload now NAMES the
 * created corpus task's slug (D8/AC-GR-9's mint already lands inside
 * `fileGithubIssue`; this handler locates it afterward via the pure,
 * store-free `readGithubIssueRef`).
 *
 * ⛔ Per this task's own Stated Limit: the handler is obtained by
 * IMPORTING `registerTools` (`adapters/mcp/tools.ts:1434`) and registering
 * against a REAL `McpServer` — never a handler reconstructed from the same
 * module by any other means — and driven directly (no spawned MCP stdio
 * server; this repo has no such harness).
 *
 * `GitHubIntakePort` is mocked WHOLESALE (mirrors
 * `github-filing-split-write.test.ts`'s own precedent for testing
 * `fileGithubIssue` without a real `gh` subprocess) — this file's scope is
 * the MCP HANDLER's wiring (payload shape, task-slug lookup, the
 * severity/category precondition), not `GitHubIntakePort`'s own
 * `verifyTarget`/`searchDuplicates`/`fileIssue` internals (covered
 * elsewhere: `github-intake-port-wiring.test.ts`,
 * `tests/integration/cli/github-intake-reach.bun.test.ts`) nor
 * `fileGithubIssue`'s own retry/split-write semantics (covered by
 * `github-filing-split-write.test.ts`). `GhRunner`/`createNodeGhExecFile`
 * are constructed for real inside `fileGithubIssue` but never invoked (the
 * mocked port's constructor ignores its `runner` arg) — no real `gh`
 * subprocess ever spawns from this file.
 *
 * `resolveConsumerCorpusRoot()` walks up from `process.cwd()` looking for a
 * real `.lore/lore.db` file (`findLoreDbPath`) — this file `chdir`s into a
 * throwaway `mkdtemp` directory carrying a placeholder `.lore/lore.db` for
 * the duration of each test (restored in `afterEach`), so the receipt log
 * `fileGithubIssue` reads/writes never touches this repo's own live
 * `.lore/`.
 *
 * Runner: vitest (no `bun:sqlite` — `InMemoryStore` backs every service
 * here, mirroring `mcp-issue-shape-message-ssot.test.ts`'s own `makeApp()`).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 */

import { liveInvocation, actedStore } from "../../live-invocation.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, err, LoreConfigSchema, NoOpTelemetry } from "@lore/core";
import type { LoreConfig } from "@lore/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { githubIssueTaskSlug } from "../../../src/service/issue-task-shaping.js";
import { readGithubIssueRef } from "../../../src/service/resolution-projector.js";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

// ─── GitHubIntakePort mocked wholesale — see this file's own header ────────

const verifyTargetMock = vi.fn();
const searchDuplicatesMock = vi.fn();
const fileIssueMock = vi.fn();

vi.mock("../../../src/service/github-intake-port.js", () => ({
  GitHubIntakePort: vi.fn().mockImplementation(() => ({
    verifyTarget: verifyTargetMock,
    searchDuplicates: searchDuplicatesMock,
    fileIssue: fileIssueMock,
  })),
}));

// ─── Test infrastructure (mirrors mcp-issue-shape-message-ssot.test.ts) ─────

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
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
    callerSurface: "cli" as const,
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

function parseResult(result: CallToolResult): Record<string, unknown> {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text) as Record<string, unknown>;
}

function makeConfig(upstream: Record<string, unknown>): LoreConfig {
  return LoreConfigSchema.parse({
    project: { name: "test", author: "test" },
    feedback: { upstream },
  }) as LoreConfig;
}

const GITHUB_UPSTREAM = { repo: "acme/widget" };
const REPO_ID = 555;

/** Arguments `LoreReportIssueSchema` requires, GitHub path (severity/category included). */
const REPORT_ISSUE_ARGS = {
  by: "agent:github-filing-probe",
  title: "AC-GR-11 probe report",
  description: "probing the MCP GitHub filing path",
  expected: "a claimable corpus task",
  actual: "under test",
  severity: "high" as const,
  category: "regression",
};

// ─── Fixture lifecycle ───────────────────────────────────────────────────────

let originalCwd: string;
let tmpDir: string;
let app: App;
let server: McpServer;

beforeEach(async () => {
  originalCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), "lore-mcp-github-filing-test-"));
  // Placeholder `.lore/lore.db` — `resolveConsumerCorpusRoot()` only needs
  // this file to EXIST (findLoreDbPath probes existence, never opens it) so
  // the receipt log this handler reads/writes lands in THIS throwaway dir,
  // never the real repo's own `.lore/`.
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  writeFileSync(join(tmpDir, ".lore", "lore.db"), "");
  process.chdir(tmpDir);

  verifyTargetMock.mockReset().mockResolvedValue(ok({ login: "acme", id: REPO_ID }));
  searchDuplicatesMock.mockReset().mockResolvedValue(ok([]));
  fileIssueMock.mockReset().mockResolvedValue(
    ok({ number: 42, url: "https://github.com/acme/widget/issues/42", idempotencyKey: "01FILEDKEYAAAAAAAAAAAAAAA" }),
  );

  app = makeApp();
  // `fileGithubIssue` requires a root PRD (`resolveLocalRootPrd`) — a filed
  // defect is minted adhoc, parented onto the corpus's first PRD.
  const prdResult = await app.corpusService.create(
    { type: "prd", title: "Root PRD", content: "root" },
    { by: "test-setup" },
  );
  if (!prdResult.ok) throw new Error(`fixture setup failed: ${prdResult.error.code}`);

  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app, () => makeConfig(GITHUB_UPSTREAM), liveInvocation());
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-GR-11 — the registered handler files under GitHub and names the task
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GR-11: lore_report_issue files under a GitHub-shaped feedback.upstream", () => {
  it("HAPPY: the success payload names the created corpus task's slug", async () => {
    const call = getToolHandler(server, "lore_report_issue");

    const result = await call(REPORT_ISSUE_ARGS);

    const payload = parseResult(result);
    // Falsifier (this task's own instruction): restoring the deleted
    // isGithubUpstreamCfg refusal branch reddens EXACTLY this assertion —
    // the payload degrades to a VALIDATION_ERROR envelope with no
    // `task_slug` key at all (checked BEFORE `isError`, deliberately, so
    // the failure lands squarely on "the payload names the task slug"
    // rather than on the more generic isError check below).
    expect(payload["task_slug"]).toBe(githubIssueTaskSlug(REPO_ID, 42));
    expect(result.isError).toBeUndefined();

    // The slug must resolve to a REAL corpus task, not a fabricated string.
    const taskLookup = await app.corpusService.listFull({ type: "task" });
    if (!taskLookup.ok) throw new Error("listFull failed");
    const created = taskLookup.value.docs.find((d) => d.slug === payload["task_slug"]);
    expect(created).toBeDefined();
    expect(readGithubIssueRef(created?.extra)).toEqual({ repo: "acme/widget", issueNumber: 42, repo_id: REPO_ID });
  });

  it("REGRESSION: the pre-existing GithubReportResult fields survive alongside task_slug", async () => {
    const call = getToolHandler(server, "lore_report_issue");
    const result = await call(REPORT_ISSUE_ARGS);

    const payload = parseResult(result);
    expect(payload).toMatchObject({
      number: 42,
      url: "https://github.com/acme/widget/issues/42",
      possible_duplicates: [],
      dedup_degraded: false,
      retried: false,
    });
  });

  it("STATE: filing mints exactly one new adhoc corpus task", async () => {
    const before = await app.corpusService.listFull({ type: "task" });
    if (!before.ok) throw new Error("listFull failed");
    expect(before.value.total).toBe(0);

    const call = getToolHandler(server, "lore_report_issue");
    await call(REPORT_ISSUE_ARGS);

    const after = await app.corpusService.listFull({ type: "task" });
    if (!after.ok) throw new Error("listFull failed");
    expect(after.value.total).toBe(1);
    expect(after.value.docs[0]?.extra).toMatchObject({ adhoc: true });
  });

  it("BOUNDARY: the payload names the JUST-FILED issue's task, not an unrelated pre-existing issue task", async () => {
    // Pre-seed a corpus task for a DIFFERENT issue number, same repo — the
    // lookup must discriminate by (repo, issueNumber), never just "the
    // first issue-report task found".
    verifyTargetMock.mockResolvedValueOnce(ok({ login: "acme", id: REPO_ID }));
    searchDuplicatesMock.mockResolvedValueOnce(ok([]));
    fileIssueMock.mockResolvedValueOnce(
      ok({ number: 7, url: "https://github.com/acme/widget/issues/7", idempotencyKey: "01FILEDKEYBBBBBBBBBBBBBBB" }),
    );
    const call = getToolHandler(server, "lore_report_issue");
    const priorResult = await call({ ...REPORT_ISSUE_ARGS, title: "A prior, unrelated report" });
    expect(priorResult.isError).toBeUndefined();
    const priorSlug = parseResult(priorResult)["task_slug"];
    expect(priorSlug).toBe(githubIssueTaskSlug(REPO_ID, 7));

    // Now file the ACTUAL probe report (issue #42, per the shared mock default).
    const result = await call(REPORT_ISSUE_ARGS);
    const payload = parseResult(result);
    expect(payload["task_slug"]).toBe(githubIssueTaskSlug(REPO_ID, 42));
    expect(payload["task_slug"]).not.toBe(priorSlug);
  });

  it("NEGATIVE: a missing severity is refused before any GitHub call, naming the field", async () => {
    const call = getToolHandler(server, "lore_report_issue");
    const { severity: _severity, ...argsWithoutSeverity } = REPORT_ISSUE_ARGS;

    const result = await call(argsWithoutSeverity);

    expect(result.isError).toBe(true);
    const error = parseResult(result);
    expect(error["code"]).toBe("VALIDATION_ERROR");
    expect(error["field"]).toBe("severity");
    expect(verifyTargetMock).not.toHaveBeenCalled();
  });

  it("NEGATIVE: a missing category is refused before any GitHub call, naming the field", async () => {
    const call = getToolHandler(server, "lore_report_issue");
    const { category: _category, ...argsWithoutCategory } = REPORT_ISSUE_ARGS;

    const result = await call(argsWithoutCategory);

    expect(result.isError).toBe(true);
    const error = parseResult(result);
    expect(error["code"]).toBe("VALIDATION_ERROR");
    expect(error["field"]).toBe("category");
    expect(verifyTargetMock).not.toHaveBeenCalled();
  });

  it("NEGATIVE: missing BOTH severity and category names both fields together", async () => {
    const call = getToolHandler(server, "lore_report_issue");
    const { severity: _severity, category: _category, ...argsWithoutEither } = REPORT_ISSUE_ARGS;

    const result = await call(argsWithoutEither);

    expect(result.isError).toBe(true);
    const error = parseResult(result);
    expect(error["field"]).toBe("severity,category");
  });

  it("ERROR: a GitHubIntakePort.verifyTarget failure propagates and mints no task", async () => {
    verifyTargetMock.mockReset().mockResolvedValue(
      err({ code: "AUTH_REQUIRED", message: "gh not authenticated", retryable: false }),
    );
    const call = getToolHandler(server, "lore_report_issue");

    const result = await call(REPORT_ISSUE_ARGS);

    expect(result.isError).toBe(true);
    const error = parseResult(result);
    expect(error["code"]).toBe("AUTH_REQUIRED");
    const taskLookup = await app.corpusService.listFull({ type: "task" });
    if (!taskLookup.ok) throw new Error("listFull failed");
    expect(taskLookup.value.total).toBe(0);
  });

  it("ERROR: a GitHubIntakePort.fileIssue failure propagates and mints no task", async () => {
    fileIssueMock.mockReset().mockResolvedValue(err({ code: "STORE_ERROR", message: "gh api rate limited" }));
    const call = getToolHandler(server, "lore_report_issue");

    const result = await call(REPORT_ISSUE_ARGS);

    expect(result.isError).toBe(true);
    const error = parseResult(result);
    expect(error["code"]).toBe("STORE_ERROR");
    const taskLookup = await app.corpusService.listFull({ type: "task" });
    if (!taskLookup.ok) throw new Error("listFull failed");
    expect(taskLookup.value.total).toBe(0);
  });
});
