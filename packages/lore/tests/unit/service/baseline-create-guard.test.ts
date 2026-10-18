// @layer service-baseline-create-guard AC-BLS1-1
/**
 * @spec_ref spec-baseline-slice-1-rules-with-permanent-ids-ac-citations (C2/C3, AC-BLS1-1)
 * @task task-skill-implement-ruleservice-replace-guard-cli-rule ([C2], create-time guard)
 *
 * Rules enter a baseline leaf ONLY through `lore rule add` (registry allocation). A `create`
 * that arrives with a non-empty `extra.rules` would mint rule ids the registry never saw and
 * let a later allocation collide with them, so `CorpusService.create` refuses it. Same for a
 * `depends_on` naming ids that no registry row (and no leaf) carries.
 * Also pins the pure helper `findUnregisteredRuleIds(leaves, registry)` that C7's
 * `--check-baseline` calls.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach } from "vitest";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService, findUnregisteredRuleIds } from "../../../src/service/rule-service.js";
import { makeRuleService } from "../../helpers/make-rule-service.js";
import { actedStore } from "../../live-invocation.js";

let store: InMemoryStore;
let corpus: CorpusService;

beforeEach(() => {
  store = actedStore(new InMemoryStore());
  corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
});

async function mustCreate(input: CreateDocInput): Promise<DocRecord> {
  const r = await corpus.create(input);
  if (!r.ok) throw new Error(`fixture create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

async function makeBranch(): Promise<DocRecord> {
  const prd = await mustCreate({ type: "prd", title: "Product", content: "p" } as CreateDocInput);
  const root = await mustCreate({
    type: "baseline", title: "Root", content: "r", parent_id: prd.id, extra: { node: "root", label: "Root" },
  } as CreateDocInput);
  return mustCreate({
    type: "baseline", title: "Branch", content: "b", parent_id: root.id, extra: { node: "branch", label: "B" },
  } as CreateDocInput);
}

const aRule = {
  id: "BR-1", statement: "s", confidence: "established", enforced_by: "guaranteed",
  examples: ["e"], lifecycle: "live",
};

describe("CorpusService.create — baseline rules guard", () => {
  it("refuses a baseline leaf created with a non-empty extra.rules, naming `lore rule add`", async () => {
    const branch = await makeBranch();
    const res = await corpus.create({
      type: "baseline", title: "Leaf", content: "l", parent_id: branch.id,
      extra: { node: "leaf", label: "L", rules: [aRule] },
    } as CreateDocInput);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res.ok ? "" : res.error)).toContain("lore rule add");
  });

  it("creates no document when the guard refuses", async () => {
    const branch = await makeBranch();
    await corpus.create({
      type: "baseline", title: "Leaf", content: "l", parent_id: branch.id,
      extra: { node: "leaf", label: "L", rules: [aRule] },
    } as CreateDocInput);
    const leaves = await store.findMany({ type: "baseline" });
    expect(leaves.ok && leaves.value.filter((d) => d.extra["node"] === "leaf")).toHaveLength(0);
  });

  it("accepts a leaf created with an empty rules array", async () => {
    const branch = await makeBranch();
    const res = await corpus.create({
      type: "baseline", title: "Leaf", content: "l", parent_id: branch.id,
      extra: { node: "leaf", label: "L", rules: [] },
    } as CreateDocInput);
    expect(res.ok).toBe(true);
  });

  it("accepts a leaf created without a rules key", async () => {
    const branch = await makeBranch();
    const res = await corpus.create({
      type: "baseline", title: "Leaf", content: "l", parent_id: branch.id, extra: { node: "leaf", label: "L" },
    } as CreateDocInput);
    expect(res.ok).toBe(true);
  });

  it("refuses depends_on at create time naming an id absent from the registry and every leaf", async () => {
    const branch = await makeBranch();
    const res = await corpus.create({
      type: "baseline", title: "Leaf", content: "l", parent_id: branch.id,
      extra: { node: "leaf", label: "L", depends_on: ["BR-42"] },
    } as CreateDocInput);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res.ok ? "" : res.error)).toContain("lore baseline depends");
  });

  it("accepts depends_on at create time naming a rule allocated through RuleService", async () => {
    const branch = await makeBranch();
    const rules = makeRuleService(store);
    const leaf = await mustCreate({
      type: "baseline", title: "Leaf A", content: "l", parent_id: branch.id, extra: { node: "leaf", label: "A" },
    } as CreateDocInput);
    const added = await rules.addRule(leaf.id, {
      statement: "s", confidence: "established", enforced_by: "guaranteed", examples: ["e"],
    }, { by: "t" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const res = await corpus.create({
      type: "baseline", title: "Leaf B", content: "l", parent_id: branch.id,
      extra: { node: "leaf", label: "B", depends_on: [added.value.ruleId] },
    } as CreateDocInput);
    expect(res.ok).toBe(true);
  });

  it("control: other doc types are unaffected by the baseline guard", async () => {
    const res = await corpus.create({ type: "prd", title: "Other", content: "x" } as CreateDocInput);
    expect(res.ok).toBe(true);
  });
});

describe("findUnregisteredRuleIds", () => {
  const leaf = (id: string, ruleIds: string[]): DocRecord =>
    ({ id, slug: id, type: "baseline", extra: { node: "leaf", rules: ruleIds.map((r) => ({ ...aRule, id: r })) } }) as unknown as DocRecord;
  const row = (id: string) => ({ id, n: Number(id.slice(3)), leaf_doc_id: "x", allocated_at: "t", allocated_by: "a", lifecycle: "live" as const, version: 1 });

  it("reports every rule id carried by a leaf that has no registry row, with its leaf", () => {
    const found = findUnregisteredRuleIds([leaf("L1", ["BR-1", "BR-2"]), leaf("L2", ["BR-3"])], [row("BR-1")]);
    expect(found).toEqual([{ ruleId: "BR-2", leafId: "L1" }, { ruleId: "BR-3", leafId: "L2" }]);
  });

  it("returns [] when every carried id is registered", () => {
    expect(findUnregisteredRuleIds([leaf("L1", ["BR-1"])], [row("BR-1")])).toEqual([]);
  });

  it("ignores docs with no rules (branches, root)", () => {
    const branch = { id: "B", slug: "b", type: "baseline", extra: { node: "branch" } } as unknown as DocRecord;
    expect(findUnregisteredRuleIds([branch], [])).toEqual([]);
  });
});
