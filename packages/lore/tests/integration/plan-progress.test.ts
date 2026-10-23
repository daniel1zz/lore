/**
 * @reads packages/lore/src/adapters/cli/commands
 * @reads packages/lore/src/adapters/cli/commands/*.ts
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of
 *   AC-PCR-1, AC-PCR-2; business rule BR-1379.
 *
 * A plan's stored `extra.progress {state, open, total, at}` is written in the SAME store transaction as every task or
 * phase write, in all three stores (InMemory, SQLite, Turso), and backfilled by migration 035.
 *
 * Coverage dimensions:
 *   HAPPY:      plan born `empty`; a task insert raises `total`/`open`; archiving the last open task makes it `complete`
 *   STATE:      two tasks finishing concurrently end with open = 0 / complete (same store and two SQLite connections)
 *   NEGATIVE:   an archived plan refuses a new task or phase; an archived task refuses any other status (exit-4 class)
 *   ERROR:      a failure after the task write leaves task AND plan unchanged
 *   BOUNDARY:   a write that leaves the aggregate unchanged writes no plan version; a deleted task leaves the count
 *   REGRESSION: a plan edit that rebuilds `extra` keeps its progress; the service create path stamps progress
 *   MIGRATION:  3 plans of mixed task states backfilled correctly; no plan lacks progress; no recompute command exists
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP, type AuditEntry, type DocId, type DocRecord, type VersionRecord } from "@lore/core";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { TursoStore } from "../../src/store/turso-store.js";
import { readStoredPlanProgress } from "../../src/store/plan-progress.js";
import type { StoreInterface } from "../../src/store/store-interface.js";
import { LATEST_SCHEMA_VERSION } from "../../src/store/schema-version.js";
import { actedStore } from "../live-invocation.js";

type Kind = "memory" | "sqlite" | "turso";
const KINDS: readonly Kind[] = ["memory", "sqlite", "turso"];

/** A store of `kind` over a throwaway file, plus the raw handle opener for fault injection. */
interface Fixture {
  readonly dir: string;
  readonly dbPath: string;
  readonly store: StoreInterface;
  readonly kind: Kind;
}

/** InMemoryStore whose version insert for one doc fails: the failure-injection technique for the in-memory store. */
class FailingVersionStore extends InMemoryStore {
  failFor: DocId | null = null;
  override async insertVersion(version: VersionRecord) {
    if (this.failFor !== null && version.doc_id === this.failFor && version.version > 1) {
      return { ok: false as const, error: { code: "STORE_ERROR" as const, message: "injected failure" } };
    }
    return super.insertVersion(version);
  }
}

function openStore(kind: Kind, dir: string, dbPath: string): StoreInterface {
  if (kind === "memory") return actedStore(new FailingVersionStore());
  if (kind === "sqlite") return actedStore(new SQLiteStore(dbPath));
  return actedStore(new TursoStore({ localPath: dbPath }));
}

function makeFixture(kind: Kind): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "lore-plan-progress-"));
  const dbPath = join(dir, "corpus.db");
  return { dir, dbPath, store: openStore(kind, dir, dbPath), kind };
}

function rawDoc(type: DocRecord["type"], title: string, extra: Record<string, unknown>, status: DocRecord["status"] = "draft", parentId: DocId | null = null): DocRecord {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  return {
    id,
    slug: `${type}-${title.toLowerCase().replace(/\s+/g, "-")}-${id.slice(-6).toLowerCase()}`,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title,
    status,
    priority: "medium",
    content: "",
    parent_id: parentId,
    created_at: now,
    updated_at: now,
    created_by: "plan-progress-test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra,
  };
}

function provenance(doc: DocRecord): { version: VersionRecord; audit: AuditEntry } {
  return {
    version: {
      doc_id: doc.id,
      version: doc.version,
      content: doc.content,
      extra: doc.extra,
      status: doc.status,
      title: doc.title,
      action: "create",
      created_at: doc.created_at,
      created_by: "plan-progress-test",
      slug: doc.slug,
    },
    audit: { timestamp: doc.created_at, actor: "plan-progress-test", session_id: doc.id, action: "create", doc_id: doc.id, details: { version: 1 } },
  };
}

async function seed(store: StoreInterface, doc: DocRecord): Promise<DocRecord> {
  const { version, audit } = provenance(doc);
  const inserted = await store.insertWithProvenance(doc, version, audit);
  if (!inserted.ok) throw new Error(`seed failed: ${JSON.stringify(inserted.error)}`);
  return inserted.value;
}

async function seedPlan(store: StoreInterface, title = "Plan"): Promise<DocRecord> {
  return seed(store, rawDoc("plan", title, {}));
}

async function seedTask(store: StoreInterface, plan: DocRecord, title: string, status: DocRecord["status"] = "draft"): Promise<DocRecord> {
  return seed(store, rawDoc("task", title, { plan_id: plan.id }, status, plan.id));
}

async function reload(store: StoreInterface, id: DocId): Promise<DocRecord> {
  const found = await store.find(id);
  if (!found.ok || found.value === null) throw new Error(`doc ${id} missing`);
  return found.value;
}

async function progressOf(store: StoreInterface, plan: DocRecord) {
  return readStoredPlanProgress((await reload(store, plan.id)).extra);
}

/** Move `task` to `status` through the composite write the service uses; returns the store's Result. */
async function moveTask(store: StoreInterface, task: DocRecord, status: DocRecord["status"]) {
  const current = await reload(store, task.id);
  const now = new Date().toISOString();
  const next = current.version + 1;
  return store.updateWithProvenance(
    current.id,
    { status, version: next, updated_at: now },
    { expected_version: current.version },
    {
      doc_id: current.id,
      version: next,
      content: current.content,
      extra: current.extra,
      status,
      title: current.title,
      action: "update",
      created_at: now,
      created_by: "plan-progress-test",
      slug: current.slug,
    },
    { timestamp: now, actor: "plan-progress-test", session_id: current.id, action: "update", doc_id: current.id, details: { version: next, new_version: next } },
  );
}

/** Make every plan version insert fail after the task write (trigger for the file stores, subclass for memory). */
function injectPlanVersionFailure(fx: Fixture, planId: DocId): () => void {
  if (fx.kind === "memory") {
    (fx.store as FailingVersionStore).failFor = planId;
    return () => {
      (fx.store as FailingVersionStore).failFor = null;
    };
  }
  const raw = new Database(fx.dbPath);
  raw.exec(
    `CREATE TRIGGER inject_plan_version_failure BEFORE INSERT ON versions WHEN NEW.doc_id = '${planId}' AND NEW.version > 1 BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
  );
  raw.close();
  return () => {
    const cleanup = new Database(fx.dbPath);
    cleanup.exec("DROP TRIGGER IF EXISTS inject_plan_version_failure");
    cleanup.close();
  };
}

const fixtures: Fixture[] = [];
afterEach(() => {
  for (const fx of fixtures.splice(0)) {
    const closable = fx.store as unknown as { close?: () => void };
    closable.close?.();
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

describe.each(KINDS)("progress written with the task — %s store", (kind) => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture(kind);
    fixtures.push(fx);
  });

  it("HAPPY: a plan is born empty, a task insert raises total and open, finishing the last open task makes it complete", async () => {
    const plan = await seedPlan(fx.store);
    expect(readStoredPlanProgress(plan.extra)).toMatchObject({ state: "empty", open: 0, total: 0 });

    const first = await seedTask(fx.store, plan, "First");
    const second = await seedTask(fx.store, plan, "Second");
    expect(await progressOf(fx.store, plan)).toMatchObject({ state: "in-progress", open: 2, total: 2 });

    expect((await moveTask(fx.store, first, "approved")).ok).toBe(true);
    expect((await moveTask(fx.store, first, "active")).ok).toBe(true);
    expect((await moveTask(fx.store, first, "archived")).ok).toBe(true);
    expect(await progressOf(fx.store, plan)).toMatchObject({ state: "in-progress", open: 1, total: 2 });

    expect((await moveTask(fx.store, second, "deprecated")).ok).toBe(true);
    expect(await progressOf(fx.store, plan)).toMatchObject({ state: "complete", open: 0, total: 2 });
  });

  it("HAPPY: the plan write is its own attributed version and audit row (counter_cache in the same transaction)", async () => {
    const plan = await seedPlan(fx.store);
    await seedTask(fx.store, plan, "Only");
    const versions = await fx.store.findVersions(plan.id);
    if (!versions.ok) throw new Error("versions");
    expect(versions.value.map((v) => v.version).sort()).toEqual([1, 2]);
    const audit = await fx.store.queryAudit({ doc_id: plan.id });
    if (!audit.ok) throw new Error("audit");
    expect(audit.value.some((a) => a.details?.["operation"] === "plan-progress")).toBe(true);
  });

  it("BOUNDARY: a task write that leaves the aggregate unchanged writes no plan version", async () => {
    const plan = await seedPlan(fx.store);
    const task = await seedTask(fx.store, plan, "Steady");
    const before = (await reload(fx.store, plan.id)).version;
    expect((await moveTask(fx.store, task, "approved")).ok).toBe(true); // draft -> approved: still open
    expect((await reload(fx.store, plan.id)).version).toBe(before);
  });

  it("BOUNDARY: a task of another plan, or with no plan, never touches this plan", async () => {
    const plan = await seedPlan(fx.store, "Mine");
    const other = await seedPlan(fx.store, "Other");
    const before = (await reload(fx.store, plan.id)).version;
    await seedTask(fx.store, other, "Elsewhere");
    expect((await reload(fx.store, plan.id)).version).toBe(before);
    expect(await progressOf(fx.store, plan)).toMatchObject({ state: "empty", total: 0 });
  });

  it("STATE: a phase doc under the plan counts as a member (empty means no task and no phase)", async () => {
    const plan = await seedPlan(fx.store);
    await seed(fx.store, rawDoc("phase", "Phase one", {}, "draft", plan.id));
    expect(await progressOf(fx.store, plan)).toMatchObject({ state: "in-progress", open: 1, total: 1 });
  });

  it("STATE: a deleted task leaves the count", async () => {
    const plan = await seedPlan(fx.store);
    const task = await seedTask(fx.store, plan, "Doomed");
    const now = new Date().toISOString();
    const deleted = await fx.store.softDeleteWithProvenance(
      task.id,
      { doc_id: task.id, version: 0, content: "", extra: {}, status: "draft", title: task.title, action: "delete", created_at: now, created_by: "plan-progress-test", slug: task.slug },
      { timestamp: now, actor: "plan-progress-test", session_id: task.id, action: "delete", doc_id: task.id, details: {} },
    );
    expect(deleted.ok).toBe(true);
    expect(await progressOf(fx.store, plan)).toMatchObject({ state: "empty", open: 0, total: 0 });
  });

  // reason: one libsql client opens two write transactions at once and the second gets SQLITE_BUSY from the driver
  // (not from this change); cross-process contention on the file stores is covered by the two-connection test below.
  it.skipIf(kind === "turso")("STATE: two tasks finishing concurrently end with open=0 and state complete", async () => {
    const plan = await seedPlan(fx.store);
    const a = await seedTask(fx.store, plan, "Left", "active");
    const b = await seedTask(fx.store, plan, "Right", "active");
    const [ra, rb] = await Promise.all([moveTask(fx.store, a, "archived"), moveTask(fx.store, b, "archived")]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(await progressOf(fx.store, plan)).toMatchObject({ state: "complete", open: 0, total: 2 });
  });

  it("ERROR: a failure after the task write leaves task and plan unchanged", async () => {
    const plan = await seedPlan(fx.store);
    const task = await seedTask(fx.store, plan, "Atomic", "active");
    const planBefore = await reload(fx.store, plan.id);
    const restore = injectPlanVersionFailure(fx, plan.id);
    try {
      const result = await moveTask(fx.store, task, "archived");
      expect(result.ok).toBe(false);
    } finally {
      restore();
    }
    expect((await reload(fx.store, task.id)).status).toBe("active");
    expect((await reload(fx.store, task.id)).version).toBe(task.version);
    const planAfter = await reload(fx.store, plan.id);
    expect(planAfter.version).toBe(planBefore.version);
    expect(planAfter.extra).toEqual(planBefore.extra);
  });

  it("NEGATIVE: an archived plan refuses a new task and a new phase with VALIDATION_ERROR, writing nothing", async () => {
    const plan = await seedPlan(fx.store);
    const task = await seedTask(fx.store, plan, "Last", "active");
    expect((await moveTask(fx.store, task, "archived")).ok).toBe(true);
    // The plan itself is archived (a plan-close write; the progress write already left it complete).
    const planNow = await reload(fx.store, plan.id);
    const now = new Date().toISOString();
    const archivedPlan = await fx.store.updateWithProvenance(
      plan.id,
      { status: "archived", version: planNow.version + 1, updated_at: now },
      { expected_version: planNow.version },
      { doc_id: plan.id, version: planNow.version + 1, content: "", extra: planNow.extra, status: "archived", title: plan.title, action: "update", created_at: now, created_by: "plan-progress-test", slug: plan.slug },
      { timestamp: now, actor: "plan-progress-test", session_id: plan.id, action: "update", doc_id: plan.id, details: {} },
    );
    expect(archivedPlan.ok).toBe(true);
    const planVersion = (await reload(fx.store, plan.id)).version;

    for (const doc of [rawDoc("task", "Late", { plan_id: plan.id }, "draft", plan.id), rawDoc("phase", "Late phase", {}, "draft", plan.id)]) {
      const { version, audit } = provenance(doc);
      const refused = await fx.store.insertWithProvenance(doc, version, audit);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("VALIDATION_ERROR");
      const found = await fx.store.find(doc.id);
      expect(found.ok && found.value === null).toBe(true);
    }
    expect((await reload(fx.store, plan.id)).version).toBe(planVersion);
  });

  it("NEGATIVE: an archived task refuses any other status with VALIDATION_ERROR", async () => {
    const plan = await seedPlan(fx.store);
    const task = await seedTask(fx.store, plan, "Terminal", "active");
    expect((await moveTask(fx.store, task, "archived")).ok).toBe(true);
    for (const status of ["active", "draft", "deprecated"] as const) {
      const refused = await moveTask(fx.store, task, status);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("VALIDATION_ERROR");
    }
    expect((await reload(fx.store, task.id)).status).toBe("archived");
    expect(await progressOf(fx.store, plan)).toMatchObject({ state: "complete", open: 0, total: 1 });
  });

  it("REGRESSION: a plan edit that rebuilds extra without progress keeps the stored progress", async () => {
    const plan = await seedPlan(fx.store);
    await seedTask(fx.store, plan, "Anchor");
    const current = await reload(fx.store, plan.id);
    const now = new Date().toISOString();
    const next = current.version + 1;
    const edited = await fx.store.updateWithProvenance(
      plan.id,
      { extra: { requires_uat: true }, version: next, updated_at: now },
      { expected_version: current.version },
      { doc_id: plan.id, version: next, content: "", extra: { requires_uat: true }, status: current.status, title: plan.title, action: "update", created_at: now, created_by: "plan-progress-test", slug: plan.slug },
      { timestamp: now, actor: "plan-progress-test", session_id: plan.id, action: "update", doc_id: plan.id, details: {} },
    );
    expect(edited.ok).toBe(true);
    const after = await reload(fx.store, plan.id);
    expect(after.extra["requires_uat"]).toBe(true);
    expect(readStoredPlanProgress(after.extra)).toMatchObject({ state: "in-progress", open: 1, total: 1 });
    const versions = await fx.store.findVersions(plan.id);
    if (!versions.ok) throw new Error("versions");
    const snapshot = versions.value.find((v) => v.version === next);
    expect(readStoredPlanProgress(snapshot?.extra ?? {})).not.toBeNull();
  });
});

describe("progress written with the task — two SQLite connections", () => {
  it("STATE: two processes' connections finishing two tasks end with open=0 (CAS inside the write lock)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-plan-progress-conn-"));
    const dbPath = join(dir, "corpus.db");
    const first = actedStore(new SQLiteStore(dbPath));
    const second = actedStore(new SQLiteStore(dbPath));
    try {
      const plan = await seedPlan(first);
      const a = await seedTask(first, plan, "Left", "active");
      const b = await seedTask(first, plan, "Right", "active");
      const [ra, rb] = await Promise.all([moveTask(first, a, "archived"), moveTask(second, b, "archived")]);
      expect(ra.ok).toBe(true);
      expect(rb.ok).toBe(true);
      expect(await progressOf(first, plan)).toMatchObject({ state: "complete", open: 0, total: 2 });
    } finally {
      first.close();
      second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("progress written with the task — CorpusService write path", () => {
  it("REGRESSION: a plan created through the service carries progress, and writeDoc / delete keep it current", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const created = await service.create({ type: "plan", title: "Service plan" });
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    expect(readStoredPlanProgress(created.value.extra)).toMatchObject({ state: "empty", total: 0 });

    const task = await seedTask(store, created.value, "Via service");
    expect(await progressOf(store, created.value)).toMatchObject({ state: "in-progress", open: 1, total: 1 });

    const written = await service.writeDoc({ doc: task, patch: { status: "approved" }, action: "update", auditAction: "update", lock: "none" });
    expect(written.ok).toBe(true);
    const finished = await service.writeDoc({
      doc: (await reload(store, task.id)),
      patch: { status: "deprecated" },
      action: "update",
      auditAction: "update",
      lock: "none",
    });
    expect(finished.ok).toBe(true);
    expect(await progressOf(store, created.value)).toMatchObject({ state: "complete", open: 0, total: 1 });

    const draft = await seedTask(store, created.value, "Draft to delete");
    expect(await progressOf(store, created.value)).toMatchObject({ state: "in-progress", open: 1, total: 2 });
    const deleted = await service.delete(draft.id, true);
    if (!deleted.ok) throw new Error(JSON.stringify(deleted.error));
    expect(await progressOf(store, created.value)).toMatchObject({ state: "complete", open: 0, total: 1 });
  });

  it("NEGATIVE: the service refuses a task under an archived plan on the insertDoc (import) route", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const plan = await seedPlan(store);
    const now = new Date().toISOString();
    const archived = await store.updateWithProvenance(
      plan.id,
      { status: "archived", version: 3, updated_at: now },
      undefined,
      { doc_id: plan.id, version: 3, content: "", extra: plan.extra, status: "archived", title: plan.title, action: "update", created_at: now, created_by: "plan-progress-test", slug: plan.slug },
      { timestamp: now, actor: "plan-progress-test", session_id: plan.id, action: "update", doc_id: plan.id, details: {} },
    );
    expect(archived.ok).toBe(true);
    const refused = await service.insertDoc({
      doc: rawDoc("task", "Imported late", { plan_id: plan.id }, "draft", plan.id),
      auditAction: "create",
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("backfill, no repair path — migration batch recompute", () => {
  it("backfill: 3 plans of mixed task states are migrated to the correct state, open and total; none lacks progress", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-plan-progress-migrate-"));
    const dbPath = join(dir, "corpus.db");
    const planIds: DocId[] = [];
    try {
      const store = actedStore(new SQLiteStore(dbPath));
      const emptyPlan = await seedPlan(store, "Empty plan");
      const openPlan = await seedPlan(store, "Open plan");
      await seedTask(store, openPlan, "Done one", "archived");
      await seedTask(store, openPlan, "Open one", "active");
      await seedTask(store, openPlan, "Dropped", "deprecated");
      const donePlan = await seedPlan(store, "Done plan");
      await seedTask(store, donePlan, "Finished", "archived");
      const deletedTask = await seedTask(store, donePlan, "Removed", "active");
      planIds.push(emptyPlan.id, openPlan.id, donePlan.id);
      store.close();

      // Model the corpus as it was before this change: schema 34, no progress on any plan, one soft-deleted open task.
      const raw = new Database(dbPath);
      raw.exec("UPDATE docs SET extra = json_remove(extra, '$.progress') WHERE type = 'plan'");
      raw.prepare("UPDATE docs SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), deletedTask.id);
      raw.exec("PRAGMA user_version = 34");
      raw.close();

      const migrated = actedStore(new SQLiteStore(dbPath, { migrate: true }));
      try {
        expect(await progressOf(migrated, emptyPlan)).toMatchObject({ state: "empty", open: 0, total: 0 });
        expect(await progressOf(migrated, openPlan)).toMatchObject({ state: "in-progress", open: 1, total: 3 });
        expect(await progressOf(migrated, donePlan)).toMatchObject({ state: "complete", open: 0, total: 1 });
        const plans = await migrated.findMany({ type: "plan" });
        if (!plans.ok) throw new Error("plans");
        expect(plans.value.length).toBe(3);
        for (const plan of plans.value) expect(readStoredPlanProgress(plan.extra)).not.toBeNull();
      } finally {
        migrated.close();
      }
      const probe = new Database(dbPath, { readonly: true });
      const version = probe.query("PRAGMA user_version").get() as { user_version: number };
      probe.close();
      expect(version.user_version).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no repair path: no standing recompute command exists in the CLI command registry", () => {
    const commandsDir = join(import.meta.dirname, "../../src/adapters/cli/commands");
    const offenders = readdirSync(commandsDir)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => /recompute|reconcile|repair/i.test(file) || /progress.*(recompute|repair|rebuild)|(recompute|repair|rebuild).*progress/i.test(readFileSync(join(commandsDir, file), "utf8").split("\n").filter((line) => /name:\s*["'`]/.test(line)).join("\n")));
    expect(offenders).toEqual([]);
  });
});
