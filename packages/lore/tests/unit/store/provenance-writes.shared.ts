/**
 * Shared cross-store parity suite for `StoreInterface.insertWithProvenance` /
 * `updateWithProvenance` / `softDeleteWithProvenance` — the three atomic
 * composite writes added to close BUG-002 (audit finding): `CorpusService`
 * previously ran `insert`/`update`/`softDelete` → `insertVersion` →
 * `appendAuditEntry` as THREE independent `await`s, so a failure on step 2 or
 * 3 left the doc PERSISTED with zero version/audit rows and no signal to the
 * caller that partial state landed.
 *
 * This module is NOT itself a test file (no `.test.ts` / `.bun.test.ts`
 * suffix — mirrors `batch-methods.shared.ts`'s established convention). It
 * exports ONE suite-defining function, invoked with the SAME assertions
 * against `SQLiteStore`, `TursoStore` (both `.bun.test.ts`, real
 * `BEGIN IMMEDIATE`/transaction machinery) and `InMemoryStore` (`.test.ts`,
 * manual undo-on-failure).
 *
 * Cross-store ATOMICITY-under-failure technique: rather than a mock/wrapper
 * (store-implementation-specific), every store's REAL `(doc_id, version)`
 * PRIMARY KEY on the `versions` table is exploited — a composite call whose
 * `version` argument collides with an ALREADY-PERSISTED version row makes the
 * version-insert step fail with a real constraint violation, deterministically
 * and identically across all three backends, letting this ONE shared suite
 * prove the SAME rollback guarantee everywhere. (InMemoryStore mirrors this
 * PK collision manually, since it has no real unique-index enforcement of its
 * own — see its `removeVersionEntry`/`insertVersion` semantics.)
 *
 * Six-dimension coverage per method:
 *   HAPPY:      insertWithProvenance / updateWithProvenance /
 *               softDeleteWithProvenance each write doc + version + audit in
 *               one call; all three are independently observable afterward.
 *   NEGATIVE:   insertWithProvenance with a duplicate slug → DUPLICATE_SLUG,
 *               nothing persisted (insert itself never succeeds).
 *   BOUNDARY:   updateWithProvenance with a WRONG expected_version →
 *               STALE_VERSION, the doc is COMPLETELY UNCHANGED (not just
 *               "an error is returned" — verified via a fresh find()).
 *   ERROR:      a version-insert PK collision AFTER a successful doc
 *               insert/update/soft-delete step rolls back ALL of it — the
 *               core BUG-002 atomicity guarantee, exercised on all three
 *               composite methods.
 *   STATE:      after a rolled-back updateWithProvenance, `find()` shows the
 *               doc's PRE-call title/content/version — not a half-applied
 *               patch.
 *   REGRESSION: the pre-existing independent `insert`/`update`/`softDelete`/
 *               `insertVersion`/`appendAuditEntry` methods remain correct
 *               after the internal refactor that extracted their shared sync
 *               cores (SQLiteStore) — spot-checked here since this suite
 *               already exercises every store.
 *
 * @spec_ref audit finding BUG-002 — corpus-service.ts _createImpl/set/delete
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEntry, DocRecord, VersionRecord } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(prefix = "01HPROV"): string {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return `${prefix}${padded}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const id = nextId();
  return {
    id,
    slug: `knowledge-provenance-fixture-${_counter}`,
    type: "knowledge",
    role: "knowledge",
    title: `Provenance Fixture ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "Original content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
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

function makeAudit(doc: DocRecord, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: doc.created_at,
    actor: "system",
    session_id: doc.id,
    action: "create",
    doc_id: doc.id,
    details: { version: doc.version },
    ...overrides,
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

export interface ProvenanceWritesSuiteOpts {
  /** Store implementation name — becomes the outer `describe` label. */
  label: string;
  /** Constructs a fresh, empty store for each test. */
  createStore: () => StoreInterface | Promise<StoreInterface>;
  /** Releases any resources (connection close, temp dir cleanup) after each test. */
  destroyStore: (store: StoreInterface) => void | Promise<void>;
  /**
   * Whether this store enforces a real `(doc_id, version)` uniqueness
   * constraint on `versions` — SQLiteStore/TursoStore do (a real DB PRIMARY
   * KEY), which is what the shared "version-insert PK collision" atomicity
   * tests exploit to force a deterministic, cross-backend-portable step-2
   * failure. `InMemoryStore`'s `insertVersion` is a bare `push()` with no
   * constraint checking (a documented test-double simplification, NOT a
   * bug — the AC-prescribed failure-injection technique for InMemoryStore is
   * a store-double WRAPPER instead, covered by its own dedicated test file:
   * `in-memory-store-provenance-atomicity.test.ts`). Defaults to `true`.
   */
  supportsPkCollisionAtomicity?: boolean;
}

export function runProvenanceWritesSuite(opts: ProvenanceWritesSuiteOpts): void {
  const { label, createStore, destroyStore } = opts;
  const supportsPkCollisionAtomicity = opts.supportsPkCollisionAtomicity ?? true;
  const itIfPkCollision = supportsPkCollisionAtomicity ? it : it.skip;

  describe(`${label} — insertWithProvenance / updateWithProvenance / softDeleteWithProvenance (BUG-002)`, () => {
    let store: StoreInterface;

    beforeEach(async () => {
      store = await createStore();
    });

    afterEach(async () => {
      await destroyStore(store);
    });

    // ── insertWithProvenance ────────────────────────────────────────────

    describe("insertWithProvenance", () => {
      it("HAPPY — writes doc + version + audit in one call, all independently observable", async () => {
        const doc = makeDoc({ title: "Atomic Insert" });
        const result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.id).toBe(doc.id);

        const found = await store.find(doc.id);
        expect(found.ok).toBe(true);
        if (!found.ok) return;
        expect(found.value?.title).toBe("Atomic Insert");

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

      it("NEGATIVE — duplicate slug returns DUPLICATE_SLUG, nothing is persisted", async () => {
        const first = makeDoc({ slug: "knowledge-duplicate-provenance-slug" });
        const firstResult = await store.insertWithProvenance(first, makeVersion(first), makeAudit(first));
        expect(firstResult.ok).toBe(true);

        const second = makeDoc({ slug: "knowledge-duplicate-provenance-slug" });
        const secondResult = await store.insertWithProvenance(second, makeVersion(second), makeAudit(second));
        expect(secondResult.ok).toBe(false);
        if (secondResult.ok) return;
        expect(secondResult.error.code).toBe("DUPLICATE_SLUG");

        const found = await store.find(second.id);
        expect(found.ok).toBe(true);
        if (!found.ok) return;
        expect(found.value).toBeNull();
      });

      itIfPkCollision("ERROR/ATOMICITY — a version-insert PK collision after a successful doc insert rolls back the doc too", async () => {
        // reason: seed an existing doc so its version-1 row occupies (existingDoc.id, 1)
        // in the versions table's real PRIMARY KEY.
        const existingDoc = makeDoc({ title: "Existing Doc" });
        const seedResult = await store.insertWithProvenance(
          existingDoc,
          makeVersion(existingDoc),
          makeAudit(existingDoc),
        );
        expect(seedResult.ok).toBe(true);

        // A brand-new doc whose OWN insert would succeed on its own — but its
        // version record deliberately points at existingDoc's (doc_id, version)
        // pair, colliding with the row seeded above and forcing step 2 to fail
        // AFTER step 1 (the new doc's own INSERT) already succeeded.
        const newDoc = makeDoc({ title: "Should Never Persist" });
        const collidingVersion = makeVersion(newDoc, {
          doc_id: existingDoc.id, // deliberate collision, not newDoc.id
          version: existingDoc.version,
        });

        const result = await store.insertWithProvenance(newDoc, collidingVersion, makeAudit(newDoc));
        expect(result.ok).toBe(false);

        // The core BUG-002 assertion: newDoc must NOT be observable afterward —
        // its own successful step-1 INSERT was rolled back along with the
        // failed step-2 version insert.
        const found = await store.find(newDoc.id);
        expect(found.ok).toBe(true);
        if (!found.ok) return;
        expect(found.value).toBeNull();
      });
    });

    // ── updateWithProvenance ────────────────────────────────────────────

    describe("updateWithProvenance", () => {
      async function seedDoc(overrides: Partial<DocRecord> = {}): Promise<DocRecord> {
        const doc = makeDoc({ title: "Pre-Update Title", content: "Pre-update content", ...overrides });
        const result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
        if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result.error)}`);
        return result.value;
      }

      it("HAPPY — patches the doc and writes the version + audit row in one call", async () => {
        const doc = await seedDoc();

        const patch: Partial<DocRecord> = { title: "Patched Title", version: 2 };
        const version = makeVersion(doc, { version: 2, title: "Patched Title", action: "update" });
        const audit = makeAudit(doc, { action: "update", details: { version: 2 } });

        const result = await store.updateWithProvenance(
          doc.id,
          patch,
          { expected_version: 1 },
          version,
          audit,
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.title).toBe("Patched Title");
        expect(result.value.version).toBe(2);

        const versions = await store.findVersions(doc.id);
        expect(versions.ok).toBe(true);
        if (!versions.ok) return;
        expect(versions.value).toHaveLength(2);

        const audits = await store.queryAudit({ doc_id: doc.id, action: "update" });
        expect(audits.ok).toBe(true);
        if (!audits.ok) return;
        expect(audits.value).toHaveLength(1);
      });

      it("BOUNDARY — a stale expected_version returns STALE_VERSION and leaves the doc COMPLETELY unchanged", async () => {
        const doc = await seedDoc({ title: "Untouched Title", content: "Untouched content" });

        const patch: Partial<DocRecord> = { title: "Should Never Apply", version: 2 };
        const version = makeVersion(doc, { version: 2, title: "Should Never Apply", action: "update" });
        const audit = makeAudit(doc, { action: "update", details: { version: 2 } });

        const result = await store.updateWithProvenance(
          doc.id,
          patch,
          { expected_version: 999 }, // deliberately stale
          version,
          audit,
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("STALE_VERSION");

        const found = await store.find(doc.id);
        expect(found.ok).toBe(true);
        if (!found.ok) return;
        expect(found.value?.title).toBe("Untouched Title");
        expect(found.value?.content).toBe("Untouched content");
        expect(found.value?.version).toBe(1);

        const versions = await store.findVersions(doc.id);
        expect(versions.ok).toBe(true);
        if (!versions.ok) return;
        expect(versions.value).toHaveLength(1); // only the seed version — no phantom row
      });

      itIfPkCollision("ERROR/STATE — a version-insert PK collision rolls back an already-successful doc UPDATE (doc reverts to its pre-call snapshot)", async () => {
        const doc = await seedDoc({ title: "Should Revert", content: "Should Revert Content" });

        const patch: Partial<DocRecord> = { title: "Must Not Persist", version: 2 };
        // Deliberately colliding: version 1 already exists for this doc from the seed.
        const collidingVersion = makeVersion(doc, { version: 1, title: "Must Not Persist", action: "update" });
        const audit = makeAudit(doc, { action: "update", details: { version: 2 } });

        const result = await store.updateWithProvenance(
          doc.id,
          patch,
          { expected_version: 1 }, // matches the doc's TRUE current version — the doc UPDATE succeeds
          collidingVersion,
          audit,
        );
        expect(result.ok).toBe(false);

        // STATE: the doc UPDATE step succeeded in isolation but must have been
        // rolled back along with the failed version insert.
        const found = await store.find(doc.id);
        expect(found.ok).toBe(true);
        if (!found.ok) return;
        expect(found.value?.title).toBe("Should Revert");
        expect(found.value?.content).toBe("Should Revert Content");
        expect(found.value?.version).toBe(1);

        // No phantom second version or audit row.
        const versions = await store.findVersions(doc.id);
        expect(versions.ok).toBe(true);
        if (!versions.ok) return;
        expect(versions.value).toHaveLength(1);

        const audits = await store.queryAudit({ doc_id: doc.id, action: "update" });
        expect(audits.ok).toBe(true);
        if (!audits.ok) return;
        expect(audits.value).toHaveLength(0);
      });

      it("NEGATIVE — updating a nonexistent doc returns DOC_NOT_FOUND", async () => {
        const phantomDoc = makeDoc();
        const result = await store.updateWithProvenance(
          "01HDOESNOTEXIST00000001",
          { title: "x" },
          undefined,
          makeVersion(phantomDoc),
          makeAudit(phantomDoc),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DOC_NOT_FOUND");
      });
    });

    // ── softDeleteWithProvenance ─────────────────────────────────────────

    // ── updateWithProvenance: companion doc writes (BR-1307) ─────────────

    describe("updateWithProvenance also_update (task-deprecating-a-spec-retires-its-proposed-rule-ids-in-the)", () => {
      async function seed(title: string): Promise<DocRecord> {
        const doc = makeDoc({ title });
        const result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
        if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result.error)}`);
        return result.value;
      }

      function companionOf(doc: DocRecord, title: string, expectedVersion: number) {
        return {
          id: doc.id,
          patch: { title, version: expectedVersion + 1 } as Partial<DocRecord>,
          opts: { expected_version: expectedVersion },
          version: makeVersion(doc, { version: expectedVersion + 1, title, action: "update" }),
          audit: makeAudit(doc, { action: "update", details: { version: expectedVersion + 1 } }),
        };
      }

      it("HAPPY — the primary doc and its companion both commit with their own version and audit rows", async () => {
        const primary = await seed("Primary");
        const companion = await seed("Companion");

        const result = await store.updateWithProvenance(
          primary.id,
          { title: "Primary done", version: 2 },
          { expected_version: 1 },
          makeVersion(primary, { version: 2, title: "Primary done", action: "update" }),
          makeAudit(primary, { action: "update", details: { version: 2 } }),
          { also_update: [companionOf(companion, "Companion done", 1)] },
        );
        expect(result.ok).toBe(true);

        const foundCompanion = await store.find(companion.id);
        expect(foundCompanion.ok && foundCompanion.value?.title).toBe("Companion done");
        expect(foundCompanion.ok && foundCompanion.value?.version).toBe(2);
        const versions = await store.findVersions(companion.id);
        expect(versions.ok && versions.value).toHaveLength(2);
        const audits = await store.queryAudit({ doc_id: companion.id, action: "update" });
        expect(audits.ok && audits.value).toHaveLength(1);
      });

      it("ERROR/STATE — a companion CAS miss refuses with STALE_VERSION and the primary write is rolled back", async () => {
        const primary = await seed("Primary stays");
        const companion = await seed("Companion stays");

        const result = await store.updateWithProvenance(
          primary.id,
          { title: "Must not persist", version: 2 },
          { expected_version: 1 },
          makeVersion(primary, { version: 2, title: "Must not persist", action: "update" }),
          makeAudit(primary, { action: "update", details: { version: 2 } }),
          { also_update: [companionOf(companion, "Must not persist either", 7)] }, // wrong CAS base
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("STALE_VERSION");

        const foundPrimary = await store.find(primary.id);
        expect(foundPrimary.ok && foundPrimary.value?.title).toBe("Primary stays");
        expect(foundPrimary.ok && foundPrimary.value?.version).toBe(1);
        const primaryVersions = await store.findVersions(primary.id);
        expect(primaryVersions.ok && primaryVersions.value).toHaveLength(1);
        const primaryAudits = await store.queryAudit({ doc_id: primary.id, action: "update" });
        expect(primaryAudits.ok && primaryAudits.value).toHaveLength(0);
        const foundCompanion = await store.find(companion.id);
        expect(foundCompanion.ok && foundCompanion.value?.title).toBe("Companion stays");
      });

      it("NEGATIVE — a companion doc that does not exist refuses and writes nothing", async () => {
        const primary = await seed("Primary alone");
        const phantom = makeDoc({ title: "Phantom" });

        const result = await store.updateWithProvenance(
          primary.id,
          { title: "Must not persist", version: 2 },
          { expected_version: 1 },
          makeVersion(primary, { version: 2, title: "Must not persist", action: "update" }),
          makeAudit(primary, { action: "update", details: { version: 2 } }),
          { also_update: [companionOf(phantom, "x", 1)] },
        );
        expect(result.ok).toBe(false);
        const foundPrimary = await store.find(primary.id);
        expect(foundPrimary.ok && foundPrimary.value?.title).toBe("Primary alone");
      });
    });

    describe("softDeleteWithProvenance", () => {
      async function seedDoc(): Promise<DocRecord> {
        const doc = makeDoc({ title: "To Be Deleted" });
        const result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
        if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result.error)}`);
        return result.value;
      }

      it("HAPPY — soft-deletes the doc and writes the version-0 sentinel + delete audit entry in one call", async () => {
        const doc = await seedDoc();

        const version = makeVersion(doc, {
          version: 0,
          content: "",
          extra: {},
          status: "archived",
          title: "",
          action: "delete",
        });
        const audit = makeAudit(doc, { action: "delete", details: { version: 0 } });

        const result = await store.softDeleteWithProvenance(doc.id, version, audit);
        expect(result.ok).toBe(true);

        const found = await store.find(doc.id);
        expect(found.ok).toBe(true);
        if (!found.ok) return;
        expect(found.value?.deleted_at).not.toBeNull();

        const versions = await store.findVersions(doc.id);
        expect(versions.ok).toBe(true);
        if (!versions.ok) return;
        expect(versions.value.some((v) => v.action === "delete" && v.version === 0)).toBe(true);

        const audits = await store.queryAudit({ doc_id: doc.id, action: "delete" });
        expect(audits.ok).toBe(true);
        if (!audits.ok) return;
        expect(audits.value).toHaveLength(1);
      });

      itIfPkCollision("ERROR/STATE — a version-insert PK collision rolls back an already-successful soft-delete (deleted_at reverts to null)", async () => {
        const doc = await seedDoc();

        // Deliberately colliding: version 1 already exists for this doc from the seed
        // (the delete sentinel normally targets version 0, but here we sabotage it to
        // collide with the SEED's version-1 row instead, forcing the failure).
        const collidingVersion = makeVersion(doc, { version: 1, action: "delete" });
        const audit = makeAudit(doc, { action: "delete", details: { version: 0 } });

        const result = await store.softDeleteWithProvenance(doc.id, collidingVersion, audit);
        expect(result.ok).toBe(false);

        const found = await store.find(doc.id);
        expect(found.ok).toBe(true);
        if (!found.ok) return;
        expect(found.value?.deleted_at).toBeNull();

        const audits = await store.queryAudit({ doc_id: doc.id, action: "delete" });
        expect(audits.ok).toBe(true);
        if (!audits.ok) return;
        expect(audits.value).toHaveLength(0);
      });

      it("NEGATIVE — soft-deleting a nonexistent doc returns DOC_NOT_FOUND", async () => {
        const phantomDoc = makeDoc();
        const result = await store.softDeleteWithProvenance(
          "01HDOESNOTEXIST00000002",
          makeVersion(phantomDoc, { version: 0, action: "delete" }),
          makeAudit(phantomDoc, { action: "delete" }),
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DOC_NOT_FOUND");
      });
    });

    // ── REGRESSION — pre-existing independent methods stay correct ──────

    describe("regression — independent insert/update/softDelete/insertVersion/appendAuditEntry", () => {
      it("insert still returns DUPLICATE_SLUG on a slug collision (post-refactor sync-core split)", async () => {
        const a = makeDoc({ slug: "knowledge-regression-slug" });
        await store.insert(a);
        const b = makeDoc({ slug: "knowledge-regression-slug" });
        const result = await store.insert(b);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("DUPLICATE_SLUG");
      });

      it("update's CAS behavior (expected_version) is unaffected by the sync-core split", async () => {
        const doc = makeDoc();
        await store.insert(doc);
        // reason: store.update() never auto-increments `version` — the CALLER's
        // patch must bump it explicitly (CorpusService.set does this). Bumping to
        // 2 here is what makes the SECOND call's stale `expected_version: 1`
        // genuinely stale against the row's real current version.
        const ok1 = await store.update(doc.id, { title: "v2", version: 2 }, { expected_version: 1 });
        expect(ok1.ok).toBe(true);
        const stale = await store.update(doc.id, { title: "v3", version: 3 }, { expected_version: 1 });
        expect(stale.ok).toBe(false);
        if (stale.ok) return;
        expect(stale.error.code).toBe("STALE_VERSION");
      });

      it("softDelete still marks deleted_at independently of the composite method", async () => {
        const doc = makeDoc();
        await store.insert(doc);
        const result = await store.softDelete(doc.id);
        expect(result.ok).toBe(true);
        const found = await store.find(doc.id);
        expect(found.ok).toBe(true);
        if (!found.ok) return;
        expect(found.value?.deleted_at).not.toBeNull();
      });

      it("insertVersion / appendAuditEntry remain independently callable outside a composite call", async () => {
        const doc = makeDoc();
        await store.insert(doc);
        const v = await store.insertVersion(makeVersion(doc));
        expect(v.ok).toBe(true);
        const a = await store.appendAuditEntry(makeAudit(doc));
        expect(a.ok).toBe(true);
      });
    });
  });
}
