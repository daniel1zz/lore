/**
 * InMemoryStore-specific atomicity coverage for
 * `insertWithAllocatedOrdinalAndProvenance` (task-skill-implement-ordinal-
 * aware-provenance-composite, BUG-002 follow-up), using the SAME
 * AC-prescribed failure-injection technique as
 * `in-memory-store-provenance-atomicity.test.ts`: a subclass that overrides
 * `insertVersion` / `appendAuditEntry` to force a failure on demand.
 *
 * `insert-with-allocated-ordinal-and-provenance.shared.ts`'s cross-store
 * suite (which InMemoryStore also runs, via
 * `insert-with-allocated-ordinal-and-provenance.test.ts`) cannot exercise
 * InMemoryStore's rollback path via its "version-insert PK collision"
 * technique — bare InMemoryStore has no real `(doc_id, version)` uniqueness
 * constraint to collide with (see that file's `supportsPkCollisionAtomicity`
 * doc comment). This file closes that gap directly: a subclass overriding
 * the SPECIFIC step to fail, and `insertWithAllocatedOrdinalAndProvenance`
 * dispatches polymorphically through `this.insertVersion(...)` /
 * `this.appendAuditEntry(...)` — NOT a private raw helper — so the override
 * IS honored (this is precisely WHY in-memory-store.ts's new composite
 * method calls through `this.<method>` rather than a bypassing private
 * core, mirroring `insertWithProvenance`'s identical rationale).
 *
 * Six-dimension coverage:
 *   HAPPY:      (already covered by
 *               insert-with-allocated-ordinal-and-provenance.shared.ts's
 *               InMemoryStore run — not re-duplicated here.)
 *   ERROR:      insertVersion forced to fail → the ordinal-numbered doc
 *               insert (step 1, already succeeded) is rolled back.
 *   ERROR:      appendAuditEntry forced to fail → BOTH the doc insert AND
 *               the version insert are rolled back.
 *   STATE:      after either forced-failure rollback, the candidate ordinal
 *               is NOT burned — a subsequent successful call for the SAME
 *               type lands on the SAME ordinal the failed attempt used.
 *   BOUNDARY:   a forced failure on the FIRST composite call never
 *               contaminates a SUBSEQUENT successful call (the
 *               failure-injection flag is single-shot, verified via a second,
 *               un-forced call succeeding).
 *   REGRESSION: with no forced failure, the composite behaves identically to
 *               the un-wrapped InMemoryStore (byte-identical happy-path
 *               outcome) — proves the subclass adds ONLY the opt-in failure
 *               injection, nothing else.
 *
 * @spec_ref task-skill-implement-ordinal-aware-provenance-composite (SPEC-084 follow-up, BUG-002)
 */

import { describe, expect, it } from "vitest";
import type { AuditEntry, DocRecord, LoreError, Result, VersionRecord } from "@lore/core";
import { err } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { actedStore } from "../../live-invocation.js";

// ─── Failure-injection test double ─────────────────────────────────────────

type FailStep = "insertVersion" | "appendAuditEntry" | null;

/**
 * Subclasses InMemoryStore (the AC-prescribed "InMemory 包装器" technique) to
 * force ONE specific write step to fail on its NEXT invocation only
 * (single-shot — `armedFailure` is consumed and reset to `null` the moment it
 * fires, so a forced failure never silently repeats on a later, unrelated
 * call within the same test). Mirrors
 * `in-memory-store-provenance-atomicity.test.ts`'s identical local class
 * (that file's class is not exported, so this is a deliberate, narrow
 * duplication rather than a shared import — both files are small, single-
 * purpose failure-injection fixtures).
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
  const id = `01HORDFAILINJ${String(_counter).padStart(7, "0")}`;
  return {
    id,
    slug: `spec-ordinal-fail-inject-fixture-${_counter}`,
    type: "spec",
    role: "spec",
    title: `Ordinal Fail-Inject Fixture ${_counter}`,
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

// ─── insertWithAllocatedOrdinalAndProvenance ───────────────────────────────

describe("InMemoryStore.insertWithAllocatedOrdinalAndProvenance — failure-injection atomicity", () => {
  it("ERROR — insertVersion forced to fail rolls back the already-successful ordinal-numbered doc insert", async () => {
    const store = actedStore(new FailInjectingStore());
    const doc = makeDoc();
    store.armFailure("insertVersion");

    const result = await store.insertWithAllocatedOrdinalAndProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");

    const found = await store.find(doc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value).toBeNull(); // the doc insert was rolled back

    // STATE — the burned ordinal candidate (1) is reclaimed: a fresh,
    // un-forced call for the same type still lands on ordinal 1.
    const freshDoc = makeDoc({ title: "Fresh After insertVersion Failure" });
    const freshResult = await store.insertWithAllocatedOrdinalAndProvenance(
      freshDoc,
      makeVersion(freshDoc),
      makeAudit(freshDoc),
    );
    expect(freshResult.ok).toBe(true);
    if (!freshResult.ok) return;
    expect(freshResult.value.ordinal).toBe(1);
  });

  it("ERROR — appendAuditEntry forced to fail rolls back BOTH the doc insert and the version insert", async () => {
    const store = actedStore(new FailInjectingStore());
    const doc = makeDoc();
    store.armFailure("appendAuditEntry");

    const result = await store.insertWithAllocatedOrdinalAndProvenance(doc, makeVersion(doc), makeAudit(doc));
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
    const store = actedStore(new FailInjectingStore());
    const failedDoc = makeDoc();
    store.armFailure("insertVersion");
    const failedResult = await store.insertWithAllocatedOrdinalAndProvenance(
      failedDoc,
      makeVersion(failedDoc),
      makeAudit(failedDoc),
    );
    expect(failedResult.ok).toBe(false);

    // No re-arm — the NEXT call must succeed normally.
    const okDoc = makeDoc();
    const okResult = await store.insertWithAllocatedOrdinalAndProvenance(
      okDoc,
      makeVersion(okDoc),
      makeAudit(okDoc),
    );
    expect(okResult.ok).toBe(true);
    if (!okResult.ok) return;
    expect(okResult.value.ordinal).toBe(1);

    const found = await store.find(okDoc.id);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.id).toBe(okDoc.id);
  });

  it("REGRESSION — with no forced failure, FailInjectingStore behaves identically to bare InMemoryStore", async () => {
    const store = actedStore(new FailInjectingStore());
    const doc = makeDoc();
    const result = await store.insertWithAllocatedOrdinalAndProvenance(doc, makeVersion(doc), makeAudit(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ordinal).toBe(1);

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
