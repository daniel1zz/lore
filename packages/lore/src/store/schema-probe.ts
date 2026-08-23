/**
 * Read-only `PRAGMA user_version` schema probe for an arbitrary `bun:sqlite`
 * corpus file. Relocated here (spec-the-defect-channel-reaches-no-machine-
 * but-its-own-github P4) from a now-deleted SPEC-072 `flows/` module —
 * that module's OWN reason to exist was SPEC-072's SQLite-shaped upstream
 * `UpstreamPort`, which P4 removes; this probe outlives it because
 * `mount/mount-registry.ts` (SPEC-078 D2) has always reused it for an
 * UNRELATED purpose — classifying a dashboard-registry project's corpus
 * schema version BEFORE ever constructing a real `App` against it — and that
 * consumer survives P4 untouched. Renamed from `probeUpstreamDb` to
 * {@link probeSchemaVersion}: the old name asserted an "upstream
 * issue-reporting" framing this function never actually had (it opens
 * WHATEVER `dbPath` it is given; `mount-registry.ts`'s own corpus is never
 * an "upstream" in the defect-channel sense), and a name that lies about
 * scope is worse than one that merely under-describes it.
 *
 * Public surface:
 *   - `probeSchemaVersion(dbPath, writeWaitMs?)` — opens `dbPath` readonly,
 *     reads `PRAGMA user_version`, closes the connection, returns the
 *     value. Every failure (missing file, corrupt file, PRAGMA read error)
 *     is returned as `err(...)`, never thrown — this function must be safe
 *     to call from an orchestration layer that has not yet decided whether
 *     the target is even a valid lore corpus.
 *
 * Invariants:
 *   - NEVER opens the database in read-write mode.
 *   - NEVER leaves the connection open — `db.close()` runs on every path
 *     (success, PRAGMA-read failure) via `finally`.
 *   - NEVER throws — every `bun:sqlite` exception is caught and mapped to
 *     `err({code: "STORE_ERROR", ...})`.
 *   - **`writeWaitMs`, when passed, applies `PRAGMA busy_timeout` to THIS
 *     readonly connection before the `PRAGMA user_version` read** — every
 *     `bun:sqlite` connection defaults `busy_timeout` to 0 regardless of the
 *     `readonly` flag, so a reader that races a concurrent writer's `BEGIN
 *     IMMEDIATE` can hit `SQLITE_BUSY` ("database is locked") on the read
 *     itself (`packages/lore/src/store/CLAUDE.md`'s own standing lesson: "ANY
 *     `bun:sqlite` handle opened against a corpus another process may write
 *     needs it"). This is the SAME native SQLite busy-handler `SQLiteStore.init`
 *     already applies to the write connection (SPEC-078 D9) — not a JS-level
 *     retry/backoff loop. Omitted → 0 (unchanged behavior for every current
 *     caller — `mount/mount-registry.ts`'s dashboard mount probe never passes
 *     it).
 *
 * Side-effect class: IO (opens/closes a readonly file handle; no writes).
 *
 * Source: SPEC-072 §3 Structure, §4 Public Interface (as `flows/upstream-
 * probe.ts`, pre-P4), §7 Design Decisions ("Schema precheck"); SPEC-078 D2
 * (`mount/mount-registry.ts`'s reuse).
 */

import { Database } from "bun:sqlite";
import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";

/**
 * Opens `dbPath` in readonly mode, reads `PRAGMA user_version`, and closes
 * the connection. Structurally cannot migrate or otherwise mutate the
 * target database — SQLite rejects any write attempt on a readonly-flagged
 * connection at the engine level.
 *
 * @param dbPath - absolute path to the corpus's `.lore/lore.db`
 * @param writeWaitMs - optional `PRAGMA busy_timeout` (ms) applied to THIS
 *   connection before the `PRAGMA user_version` read, so a reader racing a
 *   concurrent writer's `BEGIN IMMEDIATE` waits out the SAME declared bound
 *   instead of hitting `SQLITE_BUSY` immediately (bun:sqlite defaults every
 *   new connection's busy_timeout to 0, readonly or not). Omitted → 0,
 *   byte-identical to this function's pre-existing behavior.
 * @returns `ok({user_version})` on success; `err({code: "STORE_ERROR", ...})`
 *   when the file can't be opened readonly (missing, permissions, not a
 *   SQLite file), the busy_timeout PRAGMA itself fails, or the
 *   `user_version` read fails (including a `writeWaitMs` expiry)
 * @example
 *   const result = probeSchemaVersion("/path/to/corpus/.lore/lore.db");
 *   if (result.ok) console.log(result.value.user_version); // e.g. 7
 */
export function probeSchemaVersion(
  dbPath: string,
  writeWaitMs?: number,
): Result<{ user_version: number }, LoreError> {
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (error) {
    return err({
      code: "STORE_ERROR",
      message: `cannot open corpus database readonly at '${dbPath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
      ...(error instanceof Error ? { cause: error } : {}),
    });
  }

  try {
    if (writeWaitMs !== undefined) {
      // reason: bind parameters are not allowed in a PRAGMA statement.
      // `writeWaitMs` is a number the caller resolved from validated config
      // or a constant, never caller text, so interpolation here carries no
      // injection risk. This PRAGMA is a per-connection VM setting — it
      // cannot mutate the database file, so it stays inside this function's
      // "no writes" invariant.
      db.run(`PRAGMA busy_timeout = ${writeWaitMs}`);
    }
    const row = db.query("PRAGMA user_version").get() as { user_version: number } | null;
    if (row === null) {
      return err({
        code: "STORE_ERROR",
        message: `PRAGMA user_version returned no row for '${dbPath}' — not a valid SQLite database`,
      });
    }
    return ok({ user_version: row.user_version });
  } catch (error) {
    return err({
      code: "STORE_ERROR",
      message: `failed reading PRAGMA user_version from '${dbPath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
      ...(error instanceof Error ? { cause: error } : {}),
    });
  } finally {
    // reason: a readonly connection still holds a file handle open until
    // closed — this MUST run on every path (success or PRAGMA-read failure),
    // never only on the happy path, so a probe call never leaks a handle
    // into a caller that may immediately construct a real SQLiteStore over
    // the same file.
    db.close();
  }
}
