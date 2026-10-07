/**
 * @spec_ref spec-baseline-slice-1-rules-with-permanent-ids-ac-citations (C2, QA-1, AC-BLS1-1)
 * @task task-skill-test-rule-registry-allocation-never-reissue-move-red ([B1], RED; paired impl B2)
 *
 * Rule registry: transactional allocation, never-reissue, move. Runs the SAME
 * suite against SQLiteStore (temp file), TursoStore (local libsql file mode —
 * the repo's existing harness, see turso-store.bun.test.ts) and InMemoryStore.
 * Runner: `bun test` (bun:sqlite) — never vitest.
 *
 * ── PINNED CONTRACT (B2 implements exactly this; mirrors spec §C2) ──────────
 *
 *   type RuleRegistryRow = {
 *     id: string;            // "BR-<n>"
 *     n: number;             // UNIQUE, strictly increasing, never reused
 *     leaf_doc_id: string;
 *     allocated_at: string;  // ISO
 *     allocated_by: string;
 *   };
 *
 *   StoreInterface.allocateRuleAndUpdateLeaf(
 *     leafId: DocId,
 *     expectedVersion: number,
 *     buildExtra: (ruleId: string) => Record<string, unknown>,  // new leaf `extra`, given the allocated id
 *     actor: string,                                            // -> registry.allocated_by + version.created_by
 *   ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>>;
 *     ONE transaction: n = COALESCE(MAX(n),0)+1 (computed INSIDE the tx),
 *     insert registry row, CAS-update leaf (extra = buildExtra(id), version =
 *     expectedVersion+1), insert the version row (action "update").
 *     CAS failure => STALE_VERSION and the whole tx rolls back (no registry row,
 *     id not burned). Contention that cannot be serialised => a loud error
 *     (STALE_VERSION | WRITE_CONTENTION | CONFLICT), never a duplicate id.
 *     Unknown / soft-deleted leaf => DOC_NOT_FOUND, no registry row.
 *
 *   StoreInterface.moveRule(
 *     ruleId: string,
 *     fromLeaf: { id: DocId; expectedVersion: number; extra: Record<string, unknown> }, // extra AFTER removal
 *     toLeaf:   { id: DocId; expectedVersion: number; extra: Record<string, unknown> }, // extra AFTER append
 *     actor: string,
 *   ): Promise<Result<{ from: DocRecord; to: DocRecord }, LoreError>>;
 *     ONE transaction: CAS-update both leaves (+ one version row each) and set
 *     registry.leaf_doc_id = toLeaf.id. Id and n unchanged. Any failure (either
 *     CAS, a version-row insert, unknown ruleId => DOC_NOT_FOUND) leaves BOTH
 *     leaves and the registry row exactly as before.
 *
 *   StoreInterface.listRuleRegistry(): Promise<Result<RuleRegistryRow[], LoreError>>;
 *     all rows ordered by n ASC (read side needed by `status --check-baseline`
 *     and by these tests; rows are never deleted — there is no delete method).
 *
 * ── FALSIFIER (declare after red; run by B2 / verifier) ─────────────────────
 *   Replacing the in-transaction MAX(n)+1 with a pre-read of MAX(n) done
 *   OUTSIDE the transaction must turn "two SQLiteStore instances on one file"
 *   (and the single-instance concurrency scenarios) red with duplicate ids /
 *   UNIQUE violations surfacing as wrong results.
 *
 * ── COVERAGE ────────────────────────────────────────────────────────────────
 *   SQLiteStore (file) incl. 2 instances on one file · TursoStore (file mode,
 *   single instance concurrency only — a 2-instance libsql file race is not
 *   covered) · InMemoryStore (single instance; no real PK so the version-row
 *   collision atomicity case is skipped for it).
 *
 * RED state: every test fails with "StoreInterface.<method> is not implemented"
 * (method missing), never an import/syntax error — calls are guarded via `call`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocRecord, VersionRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { TursoStore } from "../../../src/store/turso-store.js";

// ─── Contract shapes (local until B2 lands them on StoreInterface) ──────────

interface RuleRegistryRow {
  id: string;
  n: number;
  leaf_doc_id: string;
  allocated_at: string;
  allocated_by: string;
}
interface Res<T> {
  ok: boolean;
  value?: T;
  error?: { code: string };
}
type ExtraBuilder = (ruleId: string) => Record<string, unknown>;
interface LeafPatch {
  id: string;
  expectedVersion: number;
  extra: Record<string, unknown>;
}

const LOUD_CODES = ["STALE_VERSION", "WRITE_CONTENTION", "CONFLICT"];

/** Invoke a not-yet-existing store method; a missing method fails the test with a named message. */
async function call<T>(store: StoreInterface, method: string, ...args: unknown[]): Promise<Res<T>> {
  const fn = (store as unknown as Record<string, unknown>)[method];
  if (typeof fn !== "function") {
    throw new Error(`StoreInterface.${method} is not implemented (rule registry, spec C2)`);
  }
  return (await (fn as (...a: unknown[]) => Promise<Res<T>>).apply(store, args)) as Res<T>;
}

const allocate = (s: StoreInterface, leafId: string, ver: number, build: ExtraBuilder) =>
  call<{ ruleId: string; doc: DocRecord }>(s, "allocateRuleAndUpdateLeaf", leafId, ver, build, "agent:test");
const moveRule = (s: StoreInterface, ruleId: string, from: LeafPatch, to: LeafPatch) =>
  call<{ from: DocRecord; to: DocRecord }>(s, "moveRule", ruleId, from, to, "agent:test");
async function registry(s: StoreInterface): Promise<RuleRegistryRow[]> {
  const r = await call<RuleRegistryRow[]>(s, "listRuleRegistry");
  if (!r.ok || r.value === undefined) throw new Error(`listRuleRegistry failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

let counter = 0;
function rule(id: string, extraFields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    statement: `Statement for ${id}`,
    confidence: "established",
    enforced_by: "guaranteed",
    examples: ["example"],
    lifecycle: "live",
    ...extraFields,
  };
}
/** Builder that appends a fresh live rule to the leaf's existing rules. */
function appendRule(existing: Array<Record<string, unknown>> = []): ExtraBuilder {
  return (id) => ({ node: "leaf", rules: [...existing, rule(id)] });
}
function leafDoc(label: string, rules: Array<Record<string, unknown>> = []): DocRecord {
  counter += 1;
  const stamp = "2026-10-07T00:00:00.000Z";
  return {
    id: `01HRULEREG${String(counter).padStart(16, "0")}`,
    slug: `baseline-rule-registry-${label}-${counter}`,
    // Store-level fixture: today's `docs.type` CHECK(...) does not admit "baseline"
    // (measured: SQLITE_CONSTRAINT on insert). The registry contract is type-agnostic
    // (leaf `extra` is opaque to the store), so the fixture uses "spec".
    type: "spec",
    role: "spec",
    title: `Leaf ${label}`,
    status: "draft",
    priority: "medium",
    content: `leaf ${label}`,
    parent_id: null,
    extra: { node: "leaf", rules },
    tags: [],
    version: 1,
    created_at: stamp,
    updated_at: stamp,
    created_by: "agent:test",
    deleted_at: null,
    ordinal: null,
  } as DocRecord;
}
async function seed(store: StoreInterface, label: string, rules: Array<Record<string, unknown>> = []): Promise<DocRecord> {
  const doc = leafDoc(label, rules);
  const r = await store.insert(doc);
  if (!r.ok) throw new Error(`seed insert failed: ${JSON.stringify(r.error)}`);
  return doc;
}
async function rulesOf(store: StoreInterface, id: string): Promise<string[]> {
  const r = await store.find(id);
  if (!r.ok || r.value === null) throw new Error(`find ${id} failed`);
  const rules = (r.value.extra as { rules?: Array<{ id: string }> }).rules ?? [];
  return rules.map((x) => x.id);
}
async function versionOf(store: StoreInterface, id: string): Promise<number> {
  const r = await store.find(id);
  if (!r.ok || r.value === null) throw new Error(`find ${id} failed`);
  return r.value.version;
}

// ─── Suite ──────────────────────────────────────────────────────────────────

interface SuiteOpts {
  label: string;
  create: () => { store: StoreInterface; cleanup: () => void };
  /** Real `(doc_id, version)` PK on the versions table (not InMemoryStore). */
  realPk: boolean;
  /** Builds a SECOND store instance on the same backing file (SQLite only). */
  second?: () => { store: StoreInterface; cleanup: () => void };
}

function runSuite(o: SuiteOpts): void {
  describe(`rule registry — ${o.label}`, () => {
    let store: StoreInterface;
    let cleanup: () => void;
    beforeEach(() => {
      ({ store, cleanup } = o.create());
    });
    afterEach(() => cleanup());

    // HAPPY
    it("allocates BR-1 then BR-2: registry rows, leaf rules, version bump in one call each", async () => {
      const leaf = await seed(store, "a");
      const r1 = await allocate(store, leaf.id, 1, appendRule());
      expect(r1.ok).toBe(true);
      expect(r1.value?.ruleId).toBe("BR-1");
      expect(r1.value?.doc.version).toBe(2);
      const r2 = await allocate(store, leaf.id, 2, appendRule([rule("BR-1")]));
      expect(r2.value?.ruleId).toBe("BR-2");
      const rows = await registry(store);
      expect(rows.map((x) => [x.id, x.n, x.leaf_doc_id, x.allocated_by])).toEqual([
        ["BR-1", 1, leaf.id, "agent:test"],
        ["BR-2", 2, leaf.id, "agent:test"],
      ]);
      expect(await rulesOf(store, leaf.id)).toEqual(["BR-1", "BR-2"]);
      const versions = await store.findVersions(leaf.id);
      expect(versions.ok && versions.value.map((v: VersionRecord) => v.version)).toContain(3);
    });

    // QA-1 core: concurrency, one rule per leaf, 12 writers
    it("12 concurrent allocations on 12 leaves: 12 distinct ids BR-1..BR-12, 0 duplicates", async () => {
      const leaves = await Promise.all(Array.from({ length: 12 }, (_, i) => seed(store, `c${i}`)));
      const results = await Promise.all(leaves.map((l) => allocate(store, l.id, 1, appendRule())));
      const ids = results.map((r) => (r.ok ? r.value?.ruleId : `ERR:${r.error?.code}`));
      expect(new Set(ids).size).toBe(12);
      expect(results.every((r) => r.ok)).toBe(true);
      expect([...ids].sort()).toEqual(
        Array.from({ length: 12 }, (_, i) => `BR-${i + 1}`).sort(),
      );
      const rows = await registry(store);
      expect(rows.map((r) => r.n)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    });

    // Task scenario 1: 8 concurrent across 2 leaves, same expectedVersion => ids distinct or loud error
    it("8 concurrent allocations across 2 leaves: distinct ids or loud error, 0 duplicates, registry == successes", async () => {
      const a = await seed(store, "x");
      const b = await seed(store, "y");
      const targets = [a, b, a, b, a, b, a, b];
      const results = await Promise.all(targets.map((l) => allocate(store, l.id, 1, appendRule())));
      const okIds = results.filter((r) => r.ok).map((r) => r.value?.ruleId as string);
      expect(okIds.length).toBeGreaterThanOrEqual(1);
      expect(new Set(okIds).size).toBe(okIds.length);
      for (const r of results.filter((x) => !x.ok)) {
        expect(LOUD_CODES).toContain(r.error?.code as string);
      }
      const rows = await registry(store);
      expect(rows.map((r) => r.id).sort()).toEqual([...okIds].sort());
    });

    it("16 concurrent allocations on ONE leaf: exactly 1 wins (CAS), 15 loud errors, 1 registry row", async () => {
      const leaf = await seed(store, "one");
      const results = await Promise.all(
        Array.from({ length: 16 }, () => allocate(store, leaf.id, 1, appendRule())),
      );
      expect(results.filter((r) => r.ok).length).toBe(1);
      for (const r of results.filter((x) => !x.ok)) expect(LOUD_CODES).toContain(r.error?.code as string);
      expect(await registry(store)).toHaveLength(1);
      expect(await rulesOf(store, leaf.id)).toHaveLength(1);
    });

    // Task scenario 2: CAS failure leaves no registry row
    it("CAS failure (stale expectedVersion) returns STALE_VERSION and leaves NO registry row", async () => {
      const leaf = await seed(store, "cas");
      const r = await allocate(store, leaf.id, 99, appendRule());
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe("STALE_VERSION");
      expect(await registry(store)).toEqual([]);
      expect(await rulesOf(store, leaf.id)).toEqual([]);
      expect(await versionOf(store, leaf.id)).toBe(1);
    });

    it("a rolled-back allocation does not burn an id: the next success is still BR-1", async () => {
      const leaf = await seed(store, "noburn");
      await allocate(store, leaf.id, 99, appendRule());
      const ok = await allocate(store, leaf.id, 1, appendRule());
      expect(ok.value?.ruleId).toBe("BR-1");
    });

    it("unknown leaf: DOC_NOT_FOUND and no registry row", async () => {
      const r = await allocate(store, "01HNOSUCHLEAF000000000000", 1, appendRule());
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe("DOC_NOT_FOUND");
      expect(await registry(store)).toEqual([]);
    });

    // Task scenario 3: never reissue
    it("BR-3 retired, then leaf soft-deleted: next allocation is BR-4, never BR-3; rows persist", async () => {
      const a = await seed(store, "dead");
      const b = await seed(store, "alive");
      await allocate(store, a.id, 1, appendRule());
      await allocate(store, a.id, 2, appendRule([rule("BR-1")]));
      await allocate(store, a.id, 3, appendRule([rule("BR-1"), rule("BR-2")]));
      expect(await rulesOf(store, a.id)).toEqual(["BR-1", "BR-2", "BR-3"]);
      const retire = await store.update(
        a.id,
        {
          extra: {
            node: "leaf",
            rules: [
              rule("BR-1"),
              rule("BR-2"),
              rule("BR-3", { lifecycle: "retired", retired_note: "gone" }),
            ],
          },
        },
        { expected_version: 4 },
      );
      expect(retire.ok).toBe(true);
      expect((await store.softDelete(a.id)).ok).toBe(true);
      const next = await allocate(store, b.id, 1, appendRule());
      expect(next.value?.ruleId).toBe("BR-4");
      const rows = await registry(store);
      expect(rows.map((r) => r.id)).toEqual(["BR-1", "BR-2", "BR-3", "BR-4"]);
      expect(rows.find((r) => r.id === "BR-3")?.leaf_doc_id).toBe(a.id);
    });

    it("ids strictly increase across leaves and over time (n monotonic, no reuse)", async () => {
      const a = await seed(store, "m1");
      const b = await seed(store, "m2");
      const seq: number[] = [];
      let va = 1;
      let vb = 1;
      for (let i = 0; i < 3; i++) {
        const ra = await allocate(store, a.id, va, appendRule());
        const rb = await allocate(store, b.id, vb, appendRule());
        va += 1;
        vb += 1;
        seq.push(Number(ra.value?.ruleId.slice(3)), Number(rb.value?.ruleId.slice(3)));
      }
      expect(seq).toEqual([1, 2, 3, 4, 5, 6]);
    });

    // Task scenario 4: move
    describe("moveRule", () => {
      async function twoLeaves() {
        const a = await seed(store, "from");
        const b = await seed(store, "to");
        await allocate(store, a.id, 1, appendRule());
        await allocate(store, a.id, 2, appendRule([rule("BR-1")]));
        return { a, b }; // a now v3 holding BR-1, BR-2; b v1 empty
      }
      const patches = (a: DocRecord, b: DocRecord, bVer = 1): [LeafPatch, LeafPatch] => [
        { id: a.id, expectedVersion: 3, extra: { node: "leaf", rules: [rule("BR-1")] } },
        { id: b.id, expectedVersion: bVer, extra: { node: "leaf", rules: [rule("BR-2")] } },
      ];

      it("moves BR-2: only in the target extra, registry leaf_doc_id updated, id/n unchanged, both versions bumped", async () => {
        const { a, b } = await twoLeaves();
        const [from, to] = patches(a, b);
        const r = await moveRule(store, "BR-2", from, to);
        expect(r.ok).toBe(true);
        expect(await rulesOf(store, a.id)).toEqual(["BR-1"]);
        expect(await rulesOf(store, b.id)).toEqual(["BR-2"]);
        const row = (await registry(store)).find((x) => x.id === "BR-2");
        expect(row?.leaf_doc_id).toBe(b.id);
        expect(row?.n).toBe(2);
        expect(await versionOf(store, a.id)).toBe(4);
        expect(await versionOf(store, b.id)).toBe(2);
        // the next allocation is unaffected by the move
        const next = await allocate(store, b.id, 2, appendRule([rule("BR-2")]));
        expect(next.value?.ruleId).toBe("BR-3");
      });

      it("target CAS failure: BOTH leaves and the registry row are unchanged", async () => {
        const { a, b } = await twoLeaves();
        const [from, to] = patches(a, b, 42);
        const r = await moveRule(store, "BR-2", from, to);
        expect(r.ok).toBe(false);
        expect(r.error?.code).toBe("STALE_VERSION");
        expect(await rulesOf(store, a.id)).toEqual(["BR-1", "BR-2"]);
        expect(await rulesOf(store, b.id)).toEqual([]);
        expect(await versionOf(store, a.id)).toBe(3);
        expect(await versionOf(store, b.id)).toBe(1);
        expect((await registry(store)).find((x) => x.id === "BR-2")?.leaf_doc_id).toBe(a.id);
      });

      it("source CAS failure: nothing changes", async () => {
        const { a, b } = await twoLeaves();
        const [from, to] = patches(a, b);
        const r = await moveRule(store, "BR-2", { ...from, expectedVersion: 1 }, to);
        expect(r.ok).toBe(false);
        expect(r.error?.code).toBe("STALE_VERSION");
        expect(await rulesOf(store, b.id)).toEqual([]);
        expect((await registry(store)).find((x) => x.id === "BR-2")?.leaf_doc_id).toBe(a.id);
      });

      it("unknown rule id: DOC_NOT_FOUND, both leaves untouched", async () => {
        const { a, b } = await twoLeaves();
        const [from, to] = patches(a, b);
        const r = await moveRule(store, "BR-77", from, to);
        expect(r.ok).toBe(false);
        expect(r.error?.code).toBe("DOC_NOT_FOUND");
        expect(await versionOf(store, a.id)).toBe(3);
        expect(await versionOf(store, b.id)).toBe(1);
      });

      (o.realPk ? it : it.skip)(
        "forced mid-transaction failure (version-row PK collision on target): both leaves AND registry unchanged",
        async () => {
          const { a, b } = await twoLeaves();
          // Pre-plant the version row the move would write for b (v2) -> insert step fails after the CAS updates.
          const planted = await store.insertVersion({
            doc_id: b.id,
            version: 2,
            content: "planted",
            extra: {},
            status: "draft",
            title: "planted",
            action: "update",
            created_at: "2026-10-07T00:00:00.000Z",
            created_by: "agent:test",
            slug: b.slug,
          } as VersionRecord);
          expect(planted.ok).toBe(true);
          const [from, to] = patches(a, b);
          const r = await moveRule(store, "BR-2", from, to);
          expect(r.ok).toBe(false);
          expect(await rulesOf(store, a.id)).toEqual(["BR-1", "BR-2"]);
          expect(await rulesOf(store, b.id)).toEqual([]);
          expect(await versionOf(store, a.id)).toBe(3);
          expect(await versionOf(store, b.id)).toBe(1);
          expect((await registry(store)).find((x) => x.id === "BR-2")?.leaf_doc_id).toBe(a.id);
        },
      );
    });

    // Never deleted
    it("registry rows are never deleted: soft-deleting every leaf keeps every row", async () => {
      const a = await seed(store, "k1");
      const b = await seed(store, "k2");
      await allocate(store, a.id, 1, appendRule());
      await allocate(store, b.id, 1, appendRule());
      await store.softDelete(a.id);
      await store.softDelete(b.id);
      expect((await registry(store)).map((r) => r.id)).toEqual(["BR-1", "BR-2"]);
      expect((store as unknown as Record<string, unknown>).deleteRuleRegistryRow).toBeUndefined();
    });
  });

  if (o.second !== undefined) {
    const second = o.second;
    describe(`rule registry — ${o.label} — 2 store instances on one file`, () => {
      let s1: StoreInterface;
      let c1: () => void;
      let s2: StoreInterface;
      let c2: () => void;
      beforeEach(() => {
        ({ store: s1, cleanup: c1 } = o.create());
        ({ store: s2, cleanup: c2 } = second());
      });
      afterEach(() => {
        c2();
        c1();
      });

      it("12 concurrent allocations split across 2 instances (12 leaves): 0 duplicate ids, every call returns an id or a loud error", async () => {
        const leaves = await Promise.all(Array.from({ length: 12 }, (_, i) => seed(s1, `i${i}`)));
        const results = await Promise.all(
          leaves.map((l, i) => allocate(i % 2 === 0 ? s1 : s2, l.id, 1, appendRule())),
        );
        const okIds = results.filter((r) => r.ok).map((r) => r.value?.ruleId as string);
        expect(new Set(okIds).size).toBe(okIds.length);
        for (const r of results.filter((x) => !x.ok)) expect(LOUD_CODES).toContain(r.error?.code as string);
        // contention may legitimately surface as loud errors, but a clean serialiser gives all 12
        expect(okIds.length).toBeGreaterThanOrEqual(1);
        const rows = await registry(s2);
        expect(rows.map((r) => r.id).sort()).toEqual([...okIds].sort());
        expect(new Set(rows.map((r) => r.n)).size).toBe(rows.length);
      });

      it("same-leaf race across 2 instances: exactly 1 winner, no duplicate id, 1 registry row", async () => {
        const leaf = await seed(s1, "race");
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) => allocate(i % 2 === 0 ? s1 : s2, leaf.id, 1, appendRule())),
        );
        expect(results.filter((r) => r.ok).length).toBe(1);
        for (const r of results.filter((x) => !x.ok)) expect(LOUD_CODES).toContain(r.error?.code as string);
        expect(await registry(s1)).toHaveLength(1);
      });

      it("an id allocated through instance 1 is never reissued through instance 2", async () => {
        const a = await seed(s1, "p");
        const b = await seed(s1, "q");
        const r1 = await allocate(s1, a.id, 1, appendRule());
        const r2 = await allocate(s2, b.id, 1, appendRule());
        expect([r1.value?.ruleId, r2.value?.ruleId]).toEqual(["BR-1", "BR-2"]);
      });
    });
  }
}

// ─── Instantiations ─────────────────────────────────────────────────────────

function tmpDb(prefix: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, path: join(dir, "lore.db") };
}

runSuite({
  label: "InMemoryStore",
  realPk: false,
  create: () => ({ store: new InMemoryStore(), cleanup: () => undefined }),
});

{
  // One temp file per test via a shared holder: `second` opens the file `create` just made.
  let current: { dir: string; path: string } | undefined;
  runSuite({
    label: "SQLiteStore",
    realPk: true,
    create: () => {
      current = tmpDb("lore-rule-registry-sqlite-");
      const dir = current.dir;
      const store = new SQLiteStore(current.path);
      return {
        store,
        cleanup: () => {
          store.close();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
    second: () => {
      if (current === undefined) throw new Error("second() called before create()");
      const store = new SQLiteStore(current.path);
      return { store, cleanup: () => store.close() };
    },
  });
}

runSuite({
  label: "TursoStore (local file mode)",
  realPk: true,
  create: () => {
    const { dir, path } = tmpDb("lore-rule-registry-turso-");
    const store = new TursoStore({ localPath: path });
    return {
      store,
      cleanup: () => {
        store.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  },
});
