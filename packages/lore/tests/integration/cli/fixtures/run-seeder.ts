/**
 * Test fixture: seed attested / unattested writes straight into a mkdtemp corpus's SQLite file.
 *
 * `as(identity)` returns the store to write through:
 *   - identity === null            -> the BARE store (harness_run stays NULL: exactly a pre-016 / unattested row);
 *   - identity.harnessRun !== null -> the pinned `withWriteContext` decorator when `write-context-store.ts`
 *     exists (the production stamping path, AC-RID-4 contract), else a recording proxy whose
 *     (doc_id, version) / (doc_id, timestamp) keys are stamped with `harness_run` by raw SQL in `finish()`
 *     (adding the nullable columns first if the schema predates migration 016). The fallback exists only so
 *     the RED tests reach the behaviour under test (rendering / status) before the decorator lands, instead
 *     of dying on a module that belongs to another task.
 */

import { Database } from "bun:sqlite";
import { SQLiteStore } from "../../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../../src/store/store-interface.js";
import { actedStore } from "../../../live-invocation.js";

const WRITE_CONTEXT_MODULE = "../../../../src/store/write-context-store.js";

export interface SeedIdentity {
  harnessRun: string | null;
  claimed: string;
  claimedSource: string;
}

type Wrap = (store: StoreInterface, ctx: { identity: SeedIdentity }) => StoreInterface;

async function loadWrap(): Promise<Wrap | null> {
  try {
    const mod = (await import(WRITE_CONTEXT_MODULE)) as Record<string, unknown>;
    return typeof mod.withWriteContext === "function" ? (mod.withWriteContext as Wrap) : null;
  } catch {
    return null;
  }
}

export class RunSeeder {
  readonly store: SQLiteStore;
  private wrap: Wrap | null = null;
  private readonly versionStamps: { docId: string; version: number; run: string }[] = [];
  private readonly auditStamps: { docId: string; timestamp: string; run: string }[] = [];

  private constructor(private readonly dbPath: string) {
    this.store = actedStore(new SQLiteStore(dbPath));
  }

  static async open(dbPath: string): Promise<RunSeeder> {
    const s = new RunSeeder(dbPath);
    s.wrap = await loadWrap();
    return s;
  }

  as(identity: SeedIdentity | null): StoreInterface {
    if (identity === null) return this.store;
    if (this.wrap) return this.wrap(this.store, { identity });
    if (identity.harnessRun === null) return this.store;
    const run = identity.harnessRun;
    const inner = this.store;
    const self = this;
    return new Proxy(inner as unknown as StoreInterface, {
      get(target, prop, receiver) {
        const orig = Reflect.get(target, prop, target) as unknown;
        if (prop === "insertVersion" && typeof orig === "function") {
          return (v: { doc_id: string; version: number }) => {
            self.versionStamps.push({ docId: v.doc_id, version: v.version, run });
            return (orig as (x: unknown) => unknown).call(target, v);
          };
        }
        if (prop === "appendAuditEntry" && typeof orig === "function") {
          return (e: { doc_id?: string; timestamp: string }) => {
            if (e.doc_id) self.auditStamps.push({ docId: e.doc_id, timestamp: e.timestamp, run });
            return (orig as (x: unknown) => unknown).call(target, e);
          };
        }
        return typeof orig === "function" ? (orig as (...a: unknown[]) => unknown).bind(target) : Reflect.get(target, prop, receiver);
      },
    });
  }

  /** Close the store and apply any fallback stamps. */
  finish(): void {
    this.store.close();
    if (this.versionStamps.length === 0 && this.auditStamps.length === 0) return;
    const db = new Database(this.dbPath);
    try {
      for (const table of ["versions", "audit"]) {
        const cols = (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
        if (!cols.includes("harness_run")) db.exec(`ALTER TABLE ${table} ADD COLUMN harness_run TEXT`);
      }
      const uv = db.prepare("UPDATE versions SET harness_run = ? WHERE doc_id = ? AND version = ?");
      for (const s of this.versionStamps) uv.run(s.run, s.docId, s.version);
      const ua = db.prepare("UPDATE audit SET harness_run = ? WHERE doc_id = ? AND timestamp = ?");
      for (const s of this.auditStamps) ua.run(s.run, s.docId, s.timestamp);
    } finally {
      db.close();
    }
  }
}
