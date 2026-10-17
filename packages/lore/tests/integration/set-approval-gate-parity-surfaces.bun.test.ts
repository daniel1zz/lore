// @spawns packages/lore/src/index.ts
/**
 * AC-AP-2 (issues #65 #50, BR-1071) — `set ... status approved` gives the approve verdict through
 * every real write surface: MCP, CLI and HTTP.
 *
 * One `createApp`-composed throwaway SQLite corpus (mkdtemp; never the repo's own `.lore/`) backs:
 *   - MCP  -> `registerTools` on an in-process McpServer (pattern: http/audit-surface.bun.test.ts)
 *   - CLI  -> `bun run src/index.ts` subprocess with cwd in the throwaway corpus
 *   - HTTP -> a real `startHttpServer` with a bearer token (`If-Match` carries the expected version)
 * Fixtures (documents, criteria, citations, judgments) are written through the same in-process app;
 * the surfaces under test only ever perform the `set` / `approve` itself.
 *
 * Dimension mapping:
 *   HAPPY:      (c) MCP judged spec, (f) HTTP PATCH with the current version
 *   NEGATIVE:   (a) MCP unjudged adr, (b) MCP plan under a draft spec, (d) CLI unjudged adr
 *   BOUNDARY:   (e) HTTP stale version
 *   ERROR:      (a) (b) (d) refusals carry the approve path's code / stderr / exit code
 *   STATE:      version-row counts before / after on every refusal
 *   REGRESSION: (e2) the stale-version guard survives the delegation (service level; green on main)
 *
 * @spec_ref spec-approval-and-plan-closure-go-through-the-same-checks-on AC-AP-2
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, DocRecord, LoreError, NewReviewJudgment, Result } from "@lore/core";
import { createApp, type App } from "../../src/app.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { startHttpServer } from "../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../src/adapters/http/machine-auth.js";
import { registerTools } from "../../src/adapters/mcp/tools.js";
import { citeSpecWithLiveRule } from "../helpers/app-live-rule.js";

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

// ─── Rig ─────────────────────────────────────────────────────────────────────

let dir: string;
let app: App;
let reader: SQLiteStore;
let machineAuth: MachineAuthStores;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let bearer: string;
let counter = 0;

type McpInternal = {
  _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }>;
};
let tools: McpInternal["_registeredTools"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-set-approval-surfaces-"));
  mkdirSync(join(dir, ".lore"), { recursive: true });
  const dbPath = join(dir, ".lore", "lore.db");
  app = createApp(dbPath);
  reader = new SQLiteStore(dbPath);
  await must(app.corpusService.create({ type: "prd", title: "Surfaces root PRD", content: "root" } as CreateDocInput));

  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(mcp, app);
  tools = (mcp as unknown as McpInternal)._registeredTools;

  machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-set-approval-machine-")) });
  const key = await app.apiKeyStore.create("agent-key", "agent");
  if (!key.ok) throw new Error("bearer key creation failed");
  bearer = key.value.rawKey;
  server = startHttpServer(app, { port: 0, host: "127.0.0.1", machineAuth });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  reader.close();
  app.close();
  machineAuth.db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function must<T>(p: Promise<Result<T, LoreError>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`fixture step failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

function next(label: string): string {
  counter += 1;
  return `${label} ${counter}`;
}

async function versionRows(docId: string): Promise<{ count: number; newestAction: string | undefined }> {
  const v = await must(reader.findVersions(docId as never));
  return { count: v.length, newestAction: v[0]?.action };
}

const AC_ID = "AC-SURF-1";

async function makeSpec(label: string, opts: { cite: boolean }): Promise<DocRecord> {
  const created = await must(
    app.corpusService.create({ type: "spec", title: next(label), content: "## Overview\n\nSurface body.\n" } as CreateDocInput),
  );
  if (app.acService === undefined) throw new Error("AcService not wired");
  await must(
    app.acService.addCriterion(created.id, {
      id: AC_ID,
      statement: "The gated behaviour works as declared.",
      verify: { mode: "human" },
    }),
  );
  if (opts.cite) await citeSpecWithLiveRule(app, created.id, AC_ID);
  return (await must(app.corpusService.get(created.id))).doc;
}

async function makeAdr(label: string): Promise<DocRecord> {
  return must(
    app.corpusService.create({
      type: "adr",
      title: next(label),
      content: "body",
      extra: { decision_status: "accepted" },
    } as CreateDocInput),
  );
}

async function judge(docId: string): Promise<void> {
  const current = (await must(app.corpusService.get(docId))).doc;
  const judgment: NewReviewJudgment = {
    doc_id: current.id,
    doc_version: current.version,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "All good" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "test-provider", model: "test-model", prompt_version: "v1" },
  };
  await must(app.judgmentService.record(judgment));
}

// ─── MCP ─────────────────────────────────────────────────────────────────────

async function callMcp(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const tool = tools[name];
  if (tool === undefined) throw new Error(`tool not registered: ${name}`);
  const res = await tool.handler(args, {});
  const first = res.content[0];
  if (first === undefined || first.type !== "text") throw new Error("expected text content");
  return { isError: res.isError === true, text: first.text };
}

function codeOf(text: string): string | undefined {
  return /"code"\s*:\s*"([A-Z_]+)"/.exec(text)?.[1];
}

describe("AC-AP-2 MCP lore_set to approved", () => {
  it("(a) unjudged adr: isError with the same error code lore_approve returns, and no new version row", async () => {
    const a = await makeAdr("Surface mcp adr A");
    const b = await makeAdr("Surface mcp adr B");
    const beforeA = await versionRows(a.id);

    const viaApprove = await callMcp("lore_approve", { id_or_slug: b.id, reviewer: "agent:mcp-test" });
    const viaSet = await callMcp("lore_set", { id_or_slug: a.id, status: "approved" });

    expect(viaApprove.isError).toBe(true);
    expect(viaSet.isError).toBe(true);
    expect(codeOf(viaApprove.text)).toBeDefined();
    expect(codeOf(viaSet.text)).toBe(codeOf(viaApprove.text));
    expect(await versionRows(a.id)).toEqual(beforeA);
  });

  it("(b) plan under a draft spec: isError naming plan-promote", async () => {
    const spec = await makeSpec("Surface mcp governing spec", { cite: true });
    const plan = await must(
      app.corpusService.create({ type: "plan", title: next("Surface mcp plan"), parent_id: spec.id, content: "Plan body." } as CreateDocInput),
    );
    const before = await versionRows(plan.id);

    const viaSet = await callMcp("lore_set", { id_or_slug: plan.id, status: "approved" });

    expect(viaSet.isError).toBe(true);
    expect(viaSet.text).toContain("plan-promote");
    expect(await versionRows(plan.id)).toEqual(before);
  });

  it("(c) judged spec citing a live rule: lore_set succeeds and the newest version action is 'approve'", async () => {
    const spec = await makeSpec("Surface mcp judged spec", { cite: true });
    await judge(spec.id);

    const viaSet = await callMcp("lore_set", { id_or_slug: spec.id, status: "approved" });

    expect(viaSet.isError).toBe(false);
    expect((await versionRows(spec.id)).newestAction).toBe("approve");
  });
});

// ─── CLI ─────────────────────────────────────────────────────────────────────

function runLore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const env: Record<string, string | undefined> = { ...process.env, HOME: dir, EDITOR: "true" };
  // reason: detectCliSurface() reads agent-marker env vars; strip them so the child is a plain "cli".
  delete env["CLAUDECODE"];
  delete env["CLAUDE_CODE_ENTRYPOINT"];
  delete env["LORE_SURFACE"];
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], { cwd: dir, env: env as Record<string, string> });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

describe("AC-AP-2 CLI lore set --status approved", () => {
  it("(d) unjudged adr: exits exactly 4, stderr equals lore approve's for the same kind of doc, and lore log shows no new row", async () => {
    const a = await makeAdr("Surface cli adr A");
    const b = await makeAdr("Surface cli adr B");
    const logBefore = runLore(["log", a.slug]);
    expect(logBefore.exitCode).toBe(0);

    const viaApprove = runLore(["approve", b.slug]);
    const viaSet = runLore(["set", a.slug, "--status", "approved", "--no-ai"]);

    expect(viaApprove.exitCode).toBe(4);
    expect(viaSet.exitCode).toBe(4);
    const mask = (text: string, doc: DocRecord): string =>
      text.split(doc.id).join("<doc>").split(doc.slug).join("<doc>").split(doc.title).join("<doc>");
    expect(mask(viaSet.stderr, a)).toBe(mask(viaApprove.stderr, b));
    const logAfter = runLore(["log", a.slug]);
    expect(logAfter.stdout.split("\n").length).toBe(logBefore.stdout.split("\n").length);
  }, 120_000);
});

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function patch(id: string, body: Record<string, unknown>, ifMatch: number): Promise<Response> {
  return fetch(`${baseUrl}/api/docs/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", "If-Match": String(ifMatch) },
    body: JSON.stringify(body),
  });
}

describe("AC-AP-2 HTTP PATCH /api/docs/<id> with status approved", () => {
  it("(e) a stale expected version: 409 STALE_VERSION and nothing is written", async () => {
    const spec = await makeSpec("Surface http stale spec", { cite: true });
    await judge(spec.id);
    const current = (await must(app.corpusService.get(spec.id))).doc;
    const before = await versionRows(spec.id);

    const res = await patch(spec.id, { status: "approved" }, current.version - 1);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string }; code?: string };
    expect(body.error?.code ?? body.code).toBe("STALE_VERSION");
    expect(await versionRows(spec.id)).toEqual(before);
  });

  it("(f) the current version after an approve judgment: 200, newest version 'approve', approve audit row attributed to the token's actor", async () => {
    const spec = await makeSpec("Surface http judged spec", { cite: true });
    await judge(spec.id);
    const current = (await must(app.corpusService.get(spec.id))).doc;

    // The token's actor is whatever the same token's own create is audited under.
    const probe = await fetch(`${baseUrl}/api/docs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "prd", title: next("Surface http actor probe"), content: "body" }),
    });
    expect(probe.status).toBe(201);
    const probeId = ((await probe.json()) as { data: { id: string } }).data.id;
    const probeRows = await must(reader.queryAudit({ doc_id: probeId as never }));
    const tokenActor = probeRows.find((r) => r.action === "create")?.actor;
    expect(tokenActor).toBeDefined();

    const res = await patch(spec.id, { status: "approved" }, current.version);

    expect(res.status).toBe(200);
    expect((await versionRows(spec.id)).newestAction).toBe("approve");
    const rows = await must(reader.queryAudit({ doc_id: spec.id as never }));
    const approveRows = rows.filter((r) => r.action === "approve");
    expect(approveRows).toHaveLength(1);
    expect(approveRows[0]?.actor).toBe(tokenActor as string);
  });
});

// ─── REGRESSION (green on main): the CAS guard survives the delegation ───────

describe("AC-AP-2 stale expectedVersion at the service layer", () => {
  it("(e2) set to approved with a stale expectedVersion is STALE_VERSION and writes nothing", async () => {
    const spec = await makeSpec("Surface service stale spec", { cite: true });
    await judge(spec.id);
    const current = (await must(app.corpusService.get(spec.id))).doc;
    const before = await versionRows(spec.id);

    const r = await app.corpusService.set(spec.id, { status: "approved" }, { expectedVersion: current.version - 1 });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("set approved against a stale expectedVersion");
    expect(r.error.code).toBe("STALE_VERSION");
    expect(await versionRows(spec.id)).toEqual(before);
  });
});
