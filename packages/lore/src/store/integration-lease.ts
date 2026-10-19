/**
 * Integration lease: the exclusive, process-bound lock one `lore integrate` run holds on its integration worktree.
 *
 * Purpose: two runs of one session share one integration worktree; the second re-takes the corpus snapshot under the
 * first run's floor (incident 2026-10-19: "disk I/O error" in both). The lease refuses the second run at once.
 * Public surface: {@link sqliteIntegrationLease}, {@link LEASE_LOCK_FILE}, {@link LEASE_HOLDER_FILE}.
 * Mechanism (no flock in Bun, and `bun:ffi` would need a libc path per platform): `BEGIN EXCLUSIVE` on a tiny SQLite
 * database. SQLite takes it with the operating system's byte-range lock (fcntl) on the open file, so the KERNEL owns the
 * lock: it is released when the holding process exits or is killed, however it dies. There is therefore no stale-lock
 * detection, no pid probing, no expiry and no cleanup code. `busy_timeout = 0` makes `acquire` fail at once instead of waiting.
 * Invariants:
 *   - The holder record (`lore-integrate.holder`, JSON) is written only AFTER the lock is owned, so a record always
 *     belongs to the owner or to a dead run; a dead run's record is overwritten by the next owner, never trusted alone —
 *     a refused run only reads it after the lock proved a live owner exists.
 *   - A refused run whose holder has not yet written its record polls briefly, then reports `holder: undefined`.
 * Side-effect class: IO (two files inside `lockDir`, a held file lock).
 */
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { IntegrationLease, LeaseGrant, LeaseHolder } from "../service/integrate-service.js";

/** The SQLite file the lock is taken on (its content is never used). */
export const LEASE_LOCK_FILE = "lore-integrate.lock";
/** Who owns the lock, written by the owner after it has the lock. */
export const LEASE_HOLDER_FILE = "lore-integrate.holder";

/** How long a refused run waits for a just-started holder to record itself. */
const HOLDER_RECORD_WAIT_MS = 1000;
const HOLDER_POLL_MS = 25;

function readHolder(path: string): LeaseHolder | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { pid, branch, started_at: startedAt } = parsed as Record<string, unknown>;
    return typeof pid === "number" && typeof branch === "string" && typeof startedAt === "string" ? { pid, branch, started_at: startedAt } : undefined;
  } catch {
    return undefined; // reason: no record yet (the owner is between taking the lock and writing it) or a partial write
  }
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isBusy(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || (cause instanceof Error && /database is locked/i.test(cause.message));
}

/** The lease over an on-disk SQLite lock file; see the module header. */
export const sqliteIntegrationLease: IntegrationLease = {
  acquire(lockDir, holder): Result<LeaseGrant, LoreError> {
    const holderPath = join(lockDir, LEASE_HOLDER_FILE);
    let db: Database | undefined;
    try {
      db = new Database(join(lockDir, LEASE_LOCK_FILE), { create: true });
      db.run("PRAGMA busy_timeout = 0");
      db.run("BEGIN EXCLUSIVE");
    } catch (cause) {
      db?.close();
      if (isBusy(cause)) {
        const deadline = Date.now() + HOLDER_RECORD_WAIT_MS;
        let found = readHolder(holderPath);
        while (found === undefined && Date.now() < deadline) {
          sleepMs(HOLDER_POLL_MS);
          found = readHolder(holderPath);
        }
        return ok({ kind: "busy", holder: found });
      }
      return err({ code: "STORE_ERROR", message: `integrate: cannot take the integration lease in ${lockDir}: ${cause instanceof Error ? cause.message : String(cause)}` });
    }
    const owned = db;
    try {
      writeFileSync(holderPath, `${JSON.stringify(holder)}\n`);
    } catch (cause) {
      owned.close();
      return err({ code: "STORE_ERROR", message: `integrate: cannot record the integration lease holder in ${holderPath}: ${cause instanceof Error ? cause.message : String(cause)}` });
    }
    return ok({
      kind: "held",
      release: () => {
        owned.close(); // closing the connection rolls the transaction back and drops the file lock
      },
    });
  },
};
