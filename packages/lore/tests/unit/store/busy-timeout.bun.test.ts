/** @spec_ref AC-078-2 */
/**
 * Tests for SPEC-078 D9's `PRAGMA busy_timeout = 2000` addition in
 * `SQLiteStore.init()` (sqlite-store.ts).
 *
 * Why this needs a real child process: bun:sqlite's busy_timeout retry loop
 * blocks at the native/OS level, not via the JS event loop. A single-process,
 * same-thread simulation (hold a transaction open, then synchronously attempt
 * a second write from the SAME thread) can never observe "waits, then
 * succeeds" — the thread cannot run two blocking synchronous calls at once,
 * so a same-thread second writer would only ever see the FIRST writer's
 * `BEGIN IMMEDIATE` having already completed (no real contention) or would
 * itself be the one blocking the only thread forever. This file spawns a real
 * child process (`holder.mjs`, written to a temp dir at test time) that opens
 * its own connection, takes a `BEGIN IMMEDIATE` write lock (RESERVED lock is
 * acquired immediately per SQLite's own documented semantics, with no write
 * statement required), signals acquisition via a marker file, holds for a
 * fixed duration, then commits — while the test process's own connection
 * attempts a contending write and is timed.
 *
 * Six-dimension coverage:
 *   HAPPY:      PRAGMA busy_timeout reads back 2000 on a fresh SQLiteStore.
 *   STATE:      a second connection's write, issued while a child process
 *               holds an open BEGIN IMMEDIATE lock on the same corpus file,
 *               waits and then succeeds (never throws) — the core AC-078-2
 *               behavior.
 *   REGRESSION: the SAME contention scenario, but the writer connection has
 *               busy_timeout explicitly reset to 0 — throws SQLITE_BUSY
 *               near-instantly. This negative control proves the "succeeds
 *               after waiting" result above is attributable to the
 *               busy_timeout pragma itself, not incidental timing or WAL
 *               mode behavior (failure-first verification: this is the
 *               scenario that MUST fail for the STATE case above to mean
 *               anything).
 *   BOUNDARY:   TursoStore's source has no busy_timeout call — SPEC-078 D9
 *               deliberately scopes this fix to SQLiteStore only; libsql
 *               handles write serialization at the replica-sync layer.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";

// A standalone child-process script. Deliberately self-contained (raw
// bun:sqlite only, no import of our own source) so a spawned process has zero
// coupling to this repo's module resolution. It opens its own connection to
// the given db file, takes an immediate write lock (BEGIN IMMEDIATE acquires
// the RESERVED lock immediately per SQLite's documented semantics — no write
// statement is needed inside the transaction for this to block other
// writers), drops a marker file the instant the lock is held, holds for
// `holdMs`, then commits.
const HOLDER_SCRIPT = `
import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";

const [, , dbPath, markerPath, holdMsArg] = process.argv;
const db = new Database(dbPath);
db.exec("BEGIN IMMEDIATE");
writeFileSync(markerPath, "locked");
await Bun.sleep(Number(holdMsArg));
db.exec("COMMIT");
db.close();
`;

const HOLD_MS = 300;
const LOCK_WAIT_TIMEOUT_MS = 2000;

/** Polls for `markerPath` to appear (holder process has taken the lock), or throws. */
async function waitForMarker(markerPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (!existsSync(markerPath)) {
    if (Date.now() > deadline) {
      throw new Error(
        `holder process never signalled lock acquisition within ${LOCK_WAIT_TIMEOUT_MS}ms`,
      );
    }
    await Bun.sleep(5);
  }
}

describe("SQLiteStore busy_timeout pragma (AC-078-2)", () => {
  let tempDir: string;
  let dbPath: string;
  let holderScriptPath: string;
  let markerPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-busy-timeout-"));
    dbPath = join(tempDir, "corpus.db");
    holderScriptPath = join(tempDir, "holder.mjs");
    markerPath = join(tempDir, "locked.marker");
    Bun.write(holderScriptPath, HOLDER_SCRIPT);

    // Migrate the corpus schema and create the probe table BEFORE any lock
    // contention exists, via a real SQLiteStore (proves the fix lands on the
    // production init() path, not a hand-rolled connection).
    const setupStore = new SQLiteStore(dbPath);
    setupStore
      .getDatabase()
      .exec("CREATE TABLE IF NOT EXISTS busy_timeout_probe (id INTEGER PRIMARY KEY)");
    setupStore.close();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("HAPPY: a fresh SQLiteStore connection reports PRAGMA busy_timeout = 2000", () => {
    const store = new SQLiteStore(dbPath);
    const row = store.getDatabase().query("PRAGMA busy_timeout").get() as {
      timeout: number;
    };
    expect(row.timeout).toBe(2000);
    store.close();
  });

  it("STATE: a second writer waits out a held write lock and succeeds instead of throwing SQLITE_BUSY", async () => {
    const holderProc = Bun.spawn(
      ["bun", holderScriptPath, dbPath, markerPath, String(HOLD_MS)],
      { stdout: "ignore", stderr: "pipe" },
    );

    await waitForMarker(markerPath);

    const writer = new SQLiteStore(dbPath);
    const t0 = performance.now();
    let threw: unknown;
    try {
      writer.getDatabase().exec("INSERT INTO busy_timeout_probe (id) VALUES (1)");
    } catch (error) {
      threw = error;
    }
    const elapsed = performance.now() - t0;
    const holderExitCode = await holderProc.exited;

    expect(threw).toBeUndefined();
    // Waited roughly the holder's hold duration (not instant) but stayed
    // safely inside the 2000ms busy_timeout ceiling — proves it retried
    // rather than either failing immediately or hanging past the ceiling.
    expect(elapsed).toBeGreaterThan(HOLD_MS * 0.5);
    expect(elapsed).toBeLessThan(2000);
    expect(holderExitCode).toBe(0);

    const row = writer
      .getDatabase()
      .query("SELECT COUNT(*) as n FROM busy_timeout_probe")
      .get() as { n: number };
    expect(row.n).toBe(1);

    writer.close();
  });

  it("REGRESSION: the same contention with busy_timeout explicitly set to 0 throws SQLITE_BUSY near-instantly (negative control)", async () => {
    const holderProc = Bun.spawn(
      ["bun", holderScriptPath, dbPath, markerPath, String(HOLD_MS)],
      { stdout: "ignore", stderr: "pipe" },
    );

    await waitForMarker(markerPath);

    const rawDb = new Database(dbPath);
    rawDb.exec("PRAGMA busy_timeout = 0");
    const t0 = performance.now();
    let threw: unknown;
    try {
      rawDb.exec("INSERT INTO busy_timeout_probe (id) VALUES (2)");
    } catch (error) {
      threw = error;
    }
    const elapsed = performance.now() - t0;
    await holderProc.exited;

    expect(threw).toBeDefined();
    expect(String((threw as Error).message)).toMatch(/locked|busy/i);
    // Failed near-instantly, in sharp contrast to the STATE case above —
    // demonstrates the wait-then-succeed behavior is NOT free (some code
    // path has to actually configure busy_timeout for it to happen).
    expect(elapsed).toBeLessThan(HOLD_MS * 0.5);

    rawDb.close();
  });

  it("BOUNDARY: TursoStore source has no busy_timeout call (SPEC-078 D9 scope — libsql serializes writes at the replica-sync layer, not via SQLite's file-level busy handler)", () => {
    const tursoSourcePath = join(import.meta.dir, "../../../src/store/turso-store.ts");
    const tursoSource = readFileSync(tursoSourcePath, "utf-8");
    expect(tursoSource).not.toMatch(/busy_timeout/i);
  });
});
