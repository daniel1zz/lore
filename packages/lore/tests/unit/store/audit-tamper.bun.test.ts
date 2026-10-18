/** @spec_ref AC-079-4 */
/**
 * Adversarial tamper-detection suite for the SPEC-079 G3 audit hash chain —
 * the ATTACK side, sibling to `audit-chain.bun.test.ts` (construction) and
 * independent of it: this file never asserts "a fresh chain looks right", it
 * asserts "an out-of-band sqlite3-style edit to an already-written chain is
 * DETECTED, at the SPECIFIC row and with the SPECIFIC reason the spec
 * documents" (`walkAuditChain`/`checkAuditAnchor`, `packages/lore/src/service/
 * audit-service.ts`).
 *
 * Threat model: a corpus operator (or a compromised process) opens the
 * `.lore/lore.db` file directly with `sqlite3`/`bun:sqlite` while `lore` is
 * NOT running, and edits the `audit` table in place. Every attack below
 * follows the same three-phase shape: (1) build a GENUINE chain via the real
 * `SQLiteStore` write paths (`appendAuditEntry`/`insertWithProvenance`), (2)
 * close the store and reopen the SAME file with a raw `bun:sqlite`
 * `Database` handle to perform the out-of-band edit, confirming the edit
 * landed before moving on (a broken attack script that silently no-ops would
 * otherwise produce a false "detected" result for the wrong reason), (3)
 * reopen a fresh `SQLiteStore` over the tampered file and assert
 * `walkAuditChain`/`AuditService.verify` reports the break at the exact `id`
 * and `reason` the attack should produce — never just `clean === false`.
 *
 * Six-dimension coverage:
 *   HAPPY:      in-place UPDATE of a row's `actor` and, separately, its
 *               `details` JSON blob both yield `hash_mismatch` at that exact
 *               row's `id` (the two most common "someone hand-edited a
 *               field" shapes); a forged appended row with a self-consistent
 *               fabricated `entry_hash` (computed with the SAME
 *               `computeAuditEntryHash` algorithm the walker uses, over a
 *               deliberately WRONG `prev_hash`) yields `prev_link_mismatch`,
 *               proving the walker checks link continuity BEFORE recomputing
 *               a row's own hash — a forged self-consistent hash alone can't
 *               sneak past a bad predecessor pointer.
 *   NEGATIVE:   a genuine paired DELETE of a (versions, audit) row for the
 *               SAME `(doc_id, version)` — the attack SPEC-035's
 *               completeness join cannot see (neither side reports a "miss"
 *               because BOTH halves of the pair are gone) — is still caught
 *               by the independent hash-chain walk as a `prev_link_mismatch`
 *               at the surviving successor row's `id`. This is the
 *               chain-vs-completeness-join distinction the spec calls out by
 *               name (G3 closes exactly this gap).
 *   BOUNDARY:   empty table clean; single-row table genesis (`prev_hash ===
 *               ""`); untampered multi-row DB verifies `clean: true` with
 *               `chain.checked` equal to the row count (negative control —
 *               proves the harness can report clean, not just "always
 *               broken").
 *   ERROR:      setting a row's `prev_hash`/`entry_hash` to `NULL` in place
 *               (simulating a hand-edit that clears the chain columns
 *               outright) is reported as `unchained_row` at that row's `id`
 *               — distinct from `hash_mismatch`/`prev_link_mismatch`.
 *   STATE:      tamper detection on a corrupted PREFIX is not defeated by
 *               further legitimate appends on top of it — the walker still
 *               reports the ORIGINAL break at the ORIGINAL row, with
 *               `checked` equal to that row's position (not the final chain
 *               length), even after two more genuine rows were appended
 *               after the tamper.
 *   REGRESSION: `AuditService.verify()` (not just the bare `walkAuditChain`
 *               pure function) folds a chain break into its overall `clean:
 *               false` and surfaces the SAME `{id, reason}` — the
 *               integration point every adapter (`lore audit --verify`)
 *               actually calls, so a wiring regression between the pure
 *               walker and the service would be caught here even if
 *               `walkAuditChain` itself stayed correct.
 *
 * Deliberately-neutralized dry runs (failure-first discipline): the
 * hash_mismatch and paired-deletion tests both assert the chain is `clean:
 * true` BEFORE the attack, in the SAME test, so a hypothetical
 * always-reports-broken walker (or an attack script that silently no-ops)
 * cannot pass by accident — the assertions must flip from clean to broken
 * within one test body.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEntry, DocRecord, VersionRecord } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { AuditChainEntry } from "../../../src/store/store-interface.js";
import { computeAuditEntryHash } from "../../../src/store/store-shared.js";
import {
  AuditService,
  walkAuditChain,
  type AuditChainVerifyResult,
} from "../../../src/service/audit-service.js";
import { actedStore } from "../../live-invocation.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(): string {
  _counter += 1;
  return `01HATAMPER${String(_counter).padStart(14, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const id = nextId();
  return {
    id,
    slug: `knowledge-audit-tamper-fixture-${_counter}`,
    type: "knowledge",
    role: "knowledge",
    title: `Audit Tamper Fixture ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

function makeVersion(doc: DocRecord, overrides: Partial<VersionRecord> = {}): VersionRecord {
  return {
    doc_id: doc.id,
    version: doc.version,
    content: doc.content,
    extra: doc.extra,
    status: doc.status,
    title: doc.title,
    action: "create",
    created_at: doc.created_at,
    created_by: doc.created_by,
    ...overrides,
  };
}

function makeAudit(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    actor: "agent:test",
    session_id: "s1",
    action: "create",
    details: {},
    ...overrides,
  };
}

/** A file-backed SQLiteStore handle plus its on-disk path, so the store can
 * be closed and the SAME file reopened with a raw `bun:sqlite` `Database`
 * for out-of-band tampering, then reopened again as a fresh `SQLiteStore`. */
interface FileStoreHandle {
  store: SQLiteStore;
  dbPath: string;
  tempDir: string;
}

function openFileStore(): FileStoreHandle {
  const tempDir = mkdtempSync(join(tmpdir(), "lore-audit-tamper-"));
  const dbPath = join(tempDir, "test.db");
  const store = actedStore(new SQLiteStore(dbPath));
  return { store, dbPath, tempDir };
}

/** Runs a raw out-of-band mutation against the file while the SQLiteStore
 * handle is CLOSED — models a `sqlite3`/`bun:sqlite` edit made while `lore`
 * is not running. Reopens nothing; caller reopens a fresh SQLiteStore. */
function tamperRaw(dbPath: string, fn: (db: Database) => void): void {
  const raw = new Database(dbPath);
  try {
    fn(raw);
  } finally {
    raw.close();
  }
}

interface RawAuditRow {
  id: number;
  timestamp: string;
  actor: string;
  session_id: string;
  action: string;
  doc_id: string | null;
  details: string;
  prev_hash: string | null;
  entry_hash: string | null;
}

function rawAuditRows(dbPath: string): RawAuditRow[] {
  let rows: RawAuditRow[] = [];
  tamperRaw(dbPath, (db) => {
    rows = db.query("SELECT * FROM audit ORDER BY id ASC").all() as RawAuditRow[];
  });
  return rows;
}

/** Fresh AuditVerifyResult-shaped AuditService over a reopened dbPath, with
 * a permissive watermark so every versions/audit row in the fixture is in
 * scope for the completeness join. */
function openAuditService(dbPath: string): { store: SQLiteStore; audit: AuditService } {
  const store = actedStore(new SQLiteStore(dbPath));
  const audit = new AuditService(store, { verifySince: "2000-01-01T00:00:00.000Z" });
  return { store, audit };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("audit hash chain — adversarial tamper detection (SPEC-079 G3)", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  // ─── HAPPY: in-place UPDATE → hash_mismatch ───────────────────────────────

  it("HAPPY: in-place UPDATE of one row's actor yields hash_mismatch AT THAT ROW'S id (with a clean-before dry run)", async () => {
    const handle = openFileStore();
    tempDir = handle.tempDir;

    await handle.store.appendAuditEntry(makeAudit({ action: "create", actor: "agent:alice" }));
    await handle.store.appendAuditEntry(makeAudit({ action: "update", actor: "agent:bob" }));
    await handle.store.appendAuditEntry(makeAudit({ action: "link", actor: "agent:carol" }));
    handle.store.close();

    // Dry run: BEFORE tampering, the chain must verify clean. If this
    // assertion fails, the fixture itself is broken and the later "detected"
    // assertion would be meaningless.
    const before = openAuditService(handle.dbPath);
    const beforeResult = await before.audit.verify();
    expect(beforeResult.ok).toBe(true);
    if (beforeResult.ok) {
      expect(beforeResult.value.chain.clean).toBe(true);
      expect(beforeResult.value.chain.checked).toBe(3);
    }
    before.store.close();

    const targetId = rawAuditRows(handle.dbPath)[1]!.id; // the "update" row

    tamperRaw(handle.dbPath, (db) => {
      db.query("UPDATE audit SET actor = ? WHERE id = ?").run("agent:attacker", targetId);
    });

    // Confirm the raw edit actually landed — a no-op tamper script would
    // otherwise make the "detected" assertion below vacuously true.
    const tamperedRow = rawAuditRows(handle.dbPath).find((r) => r.id === targetId);
    expect(tamperedRow?.actor).toBe("agent:attacker");

    const after = openAuditService(handle.dbPath);
    const afterResult = await after.audit.verify();
    expect(afterResult.ok).toBe(true);
    if (afterResult.ok) {
      expect(afterResult.value.chain.clean).toBe(false);
      expect(afterResult.value.chain.break).toEqual({ id: targetId, reason: "hash_mismatch" });
    }
    after.store.close();
  });

  it("HAPPY: in-place UPDATE of one row's details JSON also yields hash_mismatch AT THAT ROW'S id", async () => {
    const handle = openFileStore();
    tempDir = handle.tempDir;

    await handle.store.appendAuditEntry(makeAudit({ action: "create", details: { version: 1 } }));
    await handle.store.appendAuditEntry(
      makeAudit({ action: "update", details: { version: 2, note: "original" } }),
    );
    handle.store.close();

    const targetId = rawAuditRows(handle.dbPath)[1]!.id;

    tamperRaw(handle.dbPath, (db) => {
      db.query("UPDATE audit SET details = ? WHERE id = ?").run(
        JSON.stringify({ version: 2, note: "tampered" }),
        targetId,
      );
    });
    const tamperedRow = rawAuditRows(handle.dbPath).find((r) => r.id === targetId);
    expect(tamperedRow?.details).toContain("tampered");

    const { store, audit } = openAuditService(handle.dbPath);
    const result = await audit.verify();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chain.clean).toBe(false);
      expect(result.value.chain.break).toEqual({ id: targetId, reason: "hash_mismatch" });
    }
    store.close();
  });

  // ─── HAPPY: forged appended row with self-consistent hash, wrong linkage ──

  it("HAPPY: a forged appended row with a self-consistent fabricated entry_hash but wrong prev_hash yields prev_link_mismatch, not hash_mismatch", async () => {
    const handle = openFileStore();
    tempDir = handle.tempDir;

    await handle.store.appendAuditEntry(makeAudit({ action: "create" }));
    await handle.store.appendAuditEntry(makeAudit({ action: "update" }));
    handle.store.close();

    const rowsBefore = rawAuditRows(handle.dbPath);
    expect(rowsBefore).toHaveLength(2);
    const realHead = rowsBefore[1]!.entry_hash!;
    expect(realHead).not.toBeNull();

    // A forged predecessor hash the attacker fabricates — deliberately NOT
    // the real chain head, but a well-formed 64-char hex value so the row
    // "looks" plausible.
    const forgedPrevHash = "f".repeat(64);
    expect(forgedPrevHash).not.toBe(realHead);

    const forgedEntry: AuditEntry = {
      timestamp: "2026-01-01T00:05:00.000Z",
      actor: "agent:attacker",
      session_id: "s-forged",
      action: "create",
      doc_id: "01HFORGED0000000000000001",
      details: { forged: true },
    };
    // Self-consistent: the SAME algorithm the walker uses, computed over the
    // fabricated prev_hash — proves the walker checks link continuity BEFORE
    // it would ever recompute this row's own hash.
    const forgedEntryHash = computeAuditEntryHash(forgedEntry, forgedPrevHash);

    tamperRaw(handle.dbPath, (db) => {
      db.query(
        `INSERT INTO audit (timestamp, actor, session_id, action, doc_id, details, prev_hash, entry_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        forgedEntry.timestamp,
        forgedEntry.actor,
        forgedEntry.session_id,
        forgedEntry.action,
        forgedEntry.doc_id ?? null,
        JSON.stringify(forgedEntry.details),
        forgedPrevHash,
        forgedEntryHash,
      );
    });

    const rowsAfter = rawAuditRows(handle.dbPath);
    expect(rowsAfter).toHaveLength(3);
    const forgedId = rowsAfter[2]!.id;
    expect(rowsAfter[2]!.prev_hash).toBe(forgedPrevHash);
    expect(rowsAfter[2]!.entry_hash).toBe(forgedEntryHash);

    const { store, audit } = openAuditService(handle.dbPath);
    const result = await audit.verify();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chain.clean).toBe(false);
      expect(result.value.chain.break).toEqual({ id: forgedId, reason: "prev_link_mismatch" });
    }
    store.close();
  });

  // ─── NEGATIVE: paired (versions, audit) DELETE defeats completeness, not chain ──

  it("NEGATIVE: paired DELETE of a (versions, audit) row defeats the completeness join but is still caught as a chain prev_link_mismatch", async () => {
    const handle = openFileStore();
    tempDir = handle.tempDir;

    const doc1 = makeDoc();
    const doc2 = makeDoc();
    const doc3 = makeDoc();

    const r1 = await handle.store.insertWithProvenance(
      doc1,
      makeVersion(doc1),
      makeAudit({ action: "create", doc_id: doc1.id, details: { version: 1 } }),
    );
    expect(r1.ok).toBe(true);
    const r2 = await handle.store.insertWithProvenance(
      doc2,
      makeVersion(doc2),
      makeAudit({ action: "create", doc_id: doc2.id, details: { version: 1 } }),
    );
    expect(r2.ok).toBe(true);
    const r3 = await handle.store.insertWithProvenance(
      doc3,
      makeVersion(doc3),
      makeAudit({ action: "create", doc_id: doc3.id, details: { version: 1 } }),
    );
    expect(r3.ok).toBe(true);
    handle.store.close();

    // Dry run: BEFORE the paired delete, both the completeness join AND the
    // chain walk must be clean.
    const before = openAuditService(handle.dbPath);
    const beforeResult = await before.audit.verify();
    expect(beforeResult.ok).toBe(true);
    if (beforeResult.ok) {
      expect(beforeResult.value.misses).toEqual([]);
      expect(beforeResult.value.chain.clean).toBe(true);
      expect(beforeResult.value.chain.checked).toBe(3);
    }
    before.store.close();

    const rows = rawAuditRows(handle.dbPath);
    expect(rows).toHaveLength(3);
    const victimAuditId = rows[1]!.id; // doc2's create-audit row
    const successorAuditId = rows[2]!.id; // doc3's create-audit row

    tamperRaw(handle.dbPath, (db) => {
      db.query("DELETE FROM versions WHERE doc_id = ? AND version = ?").run(doc2.id, 1);
      db.query("DELETE FROM audit WHERE id = ?").run(victimAuditId);
    });

    // Confirm both halves of the pair are actually gone.
    const rowsAfter = rawAuditRows(handle.dbPath);
    expect(rowsAfter).toHaveLength(2);
    expect(rowsAfter.some((r) => r.id === victimAuditId)).toBe(false);
    let survivingVersionCount = 0;
    tamperRaw(handle.dbPath, (db) => {
      survivingVersionCount = (
        db.query("SELECT COUNT(*) AS c FROM versions WHERE doc_id = ?").get(doc2.id) as {
          c: number;
        }
      ).c;
    });
    expect(survivingVersionCount).toBe(0);

    const after = openAuditService(handle.dbPath);
    const afterResult = await after.audit.verify();
    expect(afterResult.ok).toBe(true);
    if (afterResult.ok) {
      // The completeness join CANNOT see this attack: doc2's versions row is
      // gone too, so there is no orphaned versions row to report as a miss.
      // This is the exact gap SPEC-079 G3 documents and closes via the chain.
      expect(afterResult.value.misses).toEqual([]);
      // But the independent hash-chain walk DOES catch it: doc3's audit row
      // still stores a prev_hash pointing at doc2's (now-deleted) entry_hash.
      expect(afterResult.value.chain.clean).toBe(false);
      expect(afterResult.value.chain.break).toEqual({
        id: successorAuditId,
        reason: "prev_link_mismatch",
      });
      // clean is the conjunction — a completeness pass alone must never
      // report clean:true when the chain itself is broken.
      expect(afterResult.value.clean).toBe(false);
    }
    after.store.close();
  });

  // ─── G6 (SPEC-080): genesis-row DELETE pin ─────────────────────────────────
  //
  // T4's weakness report #3 predicted this specific shape but left it
  // reasoned-only, not test-pinned: `walkAuditChain`'s `expectedPrevHash`
  // walk always STARTS at `""` (see this file's genesis BOUNDARY test above
  // and the function's own doc comment), so deleting the genesis row does
  // NOT make the chain look empty/clean — the row that survives as the new
  // first entry still carries its ORIGINAL `prev_hash`, which was stamped
  // against the now-deleted genesis row's `entry_hash` and therefore was
  // never `""` to begin with. The walk reports `prev_link_mismatch` at that
  // surviving row's own id, same as any other broken-predecessor attack.

  it("G6: deleting the genesis audit row makes the new first row report prev_link_mismatch (its stored prev_hash is not \"\")", async () => {
    const handle = openFileStore();
    tempDir = handle.tempDir;

    await handle.store.appendAuditEntry(makeAudit({ action: "create" }));
    await handle.store.appendAuditEntry(makeAudit({ action: "update" }));
    await handle.store.appendAuditEntry(makeAudit({ action: "link" }));
    handle.store.close();

    const rowsBefore = rawAuditRows(handle.dbPath);
    expect(rowsBefore).toHaveLength(3);
    expect(rowsBefore[0]!.prev_hash).toBe(""); // the genesis row itself
    const genesisId = rowsBefore[0]!.id;
    const newFirstId = rowsBefore[1]!.id;
    // Sanity: the row that will become the new first row already has a
    // non-empty prev_hash BEFORE the attack — proves the assertion below
    // is testing the deletion's effect, not a tautology of fresh data.
    expect(rowsBefore[1]!.prev_hash).not.toBe("");

    tamperRaw(handle.dbPath, (db) => {
      db.query("DELETE FROM audit WHERE id = ?").run(genesisId);
    });

    // Confirm the genesis row is actually gone — a no-op tamper script would
    // otherwise make the "detected" assertion below vacuously true.
    const rowsAfter = rawAuditRows(handle.dbPath);
    expect(rowsAfter).toHaveLength(2);
    expect(rowsAfter.some((r) => r.id === genesisId)).toBe(false);
    expect(rowsAfter[0]!.id).toBe(newFirstId);
    // The new first row's own stored prev_hash is UNCHANGED by the delete —
    // it still points at the (now-deleted) genesis row's entry_hash, which
    // was never "".
    expect(rowsAfter[0]!.prev_hash).not.toBe("");
    expect(rowsAfter[0]!.prev_hash).not.toBeNull();

    const { store, audit } = openAuditService(handle.dbPath);
    const result = await audit.verify();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chain.clean).toBe(false);
      expect(result.value.chain.break).toEqual({ id: newFirstId, reason: "prev_link_mismatch" });
      expect(result.value.chain.checked).toBe(1);
      expect(result.value.clean).toBe(false);
    }
    store.close();
  });

  // ─── ERROR: NULL-ing a row's hashes → unchained_row ────────────────────────

  it("ERROR: setting a row's prev_hash/entry_hash to NULL in place yields unchained_row at that row's id", async () => {
    const handle = openFileStore();
    tempDir = handle.tempDir;

    await handle.store.appendAuditEntry(makeAudit({ action: "create" }));
    await handle.store.appendAuditEntry(makeAudit({ action: "update" }));
    await handle.store.appendAuditEntry(makeAudit({ action: "delete" }));
    handle.store.close();

    const targetId = rawAuditRows(handle.dbPath)[1]!.id;

    tamperRaw(handle.dbPath, (db) => {
      db.query("UPDATE audit SET prev_hash = NULL, entry_hash = NULL WHERE id = ?").run(targetId);
    });

    const tamperedRow = rawAuditRows(handle.dbPath).find((r) => r.id === targetId);
    expect(tamperedRow?.prev_hash).toBeNull();
    expect(tamperedRow?.entry_hash).toBeNull();

    const { store, audit } = openAuditService(handle.dbPath);
    const result = await audit.verify();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chain.clean).toBe(false);
      expect(result.value.chain.break).toEqual({ id: targetId, reason: "unchained_row" });
    }
    store.close();
  });

  // ─── BOUNDARY ───────────────────────────────────────────────────────────────

  it("BOUNDARY: an empty audit table verifies clean with checked === 0 (negative control)", async () => {
    const handle = openFileStore();
    tempDir = handle.tempDir;

    const result = await handle.store.listAuditChain();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
      const walk = walkAuditChain(result.value);
      expect(walk).toEqual({ clean: true, checked: 0 });
    }

    const audit = new AuditService(handle.store, { verifySince: "2000-01-01T00:00:00.000Z" });
    const verifyResult = await audit.verify();
    expect(verifyResult.ok).toBe(true);
    if (verifyResult.ok) {
      expect(verifyResult.value.clean).toBe(true);
      expect(verifyResult.value.chain).toEqual({ clean: true, checked: 0 });
    }

    handle.store.close();
  });

  it("BOUNDARY: a single-row audit table has genesis prev_hash exactly \"\" and verifies clean", async () => {
    const handle = openFileStore();
    tempDir = handle.tempDir;

    const appendResult = await handle.store.appendAuditEntry(makeAudit({ action: "create" }));
    expect(appendResult.ok).toBe(true);

    const chainResult = await handle.store.listAuditChain();
    expect(chainResult.ok).toBe(true);
    if (chainResult.ok) {
      expect(chainResult.value).toHaveLength(1);
      expect(chainResult.value[0]!.prev_hash).toBe("");
      expect(chainResult.value[0]!.prev_hash).not.toBeNull();

      const walk: AuditChainVerifyResult = walkAuditChain(chainResult.value);
      expect(walk.clean).toBe(true);
      expect(walk.checked).toBe(1);
      expect(walk.break).toBeUndefined();
    }

    handle.store.close();
  });

  it("BOUNDARY/REGRESSION: an untampered multi-row DB verifies clean with checked equal to the row count (negative control)", async () => {
    const handle = openFileStore();
    tempDir = handle.tempDir;

    for (let i = 0; i < 6; i++) {
      const res = await handle.store.appendAuditEntry(makeAudit({ action: `action-${i}` }));
      expect(res.ok).toBe(true);
    }

    const chainResult = await handle.store.listAuditChain();
    expect(chainResult.ok).toBe(true);
    if (chainResult.ok) {
      expect(chainResult.value).toHaveLength(6);
      const walk = walkAuditChain(chainResult.value);
      expect(walk.clean).toBe(true);
      expect(walk.checked).toBe(6);
    }

    const audit = new AuditService(handle.store, { verifySince: "2000-01-01T00:00:00.000Z" });
    const verifyResult = await audit.verify();
    expect(verifyResult.ok).toBe(true);
    if (verifyResult.ok) {
      expect(verifyResult.value.clean).toBe(true);
      expect(verifyResult.value.chain.clean).toBe(true);
      expect(verifyResult.value.chain.checked).toBe(6);
    }

    handle.store.close();
  });

  // ─── STATE: tamper survives further legitimate appends ─────────────────────

  it("STATE: tamper detection on a corrupted prefix is not defeated by further legitimate appends on top of it", async () => {
    const handle = openFileStore();
    tempDir = handle.tempDir;

    await handle.store.appendAuditEntry(makeAudit({ action: "create" }));
    await handle.store.appendAuditEntry(makeAudit({ action: "update", actor: "agent:original" }));
    handle.store.close();

    const targetId = rawAuditRows(handle.dbPath)[1]!.id;
    tamperRaw(handle.dbPath, (db) => {
      db.query("UPDATE audit SET actor = ? WHERE id = ?").run("agent:attacker", targetId);
    });
    expect(rawAuditRows(handle.dbPath).find((r) => r.id === targetId)?.actor).toBe(
      "agent:attacker",
    );

    // Reopen and append MORE legitimate rows on top of the now-tampered
    // prefix — a real operator continuing to use the corpus after an
    // undetected tamper.
    const reopened = actedStore(new SQLiteStore(handle.dbPath));
    const appendA = await reopened.appendAuditEntry(makeAudit({ action: "link" }));
    expect(appendA.ok).toBe(true);
    const appendB = await reopened.appendAuditEntry(makeAudit({ action: "unlink" }));
    expect(appendB.ok).toBe(true);

    const chainResult = await reopened.listAuditChain();
    expect(chainResult.ok).toBe(true);
    if (chainResult.ok) {
      expect(chainResult.value).toHaveLength(4);
      const walk = walkAuditChain(chainResult.value);
      // The break is still reported at the ORIGINAL tampered row, at its
      // ORIGINAL position — not swallowed or shifted by the two rows
      // appended afterward, and `checked` reflects the break's position
      // (2), not the final chain length (4).
      expect(walk.clean).toBe(false);
      expect(walk.checked).toBe(2);
      expect(walk.break).toEqual({ id: targetId, reason: "hash_mismatch" });
    }

    const auditService = new AuditService(reopened, { verifySince: "2000-01-01T00:00:00.000Z" });
    const verifyResult = await auditService.verify();
    expect(verifyResult.ok).toBe(true);
    if (verifyResult.ok) {
      expect(verifyResult.value.clean).toBe(false);
      expect(verifyResult.value.chain.break).toEqual({ id: targetId, reason: "hash_mismatch" });
    }

    reopened.close();
  });
});
