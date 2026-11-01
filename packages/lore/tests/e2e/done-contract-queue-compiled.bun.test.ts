// @spawns dist/lore
// @reads assets/project/lore-config-template.yaml
// @reads assets/project/reference-transaction
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @reads packages/lore/src/**
/**
 * done-contract-queue-compiled.bun.test.ts — `lore integrate` serializes landings in a FIFO merge queue
 * (spec-integrate-proves-and-lands-evidence-at-landing-the-merge AC-DCS2-5, decision D40), observed through the compiled
 * `dist/lore` on a throwaway repository and corpus with REAL branches, worktrees, claims and REAL concurrent processes.
 *
 * Each test name starts with `AC-DCS2-5:` (with the colon), so `-t 'AC-DCS2-5:'` never matches AC-DCS2-50.
 *
 *   Task "lore integrate serializes landings in a FIFO merge queue and drops the retry loop":
 *     AC-DCS2-5   two processes landing two branches at once: both exit 0 in ticket order, the oracles never overlap, zero
 *                 retries, every row bound to its own merged commit; a waiter prints its position and the holder; a waiter
 *                 past workflow.integrate.queue_wait_seconds exits 75 integrate-queue-timeout naming the holder; a ticket of a
 *                 dead process, and one whose pid is another process now (start time differs), is removed by the next waiter;
 *                 a main that moved under the merge exits 4 integrate-main-moved naming both commits with no retry; the
 *                 per-worktree lease still answers busy (exit 75); the retry loop and the lost-races exit are gone from the source.
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository, the shipped main-ref guard installed; the
 * repository's own `.lore/` is never touched. The oracle commands are `sh -c` scripts that append `start`/`end` lines to a log file
 * OUTSIDE the repository, so a test reads the real interleaving of the phases.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { withTestRunEnv } from "../helpers/test-run-identity";
import { installShippedGuard } from "../integration/support/main-guard-repo";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(PROJECT_ROOT, "dist", "lore");

beforeAll(() => {
  // reason: the concurrency tests spawn the compiled binary; a stale one would judge the old code.
  assertFreshBinary(LORE_BIN, [join(PROJECT_ROOT, "packages", "lore", "src"), join(PROJECT_ROOT, "packages", "core", "src")]);
});

// ───────────────────────────── the world ─────────────────────────────

interface World {
  readonly fixture: DoneContractFixture;
  readonly scratch: string;
  /** Every oracle appends `start <file>` and `end <file>` lines here (outside the repository). */
  readonly log: string;
  sequence: number;
}

const worlds: World[] = [];
const spawned: Array<{ kill: () => void }> = [];

afterEach(() => {
  for (const child of spawned.splice(0)) child.kill();
  for (const world of worlds.splice(0)) {
    world.fixture.dispose();
    rmSync(world.scratch, { recursive: true, force: true });
  }
});

afterAll(() => {
  for (const child of spawned.splice(0)) child.kill();
});

/** The test-file oracle: logs start and end, and sleeps as long as the file name says (`slow` 8 s, `mid` 3 s, else none). */
function logCommands(log: string): { install: string; typecheck: string; test_file: string } {
  return {
    install: `sh -c 'echo install >> ${log}'`,
    typecheck: `sh -c 'echo typecheck >> ${log}'`,
    test_file:
      `sh -c 'echo "start $0" >> ${log}; case "$0" in *slow*) sleep 8;; *mid*) sleep 3;; esac; echo "end $0" >> ${log}; echo Ran 1 tests' {file}`,
  };
}

interface WorldOptions {
  /** Extra `workflow.integrate` keys. */
  readonly integrate?: Record<string, unknown>;
}

async function makeWorld(options: WorldOptions = {}): Promise<World> {
  const scratch = mkdtempSync(join(tmpdir(), "dcs2-queue-"));
  const log = join(scratch, "runs.log");
  writeFileSync(log, "");
  const fixture = await makeDoneContractFixture();
  const world: World = { fixture, scratch, log, sequence: 0 };
  worlds.push(world);
  fixture.setDoneContractConfig(logCommands(log));
  patchLoreConfig(fixture.dir, {
    workflow: {
      gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } },
      integrate: { floor_command: "true", ...(options.integrate ?? {}) },
    },
  });
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  mkdirSync(join(fixture.dir, "tests"), { recursive: true });
  writeFileSync(join(fixture.dir, "tests", "seed.test.ts"), "// seed\n");
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-q", "-m", "seed test files"]);
  installShippedGuard(fixture.dir, join(mkdtempSync(join(tmpdir(), "dcs2-queue-guard-")), "hooks"));
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

const gitIn = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function addWorktree(world: World, label: string): Tree {
  world.sequence += 1;
  const branch = `dcs2q-${label}-${world.sequence}`;
  const path = join(world.scratch, `${label}-${world.sequence}`);
  world.fixture.git(["worktree", "add", "-q", "-b", branch, path, "main"]);
  return { branch, path };
}

function commitIn(world: World, tree: Tree, files: Readonly<Record<string, string>>): string {
  gitIn(tree.path, ["config", "user.email", "fixture@example.invalid"]);
  gitIn(tree.path, ["config", "user.name", "fixture"]);
  for (const [path, content] of Object.entries(files)) {
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
  readonly session: string;
  readonly file: string;
}

/** An approved code task claimed by `session` on a fresh worktree branch with one anchored test file committed. */
async function landable(world: World, plan: string, label: string, session: string): Promise<Landable> {
  const file = `tests/${label}.test.ts`;
  const slug = await world.fixture.createTask({ plan, kind: "code", title: `Queue ${label}`, anchors: [file], acScope: ["AC-FX-1"] });
  await world.fixture.mustRun(["approve", slug, "--red-waiver", "the red run is not the subject of this test"]);
  const tree = addWorktree(world, label);
  const claimed = await loreIn(world, world.fixture.dir, ["claim", slug, "--worktree", tree.branch], sessionEnv(session));
  expect(claimed.exitCode, claimed.text).toBe(0);
  commitIn(world, tree, { [file]: "// test\n" });
  return { slug, tree, session, file };
}

async function planWithOpenTask(world: World, title: string): Promise<string> {
  const plan = await world.fixture.createPlan(title);
  // reason: a plan whose tasks are all terminal starts a review batch after the landing; one open draft keeps the plan open for the whole test.
  await world.fixture.createTask({ plan, kind: "code", title: "Keeps the plan open", anchors: ["tests/keep-open.test.ts"] });
  return plan;
}

// ───────────────────────────── real processes ─────────────────────────────

interface Proc {
  readonly done: Promise<Out>;
  readonly pid: number;
  /** Everything printed so far (stdout and stderr). */
  readonly seen: () => string;
}

/** Starts `dist/lore integrate <branch>` as a real process and returns at once. */
function startIntegrate(world: World, branch: string, session: string, extraArgs: readonly string[] = []): Proc {
  const args = ["integrate", branch, ...extraArgs];
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") base[key] = value;
  const env = withTestRunEnv(args, { ...base, ...sessionEnv(session), HOME: FIXTURE_HOME_OUTSIDE_REPO }, world.fixture.dir) as Record<string, string>;
  const child = Bun.spawn([LORE_BIN, ...args], { cwd: world.fixture.dir, env, stdout: "pipe", stderr: "pipe" });
  spawned.push({ kill: () => child.kill() });
  let out = "";
  let errText = "";
  const pump = async (stream: ReadableStream<Uint8Array>, sink: (text: string) => void): Promise<void> => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      sink(decoder.decode(value));
    }
  };
  const done = Promise.all([pump(child.stdout, (t) => (out += t)), pump(child.stderr, (t) => (errText += t)), child.exited]).then(([, , code]) => ({
    stdout: out,
    stderr: errText,
    exitCode: code,
    text: `${out}\n${errText}`,
  }));
  return { done, pid: child.pid, seen: () => `${out}\n${errText}` };
}

async function waitFor(what: string, condition: () => boolean, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const runLines = (world: World): string[] => readFileSync(world.log, "utf8").split("\n").filter((line) => line !== "");
const mainTip = (world: World): string => world.fixture.git(["rev-parse", "refs/heads/main"]);

/** `<git common dir>/lore-integrate-queue`: where the tickets live. */
const queueDir = (world: World): string => join(world.fixture.dir, ".git", "lore-integrate-queue");
const tickets = (world: World): string[] => (existsSync(queueDir(world)) ? readdirSync(queueDir(world)).filter((name) => name.endsWith(".ticket")).sort() : []);

interface Row {
  readonly command: string;
  readonly attestation?: { head_sha?: string };
}

async function taskState(world: World, slug: string): Promise<{ status: string; extra: Record<string, unknown> }> {
  const task = await world.fixture.readTask(slug);
  return { status: task.status, extra: task.extra };
}

async function boundCommits(world: World, slug: string): Promise<{ rows: string[]; landing: string | undefined; status: string }> {
  const { status, extra } = await taskState(world, slug);
  const rows = ((extra["verification_evidence"] ?? []) as Row[]).map((row) => row.attestation?.head_sha ?? "");
  return { rows, landing: (extra["landing"] as { landing_commit?: string } | undefined)?.landing_commit, status };
}

/** `lstart` of `pid` as an ISO instant (what the queue compares), or undefined. */
function startOf(pid: number): string | undefined {
  const ps = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  const text = (ps.stdout ?? "").trim();
  return text === "" ? undefined : new Date(text).toISOString();
}

function writeTicket(world: World, seq: number, holder: { pid: number; start_time: string; session: string; branch: string }): string {
  mkdirSync(queueDir(world), { recursive: true });
  const name = `${String(seq).padStart(8, "0")}-${String(holder.pid)}.ticket`;
  writeFileSync(join(queueDir(world), name), `${JSON.stringify({ ...holder, since: "2026-10-30T00:00:00.000Z" })}\n`);
  return name;
}

// ───────────────────────────── AC-DCS2-5 ─────────────────────────────

describe("AC-DCS2-5: landings are serialized FIFO under a ticket queue, with no lost races and no retries", () => {
  it("AC-DCS2-5: two real processes landing two branches at once both exit 0 in ticket order; the oracles never overlap, no retry, every row is bound to its own merged commit; the waiter prints its position and the holder", async () => {
    const world = await makeWorld();
    const plan = await planWithOpenTask(world, "Queue plan");
    const a = await landable(world, plan, "slow-a", "queue-s1");
    const b = await landable(world, plan, "mid-b", "queue-s2");
    const mainBefore = mainTip(world);

    const first = startIntegrate(world, a.tree.branch, a.session);
    await waitFor("the first landing's oracle to start", () => runLines(world).includes(`start ${a.file}`));
    const second = startIntegrate(world, b.tree.branch, b.session);
    const [outA, outB] = await Promise.all([first.done, second.done]);
    expect(outA.exitCode, outA.text).toBe(0);
    expect(outB.exitCode, outB.text).toBe(0);

    // serialized: the oracle of B started only after the oracle of A ended (unserialized runs interleave)
    const lines = runLines(world).filter((line) => line.startsWith("start tests/") || line.startsWith("end tests/"));
    expect(lines).toEqual([`start ${a.file}`, `end ${a.file}`, `start ${b.file}`, `end ${b.file}`]);

    // the waiter saw its place and the holder, and a queue-wait phase; the holder waited for nobody
    expect(outB.stdout).toMatch(new RegExp(`queued: position 2 of 2, holder queue-s1 ${a.tree.branch} since \\d{4}-\\d{2}-\\d{2}T`));
    expect(outB.stdout).toMatch(/phase queue-wait \d+\.\d{3}s/);
    expect(outA.stdout).not.toContain("queued:");
    expect(outA.stdout).not.toContain("phase queue-wait");

    // no retry and no lost race: one attempt line per call, nothing about a lost race
    for (const out of [outA, outB]) {
      expect([...out.stdout.matchAll(/integrate: attempt \d+ phases:/g)].length, out.text).toBe(1);
      expect(out.text).not.toMatch(/lost race|lost \d+ races/);
    }

    // ticket order: B merged onto A's merge commit, and main holds both
    const landedA = await boundCommits(world, a.slug);
    const landedB = await boundCommits(world, b.slug);
    expect(landedA.landing).toBeDefined();
    expect(landedB.landing).toBeDefined();
    expect(gitIn(world.fixture.dir, ["rev-parse", `${landedB.landing as string}^1`])).toBe(landedA.landing);
    expect(mainTip(world)).toBe(landedB.landing);
    expect(mainTip(world)).not.toBe(mainBefore);
    // every row of a task is bound to the commit that became main for ITS landing (not the other's)
    expect(landedA.rows.length).toBeGreaterThan(0);
    expect(landedB.rows.length).toBeGreaterThan(0);
    for (const sha of landedA.rows) expect(sha).toBe(landedA.landing);
    for (const sha of landedB.rows) expect(sha).toBe(landedB.landing);
    expect(landedA.status).toBe("archived");
    expect(landedB.status).toBe("archived");
    // the queue is empty again
    expect(tickets(world)).toEqual([]);
  });

  it("AC-DCS2-5: a waiter past workflow.integrate.queue_wait_seconds exits 75 integrate-queue-timeout naming the holder, removes its ticket and changes nothing; the holder still lands", async () => {
    const world = await makeWorld({ integrate: { queue_wait_seconds: 2 } });
    const plan = await planWithOpenTask(world, "Timeout plan");
    const a = await landable(world, plan, "slow-a", "queue-s1");
    const b = await landable(world, plan, "mid-b", "queue-s2");

    const first = startIntegrate(world, a.tree.branch, a.session);
    await waitFor("the holder's oracle to start", () => runLines(world).includes(`start ${a.file}`));
    const mainWhileHeld = mainTip(world);
    const second = startIntegrate(world, b.tree.branch, b.session);
    const outB = await second.done;
    expect(outB.exitCode, outB.text).toBe(75);
    expect(outB.text).toContain("integrate-queue-timeout");
    expect(outB.text).toContain("queue-s1");
    expect(outB.text).toContain(a.tree.branch);
    expect(outB.text).toContain("queue_wait_seconds");
    // the waiter changed nothing: main still where the holder left it, B's task untouched, no ticket of its own left
    expect(mainTip(world)).toBe(mainWhileHeld);
    expect((await boundCommits(world, b.slug)).landing).toBeUndefined();
    expect(runLines(world).some((line) => line === `start ${b.file}`)).toBe(false);
    expect(tickets(world).length).toBe(1);

    const outA = await first.done;
    expect(outA.exitCode, outA.text).toBe(0);
    expect(tickets(world)).toEqual([]);
  });

  it("AC-DCS2-5: a ticket of a dead process, and a ticket whose pid is another live process now (start time differs), are removed by the next waiter, which lands at once without queueing", async () => {
    const world = await makeWorld();
    const plan = await planWithOpenTask(world, "Dead plan");
    const a = await landable(world, plan, "plain-a", "queue-s1");
    const b = await landable(world, plan, "plain-b", "queue-s2");

    // a process that existed and is gone
    const gone = spawnSync("sh", ["-c", "echo $$"], { encoding: "utf8" });
    const deadPid = Number.parseInt(gone.stdout.trim(), 10);
    expect(Number.isInteger(deadPid)).toBe(true);
    const deadTicket = writeTicket(world, 1, { pid: deadPid, start_time: "2026-01-01T00:00:00.000Z", session: "ghost", branch: "ghost-branch" });
    expect(tickets(world)).toEqual([deadTicket]);

    const outA = await startIntegrate(world, a.tree.branch, a.session).done;
    expect(outA.exitCode, outA.text).toBe(0);
    expect(outA.stdout).not.toContain("queued:");
    expect(tickets(world)).toEqual([]);

    // a LIVE pid (this test process) recorded with a start time that is not its own: the pid was reused
    expect(startOf(process.pid)).toBeDefined();
    const reusedTicket = writeTicket(world, 2, { pid: process.pid, start_time: "2001-02-03T04:05:06.000Z", session: "reused", branch: "reused-branch" });
    expect(tickets(world)).toEqual([reusedTicket]);
    const outB = await startIntegrate(world, b.tree.branch, b.session).done;
    expect(outB.exitCode, outB.text).toBe(0);
    expect(outB.stdout).not.toContain("queued:");
    expect(tickets(world)).toEqual([]);
    expect((await boundCommits(world, a.slug)).status).toBe("archived");
    expect((await boundCommits(world, b.slug)).status).toBe("archived");
  });

  it("AC-DCS2-5: a ticket of a live process with its own start time holds the queue (the false-green guard of the removal above): the waiter queues behind it and names it", async () => {
    const world = await makeWorld({ integrate: { queue_wait_seconds: 2 } });
    const plan = await planWithOpenTask(world, "Live holder plan");
    const a = await landable(world, plan, "plain-a", "queue-s1");
    const start = startOf(process.pid);
    expect(start).toBeDefined();
    writeTicket(world, 1, { pid: process.pid, start_time: start as string, session: "live-holder", branch: "held-branch" });

    const out = await startIntegrate(world, a.tree.branch, a.session).done;
    expect(out.exitCode, out.text).toBe(75);
    expect(out.text).toContain("integrate-queue-timeout");
    expect(out.stdout).toMatch(/queued: position 2 of 2, holder live-holder held-branch since 2026-10-30T00:00:00\.000Z/);
    // the live holder's ticket is still there, the waiter's is gone
    expect(tickets(world).length).toBe(1);
    expect((await boundCommits(world, a.slug)).landing).toBeUndefined();
  });

  it("AC-DCS2-5: a main that moved under the merge (an update the hook should have refused) exits 4 integrate-main-moved naming both commits, makes no second attempt and leaves main where the other writer put it", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "dcs2-moved-")), "moved");
    const floorRuns = join(dirname(marker), "floor.log");
    writeFileSync(floorRuns, "");
    // the floor itself moves main once (with the integrate marker the guard honours), as an update outside integrate would
    const mover = `sh -c 'echo floor >> ${floorRuns}; if [ ! -f ${marker} ]; then touch ${marker}; git update-ref refs/heads/main $(git commit-tree -p refs/heads/main -m outsider "$(git rev-parse refs/heads/main^{tree})") $(git rev-parse refs/heads/main); fi'`;
    const world = await makeWorld({ integrate: { floor_command: `env LORE_INTEGRATE=1 ${mover}` } });
    const plan = await planWithOpenTask(world, "Moved plan");
    const a = await landable(world, plan, "plain-a", "queue-s1");
    const mainBefore = mainTip(world);

    const out = await startIntegrate(world, a.tree.branch, a.session).done;
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("integrate-main-moved");
    const mainAfter = mainTip(world);
    expect(mainAfter).not.toBe(mainBefore);
    expect(out.text).toContain(mainBefore.slice(0, 12));
    expect(out.text).toContain(mainAfter.slice(0, 12));
    // no retry: the floor ran once, one attempt line, nothing landed or archived
    expect(readFileSync(floorRuns, "utf8").split("\n").filter((line) => line === "floor").length).toBe(1);
    expect([...out.stdout.matchAll(/integrate: attempt \d+ phases:/g)].length).toBe(1);
    expect(out.text).not.toMatch(/lost race/);
    const state = await boundCommits(world, a.slug);
    expect(state.landing).toBeUndefined();
    expect(state.status).not.toBe("archived");
    expect(tickets(world)).toEqual([]);
  });

  it("AC-DCS2-5: the per-worktree lease stays: a second run in one integration worktree exits 75 busy at once, without queueing", async () => {
    const world = await makeWorld();
    const plan = await planWithOpenTask(world, "Busy plan");
    const a = await landable(world, plan, "slow-a", "queue-s1");
    const b = await landable(world, plan, "plain-b", "queue-s2");

    const first = startIntegrate(world, a.tree.branch, a.session);
    await waitFor("the holder's oracle to start", () => runLines(world).includes(`start ${a.file}`));
    // the same integration worktree (session queue-s1), another branch
    const out = await startIntegrate(world, b.tree.branch, b.session, ["--session", "queue-s1"]).done;
    expect(out.exitCode, out.text).toBe(75);
    expect(out.text).toContain("another integrate is running");
    expect(out.stdout).not.toContain("queued:");
    expect(tickets(world).length).toBe(1);
    const outA = await first.done;
    expect(outA.exitCode, outA.text).toBe(0);
  });

  it("AC-DCS2-5: workflow.integrate.queue_wait_seconds that is not a positive integer makes the config unusable: exit 4 naming the key", async () => {
    for (const bad of [0, -5, "soon", 1.5]) {
      const world = await makeWorld();
      // reason: patched after the fixture's own setup, which runs lore commands under the config it writes
      patchLoreConfig(world.fixture.dir, { workflow: { integrate: { queue_wait_seconds: bad } } });
      const out = await loreIn(world, world.fixture.dir, ["integrate", "main"], sessionEnv("queue-s1"));
      expect(out.exitCode, `value ${String(bad)}: ${out.text}`).toBe(4);
      expect(out.text, `value ${String(bad)}`).toContain("queue_wait_seconds");
    }
  });

  it("AC-DCS2-5: the three-attempt loop, the lost-races outcome and its exit code are gone from the source", () => {
    const hits = spawnSync("grep", ["-rnE", "INTEGRATE_MAX_ATTEMPTS|INTEGRATE_EXIT_LOST_RACES|lost_races", join(PROJECT_ROOT, "packages", "lore", "src")], { encoding: "utf8" });
    expect(hits.stdout.trim(), "no file under packages/lore/src may name the retry loop or the lost-races exit").toBe("");
    const service = readFileSync(join(PROJECT_ROOT, "packages", "lore", "src", "service", "integrate-service.ts"), "utf8");
    expect(service.split("await this.queue.waitForTurn(ticket);").length - 1).toBe(1);
  });
});
