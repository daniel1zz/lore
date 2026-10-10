/**
 * @spec_ref AC-P0C-2, AC-P0C-3
 * @task task-test-br-613-and-br-623-baseline-node-and-rule-field-bounds
 *
 * BR-613: a baseline node has a known tree, a kind that belongs to that tree, and a non-blank label;
 * otherwise it is refused and nothing is created.
 * BR-623: a rule's statement is 1..500 chars, examples 1..3 each <= 300 chars, confidence and
 * enforcement come from their value sets; a refused rule leaves the node unchanged and burns no id.
 * Driven through RuleService / CorpusService (the real write paths) on an InMemoryStore.
 */

import { describe, it, expect } from "vitest";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";

async function must<T>(r: { ok: boolean; value?: T; error?: unknown }, what: string): Promise<T> {
  if (!r.ok) throw new Error(`fixture ${what} failed: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

interface World {
  store: InMemoryStore;
  cs: CorpusService;
  rules: RuleService;
  prd: DocRecord;
  root: DocRecord;
  branch: DocRecord;
  leaf: DocRecord;
}

async function world(): Promise<World> {
  const store = new InMemoryStore();
  const cs = new CorpusService(store);
  const rules = new RuleService(store);
  const prd = await must(await cs.create({ type: "prd", title: "Product", content: "p" } as CreateDocInput), "prd");
  const mk = async (title: string, parent: DocRecord, node: string): Promise<DocRecord> =>
    must(await cs.create({ type: "baseline", title, content: `${title} body`, parent_id: parent.id, extra: { label: title, node } } as CreateDocInput), title);
  const root = await mk("Root", prd, "root");
  const branch = await mk("Branch", root, "branch");
  const leaf = await mk("Leaf", branch, "leaf");
  return { store, cs, rules, prd, root, branch, leaf };
}

async function baselineCount(store: InMemoryStore): Promise<number> {
  const r = await store.findMany({ type: "baseline" });
  if (!r.ok) throw new Error("list failed");
  return r.value.length;
}

async function registryIds(store: InMemoryStore): Promise<string[]> {
  const r = await store.listRuleRegistry();
  if (!r.ok) throw new Error("listRuleRegistry failed");
  return r.value.map((row) => row.id);
}

const goodRule = {
  statement: "Behaviour holds for every caller",
  confidence: "established" as const,
  enforced_by: "guaranteed" as const,
  examples: ["an example"],
};

describe("BR-613 node label, tree and kind", () => {
  const nodeInput = (label: string) => ({ node: "branch" as const, label, title: "T", content: "c" });

  it.each([["empty", ""], ["spaces", "   "], ["tab and newline", "\t\n "]])(
    "RuleService.addNode refuses a %s label and creates nothing",
    async (_name, label) => {
      const w = await world();
      const before = await baselineCount(w.store);
      const res = await w.rules.addNode(w.root.id, nodeInput(label), { by: "t" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("VALIDATION_ERROR");
      expect(await baselineCount(w.store)).toBe(before);
    },
  );

  it("RuleService.addNode accepts a real label (control)", async () => {
    const w = await world();
    const res = await w.rules.addNode(w.root.id, nodeInput("Real label"), { by: "t" });
    expect(res.ok).toBe(true);
  });

  it.each([["empty", ""], ["spaces", "   "], ["tab and newline", "\t\n "]])(
    "CorpusService.create refuses a baseline with a %s label and creates nothing",
    async (_name, label) => {
      const w = await world();
      const before = await baselineCount(w.store);
      const res = await w.cs.create({
        type: "baseline", title: "Blank", content: "c", parent_id: w.root.id, extra: { node: "branch", label },
      } as CreateDocInput);
      expect(res.ok).toBe(false);
      expect(await baselineCount(w.store)).toBe(before);
    },
  );

  it("an unknown node kind is refused and creates nothing", async () => {
    const w = await world();
    const before = await baselineCount(w.store);
    const res = await w.rules.addNode(w.root.id, { node: "folder" as never, label: "L", title: "T", content: "c" }, { by: "t" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_ERROR");
    expect(await baselineCount(w.store)).toBe(before);
  });

  it("RuleService.addNode refuses an unknown tree and creates nothing", async () => {
    const w = await world();
    const before = await baselineCount(w.store);
    const res = await w.rules.addNode(w.root.id, { node: "branch", label: "L", title: "T", content: "c", tree: "marketing" as never }, { by: "t" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_ERROR");
    expect(await baselineCount(w.store)).toBe(before);
  });

  it("an unknown tree on CorpusService.create is refused and creates nothing", async () => {
    const w = await world();
    const before = await baselineCount(w.store);
    const res = await w.cs.create({
      type: "baseline", title: "Odd", content: "c", parent_id: w.root.id, extra: { tree: "marketing", node: "branch", label: "L" },
    } as CreateDocInput);
    expect(res.ok).toBe(false);
    expect(await baselineCount(w.store)).toBe(before);
  });

  it.each(["section", "module-card", "standard", "debt-registry"] as const)(
    "an architecture kind '%s' under the business tree is refused and creates nothing",
    async (kind) => {
      const w = await world();
      const before = await baselineCount(w.store);
      const res = await w.rules.addNode(w.branch.id, { node: kind, label: "L", title: "T", content: "c" }, { by: "t" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("VALIDATION_ERROR");
      expect(await baselineCount(w.store)).toBe(before);
    },
  );

  it("a business kind under the architecture tree is refused and creates nothing", async () => {
    const w = await world();
    const before = await baselineCount(w.store);
    const res = await w.rules.addNode(w.prd.id, { node: "leaf", label: "L", title: "T", content: "c", tree: "architecture" }, { by: "t" });
    expect(res.ok).toBe(false);
    expect(await baselineCount(w.store)).toBe(before);
  });
});

describe("BR-623 rule field bounds", () => {
  it("a 500-char statement is accepted and a 501-char statement is refused", async () => {
    const w = await world();
    const ok500 = await w.rules.addRule(w.leaf.id, { ...goodRule, statement: "s".repeat(500) }, { by: "t" });
    expect(ok500.ok).toBe(true);
    const bad = await w.rules.addRule(w.leaf.id, { ...goodRule, statement: "s".repeat(501) }, { by: "t" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("VALIDATION_ERROR");
  });

  it("a 1-char statement is accepted and an empty statement is refused", async () => {
    const w = await world();
    expect((await w.rules.addRule(w.leaf.id, { ...goodRule, statement: "s" }, { by: "t" })).ok).toBe(true);
    expect((await w.rules.addRule(w.leaf.id, { ...goodRule, statement: "" }, { by: "t" })).ok).toBe(false);
  });

  it("a 300-char example is accepted and a 301-char example is refused", async () => {
    const w = await world();
    expect((await w.rules.addRule(w.leaf.id, { ...goodRule, examples: ["e".repeat(300)] }, { by: "t" })).ok).toBe(true);
    const bad = await w.rules.addRule(w.leaf.id, { ...goodRule, examples: ["e".repeat(301)] }, { by: "t" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("VALIDATION_ERROR");
  });

  it("a 301-char example among valid ones is refused", async () => {
    const w = await world();
    const bad = await w.rules.addRule(w.leaf.id, { ...goodRule, examples: ["ok", "e".repeat(301)] }, { by: "t" });
    expect(bad.ok).toBe(false);
  });

  it("three examples are accepted; zero and four are refused", async () => {
    const w = await world();
    expect((await w.rules.addRule(w.leaf.id, { ...goodRule, examples: ["a", "b", "c"] }, { by: "t" })).ok).toBe(true);
    expect((await w.rules.addRule(w.leaf.id, { ...goodRule, examples: [] }, { by: "t" })).ok).toBe(false);
    expect((await w.rules.addRule(w.leaf.id, { ...goodRule, examples: ["a", "b", "c", "d"] }, { by: "t" })).ok).toBe(false);
  });

  it("a confidence outside its value set is refused", async () => {
    const w = await world();
    const bad = await w.rules.addRule(w.leaf.id, { ...goodRule, confidence: "certain" as never }, { by: "t" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("VALIDATION_ERROR");
  });

  it.each(["established", "observed", "undecided", "unconfirmed"] as const)("confidence '%s' is accepted", async (confidence) => {
    const w = await world();
    expect((await w.rules.addRule(w.leaf.id, { ...goodRule, confidence }, { by: "t" })).ok).toBe(true);
  });

  it("an enforcement outside its value set is refused", async () => {
    const w = await world();
    const bad = await w.rules.addRule(w.leaf.id, { ...goodRule, enforced_by: "hopefully" as never }, { by: "t" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("VALIDATION_ERROR");
  });

  it.each(["guaranteed", "both", "prompt-only"] as const)("enforcement '%s' is accepted", async (enforced_by) => {
    const w = await world();
    expect((await w.rules.addRule(w.leaf.id, { ...goodRule, enforced_by }, { by: "t" })).ok).toBe(true);
  });

  it.each([
    ["statement 501", { statement: "s".repeat(501) }],
    ["example 301", { examples: ["e".repeat(301)] }],
    ["bad confidence", { confidence: "certain" as never }],
    ["bad enforcement", { enforced_by: "hopefully" as never }],
  ])("a refused rule (%s) burns no registry id and leaves the leaf unchanged", async (_name, patch) => {
    const w = await world();
    const first = await must(await w.rules.addRule(w.leaf.id, goodRule, { by: "t" }), "first rule");
    const idsBefore = await registryIds(w.store);
    const versionBefore = (await must(await w.cs.get(w.leaf.id), "get leaf")).doc.version;

    const bad = await w.rules.addRule(w.leaf.id, { ...goodRule, ...patch }, { by: "t" });
    expect(bad.ok).toBe(false);
    expect(await registryIds(w.store)).toEqual(idsBefore);
    expect((await must(await w.cs.get(w.leaf.id), "get leaf")).doc.version).toBe(versionBefore);

    // the next valid rule takes the very next number: the refusal consumed none
    const next = await must(await w.rules.addRule(w.leaf.id, goodRule, { by: "t" }), "next rule");
    const n = (id: string): number => Number(id.slice(id.indexOf("-") + 1));
    expect(n(next.ruleId)).toBe(n(first.ruleId) + 1);
  });
});
