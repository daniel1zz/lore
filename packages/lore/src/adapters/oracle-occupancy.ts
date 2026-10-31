/**
 * Read-only reader of the checkout-level oracle lock protocol (SPEC-143 AC-CT-8).
 *
 * Purpose: tell `lore verify`'s stamp step whether a PEER currently holds the checkout-level
 * oracle mutex, without ever creating, reclaiming or deleting it.
 * Public surface: {@link ORACLE_LOCK_FILE_NAME}, {@link resolveOracleLockDir},
 * {@link probeOccupancy}, {@link isPidAlive}.
 * Invariants: READ-ONLY (never writes the lock file); `scripts/oracle-lock.ts` is the WRITER and
 * imports its name, directory resolution and liveness probe FROM HERE, so reader and writer cannot
 * disagree about the lock path (AC-CT-8 half d). This file lives under `packages/` because the
 * compiled binary imports nothing from `scripts/`.
 * Side-effect class: IO (spawns `git rev-parse --git-common-dir`, reads one small file).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Fixed lock file name inside the checkout-level lock directory (the ONE definition; the writer imports it). */
export const ORACLE_LOCK_FILE_NAME = "lore-oracle-test.lock";

/** Outcome of reading the lock: free, held by a live pid, or unmeasurable (never guessed as free). */
export type OccupancyProbe =
  | { readonly kind: "free" }
  | {
      readonly kind: "held";
      readonly holder_pid: number;
      readonly lock_path: string;
      /**
       * Realpath of the worktree the holder runs in (second line of the lock file). ABSENT for a lock written by an
       * older writer (pid only): its location is unknown, which callers must read as "held everywhere" (BR-1512, D3).
       */
      readonly holder_worktree?: string;
    }
  | { readonly kind: "unmeasured"; readonly reason: string };

/**
 * The lock file's content: the holder's pid on the first line, its worktree root on the second (omitted = old format).
 * ONE definition shared with the writer so the two cannot disagree about the format.
 */
export function formatOracleLock(pid: number, holderWorktree?: string): string {
  return holderWorktree === undefined ? String(pid) : `${String(pid)}\n${holderWorktree}`;
}

/**
 * Resolves the CHECKOUT-level lock directory: `git rev-parse --git-common-dir` from `repoRoot`,
 * made absolute (every linked worktree and the main checkout resolve to the same directory).
 *
 * @returns the absolute directory, or `{ error }` when git cannot answer (never a per-worktree fallback)
 */
export function resolveOracleLockDir(repoRoot: string): { readonly dir: string } | { readonly error: string } {
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return { error: `git rev-parse --git-common-dir failed (status ${result.status}): ${result.stderr ?? "<no stderr>"}` };
  }
  return { dir: resolve(repoRoot, result.stdout.trim()) };
}

/**
 * True iff a process with `pid` is alive (zero-signal `kill`). Only `ESRCH` means dead; `EPERM`
 * (exists, other user) counts as alive because the lock exists to avoid a REAL running holder.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * {@link probeOccupancy} for the checkout containing `repoRoot`: resolves the checkout-level lock
 * directory first; when git cannot answer the result is `unmeasured`, never `free`.
 */
export function probeOccupancyForCheckout(repoRoot: string): OccupancyProbe {
  const resolved = resolveOracleLockDir(repoRoot);
  if ("error" in resolved) return { kind: "unmeasured", reason: resolved.error };
  return probeOccupancy(resolved.dir);
}

/**
 * Reads the lock in `lockDir` and reports whether a live peer holds it.
 * A missing, empty, unparseable or dead-holder lock is `free` (the writer reclaims exactly those).
 * A lock file that exists but cannot be read for another reason is `unmeasured` — never silently free.
 *
 * @param lockDir - the checkout-level directory (see {@link resolveOracleLockDir})
 */
export function probeOccupancy(lockDir: string): OccupancyProbe {
  const lockPath = join(lockDir, ORACLE_LOCK_FILE_NAME);
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8").trim();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "free" };
    return { kind: "unmeasured", reason: `cannot read ${lockPath}: ${code ?? String(e)}` };
  }
  const [pidLine = "", worktreeLine = ""] = raw.split("\n");
  const pid = Number.parseInt(pidLine, 10);
  if (!Number.isInteger(pid) || pid <= 0) return { kind: "free" };
  if (!isPidAlive(pid)) return { kind: "free" };
  const holderWorktree = worktreeLine.trim();
  return {
    kind: "held",
    holder_pid: pid,
    lock_path: lockPath,
    ...(holderWorktree !== "" ? { holder_worktree: holderWorktree } : {}),
  };
}
