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
 *       outside integrate, and setup refuses git < 2.28 naming the version;
 *   (3) `lore integrate origin/main` fetches from a bare remote and advances main by the same CAS;
 *   (4) the shared checkout on a dirty main is detached at the same commit with every edit byte-identical; a checkout
 *       that cannot be detached, or any other worktree holding main, exits 4 naming it before anything moves.
 *
 * @spec_ref AC-INT-1, AC-INT-2
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const git = (...a) => { const r = spawnSync("git", a, { cwd: repo, encoding: "utf8" }); if (r.status !== 0) { console.error(r.stderr); process.exit(8); } return r.stdout.trim(); };
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

  constructor(floorCommand: string | null, opts: { readonly detached?: boolean } = {}) {
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

  setFloor(floorCommand: string | null): void {
    const base = readFileSync(join(this.repo, ".lore", "config.yaml"), "utf8").split("\nworkflow:")[0] ?? "";
    const block = floorCommand === null ? "" : `\nworkflow:\n  integrate:\n    floor_command: ${JSON.stringify(floorCommand)}\n`;
    writeFileSync(join(this.repo, ".lore", "config.yaml"), `${base.trimEnd()}\n${block}`);
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
    fx.git(["update-ref", "refs/heads/main", fx.git(["rev-parse", "HEAD"], wt), fx.main()]);
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
    expect(fx.git(["config", "core.hooksPath"])).toBe("hooks");

    const branch = fx.makeBranch("hooked");
    const before = fx.main();
    const tree = fx.git(["rev-parse", `${before}^{tree}`]);
    const stray = fx.git(["commit-tree", tree, "-p", before, "-m", "stray"]);

    // a plain update-ref of main is refused
    const forced = fx.gitRaw(["update-ref", "refs/heads/main", stray, before]);
    expect(forced.status).not.toBe(0);
    expect(forced.out).toContain("ref updates aborted by hook");
    expect(fx.main()).toBe(before);

    // a commit on branch main made outside integrate is refused
    fx.git(["checkout", "-q", "main"]);
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

  it("AC-INT-2 git older than 2.28 makes lore setup refuse loudly naming the version, installing nothing", () => {
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
    expect(setup.out).toContain("2.28");
    expect(existsSync(join(fx.repo, "hooks", "reference-transaction"))).toBe(false);
    expect(fx.gitRaw(["config", "--local", "core.hooksPath"]).out).toBe(hooksPathBefore);
  }, 120_000);
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

describe("AC-INT-2 (4) the shared checkout and other worktrees on main", () => {
  /** A repo whose shared checkout is on branch main, plus a branch with one commit living in its own worktree. */
  function sharedOnMain(): { fx: Fixture; branch: string } {
    const fx = new Fixture("true", { detached: false });
    const wt = join(root, `feat-wt-${repoSeq}`);
    fx.git(["worktree", "add", "-q", "-b", "feat", wt, "main"]);
    writeFileSync(join(wt, "feat.txt"), "feature\n");
    fx.git(["add", "feat.txt"], wt);
    fx.git(["commit", "-q", "-m", "feature work"], wt);
    return { fx, branch: "feat" };
  }

  it("AC-INT-2 the first integrate detaches a dirty shared checkout at the same commit; every edit stays byte-identical", async () => {
    const { fx, branch } = sharedOnMain();
    writeFileSync(join(fx.repo, "base.txt"), "base\nedited by a human\n");
    writeFileSync(join(fx.repo, "untracked.txt"), "never committed\n");
    writeFileSync(join(fx.repo, "staged.txt"), "staged\n");
    fx.git(["add", "staged.txt"]);
    const files =["base.txt", "untracked.txt", "staged.txt"];
    const filesBefore = files.map((f) => readFileSync(join(fx.repo, f)));
    const statusBefore = fx.git(["status", "--porcelain=v1"]);
    expect(fx.git(["symbolic-ref", "-q", "HEAD"])).toBe("refs/heads/main");

    const r = await fx.integrate(branch, "sess-det");

    expect(r.exitCode, r.out).toBe(0);
    expect(fx.gitStatus(["symbolic-ref", "-q", "HEAD"])).not.toBe(0); // detached now
    expect(fx.git(["rev-parse", "HEAD"])).toBe(fx.main()); // the view follows the landed main (INT-T6); the edits survive it
    expect(files.map((f) => readFileSync(join(fx.repo, f)))).toEqual(filesBefore);
    expect(fx.git(["status", "--porcelain=v1"])).toBe(statusBefore);
    expect(fx.isAncestorOfMain(fx.git(["rev-parse", branch]))).toBe(true);
  }, 120_000);

  it("AC-INT-2 a shared checkout that cannot be detached (merge in progress) exits 4 naming it before anything moves", async () => {
    const { fx, branch } = sharedOnMain();
    fx.git(["checkout", "-q", "-b", "side", "main"]);
    writeFileSync(join(fx.repo, "base.txt"), "side\n");
    fx.git(["commit", "-q", "-am", "side edit"]);
    fx.git(["checkout", "-q", "main"]);
    writeFileSync(join(fx.repo, "base.txt"), "main\n");
    fx.git(["commit", "-q", "-am", "main edit"]);
    expect(fx.gitStatus(["merge", "-q", "side"])).not.toBe(0);
    expect(fx.gitStatus(["rev-parse", "-q", "--verify", "MERGE_HEAD"])).toBe(0);
    const before = fx.snapshot();
    const worktreesBefore = fx.worktreePaths();

    const r = await fx.integrate(branch, "sess-det2");

    expect(r.exitCode, r.out).toBe(4);
    expect(r.out).toContain(realpathSync(fx.repo));
    expect(r.out).toMatch(/merge/i);
    expect(fx.snapshot()).toEqual(before);
    expect(fx.worktreePaths()).toEqual(worktreesBefore); // no integration worktree was created
    expect(fx.gitStatus(["rev-parse", "-q", "--verify", "MERGE_HEAD"])).toBe(0);
  }, 120_000);

  it("AC-INT-2 any worktree other than the shared checkout holding main exits 4 naming it; once it leaves main the branch lands", async () => {
    const fx = new Fixture("true");
    const branch = fx.makeBranch("hazard");
    const other = join(root, `holds-main-${repoSeq}`);
    fx.git(["worktree", "add", "-q", other, "main"]);
    const before = fx.snapshot();

    const r = await fx.integrate(branch, "sess-haz");

    expect(r.exitCode, r.out).toBe(4);
    expect(r.out).toContain(realpathSync(other));
    expect(fx.snapshot()).toEqual(before);

    fx.git(["checkout", "-q", "--detach", "main"], other);
    const landed = await fx.integrate(branch, "sess-haz");
    expect(landed.exitCode, landed.out).toBe(0);
    expect(fx.isAncestorOfMain(fx.git(["rev-parse", branch]))).toBe(true);
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
    fx.git(["checkout", "-q", "--detach", "HEAD~1"]); // the view fell behind main
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
    expect(fx.git(["status", "--porcelain=v1"])).toBe("M base.txt");
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
