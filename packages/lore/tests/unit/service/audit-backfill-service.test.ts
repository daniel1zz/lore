/**
 * Six-dimension tests for AuditBackfillService (task-audit-verification-checks-every-version-pre-writer-history,
 * task-audit-backfill-takes-its-boundary-from-the-data-versions). InMemoryStore — no file I/O.
 *
 * The boundary is derived from the data: the created_at of the EARLIEST audit entry that names a version (the first
 * entry the versions-to-audit join can use; an earlier entry without `details.version` cannot satisfy any version).
 *
 *   HAPPY:      a version before the earliest audit entry with no entry is reconstructed; verify() then passes and counts it
 *   NEGATIVE:   a version after the earliest entry with no entry is NOT reconstructed and stays missing
 *   BOUNDARY:   created_at exactly equal to the boundary is NOT before it; an empty audit trail has no boundary and
 *               reconstructs nothing; `delete` versions are never touched; backfill entries never move the boundary
 *   STATE:      preview writes nothing; a second apply writes nothing (idempotent)
 *   ERROR:      a store failure on append is returned, not swallowed
 *   REGRESSION: backfill entries are hash-chained like any audit row (the chain walk stays clean)
 */

import { describe, expect, it } from "vitest";
import { err } from "@lore/core";
import type { VersionRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { AuditService } from "../../../src/service/audit-service.js";
import { bareDocWriter } from "../../../src/service/corpus-service.js";
import { withWriteContext } from "../../../src/store/write-context-store.js";
import { AuditBackfillService, AUDIT_BACKFILL_BOUNDARY_SOURCE, AUDIT_BACKFILL_REASON } from "../../../src/service/audit-backfill-service.js";

/** The first audit entry of every fixture corpus: the boundary. */
const FIRST_ENTRY_AT = "2026-07-06T12:02:00.000Z";
const OPTS = { actor: "agent:test", run: "audit-backfill-test-run", nowIso: "2026-10-19T00:00:00.000Z" } as const;

function version(doc_id: string, v: number, created_at: string, action: VersionRecord["action"] = "update"): VersionRecord {
  return { doc_id, version: v, content: "c", extra: {}, status: "draft", title: "t", action, created_at, created_by: "legacy" };
}

/** A corpus whose audit trail starts at {@link FIRST_ENTRY_AT} (one audited create of another doc). */
async function corpusWithTrailFrom(at: string = FIRST_ENTRY_AT): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.insertVersion(version("ANCHOR", 1, at, "create"));
  await store.appendAuditEntry({ timestamp: at, actor: "agent:first", session_id: "s", action: "create", doc_id: "ANCHOR", details: { version: 1 } });
  return store;
}

async function auditCount(store: InMemoryStore): Promise<number> {
  const chain = await store.listAuditChain();
  if (!chain.ok) throw new Error("chain read failed");
  return chain.value.length;
}

describe("AuditBackfillService", () => {
  it("STATE: every reconstructed entry carries the run of the writer's write context (the caller's), and a writer with no run writes nothing", async () => {
    const store = await corpusWithTrailFrom();
    await store.insertVersion(version("DOC1", 1, "2026-01-01T00:00:00.000Z", "create"));
    const run = "cc:backfill-caller";
    const writer = bareDocWriter(withWriteContext(store, { identity: { harnessRun: run, claimed: "agent:test", claimedSource: "run" } }));

    const applied = await new AuditBackfillService(store, writer).run({ ...OPTS, apply: true });

    expect(applied.ok).toBe(true);
    const entries = await store.queryAudit({ action: "audit-backfill" });
    expect(entries.ok && entries.value.map((entry) => (entry as { harness_run?: string }).harness_run)).toEqual([run]);

    // NEGATIVE: a write context with no known party is refused by the store chokepoint, and nothing is appended.
    const other = await corpusWithTrailFrom();
    await other.insertVersion(version("DOC2", 1, "2026-01-01T00:00:00.000Z", "create"));
    const nobody = bareDocWriter(withWriteContext(other, { identity: { harnessRun: null, claimed: null, claimedSource: null } }));
    const before = await auditCount(other);
    const refused = await new AuditBackfillService(other, nobody).run({ ...OPTS, apply: true });
    expect(refused.ok).toBe(false);
    expect(await auditCount(other)).toBe(before);
  });

  it("HAPPY+REGRESSION: reconstructs a version before the earliest entry; verify passes, counts it, and the chain stays clean", async () => {
    const store = await corpusWithTrailFrom();
    await store.insertVersion(version("DOC1", 1, "2026-01-01T00:00:00.000Z", "create"));
    const before = await new AuditService(store).verify();
    expect(before.ok && before.value.clean).toBe(false);

    const applied = await new AuditBackfillService(store, bareDocWriter(store)).run({ ...OPTS, apply: true });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.boundary).toBe(FIRST_ENTRY_AT);
    expect(applied.value.boundarySource).toBe(AUDIT_BACKFILL_BOUNDARY_SOURCE);
    expect(applied.value.reconstructed).toEqual([{ doc_id: "DOC1", version: 1, action: "create", created_at: "2026-01-01T00:00:00.000Z" }]);

    const after = await new AuditService(store).verify();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value).toMatchObject({ clean: true, audited: 1, reconstructed: 1, misses: [] });
    expect(after.value.chain).toEqual({ clean: true, checked: 2 });

    const entries = await store.queryAudit({ action: "audit-backfill" });
    expect(entries.ok && entries.value[0]).toMatchObject({
      actor: "agent:test",
      session_id: OPTS.run,
      doc_id: "DOC1",
      details: { version: 1, version_action: "create", reconstructed: true, reason: AUDIT_BACKFILL_REASON, run: OPTS.run },
    });
  });

  it("NEGATIVE: a version after the earliest entry with no audit entry is not reconstructed and stays missing", async () => {
    const store = await corpusWithTrailFrom();
    await store.insertVersion(version("DOC1", 2, "2026-09-01T00:00:00.000Z"));

    const applied = await new AuditBackfillService(store, bareDocWriter(store)).run({ ...OPTS, apply: true });
    expect(applied.ok && applied.value.reconstructed).toEqual([]);

    const verify = await new AuditService(store).verify();
    expect(verify.ok && verify.value.misses.map((m) => m.version)).toEqual([2]);
  });

  it("BOUNDARY: created_at equal to the boundary is not before it; a delete version is never reconstructed", async () => {
    const store = await corpusWithTrailFrom();
    await store.insertVersion(version("DOC1", 2, FIRST_ENTRY_AT));
    await store.insertVersion(version("DOC1", 3, "2026-01-01T00:00:00.000Z", "delete"));

    const preview = await new AuditBackfillService(store, bareDocWriter(store)).run({ ...OPTS, apply: false });
    expect(preview.ok && preview.value.reconstructed).toEqual([]);
  });

  it("BOUNDARY: an empty audit trail has no boundary — nothing is reconstructed, the boundary is reported absent", async () => {
    const store = new InMemoryStore();
    await store.insertVersion(version("DOC1", 1, "2026-01-01T00:00:00.000Z", "create"));

    const applied = await new AuditBackfillService(store, bareDocWriter(store)).run({ ...OPTS, apply: true });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.boundary).toBeNull();
    expect(applied.value.reconstructed).toEqual([]);
    expect(await auditCount(store)).toBe(0);
  });

  it("BOUNDARY: only an entry that names a version can be the boundary — an earlier entry without one cannot be joined to a version", async () => {
    const store = await corpusWithTrailFrom();
    await store.appendAuditEntry({ timestamp: "2026-06-28T05:50:02.104Z", actor: "agent:early", session_id: "s", action: "create", doc_id: "EARLY", details: {} });
    await store.insertVersion(version("DOC1", 1, "2026-07-01T00:00:00.000Z", "create"));

    const preview = await new AuditBackfillService(store, bareDocWriter(store)).run({ ...OPTS, apply: false });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.boundary).toBe(FIRST_ENTRY_AT);
    expect(preview.value.reconstructed.map((m) => m.doc_id)).toEqual(["DOC1"]);
  });

  it("BOUNDARY: backfill entries never move the boundary — a later run derives the same one", async () => {
    const store = await corpusWithTrailFrom();
    await store.insertVersion(version("DOC1", 1, "2026-01-01T00:00:00.000Z", "create"));
    const service = new AuditBackfillService(store, bareDocWriter(store));
    await service.run({ ...OPTS, apply: true });

    const again = await service.run({ ...OPTS, apply: false });
    expect(again.ok && again.value.boundary).toBe(FIRST_ENTRY_AT);
  });

  it("STATE: preview writes nothing; a second apply writes nothing", async () => {
    const store = await corpusWithTrailFrom();
    await store.insertVersion(version("DOC1", 1, "2026-01-01T00:00:00.000Z", "create"));
    await store.insertVersion(version("DOC1", 2, "2026-02-01T00:00:00.000Z"));
    const service = new AuditBackfillService(store, bareDocWriter(store));
    const base = await auditCount(store);

    const preview = await service.run({ ...OPTS, apply: false });
    expect(preview.ok && preview.value.reconstructed).toHaveLength(2);
    expect(await auditCount(store)).toBe(base);

    const first = await service.run({ ...OPTS, apply: true });
    expect(first.ok && first.value.reconstructed).toHaveLength(2);
    expect(await auditCount(store)).toBe(base + 2);

    const second = await service.run({ ...OPTS, apply: true });
    expect(second.ok && second.value.reconstructed).toEqual([]);
    expect(await auditCount(store)).toBe(base + 2);
  });

  it("ERROR: a failing append is returned and the run stops", async () => {
    const store = await corpusWithTrailFrom();
    await store.insertVersion(version("DOC1", 1, "2026-01-01T00:00:00.000Z", "create"));
    store.appendAuditEntry = async () => err({ code: "STORE_ERROR", message: "disk full" });

    const applied = await new AuditBackfillService(store, bareDocWriter(store)).run({ ...OPTS, apply: true });
    expect(applied).toEqual(err({ code: "STORE_ERROR", message: "disk full" }));
  });
});
