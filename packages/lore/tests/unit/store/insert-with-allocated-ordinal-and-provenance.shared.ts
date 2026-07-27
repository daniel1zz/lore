/**
 * Shared cross-store parity suite for
 * `StoreInterface.insertWithAllocatedOrdinalAndProvenance` — the ordinal-aware
 * sibling of `insertWithProvenance` (task-skill-implement-ordinal-aware-
 * provenance-composite, closing the BUG-002 window `CorpusService._createImpl`'s
 * numbered (spec/adr) create path had reintroduced: that path previously ran
 * `insertWithAllocatedOrdinal` → `insertVersion` → `appendAuditEntry` as THREE
 * independent `await`s, so a version/audit failure after a successful
 * ordinal-numbered insert left a PERMANENTLY orphaned doc row — allocated
 * ordinal, zero version history, zero audit trail).
 *
 * Mirrors `provenance-writes.shared.ts`'s established shape (suite-defining
 * function, invoked identically against SQLiteStore/TursoStore under
 * `bun test` and InMemoryStore under vitest) — see that file's header for the
 * full rationale of why this is a `.shared.ts` module (no test-runner import,
 * no `.test.ts`/`.bun.test.ts` suffix).
 *
 * Cross-store ATOMICITY-under-failure technique: identical to
 * `provenance-writes.shared.ts` — a composite call whose `version` argument
 * collides with an ALREADY-PERSISTED `(doc_id, version)` row makes the
 * version-insert step fail with a real constraint violation on SQLite/Turso.
 * InMemoryStore has no such real constraint (`supportsPkCollisionAtomicity:
 * false`, same documented gap `provenance-writes.shared.ts` carries) — its
 * dedicated failure-injection coverage lives in
 * `in-memory-store-ordinal-provenance-atomicity.test.ts`.
 *
 * Six-dimension coverage:
 *   HAPPY:      writes doc (with an allocated ordinal) + version + audit in
 *               one call; all three independently observable afterward.
 *   NEGATIVE:   a duplicate slug returns DUPLICATE_SLUG, nothing persisted —
 *               AND the ordinal candidate the failed attempt would have used
 *               is NOT burned (the next successful insert of the SAME type
 *               still lands on ordinal 1).
 *   BOUNDARY:   two sequential calls for the same type allocate 1, then 2 —
 *               the allocation-then-provenance composite doesn't disturb the
 *               plain MAX+1 sequencing `insertWithAllocatedOrdinal` alone
 *               already guarantees.
 *   ERROR:      a version-insert PK collision AFTER a successful
 *               ordinal-numbered doc insert rolls back ALL of it — the core
 *               BUG-002-closure atomicity guarantee for the numbered path.
 *   STATE:      after that rollback, a FRESH, non-colliding call for the same
 *               type lands on the SAME ordinal the rolled-back attempt used —
 *               proof the candidate was never burned (rollback undoes the
 *               MAX-raising insert too, not just returns an error).
 *   REGRESSION: the pre-existing independent `insertWithAllocatedOrdinal` /
 *               `insertVersion` / `appendAuditEntry` methods remain correct
 *               after this composite's addition.
 *
 * @spec_ref task-skill-implement-ordinal-aware-provenance-composite (SPEC-084 follow-up, BUG-002)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry, DocRecord, VersionRecord } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(prefix = "01HORDPROV"): string {
  _counter += 1;
  const padded = String(_counter).padStart(16, "0");
  return `${prefix}${padded}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const id = nextId();
  return {
    id,
    slug: `spec-ordinal-provenance-fixture-${_counter}`,
    type: "spec",
    role: "spec",
    title: `Ordinal Provenance Fixture ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "Original content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T00:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ordinal: null,
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
    slug: doc.slug,
    ...overrides,
  };
}

function makeAudit(doc: DocRecord, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: doc.created_at,
    actor: "system",
    session_id: doc.id,
    action: "create",
    doc_id: doc.id,
    details: { type: doc.type, slug: doc.slug, version: doc.version },
    ...overrides,
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

export interface OrdinalProvenanceSuiteOpts {
  /** Store implementation name — becomes the outer `describe` label. */
  label: string;
  /** Constructs a fresh, empty store for each test. */
  createStore: () => StoreInterface | Promise<StoreInterface>;
  /** Releases any resources (connection close, temp dir cleanup) after each test. */
  destroyStore: (store: StoreInterface) => void | Promise<void>;
  /**
   * Whether this store enforces a real `(doc_id, version)` uniqueness
   * constraint on `versions` — same documented gap as
   * `provenance-writes.shared.ts`'s identically-named option. Defaults to
   * `true`; `InMemoryStore`'s consumer sets this to `false` and relies on its
   * own dedicated failure-injection suite instead.
   */
  supportsPkCollisionAtomicity?: boolean;
}

export function runInsertWithAllocatedOrdinalAndProvenanceSuite(opts: OrdinalProvenanceSuiteOpts): void {
  const { label, createStore, destroyStore } = opts;
  const supportsPkCollisionAtomicity = opts.supportsPkCollisionAtomicity ?? true;
  const itIfPkCollision = supportsPkCollisionAtomicity ? it : it.skip;

  describe(`${label} — insertWithAllocatedOrdinalAndProvenance`, () => {
    let store: StoreInterface;

    beforeEach(async () => {
      store = await createStore();
    });

    afterEach(async () => {
      await destroyStore(store);
    });

    it("HAPPY — allocates an ordinal and writes doc + version + audit in one call, all independently observable", async () => {
      const doc = makeDoc({ title: "Atomic Ordinal Insert" });
      const result = await store.insertWithAllocatedOrdinalAndProvenance(
        doc,
        makeVersion(doc),
        makeAudit(doc),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(doc.id);
      expect(result.value.ordinal).toBe(1);

      const found = await store.find(doc.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value?.title).toBe("Atomic Ordinal Insert");
      expect(found.value?.ordinal).toBe(1);

      const versions = await store.findVersions(doc.id);
      expect(versions.ok).toBe(true);
      if (!versions.ok) return;
      expect(versions.value).toHaveLength(1);
      expect(versions.value[0]?.action).toBe("create");

      const audit = await store.queryAudit({ doc_id: doc.id });
      expect(audit.ok).toBe(true);
      if (!audit.ok) return;
      expect(audit.value).toHaveLength(1);
      expect(audit.value[0]?.action).toBe("create");
    });

    it("BOUNDARY — two sequential calls for the same type allocate 1, then 2", async () => {
      const first = makeDoc({ title: "First" });
      const firstResult = await store.insertWithAllocatedOrdinalAndProvenance(
        first,
        makeVersion(first),
        makeAudit(first),
      );
      expect(firstResult.ok).toBe(true);
      if (firstResult.ok) expect(firstResult.value.ordinal).toBe(1);

      const second = makeDoc({ title: "Second" });
      const secondResult = await store.insertWithAllocatedOrdinalAndProvenance(
        second,
        makeVersion(second),
        makeAudit(second),
      );
      expect(secondResult.ok).toBe(true);
      if (secondResult.ok) expect(secondResult.value.ordinal).toBe(2);
    });

    it("NEGATIVE — duplicate slug returns DUPLICATE_SLUG, nothing persisted, and the ordinal is not burned", async () => {
      const first = makeDoc({ slug: "spec-duplicate-ordinal-provenance-slug" });
      const firstResult = await store.insertWithAllocatedOrdinalAndProvenance(
        first,
        makeVersion(first),
        makeAudit(first),
      );
      expect(firstResult.ok).toBe(true);
      if (firstResult.ok) expect(firstResult.value.ordinal).toBe(1);

      const second = makeDoc({ slug: "spec-duplicate-ordinal-provenance-slug" });
      const secondResult = await store.insertWithAllocatedOrdinalAndProvenance(
        second,
        makeVersion(second),
        makeAudit(second),
      );
      expect(secondResult.ok).toBe(false);
      if (secondResult.ok) return;
      expect(secondResult.error.code).toBe("DUPLICATE_SLUG");

      const found = await store.find(second.id);
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value).toBeNull();

      // A THIRD, non-colliding doc still lands on ordinal 2 — the failed
      // duplicate-slug attempt never burned ordinal 2 for itself, since its
      // OWN doc insert never even reached the ordinal-collision branch (the
      // slug conflict fails first, independent of ordinal allocation).
      const third = makeDoc({ title: "Third" });
      const thirdResult = await store.insertWithAllocatedOrdinalAndProvenance(
        third,
        makeVersion(third),
        makeAudit(third),
      );
      expect(thirdResult.ok).toBe(true);
      if (thirdResult.ok) expect(thirdResult.value.ordinal).toBe(2);
    });

    itIfPkCollision(
      "ERROR/ATOMICITY — a version-insert PK collision after a successful ordinal-numbered doc insert rolls back the doc too",
      async () => {
        // reason: seed an existing doc so its version-1 row occupies
        // (existingDoc.id, 1) in the versions table's real PRIMARY KEY.
        const existingDoc = makeDoc({ title: "Existing Doc" });
        const seedResult = await store.insertWithAllocatedOrdinalAndProvenance(
          existingDoc,
          makeVersion(existingDoc),
          makeAudit(existingDoc),
        );
        expect(seedResult.ok).toBe(true);
        if (seedResult.ok) expect(seedResult.value.ordinal).toBe(1);

        // A brand-new doc whose OWN insert (including ordinal allocation)
        // would succeed on its own — but its version record deliberately
        // points at existingDoc's (doc_id, version) pair, colliding with the
        // row seeded above and forcing step 2 to fail AFTER step 1 (the new
        // doc's own ordinal-numbered INSERT) already succeeded.
        const newDoc = makeDoc({ title: "Should Never Persist" });
        const collidingVersion = makeVersion(newDoc, {
          doc_id: existingDoc.id, // deliberate collision, not newDoc.id
          version: existingDoc.version,
        });

        const result = await store.insertWithAllocatedOrdinalAndProvenance(
          newDoc,
          collidingVersion,
          makeAudit(newDoc),
        );
        expect(result.ok).toBe(false);

        // The core atomicity assertion: newDoc must NOT be observable
        // afterward — its own successful step-1 ordinal-numbered INSERT was
        // rolled back along with the failed step-2 version insert.
        const found = await store.find(newDoc.id);
        expect(found.ok).toBe(true);
        if (!found.ok) return;
        expect(found.value).toBeNull();

        // STATE — the ordinal candidate (2) the rolled-back attempt used is
        // NOT burned: a FRESH, non-colliding call for the same type lands on
        // the SAME ordinal 2, proving the rollback undid the MAX-raising
        // insert itself, not merely surfaced an error on top of a persisted
        // row.
        const freshDoc = makeDoc({ title: "Fresh, Should Get Ordinal 2" });
        const freshResult = await store.insertWithAllocatedOrdinalAndProvenance(
          freshDoc,
          makeVersion(freshDoc),
          makeAudit(freshDoc),
        );
        expect(freshResult.ok).toBe(true);
        if (!freshResult.ok) return;
        expect(freshResult.value.ordinal).toBe(2);
      },
    );

    // ── REGRESSION — pre-existing independent methods stay correct ──────

    describe("regression — independent insertWithAllocatedOrdinal/insertVersion/appendAuditEntry", () => {
      it("insertWithAllocatedOrdinal still allocates independently of the new composite", async () => {
        const doc = makeDoc({ title: "Independent Alloc" });
        const result = await store.insertWithAllocatedOrdinal(doc);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.ordinal).toBe(1);
      });

      it("insertVersion / appendAuditEntry remain independently callable outside the composite", async () => {
        const doc = makeDoc();
        await store.insertWithAllocatedOrdinal(doc);
        const v = await store.insertVersion(makeVersion(doc));
        expect(v.ok).toBe(true);
        const a = await store.appendAuditEntry(makeAudit(doc));
        expect(a.ok).toBe(true);
      });
    });
  });
}
