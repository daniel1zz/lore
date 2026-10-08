/**
 * RED tests for `lore rule show / find / impact` (baseline slice 2 C6, QA-8, AC-BLS2-6) —
 * task-skill-test-red-rule-show-find-impact-incl-depends-on-cycle.
 *
 * PINNED CONTRACT for the implementer (services over a StoreInterface, here InMemoryStore;
 * every method returns `Promise<Result<T, LoreError>>`):
 *
 *  1. NEW module `packages/lore/src/service/rule-read-service.ts` exporting
 *     `class RuleReadService { constructor(store: StoreInterface) }` with
 *       - `show(ruleId): Result<{ id, statement, leaf, confidence, state, citingCriteria: { spec, ac }[] }>`
 *           `leaf` = slug of the baseline leaf carrying the rule; `confidence` = the rule's confidence;
 *           `state` = COMPUTED lifecycle state ("live" | "deprecated" | "retired"), never stored text;
 *           `citingCriteria` = every (spec slug, AC id) whose `cites` contains the rule.
 *           Unknown rule id -> err (never ok with empty/placeholder fields).
 *       - `find({ spec } | { file } | { text }): Result<string[]>` — rule ids, ranked.
 *           { spec }: rules cited by any AC of that spec (slug);
 *           { file }: rules cited by ACs of specs whose `extra.code_anchors` contain that file;
 *           { text }: rules whose statement contains the text (case-insensitive).
 *  2. NEW module `packages/lore/src/service/impact-service.ts` exporting
 *     `class ImpactService { constructor(store: StoreInterface) }` with
 *       - `impact(ruleId): Result<{ citingCriteria: { spec, ac }[]; dependentLeaves: string[]; cycles: string[][] }>`
 *           dependentLeaves = leaf slugs transitively depending (leaf `extra.depends_on` rule ids)
 *           on the leaf that carries the rule; cycles = each leaf-slug cycle reachable from that
 *           leaf, reported once with all its members; traversal MUST terminate on cycles.
 *
 * The indexes behind this (ac_cites / rule_depends, migration-014) are NOT asserted here —
 * only service behaviour is.
 *
 * Dimensions: HAPPY (show/find/impact), NEGATIVE (unknown rule, no match), BOUNDARY (uncited rule),
 * STATE (different inputs -> different outputs), REGRESSION (3-leaf cycle terminates < 1 s).
 *
 * @spec_ref AC-BLS2-6
 */

import { describe, it, expect } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";

type Cite = { spec: string; ac: string };
type Res<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
interface ShowOut {
  id: string;
  statement: string;
  leaf: string;
  confidence: string;
  state: string;
  citingCriteria: Cite[];
}
interface ReadApi {
  show(ruleId: string): Promise<Res<ShowOut>>;
  find(q: { spec: string } | { file: string } | { text: string }): Promise<Res<string[]>>;
}
interface ImpactApi {
  impact(ruleId: string): Promise<Res<{ citingCriteria: Cite[]; dependentLeaves: string[]; cycles: string[][] }>>;
}

// Variable specifiers: the modules do not exist yet; the file must still load.
const READ_MODULE = "../../../src/service/rule-read-service.js";
const IMPACT_MODULE = "../../../src/service/impact-service.js";

async function load<T>(path: string, cls: string, store: InMemoryStore): Promise<T> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`MISSING BEHAVIOUR: module ${path} not found (${String(e)})`);
  }
  const Ctor = mod[cls] as (new (s: InMemoryStore) => T) | undefined;
  if (typeof Ctor !== "function") throw new Error(`MISSING BEHAVIOUR: ${path} does not export ${cls}`);
  return new Ctor(store);
}
const readSvc = (s: InMemoryStore) => load<ReadApi>(READ_MODULE, "RuleReadService", s);
const impactSvc = (s: InMemoryStore) => load<ImpactApi>(IMPACT_MODULE, "ImpactService", s);

// ─── Fixtures ────────────────────────────────────────────────────────────────

function rule(id: string, statement: string, confidence = "established", lifecycle = "live") {
  return { id, statement, confidence, enforced_by: "both", examples: ["example"], lifecycle };
}

async function insertDoc(store: InMemoryStore, over: Partial<DocRecord> & Pick<DocRecord, "type" | "slug">) {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc = {
    id,
    title: over.slug,
    status: "draft",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    role: DOC_TYPE_ROLE_MAP[over.type],
    ...over,
  } as DocRecord;
  const r = await store.insert(doc);
  if (!r.ok) throw new Error(`insert failed: ${JSON.stringify(r.error)}`);
}

const leaf = (store: InMemoryStore, slug: string, rules: ReturnType<typeof rule>[], dependsOn: string[] = []) =>
  insertDoc(store, {
    type: "baseline",
    slug,
    extra: { node: "leaf", rules, ...(dependsOn.length ? { depends_on: dependsOn } : {}) },
  });

const spec = (
  store: InMemoryStore,
  slug: string,
  acs: Array<{ id: string; cites: string[] }>,
  codeAnchors: string[] = [],
) =>
  insertDoc(store, {
    type: "spec",
    slug,
    extra: {
      acceptance_criteria: acs.map((a) => ({
        id: a.id,
        statement: `criterion ${a.id}`,
        verify: { mode: "script", oracle: "test", command: "bun test x" },
        cites: a.cites,
      })),
      ...(codeAnchors.length ? { code_anchors: codeAnchors } : {}),
    },
  });

const sorted = (c: Cite[]) => [...c].sort((a, b) => `${a.spec}/${a.ac}`.localeCompare(`${b.spec}/${b.ac}`));

async function world() {
  const store = new InMemoryStore();
  await leaf(store, "leaf-a", [
    rule("BR-x", "Orders must be idempotent", "established"),
    rule("BR-y", "Refunds require approval", "provisional"),
    rule("BR-old", "Legacy rounding applies", "established", "deprecated"),
  ]);
  await spec(store, "spec-one", [{ id: "AC-1", cites: ["BR-x"] }], []);
  await spec(store, "spec-two", [{ id: "AC-7", cites: ["BR-x", "BR-y"] }], ["src/refund/refund.ts"]);
  return store;
}

// ─── show ────────────────────────────────────────────────────────────────────

describe("rule show (AC-BLS2-6)", () => {
  it("prints statement, leaf, confidence, computed state and both citing criteria for BR-x", async () => {
    const r = await (await readSvc(await world())).show("BR-x");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBe("BR-x");
    expect(r.value.statement).toBe("Orders must be idempotent");
    expect(r.value.leaf).toBe("leaf-a");
    expect(r.value.confidence).toBe("established");
    expect(r.value.state).toBe("live");
    expect(sorted(r.value.citingCriteria)).toEqual([
      { spec: "spec-one", ac: "AC-1" },
      { spec: "spec-two", ac: "AC-7" },
    ]);
  });

  it("returns different content for a different rule (BR-y: provisional, one citation)", async () => {
    const r = await (await readSvc(await world())).show("BR-y");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.statement).toBe("Refunds require approval");
    expect(r.value.confidence).toBe("provisional");
    expect(r.value.citingCriteria).toEqual([{ spec: "spec-two", ac: "AC-7" }]);
  });

  it("computes state `deprecated` from the lifecycle, and an uncited rule has no citations", async () => {
    const r = await (await readSvc(await world())).show("BR-old");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe("deprecated");
    expect(r.value.citingCriteria).toEqual([]);
  });

  it("rejects an unknown rule id instead of returning an empty record", async () => {
    const r = await (await readSvc(await world())).show("BR-nope");
    expect(r.ok).toBe(false);
  });
});

// ─── find ────────────────────────────────────────────────────────────────────

describe("rule find (AC-BLS2-6)", () => {
  it("find({file}) returns the rule cited by a spec whose code anchor is that file", async () => {
    const r = await (await readSvc(await world())).find({ file: "src/refund/refund.ts" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain("BR-y");
  });

  it("find({file}) for an unanchored file returns no rules", async () => {
    const r = await (await readSvc(await world())).find({ file: "src/unrelated.ts" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it("find({spec}) returns exactly the rules that spec cites, differing per spec", async () => {
    const svc = await readSvc(await world());
    const one = await svc.find({ spec: "spec-one" });
    const two = await svc.find({ spec: "spec-two" });
    expect(one.ok && [...one.value].sort()).toEqual(["BR-x"]);
    expect(two.ok && [...two.value].sort()).toEqual(["BR-x", "BR-y"]);
  });

  it("find({text}) matches statements case-insensitively and excludes non-matches", async () => {
    const r = await (await readSvc(await world())).find({ text: "refunds REQUIRE" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(["BR-y"]);
  });

  it("find({text}) with no match returns an empty list", async () => {
    const r = await (await readSvc(await world())).find({ text: "zebra" });
    expect(r.ok && r.value).toEqual([]);
  });
});

// ─── impact ──────────────────────────────────────────────────────────────────

describe("rule impact (AC-BLS2-6)", () => {
  it("lists citing criteria and transitively dependent leaves for BR-x", async () => {
    const store = await world();
    await leaf(store, "leaf-b", [rule("BR-b", "B rule")], ["BR-x"]); // direct dependent
    await leaf(store, "leaf-c", [rule("BR-c", "C rule")], ["BR-b"]); // transitive dependent
    await leaf(store, "leaf-d", [rule("BR-d", "D rule")], []); // unrelated
    const r = await (await impactSvc(store)).impact("BR-x");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sorted(r.value.citingCriteria)).toEqual([
      { spec: "spec-one", ac: "AC-1" },
      { spec: "spec-two", ac: "AC-7" },
    ]);
    expect([...r.value.dependentLeaves].sort()).toEqual(["leaf-b", "leaf-c"]);
    expect(r.value.cycles).toEqual([]);
  });

  it("reports a 3-leaf depends_on cycle with its 3 members and terminates in < 1 s", async () => {
    const store = new InMemoryStore();
    await leaf(store, "leaf-1", [rule("BR-1", "one")], ["BR-3"]);
    await leaf(store, "leaf-2", [rule("BR-2", "two")], ["BR-1"]);
    await leaf(store, "leaf-3", [rule("BR-3", "three")], ["BR-2"]);
    const svc = await impactSvc(store);
    const t0 = Date.now();
    const r = await svc.impact("BR-1");
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.cycles).toHaveLength(1);
    expect([...(r.value.cycles[0] ?? [])].sort()).toEqual(["leaf-1", "leaf-2", "leaf-3"]);
  });

  it("rejects an unknown rule id", async () => {
    const r = await (await impactSvc(await world())).impact("BR-nope");
    expect(r.ok).toBe(false);
  });
});
