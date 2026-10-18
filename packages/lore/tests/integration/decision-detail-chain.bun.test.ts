/**
 * AC-HR-2 oracle — decision detail is tamper-evident and honest for rows decided before detail existed.
 *
 * Everything runs in THROWAWAY databases under mkdtemp (never the repo's `.lore/`). A "legacy" corpus is built at
 * schema 23 (decision_log without a detail column, rows hashed the old way), then opened by the current store so
 * migration 024 runs over it.
 *
 * @spec_ref AC-HR-2
 */
import { describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { MIGRATION_020_SQL } from "../../src/store/migrations/migration-020.js";
import { MIGRATION_023_SQL } from "../../src/store/migrations/migration-023.js";
import {
  NO_DETAIL_TEXT,
  computeDecisionEntryHash,
  DECISION_GENESIS_HASH,
  renderDecisionDetailSummary,
  verifyDecisionChain,
  type DecisionRecordInput,
} from "../../src/store/decision-log.js";
import { actedStore } from "../live-invocation.js";

const DETAIL = JSON.stringify({
  summary: "Loosen the governed autonomy thresholds: stash-drop.threshold: 0.8 -> 0.5",
  requested_by: "lore (no attested run)",
  change: { entry: "stash-drop", before: { "stash-drop": { threshold: 0.8 } }, after: { "stash-drop": { threshold: 0.5 } } },
  on_accept: "The threshold is lowered.",
  on_reject: "Nothing changes.",
});

function input(n: number, detail?: string): DecisionRecordInput {
  return {
    ts: `2026-10-19T00:00:0${n}.000Z`,
    class: "stash-drop",
    subject_id: `s${n}`,
    subject_version: `v${n}`,
    facts: "{}",
    factors: "{}",
    score: 0.5,
    threshold: 0.95,
    verdict: "escalate",
    reasons: "[]",
    executor_run: null,
    channel: "machine",
    ...(detail === undefined ? {} : { detail }),
  };
}

/** A corpus at schema 23 holding two rows hashed before detail existed. */
function legacyDb(path: string): void {
  const db = new Database(path);
  db.exec(MIGRATION_020_SQL);
  db.exec(MIGRATION_023_SQL);
  let prev = DECISION_GENESIS_HASH;
  for (const n of [1, 2]) {
    const row = input(n);
    const hash = computeDecisionEntryHash(row, prev);
    db.prepare(
      `INSERT INTO decision_log (ts, class, subject_id, subject_version, facts, factors, score, threshold, verdict, reasons, executor_run, channel, prev_hash, entry_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.ts, row.class, row.subject_id, row.subject_version, row.facts, row.factors, row.score, row.threshold, row.verdict, row.reasons, row.executor_run, row.channel, prev, hash);
    prev = hash;
  }
  db.exec("PRAGMA user_version = 23");
  db.close();
}

async function withStore<T>(fn: (store: SQLiteStore, dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "lore-hr2-"));
  const store = actedStore(new SQLiteStore(join(dir, "lore.db")));
  try {
    return await fn(store, dir);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("decision detail chain", () => {
  it("AC-HR-2: a row with detail verifies, and rewriting its stored detail names that row as hash_mismatch", async () => {
    await withStore(async (store) => {
      expect((await store.appendDecisionRecord(input(1))).ok).toBe(true);
      const withDetail = await store.appendDecisionRecord(input(2, DETAIL));
      expect(withDetail.ok && withDetail.value.detail).toBe(DETAIL);
      expect((await store.appendDecisionRecord(input(3))).ok).toBe(true);
      const rows = await store.listDecisionLog();
      expect(rows.ok && verifyDecisionChain(rows.value)).toEqual({ clean: true, checked: 3 });

      // The in-product append-only triggers refuse the edit, so an attacker drops them first (outside lore).
      const db = store.getDatabase();
      db.run("DROP TRIGGER decision_log_no_update");
      db.run("UPDATE decision_log SET detail = ? WHERE id = 2", [DETAIL.replace("0.5", "0.1")]);
      const tampered = await store.listDecisionLog();
      expect(tampered.ok && verifyDecisionChain(tampered.value)).toEqual({ clean: false, checked: 2, break: { id: 2, reason: "hash_mismatch" } });
    });
  }, 60_000);

  it("AC-HR-2: removing a stored detail (set to NULL) is also caught, not silently shown as 'no detail'", async () => {
    await withStore(async (store) => {
      await store.appendDecisionRecord(input(1, DETAIL));
      const db = store.getDatabase();
      db.run("DROP TRIGGER decision_log_no_update");
      db.run("UPDATE decision_log SET detail = NULL WHERE id = 1");
      const rows = await store.listDecisionLog();
      expect(rows.ok && verifyDecisionChain(rows.value)).toEqual({ clean: false, checked: 1, break: { id: 1, reason: "hash_mismatch" } });
    });
  }, 60_000);

  it("AC-HR-2: rows written before detail existed still verify after migration and render the exact no-detail text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-hr2-legacy-"));
    const path = join(dir, "lore.db");
    try {
      legacyDb(path);
      const store = actedStore(new SQLiteStore(path));
      try {
        const rows = await store.listDecisionLog();
        expect(rows.ok).toBe(true);
        if (!rows.ok) return;
        expect(verifyDecisionChain(rows.value)).toEqual({ clean: true, checked: 2 });
        for (const row of rows.value) expect(renderDecisionDetailSummary(row)).toBe("no detail recorded (decided before detail existed)");
        expect(NO_DETAIL_TEXT).toBe("no detail recorded (decided before detail existed)");
        // A new row appended after the migration chains onto the legacy head and renders its own summary.
        const appended = await store.appendDecisionRecord(input(3, DETAIL));
        expect(appended.ok && renderDecisionDetailSummary(appended.value)).toBe("Loosen the governed autonomy thresholds: stash-drop.threshold: 0.8 -> 0.5");
        const after = await store.listDecisionLog();
        expect(after.ok && verifyDecisionChain(after.value)).toEqual({ clean: true, checked: 3 });
        expect((store.getDatabase().query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(24);
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("AC-HR-2: the renderer never returns an empty string, for null, undefined, bad JSON or a wrong shape", () => {
    expect(renderDecisionDetailSummary({ detail: null })).toBe(NO_DETAIL_TEXT);
    expect(renderDecisionDetailSummary({})).toBe(NO_DETAIL_TEXT);
    expect(renderDecisionDetailSummary({ detail: "not json" })).toMatch(/unreadable/);
    expect(renderDecisionDetailSummary({ detail: "{}" })).toMatch(/unreadable/);
  });
});
