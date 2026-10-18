/**
 * Tests for the readonly schema-version probe, `store/schema-probe.ts::
 * probeSchemaVersion` — relocated here (P4, spec-the-defect-channel-reaches-
 * no-machine-but-its-own-github) from SPEC-072's own `flows/` module (as
 * `probeUpstreamDb`), which this file used to test alongside the narrow
 * SQLite-shaped upstream composition root that module gated
 * (`buildUpstreamContext`) — that second describe block is RETIRED, not
 * rewritten, in this same change: `buildUpstreamContext` and the module that
 * defined it are deleted outright in P4, so there is no surviving subject
 * for those four cases to exercise. `probeSchemaVersion` itself SURVIVES the
 * deletion — `mount/mount-registry.ts` (SPEC-078 D2) has always reused it
 * for an unrelated purpose (classifying a dashboard-registry project's
 * corpus schema version), independently of SPEC-072.
 *
 * Every fixture here is a throwaway `mkdtempSync` corpus — NEVER the repo's
 * own `.lore/` (root `CLAUDE.md`'s "never write to the repo's own `.lore/`
 * from tests" rule).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      probeSchemaVersion returns the real user_version on a
 *               WAL-mode db and leaves the db+`-wal` content AND the `-shm`
 *               file's SIZE unchanged (see "probe purity" note below).
 *   NEGATIVE:   a corrupt (non-SQLite) file at dbPath returns
 *               err(STORE_ERROR), never throws.
 *   REGRESSION: `probeSchemaVersion`'s reported `user_version` matches
 *               `LATEST_SCHEMA_VERSION` (`sqlite-store.ts`) — if a future
 *               migration bumps the ceiling without updating that constant,
 *               this assertion (not a silently-passing skew check) is what
 *               would catch the drift.
 *   BOUNDARY / ERROR / STATE: n/a for this reduced file — those dimensions
 *               belonged entirely to the retired `buildUpstreamContext`
 *               describe block (version-skew rejection, missing-db refusal,
 *               and the created-draft-task round-trip), whose subject no
 *               longer exists.
 *
 * **Probe purity note (empirically verified, not assumed)**: SQLite's WAL
 * mode `-shm` file is shared-memory BOOKKEEPING (reader "read-mark" slots
 * used to coordinate checkpointing across connections) — ANY connection
 * that opens a WAL-mode database, including a fully `readonly: true` one
 * that only reads a `PRAGMA`, mutates its bytes as a side effect of
 * attaching as a reader. This was reproduced directly against this repo's
 * `bun:sqlite` binding before writing these assertions: opening a second
 * readonly connection and reading `PRAGMA user_version` changes `-shm`'s
 * sha256 while its BYTE SIZE (32768 — the standard WAL-index page) and the
 * `-wal`/`db` files' content stay byte-identical. This is universal SQLite
 * WAL behavior, not specific to this probe's implementation — the size (a
 * real invariant: the probe neither grows nor truncates the index) is what
 * this file verifies rather than byte-for-byte content, which no readonly
 * WAL connection — this probe or otherwise — can hold constant.
 *
 * Source: SPEC-078 D2 (`mount/mount-registry.ts`'s reuse); SPEC-072 §4
 * Public Interface (pre-P4 origin, AC-072-12).
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeSchemaVersion } from "../../../src/store/schema-probe.js";
import { SQLiteStore, LATEST_SCHEMA_VERSION } from "../../../src/store/sqlite-store.js";
import { actedStore } from "../../live-invocation.js";

/**
 * A stable marker hashed in place of a missing sidecar file (`-wal`/`-shm`
 * may legitimately not exist — e.g. after a checkpoint on close) so
 * "present before, absent after" and "absent before, absent after" hash
 * differently while "absent both times" still compares equal.
 */
const ABSENT_SIDECAR_MARKER = "lore-schema-probe:absent-sidecar";

function hashPathOrMarker(path: string): string {
  const hash = createHash("sha256");
  hash.update(existsSync(path) ? readFileSync(path) : ABSENT_SIDECAR_MARKER);
  return hash.digest("hex");
}

/** Byte size of `path`, or `0` when the file doesn't exist (never throws). */
function sizeOfPathOrZero(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

/**
 * A corpus db's persistence fingerprint: byte-identical hashes for the db
 * file and its `-wal` sidecar (the actual committed/pending DATA), plus the
 * `-shm` sidecar's SIZE ONLY (see module header "Probe purity note" for why
 * `-shm` content is excluded — its bytes are expected to change on ANY
 * reader connection, including a fully readonly one, as a universal SQLite
 * WAL-index bookkeeping side effect unrelated to data mutation).
 */
function fingerprintDb(dbPath: string): { db: string; wal: string; shmSize: number } {
  return {
    db: hashPathOrMarker(dbPath),
    wal: hashPathOrMarker(`${dbPath}-wal`),
    shmSize: sizeOfPathOrZero(`${dbPath}-shm`),
  };
}

describe("probeSchemaVersion — readonly schema-version probe (SPEC-078 D2, ex-SPEC-072)", () => {
  it("HAPPY/REGRESSION: returns user_version and leaves the db/-wal/-shm persistence fingerprint unchanged on a WAL-mode db", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lore-schema-probe-"));
    const dbPath = join(tempDir, "corpus.db");

    // reason: SQLiteStore's own init() sets `PRAGMA journal_mode = WAL`
    // (sqlite-store.ts) — constructing one is the simplest way to produce a
    // real WAL-mode db, without hand-rolling the migration chain.
    const store = actedStore(new SQLiteStore(dbPath));

    const before = fingerprintDb(dbPath);

    const result = probeSchemaVersion(dbPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // REGRESSION: catches a future migration bump that forgets to update
      // LATEST_SCHEMA_VERSION alongside it.
      expect(result.value.user_version).toBe(LATEST_SCHEMA_VERSION);
    }

    const after = fingerprintDb(dbPath);
    expect(after).toEqual(before);

    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("NEGATIVE: a corrupt (non-SQLite) file at dbPath returns err(STORE_ERROR), never throws", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lore-schema-probe-corrupt-"));
    const dbPath = join(tempDir, "not-a-db.db");
    mkdirSync(tempDir, { recursive: true });
    // Deliberately write non-SQLite bytes.
    writeFileSync(dbPath, "not a sqlite database\n");

    const result = probeSchemaVersion(dbPath);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORE_ERROR");
    }

    rmSync(tempDir, { recursive: true, force: true });
  });
});
