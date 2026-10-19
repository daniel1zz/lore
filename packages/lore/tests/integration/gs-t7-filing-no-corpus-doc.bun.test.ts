// @spawns packages/lore/src/index.ts
// @reads packages
// @reads packages/*/src/**
/**
 * @spec_ref spec-github-owns-issue-report-state-no-mirror-task-work-carries AC-GS-10, AC-GS-15
 * @task task-skill-refactor-gs-t7-filing-creates-no-corpus-document-mcp
 *
 * Filing a report creates NO corpus document (GitHub owns the report); only the
 * local filing-log receipts (intent + outcome) remain. The MCP `lore_report_issue`
 * tool names GitHub in its description and returns `{number, url, ...}` with no
 * task slug.
 *
 * AC-GS-10: the real CLI entry (`bun packages/lore/src/index.ts report-issue`)
 *   against a throwaway corpus (`mkdtemp` + `lore init`) and a recording `gh`
 *   stub on PATH. `SELECT count(*)` over `docs` and `versions` is identical before
 *   and after; the filing log gains exactly one intent and one outcome line with
 *   the same key; a repeat prints "Already filed" with zero further create-POSTs.
 *   The assertion is on TOTAL doc count (a filing that mints its task under a
 *   different slug prefix would pass a "no task-gh-* slug" check).
 * AC-GS-15: the registered MCP handler is driven against the REAL
 *   `GitHubIntakePort` and the same recording `gh` stub (PATH is pointed at it
 *   for the duration), so nothing but GitHub is stubbed.
 *
 * Six-dimension note: HAPPY (CLI filing, MCP filing), NEGATIVE (forbidden
 * description phrases absent, no slug keys), BOUNDARY (repeat filing), ERROR
 * (every exit code is exactly 0), STATE (doc/version counts, receipt lines),
 * REGRESSION (the receipt intent/outcome still written).
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LoreConfigSchema, NoOpTelemetry } from "@lore/core";
import type { LoreConfig } from "@lore/core";

import { liveInvocation, actedStore } from "../live-invocation.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { ReviewService } from "../../src/service/review-service.js";
import { VersionService } from "../../src/service/version-service.js";
import { OutlineService } from "../../src/service/outline-service.js";
import { MigrationService } from "../../src/service/migration-service.js";
import { TreeCheckService } from "../../src/service/tree-check-service.js";
import { JudgmentService } from "../../src/service/judgment-service.js";
import type { App } from "../../src/app.js";
import type { ApiKeyStore } from "../../src/adapters/http/auth.js";
import { registerTools } from "../../src/adapters/mcp/tools.js";
import { inLoopAuditVerifyRunner } from "../support/audit-verify-runner-stub.js";
import { cleanupRecordingGhStubDir, readPostBodies, recordingGhStubDir } from "./helpers/recording-gh-stub";

const WORKTREE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const LORE_ENTRY = join(WORKTREE_ROOT, "packages", "lore", "src", "index.ts");
const REPO = "acme-test/gs-t7-filing";
const REPO_ID = 880_007;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let ghStub: string;
let configHome: string;
let corpus: string;

/** One synchronous `lore <args>` spawn from source; PATH holds ONLY the gh stub dir. */
function runLore(args: readonly string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([process.execPath, LORE_ENTRY, ...args], {
    cwd,
    env: {
      ...process.env,
      CLAUDECODE: "1",
      LORE_CONFIG_HOME: configHome,
      PATH: ghStub,
      LORE_ACTOR: "agent:gs-t7-filing-test",
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

/** `SELECT count(*)` over one table of the throwaway corpus's database. */
function countRows(root: string, table: "docs" | "versions"): number {
  const db = new Database(join(root, ".lore", "lore.db"), { readonly: true });
  try {
    const row = db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

function receiptLines(root: string): Array<Record<string, unknown>> {
  const path = join(root, ".lore", "issue-receipts-v2.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const FILING_ARGS = [
  "report-issue",
  "--title",
  "gs-t7 filing probe",
  "--description",
  "gs-t7 filing probe description",
  "--expected",
  "expected behaviour",
  "--actual",
  "actual behaviour",
  "--severity",
  "low",
  "--category",
  "c",
];

beforeAll(() => {
  ghStub = recordingGhStubDir({ repoId: REPO_ID });
  configHome = mkdtempSync(join(tmpdir(), "lore-gs-t7-config-home-"));
  corpus = mkdtempSync(join(tmpdir(), "lore-gs-t7-corpus-"));
  const init = runLore(["init"], corpus);
  if (init.exitCode !== 0) throw new Error(`'lore init' failed (exit ${init.exitCode}): ${init.stderr}`);
  const prd = runLore(
    ["create", "prd", "--title", "gs-t7 throwaway root PRD", "--content", "Throwaway root PRD."],
    corpus,
  );
  if (prd.exitCode !== 0) throw new Error(`root PRD creation failed (exit ${prd.exitCode}): ${prd.stderr}`);
  const configPath = join(corpus, ".lore", "config.yaml");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  writeFileSync(configPath, `${existing}feedback:\n  upstream:\n    repo: ${REPO}\n`);
}, 120_000);

afterAll(() => {
  if (ghStub !== undefined) cleanupRecordingGhStubDir(ghStub);
  for (const dir of [configHome, corpus]) {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("AC-GS-10: filing creates zero corpus docs and still writes the receipt", () => {
  it("AC-GS-10: filing exits 0, prints number and URL, and leaves docs/versions counts unchanged", () => {
    const docsBefore = countRows(corpus, "docs");
    const versionsBefore = countRows(corpus, "versions");
    expect(docsBefore).toBeGreaterThan(0); // the root PRD: the baseline is non-trivial

    const run = runLore(FILING_ARGS, corpus);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/Filed as issue #\d+ \(https?:\/\/\S+\)/);
    expect(countRows(corpus, "docs")).toBe(docsBefore);
    expect(countRows(corpus, "versions")).toBe(versionsBefore);
    expect(readPostBodies(ghStub)).toHaveLength(1);
  });

  it("AC-GS-10: the filing log gained exactly one intent and one outcome line with the same key", () => {
    const lines = receiptLines(corpus);
    const intents = lines.filter((line) => line["phase"] === "intent");
    const outcomes = lines.filter((line) => line["phase"] === "outcome");
    expect(intents).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.["idempotency_key"]).toBe(intents[0]?.["idempotency_key"]);
  });

  it("AC-GS-10: repeating the command prints 'Already filed', exits 0, makes no further create-POST and no doc", () => {
    const docsBefore = countRows(corpus, "docs");

    const run = runLore(FILING_ARGS, corpus);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toContain("Already filed");
    expect(readPostBodies(ghStub)).toHaveLength(1);
    expect(countRows(corpus, "docs")).toBe(docsBefore);
    expect(receiptLines(corpus)).toHaveLength(2);
  });
});

// ─── AC-GS-15: the MCP surface ───────────────────────────────────────────────

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

describe("AC-GS-15: MCP lore_report_issue names GitHub and returns {number, url} only", () => {
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

  it("AC-GS-15: the description contains 'GitHub issue' and none of the forbidden phrases", () => {
    const description = registeredTool(server, "lore_report_issue").description ?? "";
    expect(description).toContain("GitHub issue");
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(description.toLowerCase(), `description must not contain "${phrase}"`).not.toContain(phrase.toLowerCase());
    }
  });

  it("AC-GS-15: a filing returns number and url, no task slug key, and the doc count is unchanged", async () => {
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
