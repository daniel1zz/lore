// @spawns packages/lore/src/index.ts
/**
 * plan-audit-verify-reads-only-the-keys-it-joins-runs-off-the — acceptance, observable and red first.
 *
 * `AuditService.verify` is O(rows) by design (SPEC-079 whole-chain verdict). Run on a long-lived server's
 * event loop it stalls that server, so both long-lived servers run it off the loop. These tests measure that
 * on a corpus seeded to this repo's shape (>= 58k audit rows, >= 48k versions, large content), for each
 * persistent store kind (a SQLite file, and a Turso store in `file:` mode):
 *   - HTTP: concurrent `GET /api/auth/me` stays <= 50 ms p95 while `GET /api/audit/verify` runs
 *   - MCP: a concurrent cheap `lore_get` stays <= 50 ms p95 while `lore_audit {verify: true}` runs
 * and, on a small real corpus, that the HTTP and MCP verdicts carry the SAME anchor status the CLI reports
 * once `.lore/audit-anchor.json` exists (the HTTP route and MCP tool used to never pass the anchor).
 *
 * Latency is measured from each request's INTENDED start on a fixed grid (constant-rate sampling, no
 * coordinated omission): a blocked loop shows up as every grid slot inside the stall being late, not as
 * one slow sample hidden among thousands of fast ones.
 *
 * @spec_ref spec-079-audit-hardening-link-provenance-actor-fidelity-tamper
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NoOpTelemetry } from "@lore/core";
import { liveAmbient, liveInvocation, liveIo, actedStore } from "../../live-invocation.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AuditService } from "../../../src/service/audit-service.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { SessionStore } from "../../../src/adapters/http/sessions.js";
import { startHttpServer } from "../../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../../src/adapters/http/machine-auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { createApp, type App } from "../../../src/app.js";
import { seedAuditVerifyCorpus, REPO_SHAPE } from "../support/audit-verify-fixture.js";

const FAR_PAST = "2000-01-01T00:00:00.000Z";
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const GRID_MS = 5;
const P95_BUDGET_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number;
}

/**
 * Fires `probe` on a fixed GRID_MS grid until `until` settles; each sample is measured from its intended
 * start, so a stalled loop makes every slot inside the stall late. Returns the per-sample latencies.
 */
async function sampleDuring(probe: () => Promise<unknown>, until: Promise<unknown>): Promise<number[]> {
  let done = false;
  void until.finally(() => {
    done = true;
  });
  const samples: number[] = [];
  const t0 = performance.now();
  for (let i = 0; !done; i++) {
    const intended = t0 + i * GRID_MS;
    const wait = intended - performance.now();
    if (wait > 0) await sleep(wait);
    if (done) break;
    await probe();
    samples.push(performance.now() - intended);
  }
  return samples;
}

type McpInternal = {
  _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }>;
};

interface Rig {
  readonly app: App;
  readonly close: () => void;
}

/** Hand-wires the minimum App the two surfaces read, over a seeded corpus, the way the composition roots wire it. */
async function wireRig(kind: "sqlite" | "turso", dbPath: string): Promise<Rig> {
  const telemetry = new NoOpTelemetry();
  const store: StoreInterface & { close(): void } =
    kind === "sqlite" ? actedStore(new SQLiteStore(dbPath)) : actedStore(new TursoStore({ localPath: dbPath }));
  // reason: the Turso store has no bun:sqlite handle; the key/session stores open their own over the same file.
  const authDb = kind === "sqlite" ? (store as SQLiteStore).getDatabase() : new Database(dbPath);
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  const app: App = {
    warn: () => undefined,
    corpusService: new CorpusService(store, lock, telemetry),
    apiKeyStore: new ApiKeyStore(authDb),
    sessionStore: new SessionStore(authDb),
    auditService: new AuditService(store, { verifySince: FAR_PAST }),
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry,
    close: () => {
      store.close();
      if (kind === "turso") authDb.close();
    },
  } as unknown as App;
  return { app, close: () => app.close() };
}

describe.each(["sqlite", "turso"] as const)("audit verify does not block the serving loop (%s store)", (kind) => {
  let dir: string;
  let rig: Rig;
  let server: ReturnType<typeof Bun.serve>;
  let machineAuth: MachineAuthStores;
  let cookie: Record<string, string>;
  let baseUrl: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), `lore-verify-nonblocking-${kind}-`));
    const fixture = await seedAuditVerifyCorpus(dir, kind, REPO_SHAPE);
    expect(fixture.auditRows).toBeGreaterThanOrEqual(58_000);
    expect(fixture.versions).toBeGreaterThanOrEqual(48_000);
    rig = await wireRig(kind, fixture.dbPath);
    machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-verify-nonblocking-machine-")) });
    const boot = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
    if (!boot.ok) throw new Error("bootstrap key creation failed");
    server = startHttpServer(rig.app, { io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
    baseUrl = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${baseUrl}/api/auth/local-bootstrap`, {
      method: "POST",
      headers: { "X-Lore-Token": boot.value.rawKey, Origin: "http://localhost:5173" },
    });
    const { data } = (await res.json()) as { data: { session_id: string } };
    cookie = { Cookie: `lore_sid=${data.session_id}` };
  }, 600_000);

  afterAll(() => {
    server?.stop(true);
    rig?.close();
    machineAuth?.db.close();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it("HTTP: concurrent GET /api/auth/me stays <= 50 ms p95 while GET /api/audit/verify runs", async () => {
    const me = (): Promise<Response> => fetch(`${baseUrl}/api/auth/me`, { headers: cookie });
    for (let i = 0; i < 20; i++) await me();

    const startedAt = performance.now();
    const verify = fetch(`${baseUrl}/api/audit/verify`, { headers: cookie }).then(async (r) => ({
      status: r.status,
      body: (await r.json()) as { data?: { clean: boolean; chain: { checked: number } } },
      ms: performance.now() - startedAt,
    }));
    const samples = await sampleDuring(me, verify);
    const result = await verify;

    expect(result.status).toBe(200);
    expect(result.body.data?.clean).toBe(true);
    expect(result.body.data?.chain.checked).toBeGreaterThanOrEqual(58_000);
    console.log(`[${kind}] HTTP verify ${result.ms.toFixed(0)} ms; ${samples.length} samples; p95 ${p95(samples).toFixed(1)} ms; max ${Math.max(...samples).toFixed(1)} ms`);
    // the verify must have been long enough for the measurement to mean something
    expect(result.ms).toBeGreaterThan(100);
    expect(p95(samples)).toBeLessThanOrEqual(P95_BUDGET_MS);
    expect(samples.length).toBeGreaterThanOrEqual(20);
  }, 300_000);

  it("MCP: a concurrent lore_get stays <= 50 ms p95 while lore_audit {verify: true} runs", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, rig.app, undefined, liveInvocation());
    const tools = (server as unknown as McpInternal)._registeredTools;
    const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
      const tool = tools[name];
      if (tool === undefined) throw new Error(`tool not registered: ${name}`);
      return tool.handler(args, {});
    };
    const get = (): Promise<CallToolResult> => call("lore_get", { id_or_slug: "fixture-doc-1" });
    const warm = await get();
    expect(warm.isError).not.toBe(true);
    for (let i = 0; i < 20; i++) await get();

    const startedAt = performance.now();
    const verify = call("lore_audit", { verify: true }).then((r) => ({ r, ms: performance.now() - startedAt }));
    const samples = await sampleDuring(get, verify);
    const { r, ms } = await verify;

    expect(r.isError).not.toBe(true);
    const first = r.content[0];
    if (first === undefined || first.type !== "text") throw new Error("expected text content");
    expect((JSON.parse(first.text) as { clean: boolean }).clean).toBe(true);
    console.log(`[${kind}] MCP verify ${ms.toFixed(0)} ms; ${samples.length} samples; p95 ${p95(samples).toFixed(1)} ms; max ${Math.max(...samples).toFixed(1)} ms`);
    expect(ms).toBeGreaterThan(100);
    expect(p95(samples)).toBeLessThanOrEqual(P95_BUDGET_MS);
    expect(samples.length).toBeGreaterThanOrEqual(20);
  }, 300_000);
});

// ─── Anchor parity: HTTP and MCP report what the CLI reports ────────────────

function runLore(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const proc = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.status ?? 1 };
}

describe("anchor parity: HTTP and MCP verdicts carry the anchor status the CLI reports", () => {
  let dir: string;
  let app: App;
  let server: ReturnType<typeof Bun.serve>;
  let machineAuth: MachineAuthStores;
  let cookie: Record<string, string>;
  let baseUrl: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lore-verify-anchor-parity-"));
    const init = runLore(["init"], dir);
    if (init.exitCode !== 0) throw new Error(`init failed: ${init.stderr}`);
    const created = runLore(["create", "prd", "--title", "Anchor parity", "--content", "body", "--no-ai"], dir);
    if (created.exitCode !== 0) throw new Error(`create failed: ${created.stderr}`);
    const built = createApp(join(dir, ".lore", "lore.db"), undefined, { ...liveAmbient(), cwd: dir });
    if (!("corpusService" in built)) throw new Error("createApp failed");
    app = built;
    machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-verify-anchor-machine-")) });
    const boot = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
    if (!boot.ok) throw new Error("bootstrap key creation failed");
    server = startHttpServer(app, { io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
    baseUrl = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${baseUrl}/api/auth/local-bootstrap`, {
      method: "POST",
      headers: { "X-Lore-Token": boot.value.rawKey, Origin: "http://localhost:5173" },
    });
    cookie = { Cookie: `lore_sid=${((await res.json()) as { data: { session_id: string } }).data.session_id}` };
  }, 120_000);

  afterAll(() => {
    server?.stop(true);
    app?.close();
    machineAuth?.db.close();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  async function httpAnchor(): Promise<{ status: string }> {
    const res = await fetch(`${baseUrl}/api/audit/verify`, { headers: cookie });
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { anchor: { status: string } } }).data.anchor;
  }

  async function mcpAnchor(): Promise<{ status: string }> {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
    const tool = (server as unknown as McpInternal)._registeredTools["lore_audit"];
    if (tool === undefined) throw new Error("lore_audit not registered");
    const r = await tool.handler({ verify: true }, {});
    const first = r.content[0];
    if (first === undefined || first.type !== "text") throw new Error("expected text content");
    return (JSON.parse(first.text) as { anchor: { status: string } }).anchor;
  }

  function cliAnchor(): { status: string } {
    const out = runLore(["audit", "--verify", "--json"], dir);
    return (JSON.parse(out.stdout) as { data: { anchor: { status: string } } }).data.anchor;
  }

  it("no anchor file: all three surfaces say absent", async () => {
    expect(cliAnchor().status).toBe("absent");
    expect((await httpAnchor()).status).toBe("absent");
    expect((await mcpAnchor()).status).toBe("absent");
  }, 120_000);

  it("anchor file present: HTTP and MCP report the CLI's status, and it is not absent", async () => {
    const anchored = runLore(["audit", "anchor"], dir);
    expect(anchored.exitCode).toBe(0);
    const cli = cliAnchor();
    expect(cli.status).toBe("clean");
    expect(await httpAnchor()).toEqual(cli);
    expect(await mcpAnchor()).toEqual(cli);
  }, 120_000);

  it("a rewritten anchored row: all three surfaces report anchor_mismatch", async () => {
    const db = new Database(join(dir, ".lore", "lore.db"));
    db.exec(`UPDATE audit SET entry_hash = '${"0".repeat(64)}' WHERE id = (SELECT MAX(id) FROM audit)`);
    db.close();
    const cli = cliAnchor();
    expect(cli.status).toBe("anchor_mismatch");
    expect((await httpAnchor()).status).toBe("anchor_mismatch");
    expect((await mcpAnchor()).status).toBe("anchor_mismatch");
  }, 120_000);

  it("a malformed anchor file fails loud on HTTP instead of reading as absent", async () => {
    writeFileSync(join(dir, ".lore", "audit-anchor.json"), "{not json", "utf8");
    const res = await fetch(`${baseUrl}/api/audit/verify`, { headers: cookie });
    expect(res.status).not.toBe(200);
    expect(await res.text()).toContain("audit-anchor.json");
  }, 120_000);
});
