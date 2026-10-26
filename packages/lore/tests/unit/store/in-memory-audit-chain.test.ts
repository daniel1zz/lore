/** @spec_ref AC-079-6 */
/**
 * `InMemoryStore` chain-parity suite for SPEC-079 G3's tamper-evident audit
 * hash chain — proves `InMemoryStore` produces the IDENTICAL chain
 * semantics `audit-chain.bun.test.ts` (AC-079-3) proves for `SQLiteStore`/
 * `TursoStore`: every audit write path (`appendAuditEntry` standalone AND
 * the three `*WithProvenance` composites) extends one shared chain, genesis
 * `prev_hash === ""`, `entry_hash` is the documented sha256 canonical-JSON
 * digest, and the public `AuditEntry` read contract (`queryAudit`) never
 * leaks chain fields.
 *
 * This file is vitest-only (`.test.ts`, no `bun:sqlite`) — `InMemoryStore`
 * has no SQL/migration concept, so there is no migration-009 backfill
 * scenario to mirror here; that coverage lives entirely in the bun-test
 * sibling.
 *
 * Six-dimension coverage:
 *   HAPPY:      `appendAuditEntry` extends the chain across repeated calls;
 *               `insertWithProvenance`/`updateWithProvenance`/
 *               `softDeleteWithProvenance` all extend the SAME chain as a
 *               standalone `appendAuditEntry` call.
 *   NEGATIVE:   two entries with the SAME logical `details` but DIFFERENT
 *               key insertion order produce the IDENTICAL `entry_hash`
 *               (sorted-key canonicalization parity with the real stores).
 *   BOUNDARY:   the very first audit row ever written has `prev_hash`
 *               exactly `""` (not `null`, not `undefined`).
 *   ERROR:      `queryAudit`'s public `AuditEntry` contract never leaks
 *               `prev_hash`/`entry_hash` — only `listAuditChain` exposes it.
 *   STATE:      appending a new entry never mutates an EARLIER entry's
 *               `prev_hash`/`entry_hash`.
 *   REGRESSION: `entry_hash` matches an independently hand-rolled sha256
 *               canonical-JSON digest (PARITY with the documented
 *               algorithm, not merely "InMemoryStore produces SOME stable
 *               value") — the whole point of a parity suite is that it
 *               cannot silently drift from the real stores' algorithm.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { AuditEntry, DocRecord, VersionRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { actedStore } from "../../live-invocation.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(): string {
  _counter += 1;
  return `01HIMACHAIN${String(_counter).padStart(13, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const id = nextId();
  return {
    id,
    slug: `knowledge-im-audit-chain-fixture-${_counter}`,
    type: "knowledge",
    role: "knowledge",
    title: `In-Memory Audit Chain Fixture ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-25T00:00:00.000Z",
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
    timestamp: "2026-07-25T00:00:00.000Z",
    actor: "agent:test",
    session_id: "s1",
    action: "create",
    details: {},
    ...overrides,
  };
}

/**
 * Independently recomputes the SPEC-079 G3 documented canonical-JSON sha256
 * digest (`sha256(canonicalJson({timestamp, actor, session_id, action,
 * doc_id, details, prev_hash}))`, sorted-key `details`) WITHOUT calling
 * `computeAuditEntryHash` — a hand-rolled cross-check against the
 * implementation, not a tautological "call it and compare to itself" test.
 * Byte-identical to `audit-chain.bun.test.ts`'s own helper — this IS the
 * cross-runner parity assertion: both files independently derive the same
 * expected digest and both must agree with their respective store.
 */
function expectedEntryHash(entry: AuditEntry, prevHash: string): string {
  const sortedDetails = Object.fromEntries(
    Object.entries(entry.details ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const payload = {
    timestamp: entry.timestamp,
    actor: entry.actor,
    session_id: entry.session_id,
    action: entry.action,
    doc_id: entry.doc_id ?? null,
    details: sortedDetails,
    prev_hash: prevHash,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Asserts a chain array (already in `id` ASC order) is internally
 * consistent: genesis `prev_hash === ""`, every subsequent row's
 * `prev_hash` equals the immediately preceding row's `entry_hash`, and
 * every `entry_hash` is a well-formed 64-char lowercase hex digest.
 */
function assertChainConsistent(
  chain: { prev_hash: string | null; entry_hash: string | null }[],
): void {
  expect(chain.length).toBeGreaterThan(0);
  expect(chain[0]!.prev_hash).toBe("");
  for (let i = 0; i < chain.length; i++) {
    const row = chain[i]!;
    expect(row.entry_hash).toMatch(/^[0-9a-f]{64}$/);
    if (i > 0) {
      expect(row.prev_hash).toBe(chain[i - 1]!.entry_hash);
    }
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("InMemoryStore — audit hash chain parity (SPEC-079 G3)", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = actedStore(new InMemoryStore());
  });

  afterEach(() => {
    // reason: InMemoryStore holds no external resources (no file handle, no
    // connection) — nothing to release. Present for symmetry with the
    // bun-test sibling's beforeEach/afterEach shape, and as an explicit
    // marker that this was considered, not overlooked.
  });

  it("HAPPY: appendAuditEntry extends the chain across repeated standalone calls", async () => {
    const first = await store.appendAuditEntry(makeAudit({ action: "link" }));
    expect(first.ok).toBe(true);
    const second = await store.appendAuditEntry(makeAudit({ action: "unlink" }));
    expect(second.ok).toBe(true);

    const chainResult = await store.listAuditChain();
    expect(chainResult.ok).toBe(true);
    if (!chainResult.ok) return;
    expect(chainResult.value).toHaveLength(2);
    expect(chainResult.value.map((e) => e.action)).toEqual(["link", "unlink"]);
    assertChainConsistent(chainResult.value);
  });

  it("HAPPY: insertWithProvenance / updateWithProvenance / softDeleteWithProvenance all extend the SAME chain as a standalone appendAuditEntry call", async () => {
    const doc = makeDoc();

    const insertRes = await store.insertWithProvenance(
      doc,
      makeVersion(doc),
      makeAudit({ action: "create", doc_id: doc.id, details: { version: 1 } }),
    );
    expect(insertRes.ok).toBe(true);

    const updatedDoc = { ...doc, title: "Updated Title", version: 2 };
    const updateRes = await store.updateWithProvenance(
      doc.id,
      { title: "Updated Title", version: 2 },
      undefined,
      makeVersion(updatedDoc, { version: 2, action: "update" }),
      makeAudit({ action: "update", doc_id: doc.id, details: { version: 2 } }),
    true,
    );
    expect(updateRes.ok).toBe(true);

    const deleteRes = await store.softDeleteWithProvenance(
      doc.id,
      makeVersion(updatedDoc, { version: 3, action: "delete" }),
      makeAudit({ action: "delete", doc_id: doc.id, details: {} }),
    );
    expect(deleteRes.ok).toBe(true);

    // Interleave a standalone appendAuditEntry too — proves ALL FOUR insert
    // paths share one uninterrupted chain, not four independent mini-chains.
    const standalone = await store.appendAuditEntry(makeAudit({ action: "tree-fix" }));
    expect(standalone.ok).toBe(true);

    const chainResult = await store.listAuditChain();
    expect(chainResult.ok).toBe(true);
    if (!chainResult.ok) return;
    expect(chainResult.value).toHaveLength(4);
    expect(chainResult.value.map((e) => e.action)).toEqual([
      "create",
      "update",
      "delete",
      "tree-fix",
    ]);
    assertChainConsistent(chainResult.value);
  });

  it("NEGATIVE: two entries with the SAME details but DIFFERENT key insertion order produce the IDENTICAL entry_hash", async () => {
    const entryReversedOrder = makeAudit({ details: { b: 2, a: 1 } });
    const resA = await store.appendAuditEntry(entryReversedOrder);
    expect(resA.ok).toBe(true);
    const chainA = await store.listAuditChain();
    expect(chainA.ok).toBe(true);
    if (!chainA.ok) return;
    const hashWithReversedOrder = chainA.value[0]!.entry_hash;

    // Fresh store (genesis prev_hash "" again), same logical details,
    // NORMAL key order — must produce the byte-identical hash.
    const storeB = actedStore(new InMemoryStore());
    const entryNormalOrder = makeAudit({ details: { a: 1, b: 2 } });
    const resB = await storeB.appendAuditEntry(entryNormalOrder);
    expect(resB.ok).toBe(true);
    const chainB = await storeB.listAuditChain();
    expect(chainB.ok).toBe(true);
    if (!chainB.ok) return;
    expect(chainB.value[0]!.entry_hash).toBe(hashWithReversedOrder);
  });

  it("BOUNDARY: the very first audit row ever written has prev_hash exactly \"\" (genesis)", async () => {
    const res = await store.appendAuditEntry(makeAudit());
    expect(res.ok).toBe(true);
    const chainResult = await store.listAuditChain();
    expect(chainResult.ok).toBe(true);
    if (!chainResult.ok) return;
    expect(chainResult.value[0]!.prev_hash).toBe("");
    expect(chainResult.value[0]!.prev_hash).not.toBeNull();
  });

  it("ERROR: queryAudit's public AuditEntry contract never leaks prev_hash/entry_hash", async () => {
    await store.appendAuditEntry(makeAudit({ action: "create" }));
    await store.appendAuditEntry(makeAudit({ action: "update" }));

    const queryResult = await store.queryAudit({});
    expect(queryResult.ok).toBe(true);
    if (!queryResult.ok) return;
    expect(queryResult.value.length).toBeGreaterThan(0);
    for (const entry of queryResult.value) {
      expect("prev_hash" in entry).toBe(false);
      expect("entry_hash" in entry).toBe(false);
    }
  });

  it("STATE: appending a new entry never mutates an EARLIER entry's prev_hash/entry_hash", async () => {
    await store.appendAuditEntry(makeAudit({ action: "create" }));
    const afterFirst = await store.listAuditChain();
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;
    const firstSnapshot = { ...afterFirst.value[0]! };

    await store.appendAuditEntry(makeAudit({ action: "update" }));
    const afterSecond = await store.listAuditChain();
    expect(afterSecond.ok).toBe(true);
    if (!afterSecond.ok) return;

    expect(afterSecond.value[0]!.prev_hash).toBe(firstSnapshot.prev_hash);
    expect(afterSecond.value[0]!.entry_hash).toBe(firstSnapshot.entry_hash);
    expect(afterSecond.value).toHaveLength(2);
  });

  it("REGRESSION: entry_hash matches an independently hand-rolled sha256 canonical-JSON digest (parity with the documented algorithm)", async () => {
    const entry = makeAudit({
      action: "link",
      doc_id: "01HDOC0000000000000000001",
      details: { link_type: "parent", to_id: "01HDOC0000000000000000002" },
    });
    const res = await store.appendAuditEntry(entry);
    expect(res.ok).toBe(true);

    const chainResult = await store.listAuditChain();
    expect(chainResult.ok).toBe(true);
    if (!chainResult.ok) return;
    expect(chainResult.value[0]!.entry_hash).toBe(expectedEntryHash(entry, ""));

    // A second entry chained off the first — prevHash must be the first
    // entry's real entry_hash, not the genesis "" again.
    const second = makeAudit({ action: "update", details: { version: 2 } });
    const res2 = await store.appendAuditEntry(second);
    expect(res2.ok).toBe(true);
    const chain2 = await store.listAuditChain();
    expect(chain2.ok).toBe(true);
    if (!chain2.ok) return;
    expect(chain2.value[1]!.entry_hash).toBe(
      expectedEntryHash(second, chainResult.value[0]!.entry_hash!),
    );
  });

  it("REGRESSION: a fresh store's chain is internally consistent — zero rows verifies trivially clean, then every subsequent write stays consistent", async () => {
    const emptyChain = await store.listAuditChain();
    expect(emptyChain.ok).toBe(true);
    if (!emptyChain.ok) return;
    expect(emptyChain.value).toEqual([]);

    for (let i = 0; i < 5; i++) {
      const res = await store.appendAuditEntry(makeAudit({ action: `action-${i}` }));
      expect(res.ok).toBe(true);
    }

    const finalChain = await store.listAuditChain();
    expect(finalChain.ok).toBe(true);
    if (!finalChain.ok) return;
    expect(finalChain.value).toHaveLength(5);
    assertChainConsistent(finalChain.value);
  });
});
