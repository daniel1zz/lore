/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-15
 * @task task-skill-refactor-gs-t7-filing-creates-no-corpus-document-mcp
 *
 * The MCP `lore_report_issue` tool names GitHub in its description (none of the
 * retired queue vocabulary) and returns `{number, url, ...}` with no task slug,
 * leaving the corpus doc count unchanged. The registered handler is driven against
 * the REAL `GitHubIntakePort` and a recording `gh` stub (PATH pointed at it), so
 * nothing but GitHub is stubbed. Throwaway dir only; never this repo's `.lore/`.
 *
 * Six-dimension note: HAPPY (filing), NEGATIVE (forbidden phrases absent, no slug
 * keys), STATE (doc count unchanged), REGRESSION (description names GitHub).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LoreConfigSchema, NoOpTelemetry } from "@lore/core";
import type { LoreConfig } from "@lore/core";

import { liveInvocation, actedStore } from "../../live-invocation.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
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
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";
import { cleanupRecordingGhStubDir, recordingGhStubDir } from "../../integration/helpers/recording-gh-stub";

const REPO = "acme-test/gs-t7-mcp";
const REPO_ID = 880_008;

let ghStub: string;

beforeAll(() => {
  ghStub = recordingGhStubDir({ repoId: REPO_ID });
});

afterAll(() => {
  if (ghStub !== undefined) cleanupRecordingGhStubDir(ghStub);
});

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
    // reason: null-cast the services this file's ACs never touch, per the
    // mcp-github-filing.test.ts / mcp-tools.test.ts precedent.
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

type RegisteredTool = {
  description?: string;
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>;
};

function registeredTool(server: McpServer, name: string): RegisteredTool {
  const tool = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

describe("spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-15: MCP lore_report_issue names GitHub and returns {number, url} only", () => {
  const FORBIDDEN_PHRASES = ["upstream", "review queue", "pending-review", "draft ad-hoc task"];
  let mcpRoot: string;
  let originalCwd: string;
  let app: App;
  let server: McpServer;
  let originalPath: string | undefined;

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalPath = process.env["PATH"];
    mcpRoot = mkdtempSync(join(tmpdir(), "lore-gs-t7-mcp-"));
    // reason: `resolveConsumerCorpusRoot` only probes that `.lore/lore.db` EXISTS,
    // so the receipt log lands in this throwaway dir, never the repo's `.lore/`.
    mkdirSync(join(mcpRoot, ".lore"), { recursive: true });
    writeFileSync(join(mcpRoot, ".lore", "lore.db"), "");
    process.chdir(mcpRoot);
    // reason: `GhRunner` spawns `gh` from the invocation env, which is a copy of
    // process.env at construction — point PATH at the recording stub (shell builtins
    // only, so the stub dir is the entire PATH, as in the CLI half).
    process.env["PATH"] = ghStub;

    app = makeApp();
    const prd = await app.corpusService.create({ type: "prd", title: "Root PRD", content: "root" }, { by: "test-setup" });
    if (!prd.ok) throw new Error(`fixture setup failed: ${prd.error.code}`);

    const config = LoreConfigSchema.parse({
      project: { name: "test", author: "test" },
      feedback: { upstream: { repo: REPO } },
    }) as LoreConfig;
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, () => config, liveInvocation());
  });

  afterAll(() => {
    process.chdir(originalCwd);
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
    if (mcpRoot !== undefined) rmSync(mcpRoot, { recursive: true, force: true });
  });

  it("spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-15: the description contains 'GitHub issue' and none of the forbidden phrases", () => {
    const description = registeredTool(server, "lore_report_issue").description ?? "";
    expect(description).toContain("GitHub issue");
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(description.toLowerCase(), `description must not contain "${phrase}"`).not.toContain(phrase.toLowerCase());
    }
  });

  it("spec-github-owns-issue-report-state-no-mirror-task-work-carries#AC-GS-15: a filing returns number and url, no task slug key, and the doc count is unchanged", async () => {
    const before = await app.corpusService.listFull({});
    if (!before.ok) throw new Error("listFull failed");

    const result = await registeredTool(server, "lore_report_issue").handler(
      {
        by: "agent:gs-t7-mcp-probe",
        title: "gs-t7 mcp filing probe",
        description: "probing the MCP filing path",
        expected: "no corpus doc",
        actual: "under test",
        severity: "low",
        category: "c",
      },
      {} as unknown,
    );

    expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
    const text = result.content[0];
    if (!text || text.type !== "text") throw new Error("Expected text content");
    const payload = JSON.parse(text.text) as Record<string, unknown>;
    expect(typeof payload["number"]).toBe("number");
    expect(String(payload["url"])).toMatch(/^https?:\/\//);
    for (const key of ["task_slug", "slug", "task_id"]) {
      expect(Object.keys(payload), `payload must not carry ${key}`).not.toContain(key);
    }

    const after = await app.corpusService.listFull({});
    if (!after.ok) throw new Error("listFull failed");
    expect(after.value.total).toBe(before.value.total);
  });
});
