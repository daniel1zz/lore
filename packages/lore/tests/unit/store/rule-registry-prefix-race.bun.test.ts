/**
 * @spec_ref AC-BLS3-1
 * @task task-red-a-architecture-tree-and-as-ad-citation (RED; spec baseline-slice-3a, rule BR-979, owner decision D1)
 *
 * The real-SQLite half of AC-BLS3-1's "interleaved adds never collide, also under 8 concurrent adds":
 * business rules (BR-n), architecture standard rules (AS-n) and debt entries (AD-n) are allocated from
 * ONE never-reused registry. The in-memory half lives in
 * tests/unit/service/baseline-architecture-tree.test.ts (vitest); this file is the `bun test` half
 * because SQLiteStore needs `bun:sqlite`. Runner: `cd packages/lore && bun test tests/unit/store/rule-registry-prefix-race.bun.test.ts`.
 *
 * CONTRACT (same as the vitest file; see its header C1-C6):
 *   - `RuleService.addRule(nodeSlug, input)` derives the id prefix from the node it targets
 *     (leaf -> BR, standard -> AS, debt-registry -> AD); architecture nodes are created with
 *     `CorpusService.create({type:"baseline", extra:{tree:"architecture", node, label}})`.
 *   - Numbering may be global or per prefix; asserted only: every id unique, (prefix, n) unique, a family's
 *     numbers strictly increase in allocation order, and ids survive in `rule_registry` for good.
 *
 * REAL CONCURRENCY NOTE: bun:sqlite is synchronous, so `Promise.all` inside one process interleaves at
 * await points but never overlaps statements; the 2-instance case opens a second connection on the same
 * file (own prepared statements, own transaction state), the closest in-process analogue of two writers.
 * The cross-PROCESS race for the citation gate lives in cite-retire-race.bun.test.ts.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";

const WORKERS = 8;
const ROUNDS = 3;

async function must<T>(r: { ok: boolean; value?: T; error?: unknown }, what: string): Promise<T> {
  if (!r.ok) throw new Error(`fixture ${what} failed: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

async function node(cs: CorpusService, title: string, parent: DocRecord, extra: Record<string, unknown>): Promise<DocRecord> {
  return must(
    await cs.create({ type: "baseline", title, content: `${title} body`, parent_id: parent.id, extra: { label: title, ...extra } } as CreateDocInput),
    `node ${title}`,
  );
}

interface Targets {
  leaves: string[];
  standards: string[];
  debts: string[];
}

/** 8 round-robin targets: BR, AS, AD, BR, AS, AD, BR, AS (slugs). */
async function seed(store: SQLiteStore): Promise<Targets> {
  const cs = new CorpusService(store, new RecordLockService(store));
  const prd = await must(await cs.create({ type: "prd", title: "Race product", content: "root" } as CreateDocInput), "prd");
  const bizRoot = await node(cs, "Business root", prd, { node: "root" });
  const branch = await node(cs, "Race branch", bizRoot, { node: "branch" });
  const archRoot = await node(cs, "Architecture root", prd, { tree: "architecture", node: "root" });
  const section = await node(cs, "Standards section", archRoot, { tree: "architecture", node: "section" });
  const leaves: string[] = [];
  const standards: string[] = [];
  const debts: string[] = [];
  for (let i = 0; i < 3; i += 1) leaves.push((await node(cs, `Leaf ${i}`, branch, { node: "leaf" })).slug);
  for (let i = 0; i < 3; i += 1) standards.push((await node(cs, `Standard ${i}`, section, { tree: "architecture", node: "standard" })).slug);
  for (let i = 0; i < 2; i += 1) debts.push((await node(cs, `Debt registry ${i}`, section, { tree: "architecture", node: "debt-registry" })).slug);
  return { leaves, standards, debts };
}

const rule = (tag: string) => ({
  statement: `Behaviour ${tag} holds for every caller`,
  confidence: "established" as const,
  enforced_by: "guaranteed" as const,
  examples: [`example ${tag}`],
});

const numberOf = (id: string): number => Number(id.slice(id.indexOf("-") + 1));
const prefixOf = (id: string): string => id.slice(0, id.indexOf("-"));

describe("rule registry — BR / AS / AD from one registry on real SQLite (AC-BLS3-1)", () => {
  let dir: string;
  let dbPath: string;
  let s1: SQLiteStore;
  let s2: SQLiteStore;
  let targets: Targets;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "lore-prefix-race-"));
    dbPath = join(dir, "corpus.db");
    s1 = new SQLiteStore(dbPath);
    targets = await seed(s1);
    s2 = new SQLiteStore(dbPath);
  });
  afterEach(() => {
    s2.close();
    s1.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** One add per target, slugs ordered BR, AS, AD, BR, AS, AD, BR, AS. */
  function eight(): string[] {
    const { leaves, standards, debts } = targets;
    return [leaves[0], standards[0], debts[0], leaves[1], standards[1], debts[1], leaves[2], standards[2]] as string[];
  }

  async function registry(store: SQLiteStore): Promise<Array<{ id: string; n: number }>> {
    const rows = await store.listRuleRegistry();
    if (!rows.ok) throw new Error("listRuleRegistry failed");
    return rows.value.map((r) => ({ id: r.id, n: r.n }));
  }

  it("a single standard add returns an AS-n id and a single debt add an AD-n id (sequential baseline)", async () => {
    const rules = new RuleService(s1);
    const as = await must(await rules.addRule(targets.standards[0] as string, rule("a"), { by: "agent:t" }), "as");
    const ad = await must(await rules.addRule(targets.debts[0] as string, rule("d"), { by: "agent:t" }), "ad");
    expect([prefixOf((as as { ruleId: string }).ruleId), prefixOf((ad as { ruleId: string }).ruleId)]).toEqual(["AS", "AD"]);
  });

  it("8 concurrent adds on one connection: 8 successes, 8 distinct ids, each with the prefix of its node", async () => {
    const rules = new RuleService(s1);
    const results = await Promise.all(eight().map((slug, i) => rules.addRule(slug, rule(`c${i}`), { by: `agent:r${i}` })));
    const ids = results.map((r) => (r.ok ? r.value.ruleId : `ERR:${r.error.code}`));
    expect({ prefixes: ids.map(prefixOf), distinct: new Set(ids).size }).toEqual({
      prefixes: ["BR", "AS", "AD", "BR", "AS", "AD", "BR", "AS"],
      distinct: 8,
    });
  });

  it("8 concurrent adds: rule_registry holds exactly those 8 ids and no (prefix, n) pair twice", async () => {
    const rules = new RuleService(s1);
    const results = await Promise.all(eight().map((slug, i) => rules.addRule(slug, rule(`c${i}`), { by: `agent:r${i}` })));
    const ids = results.map((r) => (r.ok ? r.value.ruleId : `ERR:${r.error.code}`));
    const rows = await registry(s1);
    const pairs = rows.map((r) => `${prefixOf(r.id)}:${r.n}`);
    expect({ rows: rows.map((r) => r.id).sort(), distinctPairs: new Set(pairs).size }).toEqual({ rows: [...ids].sort(), distinctPairs: 8 });
  });

  it("8 concurrent adds split across TWO connections on one file: 0 duplicate ids, registry == successes", async () => {
    const a = new RuleService(s1);
    const b = new RuleService(s2);
    const results = await Promise.all(eight().map((slug, i) => (i % 2 === 0 ? a : b).addRule(slug, rule(`c${i}`), { by: `agent:r${i}` })));
    const okIds = results.filter((r) => r.ok).map((r) => (r.ok ? r.value.ruleId : ""));
    const rows = await registry(s2);
    expect({ ok: okIds.length, distinct: new Set(okIds).size, registry: rows.map((r) => r.id).sort() }).toEqual({
      ok: 8, distinct: 8, registry: [...okIds].sort(),
    });
  });

  it("3 rounds x 8 concurrent adds: 24 distinct ids, and each family's numbers strictly increase round over round", async () => {
    const rules = new RuleService(s1);
    const all: string[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const results = await Promise.all(eight().map((slug, i) => rules.addRule(slug, rule(`r${round}-${i}`), { by: `agent:r${i}` })));
      for (const r of results) all.push(r.ok ? r.value.ruleId : `ERR:${r.error.code}`);
    }
    const byFamily = new Map<string, number[]>();
    for (const id of all) byFamily.set(prefixOf(id), [...(byFamily.get(prefixOf(id)) ?? []), numberOf(id)]);
    const perRoundSorted = [...byFamily.values()].every((ns) => new Set(ns).size === ns.length);
    expect({ total: all.length, distinct: new Set(all).size, familyNumbersUnique: perRoundSorted, families: [...byFamily.keys()].sort() }).toEqual({
      total: WORKERS * ROUNDS, distinct: WORKERS * ROUNDS, familyNumbersUnique: true, families: ["AD", "AS", "BR"],
    });
  });

  it("a retired AS id is never reissued: the next concurrent wave gets only fresh ids, the row stays", async () => {
    const rules = new RuleService(s1);
    const first = (await must(await rules.addRule(targets.standards[0] as string, rule("first"), { by: "agent:t" }), "first") as { ruleId: string }).ruleId;
    await must(await rules.setRule(first, { lifecycle: "retired", note: "retired by the race test" }, { by: "agent:t" }), "retire");
    const results = await Promise.all(eight().map((slug, i) => rules.addRule(slug, rule(`w${i}`), { by: `agent:r${i}` })));
    const ids = results.map((r) => (r.ok ? r.value.ruleId : `ERR:${r.error.code}`));
    const rows = await registry(s1);
    expect({ reused: ids.includes(first), kept: rows.some((r) => r.id === first), total: rows.length }).toEqual({
      reused: false, kept: true, total: 9,
    });
  });

  it("the ids survive a reopen of the file: a fresh connection keeps issuing larger numbers per family", async () => {
    const rules = new RuleService(s1);
    const before = (await must(await rules.addRule(targets.standards[0] as string, rule("one"), { by: "agent:t" }), "one") as { ruleId: string }).ruleId;
    s2.close();
    const reopened = new SQLiteStore(dbPath);
    try {
      const after = await must(await new RuleService(reopened).addRule(targets.standards[1] as string, rule("two"), { by: "agent:t" }), "two");
      expect(numberOf((after as { ruleId: string }).ruleId) > numberOf(before)).toBe(true);
    } finally {
      reopened.close();
      s2 = new SQLiteStore(dbPath); // keep afterEach's close() valid
    }
  });
});

describe("rule registry — business-only control on real SQLite (green on main)", () => {
  it("8 concurrent BR adds on 8 leaves still yield BR-1..BR-8, all distinct (the existing path is unchanged)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-prefix-control-"));
    const store = new SQLiteStore(join(dir, "corpus.db"));
    try {
      const cs = new CorpusService(store, new RecordLockService(store));
      const prd = await must(await cs.create({ type: "prd", title: "Control product", content: "root" } as CreateDocInput), "prd");
      const root = await node(cs, "Business root", prd, { node: "root" });
      const branch = await node(cs, "Control branch", root, { node: "branch" });
      const slugs: string[] = [];
      for (let i = 0; i < WORKERS; i += 1) slugs.push((await node(cs, `Control leaf ${i}`, branch, { node: "leaf" })).slug);
      const rules = new RuleService(store);
      const results = await Promise.all(slugs.map((slug, i) => rules.addRule(slug, rule(`k${i}`), { by: `agent:r${i}` })));
      const ids = results.map((r) => (r.ok ? r.value.ruleId : `ERR:${r.error.code}`));
      expect([...ids].sort((a, b) => numberOf(a) - numberOf(b))).toEqual(Array.from({ length: WORKERS }, (_, i) => `BR-${i + 1}`));
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
