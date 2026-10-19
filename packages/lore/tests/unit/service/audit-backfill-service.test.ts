/**
 * Six-dimension tests for AuditBackfillService (task-audit-verification-checks-every-version-pre-writer-history).
 * InMemoryStore — no file I/O.
 *
 *   HAPPY:      a pre-boundary version with no audit entry is reconstructed; verify() then passes and counts it
 *   NEGATIVE:   a version at/after the boundary with no audit entry is NOT reconstructed and stays missing
 *   BOUNDARY:   created_at exactly equal to the boundary is NOT before it; `delete` versions are never touched
 *   STATE:      preview writes nothing; a second apply writes nothing (idempotent)
 *   ERROR:      a store failure on append is returned, not swallowed
 *   REGRESSION: backfill entries are hash-chained like any audit row (the chain walk stays clean)
 */

import { describe, expect, it } from "vitest";
import { err } from "@lore/core";
import type { VersionRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { AuditService } from "../../../src/service/audit-service.js";
import { AuditBackfillService, AUDIT_BACKFILL_REASON } from "../../../src/service/audit-backfill-service.js";

const BOUNDARY = "2026-07-06T00:00:00Z";
const OPTS = { boundary: BOUNDARY, actor: "agent:test", run: "audit-backfill-test-run", nowIso: "2026-10-19T00:00:00.000Z" } as const;

function version(doc_id: string, v: number, created_at: string, action: VersionRecord["action"] = "update"): VersionRecord {
  return { doc_id, version: v, content: "c", extra: {}, status: "draft", title: "t", action, created_at, created_by: "legacy" };
}

async function auditCount(store: InMemoryStore): Promise<number> {
  const chain = await store.listAuditChain();
  if (!chain.ok) throw new Error("chain read failed");
  return chain.value.length;
}

describe("AuditBackfillService", () => {
  it("HAPPY+REGRESSION: reconstructs a pre-boundary version; verify passes, counts it, and the chain stays clean", async () => {
    const store = new InMemoryStore();
    await store.insertVersion(version("DOC1", 1, "2026-01-01T00:00:00.000Z", "create"));
    const before = await new AuditService(store).verify();
    expect(before.ok && before.value.clean).toBe(false);

    const applied = await new AuditBackfillService(store).run({ ...OPTS, apply: true });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.reconstructed).toEqual([{ doc_id: "DOC1", version: 1, action: "create", created_at: "2026-01-01T00:00:00.000Z" }]);

    const after = await new AuditService(store).verify();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value).toMatchObject({ clean: true, audited: 0, reconstructed: 1, misses: [] });
    expect(after.value.chain).toEqual({ clean: true, checked: 1 });

    const entries = await store.queryAudit({ action: "audit-backfill" });
    expect(entries.ok && entries.value[0]).toMatchObject({
      actor: "agent:test",
      session_id: OPTS.run,
      doc_id: "DOC1",
      details: { version: 1, version_action: "create", reconstructed: true, reason: AUDIT_BACKFILL_REASON, run: OPTS.run },
    });
  });

  it("NEGATIVE: a version after the boundary with no audit entry is not reconstructed and stays missing", async () => {
    const store = new InMemoryStore();
    await store.insertVersion(version("DOC1", 2, "2026-09-01T00:00:00.000Z"));

    const applied = await new AuditBackfillService(store).run({ ...OPTS, apply: true });
    expect(applied.ok && applied.value.reconstructed).toEqual([]);

    const verify = await new AuditService(store).verify();
    expect(verify.ok && verify.value.misses.map((m) => m.version)).toEqual([2]);
  });

  it("BOUNDARY: created_at equal to the boundary is not before it; a delete version is never reconstructed", async () => {
    const store = new InMemoryStore();
    await store.insertVersion(version("DOC1", 2, BOUNDARY));
    await store.insertVersion(version("DOC1", 3, "2026-01-01T00:00:00.000Z", "delete"));

    const preview = await new AuditBackfillService(store).run({ ...OPTS, apply: false });
    expect(preview.ok && preview.value.reconstructed).toEqual([]);
  });

  it("STATE: preview writes nothing; a second apply writes nothing", async () => {
    const store = new InMemoryStore();
    await store.insertVersion(version("DOC1", 1, "2026-01-01T00:00:00.000Z", "create"));
    await store.insertVersion(version("DOC1", 2, "2026-02-01T00:00:00.000Z"));
    const service = new AuditBackfillService(store);

    const preview = await service.run({ ...OPTS, apply: false });
    expect(preview.ok && preview.value.reconstructed).toHaveLength(2);
    expect(await auditCount(store)).toBe(0);

    const first = await service.run({ ...OPTS, apply: true });
    expect(first.ok && first.value.reconstructed).toHaveLength(2);
    expect(await auditCount(store)).toBe(2);

    const second = await service.run({ ...OPTS, apply: true });
    expect(second.ok && second.value.reconstructed).toEqual([]);
    expect(await auditCount(store)).toBe(2);
  });

  it("ERROR: a failing append is returned and the run stops", async () => {
    const store = new InMemoryStore();
    await store.insertVersion(version("DOC1", 1, "2026-01-01T00:00:00.000Z", "create"));
    store.appendAuditEntry = async () => err({ code: "STORE_ERROR", message: "disk full" });

    const applied = await new AuditBackfillService(store).run({ ...OPTS, apply: true });
    expect(applied).toEqual(err({ code: "STORE_ERROR", message: "disk full" }));
  });
});
