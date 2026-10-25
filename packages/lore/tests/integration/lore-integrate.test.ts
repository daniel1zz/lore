// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * AC-INT-1 oracle — `lore integrate <branch>`: concurrent integrations keep their own commits and never leave a
 * half state (spec-main-advances-only-through-lore-integrate-per-session, BR-1245).
 *
 * Throwaway repo + throwaway corpus (mkdtemp, `git init`, `lore init`) with REAL git worktrees and REAL `lore`
 * processes; never the repo's own `.lore/`, refs or worktrees. The post-merge floor is the project config key
 * `workflow.integrate.floor_command`; here it is a small node script so a "race" is a fact, not a timing hope:
 *   - `barrier.mjs <dir> <n>`  parks every integrator's floor until n floors are running (all merged on the same base);
 *   - `mover.mjs <repo>`       moves main by one commit during the floor, so that attempt's CAS is lost.
 *
 * Halves (spec AC-INT-1):
 *   (1) two processes integrate two branches at once: both land as their own merge commits with their own messages,
 *       neither concludes the other's merge, the loser prints a lost race and its retry;
 *   (2) four concurrent integrators: each lands or exits exactly 75 naming the integrations that moved main; main
 *       holds exactly the landed merges; the loss count each printed is the one recorded (the observed K=4 loss rate
 *       is printed to the test log);
 *   (3) a crash after the CAS: re-running integrate is a no-op (exit 0, main unchanged);
 *   (4) a failing floor: exit 1, main unchanged (and a missing floor key fails loud, main unchanged);
 *   (5) after exit 75, `lore status` lists the branch with its consecutive loss count (text and --json), the write
 *       works from a linked session worktree, and the entry disappears once the branch lands.
 *
 * Exit codes asserted: 0 landed / already landed, 1 floor failed, 75 three lost races, 4 conflict (cleanup only —
 * the conflict contract is AC-INT-2).
 *
 * AC-INT-2 (conflicts and foreign moves of main are refused) lives in the same throwaway-repo harness:
 *   (1) a conflicting branch: exit 4 naming the paths, main/branch/every worktree unchanged, lands after main is
 *       merged into the branch;
 *   (2) the reference-transaction hook installed by `lore setup --project` refuses update-ref and a commit on main
 *       outside integrate, and setup refuses git < 2.46 naming the version;
 *   (3) `lore integrate origin/main` fetches from a bare remote and advances main by the same CAS;
 *   (4) retired: the integrate-time worktree scan and shared-checkout detach no longer exist; the guard refuses a
 *       checkout of main at checkout time (main-checkout-guard.test.ts), setup detaches existing ones
 *       (setup-project-detaches-main.test.ts) and integrate requires the guard (lore-integrate-requires-guard.test.ts).
 * Every Fixture here installs the shipped guard (integrate refuses to run without it, BR-1273).
 *
 * AC-INT-3 (a session's test run never sees another session's edits, and the shipped workflow says so):
 *   (1) `bun run test:file` in session A's worktree exits 0 while process B edits a tracked file in the shared checkout;
 *   (2) `lore setup` (global and --project) into a throwaway HOME installs worktree-dispatch, the autopilot skill and the
 *       project rule text naming `lore integrate` as the only way to land a branch; literal scan: zero merge-no-ff lines.
 *
 * @spec_ref AC-INT-1, AC-INT-2, AC-INT-3
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimBranchTask } from "../helpers/claim-branch-task.js";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { patchLoreConfig, readLoreConfig } from "../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installShippedGuard } from "./support/main-guard-repo.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const HOOK_ASSET = join(PACKAGE_ROOT, "..", "..", "assets", "project", "reference-transaction");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly out: string;
  readonly exitCode: number;
}

const BARRIER_MJS = `
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [dir, count] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, String(process.pid) + "-" + Date.now()), "");
const deadline = Date.now() + 30000;
while (readdirSync(dir).length < Number(count)) {
  if (Date.now() > deadline) { console.error("barrier timeout"); process.exit(9); }
  await new Promise((r) => setTimeout(r, 25));
}
`;

const MOVER_MJS = `
import { spawnSync } from "node:child_process";
const repo = process.argv[2];
// the mover stands for a peer integration: its CAS carries the marker, as lore integrate's own does
const git = (...a) => { const r = spawnSync("git", a, { cwd: repo, encoding: "utf8", env: { ...process.env, LORE_INTEGRATE: "1" } }); if (r.status !== 0) { console.error(r.stderr); process.exit(8); } return r.stdout.trim(); };
const main = git("rev-parse", "refs/heads/main");
const tree = git("rev-parse", main + "^{tree}");
const peer = git("commit-tree", tree, "-p", main, "-m", "peer integration " + Date.now() + "-" + process.pid);
git("update-ref", "refs/heads/main", peer, main);
`;

let root = "";
let scripts = "";
let repoSeq = 0;

class Fixture {
  readonly repo: string;
  private branchSeq = 0;

  /** `guard: false` leaves the repo without the main-ref guard (a test that must commit on main from the shared checkout). */
  constructor(floorCommand: string | null, opts: { readonly detached?: boolean; readonly guard?: boolean } = {}) {
    repoSeq += 1;
    this.repo = join(root, `repo-${repoSeq}`);
    mkdirSync(this.repo, { recursive: true });
    this.git(["init", "-q", "-b", "main"]);
    this.git(["config", "user.email", "t@example.com"]);
    this.git(["config", "user.name", "t"]);
    this.git(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(this.repo, "base.txt"), "base\n");
    this.git(["add", "base.txt"]);
    this.git(["commit", "-q", "-m", "base"]);
    const init = spawnSync("bun", ["run", INDEX_TS, "init"], { cwd: this.repo, env: this.env(), encoding: "utf8" });
    if (init.status !== 0) throw new Error(`lore init failed: ${init.stderr}`);
    appendFileSync(join(this.repo, ".git", "info", "exclude"), ".lore/\n.claude/\n");
    // the shared checkout is a read-only view of main from here on (detached), as `lore integrate` leaves it
    if (opts.detached !== false) this.git(["checkout", "-q", "--detach", "main"]);
    // integrate refuses to run without the shipped guard (BR-1273); outside the work tree so `git add` never sees it
    if (opts.guard !== false) installShippedGuard(this.repo, `${this.repo}-guard-hooks`);
    if (floorCommand !== null) this.setFloor(floorCommand);
  }

  env(session?: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: this.repo, EDITOR: "true", CLAUDECODE: "1", ...extra };
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDE_SESSION_ID;
    if (session !== undefined) env.CLAUDE_CODE_SESSION_ID = session;
    return env;
  }

  git(args: string[], cwd: string = this.repo): string {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
    return r.stdout.trim();
  }

  /** Raw git outcome (never throws): the hook refusals are the thing under test. */
  gitRaw(args: string[], cwd: string = this.repo, extraEnv: NodeJS.ProcessEnv = {}): { status: number; out: string } {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...extraEnv } });
    return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  }

  /** `lore setup --project --yes` in this repo (the repo-target installer; installs the main-ref hook). */
  setupProject(extraEnv: NodeJS.ProcessEnv = {}): RunResult {
    const r = spawnSync("bun", ["run", INDEX_TS, "setup", "--project", "--yes"], { cwd: this.repo, env: this.env(undefined, extraEnv), encoding: "utf8" });
    const stdout = r.stdout ?? "";
    const stderr = r.stderr ?? "";
    return { stdout, stderr, out: stdout + stderr, exitCode: r.status ?? 1 };
  }

  /** Every worktree of the repo (shared checkout, session, integration) as its real path. */
  worktreePaths(): string[] {
    return this.git(["worktree", "list", "--porcelain"])
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length));
  }

  /** What a worktree looks like to a reader: HEAD, branch, status, and the bytes of every tracked and untracked file. */
  worktreeState(path: string): string {
    const head = this.gitRaw(["rev-parse", "HEAD"], path).out.trim();
    const branch = this.gitRaw(["symbolic-ref", "-q", "HEAD"], path).out.trim();
    const status = this.gitRaw(["status", "--porcelain=v1", "--untracked-files=all"], path).out;
    const files = this.gitRaw(["ls-files", "--cached", "--others", "--exclude-standard"], path)
      .out.split("\n")
      .filter((f) => f !== "")
      .map((f) => `${f}=${existsSync(join(path, f)) ? readFileSync(join(path, f)).toString("base64") : "<absent>"}`);
    return [head, branch, status, ...files].join("\n");
  }

  /** The state of every worktree plus main, keyed by path. */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = { main: this.main() };
    for (const path of this.worktreePaths()) out[path] = this.worktreeState(path);
    return out;
  }

  gitStatus(args: string[], cwd: string = this.repo): number {
    return spawnSync("git", args, { cwd, encoding: "utf8" }).status ?? -1;
  }

  setFloor(floorCommand: string | null, postRefreshCommand?: string): void {
    const { workflow: _seeded, ...rest } = readLoreConfig(this.repo);
    const integrate = { floor_command: floorCommand, ...(postRefreshCommand === undefined ? {} : { post_refresh_command: postRefreshCommand }) };
    patchLoreConfig(this.repo, floorCommand === null ? rest : { ...rest, workflow: { integrate } }, { replace: true });
  }

  /** A branch off the current main holding one new file; returns the branch name. */
  makeBranch(label: string): string {
    this.branchSeq += 1;
    const name = `${label}-${this.branchSeq}`;
    this.git(["checkout", "-q", "-b", name, "main"]);
    writeFileSync(join(this.repo, `${name}.txt`), `${name}\n`);
    this.git(["add", `${name}.txt`]);
    this.git(["commit", "-q", "-m", `work on ${name}`]);
    this.git(["checkout", "-q", "--detach", "main"]);
    return name;
  }

  private readonly branchesWithTask = new Set<string>();

  /** BR-1348: `lore integrate` refuses a branch no task belongs to, so the first integrate of a branch claims a task on it. */
  private ensureTask(branch: string): void {
    if (this.branchesWithTask.has(branch)) return;
    this.branchesWithTask.add(branch);
    claimBranchTask((args) => {
      const r = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd: this.repo, env: this.env("claim"), encoding: "utf8" });
      return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
    }, this.repo, branch);
  }

  main(): string {
    return this.git(["rev-parse", "refs/heads/main"]);
  }

  isAncestorOfMain(rev: string): boolean {
    return this.gitStatus(["merge-base", "--is-ancestor", rev, "main"]) === 0;
  }

  /** First-parent merge commits on main (every integration is one). */
  mergeSubjects(): string[] {
    const out = this.git(["log", "--first-parent", "--merges", "--format=%s", "main"]);
    return out === "" ? [] : out.split("\n");
  }

  lore(args: string[], session: string | undefined, cwd: string = this.repo): Promise<RunResult> {
    return new Promise((resolve) => {
      const child = spawn("bun", ["run", INDEX_TS, ...args], { cwd, env: this.env(session) });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
      child.on("close", (code) => resolve({ stdout, stderr, out: stdout + stderr, exitCode: code ?? 1 }));
    });
  }

  integrate(branch: string, session: string, extra: string[] = [], cwd: string = this.repo): Promise<RunResult> {
    this.ensureTask(branch);
    return this.lore(["integrate", branch, "--session", session, ...extra], session, cwd);
  }

  lossFiles(): string[] {
    const dir = join(this.repo, ".lore", "integrate-losses");
    return existsSync(dir) ? readdirSync(dir) : [];
  }
}

function barrierFloor(dir: string, count: number): string {
  return `node ${JSON.stringify(join(scripts, "barrier.mjs"))} ${JSON.stringify(dir)} ${count}`;
}

function moverFloor(repo: string): string {
  return `node ${JSON.stringify(join(scripts, "mover.mjs"))} ${JSON.stringify(repo)}`;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-int1-"));
  scripts = join(root, "scripts");
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, "barrier.mjs"), BARRIER_MJS);
  writeFileSync(join(scripts, "mover.mjs"), MOVER_MJS);
});

afterAll(() => {
  if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
});

describe("AC-INT-1 (1) two concurrent integrations keep their own commits", () => {
  it("AC-INT-1 both land as their own merge commits; the loser prints a lost race and its retry", async () => {
    const fx = new Fixture(null);
    fx.setFloor(barrierFloor(join(root, "barrier-two"), 2));
    const a = fx.makeBranch("alpha");
    const b = fx.makeBranch("beta");
    const tipA = fx.git(["rev-parse", a]);
    const tipB = fx.git(["rev-parse", b]);
    const baseMain = fx.main();

    const [ra, rb] = await Promise.all([fx.integrate(a, "sess-a"), fx.integrate(b, "sess-b")]);

    expect([ra.exitCode, rb.exitCode], `${ra.out}\n---\n${rb.out}`).toEqual([0, 0]);
    expect(fx.isAncestorOfMain(tipA)).toBe(true);
    expect(fx.isAncestorOfMain(tipB)).toBe(true);
    // exactly two merge commits over the original main, each with its own branch's message, none concluded by the other
    const subjects = fx.mergeSubjects();
    expect(subjects).toHaveLength(2);
    expect(subjects.filter((s) => s.includes(a))).toHaveLength(1);
    expect(subjects.filter((s) => s.includes(b))).toHaveLength(1);
    expect(fx.git(["rev-list", "--count", `${baseMain}..main`])).toBe("4"); // 2 branch commits + 2 merges
    // one of them lost the first CAS: it printed the lost race and then its retry
    const loser = [ra, rb].filter((r) => /lost race/.test(r.out));
    expect(loser).toHaveLength(1);
    expect(loser[0]?.out).toMatch(/attempt 2\/3/);
    // nothing left behind: no loss entry once both landed, each worktree detached at a commit reachable from main
    expect(fx.lossFiles()).toEqual([]);
    for (const dir of readdirSync(join(fx.repo, ".claude", "worktrees"))) {
      const head = fx.git(["rev-parse", "HEAD"], join(fx.repo, ".claude", "worktrees", dir));
      expect(fx.isAncestorOfMain(head)).toBe(true);
      expect(fx.git(["status", "--porcelain"], join(fx.repo, ".claude", "worktrees", dir))).toBe("");
    }
  }, 120_000);
});

describe("AC-INT-1 (2) four concurrent integrators", () => {
  it("AC-INT-1 each lands or exits exactly 75 naming what moved main; main holds exactly the landed merges; losses are recorded", async () => {
    const fx = new Fixture(null);
    fx.setFloor(barrierFloor(join(root, "barrier-four"), 4));
    const branches = ["w", "x", "y", "z"].map((label) => fx.makeBranch(label));
    const tips = branches.map((name) => fx.git(["rev-parse", name]));
    const baseMain = fx.main();

    const results = await Promise.all(branches.map((name, i) => fx.integrate(name, `sess-${i}`)));

    const codes = results.map((r) => r.exitCode);
    for (const [i, r] of results.entries()) expect([0, 75], `${branches[i]}: ${r.out}`).toContain(r.exitCode);
    const landed = branches.filter((_, i) => codes[i] === 0);
    const starved = branches.filter((_, i) => codes[i] === 75);
    expect(landed.length).toBeGreaterThanOrEqual(1);

    // main contains exactly the landed merges (own message each), never a starved branch
    const subjects = fx.mergeSubjects();
    expect(subjects).toHaveLength(landed.length);
    for (const name of landed) expect(subjects.filter((s) => s.includes(name))).toHaveLength(1);
    for (const [i, name] of branches.entries()) expect(fx.isAncestorOfMain(tips[i] ?? ""), name).toBe(codes[i] === 0);
    expect(fx.git(["rev-list", "--count", "--first-parent", `${baseMain}..main`])).toBe(String(landed.length));

    // a starved integrator names the integrations that moved main (their real commits) and recorded its loss count
    const mergesOnMain = new Set(fx.git(["rev-list", "--first-parent", `${baseMain}..main`]).split("\n"));
    let totalLosses = 0;
    for (const [i, name] of branches.entries()) {
      const r = results[i];
      if (r === undefined) continue;
      const printed = [...r.out.matchAll(/lost race \d\/3/g)].length;
      totalLosses += printed;
      if (codes[i] !== 75) continue;
      expect(r.out).toMatch(/lost 3 races; main moved by /);
      const named = [...r.out.matchAll(/main moved by ([0-9a-f]{12})/g)].map((m) => m[1] ?? "");
      expect(named.length).toBeGreaterThanOrEqual(1);
      for (const sha of named) expect([...mergesOnMain].some((full) => full.startsWith(sha)), `${name} named ${sha}`).toBe(true);
      const recorded = JSON.parse(readFileSync(join(fx.repo, ".lore", "integrate-losses", fx.lossFiles().find((f) => f.includes(name)) ?? "missing.json"), "utf8")) as { losses: number };
      expect(recorded.losses).toBe(3);
    }
    expect(fx.lossFiles().length).toBe(starved.length);
    // the observed K=4 loss rate (the ADR asks the implementation AC to measure it, not only K=2)
    console.info(`AC-INT-1 K=4 observed: landed ${landed.length}, exit-75 ${starved.length}, lost CAS attempts ${totalLosses}`);
  }, 180_000);
});

describe("AC-INT-1 (3) a crash after the CAS", () => {
  it("AC-INT-1 re-running integrate is a no-op: exit 0, main unchanged, the stale loss entry is cleared", async () => {
    const fx = new Fixture("true");
    const branch = fx.makeBranch("crashy");
    // what a process killed right after its CAS leaves behind: main already holds the merge, the loss entry was not cleared
    const wt = join(root, "crash-wt");
    fx.git(["worktree", "add", "-q", "--detach", wt, "main"]);
    fx.git(["merge", "-q", "--no-ff", "-m", `merge(${branch}): done before the crash`, branch], wt);
    // what the killed run's CAS did, marker included
    expect(fx.gitRaw(["update-ref", "refs/heads/main", fx.git(["rev-parse", "HEAD"], wt), fx.main()], fx.repo, { LORE_INTEGRATE: "1" }).status).toBe(0);
    mkdirSync(join(fx.repo, ".lore", "integrate-losses"), { recursive: true });
    writeFileSync(
      join(fx.repo, ".lore", "integrate-losses", `${encodeURIComponent(branch)}.json`),
      JSON.stringify({ schema_version: 1, branch, tip: fx.git(["rev-parse", branch]), losses: 2, moved_by: ["aaaaaaaaaaaa x"], updated_at: "2026-10-18T00:00:00.000Z" }),
    );
    const before = fx.main();

    const r = await fx.integrate(branch, "sess-crash");

    expect(r.exitCode, r.out).toBe(0);
    expect(fx.main()).toBe(before);
    expect(r.out).toMatch(/already integrated/);
    expect(fx.lossFiles()).toEqual([]);
    // and a second normal re-run after a normal landing is the same no-op
    const other = fx.makeBranch("normal");
    const landed = await fx.integrate(other, "sess-crash");
    expect(landed.exitCode, landed.out).toBe(0);
    const afterLand = fx.main();
    const again = await fx.integrate(other, "sess-crash");
    expect(again.exitCode, again.out).toBe(0);
    expect(fx.main()).toBe(afterLand);
  }, 120_000);
});

describe("AC-INT-1 (4) a failing post-merge floor", () => {
  it("AC-INT-1 exit 1, main unchanged, the integration worktree reset to main, the branch not landed", async () => {
    const fx = new Fixture("echo floor-broke-here; exit 3");
    const branch = fx.makeBranch("badfloor");
    const before = fx.main();

    const r = await fx.integrate(branch, "sess-floor");

    expect(r.exitCode, r.out).toBe(1);
    expect(r.out).toContain("floor-broke-here");
    expect(fx.main()).toBe(before);
    expect(fx.isAncestorOfMain(fx.git(["rev-parse", branch]))).toBe(false);
    const wt = join(fx.repo, ".claude", "worktrees", readdirSync(join(fx.repo, ".claude", "worktrees"))[0] ?? "");
    expect(fx.git(["rev-parse", "HEAD"], wt)).toBe(before);
    expect(fx.git(["status", "--porcelain"], wt)).toBe("");
    expect(fx.lossFiles()).toEqual([]); // a floor failure is not a lost race
  }, 120_000);

  it("AC-INT-1 a missing floor config key fails loud and moves nothing", async () => {
    const fx = new Fixture(null);
    const branch = fx.makeBranch("nofloor");
    const before = fx.main();

    const r = await fx.integrate(branch, "sess-nofloor");

    expect(r.exitCode, r.out).not.toBe(0);
    expect(r.exitCode).not.toBe(75);
    expect(r.out).toContain("workflow.integrate.floor_command");
    expect(fx.main()).toBe(before);
  }, 120_000);

  it("AC-INT-1 an unknown branch and a missing session id are refused before anything moves", async () => {
    const fx = new Fixture("true");
    const before = fx.main();
    const unknown = await fx.integrate("no-such-branch", "sess-x");
    expect(unknown.exitCode, unknown.out).not.toBe(0);
    expect(unknown.out).toContain("no-such-branch");
    const noSession = await fx.lore(["integrate", fx.makeBranch("orphan")], undefined);
    expect(noSession.exitCode, noSession.out).not.toBe(0);
    expect(noSession.out).toMatch(/session/);
    expect(fx.main()).toBe(before);
  }, 120_000);

  it("AC-INT-1 a conflicting merge leaves nothing half-done (the exit-4 contract itself is AC-INT-2)", async () => {
    const fx = new Fixture("true");
    const one = fx.makeBranch("c");
    // a second branch that edits the same file as the first
    fx.git(["checkout", "-q", "-b", "clash", "main"]);
    writeFileSync(join(fx.repo, `${one}.txt`), "different\n");
    fx.git(["add", `${one}.txt`]);
    fx.git(["commit", "-q", "-m", "clash"]);
    fx.git(["checkout", "-q", "--detach", "main"]);
    expect((await fx.integrate(one, "sess-c")).exitCode).toBe(0);
    const before = fx.main();

    const r = await fx.integrate("clash", "sess-c");

    expect(r.exitCode, r.out).toBe(4);
    expect(r.out).toContain(`${one}.txt`);
    expect(fx.main()).toBe(before);
    const wt = join(fx.repo, ".claude", "worktrees", readdirSync(join(fx.repo, ".claude", "worktrees"))[0] ?? "");
    expect(fx.git(["status", "--porcelain"], wt)).toBe("");
    expect(fx.git(["rev-parse", "HEAD"], wt)).toBe(before);
    expect(existsSync(join(fx.repo, ".git", "worktrees"))).toBe(true);
    expect(fx.gitStatus(["rev-parse", "-q", "--verify", "MERGE_HEAD"], wt)).not.toBe(0);
  }, 120_000);
});

describe("AC-INT-1 (5) loss counts in lore status", () => {
  it("AC-INT-1 exit 75 lists the branch with its consecutive loss count (text and --json) from a session worktree; landing removes it", async () => {
    const fx = new Fixture(null);
    fx.setFloor(moverFloor(fx.repo));
    const branch = fx.makeBranch("starved");
    // the caller is a linked session worktree: the corpus resolves through the git common dir (foreign-write guard territory)
    const sessionWt = join(root, `session-wt-${repoSeq}`);
    fx.git(["worktree", "add", "-q", "--detach", sessionWt, "main"]);

    const first = await fx.integrate(branch, "sess-star", [], sessionWt);
    expect(first.exitCode, first.out).toBe(75);
    expect(first.out).toMatch(/lost 3 races; main moved by /);
    expect([...first.out.matchAll(/main moved by ([0-9a-f]{12}) peer integration/g)].length).toBeGreaterThanOrEqual(3);
    expect(fx.isAncestorOfMain(fx.git(["rev-parse", branch]))).toBe(false);

    const text = await fx.lore(["status"], "sess-star", sessionWt);
    expect(text.exitCode, text.out).toBe(0);
    expect(text.stdout).toContain(branch);
    expect(text.stdout).toMatch(new RegExp(`${branch}.*3 consecutive lost race`));

    const json = await fx.lore(["status", "--json"], "sess-star", sessionWt);
    expect(json.exitCode, json.out).toBe(0);
    const data = (JSON.parse(json.stdout) as { data: { integrate_losses: { branch: string; losses: number }[] } }).data;
    expect(data.integrate_losses.map((e) => [e.branch, e.losses])).toEqual([[branch, 3]]);

    // consecutive: a second failed call adds to the same entry
    const second = await fx.integrate(branch, "sess-star", [], sessionWt);
    expect(second.exitCode, second.out).toBe(75);
    const json2 = await fx.lore(["status", "--json"], "sess-star", sessionWt);
    const data2 = (JSON.parse(json2.stdout) as { data: { integrate_losses: { branch: string; losses: number }[] } }).data;
    expect(data2.integrate_losses.map((e) => [e.branch, e.losses])).toEqual([[branch, 6]]);

    // the race ends (a trivial floor): the branch lands and the entry disappears from both renderings
    fx.setFloor("true");
    const landed = await fx.integrate(branch, "sess-star", [], sessionWt);
    expect(landed.exitCode, landed.out).toBe(0);
    expect(fx.isAncestorOfMain(fx.git(["rev-parse", branch]))).toBe(true);
    const textAfter = await fx.lore(["status"], "sess-star", sessionWt);
    expect(textAfter.stdout).not.toContain("lost race");
    const jsonAfter = await fx.lore(["status", "--json"], "sess-star", sessionWt);
    expect((JSON.parse(jsonAfter.stdout) as { data: { integrate_losses: unknown[] } }).data.integrate_losses).toEqual([]);
    expect(fx.lossFiles()).toEqual([]);
  }, 240_000);
});

describe("AC-INT-2 (1) a conflicting branch", () => {
  it("AC-INT-2 exits exactly 4 naming the paths with main, the branch and every worktree unchanged; after merging main into the branch it lands", async () => {
    const fx = new Fixture("true");
    const first = fx.makeBranch("c");
    fx.git(["checkout", "-q", "-b", "clash", "main"]);
    writeFileSync(join(fx.repo, `${first}.txt`), "clash side\n");
    fx.git(["add", `${first}.txt`]);
    fx.git(["commit", "-q", "-m", "clash"]);
    fx.git(["checkout", "-q", "--detach", "main"]);
    expect((await fx.integrate(first, "sess-conf")).exitCode).toBe(0);
    const sessionWt = join(root, `clash-wt-${repoSeq}`);
    fx.git(["worktree", "add", "-q", sessionWt, "clash"]);
    writeFileSync(join(sessionWt, "scratch.txt"), "uncommitted work in the branch worktree\n");
    const clashTip = fx.git(["rev-parse", "clash"]);
    const before = fx.snapshot();

    const refused = await fx.integrate("clash", "sess-conf");

    expect(refused.exitCode, refused.out).toBe(4);
    expect(refused.out).toContain(`${first}.txt`);
    expect(fx.snapshot()).toEqual(before); // main, every worktree's HEAD, status and file bytes
    expect(fx.git(["rev-parse", "clash"])).toBe(clashTip);

    // the session resolves in its own worktree: merge main into the branch, resolve, commit
    expect(fx.gitStatus(["merge", "-q", "main"], sessionWt)).not.toBe(0);
    writeFileSync(join(sessionWt, `${first}.txt`), "resolved\n");
    fx.git(["add", `${first}.txt`], sessionWt);
    fx.git(["commit", "-q", "--no-edit"], sessionWt);

    const landed = await fx.integrate("clash", "sess-conf");

    expect(landed.exitCode, landed.out).toBe(0);
    expect(fx.isAncestorOfMain(fx.git(["rev-parse", "clash"]))).toBe(true);
    expect(fx.git(["show", `main:${first}.txt`])).toBe("resolved");
  }, 180_000);
});

describe("AC-INT-2 (2) the main-ref hook installed by lore setup", () => {
  it("AC-INT-2 ships the hook byte-identical, refuses update-ref and a commit on main outside integrate, and lets integrate and other refs through", async () => {
    const fx = new Fixture("true");
    const setup = fx.setupProject();
    expect(setup.exitCode, setup.out).toBe(0);
    const installed = join(fx.repo, "hooks", "reference-transaction");
    expect(readFileSync(installed)).toEqual(readFileSync(HOOK_ASSET));
    expect(statSync(installed).mode & 0o111).not.toBe(0);
    expect(fx.git(["config", "core.hooksPath"])).toBe(join(realpathSync(fx.repo), "hooks"));

    const branch = fx.makeBranch("hooked");
    const before = fx.main();
    const tree = fx.git(["rev-parse", `${before}^{tree}`]);
    const stray = fx.git(["commit-tree", tree, "-p", before, "-m", "stray"]);

    // a plain update-ref of main is refused
    const forced = fx.gitRaw(["update-ref", "refs/heads/main", stray, before]);
    expect(forced.status).not.toBe(0);
    expect(forced.out).toContain("ref updates aborted by hook");
    expect(fx.main()).toBe(before);

    // a commit on branch main made outside integrate is refused (checking main out takes the marker bypass: the guard
    // refuses that checkout itself, see main-checkout-guard.test.ts)
    expect(fx.gitRaw(["checkout", "-q", "main"]).status).toBe(128);
    expect(fx.gitRaw(["checkout", "-q", "main"], fx.repo, { LORE_INTEGRATE: "1" }).status).toBe(0);
    writeFileSync(join(fx.repo, "stray.txt"), "stray\n");
    fx.git(["add", "stray.txt"]);
    const commit = fx.gitRaw(["commit", "-q", "-m", "stray commit on main"]);
    expect(commit.status).not.toBe(0);
    expect(commit.out).toContain("ref updates aborted by hook");
    expect(fx.main()).toBe(before);
    // a no-op update of main (old == new) and other refs are not the hook's business
    expect(fx.gitRaw(["update-ref", "refs/heads/main", before, before]).status).toBe(0);
    fx.git(["checkout", "-q", "-b", "elsewhere"]);
    fx.git(["commit", "-q", "-m", "commit on another branch"]);
    fx.git(["checkout", "-q", "--detach", "main"]);

    // integrate moves main: its CAS carries the marker
    const landed = await fx.integrate(branch, "sess-hook");
    expect(landed.exitCode, landed.out).toBe(0);
    expect(fx.main()).not.toBe(before);
    expect(fx.isAncestorOfMain(fx.git(["rev-parse", branch]))).toBe(true);
  }, 180_000);

  it("AC-INT-2 git older than 2.46 makes lore setup refuse loudly naming the version, installing nothing", () => {
    const fx = new Fixture("true");
    const shim = join(root, `old-git-${repoSeq}`);
    mkdirSync(shim, { recursive: true });
    const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(shim, "git"), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version 2.20.1"; exit 0; fi\nexec ${JSON.stringify(realGit)} "$@"\n`);
    chmodSync(join(shim, "git"), 0o755);
    const hooksPathBefore = fx.gitRaw(["config", "--local", "core.hooksPath"]).out;

    const setup = fx.setupProject({ PATH: `${shim}:${process.env.PATH ?? ""}` });

    expect(setup.exitCode, setup.out).not.toBe(0);
    expect(setup.out).toContain("2.20.1");
    expect(setup.out).toContain("2.46");
    expect(existsSync(join(fx.repo, "hooks", "reference-transaction"))).toBe(false);
    expect(fx.gitRaw(["config", "--local", "core.hooksPath"]).out).toBe(hooksPathBefore);
  }, 120_000);
});

describe("INT-T8 the main-ref hook runs in a consumer's linked worktree when hooks/ is untracked", () => {
  it("INT-T8 a commit on main from a linked worktree is refused; integrate's CAS still passes there", async () => {
    const fx = new Fixture("true");
    const setup = fx.setupProject();
    expect(setup.exitCode, setup.out).toBe(0);
    // the consumer never committed hooks/: the linked worktree has no hooks/ of its own
    expect(fx.git(["ls-files", "hooks"])).toBe("");
    const branch = fx.makeBranch("t8");
    const before = fx.main();

    const wtMain = join(root, `wt-main-${repoSeq}`);
    // the guard refuses `worktree add <p> main`; the marker bypass builds the hazard this test needs
    expect(fx.gitRaw(["worktree", "add", "-q", join(root, `wt-refused-${repoSeq}`), "main"]).status).toBe(128);
    expect(fx.gitRaw(["worktree", "add", "-q", wtMain, "main"], fx.repo, { LORE_INTEGRATE: "1" }).status).toBe(0);
    expect(existsSync(join(wtMain, "hooks"))).toBe(false);
    writeFileSync(join(wtMain, "stray.txt"), "stray\n");
    fx.git(["add", "stray.txt"], wtMain);
    const commit = fx.gitRaw(["commit", "-q", "-m", "stray commit on main from a linked worktree"], wtMain);
    expect(commit.status, commit.out).not.toBe(0);
    expect(commit.out).toContain("ref updates aborted by hook");
    expect(fx.main()).toBe(before);
    fx.git(["worktree", "remove", "--force", wtMain]);

    // control: integrate's CAS carries the marker and lands from another linked worktree
    const wtIntegrate = join(root, `wt-int-${repoSeq}`);
    fx.git(["worktree", "add", "-q", "--detach", wtIntegrate, "main"]);
    const landed = await fx.integrate(branch, "sess-t8", [], wtIntegrate);
    expect(landed.exitCode, landed.out).toBe(0);
    expect(fx.main()).not.toBe(before);
    expect(fx.isAncestorOfMain(fx.git(["rev-parse", branch]))).toBe(true);
  }, 180_000);
});

describe("AC-INT-2 (3) integrate origin/main", () => {
  function remoteFor(fx: Fixture): { bare: string; peer: string } {
    const bare = join(root, `remote-${repoSeq}.git`);
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
    fx.git(["remote", "add", "origin", bare]);
    fx.git(["push", "-q", "origin", "main"]);
    fx.git(["fetch", "-q", "origin"]);
    const peer = join(root, `peer-${repoSeq}`);
    fx.git(["clone", "-q", bare, peer], root);
    fx.git(["config", "user.email", "p@example.com"], peer);
    fx.git(["config", "user.name", "peer"], peer);
    fx.git(["config", "commit.gpgsign", "false"], peer);
    return { bare, peer };
  }

  it("AC-INT-2 fetches from the bare remote and fast-forwards main by the CAS", async () => {
    const fx = new Fixture("true");
    const { peer } = remoteFor(fx);
    writeFileSync(join(peer, "upstream.txt"), "from the remote\n");
    fx.git(["add", "upstream.txt"], peer);
    fx.git(["commit", "-q", "-m", "upstream work"], peer);
    fx.git(["push", "-q", "origin", "main"], peer);
    const remoteTip = fx.git(["rev-parse", "HEAD"], peer);
    const before = fx.main();
    expect(fx.git(["rev-parse", "origin/main"])).toBe(before); // the tracking ref is stale until integrate fetches

    const r = await fx.integrate("origin/main", "sess-up");

    expect(r.exitCode, r.out).toBe(0);
    expect(fx.main()).toBe(remoteTip); // a fast-forward: no merge commit of its own
    expect(fx.git(["show", "main:upstream.txt"])).toBe("from the remote");
    expect(fx.git(["rev-parse", "origin/main"])).toBe(remoteTip);
    const again = await fx.integrate("origin/main", "sess-up");
    expect(again.exitCode, again.out).toBe(0);
    expect(fx.main()).toBe(remoteTip);
  }, 120_000);

  it("AC-INT-2 a diverged origin/main merges onto main, runs the floor, and advances main by the CAS", async () => {
    const floorLog = join(root, `floor-log-${repoSeq + 1}`);
    const fx = new Fixture(`echo ran >> ${JSON.stringify(floorLog)}`);
    const { peer } = remoteFor(fx);
    const local = fx.makeBranch("local");
    expect((await fx.integrate(local, "sess-up2")).exitCode).toBe(0);
    const floorRunsBefore = readFileSync(floorLog, "utf8").split("\n").filter((l) => l !== "").length;
    writeFileSync(join(peer, "remote-only.txt"), "remote\n");
    fx.git(["add", "remote-only.txt"], peer);
    fx.git(["commit", "-q", "-m", "remote only"], peer);
    fx.git(["push", "-q", "origin", "main"], peer);
    const remoteTip = fx.git(["rev-parse", "HEAD"], peer);
    const localMain = fx.main();

    const r = await fx.integrate("origin/main", "sess-up2");

    expect(r.exitCode, r.out).toBe(0);
    expect(fx.git(["rev-parse", "main^1"])).toBe(localMain);
    expect(fx.git(["rev-parse", "main^2"])).toBe(remoteTip);
    expect(readFileSync(floorLog, "utf8").split("\n").filter((l) => l !== "")).toHaveLength(floorRunsBefore + 1);
  }, 120_000);
});

describe("INT-T6 the shared checkout's view of main follows an integrate", () => {
  it("INT-T6 landing a branch moves the detached shared checkout to the new main and reports refreshed (text and --json)", async () => {
    const fx = new Fixture("true");
    const first = fx.makeBranch("refresh");
    const second = fx.makeBranch("refresh");
    const headBefore = fx.git(["rev-parse", "HEAD"]);
    expect(headBefore).toBe(fx.main());

    const r = await fx.integrate(first, "sess-t6a");

    expect(r.exitCode, r.out).toBe(0);
    expect(fx.main()).not.toBe(headBefore);
    expect(fx.gitStatus(["symbolic-ref", "-q", "HEAD"])).not.toBe(0); // still detached
    expect(fx.git(["rev-parse", "HEAD"])).toBe(fx.main());
    expect(existsSync(join(fx.repo, `${first}.txt`))).toBe(true);
    expect(r.stdout).toMatch(/shared checkout refreshed to main/);

    const j = await fx.integrate(second, "sess-t6a", ["--json"]);
    expect(j.exitCode, j.out).toBe(0);
    const data = (JSON.parse(j.stdout.slice(j.stdout.indexOf("{"))) as { data: { shared_view: { state: string } } }).data;
    expect(data.shared_view).toEqual({ state: "refreshed" });
    expect(fx.git(["rev-parse", "HEAD"])).toBe(fx.main());
  }, 120_000);

  it("INT-T6 an already-integrated no-op also refreshes a view that fell behind main", async () => {
    const fx = new Fixture("true");
    const branch = fx.makeBranch("noop");
    expect((await fx.integrate(branch, "sess-t6b")).exitCode).toBe(0);
    fx.git(["checkout", "-q", "--detach", "main~1"]); // the view fell behind main
    expect(fx.git(["rev-parse", "HEAD"])).not.toBe(fx.main());

    const r = await fx.integrate(branch, "sess-t6b");

    expect(r.exitCode, r.out).toBe(0);
    expect(r.out).toMatch(/already integrated/);
    expect(fx.git(["rev-parse", "HEAD"])).toBe(fx.main());
  }, 120_000);

  it("INT-T6 control: an uncommitted edit the new main would overwrite is kept byte-identical and reported kept-dirty", async () => {
    const fx = new Fixture("true");
    fx.git(["checkout", "-q", "-b", "touch-base", "main"]);
    writeFileSync(join(fx.repo, "base.txt"), "base\nchanged on the branch\n");
    fx.git(["commit", "-q", "-am", "branch edits base.txt"]);
    fx.git(["checkout", "-q", "--detach", "main"]);
    writeFileSync(join(fx.repo, "base.txt"), "base\nhuman edit in the view\n");
    const editBefore = readFileSync(join(fx.repo, "base.txt"));
    const headBefore = fx.git(["rev-parse", "HEAD"]);

    const r = await fx.integrate("touch-base", "sess-t6c", ["--json"]);

    expect(r.exitCode, r.out).toBe(0);
    expect(fx.isAncestorOfMain(fx.git(["rev-parse", "touch-base"]))).toBe(true);
    expect(readFileSync(join(fx.repo, "base.txt"))).toEqual(editBefore);
    expect(fx.git(["rev-parse", "HEAD"])).toBe(headBefore); // not moved
    const data = (JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as { data: { shared_view: { state: string; paths?: string[] } } }).data;
    expect(data.shared_view).toEqual({ state: "kept_dirty", paths: ["base.txt"] });
    expect(fx.git(["status", "--porcelain=v1", "--untracked-files=no"])).toBe("M base.txt");
  }, 120_000);

  it("INT-T6 a shared checkout on a branch is reported not-measured and left untouched", async () => {
    const fx = new Fixture("true", { detached: false });
    const wt = join(root, `t6-feat-${repoSeq}`);
    fx.git(["worktree", "add", "-q", "-b", "t6feat", wt, "main"]);
    writeFileSync(join(wt, "t6.txt"), "x\n");
    fx.git(["add", "t6.txt"], wt);
    fx.git(["commit", "-q", "-m", "t6 work"], wt);
    fx.git(["checkout", "-q", "-b", "elsewhere"]); // not main: integrate has nothing to detach, refresh has nothing to follow

    const r = await fx.integrate("t6feat", "sess-t6d");

    expect(r.exitCode, r.out).toBe(0);
    expect(r.stdout).toMatch(/shared checkout not-measured: .*refs\/heads\/elsewhere/);
    expect(fx.git(["symbolic-ref", "-q", "HEAD"])).toBe("refs/heads/elsewhere");
  }, 120_000);
});

const TEST_FILE_SCRIPT = `
import { readFileSync } from "node:fs";
// stands in for a test run: it holds the checkout open, then asserts the tracked file still has its committed bytes
await new Promise((r) => setTimeout(r, 1500));
const seen = readFileSync("tracked.txt", "utf8");
if (seen !== "committed\\n") { console.error("saw foreign edit: " + JSON.stringify(seen)); process.exit(1); }
console.log("test:file saw committed bytes");
`;

/** Every regular file under `dir` (follows no symlinks), as absolute paths. */
function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFilesRecursive(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

describe("AC-INT-3 (1) a test run in a session worktree never sees an edit in the shared checkout", () => {
  it("AC-INT-3 bun run test:file in session A's worktree exits 0 while process B edits a tracked file in the shared checkout", async () => {
    const fx = new Fixture("true", { detached: false, guard: false }); // commits on main from the shared checkout
    writeFileSync(join(fx.repo, "tracked.txt"), "committed\n");
    writeFileSync(join(fx.repo, "check.mjs"), TEST_FILE_SCRIPT);
    writeFileSync(join(fx.repo, "package.json"), JSON.stringify({ name: "fixture", private: true, scripts: { "test:file": "node check.mjs" } }));
    fx.git(["add", "tracked.txt", "check.mjs", "package.json"]);
    fx.git(["commit", "-q", "-m", "tracked fixture"]);
    const worktreeA = join(root, `session-a-${repoSeq}`);
    fx.git(["worktree", "add", "-q", "-b", "session-a", worktreeA, "main"]);

    const run = new Promise<RunResult>((resolve) => {
      const child = spawn("bun", ["run", "test:file"], { cwd: worktreeA, env: fx.env("sess-a") });
      let out = "";
      child.stdout.on("data", (c: Buffer) => (out += c.toString()));
      child.stderr.on("data", (c: Buffer) => (out += c.toString()));
      child.on("close", (code) => resolve({ stdout: out, stderr: "", out, exitCode: code ?? 1 }));
    });
    // process B: edits the tracked file in the shared checkout while A's run is in flight
    await new Promise((r) => setTimeout(r, 400));
    writeFileSync(join(fx.repo, "tracked.txt"), "process B was here\n");
    const result = await run;

    expect(readFileSync(join(fx.repo, "tracked.txt"), "utf8")).toBe("process B was here\n"); // B really edited
    expect(result.exitCode, result.out).toBe(0);
    expect(result.out).toContain("test:file saw committed bytes");
  }, 120_000);
});

describe("AC-INT-3 (2) lore setup installs a workflow that lands branches only through lore integrate", () => {
  it("AC-INT-3 fresh install into a throwaway HOME: dispatch rule, autopilot skill and project rule name lore integrate; zero merge --no-ff instructions", () => {
    const home = mkdtempSync(join(tmpdir(), "lore-int3-home-"));
    try {
      const fx = new Fixture("true");
      const env = { ...fx.env(undefined, { HOME: home }), PATH: process.env.PATH ?? "" };
      for (const args of [["setup", "--yes"], ["setup", "--project", "--yes"]]) {
        const r = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd: fx.repo, env, encoding: "utf8" });
        expect(r.status, `${args.join(" ")}: ${r.stdout}${r.stderr}`).toBe(0);
      }
      const installed = [...listFilesRecursive(join(home, ".claude")), ...listFilesRecursive(join(fx.repo, ".claude"))];
      const byName = (needle: string): string[] => installed.filter((f) => f.includes(needle));
      const dispatchRule = byName("lore-worktree-dispatch.md");
      const autopilot = byName(join("skills", "lore-autopilot", "SKILL.md"));
      expect(dispatchRule.length, installed.join("\n")).toBeGreaterThan(0);
      expect(autopilot.length, installed.join("\n")).toBeGreaterThan(0);
      for (const file of [...dispatchRule, ...autopilot]) {
        const text = readFileSync(file, "utf8");
        expect(text, file).toContain("lore integrate");
        expect(text, file).toMatch(/never[^\n]*git merge/i);
      }
      const forbidden = installed.filter((f) => /merge\s+<branch>\s+--no-ff/.test(readFileSync(f, "utf8")));
      expect(forbidden, "files still instructing the merge-no-ff form").toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 180_000);
});

const FAKE_BUILD = "mkdir -p dist && git rev-parse HEAD > dist/marker";
type RebuildJson = { data: { shared_view: { state: string }; rebuild: { state: string; exit_status?: number; reason?: string; tracked_changes?: string[] } } };

describe("INT-T11 the shared checkout's build artifacts follow the refreshed view", () => {
  it("INT-T11 after landing, post_refresh_command runs in the view: its marker equals the new main (text and --json)", async () => {
    const fx = new Fixture("true");
    appendFileSync(join(fx.repo, ".git", "info", "exclude"), "dist/\n");
    fx.setFloor("true", FAKE_BUILD);
    const first = fx.makeBranch("rebuild");
    const second = fx.makeBranch("rebuild");

    const r = await fx.integrate(first, "sess-t11a");

    expect(r.exitCode, r.out).toBe(0);
    expect(readFileSync(join(fx.repo, "dist", "marker"), "utf8").trim()).toBe(fx.main());
    expect(r.stdout).toMatch(/shared checkout rebuild: rebuilt/);
    expect(fx.git(["status", "--porcelain=v1", "--untracked-files=no"])).toBe("");

    const j = await fx.integrate(second, "sess-t11a", ["--json"]);
    expect(j.exitCode, j.out).toBe(0);
    const data = (JSON.parse(j.stdout.slice(j.stdout.indexOf("{"))) as RebuildJson).data;
    expect(data.rebuild).toEqual({ state: "rebuilt" });
    expect(readFileSync(join(fx.repo, "dist", "marker"), "utf8").trim()).toBe(fx.main());
  }, 120_000);

  it("INT-T11 a kept-dirty view is not rebuilt: skipped and reported, no marker written", async () => {
    const fx = new Fixture("true");
    fx.setFloor("true", FAKE_BUILD);
    fx.git(["checkout", "-q", "-b", "touch-base", "main"]);
    writeFileSync(join(fx.repo, "base.txt"), "base\nchanged on the branch\n");
    fx.git(["commit", "-q", "-am", "branch edits base.txt"]);
    fx.git(["checkout", "-q", "--detach", "main"]);
    writeFileSync(join(fx.repo, "base.txt"), "base\nhuman edit in the view\n");

    const r = await fx.integrate("touch-base", "sess-t11b", ["--json"]);

    expect(r.exitCode, r.out).toBe(0);
    const data = (JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as RebuildJson).data;
    expect(data.shared_view.state).toBe("kept_dirty");
    expect(data.rebuild.state).toBe("skipped");
    expect(data.rebuild.reason).toMatch(/kept_dirty/);
    expect(existsSync(join(fx.repo, "dist", "marker"))).toBe(false);
  }, 120_000);

  it("INT-T11 control: no post_refresh_command is reported as skipped, never silent", async () => {
    const fx = new Fixture("true");
    const branch = fx.makeBranch("norebuild");

    const r = await fx.integrate(branch, "sess-t11c");

    expect(r.exitCode, r.out).toBe(0);
    expect(r.stdout).toMatch(/shared checkout rebuild: skipped \(workflow\.integrate\.post_refresh_command is not set\)/);
    expect(existsSync(join(fx.repo, "dist", "marker"))).toBe(false);
  }, 120_000);

  it("INT-T11 a failing rebuild is reported rebuild-failed <exit> and never un-lands main", async () => {
    const fx = new Fixture("true");
    fx.setFloor("true", "exit 7");
    const branch = fx.makeBranch("badbuild");

    const r = await fx.integrate(branch, "sess-t11d", ["--json"]);

    expect(r.exitCode, r.out).toBe(0);
    expect(fx.isAncestorOfMain(fx.git(["rev-parse", branch]))).toBe(true);
    const data = (JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as RebuildJson).data;
    expect(data.rebuild).toMatchObject({ state: "rebuild_failed", exit_status: 7 });
    const text = await fx.integrate(branch, "sess-t11d");
    expect(text.stdout).toMatch(/shared checkout rebuild: rebuild-failed 7/);
  }, 120_000);

  it("INT-T11 a build that leaves a tracked change in the view is reported with the paths", async () => {
    const fx = new Fixture("true");
    fx.setFloor("true", "echo dirty >> base.txt");
    const branch = fx.makeBranch("dirtybuild");

    const r = await fx.integrate(branch, "sess-t11e", ["--json"]);

    expect(r.exitCode, r.out).toBe(0);
    const data = (JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as RebuildJson).data;
    expect(data.rebuild).toEqual({ state: "rebuilt", tracked_changes: ["base.txt"] });
  }, 120_000);
});
