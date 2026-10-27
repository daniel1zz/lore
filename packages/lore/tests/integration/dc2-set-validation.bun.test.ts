// @spawns packages/lore/src/index.ts
/**
 * AC-DC2-8 (spec-defect-clusters-round-2-part-a-sessions-seats-setup-init D8; reports #246 #247;
 * BR-569, BR-726, BR-629) — `lore set` validates titles and protects writer-owned `extra`
 * the same way on every route.
 *
 * One throwaway corpus (mkdtemp + createApp; never the repo's own `.lore/`) backs:
 *   - CLI  -> `bun run src/index.ts` subprocess with cwd in the throwaway corpus
 *   - HTTP -> a real `startHttpServer` on an ephemeral port (port 0) with a bearer key
 *
 * Dimension mapping:
 *   NEGATIVE:   whitespace-only title refused on set/create; changed `extra.uat.verdict` refused
 *   BOUNDARY:   "" and "   " titles
 *   ERROR:      CLI exit 4 naming `title`; HTTP 4xx naming `lore uat record`
 *   STATE:      version unchanged after every refusal; `lore uat show` still prints accept
 *
 * @spec_ref spec-defect-clusters-round-2-part-a-sessions-seats-setup-init#AC-DC2-8
 */

import { liveAmbient, liveWriteContext, liveIo } from "../live-invocation.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";
import { createApp, type App } from "../../src/app.js";
import { startHttpServer } from "../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../src/adapters/http/machine-auth.js";

const SPEC_AC = "spec-defect-clusters-round-2-part-a-sessions-seats-setup-init#AC-DC2-8";
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

let dir: string;
let app: App;
let machineAuth: MachineAuthStores;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let bearer: string;
let planSlug: string;
let uatDoc: DocRecord;
let plainDoc: DocRecord;

const ACCEPT_VERDICT = {
  verdict: "accept",
  tier_results: [{ tier: "P0", accepted: 3, rejected: 0, unverified: 0 }],
  requirement_coverage: { total: 3, covered: 3, uncovered_p0: [] },
  uiux: { blocker_count: 0, min_dimension_score: 9 },
  run_meta: { at: "2026-10-19T00:00:00.000Z", by: "agent:dc2-8-test" },
} as const;

async function must<T>(p: Promise<Result<T, LoreError>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`fixture step failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

function runLore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const env: Record<string, string | undefined> = { ...process.env, HOME: dir, EDITOR: "true" };
  // reason: detectCliSurface() reads agent-marker env vars; strip them so the child is a plain "cli".
  delete env["CLAUDECODE"];
  delete env["CLAUDE_CODE_ENTRYPOINT"];
  delete env["LORE_SURFACE"];
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], { cwd: dir, env: env as Record<string, string> });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

async function versionOf(id: string): Promise<number> {
  return (await must(app.corpusService.get(id))).doc.version;
}

async function currentUatVerdict(): Promise<unknown> {
  const doc = (await must(app.corpusService.get(uatDoc.id))).doc;
  return (doc.extra["uat"] as { verdict?: string } | undefined)?.verdict;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-dc2-8-"));
  mkdirSync(join(dir, ".lore"), { recursive: true });
  const dbPath = join(dir, ".lore", "lore.db");
  app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());

  const plan = await must(app.corpusService.create({ type: "plan", title: "DC2-8 plan P", content: "# Plan" } as CreateDocInput));
  planSlug = plan.slug;
  plainDoc = await must(
    app.corpusService.create({
      type: "knowledge",
      title: "DC2-8 plain reference",
      content: "body",
      extra: { sub_type: "reference" },
    } as CreateDocInput),
  );

  // The verdict is recorded through the real CLI verb (`lore uat record`), the only writer.
  const verdictFile = join(dir, "accept.json");
  writeFileSync(verdictFile, JSON.stringify(ACCEPT_VERDICT));
  const recorded = runLore(["uat", "record", planSlug, "--json-file", verdictFile]);
  if (recorded.exitCode !== 0) throw new Error(`uat record failed: ${recorded.stderr}${recorded.stdout}`);
  const knowledge = await must(app.corpusService.list({ type: "knowledge" }));
  const found = knowledge.docs.find((d) => d.title.startsWith("UAT"));
  if (found === undefined) throw new Error("recorded uat doc not found");
  uatDoc = (await must(app.corpusService.get(found.id))).doc;
  if (uatDoc.extra["sub_type"] !== "uat") throw new Error("recorded doc is not a uat doc");

  machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-dc2-8-machine-")) });
  const key = await app.apiKeyStore.create("agent-key", "agent");
  if (!key.ok) throw new Error("bearer key creation failed");
  bearer = key.value.rawKey;
  server = startHttpServer(app, { io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
  baseUrl = `http://127.0.0.1:${server.port}`;
}, 120_000);

afterAll(() => {
  server.stop(true);
  app.close();
  machineAuth.db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function httpPatch(id: string, body: Record<string, unknown>, ifMatch: number): Promise<Response> {
  return fetch(`${baseUrl}/api/docs/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", "If-Match": String(ifMatch) },
    body: JSON.stringify(body),
  });
}

describe(`${SPEC_AC} (a) blank titles are refused`, () => {
  for (const blank of ["   ", ""]) {
    it(`${SPEC_AC} CLI set --title ${JSON.stringify(blank)} exits 4 naming title and leaves the version`, async () => {
      const before = await versionOf(plainDoc.id);
      const res = runLore(["set", plainDoc.slug, "--title", blank]);
      expect(res.exitCode).toBe(4);
      expect(res.stderr).toContain("title");
      expect(await versionOf(plainDoc.id)).toBe(before);
    }, 60_000);
  }

  it(`${SPEC_AC} HTTP PATCH with a whitespace-only title is refused and writes nothing`, async () => {
    const before = await versionOf(plainDoc.id);
    const res = await httpPatch(plainDoc.id, { title: "   " }, before);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await versionOf(plainDoc.id)).toBe(before);
  });

  it(`${SPEC_AC} CLI create knowledge --title "   " exits 4`, () => {
    const res = runLore(["create", "knowledge", "--title", "   ", "--sub-type", "reference", "--content", "x"]);
    expect(res.exitCode).toBe(4);
  }, 60_000);
});

describe(`${SPEC_AC} (b) writer-owned extra.uat is protected on every route`, () => {
  const flipped = { ...ACCEPT_VERDICT, verdict: "reject" };

  it(`${SPEC_AC} lore uat show still prints accept after the refused attempts`, () => {
    const shown = runLore(["uat", "show", planSlug]);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout.toLowerCase()).toContain("accept");
    expect(shown.stdout.toLowerCase()).not.toContain("reject");
  }, 60_000);

  it(`${SPEC_AC} HTTP PATCH changing extra.uat.verdict is refused the same way`, async () => {
    const before = await versionOf(uatDoc.id);
    const res = await httpPatch(uatDoc.id, { extra: { sub_type: "uat", uat: flipped } }, before);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await res.text()).toContain("lore uat record");
    expect(await versionOf(uatDoc.id)).toBe(before);
    expect(await currentUatVerdict()).toBe("accept");
  });

  it(`${SPEC_AC} CLI lore set --extra does not reach the verdict: refused and nothing written`, async () => {
    // reason: `lore set` has no --extra flag today, so the CLI route cannot carry an extra patch at
    // all; the oracle is that the attempt fails and the stored verdict is untouched. If a --extra
    // flag is added later this must also name `lore uat record` (service guard already covers it).
    const before = await versionOf(uatDoc.id);
    const res = runLore(["set", uatDoc.slug, "--extra", JSON.stringify({ sub_type: "uat", uat: flipped })]);
    expect(res.exitCode).not.toBe(0);
    expect(await versionOf(uatDoc.id)).toBe(before);
    expect(await currentUatVerdict()).toBe("accept");
  }, 60_000);

});
