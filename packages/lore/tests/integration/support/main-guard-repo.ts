/**
 * Throwaway-repository fixture for the main-ref guard oracles (spec-no-working-copy-can-check-out-main-the-main-ref-guard).
 *
 * Purpose: one place that builds a throwaway git repo + corpus (mkdtemp, `git init -b main`, `lore init`) and runs the REAL
 * `lore` entry (`bun run src/index.ts`) against it, so each oracle file states only what it asserts. Never touches this
 * repository's own `.lore/`, refs or worktrees.
 * Public surface: GuardRepo (git / gitRaw / lore / setupProject / integrate / makeBranch / main / headState),
 * installShippedGuard, oldGitShim, SHIPPED_HOOK_PATH.
 * Side-effect class: IO (temp directories, child processes).
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

/** The hook this lore ships (`assets/project/reference-transaction`). */
export const SHIPPED_HOOK_PATH = join(PACKAGE_ROOT, "..", "..", "assets", "project", "reference-transaction");

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly out: string;
  readonly exitCode: number;
}

/** A fresh temp directory under the OS temp dir. */
export function makeTempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Installs the shipped guard into `repo` the way `lore setup --project` leaves it, without running setup: copies the
 * asset to `<repo>/hooks/reference-transaction` (executable) and points `core.hooksPath` at that directory.
 */
export function installShippedGuard(repo: string): void {
  const hooks = join(realpathSync(repo), "hooks");
  mkdirSync(hooks, { recursive: true });
  const target = join(hooks, "reference-transaction");
  copyFileSync(SHIPPED_HOOK_PATH, target);
  chmodSync(target, 0o755);
  const set = spawnSync("git", ["config", "core.hooksPath", hooks], { cwd: repo, encoding: "utf8" });
  if (set.status !== 0) throw new Error(`git config core.hooksPath failed: ${set.stderr}`);
}

/**
 * A directory holding a `git` shim that reports `version` for `git --version` and delegates every other call to the real
 * git. Put it first on PATH to run `lore` against an "old git" without a second git on the machine.
 */
export function oldGitShim(root: string, version: string): string {
  const dir = mkdtempSync(join(root, "git-shim-"));
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(dir, "git"), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version ${version}"; exit 0; fi\nexec ${JSON.stringify(realGit)} "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  return dir;
}

export interface GuardRepoOptions {
  /** Run `git init` + first commit only: no `lore init`, no floor. Default false. */
  readonly bare?: boolean;
  /** Skip the initial commit (an unborn main). Default false. */
  readonly unborn?: boolean;
  /** Leave the shared checkout on branch main (default) or detach it at main. */
  readonly detached?: boolean;
}

let repoSequence = 0;

export class GuardRepo {
  readonly repo: string;
  private branchSequence = 0;

  constructor(readonly root: string, opts: GuardRepoOptions = {}) {
    repoSequence += 1;
    this.repo = join(root, `repo-${repoSequence}`);
    mkdirSync(this.repo, { recursive: true });
    this.git(["init", "-q", "-b", "main"]);
    this.git(["config", "user.email", "t@example.com"]);
    this.git(["config", "user.name", "t"]);
    this.git(["config", "commit.gpgsign", "false"]);
    if (opts.unborn === true) return;
    writeFileSync(join(this.repo, "base.txt"), "base\n");
    this.git(["add", "base.txt"]);
    this.git(["commit", "-q", "-m", "base"]);
    if (opts.bare !== true) {
      const init = spawnSync("bun", ["run", INDEX_TS, "init"], { cwd: this.repo, env: this.env(), encoding: "utf8" });
      if (init.status !== 0) throw new Error(`lore init failed: ${init.stderr}`);
      appendFileSync(join(this.repo, ".git", "info", "exclude"), ".lore/\n.claude/\n");
    }
    if (opts.detached === true) this.git(["checkout", "-q", "--detach", "main"]);
  }

  env(session?: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    // reason: HOME is outside the repo so bun's cache and setup's global files never land in a tree the oracles compare byte for byte
    const home = join(this.root, "home");
    mkdirSync(home, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, EDITOR: "true", CLAUDECODE: "1", ...extra };
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDE_SESSION_ID;
    delete env.LORE_INTEGRATE;
    if (session !== undefined) env.CLAUDE_CODE_SESSION_ID = session;
    return env;
  }

  /** git that must succeed; returns trimmed stdout. */
  git(args: string[], cwd: string = this.repo): string {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
    return r.stdout.trim();
  }

  /** Raw git outcome (never throws): the hook refusals are the thing under test. */
  gitRaw(args: string[], cwd: string = this.repo, extraEnv: NodeJS.ProcessEnv = {}): { status: number; stdout: string; stderr: string; out: string } {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...extraEnv } });
    const stdout = r.stdout ?? "";
    const stderr = r.stderr ?? "";
    return { status: r.status ?? -1, stdout, stderr, out: stdout + stderr };
  }

  /** `lore setup --project --yes` here (installs the shipped guard). */
  setupProject(extraEnv: NodeJS.ProcessEnv = {}): RunResult {
    const r = spawnSync("bun", ["run", INDEX_TS, "setup", "--project", "--yes"], { cwd: this.repo, env: this.env(undefined, extraEnv), encoding: "utf8" });
    const stdout = r.stdout ?? "";
    const stderr = r.stderr ?? "";
    return { stdout, stderr, out: stdout + stderr, exitCode: r.status ?? 1 };
  }

  lore(args: string[], session: string | undefined, extraEnv: NodeJS.ProcessEnv = {}): Promise<RunResult> {
    return new Promise((resolve) => {
      const child = spawn("bun", ["run", INDEX_TS, ...args], { cwd: this.repo, env: this.env(session, extraEnv) });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
      child.on("close", (code) => resolve({ stdout, stderr, out: stdout + stderr, exitCode: code ?? 1 }));
    });
  }

  integrate(branch: string, session: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<RunResult> {
    return this.lore(["integrate", branch, "--session", session], session, extraEnv);
  }

  /** Sets `workflow.integrate.floor_command` in the throwaway corpus config. */
  setFloor(floorCommand: string): void {
    const configPath = join(this.repo, ".lore", "config.yaml");
    const base = readFileSync(configPath, "utf8").split("\nworkflow:")[0] ?? "";
    writeFileSync(configPath, `${base.trimEnd()}\n\nworkflow:\n  integrate:\n    floor_command: ${JSON.stringify(floorCommand)}\n`);
  }

  /** A branch off main holding one new file, created without ever checking out main; returns its name. */
  makeBranch(label: string): string {
    this.branchSequence += 1;
    const name = `${label}-${this.branchSequence}`;
    const wt = join(this.root, `branch-wt-${repoSequence}-${this.branchSequence}`);
    this.git(["worktree", "add", "-q", "-b", name, wt, this.main()]);
    writeFileSync(join(wt, `${name}.txt`), `${name}\n`);
    this.git(["add", `${name}.txt`], wt);
    this.git(["commit", "-q", "-m", `work on ${name}`], wt);
    this.git(["worktree", "remove", "--force", wt]);
    return name;
  }

  main(): string {
    return this.git(["rev-parse", "refs/heads/main"]);
  }

  /** HEAD of a working copy as `{ sha, branch }` (`branch` is "" when detached). */
  headState(cwd: string = this.repo): { sha: string; branch: string } {
    return { sha: this.git(["rev-parse", "HEAD"], cwd), branch: this.gitRaw(["symbolic-ref", "-q", "HEAD"], cwd).stdout.trim() };
  }

  /** Paths of every registered working copy, as git prints them. */
  worktreePaths(): string[] {
    return this.git(["worktree", "list", "--porcelain"])
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length));
  }
}
