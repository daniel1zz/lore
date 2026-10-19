// @spawns packages/lore/src/index.ts
/**
 * AC-BLC-1 (issue #128, AS-19) — every audit entry records the write surface.
 *
 * A create, a set and an approve are driven through each REAL surface and the
 * audit rows they wrote are read back from a real SQLite store:
 *   - CLI        → `bun run src/index.ts` subprocess in a mkdtemp corpus  → "cli"
 *   - MCP        → `registerTools` handlers (lore_create / lore_set / lore_approve) → "mcp"
 *   - HTTP cookie→ real `startHttpServer`, lore_sid session cookie         → "http_cookie"
 *   - HTTP token → same server, `Authorization: Bearer` API key            → "http_token"
 *
 * The surface lives in `audit.details.surface` (not a new column): `details` is
 * already inside the hash-chain payload, so the surface is tamper-evident with
 * no migration and no break of the existing chain.
 *
 * Dimension mapping:
 *   HAPPY:      create/set/approve rows carry the expected surface on all four surfaces
 *   NEGATIVE:   no row written by a surface carries a DIFFERENT surface (every row is compared to the one expected value)
 *   BOUNDARY:   the set that moves a doc to in-review (a status-only patch) is audited too
 *   ERROR:      a write with no adapter-declared surface records no surface key (never a guess)
 *   STATE:      the hash chain still verifies after surface-stamped writes
 *   REGRESSION: an explicit details.surface already on an entry is never overwritten
 *
 * @spec_ref spec-baseline-close-out-fixes-audit-surface-node-validation AC-BLC-1
 */

import { liveInvocation, actedStore, liveIo } from "../../live-invocation.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NoOpTelemetry } from "@lore/core";
import type { AuditEntry } from "@lore/core";
import { clearProcessAuditSurface } from "../../../src/store/audit-surface.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { SessionStore } from "../../../src/adapters/http/sessions.js";
import { startHttpServer } from "../../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../../src/adapters/http/machine-auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { AuditService } from "../../../src/service/audit-service.js";
import type { App } from "../../../src/app.js";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

const FAR_PAST = "2000-01-01T00:00:00.000Z";
const PROJECT_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

// ─── Real SQLite-backed App (hand-wired, same shape as the dashboard HTTP tests) ───

interface Rig {
  readonly app: App;
  readonly store: SQLiteStore;
  readonly tmpDir: string;
}

function makeRig(): Rig {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-audit-surface-"));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  const store = actedStore(new SQLiteStore(join(tmpDir, ".lore", "lore.db")));
  const db = store.getDatabase();
  const telemetry = new NoOpTelemetry();
  const app: App = {
    warn: () => undefined,
    corpusService: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), telemetry),
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: new ApiKeyStore(db),
    sessionStore: new SessionStore(db),
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(store, telemetry),
    auditService: new AuditService(store),
    auditVerifyRunner: inLoopAuditVerifyRunner(new AuditService(store)),
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry,
    close: () => { store.close(); },
  };
  return { app, store, tmpDir };
}

async function auditFor(store: { queryAudit: SQLiteStore["queryAudit"] }, docId: string): Promise<AuditEntry[]> {
  const r = await store.queryAudit({ doc_id: docId as never });
  if (!r.ok) throw new Error(`queryAudit failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** The surface recorded on every audit row of `docId`, keyed by action, plus the full list. */
function surfacesOf(entries: AuditEntry[]): string[] {
  return entries.map((e) => String(e.details?.["surface"]));
}

/** create + set(in-review) + approve must have produced >= 3 rows, all on `expected`. */
function expectAllRowsOn(entries: AuditEntry[], expected: string): void {
  expect(entries.length).toBeGreaterThanOrEqual(3);
  expect(surfacesOf(entries)).toEqual(entries.map(() => expected));
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function runLore(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const env: Record<string, string | undefined> = { ...process.env, HOME: cwd, EDITOR: "true" };
  // reason: detectCliSurface() reads agent-marker env vars; strip them so the child is a plain "cli".
  delete env["CLAUDECODE"];
  delete env["CLAUDE_CODE_ENTRYPOINT"];
  delete env["LORE_SURFACE"];
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], { cwd, env: env as Record<string, string> });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

describe("AC-BLC-1 CLI surface", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-audit-surface-cli-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("create, set and approve driven through the CLI record surface 'cli'", async () => {
    const init = runLore(["init"], dir);
    if (init.exitCode !== 0) throw new Error(`init failed: ${init.stderr}`);
    const created = runLore(["create", "prd", "--title", "Surface CLI", "--content", "body", "--no-ai", "--json"], dir);
    if (created.exitCode !== 0) throw new Error(`create failed: ${created.stderr}`);
    const id = (JSON.parse(created.stdout) as { data?: { id?: string }; id?: string });
    const docId = id.data?.id ?? id.id;
    if (docId === undefined) throw new Error(`no id in create output: ${created.stdout}`);
    const set = runLore(["set", docId, "--status", "in-review", "--no-ai"], dir);
    if (set.exitCode !== 0) throw new Error(`set failed: ${set.stderr}${set.stdout}`);
    const approved = runLore(["approve", docId], dir);
    if (approved.exitCode !== 0) throw new Error(`approve failed: ${approved.stderr}${approved.stdout}`);

    const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
    try {
      expectAllRowsOn(await auditFor(store, docId), "cli");
    } finally {
      store.close();
    }
  }, 120_000);
});

// ─── MCP ─────────────────────────────────────────────────────────────────────

type McpInternal = {
  _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }>;
};

describe("AC-BLC-1 MCP surface", () => {
  let rig: Rig;
  beforeAll(() => {
    rig = makeRig();
  });
  afterAll(() => {
    rig.app.close();
    rmSync(rig.tmpDir, { recursive: true, force: true });
  });

  it("lore_create, lore_set and lore_approve record surface 'mcp'", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, rig.app, undefined, liveInvocation());
    const tools = (server as unknown as McpInternal)._registeredTools;
    const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const tool = tools[name];
      if (tool === undefined) throw new Error(`tool not registered: ${name}`);
      const res = await tool.handler(args, {});
      const first = res.content[0];
      if (first === undefined || first.type !== "text") throw new Error("expected text content");
      if (res.isError === true) throw new Error(`${name} errored: ${first.text}`);
      return JSON.parse(first.text);
    };
    const created = (await call("lore_create", { type: "prd", title: "Surface MCP", content: "body", by: "agent:mcp-test" })) as {
      id?: string;
      data?: { id?: string };
      doc?: { id?: string };
    };
    const docId = created.id ?? created.data?.id ?? created.doc?.id;
    if (docId === undefined) throw new Error(`no id in create result: ${JSON.stringify(created)}`);
    await call("lore_set", { id_or_slug: docId, patch: { status: "in-review" }, by: "agent:mcp-test" });
    await call("lore_approve", { id_or_slug: docId, reviewer: "agent:mcp-test" });
    expectAllRowsOn(await auditFor(rig.store, docId), "mcp");
  });
});

// ─── HTTP (cookie + bearer) ──────────────────────────────────────────────────

describe("AC-BLC-1 HTTP surfaces", () => {
  let rig: Rig;
  let server: ReturnType<typeof Bun.serve>;
  let machineAuth: MachineAuthStores;
  let baseUrl: string;
  let bootstrapKey: string;
  let bearerKey: string;

  beforeAll(async () => {
    rig = makeRig();
    machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-audit-surface-machine-")) });
    const boot = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
    if (!boot.ok) throw new Error("bootstrap key creation failed");
    bootstrapKey = boot.value.rawKey;
    const bearer = await rig.app.apiKeyStore.create("agent-key", "agent");
    if (!bearer.ok) throw new Error("bearer key creation failed");
    bearerKey = bearer.value.rawKey;
    server = startHttpServer(rig.app, {
    io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => {
    server.stop(true);
    rig.app.close();
    machineAuth.db.close();
    rmSync(rig.tmpDir, { recursive: true, force: true });
  });

  async function cookieHeader(): Promise<Record<string, string>> {
    const res = await fetch(`${baseUrl}/api/auth/local-bootstrap`, {
      method: "POST",
      headers: { "X-Lore-Token": bootstrapKey, Origin: "http://localhost:5173" },
    });
    const { data } = (await res.json()) as { data: { session_id: string } };
    return { Cookie: `lore_sid=${data.session_id}` };
  }

  async function driveCreateSetApprove(auth: Record<string, string>, title: string): Promise<string> {
    const json = { ...auth, "Content-Type": "application/json" };
    const created = await fetch(`${baseUrl}/api/docs`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ type: "prd", title, content: "body" }),
    });
    expect(created.status).toBe(201);
    const docId = ((await created.json()) as { data: { id: string } }).data.id;
    const patched = await fetch(`${baseUrl}/api/docs/${docId}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ status: "in-review" }),
    });
    expect(patched.status).toBe(200);
    const approved = await fetch(`${baseUrl}/api/review/${docId}/approve`, { method: "POST", headers: auth });
    expect(approved.status).toBe(200);
    return docId;
  }

  it("create, set and approve with a session cookie record surface 'http_cookie'", async () => {
    const docId = await driveCreateSetApprove(await cookieHeader(), "Surface Cookie");
    expectAllRowsOn(await auditFor(rig.store, docId), "http_cookie");
  });

  it("create, set and approve with a bearer token record surface 'http_token'", async () => {
    const docId = await driveCreateSetApprove({ Authorization: `Bearer ${bearerKey}` }, "Surface Token");
    expectAllRowsOn(await auditFor(rig.store, docId), "http_token");
  });

  it("the hash chain still verifies after surface-stamped writes", async () => {
    const verified = await rig.app.auditService.verify();
    expect(verified.ok).toBe(true);
  });
});

// ─── Store-level: no ambient surface, explicit entry surface ─────────────────

describe("AC-BLC-1 audit stamping rules", () => {
  // reason: the process surface is module state set by any in-process CLI/MCP boot earlier in the same `bun test`
  // run; "no adapter-declared surface" is this block's precondition, so it establishes it rather than inheriting it.
  beforeEach(() => clearProcessAuditSurface());

  it("a write with no adapter-declared surface records NO surface key, never a guessed one", async () => {
    const store = actedStore(new InMemoryStore());
    const svc = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const created = await svc.create({ type: "prd", title: "No Surface" });
    if (!created.ok) throw new Error("create failed");
    const rows = await auditFor(store, created.value.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details !== undefined && "surface" in rows[0].details).toBe(false);
  });

  it("an entry that already carries details.surface keeps it", async () => {
    const store = actedStore(new InMemoryStore());
    await store.appendAuditEntry({
      timestamp: new Date().toISOString(),
      actor: "t",
      session_id: "s",
      action: "update",
      details: { surface: "mcp" },
    });
    const r = await store.queryAudit({});
    if (!r.ok) throw new Error("queryAudit failed");
    expect(r.value[0]?.details?.["surface"]).toBe("mcp");
  });
});
