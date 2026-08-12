/**
 * Real `GitPort` (SPEC-057 §Module Boundary D1 port implementation) — shells
 * `git` via `node:child_process.spawn` for every `SeatService` operation.
 * Mirrors `real-mcp-registrar.ts`'s "port implementation, adapter layer"
 * placement and its `node:child_process`-not-`Bun.spawn` invariant.
 *
 * Also the L0 ownership-binding git port (spec-multi-session-concurrency-
 * queryable-ownership-checkout §Scope L0, AC-OWN-2/AC-OWN-4) — five
 * standalone exported functions, deliberately NOT methods on `RealGitPort`
 * (they need no `repoRoot` state; every caller passes its own `cwd`).
 * `detectWorktreeBranch`/`bindClaimSessionForTrailer`/
 * `unbindClaimSessionForTrailer` are consumed by `TaskWorkflowService.claim`'s
 * injectable `detectBranch`/`installClaimTrailerBinding` ports (their real,
 * default implementations — see that service's constructor JSDoc for why a
 * service importing a concrete adapter function is a deliberate, narrow
 * exception here: branch detection / trailer binding are leaf IO capabilities
 * with no OTHER service dependency, so there is no `app.ts` composition-root
 * wiring to route through — mirrors `measureWorktreeCleanliness`'s own
 * pre-existing ad hoc `git` subprocess calls inside that same service file,
 * just consolidated behind an injectable, fake-able seam instead of inlined
 * there again). `countUnmergedCommitsSync`/`listLocalBranches` are instead
 * consumed directly by `adapters/cli/territory-partition.ts::partitionTerritory`
 * (via its own caller, `adapters/cli/commands/territory.ts`), which needs no
 * injectable seam of its own — see each function's own doc below.
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
 *   - listLocalBranches(cwd) — AC-OWN-1's discovery source (c)
 *     (`adapters/cli/territory-partition.ts`'s own §Invariants): every LOCAL
 *     branch name in the repo `cwd` belongs to (`git for-each-ref
 *     --format=%(refname:short) refs/heads/`), independent of what `cwd`'s
 *     HEAD currently points to — a DETACHED HEAD does not shrink this list,
 *     unlike {@link detectWorktreeBranch}'s own "unmeasured" answer for that
 *     same checkout state. `undefined` when enumeration could not be
 *     performed at all (never coerced to `[]`, mirroring
 *     `BranchMeasurement`'s discipline); `[]` is reserved for a genuinely
 *     branch-less repo, a MEASURED fact. The ONE producer for
 *     `adapters/cli/territory-partition.ts::partitionTerritory`'s optional
 *     4th `localBranches` parameter, threaded through by its ONE caller,
 *     `adapters/cli/commands/territory.ts`.
 *   - countUnmergedCommitsSync(cwd, branch, into) — AC-REPLAY-1: the
 *     SYNCHRONOUS counterpart to `RealGitPort.countUnmergedCommits`, a
 *     standalone leaf function for the ONE consumer
 *     (`adapters/cli/territory-partition.ts::partitionTerritory`) that must
 *     stay callable without `await`. `execFileSync`, not `runGit`'s async
 *     `spawn`, for that reason alone — same git invocation and the same
 *     "never `0` for an uncountable branch" contract as the async method
 *     (shared `unmergedCountArgs`/`parseUnmergedCount` helpers, ONE
 *     definition of the git command and its output shape).
 *   - bindClaimSessionForTrailer(cwd, sessionId) — AC-OWN-4: best-effort
 *     composite of `writeClaimSessionMarker` + `ensureSessionTrailerHookInstalled`
 *     (both private) — records `sessionId` as the worktree's active claim and
 *     ensures the shared `commit-msg` hook that reads it is installed, so a
 *     commit made in `cwd` while the binding is live carries the
 *     `Lore-Session: <sessionId>` git trailer. Deliberately swallows both
 *     calls' Results and returns `void` — see its own doc for why this
 *     capability is advisory-only, mirroring `anchor-resolution.ts`'s
 *     "a non-resolving anchor is never a refusal" precedent.
 *   - unbindClaimSessionForTrailer(cwd, sessionId) — the release-side
 *     counterpart (task-the-lore-session-trailer-is-inert-whenever-core-
 *     hookspath): a compare-and-delete clear of the marker
 *     {@link writeClaimSessionMarker} wrote, so a worktree whose claim was
 *     released stops attributing LATER commits to the released session.
 *     Same advisory, never-throws, `void`-returning shape.
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
 *   - `countUnmergedCommits`/`countUnmergedCommitsSync` never resolve `0`
 *     for a branch or base ref that does not exist, nor for a `cwd` outside
 *     any git work tree — those are `err`. `0` is reserved for a git call
 *     that genuinely SUCCEEDED with an empty range (a real merged branch).
 *   - `worktreeList`'s `createdAt` is derived from the worktree DIRECTORY's
 *     filesystem birthtime (`node:fs.statSync`) — real `git worktree list`
 *     carries no creation timestamp of its own; this is a best-effort
 *     approximation, not a git-native fact (mirrors the fake `GitPort`'s own
 *     "fixture-only convenience" framing in the service-layer test suite).
 *   - `ensureSessionTrailerHookInstalled` writes into a hooks directory that
 *     resolves EITHER inside the git directory itself (`.git/hooks`, or a
 *     linked worktree's own private git-dir — the historical, always-safe
 *     case) OR inside a KNOWN working tree of this same repo (main checkout
 *     or any linked worktree, per `git worktree list --porcelain`) — the
 *     latter is task-the-lore-session-trailer-is-inert-whenever-core-
 *     hookspath's Direction 1 fix: a `core.hooksPath` pointed OUTSIDE the
 *     git dir but INSIDE the repo (this very repo's own checked-in, TRACKED
 *     `hooks/`, per `hooks/pre-push` + root CLAUDE.md's own `git config
 *     core.hooksPath hooks` instruction) is no longer an automatic, silent
 *     no-op — a capability that never fires for the exact configuration it
 *     ships with is worse than an absent one, because AC-OWN-4's
 *     attestation would otherwise certify an unreachable capability. The
 *     working-tree branch registers the hook's path in the repo's shared,
 *     untracked, per-clone `$GIT_COMMON_DIR/info/exclude` (see
 *     `registerHookPathAsLocallyExcluded`) BEFORE writing the file, so the
 *     new file never appears as untracked to `git status` — the exact
 *     dirtying `measureWorktreeCleanliness` (`task-workflow-service.ts`)
 *     would otherwise refuse evidence/release over. A `core.hooksPath`
 *     resolving OUTSIDE every known working tree of the repo entirely (a
 *     machine-global directory, unrelated to this checkout) is STILL
 *     refused (`"skipped-unsafe-hooks-path"`) — this function's write
 *     blast-radius stays bounded to the repo, never machine-wide. It also
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

import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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

/** Builds the `git rev-list --count <into>..<branch>` argv — shared by {@link RealGitPort.countUnmergedCommits} (async) and {@link countUnmergedCommitsSync} so the exact git invocation has ONE definition. */
function unmergedCountArgs(branch: string, into: string): string[] {
  return ["rev-list", "--count", `${into}..${branch}`];
}

/**
 * Parses `git rev-list --count`'s stdout into a non-negative integer, or
 * `err` when it is not one — defensive: a successful exit with unparsable
 * stdout would otherwise silently become `0` via `Number.parseInt`, exactly
 * the "uncountable ≠ zero" collapse `countUnmergedCommits` exists to avoid.
 */
function parseUnmergedCount(stdout: string, args: string[], cwd: string): Result<number, LoreError> {
  const trimmed = stdout.trim();
  if (!/^\d+$/.test(trimmed)) {
    return err({
      code: "STORE_ERROR",
      message: `git ${args.join(" ")} in "${cwd}" produced a non-numeric count: "${trimmed}"`,
    });
  }
  return ok(Number.parseInt(trimmed, 10));
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

/**
 * Enumerates every LOCAL branch name in the repo `cwd` belongs to, via `git
 * for-each-ref --format=%(refname:short) refs/heads/` — AC-OWN-1's discovery
 * source (c) (`adapters/cli/territory-partition.ts`'s own §Invariants): a
 * branch that is NEITHER a worktree's current branch NOR named by any
 * session's claim was, before this function existed, invisible to
 * `partitionTerritory` entirely and silently dropped.
 *
 * Deliberately independent of {@link detectWorktreeBranch}: `refs/heads/`
 * lists every local branch regardless of what (if anything) `cwd`'s HEAD
 * currently points to, so a DETACHED HEAD — which makes
 * {@link detectWorktreeBranch} report `"unmeasured"` — does NOT shrink this
 * function's result at all; it answers "what branches exist", never "what
 * is currently checked out".
 *
 * NEVER throws — `runGit` itself never rejects (module @invariant). Every
 * failure path (`cwd` outside any git work tree, a broken git-directory
 * pointer, `git` absent from `PATH`, any other `for-each-ref` fault)
 * degrades uniformly to `undefined`, mirroring {@link BranchMeasurement}'s
 * "not-measured ≠ known-absent" discipline: a repo that genuinely has ZERO
 * local branches (e.g. freshly `git init`'d, no commit yet — `refs/heads/`
 * has no members) is a MEASURED empty list (`[]`), a different fact from
 * enumeration never having succeeded at all (`undefined`). The caller
 * (`adapters/cli/commands/territory.ts`) MUST preserve this distinction —
 * collapsing a failed enumeration to `[]` before it reaches
 * `partitionTerritory`'s `localBranches` parameter would silently
 * reintroduce the exact defect this function exists to close.
 *
 * @param cwd - Any worktree path of the target repo — local branches are
 *   visible repo-wide from every worktree sharing one `.git` (mirrors
 *   {@link countUnmergedCommitsSync}'s identical "any known worktree" note).
 * @returns Every local branch's short name (e.g. `"feat/x"`, never
 *   `"refs/heads/feat/x"`), in git's own listing order; `[]` for a
 *   genuinely branch-less repo; `undefined` when enumeration could not be
 *   performed at all.
 * @example
 * await listLocalBranches("/repo"); // => ["main", "feat/x"]
 * @example
 * await listLocalBranches("/tmp/not-a-repo"); // => undefined
 */
export async function listLocalBranches(cwd: string): Promise<readonly string[] | undefined> {
  const result = await runGit(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
  if (result.exitCode !== 0) return undefined;
  const trimmed = result.stdout.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split("\n");
}

/**
 * SYNCHRONOUS counterpart to {@link RealGitPort.countUnmergedCommits} — a
 * standalone, repo-root-less leaf function (mirrors {@link
 * detectWorktreeBranch}'s "no `SeatService`/`GitPort` dependency, every
 * caller passes its own `cwd`" shape). Exists because
 * `adapters/cli/territory-partition.ts::partitionTerritory` must stay
 * callable WITHOUT `await` (both its callers — `commands/territory.ts` and
 * the AC-REPLAY-1 replay test — assign its return value directly, never
 * `await partitionTerritory(...)`) — the async, `spawn`-based
 * {@link RealGitPort.countUnmergedCommits} cannot be used from there.
 *
 * @param cwd - ANY worktree path of the target repo — git branches are
 *   visible repo-wide from every worktree sharing one `.git`, so this need
 *   NOT be a worktree currently checked out to `branch` itself.
 * @param branch - The branch to count commits FROM.
 * @param into - The base ref to count commits NOT reachable from (mirrors
 *   `SeatService`'s own `SEAT_BASE_BRANCH` convention of an explicit,
 *   caller-supplied base rather than one hardcoded in the port).
 * @returns `ok(<non-negative integer>)` when git resolves BOTH refs from
 *   `cwd`; `err` for every other case (a nonexistent `branch`, a
 *   nonexistent `into`, `cwd` outside any git work tree, `git` absent from
 *   `PATH`) — NEVER `ok(0)` for an uncountable branch.
 * @example
 * countUnmergedCommitsSync("/repo", "foreign-branch", "main"); // => { ok: true, value: 1 }
 * @example
 * countUnmergedCommitsSync("/repo", "no-such-branch", "main"); // => { ok: false, error: {...} }
 */
export function countUnmergedCommitsSync(cwd: string, branch: string, into: string): Result<number, LoreError> {
  const args = unmergedCountArgs(branch, into);
  try {
    const stdout = execFileSync(GIT_COMMAND, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return parseUnmergedCount(stdout, args, cwd);
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message: `git ${args.join(" ")} in "${cwd}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}

/** Filename of the per-worktree active-claim-session marker, written inside that worktree's OWN private git-dir (never the tracked working tree). */
const CLAIM_SESSION_MARKER_FILENAME = "LORE_SESSION_ID";

/**
 * Resolves `cwd`'s own git directory (`git rev-parse --git-dir`, made
 * absolute) — the ONE definition of this resolution shared by
 * {@link writeClaimSessionMarker}, {@link unbindClaimSessionForTrailer} and
 * {@link ensureSessionTrailerHookInstalled}, so a future change to how a git
 * directory is located (or how its failure is reported) never needs to be
 * kept in sync across three copies.
 *
 * @param cwd - Any worktree path to resolve the git directory of (also the
 *   directory `git` itself is spawned from).
 * @param resolveBase - The base the RELATIVE git output is resolved
 *   against — defaults to `cwd` (byte-identical to every pre-existing
 *   caller's behavior). `ensureSessionTrailerHookInstalled` passes `cwd`'s
 *   OWN realpath instead, so its result stays comparable against
 *   `git worktree list --porcelain`'s realpath-canonicalized output — see
 *   that function's inline comment for why the two would otherwise diverge
 *   on a symlinked temp dir (e.g. macOS's `$TMPDIR`).
 * @returns `ok(<absolute path>)`, or `err` when `cwd` is not inside any git
 *   work tree (or `git` is absent from `PATH`).
 */
async function resolveGitDir(cwd: string, resolveBase: string = cwd): Promise<Result<string, LoreError>> {
  const result = await runGit(cwd, ["rev-parse", "--git-dir"]);
  if (result.exitCode !== 0) return err(gitFailure(["rev-parse", "--git-dir"], result));
  return ok(resolve(resolveBase, result.stdout.trim()));
}

/**
 * Records `sessionId` as the ACTIVE claim session for the worktree at `cwd`
 * — writes a plain marker file inside `cwd`'s own private git directory
 * (resolved via {@link resolveGitDir}), which for a LINKED worktree is a
 * directory unique to THAT worktree (`<common>/worktrees/<name>`) and for
 * the main checkout is the ordinary `.git` — either way, untracked and never
 * visible to `git status` (so this write can never dirty the working tree
 * `measureWorktreeCleanliness` polices). Overwrites any previous value — the
 * marker is a CURRENT-STATE pointer, not an append log; see
 * {@link unbindClaimSessionForTrailer} for its release-side counterpart.
 *
 * @param cwd - The worktree path a claim was just taken against.
 * @param sessionId - The claim's captured session instance (already
 *   sanitized via `sessionIdDiscriminator` by the caller).
 * @returns `ok(undefined)` on success; `err` naming the failure — the
 *   caller ({@link bindClaimSessionForTrailer}) treats this as best-effort
 *   and discards the Result, per this module's own doc.
 */
async function writeClaimSessionMarker(cwd: string, sessionId: string): Promise<Result<void, LoreError>> {
  const gitDirResult = await resolveGitDir(cwd);
  if (!gitDirResult.ok) return gitDirResult;
  const gitDir = gitDirResult.value;

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

/**
 * Clears the ACTIVE claim marker {@link writeClaimSessionMarker} wrote at
 * `cwd` — the release-side counterpart closing the "second defect in the
 * same mechanism" named by task-the-lore-session-trailer-is-inert-whenever-
 * core-hookspath: the marker was a current-state pointer with NO clearing
 * path on release, so every commit made in that worktree AFTER a release
 * kept carrying the released session's now-stale trailer.
 *
 * Compare-and-delete, DELIBERATELY never an unconditional delete: removes
 * the marker ONLY when its content matches `sessionId` exactly. A worktree
 * can be re-claimed — a different task, or the same task under a fresh
 * session — before the ORIGINAL claim's release call reaches this function;
 * `writeClaimSessionMarker`'s own overwrite-on-re-claim behaviour (see
 * AC-OWN-4's STATE test) means the marker may already carry a NEWER
 * session's id by the time a stale release finally runs. Blindly deleting it
 * then would erase a live, unrelated claim's binding — exactly the kind of
 * cross-contamination AC-OWN-4's BOUNDARY case already guards against on the
 * WRITE side. A mismatch, or an already-absent marker, is therefore a benign
 * no-op here, never a failure.
 *
 * NEVER throws and returns `void`, not a `Result` — mirrors
 * {@link bindClaimSessionForTrailer}'s advisory-only shape: an unreadable
 * marker, an unwritable git dir, or a `cwd` that no longer resolves to a
 * git work tree all degrade to a silent no-op rather than blocking whatever
 * lifecycle step (release) triggered this call.
 *
 * ⛔ Not yet wired into `TaskWorkflowService.release` — that requires an
 * edit to `task-workflow-service.ts`, outside this module's own file, and
 * outside task-the-lore-session-trailer-is-inert-whenever-core-hookspath's
 * declared anchor (`real-git-port.ts` only). Until a follow-up task adds the
 * injected-port call symmetric to `installClaimTrailerBinding`'s existing
 * `_claimImpl` call site, this exported capability is correct and covered
 * (`lore-session-trailer.bun.test.ts`'s RELEASE cases exercise it directly)
 * but not yet reachable through `lore release`.
 *
 * @param cwd - The worktree path the claim being released was bound to
 *   (`TaskClaim.worktree` at release time).
 * @param sessionId - The RELEASED claim's own captured (sanitized) session
 *   instance — never the releasing caller's current session, which may
 *   differ from the claim being released (e.g. a `--force` release by a
 *   different actor).
 */
export async function unbindClaimSessionForTrailer(cwd: string, sessionId: string): Promise<void> {
  const gitDirResult = await resolveGitDir(cwd);
  if (!gitDirResult.ok) return;
  const markerPath = join(gitDirResult.value, CLAIM_SESSION_MARKER_FILENAME);

  let existing: string;
  try {
    existing = readFileSync(markerPath, "utf8");
  } catch {
    return; // reason: no marker to clear — already absent, a benign no-op (see @doc).
  }

  if (existing.trim() !== sessionId) return; // reason: see @doc — a newer/different claim now owns this marker.

  try {
    unlinkSync(markerPath);
  } catch {
    /* best-effort — see @doc, this whole capability is advisory */
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

/**
 * Marker comment placed above every pattern this module appends to
 * `info/exclude` — lets {@link registerHookPathAsLocallyExcluded}'s
 * idempotency check, and a human reading the file, tell these LORE-managed
 * lines apart from any pre-existing, hand-written exclude the user already
 * had (never touched, never reordered, only appended after).
 */
const EXCLUDE_MARKER_LINE =
  "# lore-managed: Lore-Session trailer hook path — see packages/lore/src/adapters/real-git-port.ts::registerHookPathAsLocallyExcluded";

/**
 * Appends `hooksDir`'s `commit-msg` hook path to the repo's shared,
 * untracked `$GIT_COMMON_DIR/info/exclude` (git-ignore syntax; this repo's
 * OWN checked-in `.git/info/exclude` already carries the identical pattern
 * for `.claude/worktrees/` etc — an established local-exclude precedent,
 * not a new mechanism) — idempotent (never duplicates the same line across
 * repeat claims) and strictly additive (never rewrites or reorders any
 * PRE-EXISTING line, including a user's own hand-written excludes).
 * `info/exclude` is COMMON-dir-scoped (shared by every worktree, unlike
 * `HEAD`/`index`), so ONE registration protects `git status` in every
 * worktree that shares this repo's `core.hooksPath`.
 *
 * @param cwd - Any worktree of the target repo (used only to resolve
 *   `git rev-parse --git-common-dir`).
 * @param worktreeRoot - The specific known-worktree root `hooksDir` resolves
 *   inside (one of {@link parsePorcelainWorktreeList}'s entries) — the
 *   pattern is written RELATIVE to this root, since a shared `info/exclude`
 *   is interpreted per-worktree, against EACH worktree's own top level.
 * @param hooksDir - The absolute hooks directory the `commit-msg` file will
 *   be written into (guaranteed by the caller to be inside `worktreeRoot`).
 * @returns `ok(undefined)` once the pattern is present (freshly added or
 *   already there); `err` only for an unexpected filesystem/`git` fault —
 *   the caller treats that as a reason to SKIP the install, never to
 *   install anyway with the dirtying risk unmitigated.
 */
async function registerHookPathAsLocallyExcluded(
  cwd: string,
  worktreeRoot: string,
  hooksDir: string,
): Promise<Result<void, LoreError>> {
  const commonDirResult = await runGit(cwd, ["rev-parse", "--git-common-dir"]);
  if (commonDirResult.exitCode !== 0) {
    return err(gitFailure(["rev-parse", "--git-common-dir"], commonDirResult));
  }
  const commonDir = resolve(cwd, commonDirResult.stdout.trim());
  const excludeFilePath = join(commonDir, "info", "exclude");

  const relativeHookPath = join(hooksDir, "commit-msg").slice(worktreeRoot.length + 1);
  const pattern = `/${relativeHookPath.split(sep).join("/")}`;

  try {
    let existing = "";
    try {
      existing = readFileSync(excludeFilePath, "utf8");
    } catch {
      existing = ""; // reason: a from-scratch repo may not have this file populated yet.
    }
    if (existing.split("\n").includes(pattern)) return ok(undefined); // reason: idempotent — already registered.

    mkdirSync(join(commonDir, "info"), { recursive: true });
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    writeFileSync(excludeFilePath, `${existing}${separator}${EXCLUDE_MARKER_LINE}\n${pattern}\n`, "utf8");
    return ok(undefined);
  } catch (cause) {
    return err({
      code: "STORE_ERROR",
      message: `failed to register "${pattern}" in "${excludeFilePath}": ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}

/** {@link ensureSessionTrailerHookInstalled}'s outcome — a discriminated status, never a boolean, so a caller can tell "already there" from "just installed" from "deliberately skipped" from "skipped because a foreign hook already exists there" from "skipped because the dirtying-prevention step itself failed". */
export type TrailerHookInstallStatus =
  | "installed"
  | "already-installed"
  | "skipped-unsafe-hooks-path"
  | "skipped-foreign-hook"
  | "skipped-not-a-repo"
  | "skipped-exclude-write-failed";

/**
 * Ensures a `commit-msg` hook that appends the `Lore-Session` trailer (per
 * {@link writeClaimSessionMarker}'s marker) is installed for the repo `cwd`
 * belongs to. See this module's own @invariant for the "inside the git dir,
 * OR inside a known working tree of this repo" safety rule and the "never
 * clobber a foreign hook" rule.
 *
 * @param cwd - Any worktree of the target repo.
 * @returns `ok(<status>)` — never a hard failure for an ordinary "can't
 *   safely install here" case (those are `ok("skipped-*")`, not `err`);
 *   `err` only for an unexpected filesystem fault while writing.
 */
async function ensureSessionTrailerHookInstalled(
  cwd: string,
): Promise<Result<TrailerHookInstallStatus, LoreError>> {
  // reason: `git worktree list --porcelain`'s own path output is REALPATH-
  // canonicalized by git (symlink components resolved) — e.g. macOS's
  // `$TMPDIR` resolves through a `/var` -> `/private/var` symlink, so a
  // caller-supplied `cwd` under it and git's own reported worktree root
  // would otherwise be two DIFFERENT strings naming the SAME directory,
  // making every `startsWith` prefix check below silently false. Resolving
  // `gitDir`/`hooksDir` against `cwd`'s OWN realpath (never its raw,
  // possibly-symlinked form) keeps them comparable against `knownRoots`
  // byte-for-byte. A `cwd` that does not exist on disk degrades to the
  // same `"skipped-not-a-repo"` the subsequent git calls would ALSO have
  // produced — checked first here only because it is the cheaper test.
  let canonicalCwd: string;
  try {
    canonicalCwd = realpathSync(cwd);
  } catch {
    return ok("skipped-not-a-repo");
  }

  const gitDirResult = await resolveGitDir(cwd, canonicalCwd);
  if (!gitDirResult.ok) return ok("skipped-not-a-repo");
  const gitDir = gitDirResult.value;

  const hooksPathResult = await runGit(cwd, ["rev-parse", "--git-path", "hooks"]);
  if (hooksPathResult.exitCode !== 0) return ok("skipped-not-a-repo");
  const hooksDir = resolve(canonicalCwd, hooksPathResult.stdout.trim());

  const hooksDirIsInsideGitDir = hooksDir === gitDir || hooksDir.startsWith(gitDir + sep);

  if (!hooksDirIsInsideGitDir) {
    // reason: task-the-lore-session-trailer-is-inert-whenever-core-hookspath,
    // Direction 1 — see module @invariant for the full rationale. Safe to
    // install ONLY when hooksDir resolves inside a KNOWN working tree of
    // THIS repo (reusing `parsePorcelainWorktreeList`, the SAME parser
    // `RealGitPort.worktreeList` already uses — ONE definition of "what
    // counts as a working tree of this repo"). A hooksPath resolving
    // outside every known working tree is still refused.
    const worktreeListResult = await runGit(cwd, ["worktree", "list", "--porcelain"]);
    if (worktreeListResult.exitCode !== 0) return ok("skipped-unsafe-hooks-path");
    const knownRoots = parsePorcelainWorktreeList(worktreeListResult.stdout).map((entry) =>
      resolve(canonicalCwd, entry.path),
    );
    const hooksDirRoot = knownRoots.find((root) => hooksDir === root || hooksDir.startsWith(root + sep));
    if (hooksDirRoot === undefined) return ok("skipped-unsafe-hooks-path");

    // reason: neutralise the "new untracked file in a tracked directory"
    // dirtying BEFORE that file ever exists — see @doc on
    // `registerHookPathAsLocallyExcluded`. A failure here means we cannot
    // guarantee `git status` stays clean, so we skip the install rather
    // than install anyway and silently risk dirtying the tree.
    const excludeResult = await registerHookPathAsLocallyExcluded(cwd, hooksDirRoot, hooksDir);
    if (!excludeResult.ok) return ok("skipped-exclude-write-failed");
  }

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
 * non-resolving anchor is never a refusal" precedent): a hooksPath resolving
 * OUTSIDE every known working tree of the repo (a machine-global directory
 * unrelated to this checkout — no longer this repo's own `core.hooksPath
 * hooks`, which `ensureSessionTrailerHookInstalled` now installs into, see
 * its own JSDoc), a foreign pre-existing hook, or a missing/unreadable
 * worktree all degrade to a silent no-op here rather than blocking
 * `TaskWorkflowService.claim`'s core contract of persisting `extra.claim`.
 * Both inner Results are deliberately discarded for that reason — see
 * `writeClaimSessionMarker` / `ensureSessionTrailerHookInstalled`'s own
 * JSDoc for what they can report.
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

  async countUnmergedCommits(branch: string, into: string): Promise<Result<number, LoreError>> {
    const args = unmergedCountArgs(branch, into);
    const result = await runGit(this.repoRoot, args);
    if (result.exitCode !== 0) return err(gitFailure(args, result));
    return parseUnmergedCount(result.stdout, args, this.repoRoot);
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
