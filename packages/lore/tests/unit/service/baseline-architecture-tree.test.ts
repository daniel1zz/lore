/**
 * @spec_ref AC-BLS3-1
 * @task task-red-a-architecture-tree-and-as-ad-citation (RED; spec baseline-slice-3a, rule BR-979, owner decision D1)
 *
 * Architecture tree (BL-5): the `baseline` type gains `extra.tree: business | architecture`. An
 * architecture node is one of root / section / module-card / standard / debt-registry. Standard
 * rules get `AS-n`, debt entries `AD-n`, from the SAME never-reused registry as `BR-n`. Completeness
 * measurement and branch arming consider business nodes only.
 *
 * CONTRACT (choices the spec leaves open; the implementation builds to exactly these):
 *   C1. `baselineExtraSchema` (`@lore/core`) gains `tree?: "business" | "architecture"`. ABSENT tree means
 *       business (every existing doc stays valid). tree=architecture allows ONLY the node kinds
 *       root | section | module-card | standard | debt-registry; tree=business (or absent) allows ONLY
 *       root | branch | leaf. Anything else fails `safeParse`.
 *   C2. `rules` are allowed on a business `leaf`, on an architecture `standard` (ids `AS-n`) and on an
 *       architecture `debt-registry` (ids `AD-n`); nowhere else. A rule id's prefix must match its
 *       node: BR on leaf, AS on standard, AD on debt-registry.
 *   C3. Tree shape: architecture root hangs under a prd (like a business root); a section hangs under the
 *       architecture root; module-card, standard and debt-registry hang under a section. Fixtures here are
 *       created with `CorpusService.create({type:"baseline", extra:{tree, node, label}})`.
 *   C4. `RuleService.addRule(nodeIdOrSlug, input)` is the one rule-add verb for all three families; the
 *       prefix is derived from the target node (leaf -> BR, standard -> AS, debt-registry -> AD). Input
 *       shape is unchanged (`statement, confidence, enforced_by, examples`). addRule on root | section |
 *       module-card (architecture) is a VALIDATION_ERROR and burns no registry id.
 *   C5. `RuleService.addNode(parent, { node, label, title, content, tree? })` gains optional `tree`
 *       (default business). A kind that does not belong to the tree is a VALIDATION_ERROR, nothing created.
 *   C6. Numbering: the spec says "never collide" and "never reused", not whether n is global or per
 *       prefix. This file asserts only what holds under BOTH: every full id is unique, ids of one family
 *       strictly increase over time, and a retired id's n is never handed out again in its family.
 *   C7. `computeBaselineStatus` (BR-670): rules_total and rules_by_lifecycle count BR and AS rules (AD debt
 *       entries are reported apart as `debt_entries`); rules_uncovered stays business-only (BR-979); a
 *       citation of a live AS-n is not `cites_dangling`.
 *   C8. `indexBaseline(docs).branches` lists business branches only (an architecture section is never a
 *       branch); `branchOfRule` never maps an AS/AD rule (they hang under no business branch).
 *
 * Dimensions: HAPPY (five kinds accepted; AS/AD allocated), NEGATIVE (wrong kinds, wrong families),
 * BOUNDARY (absent tree == business; first and Nth id), ERROR (no id burned by a refused add),
 * STATE (retire then add never reuses), REGRESSION (business-only world measures the same with and
 * without an architecture tree; leaf/BR path unchanged). The real-SQLite 8-way race lives in
 * tests/unit/store/rule-registry-prefix-race.bun.test.ts.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { baselineExtraSchema } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { RuleStateService } from "../../../src/service/rule-state-service.js";
import { computeBaselineStatus } from "../../../src/service/baseline-status.js";
import { indexBaseline } from "../../../src/service/ac-cite-gate.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ARCH_KINDS = ["root", "section", "module-card", "standard", "debt-registry"] as const;
const AS_ID = /^AS-[1-9][0-9]*$/;
const AD_ID = /^AD-[1-9][0-9]*$/;
const BR_ID = /^BR-[1-9][0-9]*$/;

async function must<T>(r: { ok: boolean; value?: T; error?: unknown }, what: string): Promise<T> {
  if (!r.ok) throw new Error(`fixture ${what} failed: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

const ruleInput = (n: number | string) => ({
  statement: `Behaviour ${n} holds for every caller`,
  confidence: "established" as const,
  enforced_by: "guaranteed" as const,
  examples: [`example ${n}`],
});

interface World {
  store: InMemoryStore;
  cs: CorpusService;
  rules: RuleService;
  prd: DocRecord;
  bizRoot: DocRecord;
  bizBranch: DocRecord;
  /** Business leaves (ids), at least 3. */
  leaves: DocRecord[];
  archRoot: DocRecord | undefined;
  section: DocRecord | undefined;
  moduleCard: DocRecord | undefined;
  /** Architecture standards (at least 3 when the architecture tree is built). */
  standards: DocRecord[];
  /** Architecture debt registries (at least 2 when built). */
  debts: DocRecord[];
}

async function baseline(cs: CorpusService, title: string, parent: DocRecord, extra: Record<string, unknown>): Promise<DocRecord> {
  return must(
    await cs.create({ type: "baseline", title, content: `${title} body`, parent_id: parent.id, extra: { label: title, ...extra } } as CreateDocInput),
    `baseline ${title}`,
  );
}

async function world(opts: { architecture: boolean } = { architecture: true }): Promise<World> {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, new RecordLockService(store));
  const rules = new RuleService(store);
  const prd = await must(await cs.create({ type: "prd", title: "Product", content: "p" } as CreateDocInput), "prd");
  const bizRoot = await baseline(cs, "Business root", prd, { node: "root" });
  const bizBranch = await baseline(cs, "Alpha branch", bizRoot, { node: "branch" });
  const leaves = [
    await baseline(cs, "Leaf one", bizBranch, { node: "leaf" }),
    await baseline(cs, "Leaf two", bizBranch, { node: "leaf" }),
    await baseline(cs, "Leaf three", bizBranch, { node: "leaf" }),
  ];
  if (!opts.architecture) {
    return { store, cs, rules, prd, bizRoot, bizBranch, leaves, archRoot: undefined, section: undefined, moduleCard: undefined, standards: [], debts: [] };
  }
  const archRoot = await baseline(cs, "Architecture root", prd, { tree: "architecture", node: "root" });
  const section = await baseline(cs, "Standards section", archRoot, { tree: "architecture", node: "section" });
  const moduleCard = await baseline(cs, "Core module card", section, { tree: "architecture", node: "module-card" });
  const standards = [
    await baseline(cs, "Standard one", section, { tree: "architecture", node: "standard" }),
    await baseline(cs, "Standard two", section, { tree: "architecture", node: "standard" }),
    await baseline(cs, "Standard three", section, { tree: "architecture", node: "standard" }),
  ];
  const debts = [
    await baseline(cs, "Debt registry one", section, { tree: "architecture", node: "debt-registry" }),
    await baseline(cs, "Debt registry two", section, { tree: "architecture", node: "debt-registry" }),
  ];
  return { store, cs, rules, prd, bizRoot, bizBranch, leaves, archRoot, section, moduleCard, standards, debts };
}

async function addRuleId(rules: RuleService, node: DocRecord, n: number | string): Promise<string> {
  const r = await must(await rules.addRule(node.slug, ruleInput(n), { by: "agent:test" }), `addRule ${node.slug}`);
  return (r as { ruleId: string }).ruleId;
}

const numberOf = (id: string): number => Number(id.slice(id.indexOf("-") + 1));

async function registryIds(store: InMemoryStore): Promise<string[]> {
  const rows = await store.listRuleRegistry();
  if (!rows.ok) throw new Error("listRuleRegistry failed");
  return rows.value.map((r) => r.id);
}

// ─── The spec's describe ─────────────────────────────────────────────────────

describe("architecture tree (BL-5)", () => {
  // ── C1: kinds on the schema ────────────────────────────────────────────────
  describe("node kinds (schema)", () => {
    for (const kind of ARCH_KINDS) {
      it(`accepts tree=architecture with node=${kind}`, () => {
        expect(baselineExtraSchema.safeParse({ tree: "architecture", node: kind }).success).toBe(true);
      });
    }

    it("refuses tree=architecture with node=branch", () => {
      expect(baselineExtraSchema.safeParse({ tree: "architecture", node: "branch" }).success).toBe(false);
    });

    it("refuses tree=architecture with node=leaf", () => {
      expect(baselineExtraSchema.safeParse({ tree: "architecture", node: "leaf" }).success).toBe(false);
    });

    it("refuses an unknown architecture kind", () => {
      expect(baselineExtraSchema.safeParse({ tree: "architecture", node: "chapter" }).success).toBe(false);
    });

    it("refuses an architecture kind under tree=business", () => {
      expect(baselineExtraSchema.safeParse({ tree: "business", node: "standard" }).success).toBe(false);
    });

    it("refuses an architecture kind when tree is absent (absent means business)", () => {
      expect(baselineExtraSchema.safeParse({ node: "module-card" }).success).toBe(false);
    });

    it("refuses an unknown tree value", () => {
      expect(baselineExtraSchema.safeParse({ tree: "infrastructure", node: "root" }).success).toBe(false);
    });

    it("keeps accepting tree=business and an absent tree for the three business kinds (regression)", () => {
      for (const node of ["root", "branch", "leaf"]) {
        expect(baselineExtraSchema.safeParse({ node }).success).toBe(true);
        expect(baselineExtraSchema.safeParse({ tree: "business", node }).success).toBe(true);
      }
    });

    it("carries the tree through a parse (not silently stripped)", () => {
      const parsed = baselineExtraSchema.safeParse({ tree: "architecture", node: "standard" });
      expect(parsed.success && (parsed.data as Record<string, unknown>)["tree"]).toBe("architecture");
    });
  });

  // ── C2: which rule families live on which node ─────────────────────────────
  describe("rule families (schema)", () => {
    const rule = (id: string) => ({
      id, statement: "s", confidence: "established", enforced_by: "both", examples: ["e"], lifecycle: "live",
    });

    it("accepts an AS-n rule on a standard", () => {
      expect(baselineExtraSchema.safeParse({ tree: "architecture", node: "standard", rules: [rule("AS-1")] }).success).toBe(true);
    });

    it("accepts an AD-n rule on a debt-registry", () => {
      expect(baselineExtraSchema.safeParse({ tree: "architecture", node: "debt-registry", rules: [rule("AD-1")] }).success).toBe(true);
    });

    it("refuses an AD-n rule on a standard (debt id on the wrong node)", () => {
      expect(baselineExtraSchema.safeParse({ tree: "architecture", node: "standard", rules: [rule("AD-1")] }).success).toBe(false);
    });

    it("refuses an AS-n rule on a debt-registry", () => {
      expect(baselineExtraSchema.safeParse({ tree: "architecture", node: "debt-registry", rules: [rule("AS-1")] }).success).toBe(false);
    });

    it("refuses a BR-n rule on a standard", () => {
      expect(baselineExtraSchema.safeParse({ tree: "architecture", node: "standard", rules: [rule("BR-1")] }).success).toBe(false);
    });

    it("refuses an AS-n rule on a business leaf", () => {
      expect(baselineExtraSchema.safeParse({ node: "leaf", rules: [rule("AS-1")] }).success).toBe(false);
    });

    it("refuses rules on a section, a module-card and an architecture root", () => {
      for (const node of ["section", "module-card", "root"]) {
        expect(baselineExtraSchema.safeParse({ tree: "architecture", node, rules: [rule("AS-1")] }).success).toBe(false);
      }
    });

    it("refuses a malformed standard id (leading zero)", () => {
      expect(baselineExtraSchema.safeParse({ tree: "architecture", node: "standard", rules: [rule("AS-01")] }).success).toBe(false);
    });
  });

  // ── C3/C5: creating nodes ──────────────────────────────────────────────────
  describe("creating architecture nodes", () => {
    it("CorpusService.create accepts the whole architecture shape: root, section, module-card, standard, debt-registry", async () => {
      const w = await world();
      const kinds = [w.archRoot, w.section, w.moduleCard, w.standards[0], w.debts[0]].map((d) => d?.extra["node"]);
      expect(kinds).toEqual(["root", "section", "module-card", "standard", "debt-registry"]);
    });

    it("the created architecture docs keep tree=architecture in extra", async () => {
      const w = await world();
      expect([w.archRoot, w.section, w.moduleCard, w.standards[0], w.debts[0]].map((d) => d?.extra["tree"])).toEqual(
        Array(5).fill("architecture"),
      );
    });

    it("CorpusService.create refuses node=branch under tree=architecture and creates nothing", async () => {
      const w = await world();
      const before = await w.store.findMany({ type: "baseline" });
      const res = await w.cs.create({
        type: "baseline", title: "Wrong kind", content: "x", parent_id: w.section?.id,
        extra: { tree: "architecture", node: "branch", label: "Wrong kind" },
      } as CreateDocInput);
      const after = await w.store.findMany({ type: "baseline" });
      expect({ ok: res.ok, created: (after.ok ? after.value.length : -1) - (before.ok ? before.value.length : -2) }).toEqual({
        ok: false, created: 0,
      });
    });

    it("CorpusService.create refuses node=leaf under tree=architecture", async () => {
      const w = await world();
      const res = await w.cs.create({
        type: "baseline", title: "Wrong leaf", content: "x", parent_id: w.section?.id,
        extra: { tree: "architecture", node: "leaf", label: "Wrong leaf" },
      } as CreateDocInput);
      expect(res.ok).toBe(false);
    });

    it("CorpusService.create refuses node=standard when the tree is business", async () => {
      const w = await world();
      const res = await w.cs.create({
        type: "baseline", title: "Wrong tree", content: "x", parent_id: w.bizBranch.id,
        extra: { tree: "business", node: "standard", label: "Wrong tree" },
      } as CreateDocInput);
      expect(res.ok).toBe(false);
    });

    it("RuleService.addNode with tree=architecture creates a section under the architecture root", async () => {
      const w = await world();
      const input = { tree: "architecture", node: "section", label: "ADR", title: "ADR section", content: "adr" };
      const res = await w.rules.addNode(w.archRoot?.slug ?? "", input as never, { by: "agent:test" });
      expect(res.ok && [res.value.extra["tree"], res.value.extra["node"]]).toEqual(["architecture", "section"]);
    });

    it("RuleService.addNode refuses node=leaf with tree=architecture (VALIDATION_ERROR) and creates nothing", async () => {
      const w = await world();
      const before = await w.store.findMany({ type: "baseline" });
      const input = { tree: "architecture", node: "leaf", label: "L", title: "Bad arch leaf", content: "x" };
      const res = await w.rules.addNode(w.section?.slug ?? "", input as never, { by: "agent:test" });
      const after = await w.store.findMany({ type: "baseline" });
      expect({ code: res.ok ? "ok" : res.error.code, created: (after.ok ? after.value.length : -1) - (before.ok ? before.value.length : -2) }).toEqual({
        code: "VALIDATION_ERROR", created: 0,
      });
    });

    it("RuleService.addNode without a tree still creates a business leaf (default is business)", async () => {
      const w = await world({ architecture: false });
      const res = await w.rules.addNode(w.bizBranch.slug, { node: "leaf", label: "L9", title: "Leaf nine", content: "x" }, { by: "agent:test" });
      expect(res.ok && res.value.extra["node"]).toBe("leaf");
    });
  });

  // ── AS-n / AD-n allocation, one registry ───────────────────────────────────
  describe("rule id allocation (one registry)", () => {
    it("adding a rule to a standard returns an AS-n id", async () => {
      const w = await world();
      expect(await addRuleId(w.rules, w.standards[0] as DocRecord, 1)).toMatch(AS_ID);
    });

    it("adding an entry to a debt registry returns an AD-n id", async () => {
      const w = await world();
      expect(await addRuleId(w.rules, w.debts[0] as DocRecord, 1)).toMatch(AD_ID);
    });

    it("adding a rule to a business leaf still returns a BR-n id (regression)", async () => {
      const w = await world({ architecture: false });
      expect(await addRuleId(w.rules, w.leaves[0] as DocRecord, 1)).toMatch(BR_ID);
    });

    it("a standard never receives a BR or AD id, a debt registry never an AS or BR id (families do not leak)", async () => {
      const w = await world();
      const as = await addRuleId(w.rules, w.standards[0] as DocRecord, 1);
      const ad = await addRuleId(w.rules, w.debts[0] as DocRecord, 2);
      expect([as.startsWith("AS-"), ad.startsWith("AD-")]).toEqual([true, true]);
    });

    it("the allocated AS rule lands on the standard, live, with the registry knowing it", async () => {
      const w = await world();
      const std = w.standards[0] as DocRecord;
      const id = await addRuleId(w.rules, std, 1);
      const doc = await w.store.find(std.id);
      const stored = doc.ok && doc.value !== null ? (doc.value.extra["rules"] as Array<{ id: string; lifecycle: string }>) : [];
      expect({ stored: stored.map((r) => [r.id, r.lifecycle]), registered: (await registryIds(w.store)).includes(id) }).toEqual({
        stored: [[id, "live"]],
        registered: true,
      });
    });

    it("interleaved BR / AS / AD adds (12 of them) never collide: 12 distinct ids, 12 registry rows", async () => {
      const w = await world();
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        ids.push(await addRuleId(w.rules, w.leaves[i % 3] as DocRecord, `b${i}`));
        ids.push(await addRuleId(w.rules, w.standards[i % 3] as DocRecord, `s${i}`));
        ids.push(await addRuleId(w.rules, w.debts[i % 2] as DocRecord, `d${i}`));
      }
      const registry = await registryIds(w.store);
      expect({ distinct: new Set(ids).size, registry: [...registry].sort() }).toEqual({ distinct: 12, registry: [...ids].sort() });
    });

    it("interleaved adds keep the prefix of the node they target, in order", async () => {
      const w = await world();
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push(await addRuleId(w.rules, w.debts[0] as DocRecord, `d${i}`));
        ids.push(await addRuleId(w.rules, w.leaves[0] as DocRecord, `b${i}`));
        ids.push(await addRuleId(w.rules, w.standards[0] as DocRecord, `s${i}`));
      }
      expect(ids.map((id) => id.slice(0, 2))).toEqual(["AD", "BR", "AS", "AD", "BR", "AS", "AD", "BR", "AS"]);
    });

    it("within one family the numbers strictly increase across nodes and over time", async () => {
      const w = await world();
      const a = numberOf(await addRuleId(w.rules, w.standards[0] as DocRecord, 1));
      await addRuleId(w.rules, w.debts[0] as DocRecord, 2);
      const b = numberOf(await addRuleId(w.rules, w.standards[1] as DocRecord, 3));
      const c = numberOf(await addRuleId(w.rules, w.standards[0] as DocRecord, 4));
      expect(a < b && b < c).toBe(true);
    });

    it("two standards on different nodes get different ids (different inputs, different outputs)", async () => {
      const w = await world();
      const a = await addRuleId(w.rules, w.standards[0] as DocRecord, 1);
      const b = await addRuleId(w.rules, w.standards[1] as DocRecord, 2);
      expect(a).not.toBe(b);
    });

    it("never reused: after an AS rule is retired the next AS add gets a new, larger number", async () => {
      const w = await world();
      const std = w.standards[0] as DocRecord;
      const first = await addRuleId(w.rules, std, 1);
      const retired = await w.rules.setRule(first, { lifecycle: "retired", note: "superseded in the test" }, { by: "agent:test" });
      const second = await addRuleId(w.rules, std, 2);
      expect({ retired: retired.ok, reused: second === first, larger: numberOf(second) > numberOf(first) }).toEqual({
        retired: true, reused: false, larger: true,
      });
    });

    it("never reused: after an AD entry is retired the next AD add gets a new, larger number", async () => {
      const w = await world();
      const debt = w.debts[0] as DocRecord;
      const first = await addRuleId(w.rules, debt, 1);
      await w.rules.setRule(first, { lifecycle: "retired", note: "fixed in the test" }, { by: "agent:test" });
      const second = await addRuleId(w.rules, debt, 2);
      expect({ reused: second === first, larger: numberOf(second) > numberOf(first) }).toEqual({ reused: false, larger: true });
    });

    it("never reused: a retired id stays in the registry as a row", async () => {
      const w = await world();
      const first = await addRuleId(w.rules, w.standards[0] as DocRecord, 1);
      await w.rules.setRule(first, { lifecycle: "retired", note: "gone" }, { by: "agent:test" });
      await addRuleId(w.rules, w.standards[0] as DocRecord, 2);
      expect(await registryIds(w.store)).toContain(first);
    });

    it("8 concurrent adds across 3 business leaves, 3 standards and 2 debt registries: 8 distinct ids, 8 registry rows", async () => {
      const w = await world();
      const targets = [...w.leaves, ...w.standards, ...w.debts];
      const results = await Promise.all(targets.map((t, i) => w.rules.addRule(t.slug, ruleInput(`race${i}`), { by: "agent:test" })));
      const ids = results.map((r) => (r.ok ? r.value.ruleId : `ERR:${r.error.code}`));
      expect({ ids: ids.filter((id) => id.startsWith("ERR")), distinct: new Set(ids).size, registry: (await registryIds(w.store)).length }).toEqual({
        ids: [], distinct: 8, registry: 8,
      });
    });

    it("8 concurrent adds: each id carries the prefix of the node it was added to", async () => {
      const w = await world();
      const targets = [...w.leaves, ...w.standards, ...w.debts];
      const results = await Promise.all(targets.map((t, i) => w.rules.addRule(t.slug, ruleInput(`race${i}`), { by: "agent:test" })));
      const prefixes = results.map((r) => (r.ok ? r.value.ruleId.slice(0, 2) : "ER"));
      expect(prefixes).toEqual(["BR", "BR", "BR", "AS", "AS", "AS", "AD", "AD"]);
    });
  });

  // ── refused adds burn nothing ──────────────────────────────────────────────
  describe("refused adds (ERROR)", () => {
    for (const which of ["archRoot", "section", "moduleCard"] as const) {
      it(`addRule on an architecture ${which} is a VALIDATION_ERROR and burns no registry id`, async () => {
        const w = await world();
        const target = w[which] as DocRecord;
        const res = await w.rules.addRule(target.slug, ruleInput("x"), { by: "agent:test" });
        expect({ code: res.ok ? "ok" : res.error.code, registry: (await registryIds(w.store)).length }).toEqual({
          code: "VALIDATION_ERROR", registry: 0,
        });
      });
    }

    it("a refused add does not advance the next AS number", async () => {
      const w = await world();
      const std = w.standards[0] as DocRecord;
      const first = await addRuleId(w.rules, std, 1);
      await w.rules.addRule((w.section as DocRecord).slug, ruleInput("refused"), { by: "agent:test" });
      const second = await addRuleId(w.rules, std, 2);
      expect(numberOf(second)).toBe(numberOf(first) + 1);
    });

    it("an invalid rule body on a standard (empty statement) is a VALIDATION_ERROR with nothing stored", async () => {
      const w = await world();
      const std = w.standards[0] as DocRecord;
      const res = await w.rules.addRule(std.slug, { ...ruleInput(1), statement: "" }, { by: "agent:test" });
      expect({ code: res.ok ? "ok" : res.error.code, registry: (await registryIds(w.store)).length }).toEqual({
        code: "VALIDATION_ERROR", registry: 0,
      });
    });
  });

  // ── census and arming ignore architecture (C7, C8) ─────────────────────────
  describe("census coverage and branch indexing ignore architecture nodes", () => {
    const git = {} as never; // MOCK RISK: RuleStateService.counts() is git-free by contract; any git call would throw loudly.

    async function status(w: World) {
      const res = await computeBaselineStatus(w.store, new RuleStateService(w.store, git), () => true);
      if (!res.ok || res.value === null) throw new Error(`computeBaselineStatus failed: ${JSON.stringify(res)}`);
      return res.value;
    }

    async function seedBusiness(w: World): Promise<void> {
      const brCited = await addRuleId(w.rules, w.leaves[0] as DocRecord, "cited");
      await addRuleId(w.rules, w.leaves[1] as DocRecord, "uncited");
      const spec = await must(await w.cs.create({ type: "spec", title: "Spec one", content: "b"} as CreateDocInput), "spec");
      await must(
        await new AcService(w.store, new RecordLockService(w.store)).addCriterion(spec.id, {
          id: "AC-C-1", statement: "Does the cited thing",
          verify: { mode: "script", oracle: "test", command: "bun test x" }, cites: [brCited],
        }),
        "criterion",
      );
    }

    it("an uncited live AS rule and an uncited live AD entry do not raise rules_uncovered", async () => {
      const w = await world();
      await seedBusiness(w);
      await addRuleId(w.rules, w.standards[0] as DocRecord, "std");
      await addRuleId(w.rules, w.debts[0] as DocRecord, "debt");
      expect((await status(w)).rules_uncovered).toBe(1);
    });

    it("AS rules are counted in rules_total and rules_by_lifecycle; AD entries are not (BR-670)", async () => {
      const w = await world();
      await seedBusiness(w);
      await addRuleId(w.rules, w.standards[0] as DocRecord, "std");
      await addRuleId(w.rules, w.debts[0] as DocRecord, "debt");
      const s = await status(w);
      expect({ total: s.rules_total, live: s.rules_by_lifecycle.live, family: s.rules_by_family, debt: s.debt_entries }).toEqual({
        total: 3, live: 3, family: { BR: 2, AS: 1 }, debt: 1,
      });
    });

    it("the business completeness measurements are identical with and without an architecture tree (negative control)", async () => {
      const bare = await world({ architecture: false });
      await seedBusiness(bare);
      const full = await world();
      await seedBusiness(full);
      await addRuleId(full.rules, full.standards[0] as DocRecord, "std");
      const a = await status(bare);
      const b = await status(full);
      expect({ uncovered: b.rules_uncovered, business: b.rules_by_family.BR, mismatch: b.registry_mismatch }).toEqual({
        uncovered: a.rules_uncovered, business: a.rules_by_family.BR, mismatch: a.registry_mismatch,
      });
      expect(b.rules_total).toBe(a.rules_total + 1);
    });

    it("a citation of a live AS rule is not a dangling cite", async () => {
      const w = await world();
      await seedBusiness(w);
      const as = await addRuleId(w.rules, w.standards[0] as DocRecord, "std");
      const spec = await must(await w.cs.create({ type: "spec", title: "Spec two", content: "b"} as CreateDocInput), "spec2");
      await must(
        await new AcService(w.store, new RecordLockService(w.store)).addCriterion(spec.id, {
          id: "AC-S-1", statement: "Does the standard thing",
          verify: { mode: "script", oracle: "test", command: "bun test y" }, cites: [as],
        }),
        "AS criterion",
      );
      expect((await status(w)).cites_dangling).toBe(0);
    });

    it("indexBaseline lists only the business branch as a branch (sections, module cards, standards are not branches)", async () => {
      const w = await world();
      await seedBusiness(w);
      const docs = await w.store.findMany({ type: "baseline" });
      const index = indexBaseline(docs.ok ? docs.value : []);
      expect(index.branches).toEqual([w.bizBranch.slug]);
    });

    it("indexBaseline never maps an AS or AD rule to a business branch", async () => {
      const w = await world();
      await seedBusiness(w);
      const as = await addRuleId(w.rules, w.standards[0] as DocRecord, "std");
      const ad = await addRuleId(w.rules, w.debts[0] as DocRecord, "debt");
      const docs = await w.store.findMany({ type: "baseline" });
      const index = indexBaseline(docs.ok ? docs.value : []);
      expect([index.branchOfRule.has(as), index.branchOfRule.has(ad)]).toEqual([false, false]);
    });

    it("indexBaseline still maps the business rules to their branch (control: different input, different output)", async () => {
      const w = await world();
      await seedBusiness(w);
      const docs = await w.store.findMany({ type: "baseline" });
      const index = indexBaseline(docs.ok ? docs.value : []);
      expect([...index.branchOfRule.values()]).toEqual([w.bizBranch.slug, w.bizBranch.slug]);
    });

    it("an architecture-only baseline has zero branches (nothing to arm)", async () => {
      const store = new InMemoryStore();
      const cs = new CorpusService(store, new RecordLockService(store));
      const prd = await must(await cs.create({ type: "prd", title: "P", content: "p" } as CreateDocInput), "prd");
      const root = await baseline(cs, "Arch root", prd, { tree: "architecture", node: "root" });
      await baseline(cs, "Arch section", root, { tree: "architecture", node: "section" });
      const docs = await store.findMany({ type: "baseline" });
      expect(indexBaseline(docs.ok ? docs.value : []).branches).toEqual([]);
    });
  });
});
