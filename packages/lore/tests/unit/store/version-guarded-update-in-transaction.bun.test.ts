// @reads packages/lore/src/store/sqlite-store.ts
// @reads packages/lore/src/store/turso-store.ts
/**
 * @spec_ref task-a-version-guarded-store-update-decides-its-outcome-from
 *
 * A version-guarded UPDATE decides its outcome from DATA (`UPDATE ... RETURNING` rows), never from
 * the driver's affected-row count. Measured under bun 1.3.10: inside a multi-statement SQLite
 * transaction, `Statement.run().changes` after a ZERO-row UPDATE reports a stale non-zero count (4),
 * so a version miss that follows another write in the same transaction was treated as success.
 *
 * Runner: `bun test` (bun:sqlite / @libsql/client file mode) - never plain vitest.
 *
 * Dimensions: NEGATIVE (stale guard after another write -> STALE_VERSION, row unchanged),
 * HAPPY (matching guard after another write -> lands), REGRESSION (no affected-row-count success
 * decision remains in either store source).
 *
 * Drives the stores' private transactional update primitives (`updateDocSync` / `applyRuleLeafPatchTx`)
 * because no public verb currently combines "write another row" with "guarded update" in one
 * transaction except moveRule, whose SQLite path pre-checks the version and so cannot expose the bug.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { actedStore } from "../../live-invocation.js";
import { makeDoc, resetCounter } from "./store-core.shared.js";

const SRC_DIR = join(import.meta.dirname, "../../../src/store");

describe("version-guarded update inside a transaction (SQLiteStore)", () => {
  let tmpDir: string;
  let store: SQLiteStore;

  beforeEach(() => {
    resetCounter();
    tmpDir = mkdtempSync(join(tmpdir(), "lore-guarded-update-sqlite-"));
    store = actedStore(new SQLiteStore(join(tmpDir, "lore.db")));
  });
  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a stale guard after another write in the same transaction is STALE_VERSION and leaves the row unchanged", async () => {
    const target = makeDoc({ title: "target", version: 3 });
    expect((await store.insert(target)).ok).toBe(true);
    const internals = store as unknown as {
      db: { run(sql: string): unknown };
      insertDocSync(doc: unknown): { ok: boolean };
      updateDocSync(
        id: string,
        patch: Record<string, unknown>,
        opts: { expected_version: number },
      ): { ok: boolean; error?: { code: string } };
    };
    internals.db.run("BEGIN IMMEDIATE");
    try {
      expect(internals.insertDocSync(makeDoc({ title: "other write" })).ok).toBe(true);
      const result = internals.updateDocSync(target.id, { title: "clobbered", version: 4 }, { expected_version: 99 });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("STALE_VERSION");
    } finally {
      internals.db.run("ROLLBACK");
    }
    const after = await store.find(target.id);
    expect(after.ok && after.value?.title).toBe("target");
    expect(after.ok && after.value?.version).toBe(3);
  });

  it("a matching guard after another write in the same transaction lands", async () => {
    const target = makeDoc({ title: "target", version: 3 });
    expect((await store.insert(target)).ok).toBe(true);
    const internals = store as unknown as {
      db: { run(sql: string): unknown };
      insertDocSync(doc: unknown): { ok: boolean };
      updateDocSync(id: string, patch: Record<string, unknown>, opts: { expected_version: number }): { ok: boolean };
    };
    internals.db.run("BEGIN IMMEDIATE");
    expect(internals.insertDocSync(makeDoc({ title: "other write" })).ok).toBe(true);
    const result = internals.updateDocSync(target.id, { title: "renamed", version: 4 }, { expected_version: 3 });
    expect(result.ok).toBe(true);
    internals.db.run("COMMIT");
    const after = await store.find(target.id);
    expect(after.ok && after.value?.title).toBe("renamed");
  });
});

describe("version-guarded update inside a transaction (TursoStore)", () => {
  let tmpDir: string;
  let store: TursoStore;

  beforeEach(() => {
    resetCounter();
    tmpDir = mkdtempSync(join(tmpdir(), "lore-guarded-update-turso-"));
    store = actedStore(new TursoStore({ localPath: join(tmpDir, "lore.db") }));
  });
  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a stale guard after another write in the same transaction is STALE_VERSION and leaves the row unchanged", async () => {
    const first = makeDoc({ title: "first", version: 1 });
    const second = makeDoc({ title: "second", version: 3 });
    expect((await store.insert(first)).ok).toBe(true);
    expect((await store.insert(second)).ok).toBe(true);
    const internals = store as unknown as {
      client: { transaction(mode: "write"): Promise<{ rollback(): Promise<void> }> };
      applyRuleLeafPatchTx(
        tx: unknown,
        patch: { id: string; expectedVersion: number; extra: Record<string, unknown> },
        actor: string,
        nowIso: string,
      ): Promise<{ ok: boolean; error?: { code: string } }>;
    };
    const tx = await internals.client.transaction("write");
    try {
      const hit = await internals.applyRuleLeafPatchTx(tx, { id: first.id, expectedVersion: 1, extra: { a: 1 } }, "agent:test", "2026-06-08T11:00:00.000Z");
      expect(hit.ok).toBe(true);
      const miss = await internals.applyRuleLeafPatchTx(tx, { id: second.id, expectedVersion: 99, extra: { b: 1 } }, "agent:test", "2026-06-08T11:00:00.000Z");
      expect(miss.ok).toBe(false);
      expect(miss.error?.code).toBe("STALE_VERSION");
    } finally {
      await tx.rollback();
    }
    const after = await store.find(second.id);
    expect(after.ok && after.value?.version).toBe(3);
    expect(after.ok && after.value?.extra).toEqual({});
  });
});

describe("no affected-row-count success decision remains in the stores", () => {
  const stripComments = (source: string): string =>
    source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");

  it.each(["sqlite-store.ts", "turso-store.ts"])("%s decides outcomes from RETURNING rows, not .changes / rowsAffected", (file) => {
    const code = stripComments(readFileSync(join(SRC_DIR, file), "utf8"));
    expect(code.match(/\.changes\b/g) ?? []).toEqual([]);
    expect(code.match(/\browsAffected\b/g) ?? []).toEqual([]);
  });
});
