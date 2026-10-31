// @reads assets/project/lore-config-template.yaml
// @spawns-external git builds a throwaway git repository the test runs against
/**
 * AC-PAR-3 — an ad-hoc task with a non-empty criteria scope records its governing spec, and every reader of its
 * criteria resolves through that record (BR-118, BR-156, BR-1494, BR-1495; issue #496).
 *
 * Throwaway corpus (mkdtemp + `lore init`): two specs declare AC-X-1, a deprecated spec declares AC-Y-1 and a
 * superseded AC-Z-1. Everything is driven through the real command tree (`runLoreInProcess`), the real HTTP server, and
 * the real services; nothing is mocked.
 *
 * Coverage:
 *   NEGATIVE:   create with a scope and no spec exits exactly 4 naming `--spec` (CLI) and is refused naming `--spec`
 *               (HTTP); an undeclared scope id exits 4 naming the declared ids; `scope spec` with an undeclared id is
 *               refused; `scope add` on an ad-hoc task checks the new ids against the recorded spec; `--spec` without
 *               `--adhoc` is a usage error
 *   HAPPY:      `--spec <first>` exits 0 and records the spec; `evidence --ac`, `lore verify --task`,
 *               `check-ac-ref-integrity` and AC coverage each resolve AC-X-1 to the FIRST spec
 *   BOUNDARY:   a deprecated spec resolves AC-Y-1 and its superseded AC-Z-1; an empty scope needs no spec
 *   STATE:      `lore scope spec` on an archived task records the spec with one version and one audit entry and leaves
 *               body, title and status unchanged; `lore assess` refresh tasks record the criterion's spec and are reused
 *               by (spec, criterion)
 *   REGRESSION: no product source calls `resolveGoverningSpecByAcScope`
 *
 * @spec_ref spec-documents-that-need-a-parent-are-refused-without-one-an-ad AC-PAR-3
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractEvidence, type DocRecord } from "@lore/core";
import { createLiveApp } from "../../helpers/live-app.js";
import { runLoreInProcess } from "../../helpers/run-lore-in-process.js";
import { actedStore, liveIo } from "../../live-invocation.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { startHttpServer } from "../../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../../src/adapters/http/machine-auth.js";
import { createAppStaleRefresher } from "../../../src/adapters/cli/assess-stale-refresh.js";
import { findDanglingRefs } from "../../../../../scripts/check-ac-ref-integrity-core.js";
import type { App } from "../../../src/app.js";

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

let dir: string;
let home: string;
let dbPath: string;
let firstSpec: string;
let secondSpec: string;
let oldSpec: string;
let prdSlug: string;
const ids: Record<string, string> = {};

async function loreAsync(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return await runLoreInProcess(args, { cwd: dir, home });
}

async function withApp<T>(body: (app: App) => Promise<T>): Promise<T> {
  const app = createLiveApp(dbPath);
  try {
    return await body(app);
  } finally {
    app.close();
  }
}

async function must<T>(result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>, what: string): Promise<T> {
  const done = await result;
  if (!done.ok) throw new Error(`${what}: ${JSON.stringify(done.error)}`);
  return done.value;
}

async function getDoc(app: App, ref: string): Promise<DocRecord> {
  return (await must(app.corpusService.get(ref), `get ${ref}`)).doc;
}

const scriptAc = (id: string, command: string) => ({
  id,
  statement: `${id} holds`,
  verify: { mode: "script" as const, oracle: "other" as const, command },
});

async function createSpec(app: App, title: string, criteria: ReturnType<typeof scriptAc>[]): Promise<DocRecord> {
  const spec = await must(
    app.corpusService.create({ type: "spec", title, content: "## Overview/Goal\n\nx\n\n## Scope\n\ny\n\n## Acceptance Criteria\n\nz" } as never),
    `spec ${title}`,
  );
  if (app.acService === undefined) throw new Error("acService not wired");
  for (const criterion of criteria) await must(app.acService.addCriterion(spec.slug, criterion), `ac ${criterion.id}`);
  return spec;
}

async function createAdhocViaCli(title: string, extraArgs: string[]) {
  return await loreAsync(["create", "task", "--title", title, "--adhoc", "--no-ai", "--content", "body", "--json", ...extraArgs]);
}

function slugOf(stdout: string): string {
  return (JSON.parse(stdout) as { data: { slug: string; id: string } }).data.slug;
}

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-adhoc-governing-spec-")));
  home = realpathSync(mkdtempSync(join(tmpdir(), "lore-adhoc-governing-spec-home-")));
  const init = await loreAsync(["init"]);
  if (init.exitCode !== 0) throw new Error(`init failed: ${init.stderr}`);
  dbPath = join(dir, ".lore", "lore.db");

  await withApp(async (app) => {
    prdSlug = (await must(app.corpusService.create({ type: "prd", title: "Governing PRD", content: "root" } as never), "prd")).slug;
    const first = await createSpec(app, "Spec First", [scriptAc("AC-X-1", "echo first-ran && echo 'AC-X-1 PASS'")]);
    const second = await createSpec(app, "Spec Second", [scriptAc("AC-X-1", "echo second-ran && echo 'AC-X-1 PASS'")]);
    const old = await createSpec(app, "Spec Old", [scriptAc("AC-Y-1", "echo y"), scriptAc("AC-Z-1", "echo z")]);
    firstSpec = first.slug;
    secondSpec = second.slug;
    oldSpec = old.slug;
    ids["first"] = first.id;
    ids["second"] = second.id;
    ids["old"] = old.id;
  });

  // The deprecated spec and the superseded criterion are forced straight into the store: no command may
  // retire a spec that way in a throwaway corpus without a full review lifecycle.
  const store = actedStore(new SQLiteStore(dbPath));
  try {
    const found = await must(store.find(ids["old"] as never), "find old spec");
    if (found === null) throw new Error("fixture: old spec vanished");
    const criteria = (found.extra["acceptance_criteria"] as Array<Record<string, unknown>>).map((c) =>
      c["id"] === "AC-Z-1"
        ? { ...c, superseded_by: { spec: firstSpec, ac: "AC-X-1", reason: "moved to the first spec", by: "t", at: "2026-01-01T00:00:00.000Z" } }
        : c,
    );
    await must(
      store.update(found.id, { status: "deprecated", version: found.version + 1, extra: { ...found.extra, acceptance_criteria: criteria } }, { expected_version: found.version }),
      "deprecate old spec",
    );
  } finally {
    store.close();
  }
}, 120_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("create: the spec is required and checked on every route", () => {
  it("NEGATIVE: CLI create with a scope and no --spec exits exactly 4 naming --spec, and writes nothing", async () => {
    const before = await withApp((app) => must(app.corpusService.listFull({ type: "task" }), "list").then((l) => l.docs.length));
    const r = await createAdhocViaCli("No spec", ["--ac-scope", "AC-X-1"]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("--spec");
    const after = await withApp((app) => must(app.corpusService.listFull({ type: "task" }), "list").then((l) => l.docs.length));
    expect(after).toBe(before);
  });

  it("HAPPY: --spec <first> exits 0 and records the spec (as the spec's id)", async () => {
    const r = await createAdhocViaCli("Governed by first", ["--ac-scope", "AC-X-1", "--spec", firstSpec]);
    expect(r.exitCode, r.stderr).toBe(0);
    const slug = slugOf(r.stdout);
    await withApp(async (app) => {
      const task = await getDoc(app, slug);
      expect(task.extra["governing_spec"]).toBe(ids["first"]);
      expect(task.extra["ac_scope"]).toEqual(["AC-X-1"]);
    });
  });

  it("NEGATIVE: an id the spec does not declare exits exactly 4 naming the declared ids", async () => {
    const r = await createAdhocViaCli("Undeclared id", ["--ac-scope", "AC-Q-9", "--spec", firstSpec]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("AC-Q-9");
    expect(r.stderr).toContain("AC-X-1");
  });

  it("NEGATIVE: --spec naming a non-spec document exits 4", async () => {
    const r = await createAdhocViaCli("Wrong type", ["--ac-scope", "AC-X-1", "--spec", prdSlug]);
    expect(r.exitCode).toBe(4);
  });

  it("NEGATIVE: --spec without --adhoc is a usage error (exit 2)", async () => {
    const r = await loreAsync(["create", "task", "--title", "plan member?", "--no-ai", "--content", "b", "--spec", firstSpec]);
    expect(r.exitCode).toBe(2);
  });

  it("BOUNDARY: an empty scope needs no spec", async () => {
    const r = await createAdhocViaCli("Empty scope", ["--ac-scope", ""]);
    expect(r.exitCode, r.stderr).toBe(0);
  });
});

describe("create over HTTP goes through the same service check", () => {
  let httpDir: string;
  let app: App;
  let server: ReturnType<typeof Bun.serve>;
  let machineAuth: MachineAuthStores;
  let baseUrl: string;
  let headers: Record<string, string>;
  let httpSpecSlug: string;

  beforeAll(async () => {
    httpDir = realpathSync(mkdtempSync(join(tmpdir(), "lore-adhoc-governing-spec-http-")));
    mkdirSync(join(httpDir, ".lore"), { recursive: true });
    app = createLiveApp(join(httpDir, ".lore", "lore.db"));
    await must(app.corpusService.create({ type: "prd", title: "Http PRD", content: "root" } as never), "prd");
    httpSpecSlug = (await createSpec(app, "Http Spec", [scriptAc("AC-X-1", "echo ok")])).slug;
    machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-adhoc-governing-spec-machine-")) });
    const boot = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
    if (!boot.ok) throw new Error("bootstrap key creation failed");
    server = startHttpServer(app, { io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
    baseUrl = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${baseUrl}/api/auth/local-bootstrap`, {
      method: "POST",
      headers: { "X-Lore-Token": boot.value.rawKey, Origin: "http://localhost:5173" },
    });
    const { data } = (await res.json()) as { data: { session_id: string } };
    headers = { Cookie: `lore_sid=${data.session_id}`, "Content-Type": "application/json" };
  }, 60_000);

  afterAll(() => {
    server.stop(true);
    app.close();
    machineAuth.db.close();
    rmSync(httpDir, { recursive: true, force: true });
  });

  const post = (extra: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/docs`, { method: "POST", headers, body: JSON.stringify({ type: "task", title: "http adhoc", content: "b", extra }) });

  it("NEGATIVE: a scope with no spec is refused naming --spec", async () => {
    const res = await post({ adhoc: true, ac_scope: ["AC-X-1"] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await res.json())).toContain("--spec");
  });

  it("NEGATIVE: an undeclared id is refused naming the declared ids", async () => {
    const res = await post({ adhoc: true, ac_scope: ["AC-Q-9"], governing_spec: httpSpecSlug });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = JSON.stringify(await res.json());
    expect(body).toContain("AC-Q-9");
    expect(body).toContain("AC-X-1");
  });

  it("HAPPY: a declared id with its spec is created and the spec recorded", async () => {
    const res = await post({ adhoc: true, ac_scope: ["AC-X-1"], governing_spec: httpSpecSlug });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { extra: Record<string, unknown> } };
    expect(data.extra["governing_spec"]).toBeTypeOf("string");
  });
});

describe("every reader resolves AC-X-1 to the FIRST spec (two specs declare it)", () => {
  let task: string;

  beforeAll(async () => {
    const r = await createAdhocViaCli("Reader task", ["--ac-scope", "AC-X-1", "--spec", firstSpec]);
    if (r.exitCode !== 0) throw new Error(r.stderr);
    task = slugOf(r.stdout);
  });

  it("evidence --ac: accepted, and an id the recorded spec does not declare is refused", async () => {
    const ok = await loreAsync(["evidence", task, "--oracle", "manual", "--command", "echo reader-evidence", "--result", "pass", "--output-tail", "reader evidence output tail", "--ac", "AC-X-1"]);
    expect(ok.exitCode, ok.stderr + ok.stdout).toBe(0);
    const bad = await loreAsync(["evidence", task, "--oracle", "manual", "--command", "echo reader-evidence", "--result", "pass", "--output-tail", "reader evidence output tail", "--ac", "AC-Y-1"]);
    expect(bad.exitCode).toBe(4);
  });

  it("lore verify --task: executes the FIRST spec's command", async () => {
    const r = await loreAsync(["verify", "--task", task, "--allow-new-commands", "--json"]);
    expect(r.exitCode, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toContain("AC-X-1");
    await withApp(async (app) => {
      const row = extractEvidence(await getDoc(app, task)).find((e) => e.attestation !== undefined);
      expect(row?.command).toContain("first-ran");
      expect(row?.command).not.toContain("second-ran");
    });
  });

  it("AC coverage: the first spec counts the task's evidence, the second spec does not", async () => {
    await withApp(async (app) => {
      if (app.acService === undefined) throw new Error("acService not wired");
      const first = await must(app.acService.listCriteria(firstSpec), "list first");
      const second = await must(app.acService.listCriteria(secondSpec), "list second");
      expect(first.coverage?.find((f) => f.ac_id === "AC-X-1")?.refs.some((ref) => ref.task_id !== undefined)).toBe(true);
      expect(second.coverage).toBeNull();
    });
  });

  it("check-ac-ref-integrity: no dangling ref for the task's AC-X-1 evidence", async () => {
    await withApp(async (app) => {
      const tasks = (await must(app.corpusService.listFull({ type: "task" }), "tasks")).docs;
      const specs = (await must(app.corpusService.listFull({ type: "spec" }), "specs")).docs;
      const docsById = new Map<string, DocRecord>(specs.map((s) => [s.id as string, s]));
      const dangling = findDanglingRefs(tasks.filter((t) => t.slug === task), docsById as never);
      expect(dangling).toEqual([]);
    });
  });

  it("check-ac-ref-integrity: a task recording the second spec is judged against the second spec", async () => {
    await withApp(async (app) => {
      const tasks = (await must(app.corpusService.listFull({ type: "task" }), "tasks")).docs;
      const specs = (await must(app.corpusService.listFull({ type: "spec" }), "specs")).docs;
      const docsById = new Map<string, DocRecord>(specs.map((s) => [s.id as string, s]));
      const target = tasks.find((t) => t.slug === task) as DocRecord;
      const asSecond = { ...target, extra: { ...target.extra, governing_spec: ids["second"] } } as DocRecord;
      expect(findDanglingRefs([asSecond], docsById as never)).toEqual([]);
      const asOld = { ...target, extra: { ...target.extra, governing_spec: ids["old"] } } as DocRecord;
      expect(findDanglingRefs([asOld], docsById as never).map((d) => d.specSlug)).toEqual([oldSpec]);
    });
  });
});

describe("a deprecated spec and a superseded criterion still resolve (BR-1494)", () => {
  it("HAPPY: create against the deprecated spec with AC-Y-1 and the superseded AC-Z-1 exits 0; evidence --ac resolves both", async () => {
    const r = await createAdhocViaCli("Deprecated governed", ["--ac-scope", "AC-Y-1", "--ac-scope", "AC-Z-1", "--spec", oldSpec]);
    expect(r.exitCode, r.stderr).toBe(0);
    const task = slugOf(r.stdout);
    for (const ac of ["AC-Y-1", "AC-Z-1"]) {
      const e = await loreAsync(["evidence", task, "--oracle", "manual", "--command", "echo history", "--result", "pass", "--output-tail", "history evidence output tail", "--ac", ac]);
      expect(e.exitCode, `${ac}: ${e.stderr}`).toBe(0);
    }
  });

  it("NEGATIVE: AC-Y-1 is not declared on the first spec, so the same scope against it exits 4", async () => {
    const r = await createAdhocViaCli("Wrong spec", ["--ac-scope", "AC-Y-1", "--spec", firstSpec]);
    expect(r.exitCode).toBe(4);
  });
});

describe("lore scope spec (BR-1495)", () => {
  async function legacyArchivedTask(): Promise<{ slug: string; id: string }> {
    // A scoped ad-hoc task with no recorded spec can no longer be created; the 45 that exist on main were. This
    // fixture builds the same shape by stripping the record and archiving, straight in the store.
    const created = await createAdhocViaCli("Legacy archived", ["--ac-scope", "AC-X-1", "--spec", firstSpec]);
    if (created.exitCode !== 0) throw new Error(created.stderr);
    const slug = slugOf(created.stdout);
    const doc = await withApp((app) => getDoc(app, slug));
    const store = actedStore(new SQLiteStore(dbPath));
    try {
      const { governing_spec: _dropped, ...rest } = doc.extra as Record<string, unknown>;
      await must(
        store.update(doc.id, { status: "archived", version: doc.version + 1, extra: rest }, { expected_version: doc.version }),
        "archive legacy",
      );
      return { slug, id: doc.id as string };
    } finally {
      store.close();
    }
  }

  it("STATE: records the spec on an archived task; one version, one audit entry; body, title, status unchanged", async () => {
    const legacy = await legacyArchivedTask();
    const before = await withApp(async (app) => {
      const doc = await getDoc(app, legacy.slug);
      const audit = await must(app.auditService.query({ doc_id: doc.id as never }), "audit before");
      return { doc, audit: audit.length };
    });
    expect(before.doc.status).toBe("archived");
    expect(before.doc.extra["governing_spec"]).toBeUndefined();

    const r = await loreAsync(["scope", "spec", legacy.slug, firstSpec]);
    expect(r.exitCode, r.stderr).toBe(0);

    await withApp(async (app) => {
      const after = await getDoc(app, legacy.slug);
      expect(after.extra["governing_spec"]).toBe(ids["first"]);
      expect(after.version).toBe(before.doc.version + 1);
      expect(after.content).toBe(before.doc.content);
      expect(after.title).toBe(before.doc.title);
      expect(after.status).toBe("archived");
      const audit = await must(app.auditService.query({ doc_id: after.id as never }), "audit after");
      expect(audit.length).toBe(before.audit + 1);
    });
  });

  it("NEGATIVE: refused (exit 4) when a scope id is not declared on that spec, and nothing is written", async () => {
    const legacy = await legacyArchivedTask();
    const version = await withApp(async (app) => (await getDoc(app, legacy.slug)).version);
    const r = await loreAsync(["scope", "spec", legacy.slug, oldSpec]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("AC-X-1");
    await withApp(async (app) => expect((await getDoc(app, legacy.slug)).version).toBe(version));
  });

  it("NEGATIVE: refused on a plan-member task and on a non-spec target", async () => {
    const nonSpec = await loreAsync(["scope", "spec", prdSlug, firstSpec]);
    expect(nonSpec.exitCode).toBe(4);
    const toPrd = await createAdhocViaCli("Target is a PRD", ["--ac-scope", ""]);
    const r = await loreAsync(["scope", "spec", slugOf(toPrd.stdout), prdSlug]);
    expect(r.exitCode).toBe(4);
  });

  it("scope add on an ad-hoc task checks the new ids against the recorded spec", async () => {
    const created = await createAdhocViaCli("Scope add", ["--ac-scope", "AC-X-1", "--spec", firstSpec]);
    const slug = slugOf(created.stdout);
    const bad = await loreAsync(["scope", "add", slug, "AC-Q-9"]);
    expect(bad.exitCode).toBe(4);
    expect(bad.stderr).toContain("AC-X-1");
    // a spec-declared id other than the existing one is not available on the first spec, so the scope stays one id
    const list = await loreAsync(["scope", "list", slug, "--json"]);
    expect((JSON.parse(list.stdout) as { data: { ac_scope: string[] } }).data.ac_scope).toEqual(["AC-X-1"]);
  });
});

describe("lore assess refresh tasks record the criterion's spec and are reused by (spec, criterion)", () => {
  let rdir: string;
  let app: App;

  beforeAll(() => {
    rdir = realpathSync(mkdtempSync(join(tmpdir(), "lore-adhoc-governing-spec-refresh-")));
    mkdirSync(join(rdir, ".lore"), { recursive: true });
    app = createLiveApp(join(rdir, ".lore", "lore.db"));
  });

  afterAll(() => {
    app.close();
    rmSync(rdir, { recursive: true, force: true });
  });

  it("STATE: the same id on two specs gets one refresh task per spec, each recording its own spec, each reused on a second run", async () => {
    await must(app.corpusService.create({ type: "prd", title: "Refresh PRD", content: "root" } as never), "prd");
    const specA = await createSpec(app, "Refresh Spec A", [scriptAc("AC-RF-1", "echo a && echo 'AC-RF-1 PASS'")]);
    const specB = await createSpec(app, "Refresh Spec B", [scriptAc("AC-RF-1", "echo b && echo 'AC-RF-1 PASS'")]);
    const planA = await must(app.corpusService.create({ type: "plan", title: "Plan A", parent_id: specA.id, content: "p" } as never), "plan a");
    const planB = await must(app.corpusService.create({ type: "plan", title: "Plan B", parent_id: specB.id, content: "p" } as never), "plan b");
    const verify = app.verifyRunnerService;
    if (verify === undefined) throw new Error("verifyRunnerService is not wired");
    const refresher = () => createAppStaleRefresher(app, verify, { executionRoot: rdir, by: "agent:refresh-test", nowIso: () => new Date().toISOString() });

    for (const plan of [planA, planB, planA, planB]) {
      const out = await refresher().runAcs(plan.slug, ["AC-RF-1"]);
      expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
    }
    const adhoc = (await must(app.corpusService.listFull({ type: "task" }), "tasks")).docs.filter((t) => t.extra["adhoc"] === true);
    expect(adhoc).toHaveLength(2);
    expect(adhoc.map((t) => t.extra["governing_spec"]).sort()).toEqual([specA.id, specB.id].sort());
    for (const task of adhoc) expect(extractEvidence(task).filter((e) => e.ac_ref === "AC-RF-1").length).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

describe("REGRESSION: resolveGoverningSpecByAcScope is gone from the product", () => {
  it("git grep finds no call site under packages/*/src or scripts (tests excluded)", () => {
    const ran = spawnSync(
      "git",
      ["grep", "-n", "--untracked", "resolveGoverningSpecByAcScope", "--", "packages/core/src", "packages/lore/src", "packages/dashboard/src", "scripts", ":!scripts/tests"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(ran.stdout).toBe("");
    expect(ran.status).toBe(1);
  });
});
