// @spawns packages/lore/src/index.ts
/**
 * plan-audit-verify-reads-only-the-keys-it-joins-runs-off-the — acceptance, observable and red first.
 *
 * `AuditService.verify` is O(rows) by design (SPEC-079 whole-chain verdict). Run on a long-lived server's
 * event loop it stalls that server, so both long-lived servers run it off the loop. These tests measure that
 * on a corpus seeded to this repo's shape (>= 58k audit rows, >= 48k versions, large content), for each
 * persistent store kind (a SQLite file, and a Turso store in `file:` mode):
 *   - HTTP: while `GET /api/audit/verify` runs, every concurrent `GET /api/auth/me` completes and the slowest
 *     one takes < 1000 ms (the old code held the loop for 2-7 s)
 *   - MCP: the same for a concurrent cheap `lore_get` while `lore_audit {verify: true}` runs
 * One attempt, no retries. The bound separates "verify holds the loop" (seconds) from "it does not" (tens to a
 * few hundred ms of scheduling noise on a loaded machine); the measured p95 is printed for information only.
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
import { buildAuditVerifyRunner } from "../../../src/service/audit-verify-runner.js";
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
const GRID_MS = 20;
/** A blocked loop shows as seconds; ordinary scheduling noise on a loaded machine stays well under this. */
const STALL_CEILING_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number;
}

/**
 * Fires `probe` on a fixed GRID_MS grid until `until` settles. Each probe starts on its grid slot WITHOUT waiting
 * for the previous one (open-loop, so a slow answer never pushes later slots back), and its latency is measured
 * from its INTENDED start: a stalled event loop makes every slot inside the stall late, instead of hiding as one
 * slow sample among fast ones. Returns the per-probe latencies.
 */
async function sampleDuring(probe: () => Promise<unknown>, until: Promise<unknown>): Promise<number[]> {
  let done = false;
  void until.finally(() => {
    done = true;
  });
  const samples: number[] = [];
  const inFlight: Promise<void>[] = [];
  const t0 = performance.now();
  for (let i = 0; !done; i++) {
    const intended = t0 + i * GRID_MS;
    const wait = intended - performance.now();
    if (wait > 0) await sleep(wait);
    if (done) break;
    inFlight.push(probe().then(() => void samples.push(performance.now() - intended)));
  }
  await Promise.all(inFlight);
  return samples;
}

interface Measurement<T> {
  readonly ms: number;
  readonly samples: number[];
  readonly result: T;
}

/** Runs `start()` (one full verify) with `probe` sampling alongside, once; prints the distribution. */
async function measureDuring<T>(label: string, probe: () => Promise<unknown>, start: () => Promise<T>): Promise<Measurement<T>> {
  const startedAt = performance.now();
  const running = start();
  const samples = await sampleDuring(probe, running);
  const result = await running;
  const ms = performance.now() - startedAt;
  console.log(`${label}: verify ${ms.toFixed(0)} ms; ${samples.length} probes, all completed; p95 ${p95(samples).toFixed(1)} ms (information); max ${Math.max(...samples).toFixed(1)} ms`);
  return { ms, samples, result };
}

function expectNotBlocked(m: Measurement<unknown>): void {
  // the verify must have been long enough for the measurement to mean something
  expect(m.ms).toBeGreaterThan(100);
  expect(m.samples.length).toBeGreaterThanOrEqual(5);
  expect(Math.max(...m.samples)).toBeLessThan(STALL_CEILING_MS);
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
    // reason: the same factory the composition roots call, with the store kind the rig is opened on.
    auditVerifyRunner: buildAuditVerifyRunner(
      kind === "sqlite" ? { kind: "sqlite", dbPath } : { kind: "turso", localPath: dbPath },
      { verifySince: FAR_PAST, anchorRoot: join(dbPath, "..", "..") },
    ),
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

  it("HTTP: every concurrent GET /api/auth/me completes in < 1000 ms while GET /api/audit/verify runs", async () => {
    const me = (): Promise<Response> => fetch(`${baseUrl}/api/auth/me`, { headers: cookie });
    for (let i = 0; i < 20; i++) await me();
    // the same probe with nothing running: what the measurement itself costs on this machine
    const idle = await sampleDuring(me, sleep(1500));
    console.log(`[${kind}] HTTP idle baseline: ${idle.length} samples; p95 ${p95(idle).toFixed(1)} ms; max ${Math.max(...idle).toFixed(1)} ms`);

    const m = await measureDuring(`[${kind}] HTTP`, me, () =>
      fetch(`${baseUrl}/api/audit/verify`, { headers: cookie }).then(async (r) => ({
        status: r.status,
        body: (await r.json()) as { data?: { clean: boolean; chain: { checked: number } } },
      })),
    );
    expect(m.result.status).toBe(200);
    expect(m.result.body.data?.clean).toBe(true);
    expect(m.result.body.data?.chain.checked).toBeGreaterThanOrEqual(58_000);
    expectNotBlocked(m);
  }, 300_000);

  it("MCP: every concurrent lore_get completes in < 1000 ms while lore_audit {verify: true} runs", async () => {
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

    const m = await measureDuring(`[${kind}] MCP`, get, () => call("lore_audit", { verify: true }));
    expect(m.result.isError).not.toBe(true);
    const first = m.result.content[0];
    if (first === undefined || first.type !== "text") throw new Error("expected text content");
    expect((JSON.parse(first.text) as { clean: boolean }).clean).toBe(true);
    expectNotBlocked(m);
  }, 300_000);
});

// ─── The real worker: the verdict it returns, and its failure ───────────────

describe("the worker runner (real Worker)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-verify-worker-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  for (const kind of ["sqlite", "turso"] as const) {
    it(`${kind}: returns the verdict the service computes, including a tampered row`, async () => {
      const sub = mkdtempSync(join(dir, `${kind}-`));
      const fixture = await seedAuditVerifyCorpus(sub, kind, { docs: 4, versionsPerDoc: 5, contentChars: 64, extraAuditRows: 3 });
      const runner = buildAuditVerifyRunner(
        kind === "sqlite" ? { kind, dbPath: fixture.dbPath } : { kind, localPath: fixture.dbPath },
        { verifySince: FAR_PAST, anchorRoot: sub },
      );
      expect(runner.mode).toBe("worker");

      const clean = await runner.verify();
      if (!clean.ok) throw new Error(`worker verify failed: ${JSON.stringify(clean.error)}`);
      expect(clean.value.clean).toBe(true);
      expect(clean.value.chain).toEqual({ clean: true, checked: fixture.auditRows });

      const raw = new Database(fixture.dbPath);
      raw.exec("UPDATE audit SET actor = 'agent:forger' WHERE id = 7");
      raw.close();
      const tampered = await runner.verify();
      if (!tampered.ok) throw new Error(`worker verify failed: ${JSON.stringify(tampered.error)}`);
      expect(tampered.value.clean).toBe(false);
      expect(tampered.value.chain).toEqual({ clean: false, checked: 7, break: { id: 7, reason: "hash_mismatch" } });
    }, 120_000);
  }

  it("a corpus the worker cannot open fails the request with the worker's own message; nothing runs in-loop", async () => {
    const runner = buildAuditVerifyRunner({ kind: "sqlite", dbPath: join(dir, "no-such-dir", "lore.db") }, { verifySince: FAR_PAST, anchorRoot: dir });
    const r = await runner.verify();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("STORE_ERROR");
    expect((r.error as { message: string }).message).toMatch(/audit verify worker failed: .*unable to open database file/i);
  }, 60_000);

  it("the SQLite worker opens the corpus read-only: a verify never changes the file", async () => {
    const sub = mkdtempSync(join(dir, "ro-"));
    const fixture = await seedAuditVerifyCorpus(sub, "sqlite", { docs: 2, versionsPerDoc: 3, contentChars: 64, extraAuditRows: 0 });
    const before = new Database(fixture.dbPath, { readonly: true });
    const stamp = (before.query("PRAGMA data_version").get() as { data_version: number }).data_version;
    const countBefore = (before.query("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n;
    before.close();
    const r = await buildAuditVerifyRunner({ kind: "sqlite", dbPath: fixture.dbPath }, { verifySince: FAR_PAST, anchorRoot: sub }).verify();
    expect(r.ok).toBe(true);
    const after = new Database(fixture.dbPath, { readonly: true });
    expect((after.query("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n).toBe(countBefore);
    expect((after.query("PRAGMA data_version").get() as { data_version: number }).data_version).toBe(stamp);
    after.close();
  }, 60_000);
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
