// @spawns packages/lore/src/index.ts
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
 * @spec_ref AC-INT-1
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

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

  constructor(floorCommand: string | null) {
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
    this.git(["checkout", "-q", "--detach", "main"]);
    if (floorCommand !== null) this.setFloor(floorCommand);
  }

  env(session?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: this.repo, EDITOR: "true", CLAUDECODE: "1" };
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
