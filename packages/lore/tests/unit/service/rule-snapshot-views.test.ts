/**
 * AC-CS-4 — snapshot views list only live rules; proposed rules live in the spec's change set.
 *
 * Spec: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (Model, D5). Rule: BR-643
 * (retired rules are tombstones outside the snapshot views, readable by id).
 *
 * Dimensions:
 *   HAPPY       the leaf's rule list, `rule find`, `rule impact` and coverage keep describing live rules only;
 *               the spec review judge input carries extra.rule_changes
 *   NEGATIVE    a proposed id is not found by find (text and spec), impact, or counted by the leaf tree view;
 *               the leaf review does not see a proposed rule
 *   BOUNDARY    a retired rule is hidden from find unless the view asks for tombstones, yet still shown by id
 *   REGRESSION  a spec with no change set renders no change-set block in the judge input
 */

import { describe, it, expect } from "vitest";
import { REVIEW_TEMPLATES, REVIEW_PROMPT_VERSION } from "../../../src/ai/review-template.js";
import { computeLeafCoverage } from "../../../src/service/leaf-coverage.js";
import { makeSpec, makeWorld, reload, scriptCriterion, type World } from "./rule-change-world.js";

const PROPOSED_TEXT = "A zebra-striped rule that is only proposed";

async function proposeZebra(world: World, specSlug: string): Promise<string> {
  const result = await world.changes.propose(specSlug, {
    op: "add",
    leaf: "leaf-a",
    statement: PROPOSED_TEXT,
    examples: ["e"],
    enforced_by: "both",
  });
  if (!result.ok) throw new Error(`propose failed: ${JSON.stringify(result.error)}`);
  return result.value.change.id;
}

async function promptOf(world: World, slug: string): Promise<string> {
  const bundle = await world.corpus.getReviewBundle(slug);
  if (!bundle.ok) throw new Error(`bundle failed: ${JSON.stringify(bundle.error)}`);
  const template = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION];
  if (template === undefined) throw new Error("no review template");
  return template(bundle.value, [], { max_context_chars: 8000 }, new Date().toISOString()).prompt;
}

describe("snapshot views list only live rules (AC-CS-4)", () => {
  it("NEGATIVE: rule find (text and spec) never returns a proposed rule", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const id = await proposeZebra(world, spec.slug);
    await world.ac.addCriterion(spec.slug, scriptCriterion("AC-A-1", [id, "BR-1"]));
    const byText = await world.read.find({ text: "zebra" });
    expect(byText.ok && byText.value).toEqual([]);
    const bySpec = await world.read.find({ spec: spec.slug });
    expect(bySpec.ok && bySpec.value).toEqual(["BR-1"]);
  });

  it("NEGATIVE: rule impact of a proposed id is not found; the leaf's rule list and tree counts are unchanged", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const treeBefore = await world.rules.listBaselineTree();
    const id = await proposeZebra(world, spec.slug);
    expect((await world.impact.impact(id)).ok).toBe(false);
    expect(((await reload(world, world.leafId)).extra["rules"] as Array<{ id: string }>).map((r) => r.id)).toEqual(["BR-1"]);
    const treeAfter = await world.rules.listBaselineTree();
    expect(treeAfter.ok && treeAfter.value.find((e) => e.slug === "leaf-a")?.rules).toEqual(
      treeBefore.ok ? treeBefore.value.find((e) => e.slug === "leaf-a")?.rules : undefined,
    );
  });

  it("NEGATIVE: baseline coverage counts a site mapped only to a proposed id as a gap", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const id = await proposeZebra(world, spec.slug);
    const leaf = await reload(world, world.leafId);
    const liveRuleIds = (leaf.extra["rules"] as Array<{ id: string; lifecycle: string }>).filter((r) => r.lifecycle === "live").map((r) => r.id);
    const site = { key: "a.ts#f#X", dynamic: false } as never;
    const verdict = computeLeafCoverage({ sites: [site], siteMap: { "a.ts#f#X": [id] }, liveRuleIds });
    expect(verdict.gaps).toEqual(["a.ts#f#X"]);
  });

  it("BOUNDARY: a retired rule is hidden from find unless tombstones are asked for, and stays readable by id", async () => {
    const world = await makeWorld();
    const retired = await world.rules.setRule("BR-1", { lifecycle: "retired", note: "no longer true" }, { by: "test" });
    expect(retired.ok).toBe(true);
    const hidden = await world.read.find({ text: "live rule" });
    expect(hidden.ok && hidden.value).toEqual([]);
    const withTombstones = await world.read.find({ text: "live rule" }, { includeTombstones: true });
    expect(withTombstones.ok && withTombstones.value).toEqual(["BR-1"]);
    const shown = await world.read.show("BR-1");
    expect(shown.ok && shown.value.state).toBe("retired");
  });

  it("HAPPY: a live rule is still found by text", async () => {
    const world = await makeWorld();
    const found = await world.read.find({ text: "live rule" });
    expect(found.ok && found.value).toEqual(["BR-1"]);
  });
});

describe("the review judge input (AC-CS-4, D5)", () => {
  it("HAPPY: a spec's judge input includes its extra.rule_changes", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const id = await proposeZebra(world, spec.slug);
    await world.changes.propose(spec.slug, { op: "modify", id: "BR-1", statement: "A reworded live rule" });
    const prompt = await promptOf(world, spec.slug);
    expect(prompt).toContain(id);
    expect(prompt).toContain(PROPOSED_TEXT);
    expect(prompt).toContain("A reworded live rule");
    expect(prompt).toMatch(/Rule Changes/);
  });

  it("NEGATIVE: the leaf's judge input does not see the proposed rule", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    await proposeZebra(world, spec.slug);
    expect(await promptOf(world, "leaf-a")).not.toContain(PROPOSED_TEXT);
  });

  it("REGRESSION: a spec with no change set renders no change-set block", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec B");
    expect(await promptOf(world, spec.slug)).not.toMatch(/Rule Changes/);
  });
});
