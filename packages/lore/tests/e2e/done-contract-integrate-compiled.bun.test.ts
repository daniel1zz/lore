// @reads assets/project/lore-config-template.yaml
// @reads assets/project/reference-transaction
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * done-contract-integrate-compiled.bun.test.ts — `lore integrate` proves a landing by running the union of the landing tasks'
 * contract oracles once on the merged tree, and records the evidence of every task it lands
 * (spec-done-contract-compiled-at-approve-task-kinds-write-sets AC-DCS1-27, AC-DCS1-30; spec-integrate-proves-and-lands-evidence-
 * at-landing-the-merge AC-DCS2-1 to AC-DCS2-4), observed through the `lore` command tree (`runLoreInProcess`, the function the
 * binary's entry calls) on a throwaway repository and corpus with REAL branches, worktrees and a real integration worktree.
 *
 * Each test name starts with `AC-<id>:` (with the colon), so `-t 'AC-DCS2-1:'` never matches AC-DCS2-10.
 *
 *   Task "lore integrate runs the union of the landing tasks' contract oracles bounded, re-runs a failing one once, and records
 *   the evidence":
 *     AC-DCS2-1   selection (claimed on the branch; plan integration branch: live claim tip, released end_tip), one run per
 *                 distinct oracle, one row per task bound to the commit that became main, the landing record, the archive,
 *                 the already-integrated run on main's tip, the empty selection
 *     AC-DCS2-2   a failing oracle refuses the landing before main moves (every failure named); a missing anchored test file
 *                 refuses only its task
 *     AC-DCS2-3   only the contract oracles run, once each, each with a timeout; floor_covers; phase lines; bad config keys
 *     AC-DCS2-4   a failing oracle is re-run once: flaky rows and the one ledger issue; a failing ledger never blocks
 *     AC-DCS1-27  a pass row counts at lore done while the content it covers is the landed content (rows integrate records)
 *     AC-DCS1-30  the contract is evaluated against the landed tree: a file the landing deleted leaves the oracle set
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository, the shipped main-ref guard installed; the
 * repository's own `.lore/` is never touched. The oracle commands are `sh -c` scripts that append one line to a log file OUTSIDE the
 * repository, so a test counts real runs; the GitHub tracker is a stub `gh` first on PATH that never reaches the network.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "../../src/app";
import { liveAmbient, liveWriteContext } from "../live-invocation";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { installShippedGuard } from "../integration/support/main-guard-repo";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

// ───────────────────────────── the world: a throwaway repository whose oracles log their runs ─────────────────────────────

interface World {
  readonly fixture: DoneContractFixture;
  readonly scratch: string;
  /** The file every oracle command appends one line to (outside the repository). */
  readonly log: string;
  /** Marker directory: a `flaky` test file fails the first time it runs and passes afterwards. */
  readonly markers: string;
  /** The stub `gh` directory; `fail` inside it makes every call fail as a network error. */
  readonly stub: string;
  sequence: number;
}

const worlds: World[] = [];

/** The one run that claims every task and integrates every branch of a test. */
const OWNER = "dcs2-owner";

afterEach(() => {
  for (const world of worlds.splice(0)) {
    world.fixture.dispose();
    rmSync(world.scratch, { recursive: true, force: true });
  }
});

/** The stub `gh`: keeps its issues in `<stub>/state.json`, logs every call, fails every call while `<stub>/fail` exists. */
const GH_STUB_JS = (stub: string): string => `
const fs = require("fs");
const D = ${JSON.stringify(stub)};
const argv = process.argv.slice(2);
fs.appendFileSync(D + "/gh.log", JSON.stringify(argv) + "\\n");
if (fs.existsSync(D + "/fail")) { process.stderr.write("error connecting to api.github.com: could not resolve host: api.github.com\\n"); process.exit(1); }
const state = JSON.parse(fs.readFileSync(D + "/state.json", "utf8"));
const save = () => fs.writeFileSync(D + "/state.json", JSON.stringify(state));
const out = (v) => { process.stdout.write(JSON.stringify(v) + "\\n"); process.exit(0); };
const field = (name) => { for (let i = 0; i < argv.length; i += 1) if (argv[i - 1] === "-f" && argv[i].startsWith(name + "=")) return argv[i].slice(name.length + 1); return undefined; };
const method = argv.includes("-X") ? argv[argv.indexOf("-X") + 1] : "GET";
const path = argv[1] || "";
if (path === "user") out({ login: "stub-user" });
if (path === "repos/acme/widget") out({ id: 4242, name: "widget" });
let m = path.match(/^repos\\/acme\\/widget\\/issues\\/(\\d+)\\/comments$/);
if (m && method === "POST") { state.issues[m[1]].comments.push(field("body")); save(); out({ id: 1 }); }
if (path.startsWith("repos/acme/widget/issues") && method === "POST") {
  const number = state.next; state.next += 1;
  const labels = argv.filter((a, i) => argv[i - 1] === "-f" && a.startsWith("labels[]=")).map((a) => a.slice(9));
  state.issues[String(number)] = { number, title: field("title"), body: field("body"), state: "open", labels, comments: [] };
  save();
  out({ number, html_url: "https://github.com/acme/widget/issues/" + number });
}
if (path.startsWith("repos/acme/widget/issues")) {
  const all = Object.values(state.issues).filter((i) => i.state === "open");
  const wanted = (path.match(/labels=([^&]+)/) || [])[1];
  out(all.filter((i) => wanted === undefined || i.labels.includes(decodeURIComponent(wanted))).map((i) => ({ number: i.number, title: i.title, state: i.state, body: i.body, labels: i.labels.map((name) => ({ name })) })));
}
process.stderr.write("stub gh: unrecognised call: " + argv.join(" ") + "\\n");
process.exit(99);
`;

interface WorldOptions {
  /** Extra `workflow.integrate` keys. */
  readonly integrate?: Record<string, unknown>;
  /** Replaces the done-contract commands. */
  readonly commands?: { install?: string; typecheck?: string; test_file?: string };
  /** `false` leaves `feedback.upstream` unset (no tracker). */
  readonly tracker?: boolean;
}

/** The oracle commands: each appends one line to the log; a `fail` file fails; a `flaky` file fails once; a `slow` file sleeps. */
function logCommands(world: { log: string; markers: string }): { install: string; typecheck: string; test_file: string } {
  const test =
    `sh -c 'echo "test $0" >> ${world.log}; ` +
    `case "$0" in *fail*) echo failing; exit 1;; ` +
    `*flaky*) m=${world.markers}/$(basename "$0"); if [ ! -f "$m" ]; then touch "$m"; echo failing-once; exit 1; fi;; ` +
    `*slow*) sleep 8;; esac; echo Ran 1 tests in "$0"' {file}`;
  return {
    install: `sh -c 'echo install >> ${world.log}'`,
    typecheck: `sh -c 'echo typecheck >> ${world.log}; echo typecheck-ok'`,
    test_file: test,
  };
}

async function makeWorld(options: WorldOptions = {}): Promise<World> {
  const scratch = mkdtempSync(join(tmpdir(), "dcs2-int-"));
  const markers = join(scratch, "markers");
  const stub = join(scratch, "gh-stub");
  mkdirSync(markers, { recursive: true });
  mkdirSync(stub, { recursive: true });
  writeFileSync(join(stub, "gh-stub.js"), GH_STUB_JS(stub));
  writeFileSync(join(stub, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${join(stub, "gh-stub.js")}" "$@"\n`);
  chmodSync(join(stub, "gh"), 0o755);
  writeFileSync(join(stub, "gh.log"), "");
  writeFileSync(join(stub, "state.json"), JSON.stringify({ next: 1, issues: {} }));
  const log = join(scratch, "runs.log");
  writeFileSync(log, "");

  const fixture = await makeDoneContractFixture();
  const world: World = { fixture, scratch, log, markers, stub, sequence: 0 };
  worlds.push(world);
  fixture.setDoneContractConfig(options.commands ?? logCommands(world));
  patchLoreConfig(fixture.dir, {
    workflow: {
      gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } },
      integrate: { floor_command: "true", ...(options.integrate ?? {}) },
    },
    ...(options.tracker === false ? {} : { feedback: { upstream: { repo: "acme/widget" } } }),
  });
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  mkdirSync(join(fixture.dir, "tests"), { recursive: true });
  mkdirSync(join(fixture.dir, "src"), { recursive: true });
  for (const file of ["tests/unrelated-slow.test.ts", "tests/old.test.ts", "tests/seed.test.ts"]) writeFileSync(join(fixture.dir, file), "// seed\n");
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-q", "-m", "seed test files"]);
  installShippedGuard(fixture.dir, join(mkdtempSync(join(tmpdir(), "dcs2-int-guard-")), "hooks"));
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
  env["PATH"] = `${world.stub}:${env["PATH"] ?? ""}`;
  const result = await runLoreInProcess([...args], { cwd, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, ...extraEnv, HOME: FIXTURE_HOME_OUTSIDE_REPO } });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

interface Tree {
  readonly branch: string;
  readonly path: string;
}

function addWorktree(world: World, label: string): Tree {
  world.sequence += 1;
  const branch = `dcs2-${label}-${world.sequence}`;
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

interface Row {
  readonly oracle: string;
  readonly command: string;
  readonly result: string;
  readonly flaky?: boolean;
  readonly ledger_error?: string;
  readonly attestation?: { runner: string; head_sha?: string; recorded_at_landing?: string };
}

async function taskOf(world: World, slug: string): Promise<{ status: string; version: number; extra: Record<string, unknown> }> {
  const task = await world.fixture.readTask(slug);
  return { status: task.status, version: task.version, extra: task.extra };
}

async function rowsOf(world: World, slug: string): Promise<Row[]> {
  return ((await taskOf(world, slug)).extra["verification_evidence"] ?? []) as Row[];
}

interface LandingShape {
  readonly branch: string;
  readonly landing_commit: string;
  readonly branch_head: string;
}

async function landingOf(world: World, slug: string): Promise<LandingShape | undefined> {
  return (await taskOf(world, slug)).extra["landing"] as LandingShape | undefined;
}

interface ContractShape {
  readonly oracles: readonly { id: string; command?: string }[];
  readonly removed_oracles?: readonly { id: string; path: string; reason: string; landed_commit: string }[];
}

async function contractOf(world: World, slug: string): Promise<ContractShape> {
  return (await taskOf(world, slug)).extra["done_contract"] as ContractShape;
}

/** Creates and approves a code task (its red run waived unless `red`), and claims it on a fresh worktree branch with the given work committed. */
interface Landable {
  readonly slug: string;
  readonly tree: Tree;
  readonly session: string;
}

async function landable(
  world: World,
  plan: string,
  label: string,
  anchors: readonly string[],
  work: Readonly<Record<string, string | null>>,
  opts: { red?: boolean; acScope?: readonly string[] } = {},
): Promise<Landable> {
  const slug = await world.fixture.createTask({ plan, kind: "code", title: `Integrate ${label}`, anchors, acScope: opts.acScope ?? ["AC-FX-1"] });
  await world.fixture.mustRun(opts.red === true ? ["approve", slug] : ["approve", slug, "--red-waiver", "the red run is not the subject of this test"]);
  const tree = addWorktree(world, label);
  // reason: lore done refuses a task held by a fresh claim of ANOTHER run (floor foreign-claim), so the run that claims is the run that integrates.
  const session = OWNER;
  const claimed = await loreIn(world, world.fixture.dir, ["claim", slug, "--worktree", tree.branch], sessionEnv(session));
  expect(claimed.exitCode, claimed.text).toBe(0);
  commitIn(world, tree, work);
  return { slug, tree, session };
}

/** Merges the branches of `trees` into the plan's integration branch, in a throwaway worktree on it. */
function foldInto(world: World, integration: string, trees: readonly Tree[]): string {
  world.sequence += 1;
  const path = join(world.scratch, `fold-${world.sequence}`);
  world.fixture.git(["worktree", "add", "-q", path, integration]);
  gitIn(path, ["config", "user.email", "fixture@example.invalid"]);
  gitIn(path, ["config", "user.name", "fixture"]);
  for (const tree of trees) gitIn(path, ["merge", "-q", "--no-ff", "-m", `fold ${tree.branch}`, tree.branch]);
  const tip = gitIn(path, ["rev-parse", "HEAD"]);
  world.fixture.git(["worktree", "remove", "--force", path]);
  return tip;
}

const integrateBranch = (world: World, branch: string, session = OWNER): Promise<Out> =>
  loreIn(world, world.fixture.dir, ["integrate", branch], sessionEnv(session));

const mainTip = (world: World): string => world.fixture.git(["rev-parse", "refs/heads/main"]);

function runLines(world: World): string[] {
  return readFileSync(world.log, "utf8").split("\n").filter((line) => line !== "");
}

const countRuns = (world: World, line: string): number => runLines(world).filter((candidate) => candidate === line).length;

/** A pass row of an oracle command, or undefined. */
function rowFor(rows: readonly Row[], command: string): Row | undefined {
  return rows.find((row) => row.command === command);
}

const testCommand = (world: World, file: string): string => (logCommands(world).test_file as string).replace("{file}", file);

/** A merge commit of `branch` onto main made by plumbing (what a `git merge` outside integrate would leave), so the branch is "already integrated". */
function mergeIntoMainBehindIntegratesBack(world: World, branch: string): string {
  const main = mainTip(world);
  const tree = world.fixture.git(["rev-parse", `${branch}^{tree}`]);
  const merged = world.fixture.git(["-c", "user.email=f@example.invalid", "-c", "user.name=f", "commit-tree", tree, "-p", main, "-p", branch, "-m", `merge ${branch} outside integrate`]);
  execFileSync("git", ["update-ref", "refs/heads/main", merged, main], { cwd: world.fixture.dir, env: { ...process.env, LORE_INTEGRATE: "1" } });
  return merged;
}

// ───────────────────────────── AC-DCS2-1 ─────────────────────────────

describe("AC-DCS2-1: integrate selects the landing tasks, runs the union once and records rows per task", () => {
  it("AC-DCS2-1: a plan integration branch lands A and B (live claim tip, released end_tip); C (tip not contained), a draft, a check and a corpus task are not selected; shared oracles ran once, rows bound to the merge commit", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    fixture.git(["branch", "integration/p1", "main"]);
    const plan = await fixture.createPlan("Select plan", "integration/p1");
    const a = await landable(world, plan, "a", ["tests/a-1.test.ts"], { "tests/a-1.test.ts": "// a\n", "src/a.ts": "export const a = 1;\n" });
    const b = await landable(world, plan, "b", ["tests/b-1.test.ts"], { "tests/b-1.test.ts": "// b\n" });
    const c = await landable(world, plan, "c", ["tests/c-1.test.ts"], { "tests/c-1.test.ts": "// c\n" });
    const released = await loreIn(world, b.tree.path, ["release", b.slug], sessionEnv(b.session));
    expect(released.exitCode, released.text).toBe(0);
    const draft = await fixture.createTask({ plan, kind: "code", title: "Integrate draft", anchors: ["tests/d-1.test.ts"] });
    const check = await fixture.createTask({ plan, kind: "check", title: "Integrate check", acScope: ["AC-FX-1"] });
    await fixture.mustRun(["approve", check]);
    const corpus = await fixture.createTask({ plan, kind: "corpus", title: "Integrate corpus" });
    await fixture.mustRun(["approve", corpus]);
    foldInto(world, "integration/p1", [a.tree, b.tree, c.tree]);
    // C's branch moves on after the fold: its tip is no longer contained in the integration branch
    commitIn(world, c.tree, { "src/c-more.ts": "export const more = 1;\n" });
    const before = { c: await taskOf(world, c.slug), draft: await taskOf(world, draft), check: await taskOf(world, check), corpus: await taskOf(world, corpus) };
    const mainBefore = mainTip(world);

    const out = await integrateBranch(world, "integration/p1");
    expect(out.exitCode, out.text).toBe(0);
    const merged = mainTip(world);
    expect(merged).not.toBe(mainBefore);

    // the shared oracle (typecheck) and the install ran once; each distinct test file ran once; C's file never ran
    expect(countRuns(world, "install")).toBe(1);
    expect(countRuns(world, "typecheck")).toBe(1);
    expect(countRuns(world, "test tests/a-1.test.ts")).toBe(1);
    expect(countRuns(world, "test tests/b-1.test.ts")).toBe(1);
    expect(countRuns(world, "test tests/c-1.test.ts")).toBe(0);

    // two tasks sharing the oracle: two rows, each bound to the commit that became main and marked recorded by integrate
    for (const task of [a, b]) {
      const rows = await rowsOf(world, task.slug);
      const typecheck = rowFor(rows, logCommands(world).typecheck);
      expect(typecheck?.result, `typecheck row of ${task.slug}`).toBe("pass");
      expect(typecheck?.attestation?.runner).toBe("lore-cli");
      expect(typecheck?.attestation?.head_sha).toBe(merged);
      expect(typecheck?.attestation?.recorded_at_landing).toBe(merged);
      const file = rowFor(rows, testCommand(world, task === a ? "tests/a-1.test.ts" : "tests/b-1.test.ts"));
      expect(file?.result).toBe("pass");
      expect(file?.attestation?.head_sha).toBe(merged);
      expect(rowFor(rows, "echo fx1")?.result).toBe("pass");
      expect(rows.length).toBe(3);
      expect((await landingOf(world, task.slug))?.landing_commit).toBe(merged);
      expect((await taskOf(world, task.slug)).status, out.text).toBe("archived");
    }
    // not selected: C, the draft, the check and the corpus task are byte-identical (no row, no landing, no version)
    expect(await taskOf(world, c.slug)).toEqual(before.c);
    expect(await taskOf(world, draft)).toEqual(before.draft);
    expect(await taskOf(world, check)).toEqual(before.check);
    expect(await taskOf(world, corpus)).toEqual(before.corpus);

    // a second integrate of the branch is already in main: it runs nothing and names no task
    const logBefore = runLines(world).length;
    const again = await integrateBranch(world, "integration/p1");
    expect(again.exitCode, again.text).toBe(0);
    expect(again.text).toContain("names no task");
    expect(runLines(world).length).toBe(logBefore);
  });

  it("AC-DCS2-1: a branch claimed by one task lands it with its rows bound to the merge; an older hand-recorded pass of an unselected task does not archive it", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Claimed plan");
    const x = await landable(world, plan, "x", ["tests/x-1.test.ts"], { "tests/x-1.test.ts": "// x\n" });
    // a hand-recorded runner-attested pass of every oracle of another task, never selected by this landing
    const y = await landable(world, plan, "y", ["tests/y-1.test.ts"], { "tests/y-1.test.ts": "// y\n" });
    const captured = await loreIn(world, y.tree.path, ["evidence", y.slug, "--oracle", "test", "--command", "echo Ran 1 tests", "--result", "pass", "--capture"], sessionEnv(y.session));
    expect(captured.exitCode, captured.text).toBe(0);
    const yBefore = await taskOf(world, y.slug);

    const out = await integrateBranch(world, x.tree.branch);
    expect(out.exitCode, out.text).toBe(0);
    const merged = mainTip(world);
    expect((await taskOf(world, x.slug)).status).toBe("archived");
    expect((await landingOf(world, x.slug))?.landing_commit).toBe(merged);
    for (const row of await rowsOf(world, x.slug)) expect(row.attestation?.head_sha).toBe(merged);
    expect((await rowsOf(world, x.slug)).length).toBe(3);
    // Y was not on the branch: untouched, still open
    expect(await taskOf(world, y.slug)).toEqual(yBefore);
  });

  it("AC-DCS2-1: a branch already in main runs the union once on main's tip, writes the landing with landing_commit = that tip, binds the rows to it and archives; a re-run runs nothing", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Already plan");
    const x = await landable(world, plan, "ready", ["tests/r-1.test.ts"], { "tests/r-1.test.ts": "// r\n" });
    const tip = mergeIntoMainBehindIntegratesBack(world, x.tree.branch);
    expect(mainTip(world)).toBe(tip);

    const out = await integrateBranch(world, x.tree.branch);
    expect(out.exitCode, out.text).toBe(0);
    expect(out.text).toContain("already integrated");
    expect(countRuns(world, "typecheck")).toBe(1);
    expect(countRuns(world, "test tests/r-1.test.ts")).toBe(1);
    expect(mainTip(world)).toBe(tip);
    const landing = await landingOf(world, x.slug);
    expect(landing?.landing_commit).toBe(tip);
    expect(landing?.branch).toBe(x.tree.branch);
    const rows = await rowsOf(world, x.slug);
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.attestation?.head_sha).toBe(tip);
      expect(row.attestation?.recorded_at_landing).toBe(tip);
    }
    expect((await taskOf(world, x.slug)).status).toBe("archived");

    const logBefore = runLines(world).length;
    const again = await integrateBranch(world, x.tree.branch);
    expect(again.exitCode, again.text).toBe(0);
    expect(again.text).toContain("names no task");
    expect(runLines(world).length).toBe(logBefore);
  });
});

// ───────────────────────────── AC-DCS2-2 ─────────────────────────────

/** Builds the integration plan of A (anchors a missing file), D (the work deletes its anchored file) and G (good). */
async function missingAndDeleted(world: World): Promise<{ good: Landable; missing: Landable; deleted: Landable }> {
  const { fixture } = world;
  fixture.git(["branch", "integration/m", "main"]);
  const plan = await fixture.createPlan("Missing plan", "integration/m");
  const good = await landable(world, plan, "good", ["tests/good-1.test.ts"], { "tests/good-1.test.ts": "// good\n" });
  const missing = await landable(world, plan, "miss", ["tests/missing.test.ts"], { "src/miss.ts": "export const miss = 1;\n" });
  const deleted = await landable(world, plan, "del", ["tests/old.test.ts"], { "tests/old.test.ts": null, "src/del.ts": "export const del = 1;\n" });
  foldInto(world, "integration/m", [good.tree, missing.tree, deleted.tree]);
  return { good, missing, deleted };
}

describe("AC-DCS2-2: integrate refuses a landing it cannot prove, before main moves", () => {
  it("AC-DCS2-2: two failing oracles on two tasks are both named with their files; every oracle still ran; main, the integration worktree and every task are unchanged (exit 1)", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    fixture.git(["branch", "integration/f", "main"]);
    const plan = await fixture.createPlan("Failing plan", "integration/f");
    const a = await landable(world, plan, "fa", ["tests/fail-a.test.ts", "src/fa.ts"], { "tests/fail-a.test.ts": "// a\n", "src/fa.ts": "export const fa = 1;\n" });
    const b = await landable(world, plan, "fb", ["tests/fail-b.test.ts", "src/fb.ts"], { "tests/fail-b.test.ts": "// b\n", "src/fb.ts": "export const fb = 1;\n" });
    const ok = await landable(world, plan, "ok", ["tests/ok-1.test.ts"], { "tests/ok-1.test.ts": "// ok\n" });
    foldInto(world, "integration/f", [a.tree, b.tree, ok.tree]);
    const mainBefore = mainTip(world);
    const before = { a: await taskOf(world, a.slug), b: await taskOf(world, b.slug), ok: await taskOf(world, ok.slug) };

    const out = await integrateBranch(world, "integration/f");
    expect(out.exitCode, out.text).toBe(1);
    expect(out.text).toContain("integrate-oracle-failed");
    for (const slug of [a.slug, b.slug]) expect(out.stderr).toContain(slug);
    expect(out.stderr).toContain("test:tests/fail-a.test.ts");
    expect(out.stderr).toContain("test:tests/fail-b.test.ts");
    expect(out.stderr).toContain(testCommand(world, "tests/fail-a.test.ts"));
    expect(out.stderr).toContain(testCommand(world, "tests/fail-b.test.ts"));
    // the files: the test files the command names and the approved anchors the landing changed
    for (const file of ["tests/fail-a.test.ts", "tests/fail-b.test.ts", "src/fa.ts", "src/fb.ts"]) expect(out.stderr).toContain(file);
    // the passing task is not named as failing
    expect(out.stderr).not.toContain(ok.slug);
    // every oracle ran even after the first failure (each failing file twice: the run and its single re-run)
    expect(countRuns(world, "test tests/fail-a.test.ts")).toBe(2);
    expect(countRuns(world, "test tests/fail-b.test.ts")).toBe(2);
    expect(countRuns(world, "test tests/ok-1.test.ts")).toBe(1);
    // nothing moved and nothing was recorded
    expect(mainTip(world)).toBe(mainBefore);
    expect(await taskOf(world, a.slug)).toEqual(before.a);
    expect(await taskOf(world, b.slug)).toEqual(before.b);
    expect(await taskOf(world, ok.slug)).toEqual(before.ok);
    const worktree = join(fixture.dir, ".claude", "worktrees", `integrate-${OWNER}`);
    expect(existsSync(worktree)).toBe(true);
    expect(gitIn(worktree, ["rev-parse", "HEAD"])).toBe(mainBefore);
    expect(gitIn(worktree, ["status", "--porcelain"])).toBe("");
  });

  it("AC-DCS2-2: a task whose anchored test file is missing and was not deleted is not archived and prints [floor: missing-oracle-file] naming the path; the other tasks of the landing proceed", async () => {
    const world = await makeWorld();
    const { good, missing } = await missingAndDeleted(world);
    const out = await integrateBranch(world, "integration/m");
    expect(out.exitCode, out.text).toBe(0);
    expect(out.text).toContain("[floor: missing-oracle-file]");
    expect(out.text).toContain("tests/missing.test.ts");
    expect((await taskOf(world, good.slug)).status).toBe("archived");
    expect((await taskOf(world, missing.slug)).status).not.toBe("archived");
    // its oracles left the union: no row on it, its test file never ran
    expect((await rowsOf(world, missing.slug)).length).toBe(0);
    expect(countRuns(world, "test tests/missing.test.ts")).toBe(0);
  });
});

// ───────────────────────────── AC-DCS2-3 ─────────────────────────────

describe("AC-DCS2-3: the oracle run of integrate is bounded, timed and printed", () => {
  it("AC-DCS2-3: only the contract oracles run, each exactly once (N distinct oracles, N runs); an unrelated test never runs; every phase prints its duration", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    fixture.git(["branch", "integration/b", "main"]);
    const plan = await fixture.createPlan("Bounded plan", "integration/b");
    const a = await landable(world, plan, "ba", ["tests/ba-1.test.ts", "tests/ba-2.test.ts"], { "tests/ba-1.test.ts": "// 1\n", "tests/ba-2.test.ts": "// 2\n" });
    const b = await landable(world, plan, "bb", ["tests/bb-1.test.ts"], { "tests/bb-1.test.ts": "// 1\n" });
    foldInto(world, "integration/b", [a.tree, b.tree]);

    const out = await integrateBranch(world, "integration/b");
    expect(out.exitCode, out.text).toBe(0);
    // distinct oracles of the union: install + typecheck + three test files (the AC command logs nothing): exactly these lines
    expect(runLines(world).sort()).toEqual(["install", "test tests/ba-1.test.ts", "test tests/ba-2.test.ts", "test tests/bb-1.test.ts", "typecheck"].sort());
    expect(runLines(world).some((line) => line.includes("unrelated"))).toBe(false);
    for (const phase of ["merge", "floor", "install", "typecheck", "test:tests/ba-1.test.ts", "test:tests/ba-2.test.ts", "test:tests/bb-1.test.ts", "recording", "done-walk"]) {
      const escaped = phase.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      expect(out.stdout, `phase line of ${phase}`).toMatch(new RegExp(`^phase ${escaped} \\d+(\\.\\d+)?s$`, "m"));
    }
  });

  it("AC-DCS2-3: an oracle that outlives workflow.integrate.oracle_timeout_seconds is a failed run with the cause timeout (exit 1, main unchanged)", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Timeout plan");
    const slow = await landable(world, plan, "slow", ["tests/slow-1.test.ts"], { "tests/slow-1.test.ts": "// slow\n" });
    // reason: the key is set after the fixture's own commands ran, so a build that does not know it fails the landing, not the setup
    patchLoreConfig(fixture.dir, { workflow: { integrate: { oracle_timeout_seconds: 1 } } });
    const mainBefore = mainTip(world);
    const started = Date.now();
    const out = await integrateBranch(world, slow.tree.branch);
    expect(out.exitCode, out.text).toBe(1);
    expect(out.stderr).toContain("integrate-oracle-failed");
    expect(out.stderr).toContain("timeout");
    expect(out.stderr).toContain(slow.slug);
    // each attempt was cut at one second (the run and its single re-run), never the eight seconds of the command
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(mainTip(world)).toBe(mainBefore);
  });

  it("AC-DCS2-3: a floor_covers oracle is not run again and its row takes the floor result; without it the same oracle runs twice (floor and oracle)", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const typecheck = logCommands(world).typecheck;
    patchLoreConfig(fixture.dir, { workflow: { integrate: { floor_command: typecheck } } });
    const plan = await fixture.createPlan("Covers plan");
    const first = await landable(world, plan, "c1", ["tests/c1-1.test.ts"], { "tests/c1-1.test.ts": "// 1\n" });
    const plain = await integrateBranch(world, first.tree.branch);
    expect(plain.exitCode, plain.text).toBe(0);
    expect(countRuns(world, "typecheck")).toBe(2);

    patchLoreConfig(fixture.dir, { workflow: { integrate: { floor_covers: ["typecheck"] } } });
    const second = await landable(world, plan, "c2", ["tests/c2-1.test.ts"], { "tests/c2-1.test.ts": "// 2\n" });
    const covered = await integrateBranch(world, second.tree.branch);
    expect(covered.exitCode, covered.text).toBe(0);
    expect(countRuns(world, "typecheck")).toBe(3);
    const row = rowFor(await rowsOf(world, second.slug), typecheck);
    expect(row?.result).toBe("pass");
    expect(row?.attestation?.head_sha).toBe(mainTip(world));
    expect(row?.attestation?.recorded_at_landing).toBe(mainTip(world));
    expect((await taskOf(world, second.slug)).status).toBe("archived");
  });

  it("AC-DCS2-3: workflow.integrate.oracle_timeout_seconds that is not a positive integer exits 4 naming the key", async () => {
    const world = await makeWorld();
    const plan = await world.fixture.createPlan("Bad timeout plan");
    const task = await landable(world, plan, "bt", ["tests/bt-1.test.ts"], { "tests/bt-1.test.ts": "// bt\n" });
    const mainBefore = mainTip(world);
    for (const bad of [0, -3, 1.5, "ten"]) {
      patchLoreConfig(world.fixture.dir, { workflow: { integrate: { oracle_timeout_seconds: bad } } });
      const out = await integrateBranch(world, task.tree.branch);
      expect(out.exitCode, `${String(bad)}: ${out.text}`).toBe(4);
      expect(out.text).toContain("oracle_timeout_seconds");
      expect(mainTip(world)).toBe(mainBefore);
      expect(runLines(world)).toEqual([]);
    }
    // a positive integer is accepted: the landing runs
    patchLoreConfig(world.fixture.dir, { workflow: { integrate: { oracle_timeout_seconds: 120 } } });
    const accepted = await integrateBranch(world, task.tree.branch);
    expect(accepted.exitCode, accepted.text).toBe(0);
    expect(countRuns(world, "test tests/bt-1.test.ts")).toBe(1);
  });
});

// ───────────────────────────── AC-DCS2-4 ─────────────────────────────

interface StubIssue {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
  readonly comments: readonly string[];
}

function stubIssues(world: World): StubIssue[] {
  const state = JSON.parse(readFileSync(join(world.stub, "state.json"), "utf8")) as { issues: Record<string, StubIssue> };
  return Object.values(state.issues);
}

describe("AC-DCS2-4: a flaky oracle lands once, flagged and filed, never silent", () => {
  it("AC-DCS2-4: a command that fails once then passes lands (exit 0) with a flaky row and one ledger issue; a second flaky landing comments on the same issue; a failing tracker never blocks and leaves ledger_error on the row; a command that fails twice is refused with no row and no issue", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Flaky plan");

    // (1) first flaky landing: created
    const one = await landable(world, plan, "fl1", ["tests/flaky-a.test.ts"], { "tests/flaky-a.test.ts": "// a\n" });
    const first = await integrateBranch(world, one.tree.branch);
    expect(first.exitCode, first.text).toBe(0);
    expect(countRuns(world, "test tests/flaky-a.test.ts")).toBe(2);
    const flakyRow = rowFor(await rowsOf(world, one.slug), testCommand(world, "tests/flaky-a.test.ts"));
    expect(flakyRow?.result).toBe("pass");
    expect(flakyRow?.flaky).toBe(true);
    expect(flakyRow?.ledger_error).toBeUndefined();
    // the other rows are not flaky
    expect(rowFor(await rowsOf(world, one.slug), logCommands(world).typecheck)?.flaky).toBeUndefined();
    let issues = stubIssues(world);
    expect(issues.length).toBe(1);
    expect(issues[0]?.title).toBe("Flaky tests ledger");
    expect(issues[0]?.labels).toEqual(["flaky-tests"]);
    expect(first.stdout).toMatch(/flaky .*test:tests\/flaky-a\.test\.ts.*#1/);
    expect((await taskOf(world, one.slug)).status).toBe("archived");
    // lore get shows the flag next to the row
    const shown = await loreIn(world, fixture.dir, ["get", one.slug]);
    expect(shown.text).toContain("Flaky oracle rows");
    expect(shown.text).toContain(testCommand(world, "tests/flaky-a.test.ts"));

    // (2) second flaky landing appends to the same issue, naming the oracle, task, landing commit and both outcomes
    const two = await landable(world, plan, "fl2", ["tests/flaky-b.test.ts"], { "tests/flaky-b.test.ts": "// b\n" });
    const second = await integrateBranch(world, two.tree.branch);
    expect(second.exitCode, second.text).toBe(0);
    issues = stubIssues(world);
    expect(issues.length).toBe(1);
    expect(issues[0]?.comments.length).toBe(1);
    const comment = issues[0]?.comments[0] ?? "";
    expect(comment).toContain("test:tests/flaky-b.test.ts");
    expect(comment).toContain(two.slug);
    expect(comment).toContain(mainTip(world));
    expect(comment).toMatch(/failed/);
    expect(comment).toMatch(/passed/);
    expect(second.stdout).toMatch(/flaky .*test:tests\/flaky-b\.test\.ts.*#1/);

    // (3) the tracker fails: the landing proceeds, the row stays flaky and carries ledger_error, the line prints the failure
    writeFileSync(join(world.stub, "fail"), "1");
    const three = await landable(world, plan, "fl3", ["tests/flaky-c.test.ts"], { "tests/flaky-c.test.ts": "// c\n" });
    const third = await integrateBranch(world, three.tree.branch);
    expect(third.exitCode, third.text).toBe(0);
    const failedRow = rowFor(await rowsOf(world, three.slug), testCommand(world, "tests/flaky-c.test.ts"));
    expect(failedRow?.flaky).toBe(true);
    expect(typeof failedRow?.ledger_error).toBe("string");
    expect((failedRow?.ledger_error ?? "").length).toBeGreaterThan(0);
    expect(third.text).toMatch(/flaky .*test:tests\/flaky-c\.test\.ts/);
    expect(third.text).toContain(failedRow?.ledger_error ?? "never-matches");
    expect((await taskOf(world, three.slug)).status).toBe("archived");
    rmSync(join(world.stub, "fail"));
    expect(stubIssues(world).length).toBe(1);

    // (4) a command that fails twice is refused: no row, no issue, no comment
    const commentsBefore = stubIssues(world)[0]?.comments.length;
    const four = await landable(world, plan, "fl4", ["tests/fail-d.test.ts"], { "tests/fail-d.test.ts": "// d\n" });
    const fourBefore = await taskOf(world, four.slug);
    const mainBefore = mainTip(world);
    const fourth = await integrateBranch(world, four.tree.branch);
    expect(fourth.exitCode, fourth.text).toBe(1);
    expect(fourth.stderr).toContain("integrate-oracle-failed");
    expect(countRuns(world, "test tests/fail-d.test.ts")).toBe(2);
    expect(await taskOf(world, four.slug)).toEqual(fourBefore);
    expect(mainTip(world)).toBe(mainBefore);
    expect(stubIssues(world).length).toBe(1);
    expect(stubIssues(world)[0]?.comments.length).toBe(commentsBefore);
  });
});

// ───────────────────────────── AC-DCS1-27 ─────────────────────────────

/** Rewrites the landing commit recorded on a task, through the store (what a landing at another commit would leave). */
async function recordLandingCommit(world: World, slug: string, landingCommit: string): Promise<void> {
  const app = createApp(join(world.fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const found = await app.corpusService.get(slug);
    if (!found.ok) throw new Error(`seed: ${slug} not found: ${JSON.stringify(found.error)}`);
    const doc = found.value.doc;
    const landing = doc.extra["landing"] as Record<string, unknown> | undefined;
    const claim = doc.extra["claim"] as Record<string, unknown> | undefined;
    if (landing === undefined || claim === undefined) throw new Error(`seed: ${slug} holds no landing or no claim`);
    const written = await app.corpusService.writeDoc({
      doc,
      patch: { extra: { ...doc.extra, landing: { ...landing, landing_commit: landingCommit } } },
      action: "update",
      changeSummary: "fixture: landing recorded at another commit",
      auditAction: "update",
      auditDetails: { operation: "fixture-landing-commit" },
      lock: "none",
      by: String(claim["by"]),
      now: new Date().toISOString(),
    });
    if (!written.ok) throw new Error(`seed: landing rewrite failed: ${JSON.stringify(written.error)}`);
  } finally {
    app.close();
  }
}

/** A commit object (no ref moves) whose tree is `base`'s tree plus one extra file, or the same tree when `extra` is undefined. */
function commitObject(world: World, base: string, extra?: { path: string; content: string }): string {
  const env = { ...process.env, GIT_INDEX_FILE: join(world.scratch, `index-${(world.sequence += 1)}`) };
  const git = (args: string[], input?: string): string => execFileSync("git", args, { cwd: world.fixture.dir, env, encoding: "utf8", ...(input !== undefined ? { input } : {}) }).trim();
  git(["read-tree", base]);
  if (extra !== undefined) {
    const blob = git(["hash-object", "-w", "--stdin"], extra.content);
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${extra.path}`]);
  }
  const tree = git(["write-tree"]);
  return git(["-c", "user.email=f@example.invalid", "-c", "user.name=f", "commit-tree", tree, "-p", base, "-m", "fixture commit"]);
}

describe("AC-DCS1-27: a pass row counts while the content it covers is the landed content", () => {
  it("AC-DCS1-27: the rows integrate records count at the newest landing of a task whose red run exists: integrate archives it on them", async () => {
    const world = await makeWorld();
    const plan = await world.fixture.createPlan("Binding plan");
    const task = await landable(world, plan, "n27a", ["tests/n27a.test.ts"], { "tests/n27a.test.ts": "// n27a\n" }, { red: true });
    const red = await loreIn(world, task.tree.path, ["evidence", task.slug, "--oracle", "test", "--command", `sh -c 'printf " Test Files  1 failed (1)\\n      Tests  1 failed (1)\\n"; exit 1'`, "--result", "expected-fail", "--capture"], sessionEnv(task.session));
    expect(red.exitCode, red.text).toBe(0);
    const out = await integrateBranch(world, task.tree.branch);
    expect(out.exitCode, out.text).toBe(0);
    expect((await taskOf(world, task.slug)).status).toBe("archived");
    const landing = await landingOf(world, task.slug);
    const counted = (await rowsOf(world, task.slug)).filter((row) => row.attestation?.recorded_at_landing === landing?.landing_commit);
    expect(counted.length).toBe(3);
  });

  it("AC-DCS1-27: lore done refuses a task whose landing moved to a changed tree (evidence-stale), an unreadable commit (evidence-unmeasurable), and counts the same tree on another commit", async () => {
    const world = await makeWorld();
    const { fixture } = world;
    const plan = await fixture.createPlan("Done binding plan");
    // a task with a red requirement and no red run: integrate lands it with its rows and the done walk stops at red-first
    const open = async (label: string, anchor: string): Promise<Landable> => {
      const task = await landable(world, plan, label, [anchor], { [anchor]: `// ${label}\n` }, { red: true });
      const out = await integrateBranch(world, task.tree.branch);
      expect(out.exitCode, out.text).toBe(0);
      expect(out.text).toContain("[floor: red-first]");
      expect((await taskOf(world, task.slug)).status).not.toBe("archived");
      const red = await loreIn(world, task.tree.path, ["evidence", task.slug, "--oracle", "test", "--command", `sh -c 'printf " Test Files  1 failed (1)\\n      Tests  1 failed (1)\\n"; exit 1'`, "--result", "expected-fail", "--capture"], sessionEnv(task.session));
      expect(red.exitCode, red.text).toBe(0);
      return task;
    };
    const stale = await open("d27a", "tests/d27a.test.ts");
    const unreadable = await open("d27b", "tests/d27b.test.ts");
    const same = await open("d27c", "tests/d27c.test.ts");
    const control = await open("d27d", "tests/d27d.test.ts");
    const main = mainTip(world);

    await recordLandingCommit(world, stale.slug, commitObject(world, main, { path: "src/moved-on.ts", content: "export const moved = 1;\n" }));
    await recordLandingCommit(world, unreadable.slug, "0123456789abcdef0123456789abcdef01234567");
    // the same tree on another commit: an empty commit over the commit the task's rows ran on
    const rowHead = (await rowsOf(world, same.slug))[0]?.attestation?.head_sha ?? "";
    expect(rowHead).toMatch(/^[0-9a-f]{40}$/);
    await recordLandingCommit(world, same.slug, commitObject(world, rowHead));

    const refusedStale = await loreIn(world, fixture.dir, ["done", stale.slug], sessionEnv(stale.session));
    expect(refusedStale.exitCode, refusedStale.text).toBe(4);
    expect(refusedStale.text).toContain("[floor: attested-pass]");
    expect(refusedStale.text).toContain("evidence-stale");
    expect(refusedStale.text).toContain("src/moved-on.ts");
    expect((await taskOf(world, stale.slug)).status).not.toBe("archived");

    const refusedUnreadable = await loreIn(world, fixture.dir, ["done", unreadable.slug], sessionEnv(unreadable.session));
    expect(refusedUnreadable.exitCode, refusedUnreadable.text).toBe(4);
    expect(refusedUnreadable.text).toContain("[floor: attested-pass]");
    expect(refusedUnreadable.text).toContain("evidence-unmeasurable");

    const counted = await loreIn(world, fixture.dir, ["done", same.slug], sessionEnv(same.session));
    expect(counted.exitCode, counted.text).toBe(0);
    expect((await taskOf(world, same.slug)).status).toBe("archived");

    // the control: the landing as integrate recorded it (the rows are recorded by integrate at that landing)
    const done = await loreIn(world, fixture.dir, ["done", control.slug], sessionEnv(control.session));
    expect(done.exitCode, done.text).toBe(0);
    expect((await taskOf(world, control.slug)).status).toBe("archived");
  });
});

// ───────────────────────────── AC-DCS1-30 ─────────────────────────────

describe("AC-DCS1-30: the contract is evaluated against the landed tree", () => {
  it("AC-DCS1-30: a test file the landing deleted leaves the oracle set with a recorded reason (done line, get section); another missing file refuses only the task that anchors it", async () => {
    const world = await makeWorld();
    const { good, missing, deleted } = await missingAndDeleted(world);
    const out = await integrateBranch(world, "integration/m");
    expect(out.exitCode, out.text).toBe(0);
    const merged = mainTip(world);

    // the deleted file: its task is archived on the remaining oracles, the removal is recorded with its reason and landed commit
    expect((await taskOf(world, deleted.slug)).status).toBe("archived");
    const removed = (await contractOf(world, deleted.slug)).removed_oracles ?? [];
    expect(removed.map((entry) => entry.id)).toEqual(["test:tests/old.test.ts"]);
    expect(removed[0]?.path).toBe("tests/old.test.ts");
    expect(removed[0]?.reason).toContain("deleted by the landing");
    expect(removed[0]?.landed_commit).toBe(merged);
    expect(out.text).toContain("tests/old.test.ts");
    const shown = await loreIn(world, fixture(world).dir, ["get", deleted.slug]);
    expect(shown.text).toContain("Removed oracles");
    expect(shown.text).toContain("tests/old.test.ts");
    // the deleted file never ran, and its task holds no row for it
    expect(countRuns(world, "test tests/old.test.ts")).toBe(0);
    expect(rowFor(await rowsOf(world, deleted.slug), testCommand(world, "tests/old.test.ts"))).toBeUndefined();

    // the file absent but not deleted by the landing: refused, naming the path, floor missing-oracle-file; nothing else of that task is archived
    expect(out.text).toContain("[floor: missing-oracle-file]");
    expect(out.text).toContain("tests/missing.test.ts");
    expect((await taskOf(world, missing.slug)).status).not.toBe("archived");
    expect(((await contractOf(world, missing.slug)).removed_oracles ?? []).length).toBe(0);
    // the other tasks of the landing proceed
    expect((await taskOf(world, good.slug)).status).toBe("archived");
    expect(countRuns(world, "test tests/good-1.test.ts")).toBe(1);
  });
});

function fixture(world: World): DoneContractFixture {
  return world.fixture;
}
