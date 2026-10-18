/**
 * migration-022 / `autonomy_thresholds` — the governed record's one-row table (AC-AU-9).
 * HAPPY: read-before-write is null, write then read round-trips the exact text. STATE: a second write replaces the
 * row (one row only). NEGATIVE: the CHECK refuses a second row id. REGRESSION: both stores answer the same.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore, LATEST_SCHEMA_VERSION } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { actedStore } from "../../live-invocation.js";

async function roundTrip(store: StoreInterface): Promise<void> {
  const empty = await store.readAutonomyThresholds();
  expect(empty).toEqual({ ok: true, value: null });
  expect((await store.writeAutonomyThresholds('{"a":1}', "t1")).ok).toBe(true);
  expect(await store.readAutonomyThresholds()).toEqual({ ok: true, value: { content: '{"a":1}', updated_at: "t1" } });
  expect((await store.writeAutonomyThresholds('{"a":2}', "t2")).ok).toBe(true);
  expect(await store.readAutonomyThresholds()).toEqual({ ok: true, value: { content: '{"a":2}', updated_at: "t2" } });
}

describe("autonomy_thresholds store contract (migration-022)", () => {
  it("InMemoryStore round-trips the exact text and replaces on rewrite", async () => {
    await roundTrip(actedStore(new InMemoryStore()));
  });

  it("SQLiteStore round-trips the exact text, keeps exactly one row, and refuses a second row id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-au9-store-"));
    try {
      const store = actedStore(new SQLiteStore(join(dir, "lore.db")));
      try {
        expect(LATEST_SCHEMA_VERSION).toBe(23);
        await roundTrip(store);
        const db = store.getDatabase();
        expect((db.query("SELECT COUNT(*) AS n FROM autonomy_thresholds").get() as { n: number }).n).toBe(1);
        expect(() => db.run("INSERT INTO autonomy_thresholds (id, content, updated_at) VALUES (2, 'x', 'y')")).toThrow();
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
