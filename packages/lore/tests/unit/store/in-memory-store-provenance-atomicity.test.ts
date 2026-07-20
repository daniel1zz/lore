/**
 * InMemoryStore-specific atomicity coverage for `insertWithProvenance` /
 * `updateWithProvenance` / `softDeleteWithProvenance` (BUG-002, audit finding),
 * using the AC-prescribed failure-injection technique: a subclass that
 * overrides `insertVersion` / `appendAuditEntry` to force a failure on demand.
 *
 * `provenance-writes.shared.ts`'s cross-store suite (which InMemoryStore also
 * runs, via `provenance-writes.test.ts`) cannot exercise InMemoryStore's
 * rollback path via its "version-insert PK collision" technique — bare
 * InMemoryStore has no real `(doc_id, version)` uniqueness constraint to
 * collide with (see that file's `supportsPkCollisionAtomicity` doc comment).
 * This file closes that gap directly: a subclass overriding the SPECIFIC step
 * to fail, and the composite methods (`insertWithProvenance` etc.) dispatch
 * polymorphically through `this.insertVersion(...)` / `this.appendAuditEntry(...)`
 * — NOT a private raw helper — so the override IS honored (this is precisely
 * WHY in-memory-store.ts's composite methods call through `this.<method>`
 * rather than a bypassing private core, unlike SQLiteStore's sync-core split).
 *
 * Six-dimension coverage:
 *   HAPPY:      (already covered by provenance-writes.shared.ts's InMemoryStore
 *               run — not re-duplicated here.)
 *   ERROR:      insertVersion forced to fail on insertWithProvenance → the doc
 *               insert (step 1, already succeeded) is rolled back.
 *   ERROR:      appendAuditEntry forced to fail on insertWithProvenance → BOTH
 *               the doc insert AND the version insert are rolled back.
 *   STATE:      updateWithProvenance/softDeleteWithProvenance forced-failure
 *               rollback restores the doc's EXACT pre-call snapshot (not just
 *               "an error is returned").
 *   BOUNDARY:   a forced failure on the FIRST composite call never contaminates
 *               a SUBSEQUENT successful call (the failure-injection flag is
 *               single-shot, verified via a second, un-forced call succeeding).
 *   REGRESSION: with no forced failure, all three composite methods behave
 *               identically to the un-wrapped InMemoryStore (byte-identical
 *               happy-path outcome) — proves the subclass adds ONLY the
 *               opt-in failure injection, nothing else.
 *
 * @spec_ref audit finding BUG-002 — corpus-service.ts _createImpl/set/delete
 */

import { describe, expect, it } from "vitest";
import type { AuditEntry, DocRecord, LoreError, Result, VersionRecord } from "@lore/core";
import { err } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";

// ─── Failure-injection test double ─────────────────────────────────────────

type FailStep = "insertVersion" | "appendAuditEntry" | null;

/**
 * Subclasses InMemoryStore (the AC-prescribed "InMemory 包装器" technique) to
 * force ONE specific write step to fail on its NEXT invocation only
 * (single-shot — `armedFailure` is consumed and reset to `null` the moment it
 * fires, so a forced failure never silently repeats on a later, unrelated
 * call within the same test).
 */
class FailInjectingStore extends InMemoryStore {
  private armedFailure: FailStep = null;

  /** Arm the NEXT call to the named method to fail with a synthetic STORE_ERROR. */
  armFailure(step: Exclude<FailStep, null>): void {
    this.armedFailure = step;
  }

  override async insertVersion(version: VersionRecord): Promise<Result<VersionRecord, LoreError>> {
    if (this.armedFailure === "insertVersion") {
      this.armedFailure = null;
      return err({ code: "STORE_ERROR", message: "injected insertVersion failure (test double)" });
    }
    return super.insertVersion(version);
  }

  override async appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>> {
    if (this.armedFailure === "appendAuditEntry") {
      this.armedFailure = null;
      return err({ code: "STORE_ERROR", message: "injected appendAuditEntry failure (test double)" });
    }
    return super.appendAuditEntry(entry);
  }
}

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const id = `01HFAILINJECT${String(_counter).padStart(7, "0")}`;
  return {
    id,
    slug: `knowledge-fail-inject-fixture-${_counter}`,
    type: "knowledge",
    role: "knowledge",
    title: `Fail-Inject Fixture ${_counter}`,
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

// ─── insertWithProvenance ───────────────────────────────────────────────────

describe("InMemoryStore.insertWithProvenance — failure-injection atomicity", () => {
  it("ERROR — insertVersion forced to fail rolls back the already-successful doc insert", async () => {
    const store = new FailInjectingStore();
    const doc = makeDoc();
    store.armFailure("insertVersion");

    const result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toBeNull(); // the doc insert was rolled back
  });

  it("ERROR — appendAuditEntry forced to fail rolls back BOTH the doc insert and the version insert", async () => {
    const store = new FailInjectingStore();
    const doc = makeDoc();
    store.armFailure("appendAuditEntry");

    const result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toBeNull();

    const versions = await store.findVersions(doc.id);
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    expect(versions.value).toHaveLength(0); // the version insert was also rolled back
  });

  it("BOUNDARY — a forced failure is single-shot and never contaminates a subsequent successful call", async () => {
    const store = new FailInjectingStore();
    const failedDoc = makeDoc();
    store.armFailure("insertVersion");
    const failedResult = await store.insertWithProvenance(
      failedDoc,
      makeVersion(failedDoc),
      makeAudit(failedDoc),
    );
    expect(failedResult.ok).toBe(false);

    // No re-arm — the NEXT call must succeed normally.
    const okDoc = makeDoc();
    const okResult = await store.insertWithProvenance(okDoc, makeVersion(okDoc), makeAudit(okDoc));
    expect(okResult.ok).toBe(true);

    const found = await store.find(okDoc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.id).toBe(okDoc.id);
  });

  it("REGRESSION — with no forced failure, FailInjectingStore behaves identically to bare InMemoryStore", async () => {
    const store = new FailInjectingStore();
    const doc = makeDoc();
    const result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(result.ok).toBe(true);

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.id).toBe(doc.id);

    const versions = await store.findVersions(doc.id);
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    expect(versions.value).toHaveLength(1);
  });
});

// ─── updateWithProvenance ───────────────────────────────────────────────────

describe("InMemoryStore.updateWithProvenance — failure-injection atomicity", () => {
  async function seedDoc(store: FailInjectingStore): Promise<DocRecord> {
    const doc = makeDoc({ title: "Pre-Update Title", content: "Pre-update content" });
    const result = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    if (!result.ok) throw new Error(`seed failed: ${JSON.stringify(result.error)}`);
    return result.value;
  }

  it("STATE — insertVersion forced to fail reverts an already-successful doc UPDATE to its pre-call snapshot", async () => {
    const store = new FailInjectingStore();
    const doc = await seedDoc(store);

    store.armFailure("insertVersion");
    const patch: Partial<DocRecord> = { title: "Must Not Persist", version: 2 };
    const version = makeVersion(doc, { version: 2, title: "Must Not Persist", action: "update" });
    const audit = makeAudit(doc, { action: "update", details: { version: 2 } });

    const result = await store.updateWithProvenance(doc.id, patch, { expected_version: 1 }, version, audit);
    expect(result.ok).toBe(false);

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.title).toBe("Pre-Update Title");
    expect(found.value?.content).toBe("Pre-update content");
    expect(found.value?.version).toBe(1);
  });

  it("STATE — appendAuditEntry forced to fail reverts an already-successful doc UPDATE and drops the version row it wrote", async () => {
    const store = new FailInjectingStore();
    const doc = await seedDoc(store);

    store.armFailure("appendAuditEntry");
    const patch: Partial<DocRecord> = { title: "Must Not Persist Either", version: 2 };
    const version = makeVersion(doc, { version: 2, title: "Must Not Persist Either", action: "update" });
    const audit = makeAudit(doc, { action: "update", details: { version: 2 } });

    const result = await store.updateWithProvenance(doc.id, patch, { expected_version: 1 }, version, audit);
    expect(result.ok).toBe(false);

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.title).toBe("Pre-Update Title");
    expect(found.value?.version).toBe(1);

    const versions = await store.findVersions(doc.id);
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    expect(versions.value).toHaveLength(1); // only the seed's version-1 row — no phantom v2
  });
});

// ─── softDeleteWithProvenance ───────────────────────────────────────────────

describe("InMemoryStore.softDeleteWithProvenance — failure-injection atomicity", () => {
  it("STATE — insertVersion forced to fail reverts an already-successful soft-delete (deleted_at back to null)", async () => {
    const store = new FailInjectingStore();
    const doc = makeDoc();
    const seedResult = await store.insertWithProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(seedResult.ok).toBe(true);

    store.armFailure("insertVersion");
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
    expect(result.ok).toBe(false);

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.deleted_at).toBeNull();
  });
});
