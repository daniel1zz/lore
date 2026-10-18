/**
 * @spec_ref spec-run-only-write-identity-and-run-end-claim-release (Scope 4; spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-4/5/6 store half; BR-1057)
 *
 * migration-017: nullable `runs.ended_at` / `runs.end_reason`, and the three store methods built on them
 * (`endRun`, `reopenRun`, `getRunEnd`) across ALL THREE stores (SQLite, Turso, InMemory) with one shared
 * contract, so a store that drifts fails here rather than in a CLI suite.
 *
 * Coverage: HAPPY (end / reopen / read) / NEGATIVE (unknown run writes nothing) / BOUNDARY (first end wins,
 * reopen of an open run) / STATE (v16 file upgrades without losing runs, idempotent re-run) / ERROR
 * (a half-applied migration — column present, version still 16 — completes).
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunId, RunRecord } from "@lore/core";
import { MIGRATION_017_ADD_COLUMNS, MIGRATION_017_SQL } from "../../../src/store/migrations/migration-017.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { LATEST_SCHEMA_VERSION, SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { actedStore } from "../../live-invocation.js";

const RUN = "cc:m17-run" as RunId;
const AT = "2026-10-11T10:00:00.000Z";

function runRecord(id: RunId): RunRecord {
  return {
    id,
    kind: "main",
    harness: "claude-code",
    sessionRef: "m17-run",
    agentRef: null,
    agentType: null,
    parentRunId: null,
    branch: null,
    composition: { schemaVersion: 1, fragments: [] },
    registeredAt: AT,
  };
}

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-migration-017-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("migration-017 constants", () => {
  it("adds exactly runs.ended_at and runs.end_reason, both nullable TEXT, and bumps to 17", () => {
    expect(MIGRATION_017_ADD_COLUMNS.map((c) => `${c.table}.${c.column}`)).toEqual(["runs.ended_at", "runs.end_reason"]);
    for (const c of MIGRATION_017_ADD_COLUMNS) {
      expect(c.ddl).toMatch(/ADD COLUMN \w+ TEXT$/);
      expect(c.ddl).not.toMatch(/NOT NULL/i);
    }
    expect(MIGRATION_017_SQL).toContain("PRAGMA user_version = 17;");
    expect(LATEST_SCHEMA_VERSION).toBe(23);
  });
});

describe("migration-017 on a SQLite file", () => {
  /** A v16 file: a real current-schema file with the two columns dropped and user_version rewound. */
  function seedV16WithRun(path: string): void {
    const fresh = actedStore(new SQLiteStore(path));
    fresh.close();
    const raw = new Database(path);
    raw.exec("ALTER TABLE runs DROP COLUMN ended_at");
    raw.exec("ALTER TABLE runs DROP COLUMN end_reason");
    raw
      .prepare(
        "INSERT INTO runs (id, kind, harness, session_ref, composition, registered_at) VALUES (?, 'main', 'claude-code', 'm17-run', '{\"schemaVersion\":1,\"fragments\":[]}', ?)",
      )
      .run(RUN, AT);
    raw.exec("PRAGMA user_version = 16");
    raw.close();
  }

  it("STATE: upgrading a v16 file adds the columns, keeps the run open (ended_at NULL), lands on 22 (018, 019, 020, 021, 022 follow 017)", async () => {
    const path = join(dir, "v16.db");
    seedV16WithRun(path);

    const store = actedStore(new SQLiteStore(path));

    expect(userVersion(store.getDatabase())).toBe(23);
    const end = await store.getRunEnd(RUN);
    expect(end).toEqual({ ok: true, value: { endedAt: null, endReason: null } });
    store.close();
  });

  it("ERROR: a half-applied migration (columns present, version still 16) completes without 'duplicate column name'", () => {
    const path = join(dir, "half.db");
    seedV16WithRun(path);
    const raw = new Database(path);
    raw.exec("ALTER TABLE runs ADD COLUMN ended_at TEXT");
    raw.close();

    const store = actedStore(new SQLiteStore(path));

    expect(userVersion(store.getDatabase())).toBe(23);
    const cols = (store.getDatabase().query("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((n) => n === "ended_at")).toHaveLength(1);
    expect(cols).toContain("end_reason");
    store.close();
  });

  it("REGRESSION: reopening a migrated file is a no-op (version and run rows unchanged)", async () => {
    const path = join(dir, "again.db");
    const first = actedStore(new SQLiteStore(path));
    await first.insertRun(runRecord(RUN));
    await first.endRun(RUN, AT, "r");
    first.close();

    const second = actedStore(new SQLiteStore(path));

    expect(userVersion(second.getDatabase())).toBe(23);
    expect(await second.getRunEnd(RUN)).toEqual({ ok: true, value: { endedAt: AT, endReason: "r" } });
    second.close();
  });
});

interface StoreCase {
  readonly name: string;
  open(): Promise<{ store: StoreInterface; close(): void }>;
}

const STORE_CASES: readonly StoreCase[] = [
  {
    name: "SQLiteStore",
    open: async () => {
      const store = actedStore(new SQLiteStore(join(dir, "sqlite.db")));
      return { store, close: () => store.close() };
    },
  },
  {
    name: "TursoStore (local file)",
    open: async () => {
      const store = actedStore(new TursoStore({ localPath: join(dir, "turso.db") }));
      return { store, close: () => void store.close() };
    },
  },
  {
    name: "InMemoryStore",
    open: async () => ({ store: actedStore(new InMemoryStore()), close: () => undefined }),
  },
];

describe.each([...STORE_CASES])("run end store contract — $name", (storeCase) => {
  it("HAPPY: endRun stamps ended_at/end_reason and getRunEnd reads them back", async () => {
    const { store, close } = await storeCase.open();
    await store.insertRun(runRecord(RUN));

    expect(await store.endRun(RUN, AT, "session-end")).toEqual({ ok: true, value: "ended" });

    expect(await store.getRunEnd(RUN)).toEqual({ ok: true, value: { endedAt: AT, endReason: "session-end" } });
    close();
  });

  it("STATE: a registered run that never ended reads endedAt null", async () => {
    const { store, close } = await storeCase.open();
    await store.insertRun(runRecord(RUN));

    expect(await store.getRunEnd(RUN)).toEqual({ ok: true, value: { endedAt: null, endReason: null } });
    close();
  });

  it("NEGATIVE: an unknown run id is reported unknown-run, reads null, and creates no row", async () => {
    const { store, close } = await storeCase.open();

    expect(await store.endRun("cc:ghost" as RunId, AT, "x")).toEqual({ ok: true, value: "unknown-run" });

    expect(await store.getRunEnd("cc:ghost" as RunId)).toEqual({ ok: true, value: null });
    expect(await store.getRun("cc:ghost" as RunId)).toEqual({ ok: true, value: null });
    close();
  });

  it("BOUNDARY: the FIRST end wins — a second end reports already-ended and keeps ended_at/end_reason", async () => {
    const { store, close } = await storeCase.open();
    await store.insertRun(runRecord(RUN));
    await store.endRun(RUN, AT, "first");

    expect(await store.endRun(RUN, "2026-10-11T11:00:00.000Z", "second")).toEqual({ ok: true, value: "already-ended" });

    expect(await store.getRunEnd(RUN)).toEqual({ ok: true, value: { endedAt: AT, endReason: "first" } });
    close();
  });

  it("HAPPY: reopenRun clears the end and reports it WAS ended; a second reopen reports false", async () => {
    const { store, close } = await storeCase.open();
    await store.insertRun(runRecord(RUN));
    await store.endRun(RUN, AT, "r");

    expect(await store.reopenRun(RUN)).toEqual({ ok: true, value: true });

    expect(await store.getRunEnd(RUN)).toEqual({ ok: true, value: { endedAt: null, endReason: null } });
    expect(await store.reopenRun(RUN)).toEqual({ ok: true, value: false });
    close();
  });

  it("STATE: the registered record is untouched by end and reopen (BR-1029)", async () => {
    const { store, close } = await storeCase.open();
    await store.insertRun(runRecord(RUN));
    const before = await store.getRun(RUN);

    await store.endRun(RUN, AT, "r");
    await store.reopenRun(RUN);

    expect(await store.getRun(RUN)).toEqual(before);
    close();
  });

  it("NEGATIVE: reopening an unknown run reports false and writes nothing", async () => {
    const { store, close } = await storeCase.open();

    expect(await store.reopenRun("cc:ghost" as RunId)).toEqual({ ok: true, value: false });

    expect(await store.getRun("cc:ghost" as RunId)).toEqual({ ok: true, value: null });
    close();
  });
});
