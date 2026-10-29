/**
 * Module: evidence-binding — evidence binds to code (AC-DCS1-27) and the contract is evaluated against the landed tree (AC-DCS1-30).
 *
 * Purpose: the two git facts the stored-contract done floors need, each stated once:
 *   - {@link treesIdentical}: whether the commit a pass row ran on (B) holds the same git tree as the commit the task landed on
 *     (L). A pass counts for a code oracle when it does; no ancestor relation is required, so a row taken on a later commit with
 *     the same tree counts. A difference names the paths `git diff --name-only B L` lists (the cause `evidence-stale`); a commit
 *     git cannot read is never a pass (the cause `evidence-unmeasurable`).
 *   - {@link missingOracleFiles}: which test-file oracles are absent from the landed tree, and which of those the task's own
 *     landing deleted (they leave the evaluation set with a recorded reason) and which it did not (they refuse the task).
 * Public surface: {@link treesIdentical}, {@link TreeVerdict}, {@link missingOracleFiles}, {@link MissingOracleFiles},
 *   {@link deletedByDiff}, {@link pathExistsAt}, {@link createGitRunner}, {@link GitRunner}.
 * Invariants:
 *   - nothing here defaults: a git call that fails is `unmeasurable` with its reason, never "identical" and never "deleted".
 *   - pure over an injected {@link GitRunner}; {@link createGitRunner} is the one place `git` is spawned.
 * Side-effect class: git reads only (through the injected runner).
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-27, AC-DCS1-30), ledger D36.
 */

import { spawnSync } from "node:child_process";

/** Runs `git <args>` in one repository; the stdout when git exits 0, else the reason. */
export type GitRunner = (args: readonly string[]) => { readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly reason: string };

/**
 * The git runner of the repository at `cwd`.
 *
 * @param cwd - any directory inside the repository (the shared checkout or a worktree)
 */
export function createGitRunner(cwd: string): GitRunner {
  return (args) => {
    const run = spawnSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (run.error !== undefined) return { ok: false, reason: `git ${args.join(" ")} could not start: ${run.error.message}` };
    if (run.status !== 0) return { ok: false, reason: `git ${args.join(" ")} exited ${run.status}: ${run.stderr.trim()}` };
    return { ok: true, stdout: run.stdout };
  };
}

/** The result of comparing the tree a row ran on with the landed tree. */
export type TreeVerdict =
  | { readonly state: "identical" }
  | { readonly state: "different"; readonly paths: readonly string[] }
  | { readonly state: "unmeasurable"; readonly reason: string };

/** Whether a changed-path list says the two trees are the same (an empty list). */
function noChange(changed: readonly string[]): boolean {
  return changed.length === 0;
}

/**
 * Compares the git tree of `bound` (the commit a pass row ran on) with the git tree of `landed` (the commit the task landed on).
 *
 * @param git - the repository's git runner
 * @param bound - the commit the row's runner measured (`attestation.head_sha`)
 * @param landed - the `landing_commit` of the task's newest landing record
 * @returns `identical`; `different` with the paths `git diff --name-only <bound> <landed>` lists; `unmeasurable` when either
 *   commit cannot be read
 * @example
 * treesIdentical(createGitRunner(root), rowHead, landingCommit); // => { state: "different", paths: ["src/a.ts"] }
 */
export function treesIdentical(git: GitRunner, bound: string, landed: string): TreeVerdict {
  const boundTree = git(["rev-parse", "--verify", "--quiet", `${bound}^{tree}`]);
  if (!boundTree.ok) return { state: "unmeasurable", reason: `commit ${bound} is not readable (${boundTree.reason})` };
  const landedTree = git(["rev-parse", "--verify", "--quiet", `${landed}^{tree}`]);
  if (!landedTree.ok) return { state: "unmeasurable", reason: `landing commit ${landed} is not readable (${landedTree.reason})` };
  if (boundTree.stdout.trim() === landedTree.stdout.trim()) return { state: "identical" };
  const diff = git(["diff", "--name-only", bound, landed]);
  if (!diff.ok) return { state: "unmeasurable", reason: diff.reason };
  const changed = diff.stdout.split("\n").filter((line) => line !== "");
  // reason: two trees with different ids differ in at least one path; an empty list would mean git disagreed with itself, which is never a pass.
  if (noChange(changed)) return { state: "unmeasurable", reason: `trees of ${bound} and ${landed} differ but git lists no changed path` };
  return { state: "different", paths: changed };
}

/**
 * Whether `path` exists in the tree of `commit`.
 *
 * @returns `true`/`false`, or the reason git could not answer
 */
export function pathExistsAt(git: GitRunner, commit: string, path: string): boolean | { readonly unmeasurable: string } {
  const tree = git(["rev-parse", "--verify", "--quiet", `${commit}^{tree}`]);
  if (!tree.ok) return { unmeasurable: `commit ${commit} is not readable (${tree.reason})` };
  return git(["cat-file", "-e", `${commit}:${path}`]).ok;
}

/**
 * The paths the diff `from..to` deleted (`git diff --diff-filter=D --name-only`).
 *
 * @returns the deleted paths, or the reason git could not answer
 */
export function deletedByDiff(git: GitRunner, from: string, to: string): ReadonlySet<string> | { readonly unmeasurable: string } {
  const diff = git(["diff", "--diff-filter=D", "--name-only", from, to]);
  if (!diff.ok) return { unmeasurable: diff.reason };
  return new Set(diff.stdout.split("\n").filter((line) => line !== ""));
}

/** One test-file oracle of the contract. */
export interface TestFileOracle {
  readonly id: string;
  readonly path: string;
}

/** The verdict of {@link missingOracleFiles}. */
export interface MissingOracleFiles {
  /** Paths absent from the landed tree that the task's landing did NOT delete: they refuse the task. */
  readonly missing: readonly string[];
  /** Oracles absent from the landed tree because the task's landing deleted the file: they leave the evaluation set. */
  readonly removed: readonly TestFileOracle[];
}

/**
 * Splits the test-file oracles that the landed tree lacks into the ones the task deleted and the ones it did not.
 *
 * @param oracles - the contract's test-file oracles (the contract list itself is never shortened by this)
 * @param landedTree - answers whether a path exists in the landed tree
 * @param deletedByTask - the paths the task's own landing deleted
 * @example
 * missingOracleFiles([{ id: "test:a", path: "a" }], { has: () => false }, new Set(["a"])); // => { missing: [], removed: [{ id: "test:a", path: "a" }] }
 */
export function missingOracleFiles(
  oracles: readonly TestFileOracle[],
  landedTree: { readonly has: (path: string) => boolean },
  deletedByTask: ReadonlySet<string>,
): MissingOracleFiles {
  const existsAtLanded = (path: string): boolean => landedTree.has(path);
  const missing: string[] = [];
  const removed: TestFileOracle[] = [];
  for (const oracle of oracles) {
    const path = oracle.path;
    if (!existsAtLanded(path) && !deletedByTask.has(path)) missing.push(path);
    if (!existsAtLanded(path) && deletedByTask.has(path)) removed.push(oracle);
  }
  return { missing, removed };
}
