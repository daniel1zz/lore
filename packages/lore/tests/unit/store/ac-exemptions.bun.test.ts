/**
 * Store contract for `insertAcExemptionCapped` / `listAcExemptions` (migration-014 `ac_exemptions`,
 * baseline slice 2 C4, AC-BLS2-10). The SAME suite runs against SQLiteStore (temp file), TursoStore
 * (local libsql file mode) and InMemoryStore. Runner: `bun test` (bun:sqlite) — never vitest.
 *
 * Dimensions: HAPPY (insert/list), NEGATIVE (cap full, active duplicate), BOUNDARY (cap 0, exactly full),
 * STATE (expired excluded from the count, expired row renewed), REGRESSION (8-way race, and two
 * SQLiteStore handles on one file never overfill the cap).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { AcExemptionRow, StoreInterface } from "../../../src/store/store-interface.js";
import { TursoStore } from "../../../src/store/turso-store.js";

const NOW = "2026-10-08T00:00:00.000Z";
const FUTURE = "2026-12-01T00:00:00.000Z";
const PAST = "2026-09-01T00:00:00.000Z";

function row(acId: string, over: Partial<AcExemptionRow> = {}): AcExemptionRow {
  return {
    doc_id: "SPEC1",
    ac_id: acId,
    reason: "no rule yet",
    expires_at: FUTURE,
    granted_by: "agent:test",
    granted_at: NOW,
    ...over,
  };
}

const cap = (maxActive: number) => ({ liveCriteria: 20, maxActive, now: NOW });

interface Harness {
  store: StoreInterface;
  /** A second handle on the SAME database, when the store kind supports it. */
  second?: StoreInterface;
  close: () => void;
}

function runSuite(label: string, create: () => Harness): void {
  describe(`${label}: ac_exemptions capped insert`, () => {
    let h: Harness;
    beforeEach(() => {
      h = create();
    });
    afterEach(() => {
      h.close();
    });

    it("inserts and lists a row, sorted by (doc_id, ac_id)", async () => {
      expect((await h.store.insertAcExemptionCapped(row("AC-2"), cap(5))).ok).toBe(true);
      expect((await h.store.insertAcExemptionCapped(row("AC-1"), cap(5))).ok).toBe(true);
      const listed = await h.store.listAcExemptions();
      expect(listed.ok && listed.value.map((r) => r.ac_id)).toEqual(["AC-1", "AC-2"]);
      expect(listed.ok && listed.value[0]).toEqual(row("AC-1"));
    });

    it("refuses when the cap is full, naming the 10% cap, and stores nothing extra", async () => {
      await h.store.insertAcExemptionCapped(row("AC-1"), cap(1));
      const r = await h.store.insertAcExemptionCapped(row("AC-2"), cap(1));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(r.error)).toMatch(/10%/);
      }
      const listed = await h.store.listAcExemptions();
      expect(listed.ok && listed.value).toHaveLength(1);
    });

    it("a cap of 0 refuses every insert", async () => {
      expect((await h.store.insertAcExemptionCapped(row("AC-1"), cap(0))).ok).toBe(false);
    });

    it("expired rows do not count against the cap", async () => {
      await h.store.insertAcExemptionCapped(row("AC-1", { expires_at: PAST }), { liveCriteria: 20, maxActive: 5, now: "2026-08-01T00:00:00.000Z" });
      const r = await h.store.insertAcExemptionCapped(row("AC-2"), cap(1));
      expect(r.ok).toBe(true);
    });

    it("refuses a second grant while the same criterion is active", async () => {
      await h.store.insertAcExemptionCapped(row("AC-1"), cap(5));
      const r = await h.store.insertAcExemptionCapped(row("AC-1", { reason: "again" }), cap(5));
      expect(r.ok).toBe(false);
      const listed = await h.store.listAcExemptions();
      expect(listed.ok && listed.value[0]?.reason).toBe("no rule yet");
    });

    it("renews an EXPIRED exemption for the same criterion", async () => {
      await h.store.insertAcExemptionCapped(row("AC-1", { expires_at: PAST }), { liveCriteria: 20, maxActive: 5, now: "2026-08-01T00:00:00.000Z" });
      const r = await h.store.insertAcExemptionCapped(row("AC-1", { reason: "renewed" }), cap(5));
      expect(r.ok).toBe(true);
      const listed = await h.store.listAcExemptions();
      expect(listed.ok && listed.value).toHaveLength(1);
      expect(listed.ok && listed.value[0]?.reason).toBe("renewed");
    });

    it("8 concurrent inserts for 2 slots admit exactly 2", async () => {
      const rs = await Promise.all(
        [1, 2, 3, 4, 5, 6, 7, 8].map((n) => h.store.insertAcExemptionCapped(row(`AC-${n}`), cap(2))),
      );
      expect(rs.filter((r) => r.ok)).toHaveLength(2);
      const listed = await h.store.listAcExemptions();
      expect(listed.ok && listed.value).toHaveLength(2);
    });

    it("two handles on one database race for 2 slots: exactly 2 win", async function () {
      if (h.second === undefined) return; // single-handle store kinds
      const second = h.second;
      const rs = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((n) =>
          (n % 2 === 0 ? h.store : second).insertAcExemptionCapped(row(`AC-${n}`), cap(2)),
        ),
      );
      expect(rs.filter((r) => r.ok)).toHaveLength(2);
      const listed = await h.store.listAcExemptions();
      expect(listed.ok && listed.value).toHaveLength(2);
    });
  });
}

runSuite("InMemoryStore", () => ({ store: new InMemoryStore(), close: () => undefined }));

runSuite("SQLiteStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "lore-acex-sqlite-"));
  const path = join(dir, "lore.db");
  const a = new SQLiteStore(path);
  const b = new SQLiteStore(path);
  return {
    store: a,
    second: b,
    close: () => {
      a.close();
      b.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
});

runSuite("TursoStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "lore-acex-turso-"));
  const store = new TursoStore({ localPath: join(dir, "lore.db") });
  return {
    store,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
});
