// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-a-decision-carrying-write-records-its-decision-on-its
 * @ac_ref AC-DR-1
 *
 * `versions.decision` (migration-041): a write that passes a DecisionRecord stores it on the version row it creates,
 * in SQLite, Turso (local libsql file mode) and InMemory; older rows read none; running the migration twice changes
 * nothing; the audit entry joins the version by doc and version; `lore log <doc>` prints the decision under that version.
 *
 * Coverage: HAPPY (CorpusService.writeDoc and the four store-side writers carry the record) / NEGATIVE (a write with no
 * decision stores none; an older row reads none) / STATE (the migration runs twice with no row change; a v40 file
 * upgrades) / ERROR (a stored value that is not a DecisionRecord fails loud on read) / REGRESSION (audit join by
 * doc and version; `lore log` text and --json).
 */

import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOC_TYPE_ROLE_MAP, type DecisionRecord, type DocId, type DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { actedStore } from "../../live-invocation.js";

const DECISION: DecisionRecord = {
  reason: "the limit was 180000, not 60000",
  premises: [
    {
      claim: "registry.ts line 59 holds the limit",
      tier: "S",
      source: { kind: "file", path: "src/registry.ts", lines: [59, 59], sha: "abc1234", quote: "const LIMIT = 180000;" },
    },
    { claim: "an issue reports it", tier: "C", source: { kind: "issue", number: 473 } },
  ],
  alternatives: [{ option: "leave it", why_rejected: "the spec states the wrong number" }],
  gates: [{ id: "evidence-s-to-c", verdict: "pass", evidence: "all premises S..C", computed: true }],
  before: "old statement",
};

let counter = 0;
function doc(type: DocRecord["type"], label: string, extra: Record<string, unknown> = {}): DocRecord {
  counter += 1;
  const stamp = "2026-10-27T00:00:00.000Z";
  return {
    id: `01HDECISION${String(counter).padStart(15, "0")}` as DocId,
    slug: `${type}-decision-${label}-${counter}`,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: `${type} ${label}`,
    status: "draft",
    priority: "medium",
    content: label,
    parent_id: null,
    extra,
    tags: [],
    version: 1,
    created_at: stamp,
    updated_at: stamp,
    created_by: "agent:test",
    deleted_at: null,
    ordinal: null,
  } as DocRecord;
}

/** Seed `record` with its version-1 row (written with NO decision) and a create audit row. */
async function seed(store: StoreInterface, record: DocRecord): Promise<DocRecord> {
  const inserted = await store.insertWithProvenance(
    record,
    {
      doc_id: record.id,
      version: 1,
      content: record.content,
      extra: record.extra,
      status: record.status,
      title: record.title,
      action: "create",
      created_at: record.created_at,
      created_by: "agent:test",
      slug: record.slug,
    },
    { timestamp: record.created_at, actor: "agent:test", session_id: record.id, action: "create", doc_id: record.id, details: { version: 1 } },
  );
  if (!inserted.ok) throw new Error(`seed failed: ${JSON.stringify(inserted.error)}`);
  return inserted.value;
}

async function versionsOf(store: StoreInterface, id: DocId) {
  const found = await store.findVersions(id);
  if (!found.ok) throw new Error(JSON.stringify(found.error));
  return found.value;
}

async function reload(store: StoreInterface, id: DocId): Promise<DocRecord> {
  const found = await store.find(id);
  if (!found.ok || found.value === null) throw new Error(`doc ${id} missing`);
  return found.value;
}

const leafWith = (rules: string[]) => ({
  node: "leaf",
  rules: rules.map((id) => ({ id, statement: "s", confidence: "established", enforced_by: "both", examples: ["e"], lifecycle: "live" })),
});

interface StoreKind {
  readonly label: string;
  readonly create: () => { store: StoreInterface; cleanup: () => void };
}

const KINDS: readonly StoreKind[] = [
  { label: "InMemoryStore", create: () => ({ store: actedStore(new InMemoryStore()), cleanup: () => {} }) },
  {
    label: "SQLiteStore",
    create: () => {
      const dir = mkdtempSync(join(tmpdir(), "lore-decision-sqlite-"));
      const store = actedStore(new SQLiteStore(join(dir, "lore.db")));
      return { store, cleanup: () => { (store as SQLiteStore).close(); rmSync(dir, { recursive: true, force: true }); } };
    },
  },
  {
    label: "TursoStore",
    create: () => {
      const dir = mkdtempSync(join(tmpdir(), "lore-decision-turso-"));
      const store = actedStore(new TursoStore({ localPath: join(dir, "lore.db") }));
      return { store, cleanup: () => { (store as TursoStore).close(); rmSync(dir, { recursive: true, force: true }); } };
    },
  },
];

for (const kind of KINDS) {
  describe(`AC-DR-1 versions.decision — ${kind.label}`, () => {
    let store: StoreInterface;
    let cleanup: () => void;
    beforeEach(() => {
      ({ store, cleanup } = kind.create());
    });
    afterEach(() => cleanup());

    it("AC-DR-1 HAPPY: CorpusService.writeDoc stores the decision on the version it creates; older rows and decision-less writes read none", async () => {
      const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
      const spec = await seed(store, doc("spec", "writeDoc"));
      const withDecision = await service.writeDoc({
        doc: spec,
        patch: { content: "changed" },
        action: "update",
        auditAction: "update",
        lock: "none",
        decision: DECISION,
      });
      expect(withDecision.ok).toBe(true);
      const plain = await service.writeDoc({
        doc: await reload(store, spec.id),
        patch: { content: "changed again" },
        action: "update",
        auditAction: "update",
        lock: "none",
      });
      expect(plain.ok).toBe(true);

      const rows = await versionsOf(store, spec.id);
      const byVersion = new Map(rows.map((r) => [r.version, r]));
      expect(byVersion.get(1)?.decision ?? null).toBeNull();
      expect(byVersion.get(2)?.decision).toEqual(DECISION);
      expect(byVersion.get(3)?.decision ?? null).toBeNull();
      expect("decision" in (byVersion.get(1) ?? {})).toBe(false);
    });

    it("AC-DR-1 STATE: the audit entry joins the decision's version row by doc and version", async () => {
      const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
      const spec = await seed(store, doc("spec", "audit-join"));
      await service.writeDoc({ doc: spec, patch: { content: "x" }, action: "update", auditAction: "update", lock: "none", decision: DECISION });
      const audit = await store.queryAudit({ doc_id: spec.id });
      if (!audit.ok) throw new Error(JSON.stringify(audit.error));
      const versions = await versionsOf(store, spec.id);
      const joined = audit.value
        .filter((a) => a.action === "update")
        .map((a) => versions.find((v) => v.doc_id === a.doc_id && v.version === (a.details as { version: number }).version));
      expect(joined).toHaveLength(1);
      expect(joined[0]?.decision).toEqual(DECISION);
    });

    it("AC-DR-1 HAPPY: the four store-side version writers carry the decision (allocate, reserve, repoint, move)", async () => {
      const leafA = await seed(store, doc("baseline", "leafA", { node: "leaf", rules: [] }));
      const leafB = await seed(store, doc("baseline", "leafB", { node: "leaf", rules: [] }));
      const spec = await seed(store, doc("spec", "writers"));

      const allocated = await store.allocateRuleAndUpdateLeaf(leafA.id, 1, (id) => leafWith([id]), "agent:test", "BR", null, DECISION);
      expect(allocated.ok).toBe(true);
      expect((await versionsOf(store, leafA.id)).find((v) => v.version === 2)?.decision).toEqual(DECISION);

      const reserved = await store.reserveProposedRuleAndUpdateSpec(
        { specId: spec.id, expectedVersion: 1, buildExtra: () => ({ rule_changes: [] }), ownerLeafId: leafB.id, decision: DECISION },
        "agent:test",
      );
      expect(reserved.ok).toBe(true);
      if (!reserved.ok) return;
      expect((await versionsOf(store, spec.id)).find((v) => v.version === 2)?.decision).toEqual(DECISION);

      const other = { ...DECISION, reason: "repointed" };
      const repointed = await store.repointProposedRuleAndUpdateSpec(
        { specId: spec.id, expectedVersion: 2, extra: { rule_changes: [] }, ruleId: reserved.value.ruleId, toLeafId: leafA.id, decision: other },
        "agent:test",
      );
      expect(repointed.ok).toBe(true);
      expect((await versionsOf(store, spec.id)).find((v) => v.version === 3)?.decision).toEqual(other);

      const moved = await store.moveRule(
        "BR-1",
        { id: leafA.id, expectedVersion: 2, extra: leafWith([]), decision: DECISION },
        { id: leafB.id, expectedVersion: 1, extra: leafWith(["BR-1"]) },
        "agent:test",
      );
      expect(moved.ok).toBe(true);
      expect((await versionsOf(store, leafA.id)).find((v) => v.version === 3)?.decision).toEqual(DECISION);
      expect((await versionsOf(store, leafB.id)).find((v) => v.version === 2)?.decision ?? null).toBeNull();
    });
  });
}

describe("AC-DR-1 migration-041", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-decision-migration-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const userVersion = (db: Database): number => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  const hasDecisionColumn = (db: Database): boolean =>
    (db.query("PRAGMA table_info(versions)").all() as { name: string }[]).some((c) => c.name === "decision");

  /** A v40 file: a current-schema file with versions.decision dropped, user_version rewound, one decision-less row seeded. */
  async function seedV40(path: string): Promise<DocId> {
    const fresh = actedStore(new SQLiteStore(path, { migrate: true }));
    const seeded = await seed(fresh, doc("spec", "v40"));
    (fresh as SQLiteStore).close();
    const raw = new Database(path);
    raw.exec("ALTER TABLE versions DROP COLUMN decision");
    raw.exec("PRAGMA user_version = 40");
    raw.close();
    return seeded.id;
  }

  it("AC-DR-1 STATE: a v40 SQLite file upgrades, older rows read none, a second open changes nothing", async () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(41);
    const path = join(dir, "sqlite.db");
    const id = await seedV40(path);

    const first = actedStore(new SQLiteStore(path, { migrate: true }));
    const rowsAfterFirst = await versionsOf(first, id);
    (first as SQLiteStore).close();
    expect(rowsAfterFirst).toHaveLength(1);
    expect(rowsAfterFirst[0]?.decision ?? null).toBeNull();

    const raw = new Database(path);
    expect(hasDecisionColumn(raw)).toBe(true);
    expect(userVersion(raw)).toBe(LATEST_SCHEMA_VERSION);
    const snapshot = JSON.stringify(raw.query("SELECT * FROM versions ORDER BY doc_id, version").all());
    raw.close();

    const second = actedStore(new SQLiteStore(path, { migrate: true }));
    (second as SQLiteStore).close();
    const again = new Database(path);
    expect(userVersion(again)).toBe(LATEST_SCHEMA_VERSION);
    expect(JSON.stringify(again.query("SELECT * FROM versions ORDER BY doc_id, version").all())).toBe(snapshot);
    again.close();
  });

  it("AC-DR-1 STATE: a v40 file opened through TursoStore upgrades the same way and a second open changes nothing", async () => {
    const path = join(dir, "turso.db");
    const id = await seedV40(path);
    const first = actedStore(new TursoStore({ localPath: path, migrate: true }));
    const rows = await versionsOf(first, id);
    (first as TursoStore).close();
    expect(rows[0]?.decision ?? null).toBeNull();

    const raw = new Database(path);
    expect(hasDecisionColumn(raw)).toBe(true);
    expect(userVersion(raw)).toBe(LATEST_SCHEMA_VERSION);
    const snapshot = JSON.stringify(raw.query("SELECT * FROM versions ORDER BY doc_id, version").all());
    raw.close();

    const second = actedStore(new TursoStore({ localPath: path, migrate: true }));
    (second as TursoStore).close();
    const again = new Database(path);
    expect(JSON.stringify(again.query("SELECT * FROM versions ORDER BY doc_id, version").all())).toBe(snapshot);
    again.close();
  });

  it("AC-DR-1 ERROR: a stored decision that is not a DecisionRecord fails loud on read, never dropped", async () => {
    const path = join(dir, "corrupt.db");
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const seeded = await seed(store, doc("spec", "corrupt"));
    (store as SQLiteStore).close();
    const raw = new Database(path);
    raw.prepare("UPDATE versions SET decision = ? WHERE doc_id = ?").run(JSON.stringify({ reason: "" }), seeded.id);
    raw.close();
    const reopened = actedStore(new SQLiteStore(path));
    try {
      const found = await reopened.findVersions(seeded.id).then(
        (r) => r,
        (e: unknown) => e,
      );
      const failed = found instanceof Error || (typeof found === "object" && found !== null && "ok" in found && (found as { ok: boolean }).ok === false);
      expect(failed).toBe(true);
    } finally {
      (reopened as SQLiteStore).close();
    }
  });
});

describe("AC-DR-1 lore log prints the decision under its version", () => {
  const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
  const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
  const dir = mkdtempSync(join(tmpdir(), "lore-decision-log-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function runLore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
      cwd: dir,
      env: { ...process.env, HOME: dir, EDITOR: "true", CLAUDECODE: "1" },
      encoding: "utf8",
    });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
  }

  it("AC-DR-1 REGRESSION: text output names the decision at <doc>@<version>; --json carries the object; a decision-less version prints none", () => {
    const init = runLore(["init"]);
    if (init.exitCode !== 0) throw new Error(`init failed: ${init.stderr}${init.stdout}`);
    const created = runLore(["create", "spec", "--title", "Decision Log", "--no-ai", "--content", "## Goal\n\nBody.", "--json"]);
    if (created.exitCode !== 0) throw new Error(`create failed: ${created.stderr}${created.stdout}`);
    const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;

    const raw = new Database(join(dir, ".lore", "lore.db"));
    // reason: `lore init` seeds template documents, so "the latest version row" is no longer the spec's: pick it by slug.
    const row = raw.query("SELECT d.id AS doc_id FROM docs d WHERE d.slug = ?").get(slug) as { doc_id: string };
    raw.prepare("UPDATE versions SET decision = ? WHERE doc_id = ? AND version = 1").run(JSON.stringify(DECISION), row.doc_id);
    raw.close();

    const text = runLore(["log", slug]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain(`Decision at ${slug}@1:`);
    expect(text.stdout).toContain("reason: the limit was 180000, not 60000");
    expect(text.stdout).toContain("premise [S] registry.ts line 59 holds the limit (file:src/registry.ts:59-59@abc1234)");
    expect(text.stdout).toContain("alternative: leave it -- rejected: the spec states the wrong number");

    const json = runLore(["log", slug, "--json"]);
    expect(json.exitCode).toBe(0);
    const entries = (JSON.parse(json.stdout) as { data: { entries: { version: number; decision?: DecisionRecord }[] } }).data.entries;
    expect(entries.find((e) => e.version === 1)?.decision).toEqual(DECISION);

    const none = runLore(["create", "spec", "--title", "No Decision", "--no-ai", "--content", "## Goal\n\nBody.", "--json"]);
    const otherSlug = (JSON.parse(none.stdout) as { data: { slug: string } }).data.slug;
    expect(runLore(["log", otherSlug]).stdout).not.toContain("Decision at");
  });
});
