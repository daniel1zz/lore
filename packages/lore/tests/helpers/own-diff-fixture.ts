/**
 * Test helper: a throwaway git repository + throwaway corpus (mkdtemp, `git init`, `lore init`) in which branches are
 * cut from main, tasks are created with file anchors and claimed on those branches, and `lore integrate` is run as a
 * real subprocess. Shared by the own-diff judgment oracles (dj-*.bun.test.ts, spec
 * spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end).
 *
 * Never touches the repo's own `.lore/`, refs or worktrees. Side-effect class: IO (git + `bun run src/index.ts`).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { patchLoreConfig } from "./patch-lore-config.js";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "./clean-tree-repo.js";
import { installShippedGuard } from "../integration/support/main-guard-repo.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

/**
 * The environment of every lore spawn the fixture makes: the parent's ambient session id is dropped, so a claim's
 * identity is only what the fixture names (hermetic whether or not the test runs inside an agent session).
 */
export function ownDiffFixtureEnv(): NodeJS.ProcessEnv {
  const { CLAUDE_CODE_SESSION_ID: _ambient, CLAUDE_SESSION_ID: _ambientAlt, ...rest } = process.env;
  return rest;
}

export interface LoreRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** stdout and stderr, for assertion messages. */
  readonly text: string;
}

/** Files of one commit: a string writes the file, `null` deletes it. */
export type FileChanges = Readonly<Record<string, string | null>>;

export class OwnDiffFixture {
  readonly dir: string;
  private readonly hooksDir: string;
  private taskSeq = 0;
  private planSlug = "";
  private prdSlug = "";

  /**
   * @param extraConfig - yaml appended under `workflow:` besides the integrate floor (already indented by two spaces).
   */
  constructor(extraConfig: readonly string[] = []) {
    this.dir = mkdtempSync(join(tmpdir(), "lore-own-diff-"));
    makeCleanTreeRepo(this.dir);
    appendFileSync(join(this.dir, ".git", "info", "exclude"), ".claude/\n");
    // the main-ref guard (spec-no-working-copy-can-check-out-main-the-main-ref-guard): `lore integrate` exits 4 without
    // it, so every refusal asserted here is told apart from the guard's by its rule id (BR-1346/1347/1348).
    this.git(["checkout", "-q", "--detach", "main"]);
    this.hooksDir = mkdtempSync(join(tmpdir(), "lore-own-diff-hooks-"));
    installShippedGuard(this.dir, this.hooksDir);
    this.mustLore(["init"]);
    patchLoreConfig(
      this.dir,
      ["workflow:", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"', ...extraConfig, ""].join("\n"),
    );
    this.prdSlug = this.parseSlug(this.mustLore(["create", "prd", "--title", "Own diff PRD", "--content", "root", "--no-ai"]).stdout);
    this.planSlug = this.createPlan("Own diff plan");
  }

  dispose(): void {
    try {
      rmSync(this.dir, { recursive: true, force: true });
      rmSync(this.hooksDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of a tmp dir
    }
  }

  private readonly sessionIds = new Map<string, number>();
  private readonly branchOfTask = new Map<string, string>();

  lore(args: readonly string[], extraEnv: Readonly<Record<string, string>> = {}): LoreRun {
    const proc = spawnSync("bun", ["run", INDEX_TS, ...args], {
      cwd: this.dir,
      encoding: "utf8",
      env: { ...ownDiffFixtureEnv(), HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: "agent:own-diff-fixture", ...extraEnv },
    });
    const stdout = proc.stdout ?? "";
    const stderr = proc.stderr ?? "";
    return { stdout, stderr, exitCode: proc.status ?? 1, text: `${stdout}\n${stderr}` };
  }

  mustLore(args: readonly string[], extraEnv: Readonly<Record<string, string>> = {}): LoreRun {
    const run = this.lore(args, extraEnv);
    if (run.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${run.exitCode}: ${run.text}`);
    return run;
  }

  git(args: readonly string[]): string {
    return execFileSync("git", [...args], { cwd: this.dir, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  }

  parseSlug(stdout: string): string {
    const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
    if (slug === undefined) throw new Error(`could not parse slug from create output: ${stdout}`);
    return slug;
  }

  createPlan(title: string): string {
    return this.parseSlug(this.mustLore(["create", "plan", "--title", title, "--parent", this.prdSlug, "--content", "x", "--no-ai"]).stdout);
  }

  /** The fixture's default plan slug. */
  get defaultPlan(): string {
    return this.planSlug;
  }

  /**
   * Commits `files` on top of main and moves main there the way the guard allows (`LORE_INTEGRATE=1` on the ref update);
   * no working copy ever has main checked out. The shared checkout ends detached at the new main.
   */
  commitOnMain(files: FileChanges, message: string): void {
    this.git(["checkout", "-q", "-b", "tmp-main-mover", "main"]);
    this.applyAndCommit(files, message);
    const sha = this.git(["rev-parse", "HEAD"]);
    this.git(["checkout", "-q", "--detach", sha]);
    execFileSync("git", ["update-ref", "refs/heads/main", sha], { cwd: this.dir, env: { ...ownDiffFixtureEnv(), LORE_INTEGRATE: "1" } });
    this.git(["branch", "-q", "-D", "tmp-main-mover"]);
  }

  /** Creates branch `name` from `from` (default main) with one commit of `files`. */
  makeBranch(name: string, files: FileChanges, from = "main"): void {
    this.git(["checkout", "-q", "-b", name, from]);
    this.applyAndCommit(files, `work on ${name}`);
    this.git(["checkout", "-q", "--detach", "main"]);
  }

  /** Adds one more commit of `files` to the existing branch `name`. */
  commitOnBranch(name: string, files: FileChanges, message = `more work on ${name}`): void {
    this.git(["checkout", "-q", name]);
    this.applyAndCommit(files, message);
    this.git(["checkout", "-q", "--detach", "main"]);
  }

  /** Merges `rev` into branch `name` (a merge commit), leaving the shared checkout detached at main. */
  mergeIntoBranch(name: string, rev: string): void {
    this.git(["checkout", "-q", name]);
    this.git(["merge", "--no-ff", "-q", "-m", `merge ${rev} into ${name}`, rev]);
    this.git(["checkout", "-q", "--detach", "main"]);
  }

  private applyAndCommit(files: FileChanges, message: string): void {
    for (const [path, content] of Object.entries(files)) {
      const abs = join(this.dir, path);
      if (content === null) {
        if (existsSync(abs)) unlinkSync(abs);
      } else {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
    }
    this.git(["add", "-A"]);
    this.git(["commit", "-q", "-m", message]);
  }

  /** A task of `plan` (default plan when omitted) declaring `anchors`; returns its slug. */
  createTask(title: string, anchors: readonly string[], plan: string = this.planSlug): string {
    this.taskSeq += 1;
    const args = ["create", "task", "--title", `${title} ${this.taskSeq}`, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai"];
    for (const anchor of anchors) args.push("--anchor", anchor);
    return this.parseSlug(this.mustLore(args).stdout);
  }

  /** Claims `task` on branch `branch` (the dispatch protocol records the branch name as the worktree). */
  claim(task: string, branch: string): void {
    // reason: each worktree is its own session. The claim's actor name comes from the session tier (`agent:session-<id8>`);
    // with none it collapses onto the OS user and lore refuses the second worktree's claim (SPEC-042 D10, ACTOR_IDENTITY_COLLISION).
    this.branchOfTask.set(task, branch);
    this.mustLore(["claim", task, "--worktree", branch], this.sessionEnvOf(branch));
  }

  private sessionEnvOf(branch: string): Record<string, string> {
    return { CLAUDE_CODE_SESSION_ID: this.sessionIdOf(branch) };
  }

  /** A session id per branch; its first 8 characters (all the actor name keeps) differ between branches. */
  private sessionIdOf(branch: string): string {
    let n = this.sessionIds.get(branch);
    if (n === undefined) {
      n = this.sessionIds.size + 1;
      this.sessionIds.set(branch, n);
    }
    return `fx${String(n).padStart(6, "0")}-${branch}`;
  }

  integrate(branch: string): LoreRun {
    return this.lore(["integrate", branch, "--session", "own-diff-session"]);
  }

  extraOf(slug: string): Record<string, unknown> {
    const payload = JSON.parse(this.mustLore(["get", slug, "--json"]).stdout) as { data: { doc: { extra: Record<string, unknown> } } };
    return payload.data.doc.extra;
  }

  landingOf(slug: string): { branch: string; outside_anchors?: string[] } | undefined {
    return this.extraOf(slug)["landing"] as { branch: string; outside_anchors?: string[] } | undefined;
  }

  /** Marks `task` done after its branch landed (`plan` is approved first, as the existing integrate oracles do). */
  archive(task: string, plan: string = this.planSlug): void {
    // reason: evidence and done run as the session that holds the claim, or lore refuses to archive it from under that session.
    const branch = this.branchOfTask.get(task);
    const asHolder = branch === undefined ? {} : this.sessionEnvOf(branch);
    this.mustLore(["evidence", task, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"], asHolder);
    this.mustLore(["set", plan, "--status", "approved"]);
    this.mustLore(["done", task], asHolder);
  }

  /** Everything `lore integrate` must leave byte-unchanged on a refusal: main, the worktree list, the shared checkout. */
  observableState(): string {
    return [
      this.git(["rev-parse", "refs/heads/main"]),
      this.git(["worktree", "list", "--porcelain"]),
      this.git(["rev-parse", "HEAD"]),
      this.git(["status", "--porcelain=v1", "--untracked-files=all"]),
    ].join("\n--\n");
  }

  readFile(path: string): string {
    return readFileSync(join(this.dir, path), "utf8");
  }
}
