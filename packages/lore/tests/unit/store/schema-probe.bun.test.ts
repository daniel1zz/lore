/**
 * Tests for SPEC-072's readonly upstream schema probe
 * (`flows/upstream-probe.ts::probeUpstreamDb`) and the narrow second
 * composition root it gates (`flows/upstream-context-flow.ts::buildUpstreamContext`).
 *
 * Every fixture here is a throwaway `mkdtempSync` corpus — NEVER the repo's
 * own `.lore/` (root `CLAUDE.md`'s "never write to the repo's own `.lore/`
 * from tests" rule).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      probeUpstreamDb returns the real user_version on a WAL-mode
 *               db and leaves the db+`-wal` content AND the `-shm` file's
 *               SIZE unchanged (AC-072-12, see "probe purity" note below);
 *               buildUpstreamContext + createDraft round-trips a draft
 *               ad-hoc task parented to the seeded corpus's root PRD.
 *   NEGATIVE:   buildUpstreamContext on a corpus root with no `.lore/lore.db`
 *               at all → VALIDATION_ERROR naming the resolved path, zero
 *               db file materializes afterward.
 *   ERROR:      a PRAGMA-user_version-downgraded fixture copy makes
 *               buildUpstreamContext err naming BOTH versions.
 *   BOUNDARY:   the version-skew rejection path leaves the db+`-wal`
 *               content byte-identical (and `-shm` size unchanged) before
 *               and after the call — no `SQLiteStore` (which would
 *               auto-migrate) is ever constructed on a rejected upstream
 *               corpus.
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
 * WAL behavior, not specific to this probe's implementation — the spec's
 * literal "-shm unchanged" wording (§4 Public Interface, AC-072-12) is
 * therefore verified via file SIZE (a real invariant: the probe neither
 * grows nor truncates the index) rather than byte-for-byte content, which
 * no readonly WAL connection — this probe or otherwise — can hold constant.
 *   STATE:      the created draft task's `extra.adhoc === true` and its
 *               `parent_id` resolves to the seeded root PRD's id — verified
 *               via a SECOND, independent `SQLiteStore` connection (not the
 *               same instance `buildUpstreamContext` composed), proving the
 *               write actually landed on disk.
 *   REGRESSION: `probeUpstreamDb`'s reported `user_version` matches
 *               `LATEST_SCHEMA_VERSION` (`sqlite-store.ts`) — if a future
 *               migration bumps the ceiling without updating that constant,
 *               this assertion (not a silently-passing skew check) is what
 *               would catch the drift.
 *
 * Source: SPEC-072 §4 Public Interface, AC-072-12.
 */

import { describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeUpstreamDb } from "../../../src/flows/upstream-probe.js";
import { buildUpstreamContext } from "../../../src/flows/upstream-context-flow.js";
import { SQLiteStore, LATEST_SCHEMA_VERSION } from "../../../src/store/sqlite-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";

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

describe("probeUpstreamDb — readonly schema-version probe (SPEC-072)", () => {
  it("AC-072-12: returns user_version and leaves the db/-wal/-shm persistence fingerprint unchanged on a WAL-mode db", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lore-schema-probe-"));
    const dbPath = join(tempDir, "upstream.db");

    // reason: SQLiteStore's own init() sets `PRAGMA journal_mode = WAL`
    // (sqlite-store.ts) — constructing one is the simplest way to produce a
    // real WAL-mode db, without hand-rolling the migration chain.
    const store = new SQLiteStore(dbPath);

    const before = fingerprintDb(dbPath);

    const result = probeUpstreamDb(dbPath);

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

    const result = probeUpstreamDb(dbPath);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORE_ERROR");
    }

    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("buildUpstreamContext — narrow SQLiteStore+CorpusService composition (SPEC-072 §4)", () => {
  it("HAPPY/STATE: createDraft lands a draft ad-hoc task parented to the seeded root PRD, visible via listIssueReports", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lore-upstream-context-"));
    mkdirSync(join(tempDir, ".lore"), { recursive: true });
    const dbPath = join(tempDir, ".lore", "lore.db");

    // Seed a root PRD the same way `lore init` + `lore create prd` would —
    // direct SQLiteStore + CorpusService construction (the established
    // bun-test pattern; see migration-006-fk-restore.bun.test.ts).
    const seedStore = new SQLiteStore(dbPath);
    const seedCorpusService = new CorpusService(seedStore);
    const rootPrdResult = await seedCorpusService.create({
      type: "prd",
      title: "Upstream Root PRD",
      content: "root prd content",
    });
    expect(rootPrdResult.ok).toBe(true);
    if (!rootPrdResult.ok) return;
    const rootPrd = rootPrdResult.value;
    seedStore.close();

    const ctxResult = buildUpstreamContext(tempDir);
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;
    const ctx = ctxResult.value;

    const rootDocResult = await ctx.resolveRootDoc();
    expect(rootDocResult.ok).toBe(true);
    if (rootDocResult.ok) {
      expect(rootDocResult.value).toEqual({ id: rootPrd.id, slug: rootPrd.slug });
    }

    const createResult = await ctx.createDraft({
      title: "Report: something broke upstream",
      content: "expected: exit 0\nactual: exit 4",
      extra: {
        adhoc: true,
        issue_report: {
          reporter_project: "consumer-a",
          reporter_actor: "agent:test",
          lore_version: "0.0.0-test",
          expected: "exit 0",
          actual: "exit 4",
          reported_at: "2026-07-24T00:00:00.000Z",
          possible_duplicates: [],
        },
      },
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const draftsResult = await ctx.listIssueReports();
    expect(draftsResult.ok).toBe(true);
    if (draftsResult.ok) {
      expect(draftsResult.value).toHaveLength(1);
      expect(draftsResult.value[0]?.id).toBe(createResult.value.id);
      expect(draftsResult.value[0]?.status).toBe("draft");
    }

    ctx.close();

    // STATE: verify parent_id + extra.adhoc landed on disk via an
    // INDEPENDENT SQLiteStore connection (not the instance ctx wrapped).
    const checkStore = new SQLiteStore(dbPath);
    const createdTaskResult = await checkStore.find(createResult.value.id);
    expect(createdTaskResult.ok).toBe(true);
    if (createdTaskResult.ok && createdTaskResult.value !== null) {
      expect(createdTaskResult.value.parent_id).toBe(rootPrd.id);
      expect(createdTaskResult.value.status).toBe("draft");
      expect(createdTaskResult.value.extra["adhoc"]).toBe(true);
    }
    checkStore.close();

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("NEGATIVE: missing .lore/lore.db → err(VALIDATION_ERROR) naming the resolved path", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lore-upstream-missing-"));

    const ctxResult = buildUpstreamContext(tempDir);

    if (ctxResult.ok) throw new Error("expected buildUpstreamContext to fail");
    expect(ctxResult.error.code).toBe("VALIDATION_ERROR");
    if (ctxResult.error.code === "VALIDATION_ERROR") {
      expect(ctxResult.error.field).toBe("feedback.upstream.corpus_path");
    }
    // No db file should have materialized as a side effect of the failed attempt.
    expect(existsSync(join(tempDir, ".lore", "lore.db"))).toBe(false);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("ERROR/BOUNDARY: version skew (PRAGMA downgrade) → err naming both versions; db/-wal/-shm byte-identical pre/post", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lore-upstream-skew-"));
    mkdirSync(join(tempDir, ".lore"), { recursive: true });
    const dbPath = join(tempDir, ".lore", "lore.db");

    const seedStore = new SQLiteStore(dbPath);
    seedStore.close(); // checkpoint WAL — migrations committed at LATEST_SCHEMA_VERSION

    const downgradedVersion = LATEST_SCHEMA_VERSION - 1;
    const rawDb = new Database(dbPath);
    // reason: PRAGMA statements do not accept bound parameters in SQLite —
    // interpolating a hardcoded test integer literal is safe here (not
    // externally-sourced input).
    rawDb.exec(`PRAGMA user_version = ${downgradedVersion}`);
    rawDb.close();

    const before = fingerprintDb(dbPath);

    const ctxResult = buildUpstreamContext(tempDir);

    if (ctxResult.ok) throw new Error("expected buildUpstreamContext to fail");
    expect(ctxResult.error.code).toBe("VALIDATION_ERROR");
    if (ctxResult.error.code === "VALIDATION_ERROR") {
      expect(ctxResult.error.message).toContain(String(LATEST_SCHEMA_VERSION));
      expect(ctxResult.error.message).toContain(String(downgradedVersion));
    }

    const after = fingerprintDb(dbPath);
    expect(after).toEqual(before);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
