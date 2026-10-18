#!/usr/bin/env bun
/**
 * Run a test command from a PRIVATE COPY of the repository tree (TG-46), so the repo-write guard
 * (scripts/tree-snapshot-guard.ts) attributes a write to the run only when the run's own processes made it.
 *
 * Problem: the guard compares the tree before and after a run. In a checkout several sessions share, any
 * other session's edit lands between the two snapshots and fails a green run (measured 2026-10-18: 35/35
 * passed, exit 1, blaming a fixture another session was editing; no test reads it). A check that holds only
 * with one session per checkout relies on exclusivity, which the target state refuses.
 *
 * Mechanism chosen: isolation by construction. The run's cwd is a copy of every non-ignored file (tracked and
 * untracked, current content) in a fresh directory. The globalSetup guard runs inside that copy, so
 *   - a write by any process of the run's tree, whatever the program (vitest worker, dist/lore, git, sh), lands
 *     in the copy and is seen by the unchanged snapshot comparison, naming the path;
 *   - an edit by a process outside the run lands in the real tree, which nothing compares.
 * Rejected on the merits:
 *   - an fs write journal kept by the harness (the existing read recorder, scripts/test-read-log.ts, is such a
 *     wrapper): sees only vite-transformed JS; a program a test spawns is invisible, so a child's write would
 *     be unattributable and either missed or confused with another session's;
 *   - tracing the process tree (strace, fs_usage, dtrace, sandbox report mode): unprivileged only on Linux
 *     (strace); macOS needs root, and the repo's developers work on macOS;
 *   - a sandbox-exec write denial: macOS-only, deprecated, and it would have to allow-list ignored output dirs;
 *   - a read-only tree: the other session must keep writing the real one.
 * No allowlist of other sessions' files, no retry, no time window: attribution comes from where the run executes.
 *
 * What the copy contains: every path `git ls-files --cached --others --exclude-standard` lists that exists on
 * disk (clonefile where the volume supports it, mtime preserved so dist/lore staleness checks agree with the real
 * tree). Git-ignored entries (node_modules, dist, .lore db files, caches) are SYMLINKED to the real ones: they are
 * outside the guard by definition (it ignores them) and copying them would cost minutes. A repo with no
 * node_modules of its own (an agent worktree resolves packages from an ancestor) gets a symlink to the nearest
 * ancestor's. `.git` is a symlink (directory) or a copy of the gitdir pointer (file), so `git status` in the copy
 * reads the same repository.
 *
 * Public surface: {@link createPrivateTree}, {@link runInPrivateTree}, {@link nearestNodeModules}, {@link PrivateTree}.
 * CLI: `bun scripts/private-tree-run.ts --root <repo> -- <command> [args...]` runs the command with cwd = the
 * copy of <repo>, prints nothing of its own, exits with the command's status (2 on usage error).
 * Side-effect class: IO (spawns git and the command, writes a temp directory it removes afterwards).
 */
import { spawnSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** A private copy of a repository's non-ignored tree. `dispose` removes it (never follows the symlinks inside). */
export interface PrivateTree {
  readonly dir: string;
  dispose(): void;
}

function gitList(root: string, args: readonly string[]): string[] {
  // reason: -z keeps paths with spaces/newlines intact; --directory collapses an all-ignored directory to one entry.
  const git = spawnSync("git", ["ls-files", "-z", ...args], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (git.status !== 0) {
    throw new Error(`git ls-files ${args.join(" ")} failed in ${root} (exit ${String(git.status)}): ${git.stderr}; the private tree cannot be built`);
  }
  return git.stdout.split("\0").filter((p) => p.length > 0);
}

/**
 * The node_modules `root` resolves packages from: the nearest one at or above it that holds `vitest`.
 * (An agent worktree has none of its own; test:file only creates `node_modules/.cache` there, which is not an install.)
 * Throws when there is none.
 */
export function nearestNodeModules(root: string): string {
  for (let dir = root; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules");
    if (existsSync(join(candidate, "vitest"))) return candidate;
    if (dirname(dir) === dir) throw new Error(`no node_modules with vitest at or above ${root}; tests could not resolve their packages`);
  }
}

function linkTo(target: string, linkPath: string): void {
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(target, linkPath);
}

function copyEntry(source: string, destination: string): void {
  const stats = lstatSync(source);
  mkdirSync(dirname(destination), { recursive: true });
  if (stats.isSymbolicLink()) {
    symlinkSync(readlinkSync(source), destination);
    return;
  }
  // reason: FICLONE = copy-on-write where the volume supports it, a plain copy elsewhere (never an error).
  copyFileSync(source, destination, constants.COPYFILE_FICLONE);
  utimesSync(destination, stats.atime, stats.mtime);
}

/**
 * Copies `root`'s non-ignored tree into a fresh temp directory under `parent`.
 *
 * @throws {Error} when `root` is not a git work tree, or has no node_modules at or above it.
 */
export function createPrivateTree(root: string, parent: string = tmpdir()): PrivateTree {
  const dir = mkdtempSync(join(parent, "lore-private-tree-"));
  const dispose = (): void => {
    // reason: the copy holds symlinks to the real ignored dirs; rmSync removes a link, never its target.
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    for (const path of gitList(root, ["--cached", "--others", "--exclude-standard"])) {
      // reason: the root node_modules is linked below; a private tree's own link is listed here as untracked (the
      // ignore pattern `node_modules/` matches directories only), so a run nested in a private tree would clash.
      if (path === "node_modules") continue;
      const source = join(root, path);
      // reason: a tracked file deleted in the work tree is listed by --cached; it is absent from the copy too.
      if (existsSync(source) || isDanglingLink(source)) copyEntry(source, join(dir, path));
    }
    for (const path of gitList(root, ["--others", "--ignored", "--exclude-standard", "--directory"])) {
      const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
      // reason: the root node_modules is linked below, to the install that holds the packages (not always this root's own).
      if (trimmed !== "node_modules" && !existsSync(join(dir, trimmed))) linkTo(join(root, trimmed), join(dir, trimmed));
    }
    linkTo(nearestNodeModules(root), join(dir, "node_modules"));
    const gitEntry = join(root, ".git");
    if (lstatSync(gitEntry).isDirectory()) linkTo(gitEntry, join(dir, ".git"));
    else copyEntry(gitEntry, join(dir, ".git"));
  } catch (caught) {
    dispose();
    throw caught;
  }
  return { dir, dispose };
}

function isDanglingLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    // reason: ENOENT is the expected shape of a deleted tracked file, not a failure.
    return false;
  }
}

/**
 * Rewrites a vitest `--reporter=json` report so every test file name that starts with `fromRoot` (the private
 * copy) starts with `toRoot` (the real checkout) instead: the consumers of a report (census, selector cross-check)
 * relativise names against the real checkout. Only `testResults[].name` is touched.
 *
 * @throws {Error} when the report is missing or is not a vitest JSON report.
 */
export function rebaseReport(reportPath: string, fromRoot: string, toRoot: string): void {
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as { testResults?: { name: string }[] };
  if (!Array.isArray(report.testResults)) throw new Error(`${reportPath} is not a vitest JSON report (no testResults array)`);
  for (const result of report.testResults) {
    if (result.name.startsWith(`${fromRoot}/`)) result.name = `${toRoot}${result.name.slice(fromRoot.length)}`;
  }
  writeFileSync(reportPath, JSON.stringify(report));
}

/**
 * Runs `cmd args` with cwd = a private copy of `root` and stdio inherited; removes the copy afterwards.
 *
 * @returns The command's exit status (1 when it died on a signal; a failure is never reported as success).
 * @throws {Error} when the copy cannot be built or the command cannot start.
 */
export function runInPrivateTree(
  root: string,
  cmd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  afterRun: (treeRealPath: string) => void = () => undefined,
): number {
  const tree = createPrivateTree(root);
  try {
    const result = spawnSync(cmd, [...args], { cwd: tree.dir, stdio: "inherit", env });
    if (result.error !== undefined) throw new Error(`could not start ${cmd}: ${result.error.message}`);
    afterRun(realpathSync(tree.dir));
    return result.status ?? 1;
  } finally {
    tree.dispose();
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf("--root");
  const sep = argv.indexOf("--");
  const root = rootFlag === -1 ? undefined : argv[rootFlag + 1];
  const command = sep === -1 ? [] : argv.slice(sep + 1);
  if (root === undefined || command.length === 0) {
    console.error("private-tree-run: usage: bun scripts/private-tree-run.ts --root <repo> -- <command> [args...]");
    process.exit(2);
  }
  try {
    process.exit(runInPrivateTree(resolve(root), command[0] as string, command.slice(1)));
  } catch (caught) {
    console.error(`private-tree-run: ${caught instanceof Error ? caught.message : String(caught)}`);
    process.exit(2);
  }
}
