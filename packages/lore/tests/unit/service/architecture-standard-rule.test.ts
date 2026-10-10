/**
 * @spec_ref AC-BLS3-1
 * @task task-implement-a-architecture-tree-type-as-ad-registry-cite (spec baseline-slice-3a, rule BR-979)
 *
 * The four-part standard variant of an architecture rule: an `AS-n` rule carries
 * Current Reality / Target Rule / Current Exceptions / Migration, where Current Exceptions names
 * `AD-n` debt entries (the ONLY place a debt id is referenced; a criterion never cites one, BR-980).
 *
 * CONTRACT:
 *   S1. `baselineRuleSchema` gains `current_reality`, `target_rule`, `current_exceptions`, `migration`.
 *       They exist only on `AS-n` rules and are ALL-OR-NOTHING: some-but-not-all is refused, and any of
 *       them on a `BR-n` / `AD-n` rule is refused. `current_exceptions` may be an empty array; every
 *       entry must match `AD-<n>`.
 *   S2. `RuleService.addRule` on a standard accepts the four fields (same input otherwise). Every id in
 *       `current_exceptions` must be a LIVE `AD-n` carried by an architecture debt-registry; otherwise
 *       VALIDATION_ERROR and NO registry id is burned.
 *   S3. Input without the four fields stays valid on a standard (the minimal AS rule is not removed by
 *       this slice: the pre-existing red files add bare standards). Tension reported to the orchestrator:
 *       "all four required on AS rules" cannot hold for the bare path those files pin.
 *
 * Dimensions: HAPPY (four-part stored), NEGATIVE (partial, wrong family, malformed id), BOUNDARY (empty
 * exceptions, exactly three of four), ERROR (no id burned), STATE (retired debt no longer a valid
 * exception), REGRESSION (bare BR rule unchanged).
 */

import { describe, it, expect } from "vitest";
import { baselineExtraSchema, baselineRuleSchema } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";

const base = {
  statement: "Every write path goes through the chokepoint",
  confidence: "established",
  enforced_by: "both",
  examples: ["a write is refused outside the verb"],
  lifecycle: "live",
} as const;

const fourPart = {
  current_reality: "Three writers bypass the chokepoint today",
  target_rule: "Every writer calls the chokepoint",
  current_exceptions: ["AD-1"],
  migration: "Move each writer behind the chokepoint, one per task",
};

describe("four-part standard (schema)", () => {
  it("accepts an AS rule carrying all four parts", () => {
    expect(baselineRuleSchema.safeParse({ ...base, id: "AS-1", ...fourPart }).success).toBe(true);
  });

  it("accepts an empty current_exceptions list (a standard with no debt)", () => {
    expect(baselineRuleSchema.safeParse({ ...base, id: "AS-1", ...fourPart, current_exceptions: [] }).success).toBe(true);
  });

  it("accepts an AS rule with none of the four (the minimal standard)", () => {
    expect(baselineRuleSchema.safeParse({ ...base, id: "AS-1" }).success).toBe(true);
  });

  for (const missing of ["current_reality", "target_rule", "current_exceptions", "migration"] as const) {
    it(`refuses three of four: ${missing} missing`, () => {
      const partial: Record<string, unknown> = { ...base, id: "AS-1", ...fourPart };
      delete partial[missing];
      expect(baselineRuleSchema.safeParse(partial).success).toBe(false);
    });
  }

  it("refuses a lone current_exceptions", () => {
    expect(baselineRuleSchema.safeParse({ ...base, id: "AS-1", current_exceptions: ["AD-1"] }).success).toBe(false);
  });

  it("refuses a BR id in current_exceptions (debt entries are AD-n)", () => {
    expect(baselineRuleSchema.safeParse({ ...base, id: "AS-1", ...fourPart, current_exceptions: ["BR-1"] }).success).toBe(false);
  });

  it("refuses an AS id in current_exceptions", () => {
    expect(baselineRuleSchema.safeParse({ ...base, id: "AS-1", ...fourPart, current_exceptions: ["AS-2"] }).success).toBe(false);
  });

  it("refuses the four parts on a BR rule", () => {
    expect(baselineRuleSchema.safeParse({ ...base, id: "BR-1", ...fourPart }).success).toBe(false);
  });

  it("refuses the four parts on an AD rule", () => {
    expect(baselineRuleSchema.safeParse({ ...base, id: "AD-1", ...fourPart }).success).toBe(false);
  });

  it("refuses an empty current_reality string", () => {
    expect(baselineRuleSchema.safeParse({ ...base, id: "AS-1", ...fourPart, current_reality: "" }).success).toBe(false);
  });

  it("a four-part AS rule on a standard node validates through the whole extra", () => {
    const rule = { ...base, id: "AS-1", ...fourPart };
    expect(baselineExtraSchema.safeParse({ tree: "architecture", node: "standard", rules: [rule] }).success).toBe(true);
  });
});

// ─── RuleService ─────────────────────────────────────────────────────────────

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

const input = (extra: Record<string, unknown> = {}) => ({
  statement: "Every write path goes through the chokepoint",
  confidence: "established" as const,
  enforced_by: "both" as const,
  examples: ["a write is refused outside the verb"],
  ...extra,
});

async function world() {
  const store = new InMemoryStore();
  const cs = new CorpusService(store);
  const rules = new RuleService(store);
  const prd = await must(await cs.create({ type: "prd", title: "Product", content: "p" } as CreateDocInput), "prd");
  const bizRoot = await node(cs, "Business root", prd, { node: "root" });
  const branch = await node(cs, "Branch", bizRoot, { node: "branch" });
  const leaf = await node(cs, "Leaf", branch, { node: "leaf" });
  const archRoot = await node(cs, "Arch root", prd, { tree: "architecture", node: "root" });
  const section = await node(cs, "Section", archRoot, { tree: "architecture", node: "section" });
  const standard = await node(cs, "Standard", section, { tree: "architecture", node: "standard" });
  const debt = await node(cs, "Debt", section, { tree: "architecture", node: "debt-registry" });
  return { store, rules, leaf, standard, debt };
}

async function registrySize(store: InMemoryStore): Promise<number> {
  const rows = await store.listRuleRegistry();
  return rows.ok ? rows.value.length : -1;
}

const parts = (exceptions: string[]) => ({
  current_reality: "Three writers bypass the chokepoint today",
  target_rule: "Every writer calls the chokepoint",
  current_exceptions: exceptions,
  migration: "Move each writer behind the chokepoint, one per task",
});

describe("four-part standard (RuleService.addRule)", () => {
  it("stores the four parts on an AS rule whose exceptions are live AD entries", async () => {
    const w = await world();
    const ad = await must(await w.rules.addRule(w.debt.slug, input(), { by: "agent:t" }), "ad");
    const as = await must(await w.rules.addRule(w.standard.slug, input(parts([(ad as { ruleId: string }).ruleId])), { by: "agent:t" }), "as");
    const stored = ((as as { doc: DocRecord }).doc.extra["rules"] as Array<Record<string, unknown>>)[0];
    expect({ id: stored?.["id"], exceptions: stored?.["current_exceptions"], migration: stored?.["migration"] }).toEqual({
      id: "AS-1",
      exceptions: ["AD-1"],
      migration: "Move each writer behind the chokepoint, one per task",
    });
  });

  it("accepts an empty exceptions list without needing any debt entry", async () => {
    const w = await world();
    const res = await w.rules.addRule(w.standard.slug, input(parts([])), { by: "agent:t" });
    expect(res.ok).toBe(true);
  });

  it("refuses an exception id that no debt registry carries and burns no registry id", async () => {
    const w = await world();
    const res = await w.rules.addRule(w.standard.slug, input(parts(["AD-9"])), { by: "agent:t" });
    expect({ code: res.ok ? "ok" : res.error.code, registry: await registrySize(w.store) }).toEqual({
      code: "VALIDATION_ERROR",
      registry: 0,
    });
  });

  it("refuses a RETIRED debt entry as an exception (state: only live debt can be listed)", async () => {
    const w = await world();
    const ad = (await must(await w.rules.addRule(w.debt.slug, input(), { by: "agent:t" }), "ad")) as { ruleId: string };
    await must(await w.rules.setRule(ad.ruleId, { lifecycle: "retired", note: "paid off" }, { by: "agent:t" }), "retire");
    const res = await w.rules.addRule(w.standard.slug, input(parts([ad.ruleId])), { by: "agent:t" });
    expect({ code: res.ok ? "ok" : res.error.code, registry: await registrySize(w.store) }).toEqual({
      code: "VALIDATION_ERROR",
      registry: 1,
    });
  });

  it("refuses a business rule id listed as an exception", async () => {
    const w = await world();
    const br = (await must(await w.rules.addRule(w.leaf.slug, input(), { by: "agent:t" }), "br")) as { ruleId: string };
    const res = await w.rules.addRule(w.standard.slug, input(parts([br.ruleId])), { by: "agent:t" });
    expect(res.ok).toBe(false);
  });

  it("refuses a partial four-part input (three of four) and burns no id", async () => {
    const w = await world();
    const { migration: _dropped, ...three } = parts([]);
    const res = await w.rules.addRule(w.standard.slug, input(three), { by: "agent:t" });
    expect({ code: res.ok ? "ok" : res.error.code, registry: await registrySize(w.store) }).toEqual({
      code: "VALIDATION_ERROR",
      registry: 0,
    });
  });

  it("refuses the four parts on a debt registry and on a business leaf", async () => {
    const w = await world();
    const onDebt = await w.rules.addRule(w.debt.slug, input(parts([])), { by: "agent:t" });
    const onLeaf = await w.rules.addRule(w.leaf.slug, input(parts([])), { by: "agent:t" });
    expect([onDebt.ok, onLeaf.ok, await registrySize(w.store)]).toEqual([false, false, 0]);
  });

  it("the minimal AS rule (no four parts) is still accepted (S3)", async () => {
    const w = await world();
    const res = await w.rules.addRule(w.standard.slug, input(), { by: "agent:t" });
    expect(res.ok && res.value.ruleId).toBe("AS-1");
  });

  it("a bare BR rule on a leaf is unchanged (regression)", async () => {
    const w = await world();
    const res = await w.rules.addRule(w.leaf.slug, input(), { by: "agent:t" });
    expect(res.ok && res.value.ruleId).toBe("BR-1");
  });
});
