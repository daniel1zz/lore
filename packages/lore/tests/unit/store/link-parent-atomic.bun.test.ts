/**
 * @spec_ref AC-BLC-7 (cites AS-10) — #123 / debt AD-13: `lore link --type parent` is all-or-none.
 *
 * Before the fix `CorpusService._linkImpl` ran three independent store writes (link row, `docs.parent_id`
 * update, audit entry), so a failure on step 2 or 3 left the link row (and parent_id) persisted with no
 * error-free outcome. Here a real SQLite / Turso file store gets a SQL trigger that aborts ONE of the writes,
 * and an InMemoryStore subclass fails the same step; in every case the link must return err and leave
 * parent_id, the link table, the versions table and the audit log exactly as they were.
 *
 * Runner: `bun test` (bun:sqlite) — never vitest.
 *
 * Dimensions: HAPPY (all land together), ERROR (parent write fails; audit write fails — both rollback),
 * STATE (link rows / versions / audit / parent_id unchanged), REGRESSION (a retry after the fault clears
 * succeeds — nothing half-written blocks it; BR-759 duplicate link still DUPLICATE_LINK).
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput, LoreError, Result } from "@lore/core";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { TursoStore } from "../../../src/store/turso-store.js";

async function must<T>(r: Result<T, LoreError>, what: string): Promise<T> {
  if (!r.ok) throw new Error(`fixture ${what} failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

interface Snapshot {
  parentId: string | null;
  docVersion: number;
  docUpdatedAt: string;
  links: string[];
  versionCount: number;
  auditCount: number;
}

async function snapshot(store: StoreInterface, fromId: string): Promise<Snapshot> {
  const doc = await must(await store.find(fromId), "find");
  if (doc === null) throw new Error("fixture doc vanished");
  const links = await must(await store.findLinks(fromId, "both"), "findLinks");
  const versions = await must(await store.findVersions(fromId), "findVersions");
  const audit = await must(await store.queryAudit({}), "queryAudit");
  return {
    parentId: doc.parent_id,
    docVersion: doc.version,
    docUpdatedAt: doc.updated_at,
    links: links.map((l) => `${l.from_id}>${l.to_id}:${l.link_type}`).sort(),
    versionCount: versions.length,
    auditCount: audit.length,
  };
}

interface Fixture {
  cs: CorpusService;
  store: StoreInterface;
  specId: string;
  prdBId: string;
  injectParentWriteFault: () => Promise<void>;
  injectAuditWriteFault: () => Promise<void>;
  clearFaults: () => Promise<void>;
}

/** prd A is the plan's create-time parent; the link under test re-parents the plan to prd B (a spec takes no parent, BR-2). */
async function seed(store: StoreInterface): Promise<{ cs: CorpusService; specId: string; prdBId: string }> {
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const prdA = await must(await cs.create({ type: "prd", title: "Link atomic A", content: "a" } as CreateDocInput), "prdA");
  const prdB = await must(await cs.create({ type: "prd", title: "Link atomic B", content: "b" } as CreateDocInput), "prdB");
  const spec = await must(
    await cs.create({ type: "plan", title: "Link atomic plan", content: "s", parent_id: prdA.id } as CreateDocInput),
    "spec",
  );
  return { cs, specId: spec.id, prdBId: prdB.id };
}

const PARENT_FAULT = `CREATE TRIGGER t_block_parent_write BEFORE UPDATE OF parent_id ON docs
  BEGIN SELECT RAISE(ABORT, 'parent write blocked'); END`;
const AUDIT_FAULT = `CREATE TRIGGER t_block_link_audit BEFORE INSERT ON audit WHEN NEW.action = 'link'
  BEGIN SELECT RAISE(ABORT, 'link audit blocked'); END`;
const DROP_FAULTS = ["DROP TRIGGER IF EXISTS t_block_parent_write", "DROP TRIGGER IF EXISTS t_block_link_audit"];

/** InMemoryStore double: fails the chosen step of the link composite (polymorphic dispatch, see store CLAUDE.md). */
class FaultyMemoryStore extends InMemoryStore {
  failParentWrite = false;
  failAudit = false;
  override async update(...args: Parameters<InMemoryStore["update"]>) {
    if (this.failParentWrite && args[1].parent_id !== undefined) {
      return { ok: false as const, error: { code: "STORE_ERROR" as const, message: "parent write blocked" } };
    }
    return super.update(...args);
  }
  override async appendAuditEntry(...args: Parameters<InMemoryStore["appendAuditEntry"]>) {
    if (this.failAudit && args[0].action === "link") {
      return { ok: false as const, error: { code: "STORE_ERROR" as const, message: "link audit blocked" } };
    }
    return super.appendAuditEntry(...args);
  }
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
      const db = store.getDatabase();
      return {
        ...(await seed(store)),
        store,
        injectParentWriteFault: async () => void db.exec(PARENT_FAULT),
        injectAuditWriteFault: async () => void db.exec(AUDIT_FAULT),
        clearFaults: async () => void DROP_FAULTS.forEach((s) => db.exec(s)),
      };
    },
  },
  {
    label: "TursoStore",
    make: async () => {
      const dir = mkdtempSync(join(tmpdir(), "lore-link-atomic-"));
      const store = new TursoStore({ localPath: join(dir, "lore.db") });
      cleanups.push(() => {
        store.close();
        rmSync(dir, { recursive: true, force: true });
      });
      const exec = async (sql: string): Promise<void> => {
        await (store as unknown as { ensureReady(): Promise<void> }).ensureReady();
        await (store as unknown as { client: { execute(s: string): Promise<unknown> } }).client.execute(sql);
      };
      return {
        ...(await seed(store)),
        store,
        injectParentWriteFault: () => exec(PARENT_FAULT),
        injectAuditWriteFault: () => exec(AUDIT_FAULT),
        clearFaults: async () => {
          for (const s of DROP_FAULTS) await exec(s);
        },
      };
    },
  },
  {
    label: "InMemoryStore",
    make: async () => {
      const store = new FaultyMemoryStore();
      return {
        ...(await seed(store)),
        store,
        injectParentWriteFault: async () => void (store.failParentWrite = true),
        injectAuditWriteFault: async () => void (store.failAudit = true),
        clearFaults: async () => {
          store.failParentWrite = false;
          store.failAudit = false;
        },
      };
    },
  },
];

for (const { label, make } of factories) {
  describe(`AC-BLC-7 link parent is all-or-none — ${label}`, () => {
    it("AC-BLC-7 HAPPY: a successful parent link writes the link row, parent_id and one audit entry together", async () => {
      const f = await make();
      const before = await snapshot(f.store, f.specId);
      const res = await f.cs.link(f.specId, f.prdBId, "parent", { by: "agent:test" });
      expect(res.ok).toBe(true);
      const after = await snapshot(f.store, f.specId);
      expect(after.parentId).toBe(f.prdBId);
      expect(after.links).toContain(`${f.specId}>${f.prdBId}:parent`);
      expect(after.auditCount).toBe(before.auditCount + 1);
      // A link is audit-only: no versions row, in the success path and in every failure path below.
      expect(after.versionCount).toBe(before.versionCount);
      const audit = await must(await f.store.queryAudit({ action: "link" }), "audit");
      expect(audit[0]?.details).toMatchObject({ to_id: f.prdBId, link_type: "parent" });
    });

    it("AC-BLC-7 ERROR: parent_id write fails after the link row -> err and nothing changed", async () => {
      const f = await make();
      const before = await snapshot(f.store, f.specId);
      await f.injectParentWriteFault();
      const res = await f.cs.link(f.specId, f.prdBId, "parent", { by: "agent:test" });
      expect(res.ok).toBe(false);
      expect(await snapshot(f.store, f.specId)).toEqual(before);
    });

    it("AC-BLC-7 ERROR: audit write fails after link row + parent_id -> err and nothing changed", async () => {
      const f = await make();
      const before = await snapshot(f.store, f.specId);
      await f.injectAuditWriteFault();
      const res = await f.cs.link(f.specId, f.prdBId, "parent", { by: "agent:test" });
      expect(res.ok).toBe(false);
      expect(await snapshot(f.store, f.specId)).toEqual(before);
    });

    it("AC-BLC-7 REGRESSION: after a failed attempt the same link succeeds, and a repeat is still DUPLICATE_LINK", async () => {
      const f = await make();
      await f.injectAuditWriteFault();
      expect((await f.cs.link(f.specId, f.prdBId, "parent", { by: "agent:test" })).ok).toBe(false);
      await f.clearFaults();
      expect((await f.cs.link(f.specId, f.prdBId, "parent", { by: "agent:test" })).ok).toBe(true);
      const again = await f.cs.link(f.specId, f.prdBId, "parent", { by: "agent:test" });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("DUPLICATE_LINK");
    });
  });
}
