/**
 * Read-only schema-version probe for an UPSTREAM lore corpus (SPEC-072
 * `lore report-issue`). This module exists solely so `buildUpstreamContext`
 * (`upstream-context-flow.ts`) can answer "is this upstream corpus's schema
 * at the version this consumer's `SQLiteStore` expects?" WITHOUT ever
 * constructing a real (migrating) `SQLiteStore` against a database this
 * process does not own — `SQLiteStore`'s constructor unconditionally runs
 * `runMigrations()` (`sqlite-store.ts` lines ~82-83, 114-190), which has no
 * readonly mode. Opening the file via `new Database(dbPath, { readonly:
 * true })` instead is a STRUCTURAL guarantee (bun:sqlite/SQLite itself
 * refuses writes on a readonly-flagged connection), not a discipline one —
 * a version-skewed or actively-synced upstream corpus can be probed with
 * zero risk of silently upgrading (or corrupting) its schema.
 *
 * Public surface:
 *   - `probeUpstreamDb(dbPath, writeWaitMs?)` — opens `dbPath` readonly,
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
 *     readonly connection before the `PRAGMA user_version` read**
 *     (task-fix-the-spec-072-cross-corpus-database-is-locked-race). Every
 *     `bun:sqlite` connection defaults `busy_timeout` to 0 regardless of the
 *     `readonly` flag, so a reader that races a concurrent writer's `BEGIN
 *     IMMEDIATE` (`SQLiteStore.insertWithProvenance`) can hit `SQLITE_BUSY`
 *     ("database is locked") on the read itself — measured: the SPEC-072
 *     cross-corpus concurrency test failed with exactly this message
 *     BEFORE any write-path contention was even reached, because this probe
 *     runs first (`openValidatedUpstream` step 4, and again inside
 *     `buildUpstreamContext`'s TOCTOU re-check) and had no bound at all.
 *     This is the SAME native SQLite busy-handler `SQLiteStore.init` already
 *     applies to the write connection (SPEC-078 D9) — not a JS-level
 *     retry/backoff loop, so it does not trip D3's `setTimeout|sleep|backoff`
 *     ban. Callers pass the SAME declared bound (`feedback.upstream
 *     .write_wait_ms` / `DEFAULT_WRITE_WAIT_MS`, `@lore/core`'s ONE home for
 *     that number) they use for the real write connection, so a reader and a
 *     writer contending for the same corpus wait out the SAME window.
 *     Omitted → 0 (today's behavior, unchanged) for callers outside the
 *     report-issue concurrency contract (e.g. `mount/mount-registry.ts`'s
 *     dashboard mount probe).
 *
 * Side-effect class: IO (opens/closes a readonly file handle; no writes).
 *
 * Source: SPEC-072 §3 Structure, §4 Public Interface
 * (`flows/upstream-probe.ts`), §7 Design Decisions ("Schema precheck");
 * spec-report-issue-has-no-specified-concurrency-contract-ac-072 D4
 * (declared bounded wait, surfaced on expiry).
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
 * @param dbPath - absolute path to the upstream corpus's `.lore/lore.db`
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
 *   const result = probeUpstreamDb("/path/to/upstream/.lore/lore.db", 2000);
 *   if (result.ok) console.log(result.value.user_version); // e.g. 7
 */
export function probeUpstreamDb(
  dbPath: string,
  writeWaitMs?: number,
): Result<{ user_version: number }, LoreError> {
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (error) {
    return err({
      code: "STORE_ERROR",
      message: `cannot open upstream corpus database readonly at '${dbPath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
      ...(error instanceof Error ? { cause: error } : {}),
    });
  }

  try {
    if (writeWaitMs !== undefined) {
      // reason: bind parameters are not allowed in a PRAGMA statement — same
      // constraint `SQLiteStore.init` documents for the write connection.
      // `writeWaitMs` is a number threaded from `resolveUpstreamWriteWaitMs`
      // (Zod `.int().nonnegative()`-validated at config parse), never caller
      // text, so interpolation here carries no injection risk. This PRAGMA
      // is a per-connection VM setting — it cannot mutate the database file,
      // so it stays inside this function's "no writes" invariant.
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
