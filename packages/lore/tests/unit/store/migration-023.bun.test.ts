/**
 * Migration 023 (AU-T16) — decision_log's verdict CHECK admits 'superseded' through a table rebuild that keeps every
 * existing row byte-for-byte (so the hash chain still verifies), keeps the append-only triggers, and keeps ids growing.
 */
import { describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { MIGRATION_020_SQL } from "../../../src/store/migrations/migration-020.js";
import { computeDecisionEntryHash, DECISION_GENESIS_HASH, verifyDecisionChain, type DecisionRecordInput } from "../../../src/store/decision-log.js";
import { actedStore } from "../../live-invocation.js";

function input(n: number, verdict: DecisionRecordInput["verdict"]): DecisionRecordInput {
  return {
    ts: `2026-10-18T00:00:0${n}.000Z`,
    class: "stash-drop",
    subject_id: `s${n}`,
    subject_version: `v${n}`,
    facts: `{"n":${n}}`,
    factors: "{}",
    score: 0.5,
    threshold: 0.95,
    verdict,
    reasons: "[]",
    executor_run: null,
    channel: "machine",
  };
}

/** A corpus at schema 21: the 020 table (old CHECK) holding a valid 3-row chain. */
function legacyDb(path: string, version: 21 | 22 = 21): void {
  const db = new Database(path);
  db.exec(MIGRATION_020_SQL);
  let prev = DECISION_GENESIS_HASH;
  for (const [i, verdict] of (["auto", "escalate", "refuse"] as const).entries()) {
    const row = input(i + 1, verdict);
    const hash = computeDecisionEntryHash(row, prev);
    db.prepare(
      `INSERT INTO decision_log (ts, class, subject_id, subject_version, facts, factors, score, threshold, verdict, reasons, executor_run, channel, prev_hash, entry_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.ts, row.class, row.subject_id, row.subject_version, row.facts, row.factors, row.score, row.threshold, row.verdict, row.reasons, row.executor_run, row.channel, prev, hash);
    prev = hash;
  }
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
}

describe("migration 023 decision_log superseded verdict", () => {
  it("old CHECK refuses 'superseded' (negative control on the legacy table)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-m023-"));
    try {
      const db = new Database(join(dir, "old.db"));
      db.exec(MIGRATION_020_SQL);
      expect(() =>
        db
          .prepare(
            `INSERT INTO decision_log (ts, class, subject_id, subject_version, facts, factors, score, threshold, verdict, reasons, executor_run, channel, prev_hash, entry_hash)
             VALUES ('t','c','s','v','{}','{}',0,NULL,'superseded','[]',NULL,'machine','','h')`,
          )
          .run(),
      ).toThrow();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([21, 22] as const)("upgrade from %i keeps rows verbatim, the chain clean, the triggers armed, and accepts 'superseded'", async (from) => {
    const dir = mkdtempSync(join(tmpdir(), "lore-m023-"));
    const path = join(dir, "lore.db");
    try {
      legacyDb(path, from);
      const store = actedStore(new SQLiteStore(path));
      try {
        const before = await store.listDecisionLog();
        expect(before.ok && before.value.map((r) => [r.id, r.verdict])).toEqual([[1, "auto"], [2, "escalate"], [3, "refuse"]]);
        expect(before.ok && verifyDecisionChain(before.value)).toEqual({ clean: true, checked: 3 });
        const appended = await store.appendDecisionRecord(input(4, "superseded"));
        expect(appended.ok && appended.value.id).toBe(4);
        const after = await store.listDecisionLog();
        expect(after.ok && verifyDecisionChain(after.value)).toEqual({ clean: true, checked: 4 });
        expect(after.ok && after.value[3]?.verdict).toBe("superseded");
        const db = store.getDatabase();
        expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(25);
        expect(() => db.run("UPDATE decision_log SET score = 1 WHERE id = 1")).toThrow(/append-only/);
        expect(() => db.run("DELETE FROM decision_log WHERE id = 1")).toThrow(/append-only/);
        const bad = await store.appendDecisionRecord({ ...input(5, "auto"), verdict: "bogus" as DecisionRecordInput["verdict"] });
        expect(bad.ok).toBe(false);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
