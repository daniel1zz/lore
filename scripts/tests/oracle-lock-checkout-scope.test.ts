// @spawns-external git builds a throwaway repository with a linked worktree
/** @spec_ref AC-OX-7 */
/**
 * Unit suite for `scripts/oracle-lock.ts`'s `resolveDefaultLockDir`
 * (`spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check`, AC-OX-7) --
 * the PRODUCTION lock path's CHECKOUT-level scope. Split out of AC-OX-4
 * because that criterion's prose promises two layers (lock BEHAVIOUR and
 * lock PATH) while its own oracle (`scripts/tests/oracle-lock.test.ts`) only
 * drives the first: every call there passes an injected `mkdtemp` directory,
 * and its own header says the production path "is exercised only by actually
 * running `bun run test` for real, never by this file". A per-worktree lock
 * path would compile, pass every one of that file's seven cases, and
 * serialize nothing -- exactly the defect this file exists to reject.
 *
 * Fully hermetic: every git repo/worktree this file creates lives inside its
 * OWN fresh `mkdtemp` directory, never this repo's own checkout -- running
 * `git init`/`git worktree add`, or acquiring a real lock, against the live
 * checkout would collide with concurrent oracle runs elsewhere in this repo
 * (this repo has live concurrent sessions). The EXPORTED
 * `resolveDefaultLockDir` is imported and CALLED directly -- never
 * reimplemented, never merely grepped for -- since this is a
 * production-wiring assertion: a test that recomputed `git rev-parse` itself
 * and compared two of its own values would pass even if the production
 * function were deleted.
 *
 * Six-dimension coverage:
 *   HAPPY:      `resolveDefaultLockDir(mainRepoPath)` equals an independently
 *               computed, absolute `git rev-parse --git-common-dir` for that
 *               path -- AND (the discriminating half of this AC)
 *               `resolveDefaultLockDir(linkedWorktreePath)` returns that
 *               SAME absolute directory for a real linked worktree of the
 *               same repo. A main-checkout-only assertion is provably
 *               non-discriminating: measured on THIS repo 2026-08-17, `git
 *               rev-parse --git-dir` and `--git-common-dir` both print
 *               `.git` from the main checkout and diverge only from a linked
 *               worktree -- so only the linked-worktree comparison can ever
 *               turn red under the declared falsifier.
 *   NEGATIVE:   the AC's declared falsifier (swap `--git-common-dir` for
 *               `--git-dir` in `scripts/oracle-lock.ts`) is run externally,
 *               not inside this file -- see the task/AC for the exact
 *               mutation and its declared exit code. This file cannot prove
 *               its own discriminating power; only actually applying the
 *               mutation and re-running this suite can.
 *   BOUNDARY:   a directory that is NOT a git repository at all makes
 *               `resolveDefaultLockDir` throw. Measured separately: a repo
 *               with ZERO commits does NOT throw here (`git rev-parse
 *               --git-common-dir` only needs `.git` to exist, not a commit --
 *               a commit is made in the fixture solely because `git worktree
 *               add` needs one to branch from), so "not a git repo at all"
 *               is the boundary that actually trips the throw.
 *   ERROR:      the thrown `Error` is not swallowed into `undefined`/`null`
 *               -- its message names the failing git invocation, matching
 *               the module's own "environment problem, not a lock decision"
 *               contract (never a silent fallback to a per-worktree path).
 *   STATE:      repeated calls against the SAME repo/worktree pair return an
 *               identical value every time -- not a per-call fluke.
 *   REGRESSION: this file adds assertions, it does not touch
 *               `scripts/oracle-lock.ts` or `scripts/tests/oracle-lock.test.ts`
 *               -- that file's own seven AC-OX-4 cases are unaffected and
 *               keep passing (verified by running both files together).
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveDefaultLockDir } from "../oracle-lock.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Runs `cmd` synchronously in `cwd` and throws immediately if it could not
 * even be spawned or exited non-zero -- fixture setup failing loud beats a
 * test that silently proceeds against a half-built repo.
 */
function runOrThrow(cmd: string, args: string[], cwd: string): string {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (result.error) {
    throw new Error(`fixture setup: failed to spawn "${cmd} ${args.join(" ")}" in ${cwd} -- ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `fixture setup: "${cmd} ${args.join(" ")}" in ${cwd} exited ${result.status} -- ${result.stderr ?? "<no stderr>"}`,
    );
  }
  return result.stdout ?? "";
}

/**
 * Builds a throwaway git repo (one empty commit -- `git worktree add` needs
 * a commit to branch from) plus a real LINKED worktree of it, entirely
 * inside a fresh `mkdtemp` parent. Both the repo and the worktree directory
 * are registered for `afterEach` cleanup. Never touches this repo's own
 * checkout.
 */
function buildThrowawayRepoWithLinkedWorktree(): { mainRepoPath: string; linkedWorktreePath: string } {
  // realpathSync is REQUIRED here, not cosmetic: on macOS `os.tmpdir()`
  // resolves through the `/var` -> `/private/var` symlink. `git
  // rev-parse --git-common-dir` from a LINKED worktree returns an already
  // realpath-canonicalised absolute path (git stores the target as a
  // resolved path when it writes the worktree's `.git` pointer file), while
  // from the MAIN checkout it returns the relative literal `.git`, which
  // `resolve()` then joins onto whatever path string we pass in verbatim.
  // Skipping this canonicalisation made the two sides differ only by a
  // `/private` prefix -- a symlink artifact of the fixture's location, NOT
  // of `resolveDefaultLockDir` -- and would have produced a false red
  // unrelated to the AC under test (measured while building this file).
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "oracle-lock-checkout-scope-")));
  cleanupDirs.push(parent);

  const mainRepoPath = join(parent, "main-repo");
  mkdirSync(mainRepoPath, { recursive: true });
  runOrThrow("git", ["init", "-q"], mainRepoPath);
  runOrThrow("git", ["config", "user.email", "oracle-lock-test@example.invalid"], mainRepoPath);
  runOrThrow("git", ["config", "user.name", "Oracle Lock Test"], mainRepoPath);
  runOrThrow("git", ["commit", "--allow-empty", "-q", "-m", "seed"], mainRepoPath);

  const linkedWorktreePath = join(parent, "linked-worktree");
  runOrThrow("git", ["worktree", "add", "-q", "-b", "oracle-lock-checkout-scope-wt", linkedWorktreePath], mainRepoPath);

  return { mainRepoPath, linkedWorktreePath };
}

describe("resolveDefaultLockDir production wiring (AC-OX-7)", () => {
  it("HAPPY: agrees with an independently computed git-common-dir for the main checkout, AND (the discriminating assertion) returns the SAME absolute directory for a linked worktree of that same repo", () => {
    const { mainRepoPath, linkedWorktreePath } = buildThrowawayRepoWithLinkedWorktree();

    const independentOutput = runOrThrow("git", ["rev-parse", "--git-common-dir"], mainRepoPath);
    const expectedAbsolute = resolve(mainRepoPath, independentOutput.trim());

    const fromMainCheckout = resolveDefaultLockDir(mainRepoPath);
    expect(fromMainCheckout).toBe(expectedAbsolute);

    // The discriminating half: a linked worktree of the SAME repo must
    // resolve to the identical shared lock directory, not a path scoped to
    // its own worktree-private git-dir.
    const fromLinkedWorktree = resolveDefaultLockDir(linkedWorktreePath);
    expect(fromLinkedWorktree).toBe(fromMainCheckout);

    // Sanity against a vacuous match (e.g. both sides accidentally empty).
    expect(fromMainCheckout.startsWith("/")).toBe(true);
    expect(fromMainCheckout.endsWith(".git")).toBe(true);
  });

  it("BOUNDARY + ERROR: a directory that is not a git repository at all throws a loud, non-swallowed Error naming the failing git invocation", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "oracle-lock-checkout-scope-non-repo-"));
    cleanupDirs.push(notARepo);

    expect(() => resolveDefaultLockDir(notARepo)).toThrow(/git rev-parse --git-common-dir/);
  });

  it("STATE: repeated calls against the same repo/worktree pair return an identical value every time", () => {
    const { mainRepoPath, linkedWorktreePath } = buildThrowawayRepoWithLinkedWorktree();

    const first = resolveDefaultLockDir(mainRepoPath);
    const second = resolveDefaultLockDir(mainRepoPath);
    const third = resolveDefaultLockDir(linkedWorktreePath);

    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});
