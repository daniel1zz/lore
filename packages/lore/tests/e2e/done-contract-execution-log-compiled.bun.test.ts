// @reads assets/project/lore-config-template.yaml
// @reads assets/project/reference-transaction
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * done-contract-execution-log-compiled.bun.test.ts — the execution log of a task, its writers and the deterministic review of a
 * finished task (spec-integrate-proves-and-lands-evidence-at-landing-the-merge AC-DCS2-14, AC-DCS2-15), observed through the `lore`
 * command tree (`runLoreInProcess`, the function the binary's entry calls) on a throwaway repository and corpus with REAL
 * branches and worktrees. The repository's own `.lore/` is never touched.
 *
 * Each test name starts with `AC-<id>:` (with the colon), so `-t 'AC-DCS2-1:'` never matches AC-DCS2-14.
 *
 *   AC-DCS2-14  landed, evidence-recorded, flaky and removed-oracle entries after `lore integrate` / `lore done`; superseded
 *               entries on `lore ac set --correction` and `lore ac supersede`; evidence-moved entries of a plan; the body bytes and
 *               every stored version's body never change; a hand edit of execution_log or done_contract is refused
 *   AC-DCS2-15  a task past done is reviewed by its contract with no AI judge (exit 4 naming each unmet oracle, exit 0 when met);
 *               a task not yet done keeps the AI intent review: evidence_completeness does not apply, approve needs no override
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository; the oracle commands are `sh -c` scripts that append
 * one line to a log file OUTSIDE the repository; the AI judge is a shell-script double that appends one line per call to a counter.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp, type App } from "../../src/app";
import { handleApiRoute } from "../../src/adapters/http/routes";
import { liveAmbient, liveWriteContext } from "../live-invocation";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { DECIDED_FLAGS } from "../helpers/decision-flags";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { installShippedGuard } from "../integration/support/main-guard-repo";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

// ───────────────────────────── the world ─────────────────────────────

interface World {
  readonly fixture: DoneContractFixture;
  readonly scratch: string;
  /** Every oracle command appends one line here. */
  readonly log: string;
  /** Marker directory: a `flaky` test file fails the first time it runs and passes afterwards. */
  readonly markers: string;
  /** One line per call of the AI judge double. */
  readonly aiCalls: string;
  sequence: number;
}

const worlds: World[] = [];

/** The one run that claims every task and integrates every branch of a test. */
const OWNER = "dcs2-log-owner";

afterEach(() => {
  for (const world of worlds.splice(0)) {
    world.fixture.dispose();
    rmSync(world.scratch, { recursive: true, force: true });
  }
});

function logCommands(world: { log: string; markers: string }): { install: string; typecheck: string; test_file: string } {
  const test =
    `sh -c 'echo "test $0" >> ${world.log}; ` +
    `case "$0" in *flaky*) m=${world.markers}/$(basename "$0"); if [ ! -f "$m" ]; then touch "$m"; echo failing-once; exit 1; fi;; esac; ` +
    `echo Ran 1 tests in "$0"' {file}`;
  return {
    install: `sh -c 'echo install >> ${world.log}'`,
    typecheck: `sh -c 'echo typecheck >> ${world.log}; echo typecheck-ok'`,
    test_file: test,
  };
}

async function makeWorld(): Promise<World> {
  const scratch = mkdtempSync(join(tmpdir(), "dcs2-log-"));
  const markers = join(scratch, "markers");
  mkdirSync(markers, { recursive: true });
  const log = join(scratch, "runs.log");
  writeFileSync(log, "");
  const aiCalls = join(scratch, "ai-calls.log");
  writeFileSync(aiCalls, "");
  const aiScript = join(scratch, "fake-ai.sh");
  const verdict = JSON.stringify({ decision: "approve", confidence: 0.9, reasons: [{ dimension: "completeness", finding: "the intent is clear" }], blocking_questions: [] });
  writeFileSync(aiScript, `#!/bin/sh\ncat > /dev/null\necho call >> ${aiCalls}\ncat <<'JSONEOF'\n${verdict}\nJSONEOF\n`, { mode: 0o755 });
  chmodSync(aiScript, 0o755);

  const fixture = await makeDoneContractFixture();
  const world: World = { fixture, scratch, log, markers, aiCalls, sequence: 0 };
  worlds.push(world);
  fixture.setDoneContractConfig(logCommands(world));
  patchLoreConfig(fixture.dir, {
    workflow: { gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } }, integrate: { floor_command: "true" } },
    ai: { provider: "claude-cli", providers: { "claude-cli": { command: aiScript, args: [], timeout_ms: 20000 } }, templates: {}, telemetry: false },
  });
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  mkdirSync(join(fixture.dir, "tests"), { recursive: true });
  for (const file of ["tests/old.test.ts", "tests/seed.test.ts"]) writeFileSync(join(fixture.dir, file), "// seed\n");
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-q", "-m", "seed test files"]);
  installShippedGuard(fixture.dir, join(mkdtempSync(join(tmpdir(), "dcs2-log-guard-")), "hooks"));
  fixture.git(["checkout", "-q", "--detach", "main"]);
  return world;
}

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly text: string;
}

const sessionEnv = (session: string): Record<string, string> => ({ CLAUDE_CODE_SESSION_ID: session });

async function loreIn(world: World, cwd: string, args: readonly string[], extraEnv: Record<string, string> = {}): Promise<Out> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  const result = await runLoreInProcess([...args], { cwd, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, ...extraEnv, HOME: FIXTURE_HOME_OUTSIDE_REPO } });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

interface Tree {
  readonly branch: string;
  readonly path: string;
}

function addWorktree(world: World, label: string): Tree {
  world.sequence += 1;
  const branch = `dcs2log-${label}-${world.sequence}`;
  const path = join(world.scratch, `${label}-${world.sequence}`);
  world.fixture.git(["worktree", "add", "-q", "-b", branch, path, "main"]);
  return { branch, path };
}

const gitIn = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function commitIn(world: World, tree: Tree, files: Readonly<Record<string, string | null>>): string {
  gitIn(tree.path, ["config", "user.email", "fixture@example.invalid"]);
  gitIn(tree.path, ["config", "user.name", "fixture"]);
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      gitIn(tree.path, ["rm", "-q", path]);
      continue;
    }
    mkdirSync(dirname(join(tree.path, path)), { recursive: true });
    writeFileSync(join(tree.path, path), content);
  }
  gitIn(tree.path, ["add", "-A"]);
  world.sequence += 1;
  gitIn(tree.path, ["commit", "-q", "-m", `work ${world.sequence}`]);
  return gitIn(tree.path, ["rev-parse", "HEAD"]);
}

interface Landable {
  readonly slug: string;
  readonly tree: Tree;
}

/** Creates and approves a code task (its red run waived), claims it on a fresh worktree branch and commits `work` there. */
async function landable(
  world: World,
  plan: string,
  label: string,
  anchors: readonly string[],
  work: Readonly<Record<string, string | null>>,
  acScope: readonly string[] = ["AC-FX-1"],
): Promise<Landable> {
  const slug = await world.fixture.createTask({ plan, kind: "code", title: `Log ${label}`, anchors, acScope });
  await world.fixture.mustRun(["approve", slug, "--red-waiver", "the red run is not the subject of this test"]);
  const tree = addWorktree(world, label);
  const claimed = await loreIn(world, world.fixture.dir, ["claim", slug, "--worktree", tree.branch], sessionEnv(OWNER));
  expect(claimed.exitCode, claimed.text).toBe(0);
  commitIn(world, tree, work);
  return { slug, tree };
}

const integrateBranch = (world: World, branch: string): Promise<Out> => loreIn(world, world.fixture.dir, ["integrate", branch], sessionEnv(OWNER));

const mainTip = (world: World): string => world.fixture.git(["rev-parse", "refs/heads/main"]);

function openApp(world: World): App {
  return createApp(join(world.fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
}

interface LogEntry {
  readonly kind: string;
  readonly at?: string;
  readonly [key: string]: unknown;
}

const logOf = (extra: Record<string, unknown>): LogEntry[] => (Array.isArray(extra["execution_log"]) ? (extra["execution_log"] as LogEntry[]) : []);

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

interface BodyFacts {
  readonly titles: string[];
  readonly bodies: string[];
  readonly versions: number;
}

/** The body and title of EVERY stored version of a document: a log written by rewriting the body shows up as a second distinct hash. */
async function bodyFacts(world: World, slug: string): Promise<BodyFacts> {
  const rows = await storedVersions(world, slug);
  return {
    titles: [...new Set(rows.map((v) => v.title))],
    bodies: [...new Set(rows.map((v) => sha(v.content)))],
    versions: rows.length,
  };
}

interface StoredVersion {
  readonly version: number;
  readonly title: string;
  readonly content: string;
  readonly extra: Record<string, unknown>;
}

/** Every stored version row of a document, read straight from the throwaway corpus' database. */
async function storedVersions(world: World, slug: string): Promise<StoredVersion[]> {
  const task = await world.fixture.readTask(slug);
  const db = new Database(join(world.fixture.dir, ".lore", "lore.db"), { readonly: true });
  try {
    const rows = db.query("SELECT version, title, content, extra FROM versions WHERE doc_id = ? ORDER BY version").all(task.id) as { version: number; title: string; content: string; extra: string }[];
    return rows.map((row) => ({ version: row.version, title: row.title, content: row.content, extra: JSON.parse(row.extra) as Record<string, unknown> }));
  } finally {
    db.close();
  }
}

const versionsOf = (world: World, slug: string): Promise<StoredVersion[]> => storedVersions(world, slug);

// ───────────────────────────── AC-DCS2-14 ─────────────────────────────

describe("AC-DCS2-14: the execution log is appended by lore and never rewrites the body", () => {
  it("AC-DCS2-14: lore integrate leaves landed, evidence-recorded and flaky entries (branch, tip, landing commit, oracle ids); the body and every version's body are byte-identical", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Log plan");
    const x = await landable(world, plan, "x", ["tests/x-1.test.ts", "tests/x-flaky.test.ts"], { "tests/x-1.test.ts": "// x\n", "tests/x-flaky.test.ts": "// flaky\n" });
    const before = await bodyFacts(world, x.slug);
    expect(before.bodies.length).toBe(1);
    expect(logOf((await fixture.readTask(x.slug)).extra)).toEqual([]);
    const tip = gitIn(x.tree.path, ["rev-parse", "HEAD"]);

    const out = await integrateBranch(world, x.tree.branch);
    expect(out.exitCode, out.text).toBe(0);
    const merged = mainTip(world);
    const task = await fixture.readTask(x.slug);
    expect(task.status).toBe("archived");

    const log = logOf(task.extra);
    const landed = log.filter((entry) => entry.kind === "landed");
    expect(landed.length, JSON.stringify(log)).toBe(1);
    expect(landed[0]?.branch).toBe(x.tree.branch);
    expect(landed[0]?.tip).toBe(tip);
    expect(landed[0]?.landing_commit).toBe(merged);
    expect(typeof landed[0]?.commit_range).toBe("string");
    expect(typeof landed[0]?.at).toBe("string");

    const recorded = log.filter((entry) => entry.kind === "evidence-recorded");
    expect(recorded.length, JSON.stringify(log)).toBe(1);
    expect([...((recorded[0]?.oracles ?? []) as string[])].sort()).toEqual(["ac:AC-FX-1", "test:tests/x-1.test.ts", "test:tests/x-flaky.test.ts", "typecheck"]);
    expect(recorded[0]?.landing_commit).toBe(merged);

    const flaky = log.filter((entry) => entry.kind === "flaky");
    expect(flaky.length, JSON.stringify(log)).toBe(1);
    expect(flaky[0]?.oracle).toBe("test:tests/x-flaky.test.ts");
    expect(flaky[0]?.landing_commit).toBe(merged);

    // the log is not the only thing a written entry may have changed: the body and title of every version are the first version's
    expect(await bodyFacts(world, x.slug)).toEqual({ ...before, versions: expect.any(Number) });
    expect((await bodyFacts(world, x.slug)).versions).toBeGreaterThan(before.versions);
    // a second integrate of the same branch adds nothing to the log
    const again = await integrateBranch(world, x.tree.branch);
    expect(again.exitCode, again.text).toBe(0);
    expect(logOf((await fixture.readTask(x.slug)).extra)).toEqual(log);
  });

  it("AC-DCS2-14: a landing that deletes an anchored test file writes the removed-oracle entry in the same write as done_contract.removed_oracles", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Removed plan");
    const d = await landable(world, plan, "del", ["tests/old.test.ts"], { "tests/old.test.ts": null, "src/del.ts": "export const del = 1;\n" });
    const out = await integrateBranch(world, d.tree.branch);
    expect(out.exitCode, out.text).toBe(0);
    const task = await fixture.readTask(d.slug);
    expect(task.status).toBe("archived");
    const removed = (task.extra["done_contract"] as { removed_oracles?: { id: string; path: string; reason: string; landed_commit: string }[] }).removed_oracles ?? [];
    expect(removed.map((r) => r.id)).toEqual(["test:tests/old.test.ts"]);
    const entries = logOf(task.extra).filter((entry) => entry.kind === "removed-oracle");
    expect(entries.length, JSON.stringify(logOf(task.extra))).toBe(1);
    expect(entries[0]?.oracle).toBe("test:tests/old.test.ts");
    expect(entries[0]?.path).toBe("tests/old.test.ts");
    expect(entries[0]?.reason).toBe(removed[0]?.reason);
    expect(entries[0]?.landed_commit).toBe(removed[0]?.landed_commit);

    // the same write: the first stored version that holds removed_oracles also holds the entry, and no version holds one without the other
    const versions = await versionsOf(world, d.slug);
    for (const version of versions) {
      const contract = version.extra["done_contract"] as { removed_oracles?: unknown[] } | undefined;
      const hasRemoved = (contract?.removed_oracles ?? []).length > 0;
      const hasEntry = logOf(version.extra).some((entry) => entry.kind === "removed-oracle");
      expect(hasEntry, `version ${version.version}`).toBe(hasRemoved);
    }
    // a task whose landing deleted nothing carries no removed-oracle entry
    const plain = await landable(world, plan, "plain", ["tests/p-1.test.ts"], { "tests/p-1.test.ts": "// p\n" });
    expect((await integrateBranch(world, plain.tree.branch)).exitCode).toBe(0);
    expect(logOf((await fixture.readTask(plain.slug)).extra).some((entry) => entry.kind === "removed-oracle")).toBe(false);
  });

  it("AC-DCS2-14: lore ac set --correction appends a superseded entry (AC and reason) to each task whose ac_scope holds the AC and to no other; the body is unchanged", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Correction plan");
    const a = await fixture.createTask({ plan, kind: "code", title: "Scoped A", anchors: ["tests/a-1.test.ts"], acScope: ["AC-FX-1"] });
    const b = await fixture.createTask({ plan, kind: "code", title: "Scoped B", anchors: ["tests/b-1.test.ts"], acScope: ["AC-FX-1"] });
    const other = await fixture.createTask({ plan, kind: "code", title: "Unscoped", anchors: ["tests/o-1.test.ts"], acScope: [] });
    await fixture.mustRun(["approve", a, "--red-waiver", "not the subject"]);
    const beforeA = await bodyFacts(world, a);
    const beforeOther = await fixture.readTask(other);

    const reason = "the statement had a typo";
    const corrected = await loreIn(world, fixture.dir, ["ac", "set", fixture.spec, "AC-FX-1", "--statement", "A script criterion, corrected.", "--correction", reason, ...DECIDED_FLAGS]);
    expect(corrected.exitCode, corrected.text).toBe(0);
    for (const slug of [a, b]) {
      const entries = logOf((await fixture.readTask(slug)).extra).filter((entry) => entry.kind === "superseded");
      expect(entries.length, slug).toBe(1);
      expect(entries[0]?.ac).toBe("AC-FX-1");
      expect(entries[0]?.reason).toBe(reason);
      expect(typeof entries[0]?.at).toBe("string");
    }
    expect(await fixture.readTask(other)).toEqual(beforeOther);
    expect((await bodyFacts(world, a)).bodies).toEqual(beforeA.bodies);
    expect((await bodyFacts(world, a)).titles).toEqual(beforeA.titles);
    // a refused correction (blank reason) appends nothing
    const blank = await loreIn(world, fixture.dir, ["ac", "set", fixture.spec, "AC-FX-1", "--statement", "Another.", "--correction", "  ", ...DECIDED_FLAGS]);
    expect(blank.exitCode).not.toBe(0);
    expect(logOf((await fixture.readTask(a)).extra).filter((entry) => entry.kind === "superseded").length).toBe(1);
  });

  it("AC-DCS2-14: lore ac supersede appends a superseded entry naming the AC and the reason to the task that holds it", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    // a draft spec with two criteria, so the supersede needs no decision record
    const spec2 = (await fixture.mustRun(["create", "spec", "--title", "Second Spec", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"])).match(/Slug:\s+(\S+)/)?.[1] as string;
    await fixture.mustRun(["ac", "add", spec2, "AC-SUP-1", "--statement", "Old.", "--mode", "script", "--oracle", "test", "--command", "echo sup1"]);
    await fixture.mustRun(["ac", "add", spec2, "AC-SUP-2", "--statement", "New.", "--mode", "script", "--oracle", "test", "--command", "echo sup2"]);
    const plan2 = (await fixture.mustRun(["create", "plan", "--title", "Supersede plan", "--parent", spec2, "--content", "## Plan\n\nBody.\n", "--no-ai"])).match(/Slug:\s+(\S+)/)?.[1] as string;
    const holder = await fixture.createTask({ plan: plan2, kind: "code", title: "Holder", anchors: ["tests/h-1.test.ts"], acScope: ["AC-SUP-1"] });
    const bystander = await fixture.createTask({ plan: plan2, kind: "code", title: "Bystander", anchors: ["tests/by-1.test.ts"], acScope: ["AC-SUP-2"] });
    const beforeBystander = await fixture.readTask(bystander);
    const before = await bodyFacts(world, holder);

    const reason = "replaced by the second criterion";
    const out = await loreIn(world, fixture.dir, ["ac", "supersede", spec2, "AC-SUP-1", "--by", `${spec2}:AC-SUP-2`, "--reason", reason]);
    expect(out.exitCode, out.text).toBe(0);
    const entries = logOf((await fixture.readTask(holder)).extra).filter((entry) => entry.kind === "superseded");
    expect(entries.length).toBe(1);
    expect(entries[0]?.ac).toBe("AC-SUP-1");
    expect(entries[0]?.reason).toBe(reason);
    expect(await fixture.readTask(bystander)).toEqual(beforeBystander);
    expect((await bodyFacts(world, holder)).bodies).toEqual(before.bodies);
    // a second supersede of the same AC is refused and appends nothing
    const again = await loreIn(world, fixture.dir, ["ac", "supersede", spec2, "AC-SUP-1", "--by", `${spec2}:AC-SUP-2`, "--reason", reason]);
    expect(again.exitCode).toBe(4);
    expect(logOf((await fixture.readTask(holder)).extra).filter((entry) => entry.kind === "superseded").length).toBe(1);
  });

  it("AC-DCS2-14: a plan execution_log accepts evidence-moved entries from the writer service, and nothing else writes the log by hand", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Moved plan");
    const planDoc = JSON.parse(await fixture.mustRun(["get", plan, "--json"])) as { data: { doc?: { id: string; extra: Record<string, unknown> }; id?: string; extra?: Record<string, unknown> } };
    const planId = (planDoc.data.doc?.id ?? planDoc.data.id) as string;
    const app = openApp(world);
    try {
      const found = await app.corpusService.get(planId);
      if (!found.ok) throw new Error("plan not found");
      const appended = await app.executionLogService.appendEntries(found.value.doc, [{ kind: "evidence-moved", at: "2026-01-01T00:00:00.000Z", from: "tests/old.test.ts", to: "tests/new.test.ts", task: "some-task" }]);
      expect(appended.ok, JSON.stringify(appended)).toBe(true);
      const reread = await app.corpusService.get(planId);
      if (!reread.ok) throw new Error("plan not found");
      const entries = logOf(reread.value.doc.extra);
      expect(entries.map((entry) => entry.kind)).toEqual(["evidence-moved"]);
      expect(entries[0]?.to).toBe("tests/new.test.ts");
      // an entry of an unknown kind is refused and nothing is appended
      const refused = await app.executionLogService.appendEntries(reread.value.doc, [{ kind: "invented", at: "2026-01-01T00:00:00.000Z" } as never]);
      expect(refused.ok).toBe(false);
      const after = await app.corpusService.get(planId);
      if (!after.ok) throw new Error("plan not found");
      expect(logOf(after.value.doc.extra).length).toBe(1);
    } finally {
      app.close();
    }
  });

  it("AC-DCS2-14: a hand edit of execution_log or done_contract through the edit routes is refused (validation error, exit 4 at the CLI), naming the writer, on a task and on a plan", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Locked plan");
    const slug = await fixture.createTask({ plan, kind: "code", title: "Hand edit", anchors: ["tests/he-1.test.ts"], acScope: ["AC-FX-1"] });
    await fixture.mustRun(["approve", slug, "--red-waiver", "not the subject"]);
    const task = await fixture.readTask(slug);
    const forged = [{ kind: "landed", at: "2026-01-01T00:00:00.000Z", branch: "forged", tip: "0".repeat(40), landing_commit: "0".repeat(40) }];
    const app = openApp(world);
    try {
      const viaService = await app.corpusService.set(task.id, { extra: { ...task.extra, execution_log: forged } });
      expect(viaService.ok).toBe(false);
      if (!viaService.ok) expect(viaService.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(viaService)).toContain("execution_log");
      expect(JSON.stringify(viaService)).toMatch(/lore (done|integrate)/);
      const contract = { ...(task.extra["done_contract"] as Record<string, unknown>), red_required: true };
      const viaContract = await app.corpusService.set(task.id, { extra: { ...task.extra, done_contract: contract } });
      expect(viaContract.ok).toBe(false);
      expect(JSON.stringify(viaContract)).toContain("done-contract-locked");
    } finally {
      app.close();
    }
    const http = async (path: string, body: unknown): Promise<{ status: number; text: string }> => {
      const httpApp = openApp(world);
      try {
        const url = new URL(`http://localhost${path}`);
        const req = new Request(url.toString(), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const res = await handleApiRoute(req, url, httpApp, { name: "test-agent", session_id: "dcs2-log-http" });
        if (res === null) throw new Error(`no route answered PATCH ${path}`);
        return { status: res.status, text: await res.text() };
      } finally {
        httpApp.close();
      }
    };
    const forgedTask = await http(`/api/docs/${task.id}`, { extra: { ...task.extra, execution_log: forged } });
    expect(forgedTask.status).toBe(422);
    expect(forgedTask.text).toContain("execution_log");
    const planDoc = JSON.parse(await fixture.mustRun(["get", plan, "--json"])) as { data: { doc?: { id: string; extra: Record<string, unknown> }; id?: string; extra?: Record<string, unknown> } };
    const planId = (planDoc.data.doc?.id ?? planDoc.data.id) as string;
    const planExtra = (planDoc.data.doc?.extra ?? planDoc.data.extra ?? {}) as Record<string, unknown>;
    const forgedPlan = await http(`/api/docs/${planId}`, { extra: { ...planExtra, execution_log: forged } });
    expect(forgedPlan.status).toBe(422);
    expect(forgedPlan.text).toContain("execution_log");
    // echoing the stored value stays allowed and nothing above changed the task
    expect(logOf((await fixture.readTask(slug)).extra)).toEqual([]);
    expect((await fixture.readTask(slug)).version).toBe(task.version);
  });
});

// ───────────────────────────── AC-DCS2-15 ─────────────────────────────

/** Patches the config so that a task needs a review judgment to be approved. */
function requireTaskJudgment(world: World): void {
  patchLoreConfig(world.fixture.dir, { workflow: { review: { judgment_required_types: ["task"] } } });
}

const aiCallCount = (world: World): number => readFileSync(world.aiCalls, "utf8").split("\n").filter((line) => line !== "").length;

describe("AC-DCS2-15: a finished task is reviewed by its contract, an unstarted one on intent", () => {
  it("AC-DCS2-15: a task past done is checked by its contract with no AI judge: exit 0 when every oracle has a counting row", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Met plan");
    const x = await landable(world, plan, "met", ["tests/m-1.test.ts"], { "tests/m-1.test.ts": "// m\n" });
    expect((await integrateBranch(world, x.tree.branch)).exitCode).toBe(0);
    expect((await fixture.readTask(x.slug)).status).toBe("archived");
    const calls = aiCallCount(world);
    const versionBefore = (await fixture.readTask(x.slug)).version;

    const out = await loreIn(world, fixture.dir, ["review", x.slug]);
    expect(out.exitCode, out.text).toBe(0);
    expect(out.text).toContain("contract");
    expect(out.text).toContain("met");
    expect(aiCallCount(world)).toBe(calls);
    // the check writes nothing: no judgment row, no version
    expect((await fixture.readTask(x.slug)).version).toBe(versionBefore);
  });

  it("AC-DCS2-15: a task past done whose oracles have no counting row exits 4 naming EACH unmet oracle, still with no AI judge", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Unmet plan");
    const slug = await fixture.createTask({ plan, kind: "code", title: "Finished without proof", anchors: ["tests/u-1.test.ts"], acScope: ["AC-FX-1"] });
    await fixture.mustRun(["approve", slug, "--red-waiver", "not the subject"]);
    // an archived task holding no evidence at all: the walk to archived is written straight through the service, the way a
    // task finished before its rows were recorded looks, so every contract oracle is unmet
    const task = await fixture.readTask(slug);
    const db = new Database(join(fixture.dir, ".lore", "lore.db"));
    try {
      db.query("UPDATE docs SET status = 'archived' WHERE id = ?").run(task.id);
    } finally {
      db.close();
    }
    expect((await fixture.readTask(slug)).status).toBe("archived");
    const calls = aiCallCount(world);

    const out = await loreIn(world, fixture.dir, ["review", slug]);
    expect(out.exitCode, out.text).toBe(4);
    for (const oracle of ["ac:AC-FX-1", "test:tests/u-1.test.ts", "typecheck"]) expect(out.text, oracle).toContain(oracle);
    expect(aiCallCount(world)).toBe(calls);
  });

  it("AC-DCS2-15: a task not yet done keeps the AI intent review: evidence_completeness does not apply, the AI judge runs once, and approve needs no override and records none", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    requireTaskJudgment(world);
    const plan = await fixture.createPlan("Intent plan");
    const slug = await fixture.createTask({ plan, kind: "code", title: "Not started", anchors: ["tests/i-1.test.ts"], acScope: ["AC-FX-1"] });
    expect(aiCallCount(world)).toBe(0);

    const reviewed = await loreIn(world, fixture.dir, ["review", slug, "--json"]);
    expect(reviewed.exitCode, reviewed.text).toBe(0);
    expect(aiCallCount(world), "the AI judge ran exactly once for the not-yet-done review").toBe(1);
    const judgment = (JSON.parse(reviewed.stdout) as { data: { judgment?: { decision: string; checks: { check: string; outcome: string }[]; judge: { provider: string } } } }).data.judgment;
    expect(judgment?.decision).toBe("approve");
    expect(judgment?.judge.provider).not.toBe("deterministic-checks");
    const completeness = judgment?.checks.find((check) => check.check === "evidence_completeness");
    expect(completeness?.outcome).not.toBe("fail");

    const approved = await loreIn(world, fixture.dir, ["approve", slug, "--red-waiver", "not the subject"]);
    expect(approved.exitCode, approved.text).toBe(0);
    expect((await fixture.readTask(slug)).status).toBe("approved");
    // the approve passed on the judgment, not through an override: no override flag was given and the audit row records none
    const task = await fixture.readTask(slug);
    const app = openApp(world);
    try {
      const rows = await app.auditService.query({ action: "approve" });
      if (!rows.ok) throw new Error(JSON.stringify(rows.error));
      const mine = rows.value.filter((row) => row.doc_id === task.id);
      expect(mine.length).toBe(1);
      const details = JSON.stringify(mine[0]?.details ?? {});
      expect(details).not.toContain("override_judgment_id");
      expect(details).not.toContain("override_no_judgment");
    } finally {
      app.close();
    }
    // approving did not call the AI judge again
    expect(aiCallCount(world)).toBe(1);
  });
});
