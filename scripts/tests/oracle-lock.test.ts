// @spawns-external true spawns the `true` binary to prove a spawn can start
/** @spec_ref AC-OX-4 */
/**
 * Unit suite for `scripts/oracle-lock.ts`'s `main`/`releaseLock`
 * (`spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check`, D5 /
 * AC-OX-4) — the checkout-level advisory mutex that serializes `bun run
 * test`.
 *
 * ⛔ Every call to `main(...)`/`releaseLock(...)` below passes an EXPLICIT,
 * freshly `mkdtempSync`-created lock directory. None of these cases ever
 * omits the argument, so none of them can trigger `resolveDefaultLockDir`'s
 * real `git rev-parse --git-common-dir` call -- a concurrent suite run
 * elsewhere in this checkout can never perturb these contention assertions
 * (AC-OX-4's hermetic-test requirement). The production path
 * (`resolveDefaultLockDir`) is exercised only by actually running
 * `bun run test` for real, never by this file.
 *
 * Six-dimension coverage:
 *   HAPPY:      an uncontended acquire on a fresh lock directory returns 0.
 *   NEGATIVE:   a lock naming a pid that is STILL ALIVE (the test process's
 *               own pid -- guaranteed alive for the duration of the test)
 *               makes a second acquire return EXACTLY 5 and print that pid.
 *               Directly adjacent, the SAME lockDir shape with no lock
 *               present returns 0 -- proving 5 is not "always 5" (a test
 *               that only ever observes 5 cannot tell contention from a
 *               function that always returns 5).
 *   BOUNDARY:   the dead/alive pid dichotomy is the exact boundary this
 *               mutex must get right: a lock naming a DEAD pid (deterministically
 *               constructed by spawning a trivial child and reaping it --
 *               never a guessed unused pid) is reclaimed (0), while the
 *               live-pid case immediately above is refused (5). Same
 *               dichotomy, opposite outcomes, proving the branch is real.
 *   ERROR:      a lock file containing unparseable garbage (not an integer)
 *               is treated as having no verifiable live holder and is
 *               reclaimed -- a corrupted lock must never wedge verification
 *               forever (D5).
 *   STATE:      after a reclaim, the lock file's content is the RECLAIMING
 *               process's own pid (not the stale one) -- proving a genuine
 *               overwrite, not a no-op that merely returns 0. The
 *               acquire -> releaseLock -> re-acquire cycle is also asserted:
 *               after release the file is gone, and the next acquire is
 *               reported as a fresh acquire (not a reclaim).
 *   REGRESSION: `main` is asserted to NEVER call `process.exit` across every
 *               branch above (happy, contended, stale, corrupted) in one
 *               pass -- the exact AC-OX-4 contract ("main() returns the exit
 *               code and never calls process.exit"). `process.exit` is
 *               mocked to throw if invoked, so a regression here fails loud
 *               inside the very call that violates the contract, not as an
 *               unrelated downstream symptom.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LOCK_FILE_NAME, main, releaseLock } from "../oracle-lock.js";

const createdDirs: string[] = [];

/** Fresh, empty lock directory for one test case -- tracked for teardown. */
function freshLockDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "oracle-lock-test-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Spawns a trivial child process and waits for it to exit (synchronous --
 * fully reaped by the time this returns), returning its now-certainly-dead
 * pid. This is the ONLY sanctioned way this suite constructs a dead pid --
 * never a guessed/hardcoded "probably unused" number.
 */
function spawnAndReapChild(): number {
  const result = spawnSync("true", []);
  if (result.pid === undefined) {
    throw new Error("spawnAndReapChild: spawnSync('true', []) did not report a pid -- cannot construct a deterministic dead pid");
  }
  return result.pid;
}

function lockFilePath(dir: string): string {
  return join(dir, LOCK_FILE_NAME);
}

describe("oracle-lock main() (AC-OX-4)", () => {
  it("HAPPY: uncontended acquire on a fresh lock directory returns 0 and writes this process's own pid", () => {
    const dir = freshLockDir();
    expect(main(dir)).toBe(0);
    expect(readFileSync(lockFilePath(dir), "utf8").trim()).toBe(String(process.pid));
  });

  it("NEGATIVE + REGRESSION-of-vacuity: a live-held lock returns EXACTLY 5 naming the holder pid, while the SAME shape with no lock present returns 0", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // Contended branch: the lock names THIS test process's own pid, which
      // is guaranteed alive for the duration of this test.
      const contendedDir = freshLockDir();
      writeFileSync(lockFilePath(contendedDir), String(process.pid));

      const contendedResult = main(contendedDir);
      expect(contendedResult).toBe(5);
      const printed = errorSpy.mock.calls.map((args) => String(args[0])).join("\n");
      expect(printed).toContain(String(process.pid));

      // Uncontended branch, same call shape, no lock present: proves the "5"
      // above is a real decision, not a function that always returns 5.
      const uncontendedDir = freshLockDir();
      expect(main(uncontendedDir)).toBe(0);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("BOUNDARY: a lock naming a pid the test itself spawned and REAPED is reclaimed (0), the opposite outcome of the live-pid case above for the identical file shape", () => {
    const dir = freshLockDir();
    const deadPid = spawnAndReapChild();
    writeFileSync(lockFilePath(dir), String(deadPid));

    expect(main(dir)).toBe(0);
  });

  it("ERROR: a lock file containing unparseable garbage is treated as reclaimable, never as a wedge", () => {
    const dir = freshLockDir();
    writeFileSync(lockFilePath(dir), "not-a-pid");

    expect(main(dir)).toBe(0);
  });

  it("STATE: a reclaim genuinely overwrites the lock content with the reclaiming pid (not a no-op), and release -> re-acquire is a fresh acquire, not another reclaim", () => {
    const dir = freshLockDir();
    const deadPid = spawnAndReapChild();
    writeFileSync(lockFilePath(dir), String(deadPid));

    expect(main(dir)).toBe(0);
    const afterReclaim = readFileSync(lockFilePath(dir), "utf8").trim();
    expect(afterReclaim).toBe(String(process.pid));
    expect(afterReclaim).not.toBe(String(deadPid));

    releaseLock(dir);
    expect(existsSync(lockFilePath(dir))).toBe(false);

    // Fresh acquire after release must succeed cleanly (0), proving release
    // actually cleared the way rather than leaving a residual lock.
    expect(main(dir)).toBe(0);
    expect(readFileSync(lockFilePath(dir), "utf8").trim()).toBe(String(process.pid));
  });

  it("STATE: releaseLock refuses to delete a lock naming a DIFFERENT pid than the one asked to release", () => {
    const dir = freshLockDir();
    const otherPid = spawnAndReapChild(); // dead is fine here -- content identity is what's under test, not liveness.
    writeFileSync(lockFilePath(dir), String(otherPid));

    releaseLock(dir, process.pid);

    // Must still be there -- the file names otherPid, not process.pid.
    expect(existsSync(lockFilePath(dir))).toBe(true);
    expect(readFileSync(lockFilePath(dir), "utf8").trim()).toBe(String(otherPid));
  });

  it("REGRESSION: main() never calls process.exit, across the happy, contended, stale, and corrupted branches", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit(${String(code)}) was called -- main() must return an exit code, never call process.exit directly`);
    }) as (code?: string | number | null) => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const happyDir = freshLockDir();
      main(happyDir);

      const contendedDir = freshLockDir();
      writeFileSync(lockFilePath(contendedDir), String(process.pid));
      main(contendedDir);

      const staleDir = freshLockDir();
      writeFileSync(lockFilePath(staleDir), String(spawnAndReapChild()));
      main(staleDir);

      const corruptDir = freshLockDir();
      writeFileSync(lockFilePath(corruptDir), "garbage");
      main(corruptDir);

      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
