// @reads assets/project/lore-config-template.yaml
// @reads .lore/config.yaml
// @spawns packages/lore/src/index.ts -- the gh-issue-stub helper and runSpawned start the CLI entry in a child bun process
/**
 * done-contract-approve-compiled.bun.test.ts — the done contract compiled at approve, observed through the `lore` command tree
 * on throwaway repositories and corpora (spec-done-contract-compiled-at-approve-task-kinds-write-sets).
 *
 * This file grows task by task; it holds the criteria of the tasks before and including the one that owns the newest block, so
 * it passes whole at every task's tip. Each test name starts with `AC-DCS1-<n>:` (with the colon) so `-t 'AC-DCS1-1:'` never
 * matches AC-DCS1-10.
 *
 *   Task "kind, config keys and the create and set surfaces":
 *     AC-DCS1-4  the task kind is required on every creation path and immutable once the task is approved
 *     AC-DCS1-9  the three `workflow.done_contract.*` config keys are validated and set for this repository
 *   Task "approve compiles and stores the done-contract":
 *     AC-DCS1-1  approve stores the compiled contract; claim prints it
 *     AC-DCS1-2  an uncompilable contract is refused with every cause and nothing is written
 *     AC-DCS1-5  the red run is waived once at approve (--red-waiver)
 *     AC-DCS1-4  (also) the dashboard create route requires a kind
 *
 * Oracle: the command tree in-process (`runLoreInProcess`, the function the binary's entry calls) over `mkdtemp` + `lore init`
 * in a clean git repository, HOME outside every repository; the repository's own `.lore/` is only READ (AC-DCS1-9 reads its
 * config), never written.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as yaml from "yaml";
import { createApp, type App } from "../../src/app";
import { handleApiRoute } from "../../src/adapters/http/routes";
import { handleDashboardRoute } from "../../src/adapters/http/dashboard-routes";
import { liveAmbient, liveWriteContext } from "../live-invocation";
import { DONE_CONTRACT_CONFIG, makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { cleanDirs, makeIssueFixture, STUB_REPO_ID, type IssueFixture } from "../helpers/gh-issue-stub";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { dropLoreConfigKey, patchLoreConfig, readLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

// tests/e2e/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const THREE_KINDS = ["code", "check", "corpus"] as const;

/** Every one of the three kinds appears in `text`. */
function namesAllKinds(text: string): boolean {
  return THREE_KINDS.every((kind) => text.includes(kind));
}

let fixture: DoneContractFixture;
let plan = "";

beforeAll(async () => {
  // reason: this file's criteria so far are about the kind and the config keys; the corpus setup must not depend on the
  // config schema AC-DCS1-9 tests, so the keys are written by that test's own cases.
  fixture = await makeDoneContractFixture({ seedDoneContractConfig: false });
  plan = await fixture.createPlan("Kind plan");
});

afterAll(() => {
  fixture.dispose();
});

/** How many docs of a type the corpus holds. */
async function countDocs(type: string): Promise<number> {
  const listed = JSON.parse(await fixture.mustRun(["list", "--type", type, "--json"])) as { data: unknown };
  const data = listed.data as { docs?: unknown[] } | unknown[];
  return Array.isArray(data) ? data.length : (data.docs ?? []).length;
}

async function docId(slug: string): Promise<string> {
  return (await fixture.readTask(slug)).id;
}

/** The real application over the fixture corpus, for the HTTP routes (the same App `lore serve` mounts). */
function openApp(): App {
  return createApp(join(fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
}

const HTTP_ACTOR = { name: "test-agent", session_id: "done-contract-http" } as const;

async function httpJson(method: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const app = openApp();
  try {
    const url = new URL(`http://localhost${path}`);
    const req = new Request(url.toString(), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const res = await handleApiRoute(req, url, app, HTTP_ACTOR);
    if (res === null) throw new Error(`no route answered ${method} ${path}`);
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  } finally {
    app.close();
  }
}

/** One request to the dashboard route table as a cookie session (the only kind of caller that may write there). */
async function dashboardJson(method: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const app = openApp();
  try {
    const url = new URL(`http://localhost${path}`);
    const req = new Request(url.toString(), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const res = await handleDashboardRoute(req, url, app, { name: "test-user", session_id: "done-contract-dashboard", callerSurface: "http_cookie" });
    if (res === null) throw new Error(`no dashboard route answered ${method} ${path}`);
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  } finally {
    app.close();
  }
}

describe("AC-DCS1-4: the task kind is required at create and immutable once approved", () => {
  it("AC-DCS1-4: lore create task without --kind exits 2 naming code, check and corpus together with the other missing flags, and writes nothing", async () => {
    const before = await countDocs("task");
    // Neither --plan-id nor --kind: ONE message names both flags and the three kinds.
    const both = await fixture.run(["create", "task", "--title", "No kind, no plan", "--content", "x", "--no-ai"]);
    expect(both.exitCode, both.stderr).toBe(2);
    expect(both.stderr).toContain("--plan-id");
    expect(both.stderr).toContain("--kind");
    expect(namesAllKinds(both.stderr), both.stderr).toBe(true);
    expect(both.stdout).toBe("");

    // A plan but no kind: the false green is a default kind of `code`, which would exit 0 here.
    const kindOnly = await fixture.run(["create", "task", "--title", "No kind", "--plan-id", plan, "--ac-scope", "", "--content", "x", "--no-ai"]);
    expect(kindOnly.exitCode, kindOnly.stderr).toBe(2);
    expect(kindOnly.stderr).toContain("--kind");
    expect(namesAllKinds(kindOnly.stderr), kindOnly.stderr).toBe(true);

    // An --adhoc task relaxes --plan-id and --parent only; the kind stays required.
    const adhoc = await fixture.run(["create", "task", "--title", "Adhoc no kind", "--adhoc", "--ac-scope", "", "--content", "x", "--no-ai"]);
    expect(adhoc.exitCode, adhoc.stderr).toBe(2);
    expect(namesAllKinds(adhoc.stderr), adhoc.stderr).toBe(true);

    expect(await countDocs("task")).toBe(before);
  });

  it("AC-DCS1-4: --kind with a value outside the three kinds exits 2 and writes nothing", async () => {
    const before = await countDocs("task");
    for (const bad of ["Code", "test", "spec", " "]) {
      const result = await fixture.run(["create", "task", "--title", `Bad kind ${bad}`, "--plan-id", plan, "--kind", bad, "--ac-scope", "", "--content", "x", "--no-ai"]);
      expect(result.exitCode, `--kind '${bad}': ${result.stderr}`).toBe(2);
      expect(namesAllKinds(result.stderr), result.stderr).toBe(true);
    }
    expect(await countDocs("task")).toBe(before);
  });

  it("AC-DCS1-4: with --kind the task stores extra.kind (each of the three kinds, and an --adhoc task)", async () => {
    for (const kind of THREE_KINDS) {
      const slug = await fixture.createTask({ plan, kind, title: `Stored ${kind}` });
      expect((await fixture.readTask(slug)).extra["kind"]).toBe(kind);
    }
    const adhocOut = await fixture.mustRun(["create", "task", "--title", "Adhoc check", "--adhoc", "--kind", "check", "--ac-scope", "", "--content", "x", "--no-ai"]);
    const adhocSlug = adhocOut.match(/Slug:\s+(\S+)/)?.[1] ?? "";
    expect((await fixture.readTask(adhocSlug)).extra["kind"]).toBe("check");
  });

  it("AC-DCS1-4: lore set <draft task> --kind exits 0 and changes it, keeping the other extra keys; an unknown kind exits 2", async () => {
    const slug = await fixture.createTask({ plan, kind: "code", title: "Draft kind change", anchors: ["src/draft-kind.ts"] });
    const before = await fixture.readTask(slug);
    const changed = await fixture.run(["set", slug, "--kind", "check"]);
    expect(changed.exitCode, changed.stderr).toBe(0);
    const after = await fixture.readTask(slug);
    expect(after.extra["kind"]).toBe("check");
    expect(after.extra["file_anchors"]).toEqual(before.extra["file_anchors"]);
    expect(after.extra["plan_id"]).toBe(before.extra["plan_id"]);

    const bad = await fixture.run(["set", slug, "--kind", "nonsense"]);
    expect(bad.exitCode, bad.stderr).toBe(2);
    expect(namesAllKinds(bad.stderr), bad.stderr).toBe(true);
    expect((await fixture.readTask(slug)).extra["kind"]).toBe("check");
  });

  it("AC-DCS1-4: lore set <approved task> --kind exits 4 with kind-locked naming the writer verb, and the kind is unchanged", async () => {
    // reason: approving a code task compiles its contract (AC-DCS1-1), which needs the three config keys.
    fixture.setDoneContractConfig(DONE_CONTRACT_CONFIG);
    const slug = await fixture.createTask({ plan, kind: "code", title: "Approved kind lock" });
    await fixture.mustRun(["approve", slug]);
    expect((await fixture.readTask(slug)).status).toBe("approved");
    const versionBefore = (await fixture.readTask(slug)).version;

    const refused = await fixture.run(["set", slug, "--kind", "corpus"]);
    expect(refused.exitCode, refused.stderr).toBe(4);
    expect(refused.stderr).toContain("kind-locked");
    expect(refused.stderr).toContain("lore set <task> --kind");

    const after = await fixture.readTask(slug);
    expect(after.extra["kind"]).toBe("code");
    expect(after.version).toBe(versionBefore);
  });

  it("AC-DCS1-4: a wholesale set of extra with another kind or a done_contract is refused through the HTTP edit route and the service (kind-locked, done-contract-locked)", async () => {
    fixture.setDoneContractConfig(DONE_CONTRACT_CONFIG);
    const slug = await fixture.createTask({ plan, kind: "code", title: "Wholesale lock" });
    await fixture.mustRun(["approve", slug]);
    const approved = await fixture.readTask(slug);
    const id = approved.id;

    // The HTTP edit route replaces `extra` wholesale.
    const otherKind = await httpJson("PATCH", `/api/docs/${id}`, { extra: { ...approved.extra, kind: "check" } });
    expect(otherKind.status).toBe(422);
    expect(JSON.stringify(otherKind.json)).toContain("kind-locked");

    const contract = { compiled_at_commit: "0".repeat(40), kind: "code", base_branch: "main", oracles: [], red_required: true, landing_route: "main", new_symbols: [], added_oracles: [] };
    const withContract = await httpJson("PATCH", `/api/docs/${id}`, { extra: { ...approved.extra, done_contract: contract } });
    expect(withContract.status).toBe(422);
    expect(JSON.stringify(withContract.json)).toContain("done-contract-locked");

    // The same refusal at the service, which every surface reaches.
    const app = openApp();
    try {
      const serviceResult = await app.corpusService.set(id, { extra: { ...approved.extra, kind: "corpus" } });
      expect(serviceResult.ok).toBe(false);
      expect(JSON.stringify(serviceResult)).toContain("kind-locked");
    } finally {
      app.close();
    }

    // Echoing the stored extra byte-equal stays allowed, and nothing above changed the task.
    const echoed = await httpJson("PATCH", `/api/docs/${id}`, { extra: approved.extra });
    expect(echoed.status).toBe(200);
    expect((await fixture.readTask(slug)).extra["kind"]).toBe("code");
    // the contract is the one the approve compiled, never the one the refused sets carried.
    expect((await fixture.readTask(slug)).extra["done_contract"]).toEqual(approved.extra["done_contract"]);
    expect((approved.extra["done_contract"] as { compiled_at_commit: string }).compiled_at_commit).not.toBe("0".repeat(40));
  });

  it("AC-DCS1-4: a draft task's done_contract cannot be written by a wholesale set either, but its kind can", async () => {
    const slug = await fixture.createTask({ plan, kind: "code", title: "Draft wholesale" });
    const draft = await fixture.readTask(slug);
    const contract = { compiled_at_commit: "0".repeat(40), kind: "code", base_branch: "main", oracles: [], red_required: true, landing_route: "main", new_symbols: [], added_oracles: [] };
    const refused = await httpJson("PATCH", `/api/docs/${draft.id}`, { extra: { ...draft.extra, done_contract: contract } });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.json)).toContain("done-contract-locked");

    const allowed = await httpJson("PATCH", `/api/docs/${draft.id}`, { extra: { ...draft.extra, kind: "corpus" } });
    expect(allowed.status).toBe(200);
    expect((await fixture.readTask(slug)).extra["kind"]).toBe("corpus");
  });

  it("AC-DCS1-4: the HTTP create route answers 400 naming the three kinds without a kind, and stores extra.kind when given", async () => {
    const planId = await docId(plan);
    const before = await countDocs("task");
    const base = { type: "task", title: "HTTP task", content: "x", parent_id: planId };

    const missing = await httpJson("POST", "/api/docs", { ...base, extra: { plan_id: planId, ac_scope: [] } });
    expect(missing.status).toBe(400);
    expect(namesAllKinds(JSON.stringify(missing.json)), JSON.stringify(missing.json)).toBe(true);

    const unknown = await httpJson("POST", "/api/docs", { ...base, extra: { plan_id: planId, ac_scope: [], kind: "test" } });
    expect(unknown.status).toBe(400);
    expect(await countDocs("task")).toBe(before);

    const inExtra = await httpJson("POST", "/api/docs", { ...base, title: "HTTP task extra kind", extra: { plan_id: planId, ac_scope: [], kind: "check" } });
    expect(inExtra.status, JSON.stringify(inExtra.json)).toBe(201);
    const topLevel = await httpJson("POST", "/api/docs", { ...base, title: "HTTP task top kind", kind: "corpus", extra: { plan_id: planId, ac_scope: [] } });
    expect(topLevel.status, JSON.stringify(topLevel.json)).toBe(201);
    expect(await countDocs("task")).toBe(before + 2);

    // A document that is not a task needs no kind.
    const knowledge = await httpJson("POST", "/api/docs", { type: "knowledge", title: "No kind needed", content: "x", parent_id: planId, extra: { sub_type: "research" } });
    expect(knowledge.status, JSON.stringify(knowledge.json)).toBe(201);
  });

  describe("AC-DCS1-4: lore issue adopt", () => {
    const dirsToClean: string[] = [];
    let issues: IssueFixture;
    afterAll(() => cleanDirs(dirsToClean));

    it("AC-DCS1-4: without --kind exits 2 naming the three kinds and creates nothing; with --kind the carrier stores extra.kind", async () => {
      issues = await makeIssueFixture([{ number: 1 }, { number: 2 }], { dirsToClean });
      const tasksOf = async (): Promise<number> => {
        const listed = JSON.parse((await issues.run(["list", "--type", "task", "--json"], "reader")).stdout) as { data: unknown };
        const data = listed.data as { docs?: unknown[] } | unknown[];
        return Array.isArray(data) ? data.length : (data.docs ?? []).length;
      };
      const before = await tasksOf();

      const without = await issues.run(["issue", "adopt", "1"]);
      expect(without.exitCode, without.stderr).toBe(2);
      expect(namesAllKinds(without.stderr), without.stderr).toBe(true);
      const unknownKind = await issues.run(["issue", "adopt", "1", "--kind", "spec"]);
      expect(unknownKind.exitCode, unknownKind.stderr).toBe(2);
      expect(await tasksOf()).toBe(before);

      const given = await issues.run(["issue", "adopt", "1", "--kind", "code"]);
      expect(given.exitCode, given.stderr + given.stdout).toBe(0);
      const slug = `task-issue-${STUB_REPO_ID}-1`;
      const doc = JSON.parse((await issues.run(["get", slug, "--json"], "reader")).stdout) as { data: { doc?: { extra: Record<string, unknown> }; extra?: Record<string, unknown> } };
      expect((doc.data.doc ?? doc.data).extra?.["kind"]).toBe("code");
      expect(await tasksOf()).toBe(before + 1);
    });
  });
});

describe("AC-DCS1-9: the three done_contract config keys are validated and set for this repository", () => {
  const workflowOf = (text: string): Record<string, unknown> => {
    const parsed = yaml.parse(text) as { workflow?: { done_contract?: Record<string, unknown> } };
    return parsed.workflow?.done_contract ?? {};
  };

  it("AC-DCS1-9: this repository's .lore/config.yaml sets the three keys to the expected commands", () => {
    const own = workflowOf(readFileSync(join(PROJECT_ROOT, ".lore", "config.yaml"), "utf8"));
    expect(own).toEqual({
      install: "bun install --frozen-lockfile",
      typecheck: "bun run typecheck",
      test_file: "bun run test:file {file}",
    });
  });

  it("AC-DCS1-9: the project config template carries the three keys, commented, and a fresh `lore init` corpus holds them", async () => {
    const templateText = readFileSync(join(PROJECT_ROOT, "assets", "project", "lore-config-template.yaml"), "utf8");
    const fromTemplate = workflowOf(templateText);
    for (const key of ["install", "typecheck", "test_file"]) {
      expect(typeof fromTemplate[key], `template key ${key}`).toBe("string");
      expect((fromTemplate[key] as string).length).toBeGreaterThan(0);
    }
    expect(fromTemplate["test_file"]).toContain("{file}");
    // "commented": a comment line introduces the block.
    expect(templateText).toMatch(/#[^\n]*done contract[^\n]*\n(?:\s*#[^\n]*\n)*\s*done_contract:/i);

    const dir = mkdtempSync(join(tmpdir(), "lore-done-contract-template-"));
    try {
      const { makeCleanTreeRepo } = await import("../helpers/clean-tree-repo");
      makeCleanTreeRepo(dir);
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
      const init = await runLoreInProcess(["init"], { cwd: dir, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, HOME: FIXTURE_HOME_OUTSIDE_REPO } });
      expect(init.exitCode, init.stderr).toBe(0);
      const seeded = (readLoreConfig(dir)["workflow"] as { done_contract?: Record<string, unknown> } | undefined)?.done_contract;
      expect(seeded).toEqual(fromTemplate);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-DCS1-9: any command against a config with an empty, non-string or {file}-less value exits 4 naming the key; a valid config exits 0", async () => {
    const valid = { install: "bun install --frozen-lockfile", typecheck: "bun run typecheck", test_file: "bun run test:file {file}" };
    const cases: ReadonlyArray<{ readonly key: string; readonly value: unknown; readonly why: string }> = [
      { key: "typecheck", value: "", why: "a blank typecheck" },
      { key: "install", value: "", why: "a blank install" },
      { key: "test_file", value: "", why: "a blank test_file" },
      { key: "typecheck", value: 5, why: "a number, not a string" },
      { key: "install", value: ["bun", "install"], why: "a list, not a string" },
      { key: "test_file", value: "bun run test:file", why: "a test_file without {file}" },
    ];
    try {
      for (const { key, value, why } of cases) {
        patchLoreConfig(fixture.dir, { workflow: { done_contract: { ...valid, [key]: value } } });
        const result = await fixture.run(["list", "--type", "task"]);
        expect(result.exitCode, `${why}: ${result.stderr}`).toBe(4);
        expect(result.stderr, `${why} must name the key`).toContain(key);
      }
      patchLoreConfig(fixture.dir, { workflow: { done_contract: { ...valid } } });
      const ok = await fixture.run(["list", "--type", "task"]);
      expect(ok.exitCode, ok.stderr).toBe(0);
    } finally {
      // back to the state of the other tests: no keys (the fixture of this file seeds none).
      dropLoreConfigKey(fixture.dir, ["workflow", "done_contract"]);
    }
  });
});

describe("AC-DCS1-3: --falsifier-new-symbol marks a falsifier whose literal does not exist yet", () => {
  const FALSIFIER_FLAGS = ["--falsifier-path", "src/new-thing.ts", "--falsifier-find", "NEW_THING", "--falsifier-replace", "", "--falsifier-exit-code", "7"] as const;
  const SCRIPT_BASE = ["--mode", "script", "--oracle", "test", "--command", "echo dcs13"] as const;
  const FOUR_FLAGS = ["--falsifier-path", "--falsifier-find", "--falsifier-replace", "--falsifier-exit-code"] as const;

  async function listedVerify(id: string): Promise<Record<string, unknown>> {
    const listed = JSON.parse(await fixture.mustRun(["ac", "list", fixture.spec, "--json"])) as {
      data: { criteria: Array<{ id: string; verify: Record<string, unknown> }> };
    };
    const found = listed.data.criteria.find((c) => c.id === id);
    if (found === undefined) throw new Error(`criterion ${id} not listed`);
    return found.verify;
  }

  async function listedFalsifier(id: string): Promise<Record<string, unknown>> {
    return (await listedVerify(id))["falsifier"] as Record<string, unknown>;
  }

  it("AC-DCS1-3: ac add with the flag and the four falsifier flags stores new_symbol true, which ac list prints (JSON and readable)", async () => {
    await fixture.mustRun(["ac", "add", fixture.spec, "AC-NS-1", "--statement", "Marked.", ...SCRIPT_BASE, ...FALSIFIER_FLAGS, "--falsifier-new-symbol"]);
    const falsifier = await listedFalsifier("AC-NS-1");
    expect(falsifier["new_symbol"]).toBe(true);
    expect(falsifier["path"]).toBe("src/new-thing.ts");
    expect(falsifier["expected_exit_code"]).toBe(7);
    const readable = await fixture.mustRun(["ac", "list", fixture.spec]);
    const line = readable.split("\n").find((l) => l.includes("AC-NS-1")) ?? "";
    expect(line, readable).toContain("new_symbol");
  });

  it("AC-DCS1-3: an AC added without the flag carries no new_symbol key and its readable line has no mark (the false green: the flag stored on every falsifier)", async () => {
    await fixture.mustRun(["ac", "add", fixture.spec, "AC-NS-2", "--statement", "Unmarked.", ...SCRIPT_BASE, ...FALSIFIER_FLAGS]);
    const falsifier = await listedFalsifier("AC-NS-2");
    expect(Object.keys(falsifier)).not.toContain("new_symbol");
    const readable = await fixture.mustRun(["ac", "list", fixture.spec]);
    const line = readable.split("\n").find((l) => l.includes("AC-NS-2")) ?? "";
    expect(line, readable).not.toContain("new_symbol");
  });

  it("AC-DCS1-3: ac set with the flag and the four flags stores it; a later set of the four without the flag clears it", async () => {
    await fixture.mustRun(["ac", "set", fixture.spec, "AC-NS-2", ...FALSIFIER_FLAGS, "--falsifier-new-symbol"]);
    expect((await listedFalsifier("AC-NS-2"))["new_symbol"]).toBe(true);
    await fixture.mustRun(["ac", "set", fixture.spec, "AC-NS-2", ...FALSIFIER_FLAGS]);
    expect(Object.keys(await listedFalsifier("AC-NS-2"))).not.toContain("new_symbol");
  });

  it("AC-DCS1-3: --falsifier-new-symbol without the four flags exits 2 naming them and writes nothing (add and set)", async () => {
    const versionBefore = (await fixture.readTask(fixture.spec)).version;
    const verifyBefore = JSON.stringify(await listedVerify("AC-NS-1"));

    const addAlone = await fixture.run(["ac", "add", fixture.spec, "AC-NS-3", "--statement", "Alone.", ...SCRIPT_BASE, "--falsifier-new-symbol"]);
    expect(addAlone.exitCode, addAlone.stderr).toBe(2);
    for (const flag of FOUR_FLAGS) expect(addAlone.stderr).toContain(flag);

    const addPartial = await fixture.run(["ac", "add", fixture.spec, "AC-NS-3", "--statement", "Partial.", ...SCRIPT_BASE, "--falsifier-path", "src/x.ts", "--falsifier-new-symbol"]);
    expect(addPartial.exitCode, addPartial.stderr).toBe(2);

    const setAlone = await fixture.run(["ac", "set", fixture.spec, "AC-NS-1", "--falsifier-new-symbol"]);
    expect(setAlone.exitCode, setAlone.stderr).toBe(2);
    for (const flag of FOUR_FLAGS) expect(setAlone.stderr).toContain(flag);

    const listed = JSON.parse(await fixture.mustRun(["ac", "list", fixture.spec, "--json"])) as { data: { criteria: Array<{ id: string }> } };
    expect(listed.data.criteria.map((c) => c.id)).not.toContain("AC-NS-3");
    expect(JSON.stringify(await listedVerify("AC-NS-1"))).toBe(verifyBefore);
    expect((await fixture.readTask(fixture.spec)).version).toBe(versionBefore);
  });
});

describe("AC-DCS1-4: the dashboard create route requires a kind too (BR-1488)", () => {
  it("AC-DCS1-4: POST /api/dashboard/docs for a task without a kind answers 400 naming code, check and corpus; with a kind it stores extra.kind", async () => {
    const planId = await docId(plan);
    const before = await countDocs("task");
    const base = { type: "task", title: "Dashboard task", content: "x", parent_id: planId };

    const missing = await dashboardJson("POST", "/api/dashboard/docs", { ...base, extra: { plan_id: planId, ac_scope: [] } });
    expect(missing.status, JSON.stringify(missing.json)).toBe(400);
    expect(namesAllKinds(JSON.stringify(missing.json)), JSON.stringify(missing.json)).toBe(true);

    const unknown = await dashboardJson("POST", "/api/dashboard/docs", { ...base, extra: { plan_id: planId, ac_scope: [], kind: "test" } });
    expect(unknown.status, JSON.stringify(unknown.json)).toBe(400);
    expect(await countDocs("task")).toBe(before);

    const given = await dashboardJson("POST", "/api/dashboard/docs", { ...base, title: "Dashboard task kind", extra: { plan_id: planId, ac_scope: [], kind: "check" } });
    expect(given.status, JSON.stringify(given.json)).toBe(201);
    const created = (given.json["data"] as { doc?: { slug: string } } | undefined)?.doc ?? (given.json as { doc?: { slug: string } }).doc;
    expect(created?.slug, JSON.stringify(given.json)).toBeDefined();
    expect((await fixture.readTask(created?.slug ?? "")).extra["kind"]).toBe("check");
    expect(await countDocs("task")).toBe(before + 1);

    // A document that is not a task needs no kind.
    const knowledge = await dashboardJson("POST", "/api/dashboard/docs", { type: "knowledge", title: "Dashboard knowledge", content: "x", parent_id: planId, extra: { sub_type: "research" } });
    expect(knowledge.status, JSON.stringify(knowledge.json)).toBe(201);
  });
});

// ─── The compile at approve (AC-DCS1-1, AC-DCS1-2, AC-DCS1-5) ─────────────────────────────────────────────────────

/** The contract as the tests read it back from `extra.done_contract`. */
interface StoredContract {
  readonly compiled_at_commit: string;
  readonly kind: string;
  readonly base_branch: string;
  readonly oracles: ReadonlyArray<{ id: string; command?: string }>;
  readonly install?: string;
  readonly red_required: boolean;
  readonly red_waiver_reason?: string;
  readonly landing_route: string;
  readonly new_symbols: readonly string[];
  readonly added_oracles: readonly unknown[];
}

describe("the done contract compiled at approve", () => {
  let cf: DoneContractFixture;
  let planMain = "";
  let planIntegration = "";
  const INTEGRATION = "dcs1-feature";
  const TEST_FILE = "packages/demo/tests/demo.test.ts";
  const TEST_COMMAND = `bun run test:file ${TEST_FILE}`;

  beforeAll(async () => {
    cf = await makeDoneContractFixture();
    // A second spec whose criterion supersedes one of the first spec's (a superseded criterion gives no oracle).
    await cf.mustRun(["ac", "add", cf.spec, "AC-FX-SUP", "--statement", "Soon superseded.", "--mode", "script", "--oracle", "test", "--command", "echo sup"]);
    const spec2Out = await cf.mustRun(["create", "spec", "--title", "Fixture Spec Two", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"]);
    const spec2 = spec2Out.match(/Slug:\s+(\S+)/)?.[1] ?? "";
    await cf.mustRun(["ac", "add", spec2, "AC-FX2-1", "--statement", "Supersedes.", "--mode", "script", "--oracle", "test", "--command", "echo fx2"]);
    await cf.mustRun(["ac", "supersede", cf.spec, "AC-FX-SUP", "--by", `${spec2}:AC-FX2-1`, "--reason", "Replaced by the second spec."]);

    // The plan's integration branch exists and sits one commit ahead of main, so its tip differs from main's.
    const tree = cf.git(["rev-parse", "HEAD^{tree}"]);
    const ahead = cf.git(["commit-tree", tree, "-p", "HEAD", "-m", "integration tip"]);

    planMain = await cf.createPlan("Plan on main");
    // declaring the branch creates it at main's tip (AC-DCS2-10); the fixture then moves it one commit ahead
    planIntegration = await cf.createPlan("Plan on integration", INTEGRATION);
    cf.git(["branch", "-f", INTEGRATION, ahead]);
  });

  afterAll(() => {
    cf.dispose();
  });

  async function contractOf(slug: string): Promise<StoredContract> {
    const stored = (await cf.readTask(slug)).extra["done_contract"];
    if (stored === undefined) throw new Error(`${slug} holds no done_contract`);
    return stored as StoredContract;
  }

  async function auditCount(slug: string): Promise<number> {
    const parsed = JSON.parse(await cf.mustRun(["audit", slug, "--json"])) as { data: unknown };
    const data = parsed.data as unknown[] | { entries?: unknown[] };
    return Array.isArray(data) ? data.length : (data.entries ?? []).length;
  }

  describe("AC-DCS1-1: approve stores the compiled contract", () => {
    it("AC-DCS1-1: a code task on a plan without an integration branch stores the exact oracle ids and commands (script AC yes; ai, human and superseded ACs none)", async () => {
      const slug = await cf.createTask({
        plan: planMain,
        kind: "code",
        title: "Contract on main",
        anchors: [TEST_FILE, "packages/demo/src/demo.ts"],
        acScope: ["AC-FX-1", "AC-FX-AI", "AC-FX-HUMAN", "AC-FX-SUP"],
      });
      const out = await cf.run(["approve", slug]);
      expect(out.exitCode, out.stderr).toBe(0);

      const task = await cf.readTask(slug);
      expect(task.status).toBe("approved");
      const contract = await contractOf(slug);
      expect(contract.kind).toBe("code");
      expect(contract.base_branch).toBe("main");
      expect(contract.compiled_at_commit).toBe(cf.git(["rev-parse", "main"]));
      expect(contract.landing_route).toBe("main");
      expect(contract.install).toBe(DONE_CONTRACT_CONFIG.install);
      expect(contract.red_required).toBe(true);
      expect(Object.keys(contract)).not.toContain("red_waiver_reason");
      expect(contract.new_symbols).toEqual([]);
      expect(contract.added_oracles).toEqual([]);
      // Exact: the false green is a contract with the right fields and a wrong or missing oracle.
      expect(contract.oracles).toEqual([
        { id: "ac:AC-FX-1", command: "echo fx1" },
        { id: `test:${TEST_FILE}`, command: TEST_COMMAND },
        { id: "typecheck", command: DONE_CONTRACT_CONFIG.typecheck },
      ]);
    });

    it("AC-DCS1-1: a code task on a plan with an existing integration branch compiles at that branch's tip with landing_route integration-branch", async () => {
      const slug = await cf.createTask({ plan: planIntegration, kind: "code", title: "Contract on integration", anchors: [TEST_FILE], acScope: ["AC-FX-1"] });
      const out = await cf.run(["approve", slug]);
      expect(out.exitCode, out.stderr).toBe(0);
      const contract = await contractOf(slug);
      expect(contract.base_branch).toBe(INTEGRATION);
      expect(contract.landing_route).toBe("integration-branch");
      expect(contract.compiled_at_commit).toBe(cf.git(["rev-parse", INTEGRATION]));
      expect(contract.compiled_at_commit).not.toBe(cf.git(["rev-parse", "main"]));
      expect(contract.oracles.map((o) => o.id)).toEqual(["ac:AC-FX-1", `test:${TEST_FILE}`, "typecheck"]);
    });

    it("AC-DCS1-1: a task with no anchored test file and no script AC compiles to the typecheck oracle alone", async () => {
      const slug = await cf.createTask({ plan: planMain, kind: "code", title: "Contract typecheck only", anchors: ["packages/demo/src/only.ts"], acScope: ["AC-FX-AI"] });
      expect((await cf.run(["approve", slug])).exitCode).toBe(0);
      expect((await contractOf(slug)).oracles).toEqual([{ id: "typecheck", command: DONE_CONTRACT_CONFIG.typecheck }]);
    });

    it("AC-DCS1-1: a corpus task compiles to the corpus:files-unchanged oracle (with its script ACs), route none, no red run", async () => {
      const slug = await cf.createTask({ plan: planMain, kind: "corpus", title: "Corpus contract", acScope: ["AC-FX-1"] });
      const out = await cf.run(["approve", slug]);
      expect(out.exitCode, out.stderr).toBe(0);
      const contract = await contractOf(slug);
      expect(contract.kind).toBe("corpus");
      expect(contract.landing_route).toBe("none");
      expect(contract.red_required).toBe(false);
      expect(contract.base_branch).toBe("main");
      expect(contract.oracles).toEqual([{ id: "ac:AC-FX-1", command: "echo fx1" }, { id: "corpus:files-unchanged" }]);
    });

    it("AC-DCS1-1: a check task with a script AC compiles to that AC alone", async () => {
      const slug = await cf.createTask({ plan: planMain, kind: "check", title: "Check contract", acScope: ["AC-FX-1"] });
      const out = await cf.run(["approve", slug]);
      expect(out.exitCode, out.stderr).toBe(0);
      const contract = await contractOf(slug);
      expect(contract.landing_route).toBe("none");
      expect(contract.red_required).toBe(false);
      expect(contract.oracles).toEqual([{ id: "ac:AC-FX-1", command: "echo fx1" }]);
    });

    it("AC-DCS1-1: lore claim of the approved task prints the stored contract (ids and commands), not a recomputed definition", async () => {
      // reason: the task-claim gate wants an approved spec (which needs a cited baseline rule); the claim's gates are not this
      // criterion's subject, so the fixture switches that one checkpoint off.
      patchLoreConfig(cf.dir, { workflow: { gates: { "task-claim": { enabled: false } } } });
      const slug = await cf.createTask({ plan: planMain, kind: "code", title: "Claim prints contract", anchors: [TEST_FILE], acScope: ["AC-FX-1"] });
      expect((await cf.run(["approve", slug])).exitCode).toBe(0);
      const worktree = join(cf.dir, "..", `dcs1-wt-${Date.now()}`);
      cf.git(["worktree", "add", "-q", "-b", "dcs1-claim-branch", worktree]);
      try {
        const claimed = await cf.run(["claim", slug, "--worktree", "dcs1-claim-branch"]);
        expect(claimed.exitCode, claimed.stderr + claimed.stdout).toBe(0);
        expect(claimed.stdout).toContain("ac:AC-FX-1");
        expect(claimed.stdout).toContain("echo fx1");
        expect(claimed.stdout).toContain(`test:${TEST_FILE}`);
        expect(claimed.stdout).toContain(TEST_COMMAND);
        expect(claimed.stdout).toContain("typecheck");
        expect(claimed.stdout).toContain(cf.git(["rev-parse", "main"]).slice(0, 12));
        expect(claimed.stdout).toMatch(/red run[^\n]*yes/i);
      } finally {
        await cf.run(["release", slug]);
        cf.git(["worktree", "remove", "--force", worktree]);
      }
    });
  });

  describe("AC-DCS1-2: an uncompilable contract is refused with every cause, writing nothing", () => {
    const ABSENT_LITERAL = { path: "README.md", find: "THIS_LITERAL_IS_NOT_THERE" } as const;

    it("AC-DCS1-2: a code task with every cause at once exits 4 done-contract-uncompilable naming each cause in ONE message; version, status and audit are unchanged", async () => {
      const ghostPlan = await cf.createPlan("Plan with absent branch", "dcs1-ghost-branch");
      // declaring created the branch (AC-DCS2-10); the cause only fires once it is deleted afterwards
      cf.git(["branch", "-D", "dcs1-ghost-branch"]);
      await cf.mustRun(["ac", "add", cf.spec, "AC-ABS-1", "--statement", "Unmarked absent literal.", "--mode", "script", "--oracle", "test", "--command", "echo abs",
        "--falsifier-path", ABSENT_LITERAL.path, "--falsifier-find", ABSENT_LITERAL.find, "--falsifier-replace", "", "--falsifier-exit-code", "1"]);
      await cf.mustRun(["ac", "add", cf.spec, "AC-GONE-1", "--statement", "Soon removed.", "--mode", "script", "--oracle", "test", "--command", "echo gone"]);
      const slug = await cf.createTask({ plan: ghostPlan, kind: "code", title: "Every cause", anchors: ["packages/demo/src/not-yet.ts"], acScope: ["AC-ABS-1", "AC-GONE-1"] });
      await cf.mustRun(["ac", "rm", cf.spec, "AC-GONE-1"]);
      dropLoreConfigKey(cf.dir, ["workflow", "done_contract"]);
      try {
        const before = await cf.readTask(slug);
        const auditBefore = await auditCount(slug);
        const refused = await cf.run(["approve", slug]);
        expect(refused.exitCode, refused.stderr).toBe(4);
        const text = refused.stderr;
        expect(text).toContain("done-contract-uncompilable");
        for (const cause of ["no-typecheck", "no-install", "no-test-command", "base-branch-absent", "ac-unresolved", "falsifier-literal-absent"]) {
          expect(text, `cause ${cause}`).toContain(cause);
        }
        expect(text).toContain("dcs1-ghost-branch");
        expect(text).toContain("git branch dcs1-ghost-branch main"); // the command that creates it
        expect(text).toContain("AC-GONE-1");
        expect(text).toContain("AC-ABS-1");
        expect(text).toContain(ABSENT_LITERAL.path);
        expect(text).toContain(ABSENT_LITERAL.find);
        // A non-resolving anchor is never a cause.
        expect(text).not.toContain("not-yet.ts");

        const after = await cf.readTask(slug);
        expect(after.status).toBe("draft");
        expect(after.version).toBe(before.version);
        expect(Object.keys(after.extra)).not.toContain("done_contract");
        expect(await auditCount(slug)).toBe(auditBefore);
      } finally {
        cf.setDoneContractConfig(DONE_CONTRACT_CONFIG);
      }
    });

    it("AC-DCS1-2: only the causes that apply are named (one missing key names that key alone)", async () => {
      const slug = await cf.createTask({ plan: planMain, kind: "code", title: "One cause", acScope: [] });
      dropLoreConfigKey(cf.dir, ["workflow", "done_contract", "install"]);
      try {
        const refused = await cf.run(["approve", slug]);
        expect(refused.exitCode, refused.stderr).toBe(4);
        expect(refused.stderr).toContain("no-install");
        for (const other of ["no-typecheck", "no-test-command", "base-branch-absent", "ac-unresolved", "falsifier-literal-absent", "no-oracle", "kind-anchor"]) {
          expect(refused.stderr, `must not name ${other}`).not.toContain(other);
        }
        expect((await cf.readTask(slug)).status).toBe("draft");
      } finally {
        cf.setDoneContractConfig(DONE_CONTRACT_CONFIG);
      }
    });

    it("AC-DCS1-2: a check task holding a file anchor and no script oracle is refused with kind-anchor and no-oracle together", async () => {
      const slug = await cf.createTask({ plan: planMain, kind: "check", title: "Check with anchor", anchors: ["packages/demo/src/x.ts"], acScope: ["AC-FX-AI"] });
      const before = await cf.readTask(slug);
      const refused = await cf.run(["approve", slug]);
      expect(refused.exitCode, refused.stderr).toBe(4);
      expect(refused.stderr).toContain("done-contract-uncompilable");
      expect(refused.stderr).toContain("kind-anchor");
      expect(refused.stderr).toContain("no-oracle");
      const after = await cf.readTask(slug);
      expect(after.status).toBe("draft");
      expect(after.version).toBe(before.version);
    });

    it("AC-DCS1-2: a corpus task holding a file anchor is refused with kind-anchor alone (it always has corpus:files-unchanged)", async () => {
      const slug = await cf.createTask({ plan: planMain, kind: "corpus", title: "Corpus with anchor", anchors: ["packages/demo/src/y.ts"], acScope: [] });
      const refused = await cf.run(["approve", slug]);
      expect(refused.exitCode, refused.stderr).toBe(4);
      expect(refused.stderr).toContain("kind-anchor");
      expect(refused.stderr).not.toContain("no-oracle");
    });

    it("AC-DCS1-2: a check or corpus task needs none of the three config keys (only a code task does)", async () => {
      const check = await cf.createTask({ plan: planMain, kind: "check", title: "Check without keys", acScope: ["AC-FX-1"] });
      const corpus = await cf.createTask({ plan: planMain, kind: "corpus", title: "Corpus without keys", acScope: [] });
      dropLoreConfigKey(cf.dir, ["workflow", "done_contract"]);
      try {
        expect((await cf.run(["approve", check])).exitCode).toBe(0);
        expect((await cf.run(["approve", corpus])).exitCode).toBe(0);
      } finally {
        cf.setDoneContractConfig(DONE_CONTRACT_CONFIG);
      }
    });

    it("AC-DCS1-2: a task anchoring a file it will create is approved (exit 0); a literal absent from its path is accepted and stored in new_symbols when the AC is marked --falsifier-new-symbol", async () => {
      await cf.mustRun(["ac", "add", cf.spec, "AC-NEW-1", "--statement", "Marked new symbol.", "--mode", "script", "--oracle", "test", "--command", "echo new",
        "--falsifier-path", "packages/demo/src/created.ts", "--falsifier-find", "brandNewSymbol", "--falsifier-replace", "", "--falsifier-exit-code", "1", "--falsifier-new-symbol"]);
      await cf.mustRun(["ac", "add", cf.spec, "AC-PRESENT-1", "--statement", "Literal present.", "--mode", "script", "--oracle", "test", "--command", "echo present",
        "--falsifier-path", "README.md", "--falsifier-find", "fixture", "--falsifier-replace", "", "--falsifier-exit-code", "1"]);
      const slug = await cf.createTask({ plan: planMain, kind: "code", title: "Creates files", anchors: ["packages/demo/src/created.ts"], acScope: ["AC-NEW-1", "AC-PRESENT-1"] });
      const out = await cf.run(["approve", slug]);
      expect(out.exitCode, out.stderr).toBe(0);
      const contract = await contractOf(slug);
      expect(contract.new_symbols).toEqual(["AC-NEW-1"]);
      expect(contract.oracles.map((o) => o.id)).toEqual(["ac:AC-NEW-1", "ac:AC-PRESENT-1", "typecheck"]);
    });

    it("AC-DCS1-2: an ac_scope id declared by a spec the plan implements (not its parent) resolves", async () => {
      const spec3Out = await cf.mustRun(["create", "spec", "--title", "Fixture Spec Three", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"]);
      const spec3 = spec3Out.match(/Slug:\s+(\S+)/)?.[1] ?? "";
      await cf.mustRun(["ac", "add", spec3, "AC-IMPL-1", "--statement", "On the implemented spec.", "--mode", "script", "--oracle", "test", "--command", "echo impl"]);
      const plan3 = await cf.createPlan("Plan that implements spec three");
      await cf.mustRun(["link", plan3, spec3, "--type", "implements"]);
      const slug = await cf.createTask({ plan: plan3, kind: "check", title: "Implemented spec criterion", acScope: [] });
      await cf.mustRun(["scope", "add", slug, "AC-IMPL-1"]);
      const out = await cf.run(["approve", slug]);
      expect(out.exitCode, out.stderr).toBe(0);
      expect((await contractOf(slug)).oracles).toEqual([{ id: "ac:AC-IMPL-1", command: "echo impl" }]);
    });
  });

  describe("AC-DCS1-5: the red run is waived once at approve", () => {
    const REASONS = ["30 days -- a spike with no test to write first", "plain reason", "7"] as const;

    it("AC-DCS1-5: approve of a code task stores red_required true and no reason", async () => {
      const slug = await cf.createTask({ plan: planMain, kind: "code", title: "Red required", acScope: [] });
      expect((await cf.run(["approve", slug])).exitCode).toBe(0);
      const contract = await contractOf(slug);
      expect(contract.red_required).toBe(true);
      expect(Object.keys(contract)).not.toContain("red_waiver_reason");
    });

    it("AC-DCS1-5: --red-waiver stores red_required false and the reason byte for byte (a leading digit, spaces and a double dash included)", async () => {
      for (const reason of REASONS) {
        const slug = await cf.createTask({ plan: planMain, kind: "code", title: `Waived ${reason.slice(0, 8)}`, acScope: [] });
        const out = await cf.run(["approve", slug, "--red-waiver", reason]);
        expect(out.exitCode, `${reason}: ${out.stderr}`).toBe(0);
        const contract = await contractOf(slug);
        expect(contract.red_required, reason).toBe(false);
        // The false green: a parser reading the flag as a negation (or a number) drops or alters the reason and still exits 0.
        expect(contract.red_waiver_reason, reason).toBe(reason);
        expect(typeof contract.red_waiver_reason).toBe("string");
      }
    });

    it("AC-DCS1-5: a blank --red-waiver reason exits 2 and writes nothing", async () => {
      const slug = await cf.createTask({ plan: planMain, kind: "code", title: "Blank waiver", acScope: [] });
      const before = await cf.readTask(slug);
      const auditBefore = await auditCount(slug);
      for (const blank of ["", "   "]) {
        const refused = await cf.run(["approve", slug, "--red-waiver", blank]);
        expect(refused.exitCode, `'${blank}': ${refused.stderr}`).toBe(2);
        expect(refused.stderr).toContain("--red-waiver");
      }
      const after = await cf.readTask(slug);
      expect(after.status).toBe("draft");
      expect(after.version).toBe(before.version);
      expect(await auditCount(slug)).toBe(auditBefore);
    });

    it("AC-DCS1-5: a task that already holds a contract is never recompiled (a waiver cannot be added by approving again): done-contract-already-stored, nothing written", async () => {
      // A draft that holds a contract cannot be made through the verbs (the key is locked), so it is seeded in-process, the way
      // a task approved before a rollback would look.
      const app = createApp(join(cf.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
      let slug = "";
      try {
        const planDoc = await app.corpusService.get(planMain);
        if (!planDoc.ok) throw new Error("plan not found");
        const stored = { compiled_at_commit: cf.git(["rev-parse", "main"]), kind: "code", base_branch: "main", oracles: [], red_required: true, landing_route: "main", new_symbols: [], added_oracles: [] };
        const created = await app.corpusService.create({
          type: "task",
          title: "Already holds a contract",
          content: "x",
          parent_id: planDoc.value.doc.id,
          extra: { plan_id: planDoc.value.doc.id, ac_scope: [], kind: "code", done_contract: stored },
        });
        if (!created.ok) throw new Error(`seed failed: ${JSON.stringify(created.error)}`);
        slug = created.value.slug;
      } finally {
        app.close();
      }
      const before = await cf.readTask(slug);
      const refused = await cf.run(["approve", slug, "--red-waiver", "waive it afterwards"]);
      expect(refused.exitCode, refused.stderr).toBe(4);
      expect(refused.stderr).toContain("done-contract-already-stored");
      const after = await cf.readTask(slug);
      expect(after.status).toBe("draft");
      expect(after.version).toBe(before.version);
      expect((after.extra["done_contract"] as StoredContract).red_required).toBe(true);
    });

    it("AC-DCS1-5: --red-waiver on a check or corpus task exits 4 red-waiver-not-code and writes nothing", async () => {
      for (const kind of ["check", "corpus"] as const) {
        const slug = await cf.createTask({ plan: planMain, kind, title: `Waiver on ${kind}`, acScope: kind === "check" ? ["AC-FX-1"] : [] });
        const before = await cf.readTask(slug);
        const refused = await cf.run(["approve", slug, "--red-waiver", "not applicable"]);
        expect(refused.exitCode, `${kind}: ${refused.stderr}`).toBe(4);
        expect(refused.stderr).toContain("red-waiver-not-code");
        const after = await cf.readTask(slug);
        expect(after.status).toBe("draft");
        expect(after.version).toBe(before.version);
      }
    });
  });
});
