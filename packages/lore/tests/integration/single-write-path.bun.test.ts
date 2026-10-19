// @reads packages/lore/src/**
/**
 * AC-DCL-3 — every corpus write goes through ONE write path (CorpusService's `writeDoc` route).
 *
 * @spec_ref spec-defect-clusters-round-1-done-floors-judge-real-runs-on D3, AC-DCL-3
 * Reports: #252 #253 #255 #113 #145 #161 #44 #276 #297 #298
 *
 * What each write must carry, asserted on a REAL SQLite corpus in an mkdtemp dir (never the repo's `.lore/`),
 * opened through `withWriteContext` so every row names the CALLER and the registered RUN:
 *   - exactly one version row and one audit row per version bump, attributed to the caller and the run
 *     (never "system", never the doc's creator);
 *   - the foreign-corpus refusal (restore / validity transition / each in-place migration, asserted separately);
 *   - the record-lock refusal (RECORD_LOCKED) on a locked record;
 *   - a write that changes nothing writes nothing;
 *   - restore is ONE transaction (a failure injected after the doc update leaves no partial row).
 * A static scan finds no `store.update(` / `insertVersion(` / `appendAuditEntry(` (nor the `*WithProvenance` and
 * rule-registry primitives) outside `corpus-service.ts` and `store/*`, bar the pinned, named exception list below.
 *
 * Coverage: HAPPY (each write) / NEGATIVE (foreign, locked) / BOUNDARY (no-op) / ERROR (injected failure) /
 * STATE (version bump == rows) / REGRESSION (static scan, wiring).
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { AuditEntry, CreateDocInput, DocRecord, DocType, VersionRecord } from "@lore/core";
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { VersionService } from "../../src/service/version-service.js";
import { MigrationService } from "../../src/service/migration-service.js";
import { OrdinalMigrationService } from "../../src/service/ordinal-migration-service.js";
import { PhaseMigrationService } from "../../src/service/phase-migration-service.js";
import { ValidityService } from "../../src/service/validity-service.js";
import { RuleService } from "../../src/service/rule-service.js";
import { PhaseService } from "../../src/service/phase-service.js";
import { TreeCheckService } from "../../src/service/tree-check-service.js";
import { RequirementService } from "../../src/service/requirement-service.js";
import { FOREIGN_CORPUS_WRITE_TOKEN } from "../../src/service/foreign-corpus-write-guard.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../src/store/store-interface.js";
import { withWriteContext } from "../../src/store/write-context-store.js";
import { createApp } from "../../src/app.js";
import { liveAmbient, liveWriteContext } from "../live-invocation.js";

const CALLER = "agent:dcl3-caller";
const AUTHOR = "agent:dcl3-original-author";
const RUN = "cc:dcl3-run";

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

// ─── Fixture ────────────────────────────────────────────────────────────────

interface Fixture {
  readonly dir: string;
  /** The un-wrapped store: seeds docs/versions WITHOUT stamping, and reads rows back. */
  readonly raw: SQLiteStore;
  /** The store every service writes through: stamps the CALLER's run on every provenance row. */
  readonly store: StoreInterface;
  readonly lock: RecordLockService;
  /** The one write route, over `store`. */
  readonly corpus: CorpusService;
}

function openFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "single-write-path-"));
  scratch.push(dir);
  const raw = new SQLiteStore(join(dir, "lore.db"));
  const store = withWriteContext(raw, { identity: { harnessRun: RUN as never, claimed: CALLER, claimedSource: "flag" } });
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  return { dir, raw, store, lock, corpus: new CorpusService(store, lock) };
}

/** A foreign-resolved corpus context: the §M4 git-common-dir fallback with the guard on. */
function goForeign(corpus: CorpusService): void {
  corpus.setForeignCorpusWriteContext({ provenance: "git_common_dir", enabled: true });
}

let counter = 0;

function makeDoc(type: DocType, overrides: Partial<DocRecord> = {}): DocRecord {
  counter += 1;
  const n = String(counter).padStart(6, "0");
  return {
    id: `01HDCL3000000000000${n}`.slice(0, 26).padEnd(26, "0"),
    slug: `${type}-dcl3-fixture-${n}`,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: `Fixture ${type} ${n}`,
    status: "draft",
    priority: "medium",
    content: "Fixture body.",
    parent_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: AUTHOR,
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ordinal: null,
    ...overrides,
  } as DocRecord;
}

async function seed(fx: Fixture, doc: DocRecord): Promise<DocRecord> {
  const inserted = await fx.raw.insert(doc);
  if (!inserted.ok) throw new Error(`seed ${doc.type} failed: ${JSON.stringify(inserted.error)}`);
  return doc;
}

async function seedVersion(fx: Fixture, doc: DocRecord, version: number, patch: Partial<VersionRecord> = {}): Promise<void> {
  const r = await fx.raw.insertVersion({
    doc_id: doc.id,
    version,
    content: doc.content,
    extra: doc.extra,
    status: doc.status,
    title: doc.title,
    action: "update",
    created_at: doc.created_at,
    created_by: AUTHOR,
    slug: doc.slug,
    ...patch,
  });
  if (!r.ok) throw new Error(`seedVersion failed: ${JSON.stringify(r.error)}`);
}

async function mustCreate(corpus: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`fixture create ${input.type} failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

async function currentDoc(fx: Fixture, id: string): Promise<DocRecord> {
  const r = await fx.raw.find(id);
  if (!r.ok || r.value === null) throw new Error(`doc ${id} not found`);
  return r.value;
}

async function versionsOf(fx: Fixture, id: string): Promise<VersionRecord[]> {
  const r = await fx.raw.findVersions(id);
  if (!r.ok) throw new Error("findVersions failed");
  return r.value;
}

async function auditOf(fx: Fixture, id: string): Promise<AuditEntry[]> {
  const r = await fx.raw.queryAudit({ doc_id: id });
  if (!r.ok) throw new Error("queryAudit failed");
  return r.value;
}

interface Rows {
  readonly version: number;
  readonly versions: number;
  readonly audits: number;
}

async function rowsOf(fx: Fixture, id: string): Promise<Rows> {
  return {
    version: (await currentDoc(fx, id)).version,
    versions: (await versionsOf(fx, id)).length,
    audits: (await auditOf(fx, id)).length,
  };
}

/**
 * The write contract for ONE doc between two snapshots: every version bump has exactly one new version row and one
 * new audit row, all of them naming the CALLER and the RUN — never "system", never the doc's creator.
 * Returns the number of bumps so a caller can pin it.
 */
async function expectPairedRowsByCaller(fx: Fixture, id: string, before: Rows): Promise<number> {
  const after = await rowsOf(fx, id);
  const bumps = after.version - before.version;
  expect(after.versions - before.versions).toBe(bumps);
  expect(after.audits - before.audits).toBe(bumps);
  const versions = (await versionsOf(fx, id)).filter((v) => v.version > before.version);
  const audits = (await auditOf(fx, id)).filter((a) => {
    const v = a.details?.["version"];
    return typeof v === "number" && v > before.version;
  });
  expect(versions).toHaveLength(bumps);
  expect(audits).toHaveLength(bumps);
  for (const v of versions) {
    expect(v.created_by).toBe(CALLER);
    expect(v.created_by).not.toBe(AUTHOR);
    expect(v.harness_run).toBe(RUN);
  }
  for (const a of audits) {
    expect(a.actor).toBe(CALLER);
    expect(a.actor).not.toBe("system");
    expect(a.harness_run).toBe(RUN);
  }
  return bumps;
}

async function expectNothingWritten(fx: Fixture, id: string, before: Rows): Promise<void> {
  expect(await rowsOf(fx, id)).toEqual(before);
}

function errorText(r: { ok: boolean; error?: unknown }): string {
  if (r.ok) throw new Error("expected an error result, got ok");
  return JSON.stringify(r.error);
}

// ─── restore (#252 #113 #255) ───────────────────────────────────────────────

/** A prd at version 2 (content B) with version rows v1 (content A) and v2 — authored by AUTHOR, restored by CALLER. */
async function seedRestorable(fx: Fixture, over: Partial<DocRecord> = {}): Promise<DocRecord> {
  const v1 = makeDoc("prd", { content: "Content A", version: 1, ...over });
  const doc = { ...v1, content: "Content B", version: 2, updated_at: "2026-01-02T00:00:00.000Z" };
  await seed(fx, doc);
  await seedVersion(fx, v1, 1, { action: "create" });
  await seedVersion(fx, doc, 2);
  return doc;
}

describe("AC-DCL-3 restore — VersionService.restore", () => {
  it("HAPPY: one version row and one audit row, naming the CALLER and RUN, not the doc's creator (#252)", async () => {
    const fx = openFixture();
    const doc = await seedRestorable(fx);
    const before = await rowsOf(fx, doc.id);

    const restored = await new VersionService(fx.store, fx.lock, fx.corpus).restore(doc.id, 1);
    expect(restored.ok).toBe(true);

    expect(await expectPairedRowsByCaller(fx, doc.id, before)).toBe(1);
    expect((await currentDoc(fx, doc.id)).content).toBe("Content A");
    const row = (await versionsOf(fx, doc.id)).find((v) => v.version === 3);
    expect(row?.action).toBe("restore");
    expect(row?.created_by).toBe(CALLER);
    const audit = (await auditOf(fx, doc.id)).find((a) => a.action === "restore");
    expect(audit?.actor).toBe(CALLER);
    expect(audit?.details?.["restored_from_version"]).toBe(1);
  });

  it("NEGATIVE: from a foreign-resolved corpus restore is refused, naming the foreign-corpus rule, and writes nothing (#255)", async () => {
    const fx = openFixture();
    const doc = await seedRestorable(fx);
    goForeign(fx.corpus);
    const before = await rowsOf(fx, doc.id);

    const restored = await new VersionService(fx.store, fx.lock, fx.corpus).restore(doc.id, 1);
    expect(restored.ok).toBe(false);
    expect(errorText(restored)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
    await expectNothingWritten(fx, doc.id, before);
    expect((await currentDoc(fx, doc.id)).content).toBe("Content B");
  });

  it("NEGATIVE: a locked record (approved spec) refuses restore with RECORD_LOCKED and writes nothing", async () => {
    const fx = openFixture();
    const v1 = makeDoc("spec", { content: "Spec A", version: 1, status: "draft" });
    const approved = { ...v1, content: "Spec B", version: 2, status: "approved" as const };
    await seed(fx, approved);
    await seedVersion(fx, v1, 1, { action: "create" });
    await seedVersion(fx, approved, 2, { action: "approve" });
    const before = await rowsOf(fx, approved.id);

    const restored = await new VersionService(fx.store, fx.lock, fx.corpus).restore(approved.id, 1);
    expect(restored.ok).toBe(false);
    expect(errorText(restored)).toContain("RECORD_LOCKED");
    await expectNothingWritten(fx, approved.id, before);
  });

  it("BOUNDARY: restoring to the state the doc already has changes nothing and writes no row", async () => {
    const fx = openFixture();
    const doc = await seedRestorable(fx);
    const before = await rowsOf(fx, doc.id);

    const restored = await new VersionService(fx.store, fx.lock, fx.corpus).restore(doc.id, 2);
    expect(restored.ok).toBe(true);
    await expectNothingWritten(fx, doc.id, before);
  });

  it("ERROR: a failure injected after the doc update leaves no partial doc, version or audit row (#113)", async () => {
    const fx = openFixture();
    const doc = await seedRestorable(fx);
    // Injection: a stray version row already occupies (doc_id, 3), so the version insert of the restore collides
    // AFTER the doc row was updated inside the transaction — the whole write must roll back.
    await seedVersion(fx, { ...doc, version: 3 }, 3, { change_summary: "stray row that collides" });
    const before = await rowsOf(fx, doc.id);

    const restored = await new VersionService(fx.store, fx.lock, fx.corpus).restore(doc.id, 1);
    expect(restored.ok).toBe(false);

    const after = await currentDoc(fx, doc.id);
    expect(after.version).toBe(2);
    expect(after.content).toBe("Content B");
    expect(await rowsOf(fx, doc.id)).toEqual({ ...before, version: 2 });
    expect((await auditOf(fx, doc.id)).filter((a) => a.action === "restore")).toHaveLength(0);
  });
});

// ─── validity transitions (#255) ────────────────────────────────────────────

describe("AC-DCL-3 validity — ValidityService.invalidate", () => {
  async function seedAdr(fx: Fixture, over: Partial<DocRecord> = {}): Promise<DocRecord> {
    const doc = makeDoc("adr", { extra: { decision_status: "accepted" }, ...over });
    await seed(fx, doc);
    await seedVersion(fx, doc, 1, { action: "create" });
    return doc;
  }

  it("HAPPY: an invalidation and its undo are one version row and one audit row each, naming the CALLER and RUN", async () => {
    const fx = openFixture();
    const doc = await seedAdr(fx);
    const service = new ValidityService(fx.store, undefined, undefined, fx.corpus);

    const before = await rowsOf(fx, doc.id);
    const invalidated = await service.invalidate(doc.id, { by: CALLER, reason: "stopped being true" });
    expect(invalidated.ok).toBe(true);
    expect(await expectPairedRowsByCaller(fx, doc.id, before)).toBe(1);
    const row = (await auditOf(fx, doc.id)).find((a) => a.action === "invalidate");
    expect(row?.actor).toBe(CALLER);

    const afterInvalidate = await rowsOf(fx, doc.id);
    const undone = await service.invalidate(doc.id, { by: CALLER, undo: true });
    expect(undone.ok).toBe(true);
    expect(await expectPairedRowsByCaller(fx, doc.id, afterInvalidate)).toBe(1);
  });

  it("NEGATIVE: from a foreign-resolved corpus a validity transition is refused and writes nothing (#255)", async () => {
    const fx = openFixture();
    const doc = await seedAdr(fx);
    goForeign(fx.corpus);
    const before = await rowsOf(fx, doc.id);

    const invalidated = await new ValidityService(fx.store, undefined, undefined, fx.corpus).invalidate(doc.id, { by: CALLER });
    expect(invalidated.ok).toBe(false);
    expect(errorText(invalidated)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
    await expectNothingWritten(fx, doc.id, before);
  });

  it("STATE: invalidation is the sanctioned exit for a locked record — an approved ADR is NOT refused by the record lock", async () => {
    const fx = openFixture();
    const doc = await seedAdr(fx, { status: "approved" });
    const invalidated = await new ValidityService(fx.store, undefined, undefined, fx.corpus).invalidate(doc.id, { by: CALLER });
    expect(invalidated.ok).toBe(true);
  });
});

// ─── in-place migrations (#161 #255) ────────────────────────────────────────

describe("AC-DCL-3 ordinal migration — OrdinalMigrationService", () => {
  async function seedNumbered(fx: Fixture): Promise<{ a: DocRecord; b: DocRecord; locked: DocRecord; projectDir: string }> {
    const a = await seed(fx, makeDoc("spec", { title: "SPEC-1 — Alpha", created_at: "2026-01-01T00:00:00.000Z" }));
    const b = await seed(fx, makeDoc("spec", { title: "SPEC-2 — Beta", created_at: "2026-01-02T00:00:00.000Z" }));
    const locked = await seed(
      fx,
      makeDoc("spec", { title: "SPEC-3 — Gamma", created_at: "2026-01-03T00:00:00.000Z", status: "approved" }),
    );
    const projectDir = join(fx.dir, "project");
    mkdirSync(join(projectDir, ".lore"), { recursive: true });
    return { a, b, locked, projectDir };
  }

  it("HAPPY: every ordinal backfill and title strip is a version bump with exactly one version row and one audit row, by the CALLER and RUN", async () => {
    const fx = openFixture();
    const { a, b, projectDir } = await seedNumbered(fx);
    const beforeA = await rowsOf(fx, a.id);
    const beforeB = await rowsOf(fx, b.id);

    const result = await new OrdinalMigrationService(fx.store, fx.corpus).migrateOrdinals({ dryRun: false, projectDir });
    expect(result.ok).toBe(true);

    // backfill (1 bump) + title strip (1 bump), each paired — never an unrecorded bump (#161 sibling of #276)
    expect(await expectPairedRowsByCaller(fx, a.id, beforeA)).toBe(2);
    expect(await expectPairedRowsByCaller(fx, b.id, beforeB)).toBe(2);
    expect((await currentDoc(fx, a.id)).title).toBe("Alpha");
    const actions = (await auditOf(fx, a.id)).map((r) => r.action);
    expect(actions).toContain("ordinal-backfill");
  });

  it("NEGATIVE: a locked record's title strip is refused with RECORD_LOCKED, its title is untouched, and the refusal is reported (#161)", async () => {
    const fx = openFixture();
    const { locked, projectDir } = await seedNumbered(fx);

    const result = await new OrdinalMigrationService(fx.store, fx.corpus).migrateOrdinals({ dryRun: false, projectDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await currentDoc(fx, locked.id)).title).toBe("SPEC-3 — Gamma");
    expect(result.value.errors.some((e) => e.includes(locked.id) && e.includes("RECORD_LOCKED"))).toBe(true);
    // the ordinal backfill is metadata, not text: it still landed, paired, as the caller.
    const rows = await versionsOf(fx, locked.id);
    expect(rows.every((v) => v.created_by === CALLER)).toBe(true);
  });

  it("NEGATIVE: a dry run reports the same record-lock refusal a live run would hit, and writes nothing", async () => {
    const fx = openFixture();
    const { locked, projectDir } = await seedNumbered(fx);
    const before = await rowsOf(fx, locked.id);

    const result = await new OrdinalMigrationService(fx.store, fx.corpus).migrateOrdinals({ dryRun: true, projectDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.errors.some((e) => e.includes(locked.id) && e.includes("RECORD_LOCKED"))).toBe(true);
    await expectNothingWritten(fx, locked.id, before);
  });

  it("NEGATIVE: from a foreign-resolved corpus the in-place migration writes nothing (#255)", async () => {
    const fx = openFixture();
    const { a, projectDir } = await seedNumbered(fx);
    goForeign(fx.corpus);
    const before = await rowsOf(fx, a.id);

    const result = await new OrdinalMigrationService(fx.store, fx.corpus).migrateOrdinals({ dryRun: false, projectDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.errors.some((e) => e.includes(FOREIGN_CORPUS_WRITE_TOKEN))).toBe(true);
    await expectNothingWritten(fx, a.id, before);
    expect((await currentDoc(fx, a.id)).title).toBe("SPEC-1 — Alpha");
  });

  it("BOUNDARY: a second run changes nothing and writes no row", async () => {
    const fx = openFixture();
    const { a, projectDir } = await seedNumbered(fx);
    const service = new OrdinalMigrationService(fx.store, fx.corpus);
    await service.migrateOrdinals({ dryRun: false, projectDir });
    const before = await rowsOf(fx, a.id);

    const second = await service.migrateOrdinals({ dryRun: false, projectDir });
    expect(second.ok).toBe(true);
    await expectNothingWritten(fx, a.id, before);
  });
});

describe("AC-DCL-3 phase migration — PhaseMigrationService", () => {
  async function seedPlanWithTasks(fx: Fixture, taskStatus: DocRecord["status"] = "draft"): Promise<{ plan: DocRecord; tasks: DocRecord[] }> {
    const plan = await seed(fx, makeDoc("plan", { status: "active" }));
    const tasks: DocRecord[] = [];
    for (const phase of ["build", "ship"]) {
      tasks.push(
        await seed(
          fx,
          makeDoc("task", { parent_id: plan.id, status: taskStatus, extra: { plan_id: plan.id, phase } }),
        ),
      );
    }
    return { plan, tasks };
  }

  it("HAPPY: each archived member task gets one version row and one audit row, by the CALLER and RUN; the new phase doc gets create rows", async () => {
    const fx = openFixture();
    const { tasks } = await seedPlanWithTasks(fx);
    const before = await Promise.all(tasks.map((t) => rowsOf(fx, t.id)));

    const result = await new PhaseMigrationService(fx.store, fx.corpus).migrateTasks({ dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phases_created).toBeGreaterThanOrEqual(2);

    for (const [i, task] of tasks.entries()) {
      expect(await expectPairedRowsByCaller(fx, task.id, before[i]!)).toBe(1);
      const stored = await currentDoc(fx, task.id);
      expect(stored.status).toBe("archived");
      expect(typeof stored.extra["migrated_to"]).toBe("string");
      const phaseId = stored.extra["migrated_to"] as string;
      const phaseVersions = await versionsOf(fx, phaseId);
      expect(phaseVersions).toHaveLength(1);
      expect(phaseVersions[0]?.action).toBe("create");
      expect(phaseVersions[0]?.created_by).toBe(CALLER);
      expect(phaseVersions[0]?.harness_run).toBe(RUN);
      const phaseAudit = await auditOf(fx, phaseId);
      expect(phaseAudit).toHaveLength(1);
      expect(phaseAudit[0]?.actor).toBe(CALLER);
    }
  });

  it("NEGATIVE: from a foreign-resolved corpus the migration is refused and writes nothing (#255)", async () => {
    const fx = openFixture();
    const { tasks } = await seedPlanWithTasks(fx);
    goForeign(fx.corpus);
    const before = await Promise.all(tasks.map((t) => rowsOf(fx, t.id)));

    const result = await new PhaseMigrationService(fx.store, fx.corpus).migrateTasks({ dryRun: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
    for (const [i, task] of tasks.entries()) await expectNothingWritten(fx, task.id, before[i]!);
    const all = await fx.raw.findMany({ type: "phase" as DocType });
    expect(all.ok && all.value.length).toBe(0);
  });

  it("STATE: the record lock protects text, not lifecycle — a claimed (locked) task is still archived into its phase, and a text rewrite of it would be refused", async () => {
    const fx = openFixture();
    const plan = await seed(fx, makeDoc("plan", { status: "active" }));
    const claimed = await seed(
      fx,
      makeDoc("task", {
        parent_id: plan.id,
        extra: { plan_id: plan.id, phase: "build", claim: { by: "agent:holder", at: new Date().toISOString() } },
      }),
    );
    const edit = await fx.corpus.writeDoc({
      doc: claimed,
      patch: { title: "Rewritten title" },
      action: "update",
      auditAction: "update",
      lock: "content",
    });
    expect(edit.ok).toBe(false);
    expect(errorText(edit)).toContain("RECORD_LOCKED");

    const result = await new PhaseMigrationService(fx.store, fx.corpus).migrateTasks({ dryRun: false });
    expect(result.ok).toBe(true);
    expect((await currentDoc(fx, claimed.id)).status).toBe("archived");
  });

  it("BOUNDARY: a second run creates nothing and writes no row on any migrated task", async () => {
    const fx = openFixture();
    const { tasks } = await seedPlanWithTasks(fx);
    const service = new PhaseMigrationService(fx.store, fx.corpus);
    await service.migrateTasks({ dryRun: false });
    const before = await Promise.all(tasks.map((t) => rowsOf(fx, t.id)));

    const second = await service.migrateTasks({ dryRun: false });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.phases_created).toBe(0);
    for (const [i, task] of tasks.entries()) await expectNothingWritten(fx, task.id, before[i]!);
  });
});

describe("AC-DCL-3 v1 import — MigrationService", () => {
  function writeV1(dir: string): string {
    const src = join(dir, "v1-source");
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, "prd.md"),
      `---\nid: "V1-PRD-1"\ntype: prd\nstatus: published\npriority: high\ncreated: "2025-01-01"\nupdated: "2025-06-01"\ntags: [v1]\nlinks: []\n---\n\n# Imported PRD\n\nBody.\n`,
    );
    return src;
  }

  it("HAPPY: an imported doc has its version row and its audit row, by the CALLER and RUN, and the version insert is not ignored (#253)", async () => {
    const fx = openFixture();
    const src = writeV1(fx.dir);

    const result = await new MigrationService(fx.store, fx.corpus).execute(src, {
      dryRun: false,
      skipSecretScan: true,
      idStrategy: "remap",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toBe(1);

    const docs = await fx.raw.findMany({});
    if (!docs.ok) throw new Error("findMany failed");
    const imported = docs.value.find((d) => d.extra["v1_original_id"] === "V1-PRD-1");
    expect(imported).toBeDefined();
    const versions = await versionsOf(fx, imported!.id);
    const audits = await auditOf(fx, imported!.id);
    expect(versions).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(versions[0]?.created_by).toBe(CALLER);
    expect(versions[0]?.harness_run).toBe(RUN);
    expect(audits[0]?.actor).toBe(CALLER);
    expect(audits[0]?.details?.["version"]).toBe(1);
  });

  it("NEGATIVE: from a foreign-resolved corpus the import is refused as a whole and writes no doc (#255)", async () => {
    const fx = openFixture();
    const src = writeV1(fx.dir);
    goForeign(fx.corpus);

    const result = await new MigrationService(fx.store, fx.corpus).execute(src, {
      dryRun: false,
      skipSecretScan: true,
      idStrategy: "remap",
    });
    expect(result.ok).toBe(false);
    expect(errorText(result)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
    const docs = await fx.raw.findMany({});
    expect(docs.ok && docs.value.length).toBe(0);
  });
});

// ─── rule move (#145), baseline depends (#297) ──────────────────────────────

describe("AC-DCL-3 baseline — RuleService", () => {
  async function seedTree(fx: Fixture): Promise<{ rules: RuleService; from: DocRecord; to: DocRecord; ruleId: string }> {
    const rules = new RuleService(fx.store, fx.corpus.create.bind(fx.corpus), fx.corpus);
    const prd = await mustCreate(fx.corpus, { type: "prd", title: "Product", content: "root" } as CreateDocInput);
    const root = await mustCreate(fx.corpus, {
      type: "baseline", title: "Baseline root", content: "r", parent_id: prd.id, extra: { node: "root", label: "Root" },
    } as CreateDocInput);
    const branch = await mustCreate(fx.corpus, {
      type: "baseline", title: "Baseline branch", content: "b", parent_id: root.id, extra: { node: "branch", label: "Branch" },
    } as CreateDocInput);
    const from = await mustCreate(fx.corpus, {
      type: "baseline", title: "Leaf one", content: "l1", parent_id: branch.id, extra: { node: "leaf", label: "One" },
    } as CreateDocInput);
    const to = await mustCreate(fx.corpus, {
      type: "baseline", title: "Leaf two", content: "l2", parent_id: branch.id, extra: { node: "leaf", label: "Two" },
    } as CreateDocInput);
    const added = await rules.addRule(
      from.id,
      { statement: "A moved rule keeps its id", confidence: "established", enforced_by: "guaranteed", examples: ["it stays BR-n"] },
      { by: CALLER },
    );
    if (!added.ok) throw new Error(`fixture addRule failed: ${JSON.stringify(added.error)}`);
    return { rules, from, to, ruleId: added.value.ruleId };
  }

  it("HAPPY: moving a rule writes exactly one version row and one audit row on EACH leaf, by the CALLER and RUN (#145)", async () => {
    const fx = openFixture();
    const { rules, from, to, ruleId } = await seedTree(fx);
    const beforeFrom = await rowsOf(fx, from.id);
    const beforeTo = await rowsOf(fx, to.id);

    const moved = await rules.setRule(ruleId, { moveTo: to.id }, { by: CALLER });
    expect(moved.ok).toBe(true);

    expect(await expectPairedRowsByCaller(fx, from.id, beforeFrom)).toBe(1);
    expect(await expectPairedRowsByCaller(fx, to.id, beforeTo)).toBe(1);
  });

  it("NEGATIVE: from a foreign-resolved corpus a rule move is refused and writes nothing", async () => {
    const fx = openFixture();
    const { rules, from, to, ruleId } = await seedTree(fx);
    goForeign(fx.corpus);
    const beforeFrom = await rowsOf(fx, from.id);
    const beforeTo = await rowsOf(fx, to.id);

    const moved = await rules.setRule(ruleId, { moveTo: to.id }, { by: CALLER });
    expect(moved.ok).toBe(false);
    expect(errorText(moved)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
    await expectNothingWritten(fx, from.id, beforeFrom);
    await expectNothingWritten(fx, to.id, beforeTo);
  });

  it("HAPPY + BOUNDARY: depends_on writes one paired row set when it changes and NOTHING when it does not (#297)", async () => {
    const fx = openFixture();
    const { rules, from, to, ruleId } = await seedTree(fx);
    const other = await rules.addRule(
      to.id,
      { statement: "Another rule to depend on", confidence: "established", enforced_by: "guaranteed", examples: ["x"] },
      { by: CALLER },
    );
    if (!other.ok) throw new Error("fixture addRule failed");

    const before = await rowsOf(fx, from.id);
    const added = await rules.setDependsOn(from.id, { add: [other.value.ruleId] }, { by: CALLER });
    expect(added.ok).toBe(true);
    expect(await expectPairedRowsByCaller(fx, from.id, before)).toBe(1);

    const afterFirst = await rowsOf(fx, from.id);
    const again = await rules.setDependsOn(from.id, { add: [other.value.ruleId] }, { by: CALLER });
    expect(again.ok).toBe(true);
    await expectNothingWritten(fx, from.id, afterFirst);
    expect(ruleId).toMatch(/^BR-/);
  });
});

// ─── phase rename (#44), tree-check --fix (#276), requirement add (#298) ────

describe("AC-DCL-3 phase rename — PhaseService.renamePhase", () => {
  it("HAPPY: each renamed member task gets one version row and one audit row, by the CALLER and RUN; the plan row keeps its internal identity (#44)", async () => {
    const fx = openFixture();
    const plan = await seed(fx, makeDoc("plan", { status: "active" }));
    const service = new PhaseService(fx.store, fx.lock, fx.corpus);
    expect((await service.addPhase(plan.id, "alpha")).ok).toBe(true);
    const t1 = await seed(fx, makeDoc("task", { parent_id: plan.id, extra: { plan_id: plan.id, phase: "alpha" } }));
    const t2 = await seed(fx, makeDoc("task", { parent_id: plan.id, status: "archived", extra: { plan_id: plan.id, phase: "alpha" } }));
    const before1 = await rowsOf(fx, t1.id);
    const before2 = await rowsOf(fx, t2.id);
    const beforePlan = await rowsOf(fx, plan.id);

    const renamed = await service.renamePhase(plan.id, "alpha", "beta");
    expect(renamed.ok).toBe(true);

    expect(await expectPairedRowsByCaller(fx, t1.id, before1)).toBe(1);
    expect(await expectPairedRowsByCaller(fx, t2.id, before2)).toBe(1);
    expect((await currentDoc(fx, t1.id)).extra["phase"]).toBe("beta");
    // the plan row: one version row + one audit row, attributed to the internal writer identity (AC-ROI-9).
    const afterPlan = await rowsOf(fx, plan.id);
    expect(afterPlan.versions - beforePlan.versions).toBe(1);
    expect(afterPlan.audits - beforePlan.audits).toBe(1);
  });

  it("NEGATIVE: from a foreign-resolved corpus a rename is refused before any task is touched", async () => {
    const fx = openFixture();
    const plan = await seed(fx, makeDoc("plan", { status: "active" }));
    const service = new PhaseService(fx.store, fx.lock, fx.corpus);
    await service.addPhase(plan.id, "alpha");
    const task = await seed(fx, makeDoc("task", { parent_id: plan.id, extra: { plan_id: plan.id, phase: "alpha" } }));
    goForeign(fx.corpus);
    const beforeTask = await rowsOf(fx, task.id);
    const beforePlan = await rowsOf(fx, plan.id);

    const renamed = await service.renamePhase(plan.id, "alpha", "beta");
    expect(renamed.ok).toBe(false);
    expect(errorText(renamed)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
    await expectNothingWritten(fx, task.id, beforeTask);
    await expectNothingWritten(fx, plan.id, beforePlan);
  });

  it("NEGATIVE: a closed (locked) plan refuses a rename with RECORD_LOCKED", async () => {
    const fx = openFixture();
    const plan = await seed(fx, makeDoc("plan", { status: "archived", extra: { phases: [{ name: "alpha" }] } }));
    const before = await rowsOf(fx, plan.id);
    const renamed = await new PhaseService(fx.store, fx.lock, fx.corpus).renamePhase(plan.id, "alpha", "beta");
    expect(renamed.ok).toBe(false);
    expect(errorText(renamed)).toContain("RECORD_LOCKED");
    await expectNothingWritten(fx, plan.id, before);
  });
});

describe("AC-DCL-3 tree-check — TreeCheckService.fix", () => {
  const blueprint = {
    version: 1,
    root: { type: "prd", min: 1, max: null, children: [{ type: "plan", min: 0, max: null, children: [] }] },
  } as never;

  it("HAPPY: a repaired parent_id is one version bump with one version row and one audit row, by the CALLER and RUN (#276)", async () => {
    const fx = openFixture();
    const prd = await seed(fx, makeDoc("prd"));
    const orphan = await seed(fx, makeDoc("plan", { parent_id: null }));
    const before = await rowsOf(fx, orphan.id);

    const fixed = await new TreeCheckService(fx.store, fx.corpus).fix(blueprint);
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    expect(fixed.value.fixed.some((f) => f.id === orphan.id)).toBe(true);

    expect(await expectPairedRowsByCaller(fx, orphan.id, before)).toBe(1);
    expect((await currentDoc(fx, orphan.id)).parent_id).toBe(prd.id);
    const audit = (await auditOf(fx, orphan.id)).find((a) => a.action === "tree-fix");
    expect(audit?.actor).toBe(CALLER);
  });

  it("NEGATIVE: from a foreign-resolved corpus the repair is refused and writes nothing", async () => {
    const fx = openFixture();
    await seed(fx, makeDoc("prd"));
    const orphan = await seed(fx, makeDoc("plan", { parent_id: null }));
    goForeign(fx.corpus);
    const before = await rowsOf(fx, orphan.id);

    const fixed = await new TreeCheckService(fx.store, fx.corpus).fix(blueprint);
    expect(fixed.ok).toBe(false);
    expect(errorText(fixed)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
    await expectNothingWritten(fx, orphan.id, before);
  });

  it("BOUNDARY: a second fix on a repaired tree writes nothing", async () => {
    const fx = openFixture();
    await seed(fx, makeDoc("prd"));
    const orphan = await seed(fx, makeDoc("plan", { parent_id: null }));
    const service = new TreeCheckService(fx.store, fx.corpus);
    await service.fix(blueprint);
    const before = await rowsOf(fx, orphan.id);
    const second = await service.fix(blueprint);
    expect(second.ok).toBe(true);
    await expectNothingWritten(fx, orphan.id, before);
  });
});

describe("AC-DCL-3 requirement add — RequirementService", () => {
  it("HAPPY: requirement add is one version row and one audit row attributed to the CALLER and RUN, not 'system' (#298)", async () => {
    const fx = openFixture();
    const prd = await seed(fx, makeDoc("prd"));
    const before = await rowsOf(fx, prd.id);

    const added = await new RequirementService(fx.store, true, fx.corpus).addRequirement(prd.id, {
      id: "R-1",
      statement: "Response time is under 200 ms at p95",
      priority: "P1",
    });
    expect(added.ok).toBe(true);
    expect(await expectPairedRowsByCaller(fx, prd.id, before)).toBe(1);
  });

  it("NEGATIVE: from a foreign-resolved corpus requirement add is refused and writes nothing", async () => {
    const fx = openFixture();
    const prd = await seed(fx, makeDoc("prd"));
    goForeign(fx.corpus);
    const before = await rowsOf(fx, prd.id);

    const added = await new RequirementService(fx.store, true, fx.corpus).addRequirement(prd.id, {
      id: "R-1",
      statement: "Response time is under 200 ms at p95",
      priority: "P1",
    });
    expect(added.ok).toBe(false);
    expect(errorText(added)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
    await expectNothingWritten(fx, prd.id, before);
  });
});

// ─── wiring: the composed app hands every service the one route ─────────────

describe("AC-DCL-3 wiring — createApp composes every service over the one write route", () => {
  it("REGRESSION: a foreign-resolved corpus context set once on app.corpusService refuses restore and the v1 import through the composed services", async () => {
    const dir = mkdtempSync(join(tmpdir(), "single-write-path-app-"));
    scratch.push(dir);
    mkdirSync(join(dir, ".lore"), { recursive: true });
    const app = createApp(join(dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    const prd = await mustCreate(app.corpusService, { type: "prd", title: "Wired", content: "v1" } as CreateDocInput);
    const set = await app.corpusService.set(prd.id, { content: "v2" });
    expect(set.ok).toBe(true);

    app.corpusService.setForeignCorpusWriteContext({ provenance: "git_common_dir", enabled: true });

    const restored = await app.versionService.restore(prd.id, 1);
    expect(restored.ok).toBe(false);
    expect(errorText(restored)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);

    const src = join(dir, "v1");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "a.md"), `---\nid: "W-1"\ntype: prd\nstatus: published\npriority: high\ncreated: "2025-01-01"\nupdated: "2025-06-01"\ntags: []\nlinks: []\n---\n\n# W\n\nBody.\n`);
    const imported = await app.migrationService.execute(src, { dryRun: false, skipSecretScan: true, idStrategy: "remap" });
    expect(imported.ok).toBe(false);
    expect(errorText(imported)).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
  });

  it("REGRESSION: app.ts passes the composed corpusService to each of the nine services, in both composition roots", () => {
    const appSource = readFileSync(join(SRC_ROOT, "app.ts"), "utf8");
    const wired: Array<[string, RegExp]> = [
      ["VersionService", /new VersionService\(store, recordLockService, corpusService\)/g],
      ["MigrationService", /new MigrationService\(store, corpusService\)/g],
      ["OrdinalMigrationService", /new OrdinalMigrationService\(store, corpusService\)/g],
      ["TreeCheckService", /new TreeCheckService\(store, corpusService\)/g],
      ["PhaseService", /new PhaseService\(store, recordLockService, corpusService\)/g],
      ["RequirementService", /new RequirementService\(store, requirementQuantifiableEnabled, corpusService\)/g],
      ["RuleService", /new RuleService\(store, corpusService\.create\.bind\(corpusService\), corpusService\)/g],
      ["ValidityService", /\}, corpusService\),/g],
    ];
    for (const [name, pattern] of wired) {
      expect(appSource.match(pattern)?.length ?? 0, `${name} must be composed over corpusService in both createApp roots`).toBe(2);
    }
    const phaseWiring = readFileSync(join(SRC_ROOT, "adapters", "cli", "phase-wiring.ts"), "utf8");
    expect(phaseWiring).toContain("new PhaseMigrationService(store, corpusService)");
  });
});

// ─── static scan ────────────────────────────────────────────────────────────

const SRC_ROOT = join(fileURLToPath(new URL("../../", import.meta.url)), "src");

/** Every store method that writes a document, a version row or an audit row (or a registry-owned write of one). */
const WRITE_PRIMITIVES = [
  "update",
  "insertVersion",
  "appendAuditEntry",
  "updateWithProvenance",
  "insertWithProvenance",
  "softDeleteWithProvenance",
  "addLinkWithProvenance",
  "setDocParentWithProvenance",
  "insertWithAllocatedOrdinalAndProvenance",
  "moveRule",
  "allocateRuleAndUpdateLeaf",
  "reserveProposedRuleAndUpdateSpec",
];
const WRITE_CALL = new RegExp(`\\b[A-Za-z]*[sS]tore\\.(?:${WRITE_PRIMITIVES.join("|")})\\(`, "g");

/** The write-path module(s) the scan names: the one route, and the store itself. */
function isWritePathModule(rel: string): boolean {
  return rel === "service/corpus-service.ts" || rel.startsWith(`store${sep}`) || rel.startsWith("store/");
}

/**
 * Modules OUTSIDE AC-DCL-3's reported scope that still call a write primitive directly. Each is pinned at its CURRENT
 * call count, so the list can only shrink: a new bare write anywhere, or one more in a listed file, fails the scan.
 * The nine services D3 names (version, migration, ordinal-migration, phase-migration, validity, rule, phase,
 * tree-check, requirement) are deliberately NOT here and are asserted at zero below.
 */
const UNMIGRATED_WRITERS: Readonly<Record<string, { calls: number; why: string }>> = {
  "service/task-workflow-service.ts": { calls: 7, why: "task claim/evidence/release extra writes — not a D3-reported site" },
  "service/phase-workflow-service.ts": { calls: 6, why: "phase claim/evidence extra writes — not a D3-reported site" },
  "service/review-service.ts": { calls: 12, why: "approve/reject/reopen/judge writes — not a D3-reported site" },
  "service/outline-migration-service.ts": { calls: 5, why: "outline migration — not a D3-reported site" },
  "service/drift-check-service.ts": { calls: 3, why: "anchor RMW verbs — not a D3-reported site" },
  "service/phase-checklist-service.ts": { calls: 3, why: "phase checklist writes — not a D3-reported site" },
  "service/plan-exemption-service.ts": { calls: 3, why: "plan exemption writes — not a D3-reported site" },
  "service/rule-change-service.ts": { calls: 4, why: "spec rule-change set writes — not a D3-reported site" },
  "service/spec-parent-migration-service.ts": { calls: 2, why: "spec parent migration — not a D3-reported site" },
  "service/spec-kind-service.ts": { calls: 1, why: "spec_kind migration — not a D3-reported site" },
  "service/ac-service.ts": { calls: 1, why: "AC criteria write — not a D3-reported site" },
  "service/issue-close-on-archive.ts": { calls: 2, why: "audit-only rows of the archive issue-close step" },
  "service/judgment-service.ts": { calls: 1, why: "audit-only judge row; judgments never bump a version" },
  "service/state-binding-service.ts": { calls: 1, why: "audit-only state-binding row" },
  "service/foreign-corpus-write-guard.ts": { calls: 1, why: "audit-only record of a refusal/authorization — the guard itself" },
  "adapters/cli/commands/baseline-adopt.ts": { calls: 1, why: "audit-only adoption row" },
  "app.ts": { calls: 1, why: "audit sink port handed to the skip recorder" },
};

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Code lines only: comment-only lines (`//`, `*`, `/*`) are dropped, so a JSDoc that names a primitive never counts. */
function countWriteCalls(source: string): number {
  let count = 0;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    count += line.match(WRITE_CALL)?.length ?? 0;
  }
  return count;
}

describe("AC-DCL-3 static scan — no direct write primitive outside the write-path modules", () => {
  const offenders = new Map<string, number>();
  for (const file of walkTs(SRC_ROOT)) {
    const rel = relative(SRC_ROOT, file).split(sep).join("/");
    if (isWritePathModule(rel)) continue;
    const n = countWriteCalls(readFileSync(file, "utf8"));
    if (n > 0) offenders.set(rel, n);
  }

  it("the nine services AC-DCL-3 names contain no store.update( / insertVersion( / appendAuditEntry( / *WithProvenance( / moveRule( call", () => {
    for (const service of [
      "version",
      "migration",
      "ordinal-migration",
      "phase-migration",
      "validity",
      "rule",
      "phase",
      "tree-check",
      "requirement",
    ]) {
      expect(offenders.get(`service/${service}-service.ts`) ?? 0, `${service}-service.ts calls a store write primitive directly`).toBe(0);
    }
  });

  it("every other module is either clean or a pinned, named exception at exactly its recorded call count", () => {
    const unexpected = [...offenders].filter(([rel, n]) => UNMIGRATED_WRITERS[rel]?.calls !== n);
    expect(unexpected, `unlisted or changed direct store write call sites: ${JSON.stringify(unexpected)}`).toEqual([]);
  });

  it("the exception list carries no stale entry: every listed module still has its calls", () => {
    const stale = Object.keys(UNMIGRATED_WRITERS).filter((rel) => !offenders.has(rel));
    expect(stale, `exceptions whose module no longer calls a write primitive — delete them: ${stale.join(", ")}`).toEqual([]);
  });

  it("CONTROL: the scan does find the write route's own calls (so a zero elsewhere is not a mis-aimed pattern)", () => {
    const route = readFileSync(join(SRC_ROOT, "service", "corpus-service.ts"), "utf8");
    expect(countWriteCalls(route)).toBeGreaterThan(0);
    expect(isWritePathModule("service/corpus-service.ts")).toBe(true);
    expect(isWritePathModule("store/sqlite-store.ts")).toBe(true);
    expect(isWritePathModule("service/version-service.ts")).toBe(false);
  });
});
