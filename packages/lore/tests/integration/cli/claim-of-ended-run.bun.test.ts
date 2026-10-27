/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-10
 * @task task-red-tests-export-prefix-ancestry-verification-refusal (RED; implementation lands in a later task of the same plan)
 *
 * #457 / BR-1058: a task claimed by run R1, after R1 ends (ended_at set) and while the claim is younger than the lease TTL,
 * is claimed by another run R2 without a steal, and the output names R1 as ended. A claim of a LIVE run still refuses.
 *
 * Real McpServer + registerTools over an in-memory transport (the claim path is shared with the CLI service), real SQLite
 * corpus in a mkdtemp dir. Both runs are registered with the test process as their harness, so the tests stay valid once
 * run ancestry is verified. No new symbol is imported.
 *
 * Not covered here (reported in the task hand-off): the plain release by the ended run's session, and an ended run whose
 * worktree still has uncommitted changes (exit 5, BR-1057), which need a real git worktree.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateDocInput, RunId } from "@lore/core";
import { createApp, type App } from "../../../src/app.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { createRealProcessTablePort } from "../../../src/adapters/process-table-port.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { actedStore, liveAmbient, liveInvocation, liveWriteContext } from "../../live-invocation.js";

const STAMP = "2026-10-27T00:00:00.000Z";
const R1 = "cc:ended-claim-r1";
const R2 = "cc:ended-claim-r2";

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}
const textOf = (r: ToolResult): string => r.content.map((c) => c.text).join("\n");

type SeedStore = {
  insertRun: (r: unknown) => Promise<{ ok: boolean; error?: unknown }>;
  recordRunProcess: (id: RunId, p: { pid: number | null; startTime: string | null; worktree: string | null }) => Promise<{ ok: boolean; error?: unknown }>;
  endRun: (id: RunId, endedAt: string, reason: string) => Promise<{ ok: boolean; error?: unknown }>;
  close?: () => void;
};

describe("AC-RV-10: a claim ends with its run", () => {
  let tmpRoot: string;
  let dbPath: string;
  let app: App;
  let client: Client;
  let taskSlug: string;

  async function withStore<T>(body: (store: SeedStore) => Promise<T>): Promise<T> {
    const store = actedStore(new SQLiteStore(dbPath)) as unknown as SeedStore;
    try {
      return await body(store);
    } finally {
      store.close?.();
    }
  }

  async function seedRun(id: string): Promise<void> {
    const inspected = await createRealProcessTablePort({ env: process.env, cwd: process.cwd() }).inspect(process.pid);
    if (inspected === null || inspected.startTime === null) throw new Error("cannot read this process's start time");
    await withStore(async (store) => {
      const inserted = await store.insertRun({
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
      });
      if (!inserted.ok) throw new Error(`insertRun failed: ${JSON.stringify(inserted.error)}`);
      const recorded = await store.recordRunProcess(id as RunId, { pid: process.pid, startTime: inspected.startTime, worktree: null });
      if (!recorded.ok) throw new Error(`recordRunProcess failed: ${JSON.stringify(recorded.error)}`);
    });
  }

  async function endRun(id: string): Promise<void> {
    await withStore(async (store) => {
      const ended = await store.endRun(id as RunId, new Date().toISOString(), "test-end");
      if (!ended.ok) throw new Error(`endRun failed: ${JSON.stringify(ended.error)}`);
    });
  }

  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
  }

  function claimedBy(): string | null {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.query("SELECT harness_run FROM audit WHERE action = 'claim' ORDER BY rowid DESC LIMIT 1").all() as { harness_run: string }[];
      return rows[0]?.harness_run ?? null;
    } finally {
      db.close();
    }
  }

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "lore-ended-claim-"));
    mkdirSync(join(tmpRoot, ".lore"), { recursive: true });
    dbPath = join(tmpRoot, ".lore", "lore.db");
    app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    const plan = await app.corpusService.create({ type: "plan", title: "Ended Claim Plan", content: "# Plan" } as CreateDocInput);
    if (!plan.ok) throw new Error(`plan: ${JSON.stringify(plan.error)}`);
    const task = await app.corpusService.create({
      type: "task",
      title: "Ended Claim Task",
      parent_id: plan.value.id,
      content: "# Task",
      extra: { plan_id: plan.value.id },
    } as CreateDocInput);
    if (!task.ok) throw new Error(`task: ${JSON.stringify(task.error)}`);
    taskSlug = task.value.slug;
    await seedRun(R1);
    await seedRun(R2);

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
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("R1 ends: R2 claims the task without a steal, young claim included, and the output names R1 as ended", async () => {
    const first = await call("lore_claim", { id_or_slug: taskSlug, harness_run: R1 });
    expect(first.isError, textOf(first)).not.toBe(true);
    await endRun(R1);

    const second = await call("lore_claim", { id_or_slug: taskSlug, harness_run: R2 });
    expect(second.isError, textOf(second)).not.toBe(true);
    expect(textOf(second)).toContain(R1);
    expect(textOf(second)).toContain("ended");
    expect(claimedBy()).toBe(R2);
  });

  it("R1 is live: R2's claim still refuses, naming R1, and nothing changes hands (regression pin)", async () => {
    const first = await call("lore_claim", { id_or_slug: taskSlug, harness_run: R1 });
    expect(first.isError, textOf(first)).not.toBe(true);

    const second = await call("lore_claim", { id_or_slug: taskSlug, harness_run: R2 });
    expect(second.isError).toBe(true);
    expect(textOf(second)).toContain(R1);
    expect(claimedBy()).toBe(R1);
  });
});
