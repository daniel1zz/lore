/**
 * @spec_ref AC-RID-7 (spec-run-identity-slice-1-harness-attested-runs-attested D1/D3/D11; BR-1034)
 * @task task-skill-test-red-mcp-writes-carry-harness-run-no-tool (RED; paired impl =
 *       task-skill-implement-mcp-harness-run-argument-optional-by-per)
 *
 * MCP writes are attested like CLI writes and no tool requires the caller to name itself.
 * Everything goes through the REAL McpServer + registerTools, over an in-memory MCP transport
 * with a real MCP Client (tools/list and tools/call are the wire-level protocol calls), against a
 * real SQLite corpus in a mkdtemp dir (never the repo's own .lore/). Runs are seeded through the
 * store's insertRun (pinned in migration-016.bun.test.ts); audit rows are read straight from the
 * SQLite file so no service-layer mapping can hide a missing stamp.
 *
 * Dimensions: HAPPY (create attested), NEGATIVE (claim refused naming holder; no required by),
 * BOUNDARY (no harness_run, unknown run), REGRESSION (unattested create still succeeds),
 * different-inputs-different-outputs (two distinct runs R1/R2 produce distinct stamps).
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CreateDocInput } from "@lore/core";
import { createApp, type App } from "../../../src/app.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";

const STAMP = "2026-10-08T00:00:00.000Z";
const RUN_1 = "cc:session-mcp-run-1";
const RUN_2 = "cc:session-mcp-run-2";

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

async function seedRun(dbPath: string, id: string): Promise<void> {
  const store = new SQLiteStore(dbPath) as unknown as {
    insertRun?: (r: unknown) => Promise<{ ok: boolean; error?: unknown }>;
    close?: () => void;
  };
  try {
    if (typeof store.insertRun !== "function") {
      throw new Error("MISSING BEHAVIOUR: store has no insertRun (runs table not implemented)");
    }
    const r = await store.insertRun(makeRun(id));
    if (!r.ok) throw new Error(`insertRun failed: ${JSON.stringify(r.error)}`);
  } finally {
    store.close?.();
  }
}

function auditRows(dbPath: string, docId: string): Record<string, unknown>[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query("SELECT * FROM audit WHERE doc_id = ? ORDER BY rowid").all(docId) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}
const textOf = (r: ToolResult): string => r.content.map((c) => c.text).join("\n");

describe("AC-RID-7 MCP harness_run attestation (real server, tools/list + tools/call)", () => {
  let tmpRoot: string;
  let dbPath: string;
  let app: App;
  let client: Client;
  let taskSlug: string;

  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
  }

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "lore-mcp-harness-run-"));
    mkdirSync(join(tmpRoot, ".lore"), { recursive: true });
    dbPath = join(tmpRoot, ".lore", "lore.db");
    app = createApp(dbPath);
    const plan = await app.corpusService.create({ type: "plan", title: "MCP Run Plan", content: "# Plan" } as CreateDocInput);
    if (!plan.ok) throw new Error(`plan: ${JSON.stringify(plan.error)}`);
    const task = await app.corpusService.create({
      type: "task",
      title: "MCP Run Task",
      parent_id: plan.value.id,
      content: "# Task",
      extra: { plan_id: plan.value.id },
    } as CreateDocInput);
    if (!task.ok) throw new Error(`task: ${JSON.stringify(task.error)}`);
    taskSlug = task.value.slug;

    const server = new McpServer({ name: "lore", version: "0.0.0-test" });
    registerTools(server, app);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientT);
  });

  afterEach(async () => {
    await client.close();
    app.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("tools/list: no tool's input schema lists `by` or `recorded_by` as required", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(10); // guards against a vacuous empty listing
    const offenders = tools
      .filter((t) => {
        const required = (t.inputSchema as { required?: string[] }).required ?? [];
        return required.includes("by") || required.includes("recorded_by");
      })
      .map((t) => t.name);
    expect(offenders).toEqual([]);
  });

  it("tools/list: write tools advertise a harness_run property", async () => {
    const { tools } = await client.listTools();
    const propsOf = (name: string): string[] => {
      const t = tools.find((x) => x.name === name);
      return Object.keys((t?.inputSchema as { properties?: object } | undefined)?.properties ?? {});
    };
    expect(propsOf("lore_create")).toContain("harness_run");
    expect(propsOf("lore_claim")).toContain("harness_run");
  });

  it("lore_create with harness_run R1 and no by succeeds and the audit row carries R1", async () => {
    await seedRun(dbPath, RUN_1);
    const res = await call("lore_create", { type: "plan", title: "Attested via MCP", harness_run: RUN_1 });
    expect(res.isError).not.toBe(true);
    const id = (JSON.parse(textOf(res)) as { id: string }).id;
    const rows = auditRows(dbPath, id).filter((r) => r["action"] === "create");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r["harness_run"] === RUN_1)).toBe(true);
  });

  it("a different run R2 yields R2 on its own audit rows, not R1 (no hardcoded stamp)", async () => {
    await seedRun(dbPath, RUN_1);
    await seedRun(dbPath, RUN_2);
    const a = await call("lore_create", { type: "plan", title: "Doc A", harness_run: RUN_1 });
    const b = await call("lore_create", { type: "plan", title: "Doc B", harness_run: RUN_2 });
    const idA = (JSON.parse(textOf(a)) as { id: string }).id;
    const idB = (JSON.parse(textOf(b)) as { id: string }).id;
    const rowsA = auditRows(dbPath, idA);
    const rowsB = auditRows(dbPath, idB);
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsB.length).toBeGreaterThan(0);
    expect(rowsA.every((r) => r["harness_run"] === RUN_1)).toBe(true);
    expect(rowsB.every((r) => r["harness_run"] === RUN_2)).toBe(true);
  });

  it("lore_create without harness_run and without by succeeds and is stored unattested", async () => {
    const res = await call("lore_create", { type: "plan", title: "Unattested via MCP" });
    expect(res.isError).not.toBe(true);
    const id = (JSON.parse(textOf(res)) as { id: string }).id;
    const rows = auditRows(dbPath, id);
    expect(rows.length).toBeGreaterThan(0);
    // The column must exist (migration 016) and be NULL: an absent column = attribution not implemented.
    expect(rows.every((r) => "harness_run" in r && r["harness_run"] === null)).toBe(true);
  });

  it("lore_create with an unknown harness_run is kept, stored unattested, never refused (BR-1035)", async () => {
    const res = await call("lore_create", { type: "plan", title: "Unknown run", harness_run: "cc:never-registered" });
    expect(res.isError).not.toBe(true);
    const id = (JSON.parse(textOf(res)) as { id: string }).id;
    const rows = auditRows(dbPath, id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => "harness_run" in r && r["harness_run"] === null)).toBe(true);
  });

  it("lore_claim with harness_run R1 and no by claims the task", async () => {
    await seedRun(dbPath, RUN_1);
    const res = await call("lore_claim", { id_or_slug: taskSlug, harness_run: RUN_1 });
    expect(res.isError).not.toBe(true);
  });

  it("lore_claim with harness_run R1 while R2 holds a fresh claim is refused naming R2", async () => {
    await seedRun(dbPath, RUN_1);
    await seedRun(dbPath, RUN_2);
    const first = await call("lore_claim", { id_or_slug: taskSlug, harness_run: RUN_2 });
    expect(first.isError).not.toBe(true);
    const second = await call("lore_claim", { id_or_slug: taskSlug, harness_run: RUN_1 });
    expect(second.isError).toBe(true);
    expect(textOf(second)).toContain(RUN_2);
  });
});
