// @reads assets/project/lore-config-template.yaml
// @reads .lore/config.yaml
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
import { liveAmbient, liveWriteContext } from "../live-invocation";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
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
    expect((await fixture.readTask(slug)).extra["done_contract"]).toBeUndefined();
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
