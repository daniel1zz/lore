// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-a-plan-s-known-defects-are-its-own-record-of-github-issues (AC-KD-4, BR-1421)
 *
 * Schema migration 038 over a fixture corpus: every plan -> task `known-defect` link becomes entries of the plan's
 * `extra.known_defects`, the links and the link type go, in one transaction; ONE unconvertible link leaves the corpus
 * byte-identical.
 *
 * Fixture: `mkdtemp` + `lore init`, whose db is replaced by one built in place by the real `SQLiteStore` stopped at
 * schema 37 (`schemaCeiling`) and seeded with docs and links. The CLI is spawned from source (never a compiled copy
 * that could be stale). Never touches the repo's own `.lore/`.
 *
 * Coverage dimensions:
 *   HAPPY       findings source (two entries), body-line source (one entry), soft-deleted target; links and type gone
 *   NEGATIVE    one unconvertible link: exit != 0, the error names that link, the db file is byte-identical
 *   ERROR       no issue ref, neither source, a link that does not start at a plan: each named
 *   BOUNDARY    an idempotent merge into a plan that already records one of the entries
 *   STATE       plan version bumped with a versions row and an audit row; the plan-state fingerprint is unchanged
 *   REGRESSION  afterwards `lore link <plan> <task> --type known-defect` is refused naming extra.known_defects
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version";
import { SQLiteStore } from "../../../src/store/sqlite-store";
import { checkKnownDefectConversion, planKnownDefectConversion, summarizeConversion } from "../../../src/store/migrations/migration-038";
import { planStateFingerprint } from "../../../src/service/milestone-review";

const PKG_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const CLI_ENTRY = join(PKG_ROOT, "src", "index.ts");
const TEST_TIMEOUT_MS = 120_000;
const FP = "e".repeat(64);

const sandboxes: string[] = [];
afterAll(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  readonly sandbox: string;
  readonly corpusDir: string;
  readonly dbPath: string;
}

function runLore(fixture: Fixture, args: string[]) {
  const proc = Bun.spawnSync(["bun", "run", CLI_ENTRY, ...args], {
    cwd: fixture.corpusDir,
    stdin: "ignore",
    timeout: 90_000,
    killSignal: "SIGKILL",
    env: { ...process.env, HOME: fixture.sandbox, CLAUDECODE: "1", EDITOR: "true" },
  });
  return { out: proc.stdout.toString() + proc.stderr.toString(), exitCode: proc.exitCode ?? -1 };
}

function insertDoc(db: Database, id: string, type: string, extra: unknown, content = "c", deletedAt: string | null = null): void {
  db.prepare(
    `INSERT INTO docs (id, slug, type, role, title, status, priority, content, parent_id, extra, tags, version,
       created_at, updated_at, created_by, deleted_at, fts_title, fts_content, fts_tags)
     VALUES (?, ?, ?, ?, ?, 'draft', 'medium', ?, NULL, ?, '[]', 1,
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'agent:t', ?, '', '', '')`,
  ).run(id, `${type}-${id.toLowerCase()}`, type, type === "plan" ? "plan" : "knowledge", id, content, JSON.stringify(extra), deletedAt);
}

function insertKnownDefectLink(db: Database, from: string, to: string): void {
  db.prepare(`INSERT INTO links (from_id, to_id, link_type, created_at, created_by) VALUES (?, ?, 'known-defect', '2026-01-02T00:00:00.000Z', 'agent:t')`).run(from, to);
}

const report = (number: number, repoId = 7) => ({ issue_report: { github: { repo: "o/r", number, repo_id: repoId } } });

/** A corpus at schema 37 holding a plan with known-defect links to a findings mirror, a body-line mirror and a soft-deleted mirror. */
function makeFixture(opts: { extraLinks?: (db: Database) => void; planExtra?: unknown } = {}): Fixture {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "lore-kd-migrate-")));
  sandboxes.push(sandbox);
  const corpusDir = join(sandbox, "corpus");
  mkdirSync(corpusDir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: corpusDir, stdio: "pipe" });
  const fixture: Fixture = { sandbox, corpusDir, dbPath: join(corpusDir, ".lore", "lore.db") };
  expect(runLore(fixture, ["init"]).exitCode).toBe(0);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${fixture.dbPath}${suffix}`, { force: true });
  const store = new SQLiteStore(fixture.dbPath, { schemaCeiling: 37 });
  const db = store.getDatabase();
  insertDoc(db, "PLAN1", "plan", opts.planExtra ?? {});
  insertDoc(db, "T1", "task", { ...report(50), milestone_findings: [{ dimension: "regression", fingerprint: "f1" }, { dimension: "security", fingerprint: "f2" }] });
  insertDoc(db, "T2", "task", report(340), `Root-cause fingerprint: ${FP}\nDimension: concurrency_safety\nCause: x\n`);
  insertDoc(db, "T3", "task", { ...report(51), milestone_findings: [{ dimension: "spec_conformance", fingerprint: "f3" }] }, "c", "2026-02-01T00:00:00.000Z");
  for (const to of ["T1", "T2", "T3"]) insertKnownDefectLink(db, "PLAN1", to);
  opts.extraLinks?.(db);
  store.close();
  return fixture;
}

function userVersion(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  } finally {
    db.close();
  }
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("AC-KD-4 migration 038 converts known-defect links into plan entries, atomically", () => {
  beforeAll(() => {
    expect(PKG_ROOT.length).toBeGreaterThan(0);
  });

  it("findings source, body-line source and a soft-deleted target all convert; links and the link type are gone", () => {
    const fixture = makeFixture();
    const before = new Database(fixture.dbPath, { readonly: true });
    const planBefore = before.query("SELECT id, title, content, version, extra FROM docs WHERE id = 'PLAN1'").get() as { id: string; title: string; content: string; version: number; extra: string };
    const tasks = before.query("SELECT id, version, extra FROM docs WHERE type = 'task'").all() as { id: string; version: number; extra: string }[];
    before.close();
    const fingerprintBefore = planStateFingerprint({ id: "PLAN1", title: planBefore.title, content: planBefore.content, extra: JSON.parse(planBefore.extra) }, tasks.map((t) => ({ ...t, extra: JSON.parse(t.extra) })), undefined);

    const migrated = runLore(fixture, ["migrate", "schema"]);
    expect(migrated.exitCode, migrated.out).toBe(0);
    expect(userVersion(fixture.dbPath)).toBe(LATEST_SCHEMA_VERSION);

    const db = new Database(fixture.dbPath);
    try {
      const plan = db.query("SELECT version, extra FROM docs WHERE id = 'PLAN1'").get() as { version: number; extra: string };
      const extra = JSON.parse(plan.extra) as { known_defects: { repo_id: number; number: number; dimension: string; fingerprint: string }[] };
      expect(extra.known_defects.map((e) => `${String(e.repo_id)}#${String(e.number)}/${e.dimension}`).sort()).toEqual([
        "7#340/concurrency_safety",
        "7#50/regression",
        "7#50/security",
        "7#51/spec_conformance",
      ]);
      expect(extra.known_defects.find((e) => e.number === 340)?.fingerprint).toBe(FP);
      expect(extra.known_defects.find((e) => e.dimension === "security")?.fingerprint).toBe("f2");
      expect(plan.version).toBe(2);
      // STATE: a version row and a hash-chained audit row exist for the plan write
      expect((db.query("SELECT COUNT(*) AS n FROM versions WHERE doc_id = 'PLAN1' AND version = 2").get() as { n: number }).n).toBe(1);
      expect((db.query("SELECT COUNT(*) AS n FROM audit WHERE action = 'migrate-schema-038' AND doc_id = 'PLAN1'").get() as { n: number }).n).toBe(1);
      // the plan's own review stays current: the fingerprint is the same after the conversion
      expect(planStateFingerprint({ id: "PLAN1", title: planBefore.title, content: planBefore.content, extra }, tasks.map((t) => ({ ...t, extra: JSON.parse(t.extra) })), undefined)).toBe(fingerprintBefore);
      // links gone, type gone
      expect((db.query("SELECT COUNT(*) AS n FROM links WHERE link_type = 'known-defect'").get() as { n: number }).n).toBe(0);
      expect(() => insertKnownDefectLink(db, "PLAN1", "T1")).toThrow(/CHECK/i);
    } finally {
      db.close();
    }
  }, TEST_TIMEOUT_MS);

  it("afterwards `lore link <plan> <task> --type known-defect` is refused naming extra.known_defects", () => {
    const fixture = makeFixture();
    expect(runLore(fixture, ["migrate", "schema"]).exitCode).toBe(0);
    const refused = runLore(fixture, ["link", "plan-plan1", "task-t1", "--type", "known-defect"]);
    expect(refused.exitCode, refused.out).toBe(4);
    expect(refused.out).toContain("extra.known_defects");
    const db = new Database(fixture.dbPath, { readonly: true });
    expect((db.query("SELECT COUNT(*) AS n FROM links WHERE link_type = 'known-defect'").get() as { n: number }).n).toBe(0);
    db.close();
  }, TEST_TIMEOUT_MS);

  it("one unconvertible link makes the migration fail naming it and leaves the corpus byte-identical", () => {
    const fixture = makeFixture({
      extraLinks: (db) => {
        insertDoc(db, "T4", "task", report(52), "no dimension lines here");
        insertKnownDefectLink(db, "PLAN1", "T4");
      },
    });
    const before = sha(fixture.dbPath);
    const migrated = runLore(fixture, ["migrate", "schema"]);
    expect(migrated.exitCode).not.toBe(0);
    expect(migrated.out).toContain("plan-plan1 -> task-t4");
    expect(migrated.out).toContain("cannot be converted");
    expect(sha(fixture.dbPath)).toBe(before);
    expect(userVersion(fixture.dbPath)).toBe(37);
    const db = new Database(fixture.dbPath, { readonly: true });
    try {
      expect((db.query("SELECT COUNT(*) AS n FROM links WHERE link_type = 'known-defect'").get() as { n: number }).n).toBe(4);
      expect(JSON.parse((db.query("SELECT extra FROM docs WHERE id = 'PLAN1'").get() as { extra: string }).extra)).toEqual({});
    } finally {
      db.close();
    }
  }, TEST_TIMEOUT_MS);

  it("the check-only entry reports the per-link source and writes nothing", () => {
    const fixture = makeFixture({
      extraLinks: (db) => {
        insertDoc(db, "T4", "task", report(52), "nothing");
        insertKnownDefectLink(db, "PLAN1", "T4");
      },
    });
    const before = sha(fixture.dbPath);
    const db = new Database(fixture.dbPath, { readonly: true });
    const plan = checkKnownDefectConversion(db);
    db.close();
    const text = summarizeConversion(plan);
    expect(text.split("\n")[0]).toBe("3 convertible, 1 unconvertible");
    expect(text).toContain("from milestone_findings");
    expect(text).toContain("from issue body lines");
    expect(text).toContain("FAIL plan-plan1 -> task-t4");
    expect(sha(fixture.dbPath)).toBe(before);
  }, TEST_TIMEOUT_MS);

  it("each unconvertible shape is named with its reason: no issue ref, neither source, a link not starting at a plan, a missing target", () => {
    const row = (over: Record<string, unknown>) => ({ from_id: "P", to_id: "T", from_slug: "plan-p", from_type: "plan", to_slug: "task-t", to_extra: "{}", to_content: "", ...over });
    const plan = planKnownDefectConversion([
      row({ to_extra: JSON.stringify({ milestone_findings: [{ dimension: "security", fingerprint: "f" }] }) }), // no ref
      row({ to_slug: "task-u", to_extra: JSON.stringify(report(1)) }), // neither source
      row({ from_type: "task", from_slug: "task-x", to_slug: "task-v", to_extra: JSON.stringify(report(2)), to_content: `Dimension: security\nRoot-cause fingerprint: ${FP}` }),
      row({ to_slug: null, to_extra: null, to_content: null }),
      row({ to_slug: "task-w", to_extra: JSON.stringify({ ...report(3), milestone_findings: [{ dimension: "vibes", fingerprint: "f" }] }) }),
    ]);
    expect(plan.conversions).toEqual([]);
    expect(plan.unconvertible.map((u) => u.link)).toEqual(["plan-p -> task-t", "plan-p -> task-u", "task-x -> task-v", "plan-p -> T", "plan-p -> task-w"]);
    expect(plan.unconvertible[0]?.reason).toContain("no issue ref");
    expect(plan.unconvertible[2]?.reason).toContain("not a plan");
    expect(plan.unconvertible[4]?.reason).toContain("milestone_findings");
  });

  it("a plan that already records one of the entries gets only the missing ones (idempotent by key)", () => {
    const fixture = makeFixture({ planExtra: { known_defects: [{ repo_id: 7, number: 50, dimension: "regression", fingerprint: "f1" }] } });
    expect(runLore(fixture, ["migrate", "schema"]).exitCode).toBe(0);
    const db = new Database(fixture.dbPath, { readonly: true });
    const extra = JSON.parse((db.query("SELECT extra FROM docs WHERE id = 'PLAN1'").get() as { extra: string }).extra) as { known_defects: unknown[] };
    db.close();
    expect(extra.known_defects).toHaveLength(4);
  }, TEST_TIMEOUT_MS);
});
