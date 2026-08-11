/**
 * Checkout-level oracle mutex (`spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check`,
 * D5 / AC-OX-4) — an advisory, pid-named lock file that serializes `bun run
 * test` so a second concurrent invocation in the SAME checkout fails loud
 * instead of interleaving with the first.
 *
 * ## Why this exists
 *
 * Two Claude sessions were measured sharing one checkout with zero
 * concurrency guard anywhere (`package.json` / `scripts/**`): two concurrent
 * `bun run test` runs interleaved (peer pid 39206 @ 15:32:06, ours 58812 @
 * 15:32:42), each writing the same fixed paths. This lock makes the SECOND
 * such invocation exit exactly 5 and name the pid already holding it, rather
 * than racing.
 *
 * ## Production lock path is CHECKOUT-level, not per-worktree
 *
 * `resolveDefaultLockDir` shells out to `git rev-parse --git-common-dir`,
 * which every linked worktree AND the main checkout resolve to the SAME
 * absolute directory (verified 2026-08-11 from a linked worktree:
 * `/Users/.../lore/.git`, not a per-worktree path). That sharing is the whole
 * point — a per-worktree lock path would compile, pass a naive test, and
 * protect nothing against the measured defect (two runs in ONE checkout,
 * regardless of which worktree each started from).
 *
 * ## Public surface / why `main` returns instead of exiting
 *
 * `main(lockDir?)` attempts to acquire the lock in `lockDir` and RETURNS an
 * exit code — it never calls `process.exit` itself, matching the armable
 * shape `scripts/check-ordinal-write-sites.mjs` documents (three checkers
 * were once structurally inert because `main` neither returned nor was
 * exported). This is what lets `scripts/tests/oracle-lock.test.ts` drive it
 * directly against an injected `mkdtemp` directory — never the real
 * checkout-level path — so a concurrent suite run elsewhere on the machine
 * can never perturb the contention assertions.
 *
 * `releaseLock(lockDir, pid?)` is the other half of the pair: it deletes the
 * lock file iff it currently names `pid` (defaults to `process.pid`), so a
 * process can never delete a lock some OTHER process has since legitimately
 * reclaimed. Side-effect class: both are IO (read/write a single small file);
 * neither is pure, but neither has a side effect at module-load time — only
 * the `import.meta.main` block below runs anything, and only when this file
 * is executed directly.
 *
 * ## Exit codes (`main`)
 *
 *   0 — acquired: no lock existed, OR the existing lock named a pid that is
 *       no longer alive (reclaimed). A mutex that cannot reclaim a stale lock
 *       would be worse than none — it could wedge verification forever.
 *   5 — contended: the lock is held by a LIVE pid. That pid is printed.
 *
 * `main` may THROW if `lockDir` itself cannot be written to (e.g. it does
 * not exist) — an environment problem, not a lock decision — which the CLI
 * shell below maps to exit 4, mirroring the other checkers' "the scan itself
 * failed" convention.
 *
 * ## CLI shell (`import.meta.main`)
 *
 * `bun scripts/oracle-lock.ts <command> [args...]` acquires the lock, then —
 * only if acquisition succeeded — spawns `<command> [args...]` with
 * inherited stdio and BLOCKS until it exits, releasing the lock in a
 * `finally` regardless of the child's outcome (success or failure) before
 * exiting with the child's own exit code. Deliberately the SAME process
 * holds the lock (via its own `process.pid`) for the child's entire
 * lifetime — a short-lived "acquire" subprocess that exited before the real
 * work finished would make its own pid look dead to a second run long before
 * the wrapped command actually completed.
 *
 * Wired onto `package.json`'s `test` script as the outermost layer around the
 * existing `test:vitest && test:bun && check:spec-mirror` chain.
 *
 * Usage:
 *   bun scripts/oracle-lock.ts sh -c "bun run test:vitest && bun run test:bun && bun run check:spec-mirror"
 *
 * CLI exit codes:
 *   0     — the wrapped command ran and exited 0.
 *   1-255 — the wrapped command ran and exited non-zero (its own code, passed through).
 *   4     — usage error (no command given), or the command could not even be
 *           spawned (e.g. not found on PATH) — never confused with a run that
 *           started and failed.
 *   5     — contended: the wrapped command never ran at all.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(__filename, "..", "..");

/** Fixed lock file name inside whichever directory `main`/`releaseLock` are given. */
export const LOCK_FILE_NAME = "lore-oracle-test.lock";

/**
 * Resolves the PRODUCTION lock directory: `git rev-parse --git-common-dir`,
 * normalised to an absolute path (the main checkout reports a path relative
 * to its own root, e.g. `.git`; a linked worktree reports an absolute path
 * straight to the shared directory — `resolve` handles both identically).
 * IO — spawns `git`. Never called by `scripts/tests/oracle-lock.test.ts`,
 * which always injects its own `mkdtemp` directory instead (AC-OX-4's
 * hermetic-test requirement).
 *
 * @throws {Error} if `git rev-parse --git-common-dir` itself fails (e.g. run
 *   outside a git repository) — never silently falls back to a per-worktree
 *   path, which would defeat the whole mechanism.
 */
export function resolveDefaultLockDir(repoRoot: string = REPO_ROOT): string {
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(
      `oracle-lock: "git rev-parse --git-common-dir" failed (status ${result.status}): ${result.stderr ?? "<no stderr>"}`,
    );
  }
  return resolve(repoRoot, result.stdout.trim());
}

/**
 * True iff a process with `pid` is currently alive, probed via the
 * zero-signal `kill(pid, 0)` convention (no signal is actually delivered).
 * `ESRCH` ("no such process") is the only outcome treated as dead; any other
 * failure (most commonly `EPERM` — the process exists but is owned by
 * another user) is treated as alive, since the mutex's job is only to avoid
 * colliding with a REAL running holder, never to distinguish "alive" from
 * "alive and inspectable by me".
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Reads the pid recorded in `lockFilePath`, or `null` if the file is
 * missing, empty, or does not contain a positive integer. A `null` result is
 * treated by `main` as "no verifiable live holder" — i.e. reclaimable —
 * rather than a parse error, matching D5's "fail-loud-and-reclaimable, never
 * fail-closed": a corrupted lock file must never wedge verification forever.
 */
function readLockPid(lockFilePath: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(lockFilePath, "utf8").trim();
  } catch {
    return null;
  }
  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Attempts to atomically create `lockFilePath` naming `pid`, using the
 * `"wx"` flag (`O_CREAT | O_EXCL`) so two processes racing this exact call
 * can never both believe they created it fresh. Returns `true` on a fresh
 * create, `false` iff the file already existed (`EEXIST`) — any OTHER
 * failure (e.g. `lockDir` missing -> `ENOENT`) propagates as a thrown error,
 * per this module's "environment problem, not a lock decision" contract.
 */
function tryCreateLockFile(lockFilePath: string, pid: number): boolean {
  try {
    writeFileSync(lockFilePath, String(pid), { flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

/**
 * Attempts to acquire the oracle mutex in `lockDir`, defaulting to the real,
 * checkout-level `git rev-parse --git-common-dir` path (see
 * `resolveDefaultLockDir`). Returns the exit code directly — never calls
 * `process.exit` (module header, "Public surface").
 *
 * @param lockDir directory the lock file lives in. Tests MUST inject an
 *   isolated `mkdtemp` directory here — the default expression is only
 *   evaluated when the caller omits the argument entirely, so a hermetic
 *   test never triggers the real `git` subprocess call.
 * @returns `0` if freshly acquired or reclaimed from a dead holder; `5` if a
 *   live pid already holds it (its pid is printed to stderr).
 * @throws {Error} if `lockDir` cannot be written to at all (e.g. it does not
 *   exist) — an environment failure distinct from a lock DECISION.
 */
export function main(lockDir: string = resolveDefaultLockDir()): number {
  const lockFilePath = join(lockDir, LOCK_FILE_NAME);
  const pid = process.pid;

  if (tryCreateLockFile(lockFilePath, pid)) {
    console.log(`oracle-lock: acquired (pid ${pid}) at ${lockFilePath}`);
    return 0;
  }

  const holderPid = readLockPid(lockFilePath);
  if (holderPid !== null && isPidAlive(holderPid)) {
    console.error(
      `oracle-lock: contended — another oracle run holds ${lockFilePath} (pid ${holderPid}, still alive). ` +
        `Wait for it to finish, or investigate pid ${holderPid} if it appears stuck.`,
    );
    return 5;
  }

  // Stale (holder pid no longer alive) or unparseable content -- reclaim
  // rather than wedge. This overwrite is NOT wrapped in the same "wx" atomicity
  // as the fresh-create path above; that is an accepted, narrow race inherent
  // to an advisory (non-flock) lock, matching the "advisory lock" language in
  // the governing spec.
  writeFileSync(lockFilePath, String(pid));
  console.log(
    `oracle-lock: reclaimed stale lock at ${lockFilePath} (previous holder pid ${holderPid ?? "<unparseable>"} is no longer alive; now held by pid ${pid})`,
  );
  return 0;
}

/**
 * Releases the lock in `lockDir` iff it currently names `pid` (defaults to
 * `process.pid`). A no-op if the lock file is already gone. Deliberately
 * refuses to delete a lock file naming a DIFFERENT pid — that would mean
 * some other process has since legitimately reclaimed it, and deleting it
 * out from under that process would reopen the exact race this module
 * exists to close.
 */
export function releaseLock(lockDir: string, pid: number = process.pid): void {
  const lockFilePath = join(lockDir, LOCK_FILE_NAME);
  const currentHolder = readLockPid(lockFilePath);
  if (currentHolder === null) return;
  if (currentHolder !== pid) {
    console.error(
      `oracle-lock: NOT releasing ${lockFilePath} -- it now names pid ${currentHolder}, not this process's pid ${pid} (someone else must have reclaimed it).`,
    );
    return;
  }
  rmSync(lockFilePath, { force: true });
}

/**
 * `import.meta.main` is Node >= 24.2 (and every Bun release). Guarding on it
 * ALONE would leave this CLI silently INERT under an older Node — no output,
 * exit 0, indistinguishable from success. The portable `process.argv[1]`
 * comparison is the fallback whenever the property is `undefined`, never
 * when it is a real `false` (an import) -- same convention as
 * `scripts/check-ordinal-write-sites.mjs`.
 */
const isDirectRun = import.meta.main ?? resolve(process.argv[1] ?? "") === __filename;

if (isDirectRun) {
  const commandArgs = process.argv.slice(2);
  if (commandArgs.length === 0) {
    console.error("oracle-lock: usage: bun scripts/oracle-lock.ts <command> [args...]");
    process.exit(4);
  }

  let lockDir: string;
  try {
    lockDir = resolveDefaultLockDir();
  } catch (e) {
    console.error(`oracle-lock: could not resolve the checkout-level lock directory -- ${e instanceof Error ? e.message : String(e)}`);
    process.exit(4);
  }

  let acquireResult: number;
  try {
    acquireResult = main(lockDir);
  } catch (e) {
    console.error(`oracle-lock: acquire failed -- ${e instanceof Error ? e.message : String(e)}`);
    process.exit(4);
  }

  if (acquireResult !== 0) {
    process.exit(acquireResult);
  }

  const [command, ...args] = commandArgs;
  let childExitCode: number;
  try {
    const result = spawnSync(command as string, args, { stdio: "inherit" });
    if (result.error) {
      console.error(`oracle-lock: failed to spawn "${command}" -- ${result.error.message}`);
      childExitCode = 4;
    } else if (result.status !== null) {
      childExitCode = result.status;
    } else {
      // Terminated by a signal (result.status is null in that case) -- never
      // silently reported as success.
      console.error(`oracle-lock: "${command}" was terminated by signal ${result.signal ?? "<unknown>"}`);
      childExitCode = 1;
    }
  } finally {
    releaseLock(lockDir);
  }
  process.exit(childExitCode);
}
