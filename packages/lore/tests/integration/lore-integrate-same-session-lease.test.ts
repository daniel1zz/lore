// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * `lore integrate` holds an exclusive lease on its session's integration worktree for its whole run
 * (task-a-second-integrate-in-the-same-session-s-integration; adr-main-advances-only-by-lore-integrate-per-session).
 *
 * Incident: two integrates of one session overlapped; the second re-took the corpus snapshot (VACUUM INTO) while the
 * first run's floor was reading it, and both failed with "disk I/O error". Falsifier: without the lease both runs go
 * on and the first floor's snapshot is overwritten.
 *
 * Throwaway repo + corpus (mkdtemp, `git init`, `lore init`), REAL git worktrees and REAL `lore` processes. The floor
 * is a shell script that announces it started, waits for a release file, then checks its corpus snapshot is still there.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installShippedGuard } from "./support/main-guard-repo.js";
import { claimBranchTask } from "../helpers/claim-branch-task.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly out: string;
  readonly exitCode: number;
  readonly ms: number;
}

interface Running {
  readonly child: ChildProcess;
  readonly done: Promise<RunResult>;
}

let root = "";
let repoSeq = 0;

function sh(cwd: string, cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function until(what: string, check: () => boolean, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

class Fixture {
  readonly repo: string;
  readonly started: string;
  readonly release: string;
  readonly snapshotIntact: string;

  constructor() {
    repoSeq += 1;
    this.repo = join(root, `repo-${repoSeq}`);
    this.started = join(root, `started-${repoSeq}`);
    this.release = join(root, `release-${repoSeq}`);
    this.snapshotIntact = join(root, `snapshot-intact-${repoSeq}`);
    mkdirSync(this.repo, { recursive: true });
    this.git(["init", "-q", "-b", "main"]);
    this.git(["config", "user.email", "t@example.com"]);
    this.git(["config", "user.name", "t"]);
    this.git(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(this.repo, "base.txt"), "base\n");
    this.git(["add", "base.txt"]);
    this.git(["commit", "-q", "-m", "base"]);
    const init = sh(this.repo, "bun", ["run", INDEX_TS, "init"], this.env("init"));
    if (init.status !== 0) throw new Error(`lore init failed: ${init.stderr}`);
    appendFileSync(join(this.repo, ".git", "info", "exclude"), ".lore/\n.claude/\n");
    this.git(["checkout", "-q", "--detach", "main"]);
    installShippedGuard(this.repo, `${this.repo}-guard-hooks`); // integrate requires the guard (BR-1273)

    const script = join(root, `floor-${repoSeq}.sh`);
    writeFileSync(
      script,
      [
        `touch ${JSON.stringify(this.started)}`,
        `while [ ! -f ${JSON.stringify(this.release)} ]; do sleep 0.1; done`,
        `[ -s .lore/lore.db ] && touch ${JSON.stringify(this.snapshotIntact)}`,
        "exit 0",
      ].join("\n") + "\n",
    );
    const cfg = join(this.repo, ".lore", "config.yaml");
    const base = readFileSync(cfg, "utf8").split("\nworkflow:")[0] ?? "";
    writeFileSync(cfg, `${base.trimEnd()}\nworkflow:\n  integrate:\n    floor_command: ${JSON.stringify(`sh ${script}`)}\n`);
  }

  env(session: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: this.repo, EDITOR: "true", CLAUDECODE: "1" };
    delete env.CLAUDE_SESSION_ID;
    env.CLAUDE_CODE_SESSION_ID = session;
    return env;
  }

  git(args: string[]): string {
    const r = sh(this.repo, "git", args);
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
    return r.stdout.trim();
  }

  makeBranch(name: string): string {
    this.git(["checkout", "-q", "-b", name, "main"]);
    writeFileSync(join(this.repo, `${name}.txt`), `${name}\n`);
    this.git(["add", `${name}.txt`]);
    this.git(["commit", "-q", "-m", `work on ${name}`]);
    this.git(["checkout", "-q", "--detach", "main"]);
    // BR-1348: integrate refuses a branch no task belongs to
    claimBranchTask((args) => {
      const r = sh(this.repo, "bun", ["run", INDEX_TS, ...args], this.env("claim"));
      return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
    }, this.repo, name);
    return name;
  }

  integrate(branch: string, session: string): Running {
    const began = Date.now();
    const child = spawn("bun", ["run", INDEX_TS, "integrate", branch, "--session", session], { cwd: this.repo, env: this.env(session) });
    const done = new Promise<RunResult>((resolve) => {
      let out = "";
      child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
      child.stderr?.on("data", (c: Buffer) => (out += c.toString()));
      child.on("close", (code) => resolve({ out, exitCode: code ?? 1, ms: Date.now() - began }));
    });
    return { child, done };
  }

  integrationWorktree(session: string): string {
    return join(this.repo, ".claude", "worktrees", `integrate-${session}`);
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-lease-"));
});

afterAll(() => {
  if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
});

describe("a second integrate in the same session's integration worktree", () => {
  it("is refused with exit 75 within 2 s naming the first run's pid, branch and start time; the first lands unaffected", async () => {
    const fx = new Fixture();
    const first = fx.makeBranch("first-branch");
    const second = fx.makeBranch("second-branch");
    const firstRun = fx.integrate(first, "sess-lease");
    await until("the first floor to start", () => existsSync(fx.started));
    const mainBefore = fx.git(["rev-parse", "main"]);

    const refused = await fx.integrate(second, "sess-lease").done;

    const wt = fx.integrationWorktree("sess-lease");
    const text = refused.out.trim();
    expect(refused.exitCode, text).toBe(75);
    expect(refused.ms, text).toBeLessThan(2000);
    expect(text).toBe(
      `integrate: another integrate is running in ${wt} (pid ${firstRun.child.pid}, branch ${first}, started ${/started (\S+)\)/.exec(text)?.[1]}); ` +
        "wait for it to finish, then re-run. Nothing was changed",
    );
    expect(/started (\d{4}-\d\d-\d\dT[\d:.]+Z)\)/.test(text), text).toBe(true);
    // refused before any merge or snapshot: main did not move and no attempt line was printed
    expect(fx.git(["rev-parse", "main"])).toBe(mainBefore);
    expect(text).not.toContain("attempt");
    expect(text).not.toContain("corpus snapshot");

    writeFileSync(fx.release, "go\n");
    const landed = await firstRun.done;
    expect(landed.exitCode, landed.out).toBe(0);
    expect(existsSync(fx.snapshotIntact), "the first floor's corpus snapshot was overwritten or removed under it").toBe(true);
    expect(fx.git(["merge-base", "--is-ancestor", first, "main"])).toBe("");
  }, 240_000);

  it("proceeds once the first run was killed: the kernel released its lock, no stale-lock cleanup", async () => {
    const fx = new Fixture();
    const first = fx.makeBranch("killed-branch");
    const next = fx.makeBranch("next-branch");
    const firstRun = fx.integrate(first, "sess-kill");
    await until("the first floor to start", () => existsSync(fx.started));
    firstRun.child.kill("SIGKILL");
    await firstRun.done;
    writeFileSync(fx.release, "go\n");

    const rerun = await fx.integrate(next, "sess-kill").done;

    expect(rerun.exitCode, rerun.out).toBe(0);
    expect(rerun.out).not.toContain("another integrate is running");
    expect(fx.git(["merge-base", "--is-ancestor", next, "main"])).toBe("");
  }, 240_000);

  it("proceeds after the first run exited normally", async () => {
    const fx = new Fixture();
    writeFileSync(fx.release, "go\n");
    const first = fx.makeBranch("done-branch");
    const next = fx.makeBranch("after-branch");
    const a = await fx.integrate(first, "sess-seq").done;
    expect(a.exitCode, a.out).toBe(0);

    const b = await fx.integrate(next, "sess-seq").done;

    expect(b.exitCode, b.out).toBe(0);
    expect(fx.git(["merge-base", "--is-ancestor", next, "main"])).toBe("");
  }, 240_000);

  it("takes its corpus snapshot over a stale lore.db-journal left by an interrupted earlier snapshot", async () => {
    const fx = new Fixture();
    writeFileSync(fx.release, "go\n");
    const first = fx.makeBranch("seed-branch");
    const next = fx.makeBranch("journal-branch");
    const a = await fx.integrate(first, "sess-journal").done;
    expect(a.exitCode, a.out).toBe(0);
    const corpusDir = join(fx.integrationWorktree("sess-journal"), ".lore");
    const stale = join(corpusDir, "lore.db-journal");
    mkdirSync(corpusDir, { recursive: true });
    writeFileSync(stale, Buffer.alloc(1024, 1));
    writeFileSync(join(corpusDir, "lore.db.staging"), "half written");

    const b = await fx.integrate(next, "sess-journal").done;

    expect(b.exitCode, b.out).toBe(0);
    expect(b.out).toMatch(/floor runs against a corpus snapshot taken/);
    expect(existsSync(stale)).toBe(false);
    expect(fx.git(["merge-base", "--is-ancestor", next, "main"])).toBe("");
  }, 240_000);

  it("does not refuse a run of a different session: its integration worktree is its own", async () => {
    const fx = new Fixture();
    const first = fx.makeBranch("session-a-branch");
    const other = fx.makeBranch("session-b-branch");
    const firstRun = fx.integrate(first, "sess-a");
    await until("the first floor to start", () => existsSync(fx.started));
    const otherRun = fx.integrate(other, "sess-b");
    await new Promise((r) => setTimeout(r, 6000));
    writeFileSync(fx.release, "go\n");

    const [a, b] = [await firstRun.done, await otherRun.done];

    expect(b.out).not.toContain("another integrate is running");
    expect([0, 75], a.out).toContain(a.exitCode);
    expect([0, 75], b.out).toContain(b.exitCode);
  }, 240_000);
});
