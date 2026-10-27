/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-6
 * @task task-red-tests-export-prefix-ancestry-verification-refusal (RED; implementation lands in a later task of the same plan)
 *
 * The tool server verifies `harness_run` like the CLI: a call naming a run whose registered harness process is NOT an
 * ancestor of the server process is refused and writes nothing; the same call naming a run whose harness process IS an
 * ancestor (here: the test process itself, the server being in-process) is stamped with that run.
 *
 * Real McpServer + registerTools over an in-memory transport and a real MCP Client, against a real SQLite corpus in a
 * mkdtemp dir. Runs are seeded with insertRun + recordRunProcess (existing store methods). The non-ancestor harness is a
 * sleeping child process of the test (a child is never an ancestor). No new symbol is imported.
 */
import { Database } from "bun:sqlite";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunId } from "@lore/core";
import { createApp, type App } from "../../../src/app.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { createRealProcessTablePort } from "../../../src/adapters/process-table-port.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { actedStore, liveAmbient, liveInvocation, liveWriteContext } from "../../live-invocation.js";

const STAMP = "2026-10-27T00:00:00.000Z";
const RUN_OWN = "cc:ancestry-own";
const RUN_FOREIGN = "cc:ancestry-foreign";

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}
const textOf = (r: ToolResult): string => r.content.map((c) => c.text).join("\n");

function makeRun(id: string): Record<string, unknown> {
  return {
    id,
    kind: "main",
    harness: "claude-code",
    sessionRef: id.replace(/^cc:/, ""),
    agentRef: null,
    agentType: null,
    parentRunId: null,
    branch: "main",
    composition: { schemaVersion: 1, fragments: [{ id: "frag-1", sha256: "a".repeat(64) }] },
    registeredAt: STAMP,
  };
}

/** Register `id` with `harness` recorded as its harness process (pid + the start time `ps` reports now). */
async function seedRunWithHarness(dbPath: string, id: string, harnessPid: number): Promise<void> {
  const inspected = await createRealProcessTablePort({ env: process.env, cwd: process.cwd() }).inspect(harnessPid);
  if (inspected === null || inspected.startTime === null) throw new Error(`cannot read the start time of pid ${harnessPid}`);
  const store = actedStore(new SQLiteStore(dbPath)) as unknown as {
    insertRun: (r: unknown) => Promise<{ ok: boolean; error?: unknown }>;
    recordRunProcess: (id: RunId, p: { pid: number | null; startTime: string | null; worktree: string | null }) => Promise<{ ok: boolean; error?: unknown }>;
    close?: () => void;
  };
  try {
    const inserted = await store.insertRun(makeRun(id));
    if (!inserted.ok) throw new Error(`insertRun failed: ${JSON.stringify(inserted.error)}`);
    const recorded = await store.recordRunProcess(id as RunId, { pid: harnessPid, startTime: inspected.startTime, worktree: null });
    if (!recorded.ok) throw new Error(`recordRunProcess failed: ${JSON.stringify(recorded.error)}`);
  } finally {
    store.close?.();
  }
}

function auditRows(dbPath: string): Record<string, unknown>[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query("SELECT * FROM audit ORDER BY rowid").all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

describe("AC-RV-6: the tool server verifies the run like the CLI", () => {
  let tmpRoot: string;
  let dbPath: string;
  let app: App;
  let client: Client;
  let foreignHarness: ChildProcess;

  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
  }

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "lore-mcp-ancestry-"));
    mkdirSync(join(tmpRoot, ".lore"), { recursive: true });
    dbPath = join(tmpRoot, ".lore", "lore.db");
    app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    foreignHarness = spawn("sleep", ["600"], { stdio: "ignore" });
    if (foreignHarness.pid === undefined) throw new Error("could not start the foreign harness process");
    await seedRunWithHarness(dbPath, RUN_OWN, process.pid);
    await seedRunWithHarness(dbPath, RUN_FOREIGN, foreignHarness.pid);

    const server = new McpServer({ name: "lore", version: "0.0.0-test" });
    registerTools(server, app, undefined, liveInvocation());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    app.close();
    foreignHarness.kill("SIGKILL");
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("a run whose harness process is NOT an ancestor of the server is refused and nothing is written", async () => {
    const before = auditRows(dbPath).length;
    const res = await call("lore_create", { type: "plan", title: "Foreign harness plan", harness_run: RUN_FOREIGN });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("does not descend from");
    expect(textOf(res)).toContain(RUN_FOREIGN);
    expect(auditRows(dbPath)).toHaveLength(before);
  });

  it("a run whose harness process IS an ancestor is accepted and stamped with that run", async () => {
    const res = await call("lore_create", { type: "plan", title: "Own harness plan", harness_run: RUN_OWN });
    expect(res.isError).not.toBe(true);
    const id = (JSON.parse(textOf(res)) as { id: string }).id;
    const rows = auditRows(dbPath).filter((r) => r["doc_id"] === id && r["action"] === "create");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r["harness_run"] === RUN_OWN)).toBe(true);
  });
});
