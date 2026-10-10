/**
 * @spec_ref AC-BLS3B-7 (BR-1009) — `StoreInterface.setDocParentWithProvenance` is all-or-none on every store.
 *
 * Clearing a spec's parent writes the column, deletes any `parent` link row and appends ONE audit entry in a
 * single transaction, with no `versions` row and no `version`/`status` change. A SQL trigger (SQLite / Turso)
 * or a subclass (InMemoryStore) fails the audit append and the whole write must roll back.
 *
 * Runner: `bun test` (bun:sqlite) — never vitest.
 *
 * Dimensions: HAPPY (clear, restore), STATE (version/status/versions unchanged, link row gone),
 * ERROR (audit append fails -> nothing changed; unknown doc -> DOC_NOT_FOUND and no audit row).
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEntry, CreateDocInput, LoreError, Result } from "@lore/core";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { TursoStore } from "../../../src/store/turso-store.js";

async function must<T>(r: Result<T, LoreError>, what: string): Promise<T> {
  if (!r.ok) throw new Error(`fixture ${what} failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

const AUDIT_FAULT = `CREATE TRIGGER t_block_migrate_audit BEFORE INSERT ON audit WHEN NEW.action = 'migrate_spec_parent'
  BEGIN SELECT RAISE(ABORT, 'migrate audit blocked'); END`;

function auditFor(docId: string, oldParent: string): AuditEntry {
  return {
    timestamp: "2026-10-10T00:00:00.000Z",
    actor: "system:test",
    session_id: "s",
    action: "migrate_spec_parent",
    doc_id: docId,
    details: { old_parent_id: oldParent },
  };
}

class FaultyMemoryStore extends InMemoryStore {
  failAudit = false;
  override async appendAuditEntry(...args: Parameters<InMemoryStore["appendAuditEntry"]>) {
    if (this.failAudit) return { ok: false as const, error: { code: "STORE_ERROR" as const, message: "audit blocked" } };
    return super.appendAuditEntry(...args);
  }
}

interface Fixture {
  store: StoreInterface;
  prdId: string;
  specId: string;
  injectAuditFault: () => Promise<void>;
}

async function seed(store: StoreInterface): Promise<{ prdId: string; specId: string }> {
  const cs = new CorpusService(store);
  const prd = await must(await cs.create({ type: "prd", title: "Set parent prd", content: "p" } as CreateDocInput), "prd");
  const spec = await must(
    await cs.create({ type: "spec", title: "Set parent spec", content: "s", parent_id: prd.id } as CreateDocInput),
    "spec",
  );
  // A `parent` link row alongside parent_id, to prove the clear removes both.
  await must(
    await store.addLink({ from_id: spec.id, to_id: prd.id, link_type: "parent", created_at: "2026-10-10T00:00:00.000Z", created_by: "t" }),
    "addLink",
  );
  return { prdId: prd.id, specId: spec.id };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const factories: Array<{ label: string; make: () => Promise<Fixture> }> = [
  {
    label: "SQLiteStore",
    make: async () => {
      const store = new SQLiteStore(":memory:");
      cleanups.push(() => store.close());
      return { store, ...(await seed(store)), injectAuditFault: async () => void store.getDatabase().exec(AUDIT_FAULT) };
    },
  },
  {
    label: "TursoStore",
    make: async () => {
      const dir = mkdtempSync(join(tmpdir(), "lore-set-parent-"));
      const store = new TursoStore({ localPath: join(dir, "lore.db") });
      cleanups.push(() => {
        store.close();
        rmSync(dir, { recursive: true, force: true });
      });
      return {
        store,
        ...(await seed(store)),
        injectAuditFault: async () => {
          await (store as unknown as { ensureReady(): Promise<void> }).ensureReady();
          await (store as unknown as { client: { execute(s: string): Promise<unknown> } }).client.execute(AUDIT_FAULT);
        },
      };
    },
  },
  {
    label: "InMemoryStore",
    make: async () => {
      const store = new FaultyMemoryStore();
      return { store, ...(await seed(store)), injectAuditFault: async () => void (store.failAudit = true) };
    },
  },
];

for (const { label, make } of factories) {
  describe(`setDocParentWithProvenance — ${label}`, () => {
    it("HAPPY+STATE: clearing writes null parent, drops the parent link, one audit entry, no version row or version change", async () => {
      const f = await make();
      const before = await must(await f.store.find(f.specId), "find");
      const versionsBefore = (await must(await f.store.findVersions(f.specId), "versions")).length;
      const res = await f.store.setDocParentWithProvenance(f.specId, null, auditFor(f.specId, f.prdId));
      expect(res.ok).toBe(true);
      const after = await must(await f.store.find(f.specId), "find");
      expect(after?.parent_id).toBeNull();
      expect(after?.version).toBe(before?.version);
      expect(after?.status).toBe(before?.status);
      expect((await must(await f.store.findVersions(f.specId), "versions")).length).toBe(versionsBefore);
      const links = await must(await f.store.findLinks(f.specId, "out"), "links");
      expect(links.filter((l) => l.link_type === "parent")).toEqual([]);
      const audit = await must(await f.store.queryAudit({ action: "migrate_spec_parent" }), "audit");
      expect(audit.length).toBe(1);
      expect(audit[0]?.details).toMatchObject({ old_parent_id: f.prdId });
    });

    it("HAPPY: a non-null parent restores the column", async () => {
      const f = await make();
      await must(await f.store.setDocParentWithProvenance(f.specId, null, auditFor(f.specId, f.prdId)), "clear");
      const res = await f.store.setDocParentWithProvenance(f.specId, f.prdId, { ...auditFor(f.specId, f.prdId), action: "revert_spec_parent" });
      expect(res.ok).toBe(true);
      expect((await must(await f.store.find(f.specId), "find"))?.parent_id).toBe(f.prdId);
    });

    it("ERROR: an audit append failure rolls back parent_id and the link row", async () => {
      const f = await make();
      await f.injectAuditFault();
      const res = await f.store.setDocParentWithProvenance(f.specId, null, auditFor(f.specId, f.prdId));
      expect(res.ok).toBe(false);
      expect((await must(await f.store.find(f.specId), "find"))?.parent_id).toBe(f.prdId);
      const links = await must(await f.store.findLinks(f.specId, "out"), "links");
      expect(links.filter((l) => l.link_type === "parent").length).toBe(1);
    });

    it("ERROR: an unknown doc is DOC_NOT_FOUND and writes no audit row", async () => {
      const f = await make();
      const res = await f.store.setDocParentWithProvenance("01NOSUCHDOC00000000000000", null, auditFor("x", f.prdId));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("DOC_NOT_FOUND");
      expect((await must(await f.store.queryAudit({ action: "migrate_spec_parent" }), "audit")).length).toBe(0);
    });
  });
}
