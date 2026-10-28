// @spawns packages/lore/src/index.ts
/**
 * AC-AP-2 (issues #65 #50, BR-1071) — `set ... status approved` gives the approve verdict through
 * every real write surface: CLI and HTTP.
 *
 * One `createApp`-composed throwaway SQLite corpus (mkdtemp; never the repo's own `.lore/`) backs:
 *   - CLI  -> `bun run src/index.ts` subprocess with cwd in the throwaway corpus
 *   - HTTP -> a real `startHttpServer` with a bearer token (`If-Match` carries the expected version)
 * Fixtures (documents, criteria, citations, judgments) are written through the same in-process app;
 * the surfaces under test only ever perform the `set` / `approve` itself.
 *
 * Dimension mapping:
 *   HAPPY:      (f) HTTP PATCH with the current version
 *   NEGATIVE:   (d) CLI unjudged adr
 *   BOUNDARY:   (e) HTTP stale version
 *   ERROR:      (d) refusal carries the approve path's stderr / exit code
 *   STATE:      version-row counts before / after on every refusal
 *   REGRESSION: (e2) the stale-version guard survives the delegation (service level; green on main)
 *
 * @spec_ref spec-approval-and-plan-closure-go-through-the-same-checks-on AC-AP-2
 */

import { liveAmbient, liveWriteContext, actedStore, liveIo } from "../live-invocation.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { CreateDocInput, DocRecord, LoreError, NewReviewJudgment, Result } from "@lore/core";
import { createApp, type App } from "../../src/app.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { startHttpServer } from "../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../src/adapters/http/machine-auth.js";
import { citeSpecWithLiveRule } from "../helpers/app-live-rule.js";

import { ensureRequirementsDocId } from "../helpers/parented-create.js";
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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-set-approval-surfaces-"));
  mkdirSync(join(dir, ".lore"), { recursive: true });
  const dbPath = join(dir, ".lore", "lore.db");
  app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  reader = actedStore(new SQLiteStore(dbPath));
  await must(app.corpusService.create({ type: "prd", title: "Surfaces root PRD", content: "root" } as CreateDocInput));

  machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-set-approval-machine-")) });
  const key = await app.apiKeyStore.create("agent-key", "agent");
  if (!key.ok) throw new Error("bearer key creation failed");
  bearer = key.value.rawKey;
  server = startHttpServer(app, {
    io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
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
      parent_id: await ensureRequirementsDocId(app.corpusService), type: "adr",
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
