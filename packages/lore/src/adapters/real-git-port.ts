/**
 * Real `GitPort` (SPEC-057 §Module Boundary D1 port implementation) — shells
 * `git` via `node:child_process.spawn` for every `SeatService` operation.
 * Mirrors `real-mcp-registrar.ts`'s "port implementation, adapter layer"
 * placement and its `node:child_process`-not-`Bun.spawn` invariant.
 *
 * Also the L0 ownership-binding git port (spec-multi-session-concurrency-
 * queryable-ownership-checkout §Scope L0, AC-OWN-2/AC-OWN-4) — three
 * standalone exported functions, deliberately NOT methods on `RealGitPort`
 * (they need no `repoRoot` state; every caller passes its own `cwd`) and
 * consumed by `TaskWorkflowService.claim`'s injectable `detectBranch`/
 * `installClaimTrailerBinding` ports (their real, default implementations —
 * see that service's constructor JSDoc for why a service importing a
 * concrete adapter function is a deliberate, narrow exception here: branch
 * detection / trailer binding are leaf IO capabilities with no OTHER service
 * dependency, so there is no `app.ts` composition-root wiring to route
 * through — mirrors `measureWorktreeCleanliness`'s own pre-existing ad hoc
 * `git` subprocess calls inside that same service file, just consolidated
 * behind an injectable, fake-able seam instead of inlined there again).
 *
 * Public surface:
 *   - RealGitPort implements GitPort — constructor(repoRoot) (the directory
 *     every `worktreeAdd`/`worktreeList`/`worktreeRemove`/`isMerged` call
 *     runs `git` from; `rebaseFromMain`/`isDirty` instead use their own
 *     explicit `cwd` argument, per the `GitPort` interface contract —
 *     those two operate on whichever checkout the CALLER names, typically
 *     the main checkout, not necessarily `repoRoot`).
 *   - BranchMeasurement / detectWorktreeBranch(cwd) — AC-OWN-2: a
 *     discriminated `{status:"measured", branch} | {status:"unmeasured"}`,
 *     NEVER a nullable string (mirrors `gate-predicates.ts::
 *     compareClaimSessions`'s three-valued "not measured ≠ known-absent"
 *     discipline). Detached HEAD, a non-repo path, a missing path, and any
 *     other `git` failure ALL degrade to `"unmeasured"` uniformly — never
 *     coerced to a placeholder branch name, and never to be confused with
 *     "unowned" (a DIFFERENT, higher-layer fact `lore territory` reports).
 *   - bindClaimSessionForTrailer(cwd, sessionId) — AC-OWN-4: best-effort
 *     composite of `writeClaimSessionMarker` + `ensureSessionTrailerHookInstalled`
 *     (both private) — records `sessionId` as the worktree's active claim and
 *     ensures the shared `commit-msg` hook that reads it is installed, so a
 *     commit made in `cwd` while the binding is live carries the
 *     `Lore-Session: <sessionId>` git trailer. Deliberately swallows both
 *     calls' Results and returns `void` — see its own doc for why this
 *     capability is advisory-only, mirroring `anchor-resolution.ts`'s
 *     "a non-resolving anchor is never a refusal" precedent.
 *
 * Invariants:
 *   - `node:child_process.spawn`, NOT `Bun.spawn` — the global `Bun` object
 *     is absent inside vitest's worker-thread pool (same empirically-verified
 *     constraint `real-mcp-registrar.ts`'s module doc documents; this port's
 *     own integration suite, `tests/integration/real-git-port.test.ts`, is a
 *     `bunx vitest` oracle).
 *   - Every method returns a `Result` for an EXPECTED git failure (nonzero
 *     exit) — never throws. A spawn-level fault (`git` not on PATH) also
 *     resolves to `err`, never rejects the promise.
 *   - `isMerged` handles BOTH a real merge (fast-ancestor path,
 *     `git merge-base --is-ancestor`) AND a squash merge (the tip commit is
 *     never an ancestor after a squash — a synthetic single-commit
 *     equivalence check via `git commit-tree` + `git cherry` is required,
 *     the same algorithm `git-delete-squashed`-style tooling uses).
 *     Empirically verified against a real git repo before landing this file
 *     (unmerged → `git cherry` reports `+<sha>`; squash-merged → `-<sha>`).
 *   - `worktreeList`'s `createdAt` is derived from the worktree DIRECTORY's
 *     filesystem birthtime (`node:fs.statSync`) — real `git worktree list`
 *     carries no creation timestamp of its own; this is a best-effort
 *     approximation, not a git-native fact (mirrors the fake `GitPort`'s own
 *     "fixture-only convenience" framing in the service-layer test suite).
 *   - `ensureSessionTrailerHookInstalled` ONLY EVER writes into a hooks
 *     directory that resolves INSIDE the git directory itself (`.git/hooks`,
 *     or a linked worktree's own private git-dir) — a `core.hooksPath`
 *     pointed OUTSIDE the git dir (this very repo's own checked-in, TRACKED
 *     `hooks/`) is explicitly SKIPPED, never written to: an untracked file
 *     appearing there as a side effect of `lore claim` would dirty the
 *     working tree, which `measureWorktreeCleanliness` (`task-workflow-
 *     service.ts`) would then itself refuse evidence/release over. It also
 *     never clobbers a pre-existing FOREIGN `commit-msg` hook (one lacking
 *     this module's own marker comment) — it reports `"skipped-foreign-hook"`
 *     instead.
 *
 * Side-effect class: IO (child_process subprocess; `worktreeList`'s
 *   `createdAt` derivation additionally does one synchronous `fs.statSync`
 *   per listed worktree; the L0 trailer functions additionally do synchronous
 *   `fs` read/write/chmod calls against the resolved git directory).
 *
 * Source: SPEC-057 §Module Boundary D1, §Structure;
 *   spec-multi-session-concurrency-queryable-ownership-checkout §Scope L0.
 */

import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import type { GitPort, WorktreeInfo } from "../service/seat-service.js";

const GIT_COMMAND = "git";
const STDERR_TAIL_MAX_CHARS = 500;

interface GitRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `git <args>` in `cwd` and resolves with its exit code + captured
 * stdout/stderr — NEVER rejects (an ENOENT/spawn-level fault resolves with
 * `exitCode: -1` and the fault message in `stderr`), so every `RealGitPort`
 * method can uniformly inspect `exitCode` without a separate try/catch.
 */
function runGit(cwd: string, args: string[]): Promise<GitRunResult> {
  return new Promise((resolve) => {
    const child = spawn(GIT_COMMAND, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (cause) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: -1, stdout: "", stderr: cause instanceof Error ? cause.message : String(cause) });
    });

    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}

/** Wraps a failed `GitRunResult` into a `LoreError`, naming the git subcommand + a bounded stderr tail. */
function gitFailure(args: string[], result: GitRunResult): LoreError {
  return {
    code: "STORE_ERROR",
    message: `git ${args.join(" ")} exited ${result.exitCode}: ${result.stderr.slice(0, STDERR_TAIL_MAX_CHARS)}`,
  };
}

/**
 * Parses `git worktree list --porcelain` output into {@link WorktreeInfo}
 * entries. Blocks are separated by a blank line; each block has a
 * `worktree <path>` line, a `HEAD <sha>` line, and either a
 * `branch refs/heads/<name>` line or a bare `detached` line (locked/prunable
 * annotation lines, when present, are ignored — not needed by any
 * `SeatService` consumer).
 */
function parsePorcelainWorktreeList(stdout: string): Array<{ path: string; branch: string | null }> {
  const blocks = stdout.split(/\n\n+/).filter((block) => block.trim().length > 0);
  const entries: Array<{ path: string; branch: string | null }> = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const pathLine = lines.find((line) => line.startsWith("worktree "));
    if (pathLine === undefined) continue;
    const path = pathLine.slice("worktree ".length).trim();

    const branchLine = lines.find((line) => line.startsWith("branch "));
    const branch =
      branchLine !== undefined ? branchLine.slice("branch refs/heads/".length).trim() : null;

    entries.push({ path, branch });
  }

  return entries;
}

// ─── L0 Ownership Binding (spec-multi-session-concurrency-queryable- ────────
// ─── ownership-checkout §Scope L0, AC-OWN-2/AC-OWN-4) ───────────────────────

/**
 * A worktree's current git branch, or the fact that it could not be
 * determined — a discriminated union, NEVER a nullable/empty string
 * (mirrors {@link GitPort}'s sibling module `gate-predicates.ts`'s
 * `SessionComparison`: "not measured" and "known to be absent" are
 * different facts with opposite safe defaults, and collapsing them is
 * exactly the defect this whole task exists to close).
 */
export type BranchMeasurement =
  | { readonly status: "measured"; readonly branch: string }
  | { readonly status: "unmeasured" };

/**
 * Detects `cwd`'s current git branch via `git symbolic-ref --short -q HEAD`
 * — chosen over `git rev-parse --abbrev-ref HEAD` specifically because the
 * latter prints the literal string `"HEAD"` on a detached checkout (a
 * plausible-looking but WRONG branch name), where `symbolic-ref -q` instead
 * exits nonzero with empty output — a clean, unambiguous "not on a branch"
 * signal. NEVER throws: `runGit` itself never rejects (module @invariant),
 * so every failure path here — detached HEAD, a path outside any git work
 * tree, a path that does not exist on disk, `git` absent from PATH — is a
 * plain nonzero exit, uniformly `"unmeasured"`.
 *
 * @param cwd - The worktree path to inspect (typically `ClaimOpts.worktree`
 *   — deliberately NEVER `process.cwd()`, mirroring why `--worktree` itself
 *   stays always-explicit, SPEC-042 D2 review U2).
 * @returns `{status: "measured", branch}` when `cwd` sits on a named branch;
 *   `{status: "unmeasured"}` otherwise.
 * @example
 * await detectWorktreeBranch("/repo"); // => { status: "measured", branch: "main" }
 * @example
 * await detectWorktreeBranch("/tmp/not-a-repo"); // => { status: "unmeasured" }
 */
export async function detectWorktreeBranch(cwd: string): Promise<BranchMeasurement> {
  const result = await runGit(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const branch = result.stdout.trim();
  if (result.exitCode !== 0 || branch.length === 0) {
    return { status: "unmeasured" };
  }
  return { status: "measured", branch };
}

/** Filename of the per-worktree active-claim-session marker, written inside that worktree's OWN private git-dir (never the tracked working tree). */
const CLAIM_SESSION_MARKER_FILENAME = "LORE_SESSION_ID";

/**
 * Records `sessionId` as the ACTIVE claim session for the worktree at `cwd`
 * — writes a plain marker file inside `cwd`'s own private git directory
 * (`git rev-parse --git-dir`, resolved from `cwd`), which for a LINKED
 * worktree is a directory unique to THAT worktree (`<common>/worktrees/
 * <name>`) and for the main checkout is the ordinary `.git` — either way,
 * untracked and never visible to `git status` (so this write can never dirty
 * the working tree `measureWorktreeCleanliness` polices). Overwrites any
 * previous value — the marker is a CURRENT-STATE pointer, not an append log.
 *
 * @param cwd - The worktree path a claim was just taken against.
 * @param sessionId - The claim's captured session instance (already
 *   sanitized via `sessionIdDiscriminator` by the caller).
 * @returns `ok(undefined)` on success; `err` naming the failure — the
 *   caller ({@link bindClaimSessionForTrailer}) treats this as best-effort
 *   and discards the Result, per this module's own doc.
 */
async function writeClaimSessionMarker(cwd: string, sessionId: string): Promise<Result<void, LoreError>> {
  const gitDirResult = await runGit(cwd, ["rev-parse", "--git-dir"]);
  if (gitDirResult.exitCode !== 0) return err(gitFailure(["rev-parse", "--git-dir"], gitDirResult));
  const gitDir = resolve(cwd, gitDirResult.stdout.trim());

  try {
    writeFileSync(join(gitDir, CLAIM_SESSION_MARKER_FILENAME), `${sessionId}\n`, "utf8");
    return ok(undefined);
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message: `failed to write claim session marker in "${gitDir}": ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}

/** First line of the commit-msg hook this module installs — the marker `ensureSessionTrailerHookInstalled` checks for on re-entry/foreign-hook detection. */
const TRAILER_HOOK_MARKER_LINE =
  "# lore-managed: Lore-Session trailer hook — see packages/lore/src/adapters/real-git-port.ts::ensureSessionTrailerHookInstalled";

/** Builds the `commit-msg` hook script content — reads {@link CLAIM_SESSION_MARKER_FILENAME} from the CURRENT worktree's own git-dir at commit time (never the install-time `cwd`, since one shared hook serves every worktree of the repo). */
function buildTrailerHookScript(): string {
  return [
    "#!/bin/sh",
    TRAILER_HOOK_MARKER_LINE,
    `LORE_MARKER="$(git rev-parse --git-dir 2>/dev/null)/${CLAIM_SESSION_MARKER_FILENAME}"`,
    'if [ -f "$LORE_MARKER" ]; then',
    '  LORE_SESSION_ID="$(cat "$LORE_MARKER" 2>/dev/null)"',
    '  if [ -n "$LORE_SESSION_ID" ]; then',
    '    git interpret-trailers --in-place --trailer "Lore-Session: ${LORE_SESSION_ID}" "$1"',
    "  fi",
    "fi",
    "",
  ].join("\n");
}

/** {@link ensureSessionTrailerHookInstalled}'s outcome — a discriminated status, never a boolean, so a caller can tell "already there" from "just installed" from "deliberately skipped" from "skipped because a foreign hook already exists there". */
export type TrailerHookInstallStatus =
  | "installed"
  | "already-installed"
  | "skipped-unsafe-hooks-path"
  | "skipped-foreign-hook"
  | "skipped-not-a-repo";

/**
 * Ensures a `commit-msg` hook that appends the `Lore-Session` trailer (per
 * {@link writeClaimSessionMarker}'s marker) is installed for the repo `cwd`
 * belongs to. See this module's own @invariant for the "only inside the git
 * dir itself" safety rule and the "never clobber a foreign hook" rule.
 *
 * @param cwd - Any worktree of the target repo.
 * @returns `ok(<status>)` — never a hard failure for an ordinary "can't
 *   safely install here" case (those are `ok("skipped-*")`, not `err`);
 *   `err` only for an unexpected filesystem fault while writing.
 */
async function ensureSessionTrailerHookInstalled(
  cwd: string,
): Promise<Result<TrailerHookInstallStatus, LoreError>> {
  const gitDirResult = await runGit(cwd, ["rev-parse", "--git-dir"]);
  if (gitDirResult.exitCode !== 0) return ok("skipped-not-a-repo");
  const gitDir = resolve(cwd, gitDirResult.stdout.trim());

  const hooksPathResult = await runGit(cwd, ["rev-parse", "--git-path", "hooks"]);
  if (hooksPathResult.exitCode !== 0) return ok("skipped-not-a-repo");
  const hooksDir = resolve(cwd, hooksPathResult.stdout.trim());

  // reason: see module @invariant — a `core.hooksPath` pointed outside the
  // git dir (this very repo's own `hooks/`, a TRACKED directory) must never
  // receive a write from this function.
  const hooksDirIsInsideGitDir = hooksDir === gitDir || hooksDir.startsWith(gitDir + sep);
  if (!hooksDirIsInsideGitDir) return ok("skipped-unsafe-hooks-path");

  const hookPath = join(hooksDir, "commit-msg");
  let existing: string | null = null;
  try {
    existing = readFileSync(hookPath, "utf8");
  } catch {
    existing = null; // absent — the common case for a fresh repo
  }

  if (existing !== null) {
    return existing.includes(TRAILER_HOOK_MARKER_LINE) ? ok("already-installed") : ok("skipped-foreign-hook");
  }

  try {
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(hookPath, buildTrailerHookScript(), "utf8");
    chmodSync(hookPath, 0o755);
    return ok("installed");
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message: `failed to install commit-msg hook at "${hookPath}": ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}

/**
 * Best-effort composite (AC-OWN-4): records `sessionId` as the active claim
 * for `worktree` and ensures the shared trailer-appending `commit-msg` hook
 * is installed, so a commit made in `worktree` while this binding is live
 * carries the `Lore-Session: <sessionId>` trailer.
 *
 * NEVER throws and deliberately returns `void`, not a `Result` — this
 * capability is ADVISORY ONLY (mirrors `anchor-resolution.ts`'s "a
 * non-resolving anchor is never a refusal" precedent): an unusual hooks
 * setup (this very repo's OWN `core.hooksPath hooks`), a foreign pre-
 * existing hook, or a missing/unreadable worktree all degrade to a silent
 * no-op here rather than blocking `TaskWorkflowService.claim`'s core
 * contract of persisting `extra.claim`. Both inner Results are deliberately
 * discarded for that reason — see `writeClaimSessionMarker` /
 * `ensureSessionTrailerHookInstalled`'s own JSDoc for what they can report.
 *
 * @param worktree - The worktree path a claim was just taken against.
 * @param sessionId - The claim's captured (sanitized) session instance.
 */
export async function bindClaimSessionForTrailer(worktree: string, sessionId: string): Promise<void> {
  await writeClaimSessionMarker(worktree, sessionId);
  await ensureSessionTrailerHookInstalled(worktree);
}

/**
 * `node:child_process`-backed {@link GitPort}. See module doc for the
 * squash-merge detection algorithm and the `createdAt` best-effort caveat.
 */
export class RealGitPort implements GitPort {
  /**
   * @param repoRoot - Directory `worktreeAdd`/`worktreeList`/`worktreeRemove`/
   *   `isMerged` run `git` from (any worktree of a repo can run
   *   `git worktree`/branch-comparison plumbing against the whole repo).
   *   `rebaseFromMain`/`isDirty` ignore this and use their own `cwd` argument.
   */
  constructor(private readonly repoRoot: string) {}

  async worktreeAdd(path: string, branch: string): Promise<Result<void, LoreError>> {
    const branchExists = await runGit(this.repoRoot, ["rev-parse", "--verify", "--quiet", branch]);
    const args =
      branchExists.exitCode === 0
        ? ["worktree", "add", path, branch]
        : ["worktree", "add", "-b", branch, path];

    const result = await runGit(this.repoRoot, args);
    if (result.exitCode !== 0) return err(gitFailure(args, result));
    return ok(undefined);
  }

  async worktreeList(): Promise<Result<WorktreeInfo[], LoreError>> {
    const args = ["worktree", "list", "--porcelain"];
    const result = await runGit(this.repoRoot, args);
    if (result.exitCode !== 0) return err(gitFailure(args, result));

    const entries = parsePorcelainWorktreeList(result.stdout).map((entry) => {
      // reason: git carries no creation-timestamp fact for a worktree — the
      // directory's own filesystem birthtime is the best available proxy
      // (module @invariant). A stat failure (e.g. a worktree removed
      // out-of-band between listing and stat) degrades to the epoch rather
      // than aborting the whole listing.
      let createdAt = new Date(0).toISOString();
      try {
        createdAt = statSync(entry.path).birthtime.toISOString();
      } catch {
        // reason: see comment above — degrade this ONE entry's timestamp, never the whole list.
      }
      return { path: entry.path, branch: entry.branch, createdAt };
    });

    return ok(entries);
  }

  async worktreeRemove(path: string, force: boolean): Promise<Result<void, LoreError>> {
    const args = force ? ["worktree", "remove", "--force", path] : ["worktree", "remove", path];
    const result = await runGit(this.repoRoot, args);
    if (result.exitCode !== 0) return err(gitFailure(args, result));
    return ok(undefined);
  }

  async isMerged(branch: string, into: string): Promise<Result<boolean, LoreError>> {
    const ancestorArgs = ["merge-base", "--is-ancestor", branch, into];
    const ancestorResult = await runGit(this.repoRoot, ancestorArgs);
    if (ancestorResult.exitCode === 0) return ok(true);
    // reason: exit 1 from `merge-base --is-ancestor` means "not an ancestor"
    // (a real, expected outcome, not a failure) — any OTHER nonzero code
    // (e.g. one of the two refs doesn't resolve) is a genuine git error.
    if (ancestorResult.exitCode !== 1) return err(gitFailure(ancestorArgs, ancestorResult));

    // Squash-merge detection (git-delete-squashed algorithm, empirically
    // verified — see module @invariant): synthesize a single commit carrying
    // `branch`'s tree on top of the merge-base, then ask `git cherry`
    // whether that patch is already equivalent to one in `into`'s history.
    const mergeBaseArgs = ["merge-base", into, branch];
    const mergeBaseResult = await runGit(this.repoRoot, mergeBaseArgs);
    if (mergeBaseResult.exitCode !== 0) {
      // reason: no common ancestor at all between `branch` and `into` —
      // definitively not merged, not a git error.
      return ok(false);
    }
    const mergeBase = mergeBaseResult.stdout.trim();

    const treeArgs = ["rev-parse", `${branch}^{tree}`];
    const treeResult = await runGit(this.repoRoot, treeArgs);
    if (treeResult.exitCode !== 0) return err(gitFailure(treeArgs, treeResult));
    const tree = treeResult.stdout.trim();

    const commitTreeArgs = ["commit-tree", tree, "-p", mergeBase, "-m", "lore-seat-squash-check"];
    const commitTreeResult = await runGit(this.repoRoot, commitTreeArgs);
    if (commitTreeResult.exitCode !== 0) return err(gitFailure(commitTreeArgs, commitTreeResult));
    const syntheticCommit = commitTreeResult.stdout.trim();

    const cherryArgs = ["cherry", into, syntheticCommit];
    const cherryResult = await runGit(this.repoRoot, cherryArgs);
    if (cherryResult.exitCode !== 0) return err(gitFailure(cherryArgs, cherryResult));

    // `git cherry` prefixes an unmerged-patch line with "+" and an
    // already-equivalent (squash-merged) one with "-".
    const hasUnmergedLine = cherryResult.stdout
      .split("\n")
      .some((line) => line.trim().startsWith("+"));
    return ok(!hasUnmergedLine);
  }

  async rebaseFromMain(cwd: string): Promise<Result<void, LoreError>> {
    const upstreamArgs = ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"];
    const upstreamResult = await runGit(cwd, upstreamArgs);
    if (upstreamResult.exitCode !== 0) {
      // reason: no upstream tracking branch configured (a fresh local-only
      // checkout, or this port's own integration-test fixture, which has no
      // remote) — nothing to rebase onto, a no-op success rather than a
      // hard failure (SPEC-057 §Design Decisions D7 "simplest honest
      // semantics" — rebasing main is a best-effort freshness step, not a
      // hard precondition).
      return ok(undefined);
    }

    const rebaseArgs = ["rebase", "@{u}"];
    const rebaseResult = await runGit(cwd, rebaseArgs);
    if (rebaseResult.exitCode !== 0) return err(gitFailure(rebaseArgs, rebaseResult));
    return ok(undefined);
  }

  async isDirty(cwd: string): Promise<Result<boolean, LoreError>> {
    const args = ["status", "--porcelain"];
    const result = await runGit(cwd, args);
    if (result.exitCode !== 0) return err(gitFailure(args, result));
    return ok(result.stdout.trim().length > 0);
  }
}
