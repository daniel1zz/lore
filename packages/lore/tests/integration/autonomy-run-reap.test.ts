// @spawns packages/lore/src/index.ts
// @spawns assets/hooks/run-register.mjs
/**
 * AC-AU-5 oracle — lore reaps what ENDED runs left behind, never a live one's.
 *
 * Real child processes in THROWAWAY repositories (mkdtemp + `git init` + `lore init`), never the repo's own `.lore/`.
 * "Harness" processes are real `sleep`/`node` processes whose pid and start time the CLI records through
 * `lore run register --harness-pid`; orphans (PPID 1) are made with a shell that backgrounds `sleep` and exits.
 * Every process a test spawns is tracked and SIGKILLed in teardown, and teardown ASSERTS none is left alive.
 *
 * Halves (spec AC-AU-5): (1) orphan started inside an ended run's lifetime -> reaped; (2) same orphan started after
 * the run ended -> kept, escalated; (3) a process descending from a live run -> kept, no signal, no decision row;
 * (4) two concurrent reaps -> one kill, the other sees ESRCH = already-gone, both exit 0; (5) after reaping,
 * `lore worktree check` reports the worktree unoccupied; (6) run-end-stale: dead recorded pid (start time checked) ->
 * ended with reason dead-pid; legacy runs without a pid -> ONE pending decision; a live pid is never ended.
 * Plus: registration records pid / start / worktree (migration 021), the shipped hook forwards its parent pid.
 *
 * @spec_ref AC-AU-5
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { DecisionService } from "../../src/service/decision-service.js";
import { RunReapService, type ReapReport } from "../../src/service/run-reap-service.js";
import { createRealProcessTablePort, type ProcessTablePort } from "../../src/adapters/process-table-port.js";
import { ok } from "@lore/core";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "run-register.mjs");

// ── process bookkeeping: every spawned pid is killed and verified dead in teardown ─────────────────────────────

const trackedPids = new Set<number>();
const trackedDirs: string[] = [];

function isAlive(pid: number): boolean {
  const ps = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  if (ps.status !== 0) return false;
  const stat = (ps.stdout ?? "").trim();
  return stat !== "" && !stat.startsWith("Z");
}

function psField(pid: number, field: "ppid" | "lstart"): string {
  return (spawnSync("ps", ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).stdout ?? "").trim();
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

/** A long-lived real process (the stand-in for a harness); child of this test process. */
function spawnSleeper(cwd: string = tmpdir()): ChildProcess & { pid: number } {
  const child = spawn("sleep", ["600"], { cwd, stdio: "ignore" });
  if (child.pid === undefined) throw new Error("sleep did not start");
  trackedPids.add(child.pid);
  return child as ChildProcess & { pid: number };
}

async function killAndWait(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // reason: already gone is the goal.
  }
  await waitFor(() => !isAlive(pid), `pid ${pid} to die`);
}

/** An orphan: `sleep` backgrounded by a shell that exits, so it is re-parented to PID 1. Returns its pid. */
async function spawnOrphan(cwd: string): Promise<number> {
  const run = spawnSync("sh", ["-c", "sleep 600 >/dev/null 2>&1 </dev/null & echo $!"], { cwd, encoding: "utf8" });
  const pid = Number.parseInt((run.stdout ?? "").trim(), 10);
  if (!Number.isInteger(pid)) throw new Error(`orphan spawn failed: ${run.stderr}`);
  trackedPids.add(pid);
  await waitFor(() => psField(pid, "ppid") === "1", `orphan ${pid} to reach ppid 1`);
  return pid;
}

/** A non-shell parent (node) that stays alive with a `sleep` child whose cwd is `childCwd`. Returns both pids. */
async function spawnParentWithChild(childCwd: string): Promise<{ parent: number; child: number }> {
  const script = `const {spawn}=require("node:child_process");const c=spawn("sleep",["600"],{cwd:${JSON.stringify(childCwd)},stdio:"ignore"});console.log(c.pid);setInterval(()=>{},1000);`;
  const parent = spawn("node", ["-e", script], { cwd: tmpdir(), stdio: ["ignore", "pipe", "ignore"] });
  if (parent.pid === undefined) throw new Error("node parent did not start");
  trackedPids.add(parent.pid);
  const child = await new Promise<number>((resolve, reject) => {
    parent.stdout?.once("data", (chunk: Buffer) => resolve(Number.parseInt(chunk.toString("utf8").trim(), 10)));
    parent.once("error", reject);
  });
  trackedPids.add(child);
  return { parent: parent.pid, child };
}

/**
 * A node "shared main harness" that spawns a `sleep` child with cwd `childCwd` only when the test sends it a line on stdin
 * (`startChild()`), so the child provably starts AFTER the runs registered against the parent pid. The proof windows are
 * second-precision and floored at registered_at, so "after registration" is the whole requirement: no wall-clock delay,
 * which a slow `lore run register` under load could outlast. `startChild` resolves with the child's pid once it runs.
 */
function spawnHarnessWithLateChild(childCwd: string): { parent: number; startChild: () => Promise<number> } {
  const script = `const {spawn}=require("node:child_process");process.stdin.once("data",()=>{const c=spawn("sleep",["600"],{cwd:${JSON.stringify(childCwd)},stdio:"ignore"});console.log(c.pid);});setInterval(()=>{},1000);`;
  const parent = spawn("node", ["-e", script], { cwd: tmpdir(), stdio: ["pipe", "pipe", "ignore"] });
  if (parent.pid === undefined) throw new Error("node harness did not start");
  trackedPids.add(parent.pid);
  const startChild = () =>
    new Promise<number>((resolve, reject) => {
      parent.stdout?.once("data", (chunk: Buffer) => {
        const pid = Number.parseInt(chunk.toString("utf8").trim(), 10);
        trackedPids.add(pid);
        resolve(pid);
      });
      parent.once("error", reject);
      parent.stdin?.write("go\n");
    });
  return { parent: parent.pid, startChild };
}

afterEach(async () => {
  for (const pid of trackedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // reason: already gone.
    }
  }
  for (const pid of trackedPids) await waitFor(() => !isAlive(pid), `teardown: pid ${pid} to die`);
  trackedPids.clear();
});

afterAll(() => {
  for (const dir of trackedDirs) if (dir.startsWith(realpathSync(tmpdir())) || dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
});

// ── throwaway repository + lore CLI ───────────────────────────────────────────────────────────────────────────

interface Fixture {
  readonly corpus: string;
  readonly dbPath: string;
  worktree(name: string): string;
  lore(args: string[], cwd?: string): { stdout: string; stderr: string; exitCode: number };
  register(session: string, options: { cwd: string; pid?: number }): void;
  endRun(runId: string): void;
  reap(options?: { apply?: boolean }): { report: ReapReport; exitCode: number; stderr: string };
  db<T>(body: (db: Database) => T): T;
}

function sh(cwd: string, command: string, args: string[]): void {
  const run = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${run.stderr}`);
}

function makeFixture(): Fixture {
  const corpus = realpathSync(mkdtempSync(join(tmpdir(), "lore-au5-")));
  trackedDirs.push(corpus);
  sh(corpus, "git", ["init", "-q", "-b", "main"]);
  sh(corpus, "git", ["config", "user.email", "t@example.com"]);
  sh(corpus, "git", ["config", "user.name", "t"]);
  writeFileSync(join(corpus, "README.md"), "x\n");
  sh(corpus, "git", ["add", "."]);
  sh(corpus, "git", ["commit", "-q", "-m", "init"]);

  const lore: Fixture["lore"] = (args, cwd = corpus) => {
    const r = spawnSync("bun", ["run", INDEX_TS, ...args], {
      cwd,
      env: { ...process.env, HOME: corpus, EDITOR: "true", CLAUDECODE: "1" },
      encoding: "utf8",
    });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
  };
  const init = lore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  const dbPath = join(corpus, ".lore", "lore.db");

  const fixture: Fixture = {
    corpus,
    dbPath,
    worktree(name) {
      const path = join(corpus, ".wt", name);
      mkdirSync(join(corpus, ".wt"), { recursive: true });
      sh(corpus, "git", ["worktree", "add", "-q", "-b", `b-${name}`, path]);
      return realpathSync(path);
    },
    lore,
    register(session, { cwd, pid }) {
      const r = lore(
        ["run", "register", "--harness", "claude-code", "--session", session, ...(pid !== undefined ? ["--harness-pid", String(pid)] : [])],
        cwd,
      );
      if (r.exitCode !== 0) throw new Error(`register ${session} failed (${r.exitCode}): ${r.stderr}`);
      // Assert on recorded state: a harness whose pid the CLI could not probe silently registers as a legacy run, which
      // would surface later as an unrelated mismatch. Fail here, naming the registration, with what the probe said.
      if (pid !== undefined && r.stderr.includes("could not be probed")) {
        throw new Error(`register ${session}: harness pid ${pid} was not recorded (ps lstart=${JSON.stringify(psField(pid, "lstart"))}): ${r.stderr}`);
      }
    },
    endRun(runId) {
      const r = lore(["run", "end", runId, "--reason", "test-ended"]);
      if (r.exitCode !== 0) throw new Error(`end ${runId} failed (${r.exitCode}): ${r.stderr}`);
    },
    reap(options = {}) {
      const r = lore(["run", "reap", "--json", ...(options.apply === true ? ["--apply"] : [])]);
      const parsed = r.stdout.trim() === "" ? null : (JSON.parse(r.stdout) as { data: ReapReport });
      return { report: (parsed?.data ?? { apply: false, runs: [], legacy: null, processes: [], rescan_survivors: [] }) as ReapReport, exitCode: r.exitCode, stderr: r.stderr };
    },
    db(body) {
      const db = new Database(dbPath);
      try {
        return body(db);
      } finally {
        db.close();
      }
    },
  };
  return fixture;
}

function decisionRows(fixture: Fixture, classId: string): { subject_id: string; verdict: string; channel: string }[] {
  return fixture.db(
    (db) => db.query("SELECT subject_id, verdict, channel FROM decision_log WHERE class = ? ORDER BY id").all(classId) as { subject_id: string; verdict: string; channel: string }[],
  );
}

function entryFor(report: ReapReport, pid: number) {
  return report.processes.find((entry) => entry.pid === pid);
}

/** Registers `session` from `worktree` with a dead harness pid, then ends it: an ENDED run owning that worktree. */
async function endedRunIn(fixture: Fixture, session: string, worktree: string): Promise<{ runId: string }> {
  const harness = spawnSleeper();
  fixture.register(session, { cwd: worktree, pid: harness.pid });
  await killAndWait(harness.pid);
  fixture.endRun(`cc:${session}`);
  return { runId: `cc:${session}` };
}

// ── tests ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe("AC-AU-5 registration records the process (migration 021)", () => {
  it("records harness pid, its start time and the checkout root; a registration without --harness-pid records nothing", () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("reg");
    const harness = spawnSleeper();
    fixture.register("reg-a", { cwd: worktree, pid: harness.pid });
    fixture.register("reg-legacy", { cwd: worktree });
    const rows = fixture.db((db) => ({
      version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      runs: db.query("SELECT id, harness_pid, harness_pid_start, worktree FROM runs ORDER BY id").all() as {
        id: string;
        harness_pid: number | null;
        harness_pid_start: string | null;
        worktree: string | null;
      }[],
    }));
    expect(rows.version).toBeGreaterThanOrEqual(21);
    const recorded = rows.runs.find((row) => row.id === "cc:reg-a");
    expect(recorded?.harness_pid).toBe(harness.pid);
    expect(recorded?.harness_pid_start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
    expect(recorded?.worktree).toBe(worktree);
    const legacy = rows.runs.find((row) => row.id === "cc:reg-legacy");
    expect(legacy).toMatchObject({ harness_pid: null, harness_pid_start: null, worktree: null });
  });

  it("a non-numeric --harness-pid is a usage error (exit 2) and registers nothing", () => {
    const fixture = makeFixture();
    const r = fixture.lore(["run", "register", "--harness", "claude-code", "--session", "bad-pid", "--harness-pid", "abc"]);
    expect(r.exitCode).toBe(2);
    expect(fixture.db((db) => (db.query("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n)).toBe(0);
  });

  it("a pid that is not alive registers the run (exit 0) with a null pair and says so", async () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("deadpid");
    const harness = spawnSleeper();
    await killAndWait(harness.pid);
    const r = fixture.lore(["run", "register", "--harness", "claude-code", "--session", "dead-at-register", "--harness-pid", String(harness.pid)], worktree);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("could not be probed");
    const row = fixture.db((db) => db.query("SELECT harness_pid, harness_pid_start FROM runs WHERE id = 'cc:dead-at-register'").get() as { harness_pid: number | null; harness_pid_start: string | null });
    expect(row).toEqual({ harness_pid: null, harness_pid_start: null });
  });

  it("the shipped run-register hook forwards its parent's pid as --harness-pid", () => {
    const stubDir = mkdtempSync(join(tmpdir(), "lore-au5-stub-"));
    trackedDirs.push(stubDir);
    const log = join(stubDir, "argv.txt");
    writeFileSync(join(stubDir, "lore"), `#!/bin/bash\nprintf '%s\\n' "$@" > "${log}"\n`);
    chmodSync(join(stubDir, "lore"), 0o755);
    const run = spawnSync("node", [HOOK_PATH], {
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "hook-s" }),
      env: { ...process.env, PATH: `${stubDir}:${process.env["PATH"] ?? ""}` },
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    const argv = readFileSync(log, "utf8").trim().split("\n");
    const at = argv.indexOf("--harness-pid");
    expect(at).toBeGreaterThan(-1);
    // reason: spawnSync launches node directly, so the hook's parent is THIS test process.
    expect(argv[at + 1]).toBe(String(process.pid));
    expect(argv.slice(0, 6)).toEqual(["run", "register", "--harness", "claude-code", "--session", "hook-s"]);
  });
});

describe("AC-AU-5 lore run reap", () => {
  it("(1) an orphan (PPID 1) started inside an ended run's lifetime is reaped; a bystander elsewhere is untouched", async () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h1");
    const bystander = spawnSleeper(tmpdir());
    const harness = spawnSleeper();
    fixture.register("h1", { cwd: worktree, pid: harness.pid });
    const orphan = await spawnOrphan(worktree);
    await killAndWait(harness.pid);
    fixture.endRun("cc:h1");

    // dry run: reported, nothing signalled, nothing recorded
    const dry = fixture.reap();
    expect(dry.exitCode).toBe(0);
    expect(entryFor(dry.report, orphan)).toMatchObject({ action: "would-reap", proof: "orphan-in-lifetime", signals: [] });
    expect(isAlive(orphan)).toBe(true);
    expect(decisionRows(fixture, "process-reap")).toEqual([]);

    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    expect(entryFor(applied.report, orphan)).toMatchObject({ action: "reaped", proof: "orphan-in-lifetime", signals: ["SIGTERM"], decision: { verdict: "auto" } });
    expect(isAlive(orphan)).toBe(false);
    expect(decisionRows(fixture, "process-reap")).toEqual([{ subject_id: `pid:${orphan}`, verdict: "auto", channel: "machine" }]);
    expect(entryFor(applied.report, bystander.pid)).toBeUndefined();
    expect(isAlive(bystander.pid)).toBe(true);
  }, 90_000);

  it("(2) the same orphan started AFTER the run ended is kept and escalated (no signal, an escalate row)", async () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h2");
    await endedRunIn(fixture, "h2", worktree);
    // reason: `ps lstart` truncates to the second; start must land in a LATER second than the recorded end.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const orphan = await spawnOrphan(worktree);

    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    const entry = entryFor(applied.report, orphan);
    expect(entry).toMatchObject({ action: "escalated", proof: "none", signals: [] });
    expect(entry?.reasons.join(" ")).toContain("outside run");
    expect(isAlive(orphan)).toBe(true);
    expect(decisionRows(fixture, "process-reap")).toEqual([{ subject_id: `pid:${orphan}`, verdict: "escalate", channel: "machine" }]);
  }, 90_000);

  it("(3) a process descending from a LIVE run is kept: no signal, no decision row, still alive", async () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h3");
    await endedRunIn(fixture, "h3-old", worktree); // the worktree's ended owner
    const live = await spawnParentWithChild(worktree);
    fixture.register("h3-live", { cwd: worktree, pid: live.parent });

    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    expect(entryFor(applied.report, live.child)).toMatchObject({ action: "kept-live-owner", signals: [] });
    expect(isAlive(live.child)).toBe(true);
    expect(isAlive(live.parent)).toBe(true);
    expect(decisionRows(fixture, "process-reap").filter((row) => row.subject_id === `pid:${live.child}`)).toEqual([]);
    // the live run itself was not ended
    expect(fixture.db((db) => (db.query("SELECT ended_at FROM runs WHERE id = 'cc:h3-live'").get() as { ended_at: string | null }).ended_at)).toBeNull();
  }, 90_000);

  it("(3b) an orphan sharing the worktree with a live run that overlaps its start is escalated, not reaped", async () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h3b");
    const harness = spawnSleeper();
    fixture.register("h3b-old", { cwd: worktree, pid: harness.pid });
    const live = spawnSleeper();
    fixture.register("h3b-live", { cwd: worktree, pid: live.pid });
    const orphan = await spawnOrphan(worktree);
    await killAndWait(harness.pid);
    fixture.endRun("cc:h3b-old");

    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    expect(entryFor(applied.report, orphan)).toMatchObject({ action: "escalated", signals: [] });
    expect(isAlive(orphan)).toBe(true);
  }, 90_000);

  it("(4a) two concurrent reaps in one process: one SIGTERM is sent, the other gets ESRCH = already-gone", async () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h4a");
    const harness = spawnSleeper();
    fixture.register("h4a", { cwd: worktree, pid: harness.pid });
    const orphan = await spawnOrphan(worktree);
    await killAndWait(harness.pid);
    fixture.endRun("cc:h4a");

    const real = createRealProcessTablePort({ env: process.env });
    let arrivals = 0;
    let termsSent = 0;
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    // Both services must pass decision + start-time check while the orphan is alive before ANY signal goes out; the
    // second to arrive then waits for the first kill to land, so its real process.kill meets ESRCH.
    const gated: ProcessTablePort = {
      ...real,
      async signal(pid, signal) {
        const order = ++arrivals;
        if (order === 1) {
          await gate;
        } else {
          openGate();
          await waitFor(() => !isAlive(pid), "winner's SIGTERM to land");
        }
        const outcome = await real.signal(pid, signal);
        if (outcome === "sent") termsSent += 1;
        return outcome;
      },
    };
    const stores = [new SQLiteStore(fixture.dbPath), new SQLiteStore(fixture.dbPath)];
    try {
      const services = stores.map(
        (store) =>
          new RunReapService({
            store,
            runs: { end: async () => ok({ outcome: "ended" as const, claims: [] }) },
            decisions: new DecisionService({ store, executorRun: null }),
            processes: gated,
          }),
      );
      const results = await Promise.all(services.map((service) => service.reap({ apply: true })));
      const actions = results.map((result) => (result.ok ? entryFor(result.value, orphan)?.action : `err:${result.error.code}`)).sort();
      expect(actions).toEqual(["already-gone", "reaped"]);
      expect(termsSent).toBe(1);
      expect(isAlive(orphan)).toBe(false);
    } finally {
      for (const store of stores) store.close();
    }
  }, 90_000);

  it("(4b) two concurrent `lore run reap --apply` processes both exit 0 and the orphan dies", async () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h4b");
    const harness = spawnSleeper();
    fixture.register("h4b", { cwd: worktree, pid: harness.pid });
    const orphan = await spawnOrphan(worktree);
    await killAndWait(harness.pid);
    fixture.endRun("cc:h4b");

    const launch = () =>
      new Promise<{ exitCode: number; stdout: string }>((resolve) => {
        const child = spawn("bun", ["run", INDEX_TS, "run", "reap", "--apply", "--json"], {
          cwd: fixture.corpus,
          env: { ...process.env, HOME: fixture.corpus, EDITOR: "true", CLAUDECODE: "1" },
        });
        let stdout = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
        child.once("close", (code) => resolve({ exitCode: code ?? 1, stdout }));
      });
    const [a, b] = await Promise.all([launch(), launch()]);
    expect([a.exitCode, b.exitCode]).toEqual([0, 0]);
    expect(isAlive(orphan)).toBe(false);
    const reapedBy = [a, b].filter((r) => r.stdout.trim() !== "" && (JSON.parse(r.stdout) as { data: ReapReport }).data.processes.some((p) => p.pid === orphan && p.action === "reaped"));
    expect(reapedBy.length).toBeLessThanOrEqual(1 + 1); // at most both CLIs saw it before either killed; each exited 0
    expect(reapedBy.length).toBeGreaterThanOrEqual(1);
  }, 90_000);

  it("(5) after reaping, `lore worktree check` no longer reports a process inside the worktree", async () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h5");
    const harness = spawnSleeper();
    fixture.register("h5", { cwd: worktree, pid: harness.pid });
    const orphan = await spawnOrphan(worktree);
    await killAndWait(harness.pid);
    fixture.endRun("cc:h5");

    const before = fixture.lore(["worktree", "check", worktree, "--json"]);
    expect(before.stdout).toContain("process-inside");
    expect(fixture.reap({ apply: true }).exitCode).toBe(0);
    expect(isAlive(orphan)).toBe(false);
    const after = fixture.lore(["worktree", "check", worktree, "--json"]);
    expect(after.stdout).not.toContain("process-inside");
  }, 90_000);

  it("(6a) a run with no end whose recorded pid is dead is ended with reason dead-pid through run-end-stale; dry run changes nothing", async () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h6a");
    const harness = spawnSleeper();
    fixture.register("h6a", { cwd: worktree, pid: harness.pid });
    await killAndWait(harness.pid);

    const dry = fixture.reap();
    expect(dry.exitCode).toBe(0);
    expect(dry.report.runs).toEqual([expect.objectContaining({ run_id: "cc:h6a", action: "would-end", reason: "dead-pid" })]);
    expect(decisionRows(fixture, "run-end-stale")).toEqual([]);
    expect(fixture.db((db) => (db.query("SELECT ended_at FROM runs WHERE id = 'cc:h6a'").get() as { ended_at: string | null }).ended_at)).toBeNull();

    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    expect(applied.report.runs).toEqual([expect.objectContaining({ run_id: "cc:h6a", action: "ended", reason: "dead-pid" })]);
    const row = fixture.db((db) => db.query("SELECT ended_at, end_reason FROM runs WHERE id = 'cc:h6a'").get() as { ended_at: string | null; end_reason: string | null });
    expect(row.ended_at).not.toBeNull();
    expect(row.end_reason).toBe("dead-pid");
    expect(decisionRows(fixture, "run-end-stale")).toEqual([{ subject_id: "cc:h6a", verdict: "auto", channel: "machine" }]);
  }, 90_000);

  it("(6b) legacy runs with no recorded pid escalate as ONE pending decision, are never ended, and a repeat sweep adds no row", () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h6b");
    fixture.register("legacy-1", { cwd: worktree });
    fixture.register("legacy-2", { cwd: worktree });

    const first = fixture.reap({ apply: true });
    expect(first.exitCode).toBe(0);
    expect(first.report.legacy).toMatchObject({ run_ids: ["cc:legacy-1", "cc:legacy-2"], verdict: "escalate", already_pending: false });
    expect(first.report.runs).toEqual([]);
    expect(decisionRows(fixture, "run-end-stale")).toEqual([{ subject_id: "legacy-runs-without-recorded-pid", verdict: "escalate", channel: "machine" }]);
    expect(fixture.db((db) => (db.query("SELECT COUNT(*) AS n FROM runs WHERE ended_at IS NOT NULL").get() as { n: number }).n)).toBe(0);

    const second = fixture.reap({ apply: true });
    expect(second.exitCode).toBe(0);
    expect(second.report.legacy).toMatchObject({ already_pending: true, verdict: "escalate" });
    expect(decisionRows(fixture, "run-end-stale")).toHaveLength(1);
  }, 90_000);

  it("(6c) a run whose recorded pid is alive is never ended", () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h6c");
    const harness = spawnSleeper();
    fixture.register("h6c", { cwd: worktree, pid: harness.pid });
    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    expect(applied.report.runs).toEqual([expect.objectContaining({ run_id: "cc:h6c", action: "kept-live" })]);
    expect(fixture.db((db) => (db.query("SELECT ended_at FROM runs WHERE id = 'cc:h6c'").get() as { ended_at: string | null }).ended_at)).toBeNull();
    expect(decisionRows(fixture, "run-end-stale")).toEqual([]);
  }, 90_000);

  it("(6d) pid reuse: a live process at the recorded pid with a DIFFERENT start time does not keep the run alive", () => {
    const fixture = makeFixture();
    const worktree = fixture.worktree("h6d");
    const harness = spawnSleeper();
    fixture.register("h6d", { cwd: worktree, pid: harness.pid });
    // The pid is alive; only its recorded start time is made wrong (the pid now "belongs to someone else").
    fixture.db((db) => db.run("UPDATE runs SET harness_pid_start = '2001-01-01T00:00:00.000Z' WHERE id = 'cc:h6d'"));
    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    expect(isAlive(harness.pid)).toBe(true);
    expect(applied.report.runs).toEqual([expect.objectContaining({ run_id: "cc:h6d", action: "ended", reason: "dead-pid" })]);
  }, 90_000);

  it("an empty registry sweeps cleanly: exit 0, nothing to do", () => {
    const fixture = makeFixture();
    const r = fixture.lore(["run", "reap"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("nothing to do");
    expect(readdirSync(fixture.corpus)).toContain(".lore");
  }, 90_000);
});

describe("AC-AU-5 proof C (AU-T14): an ended subagent run sharing the live main pid", () => {
  /** main run (live, corpus checkout) + subagent run (shares main's pid, worktree W); a child of main is started (on signal) in `childAt` once both runs are registered. */
  async function sharedMainFixture(childAt: "worktree" | "main-checkout") {
    const fixture = makeFixture();
    const worktree = fixture.worktree("c1");
    const harness = spawnHarnessWithLateChild(childAt === "worktree" ? worktree : fixture.corpus);
    fixture.register("main-s", { cwd: fixture.corpus, pid: harness.parent });
    fixture.register("sub-s", { cwd: worktree, pid: harness.parent });
    const child = await harness.startChild();
    return { fixture, worktree, harness, child };
  }

  it("RED-FIRST: a process in an ended subagent's worktree, descending from the ALIVE shared main pid, is reaped", async () => {
    const { fixture, harness, child } = await sharedMainFixture("worktree");
    fixture.endRun("cc:sub-s");

    const dry = fixture.reap();
    expect(dry.exitCode).toBe(0);
    expect(entryFor(dry.report, child)).toMatchObject({ action: "would-reap", proof: "exclusive-worktree", owner_runs: ["cc:sub-s"], signals: [] });
    expect(isAlive(child)).toBe(true);

    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    expect(entryFor(applied.report, child)).toMatchObject({ action: "reaped", proof: "exclusive-worktree", signals: ["SIGTERM"], decision: { verdict: "auto" } });
    expect(isAlive(child)).toBe(false);
    expect(isAlive(harness.parent)).toBe(true);
    expect(decisionRows(fixture, "process-reap")).toEqual([{ subject_id: `pid:${child}`, verdict: "auto", channel: "machine" }]);
    expect(fixture.db((db) => (db.query("SELECT ended_at FROM runs WHERE id = 'cc:main-s'").get() as { ended_at: string | null }).ended_at)).toBeNull();
  }, 90_000);

  it("CONTROL 1: the same process while the subagent run is NOT ended is not a candidate (kept, no row)", async () => {
    const { fixture, harness, child } = await sharedMainFixture("worktree");
    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    expect(entryFor(applied.report, child)).toBeUndefined();
    expect(isAlive(child)).toBe(true);
    expect(isAlive(harness.parent)).toBe(true);
    expect(decisionRows(fixture, "process-reap")).toEqual([]);
  }, 90_000);

  it("CONTROL 2: a process in MAIN's checkout descending from the live main pid is never touched, even with an ended subagent nested below", async () => {
    const { fixture, harness, child } = await sharedMainFixture("main-checkout");
    fixture.endRun("cc:sub-s");
    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    expect(entryFor(applied.report, child)).toBeUndefined();
    expect(isAlive(child)).toBe(true);
    expect(isAlive(harness.parent)).toBe(true);
    expect(decisionRows(fixture, "process-reap")).toEqual([]);
  }, 90_000);

  it("CONTROL 3: a worktree ALSO held by a live run is not exclusive; the shared-pid descendant is kept-live-owner", async () => {
    const { fixture, worktree, harness, child } = await sharedMainFixture("worktree");
    const other = spawnSleeper();
    fixture.register("other-live", { cwd: worktree, pid: other.pid });
    fixture.endRun("cc:sub-s");
    const applied = fixture.reap({ apply: true });
    expect(applied.exitCode).toBe(0);
    expect(entryFor(applied.report, child)).toMatchObject({ action: "kept-live-owner", signals: [] });
    expect(isAlive(child)).toBe(true);
    expect(isAlive(harness.parent)).toBe(true);
  }, 90_000);
});
